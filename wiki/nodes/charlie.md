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
