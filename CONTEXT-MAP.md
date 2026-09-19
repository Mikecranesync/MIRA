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

System-wide language: `CONTEXT.md` (cross-cutting glossary; grown by `/grill-with-docs`).
System-wide ADRs: `docs/adr/` (0001–0016).
System-wide specs: `docs/specs/`.
System-wide plans: `docs/plans/`.
Primary doctrine: `docs/THEORY_OF_OPERATIONS.md`.

Per-context ADRs may grow under `<module>/docs/adr/` later; none today.

## System-wide references

(Moved here from root `CLAUDE.md` on 2026-09-13 when it became a thin adapter over `AGENTS.md`.
`AGENTS.md` keeps only the bootloader; everything an agent might need *after* orientation is here.)

**Product & strategy** — `NORTH_STAR.md` (wedge, flywheel, ProveIt 2027 runbook) · `STRATEGY.md` (ICP,
competitive table) · `docs/THEORY_OF_OPERATIONS.md` (primary doctrine) ·
`docs/specs/maintenance-namespace-builder-spec.md` (namespace-builder contract) ·
`docs/specs/mira-component-intelligence-architecture.md` (component templates, KG mechanics) ·
`docs/product/mira_difference_engine_offering.md` + `mira_signal_difference_engine_prd.md` +
`docs/plans/2026-06-30-mira-difference-engine-backlog.md` (signal difference engine).

**Plans & programs** — `docs/plans/2026-06-01-mira-master-architecture-plan.md` (governing 14-phase plan) ·
`docs/plans/2026-04-19-mira-90-day-mvp.md` · `docs/plans/2026-05-15-maintenance-namespace-builder.md` ·
`docs/plans/2026-06-07-path-to-beta.md` · `docs/prd/2026-07-30-mira-unification-program.md` + ADR-0033
(proposed) + `docs/plans/2026-07-30-unification-program-state.md` · `docs/architecture/materialized-evidence.md`
+ inventory + ADR-0029 · `docs/RESUME_2026-06-14_maintenance-intelligence-module.md` ·
`docs/superpowers/plans/2026-04-17-harness-engineering-industrial-grade.md` · `docs/specs/enforcement-layer-spec.md`.

**Engineering references** — `wiki/references/coding-principles.md` · `wiki/references/kanban.md` ·
`wiki/references/dev-loop.md` (pre-commit + watcher) · `wiki/references/codegraph.md` ·
`wiki/references/claude-code-v2.1.md` · `wiki/references/routines.md` · `wiki/nodes/wiki-sync.md` (wiki sync
across nodes + `~/MiraDrop/` auto-ingest) · `tools/mira-drop-watcher/README.md` · `docs/runbooks/ocr-regime.md` ·
`docs/runbooks/kiosk-askmira-deploy-and-verify.md` · `docs/observability/mira-agent-eval-audit.md` ·
`tools/mobile-e2e/README.md` (+ baseline `docs/proofs/2026-08-21-pixel9a-mobile-production-proof.md`) ·
`docs/simlab/README.md` · `docs/versioning.md` · `docs/env-vars.md` · `docs/known-issues.md` ·
`docs/QUALITY_SCORE.md` · `docs/agents/domain.md` · `docs/agents/issue-tracker.md` · `docs/agents/triage-labels.md`.

**Session state** — `wiki/hot.md` (where to resume; update at session end) · `.planning/STATE.md`
(gitignored local checkpoint for long tasks).
