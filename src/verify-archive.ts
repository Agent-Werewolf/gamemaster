// Standalone verification script.
// Usage: pnpm tsx src/verify-archive.ts archives/<gameId>.json
//
// Reads a game archive JSON, recomputes the Merkle root from its events,
// fetches the onchain commit from GameArchive, and reports whether they match.

import { readFileSync, existsSync } from "node:fs";
import { keccak256, toUtf8Bytes, JsonRpcProvider } from "ethers";
import { Contract } from "ethers";
import { MerkleTree } from "merkletreejs";
import type { GameArchiveJSON } from "./types.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: pnpm tsx src/verify-archive.ts <archive.json>");
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }

  const archive: GameArchiveJSON = JSON.parse(readFileSync(path, "utf-8"));
  console.log(`\n=== Verifying archive: ${path} ===`);
  console.log(`Game ID:  ${archive.gameId}`);
  console.log(`Winner:   ${archive.winner}`);
  console.log(`Players:  ${archive.players.length}`);
  console.log(`Turns:    ${archive.turns.length}`);

  // 1. Recompute local Merkle root
  const localRoot = recomputeMerkleRoot(archive);
  console.log(`\nLocal Merkle root:  ${localRoot}`);
  console.log(`Stored in archive:  ${archive.merkleRoot}`);
  if (localRoot.toLowerCase() !== archive.merkleRoot.toLowerCase()) {
    console.error("\n❌ MISMATCH: archive's stored root != recomputed root");
    process.exit(2);
  }
  console.log("✅ Local roots match (archive is internally consistent)");

  // 2. Fetch onchain root
  const cfg = loadConfig();
  const provider = new JsonRpcProvider(cfg.ogRpcUrl);
  const archiveAddr = cfg.deployments.GameArchive;
  if (!archiveAddr || archiveAddr === "0x0000000000000000000000000000000000000000") {
    console.warn("\n⚠️  No GameArchive address configured. Skipping onchain check.");
    process.exit(0);
  }

  const abi = [
    "function getArchive(bytes32) view returns (tuple(bytes32 gameId, bytes32 merkleRoot, bytes32 storageRoot, uint256[] participants, uint64 startedAt, uint64 endedAt, uint8 winner))"
  ];
  const contract = new Contract(archiveAddr, abi, provider);

  const gameIdHex = "0x" + keccak256(toUtf8Bytes(archive.gameId)).slice(2);
  console.log(`\nFetching from chain (gameId hash: ${gameIdHex})...`);
  try {
    const onchain = await contract.getArchive(gameIdHex);
    console.log(`Onchain Merkle root: ${onchain.merkleRoot}`);
    if (onchain.merkleRoot.toLowerCase() !== archive.merkleRoot.toLowerCase()) {
      console.error("\n❌ MISMATCH: onchain root != archive root");
      console.error("This archive does NOT match what was committed onchain.");
      process.exit(2);
    }
    console.log("✅ Onchain root matches");
    console.log(`\n🎉 ARCHIVE VERIFIED — game is provably untampered.`);
    console.log(`Winner: ${archive.winner === "WOLVES" ? "🐺 WOLVES" : "👥 VILLAGERS"}`);
    console.log(`Onchain participants: ${onchain.participants.map((p: bigint) => p.toString()).join(", ")}`);
  } catch (e) {
    console.error(`\n❌ Onchain lookup failed: ${(e as Error).message}`);
    console.error("This game may not have been committed onchain yet.");
    process.exit(3);
  }
}

function recomputeMerkleRoot(archive: GameArchiveJSON): string {
  const leaves: Buffer[] = [];
  for (const turn of archive.turns) {
    if (turn.night.kill) {
      leaves.push(hashLeaf({ kind: "kill", turn: turn.turn, ...turn.night.kill }));
    }
    if (turn.night.investigation) {
      leaves.push(hashLeaf({ kind: "investigate", turn: turn.turn, ...turn.night.investigation }));
    }
    for (const speech of turn.day.speeches) {
      leaves.push(hashLeaf({ kind: "speech", ...speech }));
    }
    for (const vote of turn.day.votes) {
      leaves.push(hashLeaf({ kind: "vote", ...vote }));
    }
    if (turn.day.eliminated !== null) {
      leaves.push(hashLeaf({ kind: "elimination", turn: turn.turn, eliminated: turn.day.eliminated }));
    }
  }
  leaves.push(hashLeaf({ kind: "outcome", winner: archive.winner, gameId: archive.gameId }));

  const tree = new MerkleTree(leaves, (data: Buffer) => Buffer.from(keccak256(data).slice(2), "hex"), {
    sortPairs: true
  });
  return "0x" + tree.getRoot().toString("hex");
}

function hashLeaf(value: object): Buffer {
  const canonical = JSON.stringify(sortKeysDeep(value));
  return Buffer.from(keccak256(toUtf8Bytes(canonical)).slice(2), "hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = sortKeysDeep(obj[k]);
  return sorted;
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
