# Architecture Overview

High-level map of how MIRA is structured. For deep dives, see the C4 diagrams and ADRs linked below.

## The 30-second version

MIRA is a monorepo of ~10 Docker services that compose into one product. The core service (`mira-pipeline`) wraps a diagnostic engine with conversation state and a multi-provider LLM cascade. Everything else is either a user-facing surface (web, Telegram, Slack) or a support service (ingest, MCP, bridge, CMMS, sidecar).

## Repo map

```
MIRA/
├── mira-core/       Open WebUI + MCPO proxy + photo ingest service
├── mira-bots/       Telegram, Slack adapters + shared diagnostic engine (GSDEngine)
├── mira-bridge/     Node-RED orchestration, SQLite WAL shared state
├── mira-mcp/        FastMCP server, NeonDB recall, equipment + CMMS tools
├── mira-pipeline/   OpenAI-compatible API wrapping GSDEngine — active VPS chat path
├── mira-web/        Hono/Bun PWA — PLG funnel, Stripe, CMMS + chat
├── mira-cmms/       Atlas CMMS — work orders, PM schedules, asset registry
├── mira-hud/        AR HUD desktop app (Express + Socket.IO) — experimental
├── mira-connect/    Factory-floor edge agent (PLC, Modbus, OPC UA discovery)
├── mira-sidecar/    ⚠️ LEGACY — ChromaDB RAG, superseded by mira-pipeline (ADR-0008)
├── wiki/            LLM-maintained ops wiki (Obsidian vault)
├── tests/           5-regime testing framework
├── docs/            This directory — product + developer docs, specs, ADRs, runbooks
├── tools/           Photo pipeline, Google Drive ingest, migration scripts
└── plc/             PLC program files (Micro820 + Factory I/O)
```

## Deeper architectural views

### C4 diagrams

The canonical system view, at four zoom levels:

| Diagram | What it shows |
|---|---|
| [C4 Context](../architecture/c4-context.md) | MIRA as a black box — actors, external systems |
| [C4 Containers](../architecture/c4-containers.md) | All Docker services, networks, port mappings |
| [C4 Components](../architecture/c4-components.md) | `mira-bots` internals — adapters, workers, FSM, inference router |
| [C4 Deployment](../architecture/c4-deployment.md) | Physical topology — BRAVO, CHARLIE, VPS |
| [Fault flow (dynamic)](../architecture/c4-dynamic-fault-flow.md) | End-to-end sequence: photo arrives → diagnostic question returns |

### Architecture Decision Records

Key decisions are documented in [docs/adr/](../adr/). Read these when you need to know *why* something is the way it is:

- ADR-0001: OpenAI-compatible API as the wire format
- ADR-0008: Retire ChromaDB sidecar in favor of NeonDB pgvector
- ADR-0012: Two-Brain architecture — shared_oem + per-tenant knowledge
- (and others — see the `docs/adr/` directory for the full list)

## Runtime architecture

### The chat path (primary)

```
User (phone/browser)
  ↓
Open WebUI (mira-core, port 3000)
  ↓
mira-pipeline (port 9099, OpenAI-compat wrapper)
  ↓
GSDEngine (shared/engine.py in mira-bots) — FSM: IDLE→Q1→Q2→Q3→DIAGNOSIS→FIX_STEP→RESOLVED
  ↓
Inference Router (Gemini → Groq → Cerebras → Claude cascade)
  ↓
Reply + FSM state update
```

### The knowledge path (retrieval)

```
User query
  ↓
mira-pipeline (queries retrieval during FSM transitions)
  ↓
mira-mcp recall_knowledge() via NeonDB pgvector
  ↓
4-stage retrieval: vector similarity + fault-code match + ILIKE + product-name match
  ↓
Top-K chunks returned with citations
  ↓
Ranked + injected into LLM prompt
```

### The CMMS path

```
User: "Create a work order for this"
  ↓
mira-pipeline detects tool-use intent
  ↓
mira-mcp cmms_create_work_order tool
  ↓
CMMS factory dispatch (cmms/factory.py) → atlas.py | maintainx.py | limble.py | fiix.py
  ↓
HTTP POST to target CMMS API
  ↓
Work order created, ID returned to user
```

## Inference backend modes

Two modes, switched via `INFERENCE_BACKEND` env var:

- **`cloud`** — Gemini → Groq → Cerebras → Claude cascade via `shared/inference/router.py`. Production default.
- **`local`** — Open WebUI → `qwen2.5vl:7b` via Ollama. Used for vision, offline dev, and as a last-resort fallback when all cloud providers fail.

## State storage

| Data | Storage | Why |
|---|---|---|
| Conversation state (per chat_id) | SQLite with WAL mode (`mira.db`, mounted in mira-bridge volume) | Fast local writes, durable, backup via LiteFS |
| Knowledge chunks | NeonDB with pgvector | Scales to millions of chunks, hosted, tenant-isolated |
| User / tenant metadata | NeonDB | Single source of truth for billing, permissions |
| CMMS data | External CMMS (Atlas / MaintainX / etc.) | Never mirrored; always queried live |
| API usage / tokens | SQLite (`api_usage` table in mira.db) | Per-tenant quota enforcement |

## Security boundaries

- **Tenant isolation:** every NeonDB query is scoped by `tenant_id`. Application enforces this, not row-level security (yet).
- **PII sanitization:** `InferenceRouter.sanitize_context()` strips IPv4, MAC, serial numbers before any cloud LLM call.
- **Safety guardrails:** 21 phrase-level triggers in `shared/guardrails.py` force stop-and-reassess on arc flash / LOTO / confined space / etc.
- **Secrets:** Doppler only. Never in `.env` committed to git.

## Where to go next

- [Local setup](local-setup.md) — get MIRA running on your machine
- [Deployment](deployment.md) — how code reaches production
- [Contributing](contributing.md) — commit conventions, PR workflow, code review
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — layer map + dependency rules (the canonical architecture reference)
- [docs/adr/](../adr/) — every major design decision, dated
