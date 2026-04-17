# MIRA Ops Wiki — Index

> LLM-maintained operational knowledge base. See [[SCHEMA]] for operating instructions.

## Nodes

| Page | Summary |
|------|---------|
| [[nodes/alpha]] | Mac Mini — Celery orchestrator, observability stack, LinkedIn drafter |
| [[nodes/bravo]] | Mac Mini M4 production host — Docker, Ollama, auto-recovery chain |
| [[nodes/charlie]] | Mac Mini — Telegram bot host, Qdrant, Paperclip target |
| [[nodes/vps]] | DigitalOcean VPS — factorylm.com, SaaS v1, Atlas CMMS |
| [[nodes/plc-laptop]] | PLC programming laptop — CCW, RSLinx, Factory I/O |
| [[nodes/windows-dev]] | Windows 11 primary dev box — main Claude Code sessions |

## Gotchas

| Page | Summary |
|------|---------|
| [[gotchas/ssh-keychain]] | macOS keychain blocks Docker + Doppler over SSH — workarounds per node |
| [[gotchas/neondb-ssl]] | NeonDB channel_binding fails from Windows — run from macOS instead |
| [[gotchas/competing-pollers]] | Only one process can poll a Telegram bot token — check for stale pollers |
| [[gotchas/intent-guard]] | classify_intent() catches real maintenance questions as off-topic |

## Services

(To be populated as service pages are created)

## Special Files

| File | Purpose |
|------|---------|
| [[SCHEMA]] | Operating instructions for the LLM |
| [[hot]] | Session continuity — last session state, cross-machine |
| [[log]] | Append-only chronological record |
