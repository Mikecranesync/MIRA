# MIRA Documentation

**MIRA** — Maintenance Intelligence & Response Assistant
**Version:** v0.4.1 (Config 1 MVP)
**Status:** Phase 1 hardening complete · Phase 2 adapters built · Phase 3 prompt versioning locked · Phase 4 architecture docs complete

---

## Architecture

| Diagram | Description |
|---------|-------------|
| [System Context](architecture/c4-context.md) | MIRA as black box — actors and external systems |
| [Container Map](architecture/c4-containers.md) | All 9 Docker containers, networks, Ollama on host |
| [Component Detail](architecture/c4-components.md) | mira-bots internals — adapters, workers, FSM, inference router |
| [Deployment](architecture/c4-deployment.md) | Physical topology — Mac Mini + cloud dependencies |
| [Fault Flow](architecture/c4-dynamic-fault-flow.md) | End-to-end sequence: photo → diagnostic question |

---

## Setup Guides

| Platform | Status | Guide |
|----------|--------|-------|
| Telegram | Live | Bot token in Doppler |
| Slack | Live | Slack tokens in Doppler |
| Microsoft Teams | Built — awaiting Azure setup | [SETUP_TEAMS.md](SETUP_TEAMS.md) |
| WhatsApp | Built — awaiting Twilio setup | [SETUP_WHATSAPP.md](SETUP_WHATSAPP.md) |

---

## Reference

| Document | Description |
|----------|-------------|
| [PRD v1.0](PRD_v1.0.md) | Config 1 MVP implementation plan — source of truth |
| [AUDIT.md](AUDIT.md) | Baseline system state, risk register, hardening results |
| [CHANGELOG](../CHANGELOG.md) | Root-level version history |
| [Hardware Independence](HARDWARE_INDEPENDENCE.md) | MIRA runs on any Docker host |
| [GitHub Setup](GITHUB_SETUP.md) | Repository and CI configuration |
| [Test Results Baseline](TEST_RESULTS_BASELINE.md) | Baseline acceptance test results |
| [Bottom Layer Tests](BOTTOM_LAYER_TEST_RESULTS.md) | Integration tests — all 7 pass |

---

## Prompt Versioning

| File | Description |
|------|-------------|
| `mira-bots/prompts/diagnose/active.yaml` | **Live system prompt** — swap to roll out new version |
| `mira-bots/prompts/diagnose/v0.1-baseline.yaml` | Locked baseline — do not edit |
| `mira-bots/prompts/diagnose/CHANGELOG.md` | Prompt version history |
| `mira-bots/prompts/golden_dataset/v0.1.json` | 8 locked acceptance test cases |

---

## System Summary

```
Technician (Slack / Telegram / Teams / WhatsApp)
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
mira-mcp (:8009/:8001) — 4 MCP tools
    │
    ▼
mira-core (Open WebUI :3000) + mira-mcpo (:8000)
    │
    ▼
Ollama on host :11434 (Metal GPU — qwen2.5vl:7b, glm-ocr, nomic-embed)
```

---

## Infrastructure Quick Reference

| Resource | Value |
|----------|-------|
| Machine | Mac Mini M4 16 GB · 192.168.1.11 |
| Tailscale | 100.86.236.11 |
| NeonDB | ep-purple-hall-ahimeyn0-pooler.c-3.us-east-1.aws.neon.tech |
| Tenant ID | 78917b56-f85f-43bb-9a08-1bb98a6cd6c3 |
| GitHub | github.com/Mikecranesync/MIRA (private) |
| Secrets | Doppler factorylm/prd |
| Ollama | localhost:11434 (host, Metal GPU) |
