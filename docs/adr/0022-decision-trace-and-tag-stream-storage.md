# ADR-0022: Decision-Trace, Tag-Event & Allowlist Storage (Postgres-first)

## Status

Accepted — 2026-06-02

**Related:** ADR-0013 (Hub schema canonicalization — Hub owns the product
surface), ADR-0017 (proposal state machine), ADR-0021 (Ignition-module-first
edge).
**Implements:** Phase 1 of
[`docs/plans/2026-06-01-mira-master-architecture-plan.md`](../plans/2026-06-01-mira-master-architecture-plan.md),
grounded in the verified audit at
[`docs/plans/current-state-gap-closure-plan.md`](../plans/current-state-gap-closure-plan.md).
**Migrations:** `mira-hub/db/migrations/032`–`036`.

---

## Context

The repo-truth audit (gap-closure plan §2.3) verified that five storage gaps
block the Connect→Store→Analyze→Report pipeline:

1. **No durable decision-trace store.** `Supervisor.process_full()` returns a
   `trace_id`, but it is sourced from a Langfuse wrapper (`telemetry.py`) that
   silently no-ops — `trace_id` is `None` whenever `LANGFUSE_SECRET_KEY` is
   unset, which is the production default. Groundedness cannot be audited.
2. **No production tag-event stream.** `live_signal_events` (Hub 019) is the
   demo-simulator-coupled stream (`simulated` defaults `true`,
   `source='demo_simulator'`, component-bound). The customer-ingestion path
   needs a tenant-scoped append-only twin with first-class provenance.
3. **`current_tag_state` is not a gap.** `live_signal_cache` (Hub 020) already
   is the latest-value-per-tag store; it merely lacks UNS/freshness/provenance
   columns.
4. **No flaky-signal store** for the Phase-9 detector to target.
5. **`approved_tags` is a flat JSON file** (`ignition/project/approved_tags.json`),
   readable only by the Ignition gateway — not enforceable server-side at the
   relay ingest path.

## Decision

**All five land in the Hub schema (ADR-0013) as Postgres tables/columns —
no separate time-series or graph store.** Postgres-first per the master plan's
locked constraint #1.

| # | Table | Shape |
|---|---|---|
| 032 | `decision_traces` | NET-NEW. Append-only audit, one row per grounded turn. Evidence as JSONB (`tag_evidence`/`manual_evidence`/`kg_evidence`), `citations_present`, `technician_confirmed`, `outcome`, `model_used`, `latency_ms`. |
| 033 | `tag_events` | NET-NEW. Append-only RAW ingestion stream. Full provenance: `source_system`, `source_connection_id`, `simulated` (DEFAULT **false**), `quality`, `event_timestamp` vs `ingested_at`. |
| 034 | `flaky_input_signals` | NET-NEW. Detected instability; bridges to `ai_suggestions`; mutable `status`. |
| 035 | `approved_tags` | NET-NEW. Security allowlist keyed `(tenant_id, source_system, source_tag_path)`. Distinct from the `tag_entities` semantic catalog. |
| 036 | `live_signal_cache` (EXTEND) | Column-adds: `uns_path`, `source_system`, `latest_quality`, `freshness_status`, `expected_freshness_seconds`. **Not** a new `current_tag_state` table — Reuse-Before-Build. |

### Key sub-decisions

1. **UUID PK uses `gen_random_uuid()`, not UUIDv7.** The master plan's
   first-pass SQL suggested UUIDv7 for sortability. The entire Hub schema uses
   `gen_random_uuid()` (Postgres-native, no extension, works on NeonDB today;
   UUIDv7 is not guaranteed on the deployed Postgres version). Time-ordering is
   served by `(tenant_id, ts DESC)` indexes on every table. House convention
   wins over the plan's draft.

2. **`tag_events` is the RAW stream; the Phase-5 meaningful-diff model is
   downstream.** The master plan's Appendix-B `tag_events` was a *diff* stream
   (`event_type` rising/falling/value_changed). The gap-closure task's columns
   are the *raw* ingestion shape, because Phase 2's "never silently mix
   simulated and real telemetry" requires per-reading provenance the diff draft
   omits. The diff layer is derived FROM this raw stream by the Phase-5 diff
   logger (or a later `tag_event_diffs` table). **Sequence, not conflict.**

3. **`current_tag_state` extends `live_signal_cache`.** Creating a parallel
   latest-value table would split the write path and duplicate infra. We add
   the four missing columns instead.

4. **`approved_tags` ≠ `tag_entities`.** The allowlist is the allow/deny
   boundary on the *raw* source path (pre-UNS); `tag_entities` is the semantic
   catalog (UNS path → PLC address). Two concerns, two tables.

5. **Append-only is enforced at the DB.** `decision_traces` and `tag_events`
   `REVOKE UPDATE, DELETE FROM PUBLIC`; the app role gets `SELECT, INSERT` only.
   `flaky_input_signals` and `approved_tags` keep `UPDATE` (status/enabled
   toggles).

### Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Dedicated time-series DB (Timescale/Influx) for `tag_events` | Master plan constraint #1 (Postgres-first). Row volume is bench-scale today; partition `(tenant_id, ts)` when it grows (open question D8 #7). Two stores = drift. |
| Reuse `live_signal_events` for `tag_events` via column-adds | Demo-coupled defaults + component-binding + missing provenance make it the wrong twin. The master plan explicitly called for a separate append-only stream. |
| New `current_tag_state` table | Duplicates `live_signal_cache`; violates Reuse-Before-Build. |
| Langfuse as the decision-trace store | Off by default in prod (`trace_id` is `None`); external dependency; not queryable by Hub surfaces. NeonDB is durable + RLS-isolated + already the product store. |

## Consequences

- **Positive.** Groundedness is auditable (Phase 8 writer + `/decision-traces`
  page can now land). Ingest provenance is first-class (Phase 2 can enforce
  sim/real separation). Command Center freshness has a source (Phase 4). The
  allowlist is server-enforceable (Phase 2/3). Flaky detector has a target
  (Phase 9).
- **Negative / deferred.** Retention policy for `decision_traces`/`tag_events`
  is unresolved (open question D8 #8 — 90-day raw + daily rollup proposed,
  pending sign-off). `tag_events` partitioning strategy deferred until volume
  warrants (D8 #7). `approved_tags.json` → table cutover needs a dual-write
  window (D8 #11) — this migration creates the table but does not seed the 46
  rows (staging-first seed discipline).
- **Numbering.** `origin/main` tops out at Hub mig 029; this work adds 032–036
  atop the Command-Center branch's 030/031. If `origin/main` independently
  grows a 030+ before merge, rename gap-closure files with a `b` suffix
  (`032b_*`) per the master plan's collision mitigation.

## Verification

- `apply-migrations.yml --dry-run` then `--apply` on staging (NeonDB
  `development`/`staging` branch — never prod-first, per CLAUDE.md).
- All four new tables exist with the indexes specified; `live_signal_cache`
  gains five columns; no row counts in existing tables change.
- `ltree` confirmed available (already used by Hub migs 010/015/016/017/025/030).
