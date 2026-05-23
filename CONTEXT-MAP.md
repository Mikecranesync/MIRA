# CONTEXT-MAP

MIRA is a multi-context monorepo. This file points engineering skills at the per-module contexts.

| Context | Module | Seed doc (until CONTEXT.md grows lazily) | Role |
|---|---|---|---|
| slack-bot-engine | `mira-bots/` | `mira-bots/shared/CLAUDE.md` | Slack/Telegram adapters + GSD engine + UNS gate |
| ingest-rag | `mira-core/mira-ingest/` | `mira-core/mira-ingest/CLAUDE.md` | Photo + PDF ingest, NeonDB writes |
| chat-pipeline | `mira-pipeline/` | `mira-pipeline/CLAUDE.md` | OpenAI-compat wrapper around Supervisor |
| mcp-server | `mira-mcp/` | `mira-mcp/CLAUDE.md` | FastMCP server, CMMS tools |
| atlas-cmms | `mira-cmms/` | `mira-cmms/CLAUDE.md` | Work orders, PM scheduling, asset registry |
| marketing-funnel | `mira-web/` | `mira-web/CLAUDE.md` | PLG funnel, Stripe, /cmms landing |
| sidecar-legacy | `mira-sidecar/` | `mira-sidecar/CLAUDE.md` | Deprecated ChromaDB (sunset pending — see ADR-0008) |
| bridge-orchestration | `mira-bridge/` | `mira-bridge/CLAUDE.md` | Node-RED orchestration, SQLite WAL |
| hub | `mira-hub/` | `mira-hub/CLAUDE.md` + `mira-hub/AGENTS.md` | Auth + tenant + Next.js app shell |
| knowledge-ingest | `mira-crawler/` | (no module CLAUDE.md — use `.claude/skills/knowledge-ingest.md`) | OEM discovery + chunker |

System-wide ADRs: `docs/adr/` (0001–0016).
System-wide specs: `docs/specs/`.
System-wide plans: `docs/plans/`.
Primary doctrine: `docs/THEORY_OF_OPERATIONS.md`.

Per-context ADRs may grow under `<module>/docs/adr/` later; none today.
