# MIRA — Architecture Context
**Last Updated:** 2026-05-05

This file is the **session-loadable** view of the system. For canonical layered domain rules see `docs/ARCHITECTURE.md`. For container topology in mermaid see `docs/architecture/c4-containers.md`. For per-module contracts see `docs/specs/SPEC_INDEX.md`.

## Layer map (dependencies flow downward only)
```
┌────────────────── PRESENTATION ──────────────────┐
│  mira-web   ·   mira-hub   ·   atlas-frontend    │
├────────────────── ADAPTERS ───────────────────────┤
│  mira-bots/{telegram,slack,reddit,...}            │
│  mira-pipeline                                    │
├────────────────── ENGINE ─────────────────────────┤
│  mira-bots/shared (Supervisor, RAGWorker,         │
│                   guardrails, InferenceRouter)    │
│  mira-mcp (FastMCP tools, equipment context)      │
├────────────────── INFRASTRUCTURE ─────────────────┤
│  mira-core/mira-ingest · mira-crawler             │
│  mira-bridge · mira-cmms (atlas-*)                │
│  NeonDB · SQLite (WAL) · Redis (broker) · Ollama  │
└───────────────────────────────────────────────────┘
```

Cross-cutting concerns: secrets (Doppler `factorylm/prd`), inference (`InferenceRouter` cascade), observability (Langfuse, Flower, Prometheus, Grafana), PII sanitization (`InferenceRouter.sanitize_context()` — default-on inside `complete()`), tenant scoping (`MIRA_TENANT_ID`).

## Active VPS chat path
```
User phone → Open WebUI → mira-pipeline:9099 → Supervisor (mira-bots/shared/engine.py) → cascade
```
- Cloud cascade: Groq → Cerebras → Gemini (no Anthropic since PR #610 / #649).
- Local fallback: Open WebUI → qwen2.5vl:7b on Ollama.
- Picks vision-capable provider when an image is present; skips text-only providers for image requests.

## Container topology (one per service)
| Container | Port(s) | Network(s) |
|---|---|---|
| mira-core (Open WebUI) | 3000→8080 | core-net, bot-net |
| mira-pipeline | 9099 | core-net |
| mira-ingest | 8002→8001 | core-net |
| mira-mcp | 8000, 8001 | core-net |
| mira-mcpo | 8000 | core-net |
| mira-docling | 5001 | core-net |
| mira-bridge (Node-RED) | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack | — | bot-net, core-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-db | 5433 | cmms-net |
| atlas-frontend | 3100 | cmms-net |
| atlas-minio | 9000, 9001 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |
| mira-hub | (internal) | core-net, cmms-net |

SaaS overlay (`docker-compose.saas.yml`) adds `mira-relay` (cloud relay endpoint for Ignition factory→cloud tag streaming) and `mira-ingest-saas`.

## Cluster nodes
| Node | Role | Tailscale | LAN |
|---|---|---|---|
| Alpha | Orchestrator (Celery) | 100.107.140.12 | 192.168.4.28 |
| Bravo | Compute (Ollama) | 100.86.236.11 | 192.168.1.11 |
| Charlie | KB host (MIRA stack) | 100.70.49.126 | 192.168.1.12 |
| Travel | Mobile (Tailscale-only) | — | — |

Connectivity: Alpha ↔ Bravo/Charlie via Tailscale only (different subnets). Bravo ↔ Charlie via LAN (same subnet) with Tailscale fallback. Canonical source `deployment/network.yml`.

## Data planes
- **NeonDB (Postgres + pgvector):** tenants, knowledge_entries (~25,219 chunks as of 2026-03-28), fault_codes, manual_cache, manuals, kg_entities, kg_relationships, kg_triples_log, agent_health, api_usage. RLS by `app.current_tenant_id`.
- **SQLite WAL `mira.db`:** owned by `mira-bridge`; read by every adapter, mira-mcp, mira-pipeline. Holds `conversation_state`, `equipment_status`, `faults`, `maintenance_notes`, `equipment_photos`, `feedback_log`.
- **OpenViking store:** alternate retrieval backend used when `RETRIEVAL_BACKEND=openviking`.
- **MinIO (Atlas):** asset images and work-order attachments.

## Cross-service contracts
- Bot adapter → engine: `Supervisor.process_full(chat_id: str, msg, photo_b64)` returns `{reply, confidence, trace_id, next_state}`.
- Pipeline → engine: same call, `chat_id` = Open WebUI `user`.
- Hub/Web → CMMS: never directly to Atlas; always via `mira-mcp` REST + bearer.
- Anything writing `mira.db`: must use WAL retry pattern; mira-bridge holds the write lock.

## Key reference docs
- `docs/architecture/c4-containers.md` — container mermaid
- `docs/architecture/c4-context.md` — system-context view
- `docs/architecture/c4-dynamic-fault-flow.md` — runtime trace of a fault diagnosis
- `docs/architecture/rag-pipeline.md` — full RAG snapshot
- `docs/architecture/INGEST_PIPELINES.md` — ingest pipelines reference
- `docs/architecture/SYSTEM_OVERVIEW.md` — top-level walkthrough
