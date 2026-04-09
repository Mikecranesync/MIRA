---
title: Windows Dev — Primary Development
type: node
updated: 2026-04-08
tags: [windows, development, primary]
---

# Windows Dev — Primary Development Machine

**OS:** Windows 11 Home 10.0.26200
**Tailscale IP:** 100.83.251.23
**Shell:** Git Bash (Unix syntax, not PowerShell)
**MIRA repo:** `C:\Users\hharp\Documents\MIRA\`

## Primary Role

Main development machine for Claude Code sessions. Most code changes originate here.

## Tools

- Git Bash (default shell for Claude Code)
- Claude Code CLI
- Docker Desktop
- Obsidian
- VS Code

## Notes

- **NeonDB from Windows:** `channel_binding` fails. Run NeonDB queries from macOS nodes instead. See [[gotchas/neondb-ssl]].
- This is where most Claude Code sessions happen, but development also occurs on Travel Laptop and occasionally on [[nodes/bravo]] and [[nodes/charlie]] via SSH.
