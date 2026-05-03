// Transport layer: envelope canonical signing + delivery.
// v1: in-process delivery (agents share memory); designed so swapping to AXL
// or HTTP later only requires swapping the `Transport.send` impl.

import { keccak256, toUtf8Bytes, getBytes, verifyMessage, Wallet } from "ethers";
import { v4 as uuidv4 } from "uuid";
import type { MessageEnvelope, MessageType } from "./types.js";

export function canonicalize(env: Omit<MessageEnvelope, "sig">): string {
  // Alphabetical key order over top-level. Payload uses JSON.stringify with
  // sorted keys recursively for deterministic hash.
  const ordered = {
    from: env.from,
    gameId: env.gameId,
    nonce: env.nonce,
    payload: sortKeysDeep(env.payload),
    to: env.to,
    ts: env.ts,
    type: env.type,
    v: env.v
  };
  return JSON.stringify(ordered);
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortKeysDeep(obj[k]);
  }
  return sorted;
}

export async function signEnvelope(env: Omit<MessageEnvelope, "sig">, wallet: Wallet): Promise<MessageEnvelope> {
  const canonical = canonicalize(env);
  const messageHash = keccak256(toUtf8Bytes(canonical));
  const sig = await wallet.signMessage(getBytes(messageHash));
  return { ...env, sig } as MessageEnvelope;
}

export function verifyEnvelope(env: MessageEnvelope, expectedSigner: string): boolean {
  const { sig, ...rest } = env;
  const canonical = canonicalize(rest);
  const messageHash = keccak256(toUtf8Bytes(canonical));
  try {
    const recovered = verifyMessage(getBytes(messageHash), sig);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}

export function makeEnvelope(args: {
  type: MessageType;
  gameId: string | null;
  from: number;
  to: number | "broadcast";
  payload: Record<string, unknown>;
}): Omit<MessageEnvelope, "sig"> {
  return {
    v: 1,
    type: args.type,
    gameId: args.gameId,
    from: args.from,
    to: args.to,
    ts: Date.now(),
    nonce: uuidv4().replace(/-/g, ""),
    payload: args.payload
  };
}

// In-process transport: agents subscribe; sends synchronously deliver.
type Handler = (env: MessageEnvelope) => void | Promise<void>;

export class InProcessTransport {
  private handlers = new Map<number | "gm" | "broadcast", Handler[]>();
  private replayCache = new Map<string, number>(); // nonce -> expiry

  on(target: number | "gm", handler: Handler): void {
    const list = this.handlers.get(target) ?? [];
    list.push(handler);
    this.handlers.set(target, list);
  }

  async send(env: MessageEnvelope): Promise<void> {
    // Replay protection
    const cacheKey = `${env.gameId ?? "lobby"}:${env.nonce}`;
    const now = Date.now();
    for (const [k, exp] of this.replayCache) if (exp < now) this.replayCache.delete(k);
    if (this.replayCache.has(cacheKey)) {
      throw new Error(`Replay detected: ${cacheKey}`);
    }
    this.replayCache.set(cacheKey, now + 60_000);

    if (env.to === "broadcast") {
      const broadcast = this.handlers.get("broadcast") ?? [];
      for (const h of broadcast) await h(env);
      // Also fan out to each registered agent
      for (const [k, hs] of this.handlers) {
        if (k === "broadcast" || k === "gm") continue;
        for (const h of hs) await h(env);
      }
    } else if (env.to === 0) {
      const list = this.handlers.get("gm") ?? [];
      for (const h of list) await h(env);
    } else {
      const list = this.handlers.get(env.to) ?? [];
      for (const h of list) await h(env);
    }
  }
}
