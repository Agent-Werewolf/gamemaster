// Entry point: spawns 8 LLM-driven agents, runs a Werewolf game end-to-end,
// builds an archive, optionally uploads to 0G Storage, commits root onchain,
// and serves a spectator dashboard via WebSocket.

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { keccak256, toUtf8Bytes, Wallet } from "ethers";
import type { Hex } from "viem";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { LLMClient } from "./llm.js";
import { WerewolfAgent } from "./agent.js";
import { PERSONAS } from "./personas.js";
import { GameOrchestrator } from "./game.js";
import { buildAndPersistArchive } from "./archive.js";
import { makeChainClient } from "./chain.js";
import { SpectatorBroadcast } from "./spectator.js";
import { AxlTransport } from "./transport.js";
import { AxlMirror } from "./axl-mirror.js";
import type { Role } from "./types.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const emitter = new EventEmitter();

  // Spectator UI (static HTML in ../dashboard)
  const spectator = new SpectatorBroadcast(emitter, cfg.httpPort, "../dashboard");
  await spectator.start();

  // ── Gensyn AXL P2P transport (optional mirror) ─────────────────────────
  // When AXL_TRANSPORT=1 and AXL_DEST_PEER_ID is set, every game event is
  // ALSO forwarded over real Yggdrasil-over-TLS P2P to a remote AXL peer.
  // Run `pnpm tsx src/axl-witness.ts` against the destination AXL node to
  // see envelopes arrive over the wire.
  let axlMirror: AxlMirror | null = null;
  if (process.env.AXL_TRANSPORT === "1" && process.env.AXL_DEST_PEER_ID) {
    const axl = new AxlTransport({
      localApi: process.env.AXL_LOCAL_API ?? "http://127.0.0.1:9103",
      destPeerId: process.env.AXL_DEST_PEER_ID,
      label: "gm-mirror"
    });
    axl.startPolling(); // optional, in case witness/GM sends back
    axlMirror = new AxlMirror(axl, emitter, cfg.gmPrivateKey);
    log.info({
      api: process.env.AXL_LOCAL_API ?? "http://127.0.0.1:9103",
      destPeerId: process.env.AXL_DEST_PEER_ID.slice(0, 16) + "…"
    }, "AXL P2P mirror enabled — game events will be shadow-forwarded over Yggdrasil");
  }

  // Build LLM client. Use 0G Compute by default; allow OpenAI-compatible fallback for offline dev.
  const useFallback = !!process.env.LLM_FALLBACK_URL;
  const llm = new LLMClient({
    providerAddress: cfg.ogComputeProvider,
    fallbackBaseUrl: process.env.LLM_FALLBACK_URL,
    fallbackModel: process.env.LLM_FALLBACK_MODEL || "gpt-4o-mini",
    fallbackApiKey: process.env.LLM_FALLBACK_API_KEY,
    maxTokens: 200,
    temperature: 0.85
  });

  // Build 8 agents from personas (5 unique + 2 variants + repeat 1 to hit 8).
  // Order: paranoid, manipulator, analyst, accuser, peacemaker, paranoid-shadow, manipulator-shadow, + a re-instance of paranoid
  // For 8 total, we'd have 7 personas listed; pad with one re-instance to fill 8th.
  const personasFor8 = [...PERSONAS, PERSONAS[0]]; // 7 + 1 = 8

  const agents: WerewolfAgent[] = personasFor8.map((persona, i) => {
    const wallet = Wallet.createRandom();
    const peerId = "0x" + randomBytes(32).toString("hex");
    const personaLLM = new LLMClient({
      providerAddress: cfg.ogComputeProvider,
      fallbackBaseUrl: process.env.LLM_FALLBACK_URL,
      fallbackModel: process.env.LLM_FALLBACK_MODEL || "gpt-4o-mini",
      fallbackApiKey: process.env.LLM_FALLBACK_API_KEY,
      systemPrompt: persona.systemPrompt,
      maxTokens: 200,
      temperature: 0.85
    });
    return new WerewolfAgent(i + 1, wallet.address, peerId, persona, personaLLM);
  });

  log.info({ agentCount: agents.length, mode: useFallback ? "fallback-LLM" : "0G-Compute" }, "agents ready");

  // Run game
  const orchestrator = new GameOrchestrator(agents, {
    rolesDistribution: cfg.rolesDistribution,
    phaseTimings: cfg.phaseTimings,
    maxSpeechesPerPhase: cfg.maxSpeechesPerPhase,
    speechIntervalMs: 800
  }, emitter);

  const result = await orchestrator.run();

  // Build & persist archive
  const archiveOut = await buildAndPersistArchive(result.archive, {
    uploadToZeroG: process.env.SKIP_OG_STORAGE !== "1",
    localDir: "./archives",
    rpcUrl: cfg.ogRpcUrl,
    privateKey: cfg.gmPrivateKey,
    storageIndexer: cfg.ogStorageIndexer
  });

  log.info({ merkleRoot: archiveOut.merkleRoot, storageRoot: archiveOut.storageRoot }, "archive built");

  // Commit onchain (skip if zero address — i.e., contracts not deployed yet)
  const archiveAddr = cfg.deployments.GameArchive;
  if (process.env.SKIP_ONCHAIN === "1") {
    log.info("SKIP_ONCHAIN=1 — skipping chain commits");
    emitter.emit("archive_committed", {
      gameId: result.gameId,
      merkleRoot: archiveOut.merkleRoot,
      storageRoot: archiveOut.storageRoot,
      note: "onchain commit skipped (SKIP_ONCHAIN=1)"
    });
  } else if (archiveAddr && archiveAddr !== "0x0000000000000000000000000000000000000000") {
    try {
      const chain = makeChainClient(cfg);
      const gameIdHex = ("0x" + keccak256(toUtf8Bytes(result.gameId)).slice(2)) as Hex;
      const winnerCode = result.winner === "WOLVES" ? 0 : 1;
      const participants = result.finalPlayers.map((p) => BigInt(p.agentId));

      const txHash = await chain.commitArchive({
        gameId: gameIdHex,
        merkleRoot: archiveOut.merkleRoot,
        storageRoot: archiveOut.storageRoot,
        participants,
        startedAt: BigInt(Math.floor(result.startTs / 1000)),
        endedAt: BigInt(Math.floor(result.endTs / 1000)),
        winner: winnerCode as 0 | 1
      });

      const roles = result.finalPlayers.map((p) => roleToCode(p.role));
      const outcomes = result.finalPlayers.map((p) => {
        const wolfWon = result.winner === "WOLVES";
        const isWolf = p.role === "WEREWOLF";
        const won = (wolfWon && isWolf) || (!wolfWon && !isWolf);
        return won ? 1 : 0;
      });
      const eliminatedByVote = result.finalPlayers.map((p) => p.eliminatedByVote);
      const killedByWolves = result.finalPlayers.map((p) => p.killedByWolves);

      const repTxHash = await chain.recordBatch({
        gameId: gameIdHex,
        agentIds: participants,
        roles,
        outcomes,
        eliminatedByVote,
        killedByWolves
      });

      emitter.emit("archive_committed", {
        gameId: result.gameId,
        merkleRoot: archiveOut.merkleRoot,
        storageRoot: archiveOut.storageRoot,
        archiveTxHash: txHash,
        reputationTxHash: repTxHash,
        explorer: `https://chainscan-galileo.0g.ai/tx/${txHash}`
      });

      log.info({ archiveTx: txHash, repTx: repTxHash }, "onchain commits done");
    } catch (e) {
      log.error({ err: String(e) }, "onchain commit failed (game still complete)");
    }
  } else {
    log.warn("contracts not deployed; skipping onchain commit");
    emitter.emit("archive_committed", {
      gameId: result.gameId,
      merkleRoot: archiveOut.merkleRoot,
      storageRoot: archiveOut.storageRoot,
      note: "contracts not deployed"
    });
  }

  log.info("=================================");
  log.info(`GAME COMPLETE: ${result.winner} won in ${result.turns.length} turns`);
  log.info(`Archive: ${archiveOut.localPath}`);
  if (axlMirror) {
    log.info("AXL mirror was active — check axl-witness logs for received envelopes.");
  }
  log.info("Press Ctrl+C to stop the spectator server.");

  // Keep server alive so dashboard stays connected
  if (process.env.EXIT_AFTER_GAME === "1") {
    await new Promise((r) => setTimeout(r, 2000));
    await spectator.stop();
    process.exit(0);
  }
}

function roleToCode(role: Role): number {
  switch (role) {
    case "WEREWOLF":
      return 1;
    case "VILLAGER":
      return 2;
    case "SEER":
      return 3;
  }
}

main().catch((err) => {
  log.error({ err: String(err), stack: (err as Error)?.stack }, "fatal error");
  process.exit(1);
});
