# Demo Recording — Quick Guide

## Pre-recording checklist (5 min)

```bash
# 1. Stop any running gamemaster
# (use PowerShell)
$pids = (Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($pids) { foreach ($p in $pids) { Stop-Process -Id $p -Force } }

# 2. Verify wallet has OG for chain commits (need ~0.05+ OG)
wsl -d Ubuntu -- bash -lc '$HOME/.foundry/bin/cast balance 0x1185948280B230460437Ad09a97618B51Dd8C45d --rpc-url https://evmrpc-testnet.0g.ai --ether'

# 3. Set env for full real run (real LLM + storage + chain)
cd "D:/Belajar/Hackacton/Agent Werewolf/gamemaster"
# Edit .env: remove SKIP_OG_STORAGE and SKIP_ONCHAIN lines
# Keep EXIT_AFTER_GAME=1 so server exits after game

# 4. Start fresh recording session
# Open OBS / Win+G recorder, set source to your browser window
# 1920x1080, 30fps, MP4 output
```

## Recording flow (3 min target)

1. **Start recording**
2. Browser tab: http://localhost:3030 (empty dashboard)
3. **Voice intro:** "These 8 AI agents are about to play Werewolf. Watch."
4. Switch to terminal — run `pnpm dev` in `gamemaster/`
5. Switch back to browser — agents render, phase indicator shows Night 1
6. Speech bubbles start appearing (~3-5s apart due to LLM latency)
7. Voice over speeches as they appear ("The Paranoid: ...")
8. Game ends — "WOLVES WIN" / "VILLAGERS WIN" overlay
9. Scroll to "Archive committed" event with chainscan link
10. Click chainscan link — show real onchain transaction
11. **Stop recording**

## Editing tips

- Cut to <3:00
- Add 1-line captions for each speech (international viewers)
- Background music low volume (no copyrighted)
- End card: project name + GitHub URL + ETHGlobal Open Agents

## Upload

- YouTube: Unlisted, 1080p
- Title: "Agent Werewolf — autonomous AI agents play onchain Werewolf | ETHGlobal Open Agents"
- Description: copy from SUBMISSION.md "What this is"
- Pin link in submission form
