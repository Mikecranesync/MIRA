# Current-State Gap-Closure Plan

**Maintained by:** autonomous gap-closure driver (epic #1666)
**Last updated:** 2026-06-03
**Governed by:** `docs/plans/2026-06-01-mira-master-architecture-plan.md`
**Issues:** `Mikecranesync/MIRA` — see epic #1666 for canonical list

---

## Purpose

This document is the shared operating memory for the gap-closure driver. It tracks which
master-plan phases are done, in-progress, or queued — so each driver run can orient quickly
without re-reading all 1,200+ lines of the master plan.

Update this file at the start of every driver run (status sync step).

---

## Baseline (2026-06-03)

Main branch HEAD: `9282fa1` (fix(deploy): make staging-gate-bypass audit issue non-fatal #1673)
Hub migrations on main: **001–031** (`031_ignition_audit_log.sql` is the last)
Engine migrations on main: **001–008** (per docs/migrations/)

---

## Phase Status

| Phase | Title | Status | Evidence | Issue/PR |
|-------|-------|--------|----------|----------|
| 0 | Repo truth audit | ✅ DONE | `docs/plans/current-state-gap-closure-plan.md` created; `2026-06-01-mira-master-architecture-plan.md` audited all components against codebase | PR #1657 |
| 1 | Postgres-first data model (migrations 032–037) | ⏳ IN PROGRESS (PR open) | Migrations authored, tested against ephemeral pg16, idempotent, append-only verified | PR #1657 |
| 2 | Ingest API (relay HMAC + allowlist + UNS → tag_events) | ⏳ IN PROGRESS (PR open) | `POST /api/v1/tags/ingest` on mira-relay: 66 pytest green | PR #1657 |
| 3 (relay) | Ignition collector rewire | ⏳ IN PROGRESS (PR open) | `api/tags/collector.py` + signed `tag-stream.py`; 24 tests + 74/74 Ignition tests green | PR #1657 |
| 3 (KG) | `kg_writer` → proposal helper (ADR-0017) | 🔲 NOT STARTED | `kg_writer.py` auto-verifies at confidence=1.0; `proposal_transition.py` and `proposal-transition.ts` missing | Issue #1662 |
| 4 | Command Center tag freshness | ⏳ IN PROGRESS (PR open) | Freshness = tag-based (live/stale/unknown/simulated); 16/16 bun tests green | PR #1657 |
| 5 | Tag diff & event stream logger | ⏳ IN PROGRESS (PR open) | `tag_diff_logger.py` + migration `037_tag_event_diffs`; 14 tests pass | PR #1657 |
| 6 | UNS direct_connection bypass | 🔲 NOT STARTED | `ignition_chat.py` does NOT set `source="direct_connection"` — 0 grep hits | Issue #1658 |
| 7 | Citation enforcement + troubleshooting session lifecycle | 🔲 NOT STARTED | `citation_compliance.py` observe-only; `troubleshooting_session.py` not created | Issue #1659 |
| 8 | Decision trace storage + writer | 🔲 NOT STARTED | `DecisionTraceWriter` class missing; `trace_id=None` in prod | Issue #1660 |
| 9 | Flaky wire / sensor anomaly detector | 🔲 NOT STARTED | `FlakyInputDetector` — 0 hits; `flaky_rules.py` not created | Issue #1661 |
| 10 | Slack Block Kit UNS confirmation cards | 🔲 NOT STARTED | Not yet scoped into an issue; Phase 10 from master plan |
| 11 | Agent tool layer (MCP additions) | 🔲 NOT STARTED | `get_asset_context`, `read_tag_value`, etc. not yet added to `mira-mcp/server.py` |
| 12 | Evaluation, testing & demo script | 🔲 NOT STARTED | `regime8_decision_trace/`, `regime9_flaky_input/` not yet created |
| 13 | Graph DB expansion | ⏰ DEFERRED | Triggers: kg p95 >800ms, 4-hop queries common, >5M edges — not yet applicable |

---

## Subsidiary fixes (issues under #1666)

| Issue | Title | Status | Blocks / Blocked by |
|-------|-------|--------|---------------------|
| #1665 | Promote migrations 032–037 to staging/prod | **ready-for-human** | Blocked on PR #1657 merge + `apply-migrations.yml` human run |
| #1664 | RLS verification under `factorylm_app` role | **IN PROGRESS** — PR #1674 | Stacked on #1657; merge #1657 first |
| #1663 | Hub `/proposals` reads wrong table | **ready-for-agent** | SOFT BLOCKED on #1657 merge (table 032 needed on main) |
| #1662 | `kg_writer` auto-verify bypass | **ready-for-agent** | Independent; can land now |
| #1661 | Flaky detector missing | **ready-for-agent** | Needs `flaky_input_signals` (migration 034) — BLOCKED on #1657 merge |
| #1660 | `DecisionTraceWriter` missing | **ready-for-agent** | Needs `decision_traces` (migration 032) — BLOCKED on #1657 merge |
| #1659 | Citation enforcement | **ready-for-agent** | Independent of migrations; can land now |
| #1658 | `direct_connection` UNS bypass | **ready-for-agent** | Independent of migrations; can land now |

---

## Open gap-closure PRs (2026-06-03)

### PR #1657 — `feat/dt2026-gap-closure` (base: `main`)
- **Title:** feat: Walker DT-2026 gap closure — Phases 0–5 (Connect→Collect→Store→Visualize)
- **CI:** 1 advisory check (`compose-mem-lint`) — ✅ success
- **Mergeable state:** blocked (needs review)
- **Caveats in PR body:**
  - RLS validated structurally but not under `factorylm_app` (covered by #1674)
  - Relay needs `NEON_DATABASE_URL` + `MIRA_IGNITION_HMAC_KEY` in Doppler
  - `037_tag_event_diffs` authored by a parallel session (on-plan, verified)

### PR #1674 — `feat/dt2026-rls-verification-1664` (base: `feat/dt2026-gap-closure`)
- **Title:** test(security): Phase 1 RLS integration tests for tag/trace tables (#1664)
- **CI:** no checks run yet
- **Mergeable state:** clean (stacked; merge #1657 first)
- **What it adds:** 6 RLS integration tests + `migration-verify.yml` widened to cover all of `tests/integration/`

---

## Recommended next actions (for driver or human)

### Human actions (immediately actionable)
1. Review + approve PR #1657 — the core Phase 0–5 delivery
2. After #1657 merges: trigger `apply-migrations.yml` on staging to promote 032–037
3. After staging verified: run `apply-migrations.yml` on prod
4. Review + merge PR #1674 (after #1657)

### Agent actions (next run, if ≤1 gap-closure PR remains open)
Priority order:
1. **#1662** — `kg_writer.py` → write through `relationship_proposals` helper (ADR-0017). Low blast radius. Independent of migrations.
2. **#1658** — wire `state["uns_context"]["source"]="direct_connection"` in `ignition_chat.py`. Independent of migrations.
3. **#1659** — citation enforcement mode + `TroubleshootingSession` lifecycle. Independent of migrations.
4. **#1663** — fix Hub `/proposals` to surface `ai_suggestions` (not just `relationship_proposals`). Soft-blocked on #1657 merge.

### Skip list (per routing rules)
- #1665 — ready-for-human, env-boundary gate
- #1661, #1660 — soft-blocked on migration 032/034 landing on main

---

## Constraints active

- Max 2 concurrent open gap-closure PRs — **currently at limit (2/2)**
- Never auto-verify KG edges (ADR-0017)
- Never break UNS confirmation gate
- Never touch prod psql or VPS docker compose
- Never use Anthropic as provider
- Conventional commits; PRs are non-draft; not merged by driver

---

## Audit trail

| Date | Run | Action |
|------|-----|--------|
| 2026-06-03 | First run (cloud env) | Status sync only; created this file + updated wiki/hot.md; at 2-PR limit |
