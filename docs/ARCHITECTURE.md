# MIRA Architecture

> Canonical layered domain map. Agents reference this to understand module boundaries.
> Update when adding new services or changing dependency directions.

## Domain Layers

Each MIRA module falls into one of four layers. Dependencies flow **downward only**.

```
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION (user-facing surfaces)                     │
│  mira-web · atlas-frontend                               │
├─────────────────────────────────────────────────────────┤
│  ADAPTERS (protocol translation → engine)                │
│  mira-bots/{telegram,slack,reddit} · mira-pipeline       │
├─────────────────────────────────────────────────────────┤
│  ENGINE (core diagnostic logic)                          │
│  mira-bots/shared/ (GSDEngine, RAGWorker, guardrails)    │
│  mira-mcp (FastMCP tools, equipment context)             │
├─────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE (data stores, ingestion, orchestration)  │
│  mira-core/mira-ingest · mira-crawler · mira-bridge     │
│  mira-cmms/atlas-{api,db,minio}                         │
│  NeonDB (cloud) · SQLite (local) · Redis (broker)        │
└─────────────────────────────────────────────────────────┘
```

## Dependency Rules (enforced by import-linter when enabled)

| Rule | Meaning |
|------|---------|
| Presentation → Adapters | Web calls bot adapters or pipeline API, never engine directly |
| Adapters → Engine | Telegram/Slack adapters call GSDEngine, never infrastructure |
| Engine → Infrastructure | GSDEngine calls NeonDB recall, Ollama embed, MCP tools |
| Infrastructure → ∅ | Data stores and crawlers have no upward dependencies |
| No lateral imports | mira-bots ↛ mira-crawler, mira-mcp ↛ mira-bots |

## Cross-Cutting Concerns

These are NOT modules — they're capabilities consumed by any layer via env vars or shared config:

| Concern | Implementation | Access Pattern |
|---------|---------------|----------------|
| Secrets | Doppler `factorylm/prd` | `os.environ[VAR]` via `doppler run` |
| Inference | InferenceRouter (cascade: Gemini→Groq→Cerebras→Claude) | `router.complete(messages)` |
| Observability | Langfuse (tracing), Flower/Prometheus/Grafana (metrics) | Auto-instrumented |
| PII sanitization | `InferenceRouter.sanitize_context()` | Called before every API dispatch |
| Tenant scoping | `MIRA_TENANT_ID` env var | Injected per-container |

## Network Topology

Canonical source: `deployment/network.yml`

```
Alpha (Celery orchestrator) ──tailscale──→ Bravo (Ollama compute)
                             ──tailscale──→ Charlie (MIRA KB host)
                                            Bravo ←──LAN──→ Charlie
```

## Module Inventory

| Module | Layer | Container(s) | Port(s) | Sidecar CLAUDE.md |
|--------|-------|-------------|---------|-------------------|
| mira-core | Infra | mira-core | 3000→8080 | ✓ |
| mira-ingest | Infra | mira-ingest | 8002→8001 | ✓ |
| mira-crawler | Infra | mira-celery-worker, mira-celery-beat | — | ✓ |
| mira-bridge | Infra | mira-bridge | 1880 | ✓ |
| mira-cmms | Infra | atlas-{api,db,minio,frontend} | 8088,5433,9000,3100 | ✓ |
| mira-bots/shared | Engine | — (library) | — | ✓ |
| mira-mcp | Engine | mira-mcp | 8000,8001 | ✓ |
| mira-pipeline | Adapter | mira-pipeline | 9099 | ✓ |
| mira-bots/{tg,slack} | Adapter | mira-bot-{telegram,slack} | — | via shared |
| mira-web | Presentation | mira-web | 3200→3000 | ✓ |
| ~~mira-hud~~ | ~~Presentation~~ | — | — | archived → `archives/mira-hud/` |
