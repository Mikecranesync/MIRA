---
title: Charlie — Mac Mini
type: node
updated: 2026-04-08
tags: [charlie, bots, paperclip, qdrant]
---

# Charlie — Mac Mini

**Tailscale IP:** 100.70.49.126
**LAN IP:** 192.168.1.12
**SSH:** `ssh charlie` or `charlienode@100.70.49.126` (Tailscale SSH — requires browser auth on first connect)
**Hostname:** CharlieNodes-Mac-mini.local
**SSH config aliases:** `charlie` on travel laptop + bravo; `bravo` alias on charlie -> 192.168.1.11
**Has Colima:** SSH config includes `/Users/charlienode/.colima/ssh_config`

## Specs

- **Disk:** 228 GB total, 127 GB free (9% used)
- **RAM:** 16 GB

## Installed Tools (verified 2026-04-01)

- Node.js v25.8.0
- Claude CLI at `/opt/homebrew/bin/claude`
- Docker (running 4 legacy containers: factorylm-diagnosis, factorylm-hmi, factorylm-modbus, factorylm-plc)

## Designated Roles

- **Paperclip host (ADR-0006):** Port 3200. Needs: pnpm, MIRA repo clone, ANTHROPIC_API_KEY, Paperclip install.
- **Telegram bot runner** (when not on [[nodes/bravo]])

## Known Issues

- **Doppler keychain locked** — same SSH keychain issue as Bravo had. Fix: `doppler configure set token-storage file`. See [[gotchas/ssh-keychain]].
- **Old Tailscale node:** 100.82.246.52 (charlienodes-mac-mini) — OFFLINE since 2026-03-17, replaced by current node.
