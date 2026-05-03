// Agent: an LLM-driven Werewolf player. Owns a persona + LLM client.
// Decisions:
//   - Speech generation (LLM)
//   - Vote target (persona-biased candidate selection + LLM reasoning)
//   - Night actions: kill (wolves) / investigate (seer)

import type {
  GameContext,
  PlayerState,
  Role,
  AgentDecision,
  TurnRecord
} from "./types.js";
import { LLMClient } from "./llm.js";
import { log } from "./log.js";
import type { Persona as PersonaT } from "./personas.js";

export class WerewolfAgent {
  constructor(
    public readonly agentId: number,
    public readonly walletAddress: string,
    public readonly axlPeerId: string,
    public readonly persona: PersonaT,
    private readonly llm: LLMClient
  ) {}

  async generateSpeech(ctx: GameContext): Promise<string> {
    const prompt = buildSpeechPrompt(ctx, this);
    const text = await this.llm.generate([{ role: "user", content: prompt }]);
    return clipText(text, 60);
  }

  async generateVote(ctx: GameContext): Promise<{ target: number; reasoning: string }> {
    const candidates = ctx.alivePlayers.filter((id) => id !== this.agentId);
    if (candidates.length === 0) {
      return { target: this.agentId, reasoning: "no candidates" };
    }
    const biased = applyVoteBias(candidates, ctx, this.persona);
    const prompt = buildVotePrompt(ctx, this, biased);
    const raw = await this.llm.generate([{ role: "user", content: prompt }]);
    const parsed = parseVoteResponse(raw, biased, ctx);
    return parsed;
  }

  async generateNightAction(ctx: GameContext): Promise<AgentDecision["nightAction"]> {
    if (ctx.role === "VILLAGER") return undefined;

    if (ctx.role === "WEREWOLF") {
      const fellowIds = (ctx.fellowWolves ?? []).map((w) => w.agentId);
      const candidates = ctx.alivePlayers.filter((id) => id !== this.agentId && !fellowIds.includes(id));
      if (candidates.length === 0) return undefined;
      const target = pickKillTarget(candidates, ctx, this.persona);
      const reasoning = await this.shortReasoning(ctx, "kill", target);
      return { kill: target, reasoning };
    }

    if (ctx.role === "SEER") {
      const known = new Set((ctx.seerKnowledge ?? []).map((k) => k.targetId));
      const candidates = ctx.alivePlayers.filter((id) => id !== this.agentId && !known.has(id));
      if (candidates.length === 0) return undefined;
      const target = pickInvestigationTarget(candidates, ctx, this.persona);
      const reasoning = await this.shortReasoning(ctx, "investigate", target);
      return { investigate: target, reasoning };
    }
  }

  private async shortReasoning(ctx: GameContext, action: "kill" | "investigate", target: number): Promise<string> {
    const targetName = ctx.players.find((p) => p.agentId === target)?.displayName ?? `agent ${target}`;
    const prompt = `In one short sentence, in character, explain why you'd ${action} ${targetName} this night. No preamble. Under 25 words.`;
    try {
      return clipText(await this.llm.generate([{ role: "user", content: prompt }]), 25);
    } catch {
      return action === "kill" ? "They're the biggest threat." : "Their silence is suspicious.";
    }
  }
}

// ---- Prompt builders ----

function buildSpeechPrompt(ctx: GameContext, agent: WerewolfAgent): string {
  const recentSpeeches = collectRecentSpeeches(ctx, 10);
  const knownInfo = privateKnowledgeText(ctx, agent);
  const players = ctx.alivePlayers
    .map((id) => {
      const p = ctx.players.find((p) => p.agentId === id)!;
      return `  ${id}: ${p.displayName}`;
    })
    .join("\n");

  return `Werewolf game state:
- You are agent ${agent.agentId} (${agent.persona.displayName}), role: ${ctx.role}
- Turn ${ctx.turn}, Day-Discussion phase
- Living players:
${players}

Recent dialogue (oldest first):
${recentSpeeches || "(no speeches yet this game)"}

${knownInfo}

Your task: speak ONE in-character message in the public discussion. Stay in character.
Do NOT exceed 60 words. Do NOT reveal your role explicitly. Output ONLY your in-character speech, no preamble or quotes.`;
}

function buildVotePrompt(
  ctx: GameContext,
  agent: WerewolfAgent,
  candidates: number[]
): string {
  const recentSpeeches = collectRecentSpeeches(ctx, 8);
  const knownInfo = privateKnowledgeText(ctx, agent);
  const candidateNames = candidates
    .map((id) => {
      const p = ctx.players.find((p) => p.agentId === id)!;
      return `  ${id}: ${p.displayName}`;
    })
    .join("\n");

  return `Werewolf voting phase, turn ${ctx.turn}.
You are agent ${agent.agentId} (${agent.persona.displayName}), role: ${ctx.role}.

Living candidates to vote out:
${candidateNames}

Recent dialogue:
${recentSpeeches}

${knownInfo}

Decide who to vote out. Respond ONLY in this exact JSON format on a single line:
{"target": <agentId>, "reasoning": "<one short sentence in-character>"}

The target MUST be one of the candidate IDs above. Do not vote for yourself. No text outside the JSON.`;
}

function privateKnowledgeText(ctx: GameContext, agent: WerewolfAgent): string {
  const lines: string[] = ["Your private knowledge:"];
  if (ctx.role === "WEREWOLF") {
    const fellow = (ctx.fellowWolves ?? []).map((w) => `${w.agentId} (${w.displayName})`).join(", ") || "(none alive)";
    lines.push(`  - Your fellow wolves: ${fellow}`);
  }
  if (ctx.role === "SEER" && ctx.seerKnowledge && ctx.seerKnowledge.length > 0) {
    for (const k of ctx.seerKnowledge) {
      const p = ctx.players.find((p) => p.agentId === k.targetId);
      lines.push(`  - Investigated turn ${k.turn}: agent ${k.targetId} (${p?.displayName ?? "?"}) is ${k.role}`);
    }
  }
  if (ctx.lastEliminated) {
    const p = ctx.players.find((p) => p.agentId === ctx.lastEliminated!.agentId);
    lines.push(`  - Last eliminated: agent ${ctx.lastEliminated.agentId} (${p?.displayName ?? "?"}) was ${ctx.lastEliminated.role}`);
  }
  return lines.length === 1 ? "" : lines.join("\n");
}

function collectRecentSpeeches(ctx: GameContext, limit: number): string {
  const all: Array<{ turn: number; speakerId: number; text: string; speakerName: string }> = [];
  for (const t of ctx.history) {
    for (const s of t.day.speeches) {
      const p = ctx.players.find((p) => p.agentId === s.speakerId);
      all.push({ turn: t.turn, speakerId: s.speakerId, text: s.text, speakerName: p?.displayName ?? `agent ${s.speakerId}` });
    }
  }
  return all
    .slice(-limit)
    .map((s) => `  [T${s.turn}] ${s.speakerName} (${s.speakerId}): ${s.text}`)
    .join("\n");
}

// ---- Vote parsing & bias ----

function parseVoteResponse(raw: string, candidates: number[], ctx: GameContext): { target: number; reasoning: string } {
  const cleaned = raw.trim();
  const m = cleaned.match(/\{[^{}]*"target"\s*:\s*(\d+)[^{}]*"reasoning"\s*:\s*"([^"]*)"[^{}]*\}/);
  if (m) {
    const target = parseInt(m[1], 10);
    if (candidates.includes(target)) {
      return { target, reasoning: m[2].slice(0, 120) };
    }
  }
  // Fallback: any number that matches a candidate
  const numMatch = cleaned.match(/\b(\d+)\b/g);
  if (numMatch) {
    for (const n of numMatch) {
      const t = parseInt(n, 10);
      if (candidates.includes(t)) {
        return { target: t, reasoning: cleaned.slice(0, 120) };
      }
    }
  }
  // Last resort: random candidate
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  log.warn({ raw: cleaned }, "vote response unparseable; falling back to random");
  return { target, reasoning: "(LLM output malformed; defaulted)" };
}

function applyVoteBias(candidates: number[], ctx: GameContext, persona: PersonaT): number[] {
  const heuristic = persona.decisionBias.voteHeuristic;
  // Compute a score per candidate; higher = more likely to be voted by THIS persona
  const scored = candidates.map((id) => {
    let score = Math.random() * 0.5; // random nudge
    const speechCount = countSpeeches(ctx, id);
    const accusationsAgainst = countAccusationsAgainst(ctx, id);

    switch (heuristic) {
      case "quietest":
        score += (1 / (speechCount + 1)) * 2;
        break;
      case "loudest":
        score += Math.min(speechCount, 5) * 0.4;
        break;
      case "vote-pattern":
        score += accusationsAgainst * 0.5;
        break;
      case "first-accusation":
        score += accusationsAgainst > 0 ? 1 : 0;
        break;
      case "consensus":
        score += accusationsAgainst * 0.6;
        break;
      case "underdog":
        score -= accusationsAgainst * 0.3; // protect the under-attacked
        score += (1 / (speechCount + 1)) * 0.5;
        break;
    }

    // Wolves never vote each other naturally
    return { id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.id);
}

function pickKillTarget(candidates: number[], ctx: GameContext, persona: PersonaT): number {
  // Wolves: prefer the analyst-like / quietest player who could be seer
  const scored = candidates.map((id) => {
    const speechCount = countSpeeches(ctx, id);
    let score = Math.random() * 0.3;
    score += (1 / (speechCount + 1)) * 1.5;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

function pickInvestigationTarget(candidates: number[], ctx: GameContext, persona: PersonaT): number {
  // Seer: investigate someone with high speech activity (likely influential)
  const scored = candidates.map((id) => {
    const speechCount = countSpeeches(ctx, id);
    let score = Math.random() * 0.3;
    score += Math.min(speechCount, 5) * 0.4;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

function countSpeeches(ctx: GameContext, agentId: number): number {
  return ctx.history.flatMap((t) => t.day.speeches).filter((s) => s.speakerId === agentId).length;
}

function countAccusationsAgainst(ctx: GameContext, agentId: number): number {
  return ctx.history.flatMap((t) => t.day.votes).filter((v) => v.targetId === agentId).length;
}

function clipText(s: string, maxWords: number): string {
  const trimmed = s.trim().replace(/^["']|["']$/g, "");
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(" ") + "…";
}
