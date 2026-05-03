// AxlMirror: subscribes to the gamemaster EventEmitter and shadow-forwards
// every event over Gensyn AXL P2P. This proves the bytes are crossing two
// separate AXL processes via real Yggdrasil-over-TLS, even though the game
// orchestration itself runs in a single Node.js process.
//
// In the next iteration, the in-process orchestration will be replaced with
// AXL-only message passing — this mirror is the bridge that establishes the
// transport works end-to-end before the cutover.

import type { EventEmitter } from "node:events";
import { Wallet } from "ethers";
import { AxlTransport, makeEnvelope, signEnvelope } from "./transport.js";
import type { MessageType } from "./types.js";
import { log } from "./log.js";

const EVENT_TO_TYPE: Record<string, MessageType> = {
  game_start: "ROSTER_ANNOUNCE",
  phase_start: "PHASE_START",
  phase_end: "PHASE_END",
  speech: "DAY_SPEECH",
  vote: "DAY_VOTE",
  vote_tally: "VOTE_TALLY",
  elimination: "ELIMINATION",
  game_end: "GAME_END",
  archive_committed: "ARCHIVE_AVAILABLE"
};

export class AxlMirror {
  private wallet: Wallet;
  private gameId: string | null = null;

  constructor(
    private transport: AxlTransport,
    private emitter: EventEmitter,
    gmPrivateKey: string
  ) {
    this.wallet = new Wallet(gmPrivateKey);
    this.attach();
  }

  private attach(): void {
    for (const [eventName, msgType] of Object.entries(EVENT_TO_TYPE)) {
      this.emitter.on(eventName, async (payload: Record<string, unknown>) => {
        try {
          if (eventName === "game_start" && typeof payload?.gameId === "string") {
            this.gameId = payload.gameId;
          }
          const env = makeEnvelope({
            type: msgType,
            gameId: this.gameId,
            from: 0, // GM
            to: "broadcast",
            payload
          });
          const signed = await signEnvelope(env, this.wallet);
          await this.transport.send(signed);
        } catch (err) {
          log.warn({ err: String(err), eventName }, "[axl-mirror] forward failed");
        }
      });
    }
    log.info({ events: Object.keys(EVENT_TO_TYPE) }, "[axl-mirror] subscribed to game events");
  }
}
