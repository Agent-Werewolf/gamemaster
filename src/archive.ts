// Archive: build canonical JSON, compute Merkle root, optionally upload to 0G Storage.
import { keccak256, toUtf8Bytes } from "ethers";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MerkleTree } from "merkletreejs";
import type { GameArchiveJSON } from "./types.js";
import { log } from "./log.js";

export interface ArchiveOutput {
  archive: GameArchiveJSON;
  json: string;
  merkleRoot: `0x${string}`;
  storageRoot: `0x${string}`;
  storageTxHash?: `0x${string}`;
  localPath?: string;
}

export async function buildAndPersistArchive(
  archive: GameArchiveJSON,
  opts: { uploadToZeroG: boolean; localDir?: string; rpcUrl?: string; privateKey?: string; storageIndexer?: string }
): Promise<ArchiveOutput> {
  // Compute Merkle root over canonical leaves: each turn's events as ordered hashes
  const leaves = canonicalLeaves(archive);
  const tree = new MerkleTree(leaves, (data: Buffer) => Buffer.from(keccak256(data).slice(2), "hex"), {
    sortPairs: true
  });
  const merkleRoot = ("0x" + tree.getRoot().toString("hex")) as `0x${string}`;
  archive.merkleRoot = merkleRoot;

  const json = JSON.stringify(archive, null, 2);

  // Always persist locally
  let localPath: string | undefined;
  if (opts.localDir) {
    if (!existsSync(opts.localDir)) mkdirSync(opts.localDir, { recursive: true });
    localPath = join(opts.localDir, `${archive.gameId}.json`);
    writeFileSync(localPath, json, "utf-8");
    log.info({ localPath, bytes: json.length }, "archive persisted locally");
  }

  let storageRoot: `0x${string}` = ("0x" + "00".repeat(32)) as `0x${string}`;
  let storageTxHash: `0x${string}` | undefined;

  if (opts.uploadToZeroG && opts.rpcUrl && opts.privateKey && opts.storageIndexer) {
    try {
      const { rootHash, txHash } = await uploadToZeroG(json, opts);
      storageRoot = rootHash;
      storageTxHash = txHash;
      log.info({ storageRoot, storageTxHash }, "archive uploaded to 0G Storage");
    } catch (e) {
      log.warn({ err: String(e) }, "0G Storage upload failed; storageRoot=0x00, archive only available locally");
    }
  }

  return { archive, json, merkleRoot, storageRoot, storageTxHash, localPath };
}

function canonicalLeaves(archive: GameArchiveJSON): Buffer[] {
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
  // Final outcome leaf
  leaves.push(hashLeaf({ kind: "outcome", winner: archive.winner, gameId: archive.gameId }));
  return leaves;
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

async function uploadToZeroG(
  json: string,
  opts: { rpcUrl?: string; privateKey?: string; storageIndexer?: string }
): Promise<{ rootHash: `0x${string}`; txHash: `0x${string}` }> {
  const { Indexer, ZgFile } = await import("@0glabs/0g-ts-sdk");
  const { JsonRpcProvider, Wallet } = await import("ethers");
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const provider = new JsonRpcProvider(opts.rpcUrl);
  const signer = new Wallet(opts.privateKey!, provider);
  const indexer = new Indexer(opts.storageIndexer!);

  // 0g-ts-sdk requires a file path, not a buffer
  const tmpDir = mkdtempSync(join(tmpdir(), "werewolf-archive-"));
  const tmpPath = join(tmpDir, "archive.json");
  writeFileSync(tmpPath, json, "utf-8");

  try {
    const file = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr || !tree) throw new Error(`merkleTree: ${treeErr}`);
    const rootHash = tree.rootHash() as `0x${string}`;

    const result: unknown = await indexer.upload(file, opts.rpcUrl!, signer as any);
    // result shape: [txHash, err] in older versions; { txHash, ... } in newer
    let txHash: string;
    if (Array.isArray(result)) {
      const [tx, err] = result as [unknown, unknown];
      if (err) throw new Error(`upload: ${String(err)}`);
      txHash = String(tx);
    } else {
      txHash = String((result as { txHash?: unknown })?.txHash ?? "");
    }
    if (!txHash) throw new Error("upload returned no txHash");

    await file.close();
    return { rootHash, txHash: txHash as `0x${string}` };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
