// Transport layer: envelope canonical signing + delivery.
// Two implementations:
//   - InProcessTransport: agents share memory (used by game.ts orchestrator)
//   - AxlTransport: real P2P over Gensyn AXL (used by axl-mirror to prove
//     event traffic crosses the Yggdrasil overlay between two AXL nodes)

import { keccak256, toUtf8Bytes, getBytes, verifyMessage, Wallet } from "ethers";
import { v4 as uuidv4 } from "uuid";
import type { MessageEnvelope, MessageType } from "./types.js";
import { log } from "./log.js";

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

// AxlTransport: real P2P over Gensyn AXL.
// Posts envelopes as raw JSON bytes to a local AXL node's /send endpoint,
// destined for a remote AXL peer. Long-polls /recv for inbound envelopes.
//
// Network architecture:
//   GameMaster (this Node.js process)
//      │
//      ├── HTTP POST /send  ──▶ Local AXL node (Node B, "agents-side")
//      │                              │
//      │                              ▼ TLS/Yggdrasil P2P
//      │                        Remote AXL node (Node A, "GM-side")
//      │                              │
//      │   axl-witness.ts polls Node A /recv ──▶ logs envelope arrival
//
// This proves the bytes cross two AXL processes via real P2P, even when the
// gamemaster orchestrator runs in a single Node.js process.

export interface AxlTransportConfig {
  /** Local AXL node HTTP API (e.g. http://127.0.0.1:9103) */
  localApi: string;
  /** Hex-encoded ed25519 public key of the destination AXL peer (64 chars) */
  destPeerId: string;
  /** Optional name for logging */
  label?: string;
  /** Polling interval for /recv in ms (default 500) */
  pollIntervalMs?: number;
}

export class AxlTransport {
  private polling = false;
  private stats = { sent: 0, received: 0, sendErrors: 0 };
  private handlers: Array<(env: MessageEnvelope) => void | Promise<void>> = [];
  private label: string;

  constructor(private cfg: AxlTransportConfig) {
    this.label = cfg.label ?? "axl";
  }

  /** Send a signed envelope to the destination peer over AXL P2P. */
  async send(env: MessageEnvelope): Promise<void> {
    const body = JSON.stringify(env);
    try {
      const res = await fetch(`${this.cfg.localApi}/send`, {
        method: "POST",
        headers: {
          "X-Destination-Peer-Id": this.cfg.destPeerId,
          "Content-Type": "application/octet-stream"
        },
        body
      });
      if (!res.ok) {
        const txt = await res.text();
        this.stats.sendErrors++;
        throw new Error(`AXL /send failed ${res.status}: ${txt}`);
      }
      this.stats.sent++;
      log.debug({ axl: this.label, type: env.type, to: env.to, bytes: body.length, sent: this.stats.sent },
        "[axl] envelope sent over P2P");
    } catch (err) {
      this.stats.sendErrors++;
      log.warn({ axl: this.label, err: String(err) }, "[axl] send failed");
    }
  }

  /** Subscribe to inbound envelopes (polled from local AXL /recv). */
  on(handler: (env: MessageEnvelope) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  /** Start polling local /recv for inbound envelopes. */
  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    const interval = this.cfg.pollIntervalMs ?? 500;
    const loop = async (): Promise<void> => {
      while (this.polling) {
        try {
          const res = await fetch(`${this.cfg.localApi}/recv`);
          if (res.status === 200) {
            const text = await res.text();
            const fromPeer = res.headers.get("x-from-peer-id") ?? "?";
            try {
              const env = JSON.parse(text) as MessageEnvelope;
              this.stats.received++;
              log.info({ axl: this.label, type: env.type, fromPeer: fromPeer.slice(0, 16), recv: this.stats.received },
                "[axl] envelope received over P2P");
              for (const h of this.handlers) await h(env);
            } catch {
              log.warn({ axl: this.label, fromPeer: fromPeer.slice(0, 16) }, "[axl] non-JSON inbound, skipping");
            }
          } else if (res.status !== 204) {
            log.warn({ axl: this.label, status: res.status }, "[axl] unexpected /recv status");
          }
        } catch (err) {
          log.debug({ axl: this.label, err: String(err) }, "[axl] /recv poll error");
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    };
    void loop();
    log.info({ axl: this.label, api: this.cfg.localApi, dest: this.cfg.destPeerId.slice(0, 16) }, "[axl] polling started");
  }

  stop(): void {
    this.polling = false;
  }

  getStats(): { sent: number; received: number; sendErrors: number } {
    return { ...this.stats };
  }
}
