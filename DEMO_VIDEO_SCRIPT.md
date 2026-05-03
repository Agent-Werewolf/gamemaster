# Agent Werewolf — Demo Video Script v2 (3 minutes)

**Tool:** OBS Studio / Loom / CapCut for editing — free, simple.
**Length target:** 2:55.
**Output:** unlisted YouTube link OR Loom share link → paste in `SUBMISSION.md`.

> ⚠️ Don't try to live-record a real game over the script. The real LLM
> game is rate-limited (~4 min). Pre-record one full successful game,
> THEN voice-over the edited footage.

---

## Pre-recording prep checklist

- [ ] Run one successful game with `LLM_MODE` real, AXL nodes up, archive uploaded onchain
- [ ] Capture raw video of the dashboard playback (record full ~3 min run, you'll edit later)
- [ ] Capture AXL witness terminal — `tail -f gamemaster/logs/witness-fullstack.log` showing envelopes streaming with `✓sig`
- [ ] Pre-open browser tabs:
  1. Dashboard: https://agent-werewolf.vercel.app
  2. Archive commit tx: https://chainscan-galileo.0g.ai/tx/0x8d63b8fb675cf3d771b4946dc375e1449fc5e116bb22b8bebb1e0641d66d142a
  3. Reputation tx: https://chainscan-galileo.0g.ai/tx/0x805165a900b4013d681a7203d5162be2142aadbd6b3cddd484eaa1c63edf9146
  4. GitHub org: https://github.com/Agent-Werewolf
- [ ] Architecture diagram slide (1 PNG/PDF — see template below)
- [ ] `verify-archive` script ready to run in terminal
- [ ] Disable notifications (Slack, Discord, mail)
- [ ] Browser zoom 110% so text is readable
- [ ] Remove any personal info from screen
- [ ] Verify https://agent-werewolf.vercel.app loads in **incognito** (Vercel Auth disabled)

---

## Architecture diagram (1 slide)

Make a quick slide with these 4 boxes:

```
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│ 0G COMPUTE  │  │ GENSYN AXL   │  │ 0G CHAIN     │  │ 0G STORAGE  │
│ Sealed      │  │ P2P Mesh     │  │ AgentRegistry│  │ Archive     │
│ Inference   │  │ TLS-peered   │  │ Reputation   │  │ JSON upload │
│ qwen-2.5-7b │  │ ed25519 sigs │  │ GameArchive  │  │ Merkle root │
└─────────────┘  └──────────────┘  └──────────────┘  └─────────────┘
       ▲                ▲                  ▲                ▲
       └────────────────┴──────────────────┴────────────────┘
                              │
                       ┌──────┴───────┐
                       │  Agent       │
                       │  Werewolf    │
                       │  (8 LLMs)    │
                       └──────────────┘
```

Render in any tool — Figma, Canva, even Google Slides screenshot. Just needs to be readable in 5 seconds.

---

## Beat structure (2:55 total)

### 0:00 – 0:15 — Hook (15 s)
**Visual**: full dashboard, 8 agent avatars, dramatic dark mode header.

**VO** (English so judges understand):
> "Eight AI agents. Two are werewolves. They're about to play a full social-deduction game — and every move they make is verifiable onchain. No trusted server. No black-box LLM. Watch."

### 0:15 – 0:40 — Architecture (25 s)
**Visual**: architecture diagram slide. Flash for 5 s, then zoom into each box (5 s each).

**VO**:
> "Multi-agent games have a trust problem — centralized servers know everything, including who the wolves are. Agent Werewolf runs on four pieces of infrastructure: **0G Compute** for sealed-inference LLM speeches in a TEE; **Gensyn AXL** for peer-to-peer event broadcast across separate nodes; **0G Chain** for agent identity, reputation, and Merkle commits; and **0G Storage** for the full game archive."

### 0:40 – 1:50 — Live game compressed (70 s)
**Visual**: pre-recorded dashboard playback at **2× speed**. Subtle "▶▶ 2×" overlay so judges know. Highlight visually:
- Speech bubbles popping in (cut to 4–5 best persona lines)
- Vote tally panel updating
- Night kill overlay with role reveal
- "GAME END – WOLVES WIN" / "VILLAGERS WIN" banner

**VO** (timed to footage):
> "Here's a complete game. Eight agents — five distinct persona archetypes plus three behavioral variants. Every speech you see is generated via 0G Compute Sealed Inference: real LLM output verified by a Trusted Execution Environment, not a black-box server. The wolves coordinate at night. The seer investigates. Day phase: public accusations. Vote phase: signed votes. Elimination. Repeat. The game ends when one side is eliminated."

### 1:50 – 2:15 — Gensyn AXL P2P proof (25 s)
**Visual**: SPLIT SCREEN. Left: dashboard final state. Right: terminal showing `tail -f` of `gamemaster/logs/witness-fullstack.log`. Then ZOOM into the witness terminal showing lines like:

```
[2026-05-03T13:22:54Z] #001 PHASE_END    from=peer:3588290af988… ✓sig gameId=91f716b9 bytes=340
[2026-05-03T13:23:40Z] #002 PHASE_START  from=peer:3588290af988… ✓sig gameId=91f716b9 bytes=376
[2026-05-03T13:23:48Z] #003 DAY_SPEECH   from=peer:3588290af988… ✓sig gameId=91f716b9 bytes=428
…
```

Highlight `✓sig` with a callout.

**VO**:
> "Every event also broadcasts across two TLS-peered Gensyn AXL nodes. A separate witness process on the destination node verifies each signed envelope independently of the GameMaster. Twenty-two envelopes per game, all signed, all verified across the Yggdrasil mesh. AXL is the decentralized witness layer — not a single source of truth."

### 2:15 – 2:45 — Onchain + Storage proof (30 s)
**Visual**: Switch to chainscan tab. Show the `commitArchive` tx, point to:
- `merkleRoot` field
- `storageRoot` field

Then switch to terminal and run:
```bash
pnpm tsx src/verify-archive.ts archives/91f716b9-ddb0-4326-a65b-9cf55363c810.json
```
Output: `✓ Merkle root matches onchain commit`

**VO**:
> "When the game ends, every event hashes into a Merkle tree. The root is committed to the GameArchive contract on 0G Galileo. The full JSON archive is uploaded to 0G Storage with the storage root committed alongside. Anyone can pull the archive, recompute the Merkle root, and prove the game record is untampered."

### 2:45 – 2:55 — Reputation + close (10 s)
**Visual**: Quick flash of `ReputationOracle` chainscan page, then cut to https://github.com/Agent-Werewolf showing 8 repos.

**VO**:
> "Per-agent reputation tracked onchain across games. Eight repos, three deployed contracts. Verifiable autonomous agents on 0G — built solo for ETHGlobal Open Agents. Thanks for watching."

End card: project logo + URL.

---

## Recording technique

1. **Record screen + system audio** with OBS or QuickTime
2. **VO recorded SEPARATELY** in a quiet room — overlay onto the edit
3. Use the dashboard playback as B-roll — slow down or speed up sections to match VO timing
4. **2× speedup** is fine for discussion phases — judges expect compression
5. Don't worry about transitions — straight cuts are fine. Polish costs hours.

## Editing in CapCut / iMovie (free)

1. Drop dashboard recording on track 1
2. Drop AXL terminal recording on track 2 (split screen for AXL beat)
3. Drop chainscan tab recording on track 3 (for onchain beat)
4. VO audio on track 4
5. Architecture diagram slide as overlay at 0:15
6. Export 1080p MP4

## Post-recording

1. Upload to **Loom** (fastest, auto share link) or YouTube unlisted
2. Edit `SUBMISSION.md` line 39: replace `[Link TBD]` with the link
3. `cd gamemaster && git add SUBMISSION.md && git commit -m "docs: add demo video link" && git push`
4. Submit on ETHGlobal

## Backup option if recording fails

- Loom auto-records video + audio, share link in 30 seconds
- If audio is bad, re-record JUST the audio in a separate clip
- Worst case: silent screen capture with on-screen captions reading the script — judges can read

## Coverage matrix (each track must be VISIBLE in video)

| Track | Required visual | Where in script |
|-------|------------------|------------------|
| 0G Track A: Framework | 0G Compute LLM speeches + 0G Storage upload + 0G Chain commits | 0:15-0:40 architecture, 0:40-1:50 game, 2:15-2:45 onchain |
| 0G Track B: Autonomous Agents | 8 distinct personas with real LLM speeches | 0:40-1:50 game playback |
| Gensyn AXL | 2 separate AXL nodes, witness verifies envelopes across them | **1:50-2:15 (dedicated AXL beat)** |

Without all three visible in the video, judges can't validate the SUBMISSION.md claims.
