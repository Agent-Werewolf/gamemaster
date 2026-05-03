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
| `src/transport.ts` | Envelope canonical signing (for future P2P) |
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

## Onchain proof (Galileo testnet)
- AgentRegistry: [`0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d`](https://chainscan-galileo.0g.ai/address/0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d)
- ReputationOracle: [`0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1`](https://chainscan-galileo.0g.ai/address/0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1)
- GameArchive: [`0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764`](https://chainscan-galileo.0g.ai/address/0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764)

## License
MIT.
