---
title: Charlie — Mac Mini
type: node
updated: 2026-07-18
tags: [charlie, bots, paperclip, qdrant, vision-zta]
---

# Charlie — Mac Mini

**Tailscale IP:** 100.70.49.126
**LAN IP:** 192.168.1.12
**SSH:** `ssh charlie` or `charlienode@100.70.49.126` (Tailscale SSH — requires browser auth on first connect)
**Hostname:** CharlieNodes-Mac-mini.local
**SSH config aliases:** `charlie` on travel laptop + bravo; `bravo` alias on charlie -> 192.168.1.11
**Has Colima:** SSH config includes `/Users/charlienode/.colima/ssh_config`

## Specs

- **Disk:** 228 GiB APFS root, 29 GiB available on `/` in the 2026-07-18 probe.
- **RAM:** 16 GiB unified memory
- **External volumes:** `T7` mounted as of the 2026-07-18 probe.

## Installed Tools (verified 2026-07-18)

- Node.js v25.8.0
- Claude CLI at `/opt/homebrew/bin/claude`
- Docker 29.2.1 via Colima (`runtime: docker`, `mountType: virtiofs`)
- Ollama 0.20.2 listening on `:11434`
- Ollama models: `nomic-embed-text:latest`, `gemma4:e4b`, `qwen2.5:7b`, `nomic-embed-text:v1.5`
- MLX Python package present
- Tesseract, PaddleOCR, and MLX-VLM not present in the 2026-07-18 probe

## Designated Roles

- **Paperclip host (ADR-0006):** Port 3200. Needs: pnpm, MIRA repo clone, ANTHROPIC_API_KEY, Paperclip install.
- **Telegram bot runner** (when not on [[nodes/bravo]])
- **Vision ZTA Charlie lane (ADR-0028):** document OCR/layout, embeddings and visual-similarity indexing, batch corpus processing, benchmark/dataset curation, and optional second 4B-class VLM only after load/memory gates pass.

## Known Issues

- **Doppler keychain locked** — same SSH keychain issue as Bravo had. Fix: `doppler configure set token-storage file`. See [[gotchas/ssh-keychain]].
- **Old Tailscale node:** 100.82.246.52 (charlienodes-mac-mini) — OFFLINE since 2026-03-17, replaced by current node.
- **Vision ZTA runtime gaps:** Tesseract, PaddleOCR, and MLX-VLM were missing on 2026-07-18. Install only through a pinned, license-checked Vision ZTA PR.
- **Resource guard:** 2026-07-18 load averages were 5.32/5.37/4.97 while MIRA services were active. Charlie must keep Vision ZTA batch work asynchronous and memory/CPU-limited; no second VLM lane without measured headroom.

## Latest Inventory Evidence

- `docs/ops/vision-zta-fleet-inventory-2026-07-18.md`

## Fleet-standard audit (2026-09-13, `docs/agent-standard/nodes/charlie.md` runbook)

Evidence recorded at PR #3755 head `e852f1229` by Claude `mira-23`; re-run
`tools/fleet-parity-check.sh --node charlie` to refresh.

- **Wiring checker:** `WIRING-OK` on the Phase-2 branch (adapter wiring only — one §11 input, not the
  §11 verdict; this node is **not** §11-STANDARD while the drift below is open). CodeGraph preflight `READY`
  (CLI 0.9.5, 55,038 nodes / 112,103 edges, canary healthy). `AGENTS.md` present, `wiki/hot.md`
  readable, `gh auth` PASS.
- **Disk headroom is the live constraint, not RAM.** `/` had **29 GiB** free on 2026-07-18,
  **10 GiB** on 2026-09-12, and **3.4 GiB** on 2026-09-13 while ~35 git worktrees and 19 `cao-*`
  tmux sessions were resident. Memory was 51 % free. Before `git worktree add`, run `df -h /`
  (a worktree is ~600 MB; a full disk cascades into the shared checkout — see
  `docs/tech-debt/2026-07-27-worktree-clutter-rca.md`).
- **`UNIVERSAL DRIFT` (fix centrally, recorded here so nobody re-derives it):**
  1. `~/MIRA` is the shared canonical checkout and has been used for direct feature development
     while parked on a feature branch that other sessions read (§7). Do not "fix" this by
     switching its branch — that is the same violation. Task work goes in an owned worktree.
  2. `~/MIRA`'s git identity is checkout-local (`MIRA Beta Orchestrator`) and inherited by every
     worktree, so commits are unattributable to a session (§6). Commit with
     `-c user.name="<provider>-<session>@charlie"` until a canonical identity rule lands.
- **`NODE OVERLAY` (valid, keep):** Qdrant :8000, Vision ZTA lane, Colima runtime, jarvis_node
  :8765, the resource guards above. None of these are parity defects.
- **`BLOCKER` (not fixable by an agent without ownership):** two `wiki/hot.d/2026-09-09-charlie-*`
  lane notes were found uncommitted in the shared checkout; their contents were preserved
  verbatim on PR #3755 (comment 5647149283). The owning lane should land them via the normal
  wiki path.
