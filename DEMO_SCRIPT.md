# Demo Video Script (3 minutes)

> Single-take screen recording with voice-over. Edit cuts only for transitions.

## Setup before recording
- [ ] GameMaster running (`pnpm dev` in `gamemaster/`)
- [ ] Browser open at http://localhost:3030
- [ ] Browser zoomed to 110-125% so text is readable in 1080p
- [ ] OBS or similar recorder set to 1920x1080, 30 fps
- [ ] Wallet has ≥1 OG remaining for live tx during demo
- [ ] Real 0G Compute LLM working (not mock)

## Beat-by-beat (target 2:50)

### 0:00–0:20 — Hook
**Visual:** dashboard idle screen with title "Agent Werewolf — 8 AI agents playing Werewolf together"

**VO:**
> "These 8 AI agents are about to play Werewolf. Two are wolves. None of them know who else is alive yet. None of their decisions live on a server you have to trust — every move is committed onchain. Watch."

### 0:20–0:50 — The problem
**Visual:** Quick architecture slide (made beforehand) showing centralized server with red X, then resolving to onchain commits.

**VO:**
> "Multi-agent games on a central server have a fatal flaw: the server knows everything. It knows who the wolves are. That's not a game — that's a puppet show. We built Agent Werewolf so every move is committed to a smart contract on 0G testnet. Anyone can verify any game move-by-move."

### 0:50–2:00 — Live game
**Visual:** Trigger game start. Dashboard plays at real speed.

Show: 8 avatars, phase indicator, speech bubbles popping with persona names ("The Paranoid: ..."), votes appearing, elimination overlay, new night, second elimination, GAME END "WOLVES WIN".

**VO (timed):**
> "Here's a live game. 8 agents — five distinct personas plus two variants. Roles assigned randomly. The wolves coordinate at night. The seer investigates one player. Day phase: each agent generates an in-character speech using 0G Compute Sealed Inference — that's an LLM running in a verified TEE. Vote phase: each agent submits a signed vote. The wolves blend in or accuse the seer. Game ends — wolves win in turn 3."

### 2:00–2:30 — The reveal
**Visual:** scroll the events feed, show the "Archive committed" event with chainscan link. Click the link, open chainscan tab.

**VO:**
> "When the game ends, every event — every speech, every vote, every kill — gets hashed into a Merkle tree. The root is committed onchain. Here it is, on Galileo testnet. Anyone can verify the entire game by reproducing the Merkle root from the archive JSON."

### 2:30–2:45 — Reputation
**Visual:** show contract on chainscan (ReputationOracle), click "Read", call `getStats(1)` and show updated stats.

**VO:**
> "Each agent's stats are also recorded onchain. Win rate, role distribution, eliminations — all verifiable."

### 2:45–3:00 — Wrap
**Visual:** GitHub org page, then end card.

**VO:**
> "Eight repos on GitHub. Three deployed contracts. A working demo you can run yourself. This is Agent Werewolf — verifiable autonomous agents, built on 0G."

End card: project name, GitHub URL, "Built solo for ETHGlobal Open Agents".

## Recording checklist
- [ ] Start screen recording
- [ ] Open browser at dashboard
- [ ] Trigger game (in terminal: `pnpm dev` will auto-run a game)
- [ ] Wait for game to complete (2-5 min with real LLM)
- [ ] Show chainscan tx
- [ ] Show contract reputation read
- [ ] Stop recording
- [ ] Edit: cut to <3:00, add VO, no music or minimal ambient

## Submission upload
- [ ] Upload to YouTube as "Unlisted"
- [ ] Add link to ETHGlobal submission form
- [ ] Add to README under "Demo video"
- [ ] Add to SUBMISSION.md
