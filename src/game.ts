// Game orchestrator: runs a single Werewolf game end-to-end.
// In-process design: agents are objects, GM logic lives here, no transport.

import { v4 as uuidv4 } from "uuid";
import { keccak256, toUtf8Bytes } from "ethers";
import type {
  PlayerState,
  Role,
  Phase,
  TurnRecord,
  Winner,
  GameContext,
  GameArchiveJSON,
  SpeechEvent,
  VoteEvent
} from "./types.js";
import type { WerewolfAgent } from "./agent.js";
import { log } from "./log.js";
import type { EventEmitter } from "node:events";

export interface GameConfig {
  rolesDistribution: { WEREWOLF: number; VILLAGER: number; SEER: number };
  phaseTimings: { NIGHT: number; DAY_DISCUSSION: number; DAY_VOTE: number; REVEAL: number };
  maxSpeechesPerPhase: number;
  speechIntervalMs?: number; // pacing between speeches in a phase
}

export interface GameResult {
  gameId: string;
  winner: Winner;
  startTs: number;
  endTs: number;
  turns: TurnRecord[];
  finalPlayers: PlayerState[];
  archive: GameArchiveJSON;
}

export class GameOrchestrator {
  private readonly gameId: string;
  private readonly players: PlayerState[];
  private readonly agentMap = new Map<number, WerewolfAgent>();
  private readonly history: TurnRecord[] = [];
  private currentTurn = 0;
  private currentPhase: Phase = "NIGHT";
  private startTs = 0;
  private seerKnowledge = new Map<number, Array<{ targetId: number; role: Role; turn: number }>>();
  private lastEliminated: { agentId: number; role: Role } | null = null;

  constructor(
    private readonly agents: WerewolfAgent[],
    private readonly cfg: GameConfig,
    private readonly emitter?: EventEmitter
  ) {
    this.gameId = uuidv4();
    this.players = assignRoles(agents, cfg.rolesDistribution);
    for (const a of agents) this.agentMap.set(a.agentId, a);
  }

  async run(): Promise<GameResult> {
    this.startTs = Date.now();
    this.emit("game_start", {
      gameId: this.gameId,
      players: this.players.map((p) => ({
        agentId: p.agentId,
        displayName: p.displayName,
        // Roles intentionally hidden in spectator view until game ends
        alive: p.alive
      })),
      rolesDistribution: this.cfg.rolesDistribution
    });

    log.info({ gameId: this.gameId, players: this.players.length }, "game start");

    // For each player, log their assigned role to console (not broadcast publicly)
    for (const p of this.players) {
      log.info({ gameId: this.gameId, agentId: p.agentId, name: p.displayName, role: p.role }, "role assigned");
    }

    while (true) {
      this.currentTurn += 1;
      const turn: TurnRecord = {
        turn: this.currentTurn,
        night: { kill: null, investigation: null, covenMessages: [] },
        day: { speeches: [], whispers: [], votes: [], eliminated: null }
      };

      // ---- NIGHT ----
      this.currentPhase = "NIGHT";
      this.emit("phase_start", { phase: "NIGHT", turn: this.currentTurn, alivePlayers: this.alivePlayerIds() });
      await this.runNightPhase(turn);
      this.emit("phase_end", { phase: "NIGHT", turn: this.currentTurn });

      // Check if game ended after night kill
      const nightWin = this.checkWinCondition();
      if (nightWin) {
        this.history.push(turn);
        return this.finishGame(nightWin);
      }

      // ---- DAY_DISCUSSION ----
      this.currentPhase = "DAY_DISCUSSION";
      this.emit("phase_start", {
        phase: "DAY_DISCUSSION",
        turn: this.currentTurn,
        alivePlayers: this.alivePlayerIds(),
        lastEliminated: this.lastEliminated
      });
      await this.runDayDiscussion(turn);
      this.emit("phase_end", { phase: "DAY_DISCUSSION", turn: this.currentTurn });

      // ---- DAY_VOTE ----
      this.currentPhase = "DAY_VOTE";
      this.emit("phase_start", { phase: "DAY_VOTE", turn: this.currentTurn, alivePlayers: this.alivePlayerIds() });
      await this.runDayVote(turn);
      this.emit("phase_end", { phase: "DAY_VOTE", turn: this.currentTurn });

      // ---- REVEAL ----
      this.currentPhase = "REVEAL";
      const eliminatedId = this.resolveVote(turn);
      if (eliminatedId !== null) {
        const player = this.players.find((p) => p.agentId === eliminatedId)!;
        player.alive = false;
        player.eliminatedByVote = true;
        this.lastEliminated = { agentId: eliminatedId, role: player.role };
        turn.day.eliminated = eliminatedId;
      }
      const tally = tallyVotes(turn.day.votes);
      this.emit("elimination", {
        turn: this.currentTurn,
        eliminated: eliminatedId,
        role: eliminatedId ? this.players.find((p) => p.agentId === eliminatedId)!.role : null,
        votes: tally,
        alivePlayers: this.alivePlayerIds()
      });

      this.history.push(turn);

      // Check win
      const dayWin = this.checkWinCondition();
      if (dayWin) return this.finishGame(dayWin);

      if (this.currentTurn >= 12) {
        log.warn({ gameId: this.gameId }, "max turns reached, force-ending villagers win");
        return this.finishGame("VILLAGERS");
      }
    }
  }

  private async runNightPhase(turn: TurnRecord): Promise<void> {
    const aliveWolves = this.players.filter((p) => p.alive && p.role === "WEREWOLF");
    const aliveSeer = this.players.find((p) => p.alive && p.role === "SEER");

    // Wolves: pick a target. For simplicity, lowest-ID wolf decides; in real coven, would negotiate.
    if (aliveWolves.length > 0) {
      const leader = aliveWolves.sort((a, b) => a.agentId - b.agentId)[0];
      const ctx = this.contextFor(leader);
      const decision = await this.agentMap.get(leader.agentId)!.generateNightAction(ctx);
      if (decision?.kill !== undefined) {
        const target = this.players.find((p) => p.agentId === decision.kill);
        if (target && target.alive && target.role !== "WEREWOLF") {
          target.alive = false;
          target.killedByWolves = true;
          turn.night.kill = { wolfId: leader.agentId, targetId: target.agentId, reasoning: decision.reasoning ?? "" };
          this.lastEliminated = { agentId: target.agentId, role: target.role };
          log.info(
            { turn: this.currentTurn, wolf: leader.agentId, target: target.agentId, role: target.role },
            "night kill"
          );
          this.emit("night_kill", { turn: this.currentTurn, target: target.agentId, role: target.role });
        }
      }
    }

    // Seer investigates
    if (aliveSeer) {
      const ctx = this.contextFor(aliveSeer);
      const decision = await this.agentMap.get(aliveSeer.agentId)!.generateNightAction(ctx);
      if (decision?.investigate !== undefined) {
        const target = this.players.find((p) => p.agentId === decision.investigate);
        if (target && target.alive) {
          turn.night.investigation = { seerId: aliveSeer.agentId, targetId: target.agentId, discoveredRole: target.role };
          const knowledge = this.seerKnowledge.get(aliveSeer.agentId) ?? [];
          knowledge.push({ targetId: target.agentId, role: target.role, turn: this.currentTurn });
          this.seerKnowledge.set(aliveSeer.agentId, knowledge);
          log.info(
            { turn: this.currentTurn, seer: aliveSeer.agentId, target: target.agentId, role: target.role },
            "seer investigation (private)"
          );
        }
      }
    }
  }

  private async runDayDiscussion(turn: TurnRecord): Promise<void> {
    const speakers = this.players.filter((p) => p.alive);
    // Each alive agent speaks once per phase (rate-limit aware)
    const rounds = Number(process.env.SPEECH_ROUNDS || 1);
    const interval = this.cfg.speechIntervalMs ?? 0;
    for (let round = 0; round < rounds; round++) {
      const order = shuffle(speakers.map((p) => p.agentId));
      for (const agentId of order) {
        const player = this.players.find((p) => p.agentId === agentId)!;
        if (!player.alive) continue;
        const ctx = this.contextFor(player);
        try {
          const text = await this.agentMap.get(agentId)!.generateSpeech(ctx);
          const event: SpeechEvent = {
            speakerId: agentId,
            text,
            ts: Date.now(),
            turn: this.currentTurn,
            addressing: undefined
          };
          turn.day.speeches.push(event);
          this.emit("speech", event);
          log.info({ turn: this.currentTurn, speaker: player.displayName, text }, "speech");
          if (interval > 0) await sleep(interval);
        } catch (e) {
          log.warn({ err: String(e), agentId }, "speech generation failed");
        }
      }
    }
  }

  private async runDayVote(turn: TurnRecord): Promise<void> {
    const voters = this.players.filter((p) => p.alive);
    const promises = voters.map(async (player) => {
      const ctx = this.contextFor(player);
      try {
        const decision = await this.agentMap.get(player.agentId)!.generateVote(ctx);
        const event: VoteEvent = {
          voterId: player.agentId,
          targetId: decision.target,
          reasoning: decision.reasoning,
          ts: Date.now(),
          turn: this.currentTurn
        };
        turn.day.votes.push(event);
        this.emit("vote", event);
        log.info(
          { turn: this.currentTurn, voter: player.displayName, target: decision.target, reasoning: decision.reasoning },
          "vote"
        );
      } catch (e) {
        log.warn({ err: String(e), agentId: player.agentId }, "vote generation failed");
      }
    });
    await Promise.all(promises);
  }

  private resolveVote(turn: TurnRecord): number | null {
    const tally = tallyVotes(turn.day.votes);
    const entries = [...tally.entries()];
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    const tied = entries.filter((e) => e[1] === top[1]);
    if (tied.length === 1) return top[0];
    // Deterministic tiebreaker
    const seed = keccak256(toUtf8Bytes(`${this.gameId}:${this.currentTurn}`));
    const idx = parseInt(seed.slice(2, 10), 16) % tied.length;
    return tied[idx][0];
  }

  private checkWinCondition(): Winner | null {
    const alive = this.players.filter((p) => p.alive);
    const wolvesAlive = alive.filter((p) => p.role === "WEREWOLF").length;
    const villagersAlive = alive.filter((p) => p.role !== "WEREWOLF").length;
    if (wolvesAlive === 0) return "VILLAGERS";
    if (wolvesAlive > villagersAlive) return "WOLVES"; // strict
    return null;
  }

  private finishGame(winner: Winner): GameResult {
    const endTs = Date.now();
    log.info({ gameId: this.gameId, winner, turns: this.history.length, durationMs: endTs - this.startTs }, "GAME END");

    const archive = this.buildArchive(winner, endTs);
    this.emit("game_end", {
      gameId: this.gameId,
      winner,
      turnsPlayed: this.history.length,
      finalRoles: Object.fromEntries(this.players.map((p) => [p.agentId, p.role])),
      players: this.players.map((p) => ({
        agentId: p.agentId,
        displayName: p.displayName,
        role: p.role,
        survived: p.alive
      }))
    });

    return {
      gameId: this.gameId,
      winner,
      startTs: this.startTs,
      endTs,
      turns: this.history,
      finalPlayers: this.players,
      archive
    };
  }

  private buildArchive(winner: Winner, endTs: number): GameArchiveJSON {
    return {
      v: 1,
      gameId: this.gameId,
      startTs: this.startTs,
      endTs,
      winner,
      players: this.players.map((p) => ({
        agentId: p.agentId,
        walletAddress: p.walletAddress,
        axlPeerId: p.axlPeerId,
        displayName: p.displayName,
        finalRole: p.role,
        survived: p.alive
      })),
      turns: this.history,
      merkleRoot: "0x" + "00".repeat(32) // computed by archive builder later
    };
  }

  private contextFor(player: PlayerState): GameContext {
    const fellowWolves = player.role === "WEREWOLF"
      ? this.players.filter((p) => p.alive && p.role === "WEREWOLF" && p.agentId !== player.agentId)
      : null;
    return {
      gameId: this.gameId,
      agentId: player.agentId,
      role: player.role,
      fellowWolves,
      players: this.players,
      alivePlayers: this.alivePlayerIds(),
      turn: this.currentTurn,
      phase: this.currentPhase,
      history: this.history,
      lastEliminated: this.lastEliminated,
      seerKnowledge: this.seerKnowledge.get(player.agentId)
    };
  }

  private alivePlayerIds(): number[] {
    return this.players.filter((p) => p.alive).map((p) => p.agentId);
  }

  private emit(event: string, payload: unknown): void {
    this.emitter?.emit(event, payload);
  }
}

function assignRoles(
  agents: WerewolfAgent[],
  dist: { WEREWOLF: number; VILLAGER: number; SEER: number }
): PlayerState[] {
  const total = dist.WEREWOLF + dist.VILLAGER + dist.SEER;
  if (agents.length !== total) {
    throw new Error(`Player/role mismatch: ${agents.length} agents but ${total} roles configured`);
  }
  const roles: Role[] = [
    ...Array(dist.WEREWOLF).fill("WEREWOLF" as const),
    ...Array(dist.VILLAGER).fill("VILLAGER" as const),
    ...Array(dist.SEER).fill("SEER" as const)
  ];
  const shuffled = shuffle(roles);
  return agents.map((a, i) => ({
    agentId: a.agentId,
    walletAddress: a.walletAddress,
    axlPeerId: a.axlPeerId,
    displayName: a.persona.displayName,
    role: shuffled[i],
    alive: true,
    killedByWolves: false,
    eliminatedByVote: false
  }));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tallyVotes(votes: VoteEvent[]): Map<number, number> {
  const tally = new Map<number, number>();
  for (const v of votes) tally.set(v.targetId, (tally.get(v.targetId) ?? 0) + 1);
  return tally;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
