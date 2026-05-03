# Agent Werewolf — GameMaster

The GameMaster service for [Agent Werewolf](https://github.com/Agent-Werewolf), the multi-agent social-deduction game where AI agents play Werewolf with cryptographically committed game outcomes on 0G testnet.

## What this does

A single Node.js process that:

1. Spawns 8 LLM-driven AI agents with distinct personas (Paranoid, Manipulator, Analyst, Accuser, Peacemaker, plus 2 variants and 1 repeat)
2. Drives a complete Werewolf game through Night → Day-Discussion → Day-Vote → Reveal phases
3. Uses **0G Compute Sealed Inference** (TEE-verified LLM) for every speech and vote decision
4. Bundles the full game log into a Merkle-rooted JSON archive
5. Commits the Merkle root + reputation update onchain (Galileo testnet)
6. Optionally uploads the full archive JSON to **0G Storage**
7. Broadcasts every event live to a WebSocket spectator dashboard

## Architecture

```
   ┌──────────────────────────────────────────────┐
   │           GAMEMASTER (Node.js)               │
   │                                              │
   │   ┌──────────┐  ┌──────────┐  ┌───────────┐  │
   │   │  Agents  │  │   Game   │  │  Archive  │  │
   │   │ (8 LLMs) │→ │  Loop    │→ │  Builder  │  │
   │   └──────────┘  └──────────┘  └───────────┘  │
   │        │              │             │        │
   │        ▼              ▼             ▼        │
   │   ┌──────────┐  ┌──────────┐  ┌───────────┐  │
   │   │  0G      │  │ WebSocket│  │ 0G Chain  │  │
   │   │ Compute  │  │Spectator │  │ + Storage │  │
   │   └──────────┘  └──────────┘  └───────────┘  │
   └──────────────────────────────────────────────┘
```

## Tech stack

- **Node.js 22+** with TypeScript ESM
- **ethers v6** for chain interactions and signing
- **viem** for typed contract reads/writes
- **@0gfoundation/0g-compute-ts-sdk** for Sealed Inference LLM
- **@0glabs/0g-ts-sdk** for storage upload
- **merkletreejs** for archive root computation
- **ws** for spectator WebSocket
- **pino** structured logging

## Quick start

### Prerequisites
- Node 20+ and pnpm
- Wallet with at least 5 OG on 0G Galileo testnet (faucet: https://faucet.0g.ai)
- Contracts deployed (see [Agent-Werewolf/contracts](https://github.com/Agent-Werewolf/contracts))

### Run with mock LLM (free, instant)
```bash
pnpm install
cp .env.example .env
# Edit .env: set GM_PRIVATE_KEY (your funded wallet)
echo "LLM_MODE=mock" >> .env
pnpm dev
```

Then open **http://localhost:3030** to watch the game live.

> **No local setup?** Watch a pre-recorded real game replay at **https://agent-werewolf.vercel.app** — live archive from 0G Compute LLM, committed onchain at block 31260823.

A complete game runs in ~20 seconds with mock LLM and ~3-5 minutes with real 0G Compute.

### Run with real 0G Compute LLM
```bash
# One-time: create 0G Compute ledger account (requires ≥3 OG)
pnpm tsx src/setup-0g.ts

# Remove LLM_MODE from .env so it uses 0G Compute
sed -i '/LLM_MODE/d' .env

pnpm dev
```

## Files

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point — spawns agents, runs game, commits onchain |
| `src/game.ts` | Game orchestrator: phases, win conditions, vote tally |
| `src/agent.ts` | LLM-driven agent with persona prompt |
| `src/personas.ts` | 5 unique personas + 2 variants |
| `src/llm.ts` | LLM client (0G Compute / fallback OpenAI / mock) |
| `src/chain.ts` | viem-based onchain client (registry/reputation/archive) |
| `src/archive.ts` | Merkle root + 0G Storage upload |
| `src/spectator.ts` | WebSocket + static HTML server |
| `src/transport.ts` | Envelope canonical signing + `InProcessTransport` + `AxlTransport` (real Gensyn AXL P2P) |
| `src/axl-mirror.ts` | Subscribes to game emitter and shadow-forwards every event over AXL P2P |
| `src/axl-witness.ts` | Standalone process that polls the destination AXL node's `/recv` and prints/saves every envelope that arrived over Yggdrasil |
| `src/setup-0g.ts` | One-time 0G Compute ledger setup |

## Env vars

| Var | Purpose | Default |
|---|---|---|
| `GM_PRIVATE_KEY` | Wallet signing all chain txs | required |
| `OG_RPC_URL` | 0G Galileo RPC | `https://evmrpc-testnet.0g.ai` |
| `OG_COMPUTE_PROVIDER` | 0G Compute provider address | (Gemma 3 27B) |
| `OG_STORAGE_INDEXER` | 0G Storage indexer URL | turbo testnet |
| `HTTP_PORT` | Dashboard HTTP+WS port | `3030` |
| `DEPLOYMENTS_PATH` | Path to contract addresses JSON | `../contracts/deployments/galileo.json` |
| `LLM_MODE` | `mock` for offline test, unset for 0G | unset |
| `SKIP_OG_STORAGE` | `1` to skip storage upload | unset |
| `EXIT_AFTER_GAME` | `1` to exit after one game | `0` (server stays up) |

## Run with Gensyn AXL P2P transport

Two AXL nodes (Go binary in `../axl/node.exe`) peer over TLS+Yggdrasil; the
gamemaster shadow-forwards every signed game event over the overlay, and a
standalone `axl-witness` process polls the destination node's `/recv` and
prints/saves every envelope it receives.

```bash
# Terminal 1: start AXL node A (GM-side / witness side)
cd ../axl && ./node.exe -config configs/node-a-gm.json

# Terminal 2: start AXL node B (agents-side, dials node A)
cd ../axl && ./node.exe -config configs/node-b-agents.json

# Terminal 3: witness — polls Node A /recv
cd gamemaster && \
  GM_WALLET_ADDR=0xYourGmAddress \
  AXL_WITNESS_API=http://127.0.0.1:9102 \
  pnpm tsx src/axl-witness.ts

# Terminal 4: gamemaster with AXL mirror enabled
cd gamemaster && \
  AXL_TRANSPORT=1 \
  AXL_LOCAL_API=http://127.0.0.1:9103 \
  AXL_DEST_PEER_ID=99cb712e... \
  pnpm dev
```

In a typical 4-turn game the witness receives 50+ signed envelopes
(`PHASE_START`, `DAY_SPEECH`, `DAY_VOTE`, `ELIMINATION`, `GAME_END`,
`ARCHIVE_AVAILABLE`, etc.). Each envelope's `sig` field is verified against
the GM wallet address — `✓sig` in the witness output means the bytes that
crossed the Yggdrasil overlay are byte-identical to what the GM signed.

## Onchain proof (Galileo testnet)
- AgentRegistry: [`0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d`](https://chainscan-galileo.0g.ai/address/0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d)
- ReputationOracle: [`0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1`](https://chainscan-galileo.0g.ai/address/0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1)
- GameArchive: [`0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764`](https://chainscan-galileo.0g.ai/address/0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764)

## Troubleshooting

### `Error: 0G LLM 429 Rate limit exceeded`
The 0G Compute provider caps inference at 10 requests/min. The built-in rate limiter (`src/llm.ts`) sequences calls with a 6.5s gap. If you still see this:
- Make sure only ONE gamemaster process is running (check port 3030)
- Increase `RATE_LIMIT_INTERVAL_MS` in `src/llm.ts`

### `Error: getting signature error` (during processResponse)
This is a non-fatal warning from the 0G Compute SDK's fee accounting. The inference itself succeeds; only the per-call settlement fails. Game continues normally.

### `insufficient funds` during setup
Wallet needs at least 3.1 OG to create the Compute ledger (3 OG + ~0.1 OG gas). Top up via https://faucet.0g.ai or Discord faucet bot.

### Provider not in list
0G's provider list changes. Run `pnpm tsx src/setup-0g.ts` to see current providers, then update `OG_COMPUTE_PROVIDER` in `.env` to one of them.

## Verify any past game

```bash
pnpm tsx src/verify-archive.ts archives/<gameId>.json
```

This recomputes the Merkle root from the archive JSON and compares to the onchain commit. If they match, the game is provably untampered.

## License
MIT.
