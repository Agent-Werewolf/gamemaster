# ETHGlobal Open Agents — Submission Package

## Project name
**Agent Werewolf**

## One-line pitch
A fully autonomous social-deduction game where AI agents play Werewolf with persistent identity, verifiable game archives, and reputation on 0G testnet.

## Project description (250 words)
Multi-agent games on a centralized server have a fundamental integrity problem: the server knows everything, including which players are werewolves. Agent Werewolf demonstrates that real social-deduction gameplay is possible when agents play with cryptographically committed game records — every speech, vote, and elimination gets hashed into a Merkle tree and the root is committed onchain.

**Architecture:**
- 8 LLM-driven AI agents with distinct personas (Paranoid, Manipulator, Analyst, Accuser, Peacemaker, plus 2 variants and 1 repeat) play a complete Werewolf game in 3-5 turns
- Each agent generates speeches and votes via **0G Compute Sealed Inference** (TEE-verified LLM, not a black-box server)
- Agent identity is registered onchain via an ERC-8004 inspired `AgentRegistry`
- Game outcomes are recorded in `ReputationOracle` (per-agent stats: games played, wins, role-specific records)
- Every game's full event log is bundled into a JSON archive, Merkle-rooted, and committed via `GameArchive.commitArchive`
- Optional: archive uploaded to 0G Storage with retrievable storage root

**What's deployed:**
- 3 contracts on **0G Galileo testnet** (chain `16602`):
  - `AgentRegistry`: [`0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d`](https://chainscan-galileo.0g.ai/address/0x4BAcF8f6D981F5e06462646e85053BD5adF3fb4d)
  - `ReputationOracle`: [`0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1`](https://chainscan-galileo.0g.ai/address/0x5C8061694C8c1b4A2aB39762754D9a0DC549fBB1)
  - `GameArchive`: [`0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764`](https://chainscan-galileo.0g.ai/address/0x6a9aff1F4352648b39De2771A1Ed3f0F85E9D764)
- 8 GitHub repos under [github.com/Agent-Werewolf](https://github.com/Agent-Werewolf)
- TypeScript GameMaster service (Node 22)
- Static HTML spectator dashboard with WebSocket live feed

## Tracks
- **0G Track A: Framework & Tooling** — Full 0G stack: Compute (Sealed Inference) + Storage (archive upload) + Chain (3 contracts deployed)
- **0G Track B: Autonomous Agents** — 7 distinct LLM personas, role-agnostic, fully autonomous decision-making per phase

## Live demo
- **Spectator dashboard (live replay):** https://agent-werewolf.vercel.app
- Source code: https://github.com/Agent-Werewolf
- Local instructions: see [README.md](./README.md)

## Demo video
[Link TBD]

## Team
Solo (Albary)

## What works end-to-end
- ✅ 8 LLM agents play full Werewolf game (3-5 turns)
- ✅ **Real LLM speeches** via 0G Compute Sealed Inference (qwen-2.5-7b-instruct, ~4 min/game)
- ✅ Game outcomes commit onchain (real Galileo testnet txs — verifiable on chainscan)
- ✅ Reputation tracking per agent onchain (per-role stats)
- ✅ Archive Merkle root deterministic and verifiable (verify-archive script provided)
- ✅ Live WebSocket spectator dashboard (animated speech bubbles, vote tally, elimination overlay)
- ✅ Mock LLM mode for offline reproducibility (each persona has 8 unique pre-written speeches)
- ✅ Rate limiter for 0G Compute (10 req/min cap)

## What's stubbed
- Gensyn AXL multi-node P2P (binary built locally and tested running, but in-process orchestration used for v1 to ship in 15h)
- Python SDK and external-agent SDK (conceived in spec, not implemented)
- 0G Storage upload (code path implemented but skipped in v1 to conserve testnet OG)

## Onchain proof points (all on 0G Galileo testnet)
| Tx | Game | Description |
|---|---|---|
| [0x87e2b486...](https://chainscan-galileo.0g.ai/tx/0x87e2b48617cf01068949e0e3b743af4e15b78d0de673452d75a81cdcfcf1cfc6) | **Real 0G Compute LLM** game (`1f189edc...`) | Archive commit, VILLAGERS won 3 turns, mined block 31260823 |
| [0x1efda2d5...](https://chainscan-galileo.0g.ai/tx/0x1efda2d576f5f5e75f02fbfbd0ae3d50e0fe7d9b4c0259f6058e6d86dd858cbe) | Mock LLM game (`dac8cc4d...`) | Archive commit, WOLVES won |
| [0xeb67fecc...](https://chainscan-galileo.0g.ai/tx/0xeb67fecc7da2831d7e4a230544f8d98f198dfdac62a8e10dcf88386851b7e3d9) | Mock LLM game (`dac8cc4d...`) | Reputation batch (8 agents) |
| [0x4b163cc9...](https://chainscan-galileo.0g.ai/tx/0x4b163cc9ce28c49f8e6424b34cc5deac936ecfa0eb11516ebbc93a73f5d6fe12) | Mock LLM game (`e4bf8e61...`) | Archive commit, WOLVES won |

## Verification
Anyone can:
1. Pull a game archive JSON from `archives/<gameId>.json`
2. Reproduce the Merkle root by hashing each event in canonical JSON form
3. Compare to onchain via `GameArchive.getArchive(gameId).merkleRoot`

If they match, the game record is provably untampered.
