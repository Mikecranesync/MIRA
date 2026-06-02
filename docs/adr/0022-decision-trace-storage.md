# ADR-0022: Decision-trace storage — append-only NeonDB Postgres, 90-day raw retention

## Status
Accepted — 2026-06-02

**Related:** ADR-0013 (Hub schema canonicalization), ADR-0017 (proposal state-machine mapping), `docs/plans/2026-06-01-mira-master-architecture-plan.md` Phase 1 (schema) / Phase 8 (writer + UI), §D2 (SQL) / §D5 (retention + rollup).

---

## Context

Every engine turn produces a chain of decisions: UNS gate outcome, retrieval set, KG hops, tag events consulted, cascade failures, citation check, latency. Today none of that is persisted — it lives only in ephemeral engine memory for the duration of the turn. This has three consequences:

1. **Debugging is blind.** When a technician gets a wrong or ungrounded answer there is no trace to inspect.
2. **Regression testing is weak.** The `tests/eval/` golden cases assert on the final reply; they cannot assert on whether the engine used the right evidence or how many cascade failures preceded the answer.
3. **Phase 8–11 features (audit UI, detect-flaky-input analytics, decision-trace replay) have no storage layer.**

The decision is what to store, where, how long, and in what shape.

## Decision

**Append-only NeonDB Postgres (`decision_traces` table, migration 032). No separate time-series DB until Phase 13.**

### What is stored

One row per engine turn. Heavy columns (`retrieval_set`, `kg_hops`, `tag_events_consulted`, `cascade_failures`) are JSONB so they compress well and don't widen the row for the common case (read by trace id, not by column projection). Scalars (`latency_ms`, `model_used`, `gate_outcome`, `citation_check`, `next_state`) are typed columns so they're indexable and aggregable without JSONB overhead.

All text stored sanitized: `InferenceRouter.sanitize_context()` already strips IPv4 → `[IP]`, MAC → `[MAC]`, serial numbers → `[SN]`. The writer (`DecisionTraceWriter`, Phase 8) calls `sanitize_context()` on `user_message` and `prompt` before INSERT. No PII lands in this table.

### Primary key

UUIDv7 (`trace_id`), caller-assigned by the engine. UUIDv7 embeds a millisecond timestamp, so `ORDER BY trace_id` is an approximate time-sort for free without touching the `ts` column. This also lets the engine set the trace id at turn-start and write partial updates by trace_id through the turn, before a final COMMIT.

### Session link

`session_id UUID REFERENCES troubleshooting_sessions(id)` — nullable, because not every turn originates in a session (e.g., a `/status` query or a context-less ping). Migration 036 adds `troubleshooting_sessions.last_decision_trace_id UUID` for fast "most recent trace for this session" lookup from the Hub session detail view.

### Indexes

Three indexes sized for Phase 8 access patterns:
- `(tenant_id, ts DESC)` — time-series scan; primary read path for trace history.
- `(session_id)` — session-scoped lookup for `list_decision_traces` MCP tool.
- `USING GIST (uns_path)` — asset-scoped trace queries ("show me all traces for CV-101 in the last 7 days").

### Retention

**90 days raw**, then daily rollup to `decision_trace_summary_daily` (Phase 8 job, deferred). The rollup schema is not defined here — see §D5 of the master plan for the proposed summary shape. The nightly `pg_cron` job (or a Celery beat task) that enforces the 90-day floor is a Phase 8 deliverable; Phase 1 only adds the table.

Until the retention job ships, rows accumulate. At 1 turn per 30 s across 50 active tenants, the table reaches ~145,000 rows/day ≈ ~13M rows at 90 days — well within NeonDB's free-tier storage envelope on a compressed JSONB-heavy table (estimated ~2 GB at 90 days).

### No separate time-series DB (until Phase 13)

Option considered: push traces to ClickHouse or TimescaleDB for cheaper columnar scans. Rejected for Phase 1–12:
- NeonDB is already the single persistence layer; adding a second system doubles ops surface for a ~50-tenant load that Postgres handles trivially.
- The `(tenant_id, ts DESC)` B-tree index covers the access patterns Phase 8–11 need.
- Phase 13 ("analytics and dashboards at scale") is the trigger to revisit — at that point the 90-day raw table is a clean migration source if we choose to move.

## Enforcement

1. **Writer is the only write path.** `mira-bots/shared/decision_trace.py:DecisionTraceWriter` (Phase 8) is the single INSERT path for `decision_traces`. Direct `INSERT INTO decision_traces` from any other module is a bug.
2. **Sanitization is non-negotiable.** `user_message` and `prompt` MUST pass through `InferenceRouter.sanitize_context()` before being passed to `DecisionTraceWriter`. The writer asserts `sanitized=True` on its inputs (Phase 8 implementation detail).
3. **UUIDv7 only.** The engine generates `trace_id` via `uuid_utils.uuid7()` (or equivalent) at turn-start. `gen_random_uuid()` (UUIDv4) is forbidden for this column — it loses the ordering guarantee.
4. **No FK on `last_decision_trace_id`.** Migration 036 deliberately omits the FK from `troubleshooting_sessions.last_decision_trace_id` back to `decision_traces.trace_id` to avoid circular dependency concerns and because the trace commit and the session update happen in the same atomic engine operation, not a two-phase write.

## Consequences

- Phase 8 ships `DecisionTraceWriter`, the Hub `/decision-traces` endpoint, and the 90-day retention job.
- Phase 11 wires `mira_read_decision_trace(trace_id)` and `mira_list_decision_traces(session_id)` MCP tools on top of this table.
- The `regime8_decision_trace` test regime (Phase 12) replays audit scenarios against this table.
- If Phase 13 moves traces to a separate time-series store, the migration source is `decision_traces` — the schema is intentionally self-contained (no cross-table JOINs required to read a trace row).

## What was NOT decided here

- The exact rollup schema for `decision_trace_summary_daily` (deferred to Phase 8).
- The UI design for the Hub `/decision-traces` audit page (deferred to Phase 8).
- The `pg_cron` vs Celery beat choice for the 90-day retention job (deferred to Phase 8).
- Whether `cascade_failures` triggers an alert (e.g., if all three cascade providers fail in one turn). Deferred to Phase 11 (alerting infrastructure).
