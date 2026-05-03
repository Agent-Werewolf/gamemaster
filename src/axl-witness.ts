// axl-witness: standalone process that proves AXL P2P is the actual carrier
// for game events. Run this on the OTHER side of the AXL P2P link from the
// gamemaster. It long-polls its local AXL node's /recv and prints/saves every
// envelope that arrived via the Yggdrasil overlay.
//
// Usage:
//   AXL_WITNESS_API=http://127.0.0.1:9102 \
//   GM_PEER_ID_HEX=99cb712e... \
//   pnpm tsx src/axl-witness.ts
//
// The output is a continuous stream of envelopes that originated in the
// gamemaster process and traversed two AXL processes (TLS + gVisor netstack)
// to reach this witness.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyEnvelope } from "./transport.js";
import type { MessageEnvelope } from "./types.js";

const API = process.env.AXL_WITNESS_API ?? "http://127.0.0.1:9102";
const POLL_MS = Number(process.env.AXL_POLL_MS ?? 400);
const OUT_DIR = process.env.AXL_WITNESS_OUT ?? "./logs/axl-witness";
const GM_ADDR = process.env.GM_WALLET_ADDR; // optional, for sig verification

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const sessionFile = join(OUT_DIR, `session-${Date.now()}.jsonl`);
let count = 0;
let bytesIn = 0;

function ts(): string {
  return new Date().toISOString();
}

console.log(`[axl-witness] polling ${API}/recv every ${POLL_MS}ms`);
console.log(`[axl-witness] writing inbound envelopes to ${sessionFile}`);
console.log(`[axl-witness] press Ctrl+C to stop\n`);

async function pollOnce(): Promise<void> {
  try {
    const res = await fetch(`${API}/recv`);
    if (res.status === 204) return;
    if (res.status !== 200) {
      console.error(`[axl-witness] unexpected status ${res.status}`);
      return;
    }
    const text = await res.text();
    const fromPeer = res.headers.get("x-from-peer-id") ?? "?";
    bytesIn += text.length;
    let env: MessageEnvelope;
    try {
      env = JSON.parse(text) as MessageEnvelope;
    } catch {
      console.warn(`[axl-witness] non-JSON inbound (${text.length}B) from ${fromPeer.slice(0, 16)}`);
      return;
    }
    count += 1;
    const sigOk = GM_ADDR ? verifyEnvelope(env, GM_ADDR) : null;
    const sigBadge = sigOk === null ? "" : sigOk ? " ✓sig" : " ✗sig";
    console.log(
      `[${ts()}] #${String(count).padStart(3, "0")} ${env.type.padEnd(20)} ` +
        `from=peer:${fromPeer.slice(0, 12)}…${sigBadge} ` +
        `gameId=${env.gameId?.slice(0, 8) ?? "—"} bytes=${text.length}`
    );
    writeFileSync(
      sessionFile,
      JSON.stringify({ recvAt: Date.now(), fromPeer, sigOk, env }) + "\n",
      { flag: "a" }
    );
  } catch (err) {
    console.error(`[axl-witness] poll error: ${String(err)}`);
  }
}

setInterval(() => {
  void pollOnce();
}, POLL_MS);

process.on("SIGINT", () => {
  console.log(`\n[axl-witness] received ${count} envelopes, ${bytesIn} bytes total`);
  console.log(`[axl-witness] session log: ${sessionFile}`);
  process.exit(0);
});
