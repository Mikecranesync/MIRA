# MIRA Documentation Index

**MIRA** — Maintenance Intelligence & Response Assistant
**Version:** v0.3.1 (Config 1 MVP)
**Status:** Phase 1 hardening complete · Phase 2 adapters built · Phase 3 prompt versioning locked

---

## Quick Links

| Document | Description |
|----------|-------------|
| [PRD v1.0](PRD_v1.0.md) | Config 1 MVP implementation plan — source of truth |
| [AUDIT.md](AUDIT.md) | Baseline system state, risk register, hardening results |
| [CHANGELOG](../CHANGELOG.md) | Root-level version history |

---

## Architecture

| Diagram | Description |
|---------|-------------|
| [C4 Context](architecture/c4-context.md) | MIRA as black box — actors and external systems |
| [C4 Containers](architecture/c4-containers.md) | All 7 Docker containers, networks, Ollama |
| [C4 Components](architecture/c4-components.md) | mira-bots internals — adapters, workers, FSM |
| [C4 Deployment](architecture/c4-deployment.md) | Physical topology — Mac Mini + cloud dependencies |
| [Fault Flow](architecture/c4-dynamic-fault-flow.md) | End-to-end sequence: photo → diagnostic question |

---

## Platform Setup Guides

| Platform | Status | Guide |
|----------|--------|-------|
| Telegram | Live | Telegram bot token in Doppler |
| Slack | Live | Slack tokens in Doppler |
| Microsoft Teams | Built — awaiting Azure setup | [SETUP_TEAMS.md](SETUP_TEAMS.md) |
| WhatsApp | Built — awaiting Twilio setup | [SETUP_WHATSAPP.md](SETUP_WHATSAPP.md) |

---

## Prompt Versioning

| File | Description |
|------|-------------|
| `mira-bots/prompts/diagnose/active.yaml` | **Live system prompt** — swap to roll out new version |
| `mira-bots/prompts/diagnose/v0.1-baseline.yaml` | Locked baseline — do not edit |
| `mira-bots/prompts/diagnose/CHANGELOG.md` | Prompt version history |
| `mira-bots/prompts/golden_dataset/v0.1.json` | 8 locked acceptance test cases |

---

## Test Results

| File | Description |
|------|-------------|
| [BOTTOM_LAYER_TEST_RESULTS.md](BOTTOM_LAYER_TEST_RESULTS.md) | Phase 8 integration tests — all 7 pass |

---

## System Summary

```
Technician (Slack/Telegram/Teams/WhatsApp)
    │
    ▼
mira-bots (4 adapters) → Claude API (LLM inference)
    │                          │
    ▼                          ▼
mira-ingest (:8002) ←→ NeonDB + PGVector (RAG)
    │
    ▼
mira-bridge (Node-RED :1880) ← SQLite mira.db (shared state)
    │
    ▼
mira-mcp (:8000/:8001) — 4 MCP tools
    │
    ▼
mira-core (Open WebUI :3000) + mira-mcpo (:8000)
    │
    ▼
Ollama on host :11434 (Metal GPU — qwen2.5vl:7b, nomic-embed-text)
```

---

## Infrastructure Quick Reference

| Resource | Value |
|----------|-------|
| Machine | Mac Mini M4 16GB · 192.168.1.11 |
| Tailscale | 100.86.236.11 |
| NeonDB | ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech |
| Tenant ID | 78917b56-f85f-43bb-9a08-1bb98a6cd6c3 |
| GitHub | github.com/Mikecranesync/MIRA (private) |
| Doppler | factorylm / prd |
| Ollama | localhost:11434 (host, Metal GPU) |
