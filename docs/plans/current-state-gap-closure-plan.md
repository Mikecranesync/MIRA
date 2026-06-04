# MIRA — Current-State Gap-Closure Plan

**Governing epic:** #1666 — DT-2026 gap closure → North Star: grounded, UNS-gated maintenance copilot to first paying customer
**Master plan:** `docs/plans/2026-06-01-mira-master-architecture-plan.md`
**Last updated:** 2026-06-04 by gap-closure-driver routine

---

## 1. Shipped (Phases 0–5) — PR #1657

Branch `feat/dt2026-gap-closure`, open PR targeting `main`. All 22 CI checks cancelled by concurrency guards added in #1692 to main. Status: **mergeable once CI re-triggered and passes**.

### 1.1 Phase 0 — Repo truth audit
- `docs/plans/current-state-gap-closure-plan.md` (this file) — 8-stage audit, every component status-labeled with file/PR evidence.
- Corrects 2 master-plan errors: HealthScoreWidget IS built; `/plc` page MISSING from Hub.
- Status: **✅ DONE** (shipped in PR #1657)

### 1.2 Phase 1 — Schema (Hub migrations 032–037)
Hub migrations applied to ephemeral postgres (not yet staging):

| Migration | Table | Status |
|---|---|---|
| 032 | `decision_traces` | ✅ authored in PR #1657 |
| 033 | `tag_events` | ✅ authored in PR #1657 |
| 034 | `flaky_input_signals` | ✅ authored in PR #1657 |
| 035 | `approved_tags` | ✅ authored in PR #1657 |
| 036 | `decision_trace_session_link` (ALTER on `troubleshooting_sessions`) | ✅ authored in PR #1657 |
| 037 | `tag_event_diffs` (diff stream table) | ✅ authored in PR #1657 |

ADR-0022 (`decision-trace-storage`) authored.
RLS policies: created under superuser in the migration. **Cross-tenant isolation under `factorylm_app` role NOT yet verified** (see §2.1, Issue #1664).

### 1.3 Phase 2 — Ingest API
- `POST /api/v1/tags/ingest` on `mira-relay`: HMAC-verified, fail-closed allowlist, UNS resolve, append `tag_events` + atomic upsert `live_signal_cache`.
- 66 pytest green, ruff clean.
- Status: **✅ DONE** (shipped in PR #1657)

### 1.4 Phase 3 — Ignition collector
- `api/tags/collector.py`: pure, reuses signing+allowlist. Rewrote previously-unsigned `tag-stream.py` → HMAC + Phase 2 contract + retry/backoff, read-only.
- 24 collector tests; Ignition suite 74/74.
- Status: **✅ DONE** (shipped in PR #1657)

### 1.5 Phase 4 — Command Center tag freshness
- "Live" = tag freshness (live/stale/unknown/simulated) from `current_tag_state`; HTTP reachability as separate status.
- 16/16 bun tests; `tsc` clean.
- Status: **✅ DONE** (shipped in PR #1657)

### 1.6 Phase 5 — Tag diff logger
- `tag_diff_logger.py` + migration `037_tag_event_diffs`: meaningful-change stream (edges/threshold-cross/quality) from raw `tag_events`.
- 14 tests pass.
- Status: **✅ DONE** (shipped in PR #1657)

---

## 2. In Progress

### 2.1 Issue #1664 — RLS verification under factorylm_app role
- **P2, security, ready-for-agent**
- **PR #1674** open on branch `feat/dt2026-rls-verification-1664`
  - Adds `tests/integration/test_rls_tag_trace_tables.py` — 6 tests for cross-tenant isolation
  - Updates `.github/workflows/migration-verify.yml` to cover the full `tests/integration/` dir
  - Based on PR #1657 (`feat/dt2026-gap-closure`) — stacked PR
  - CI: 0 check runs, status=pending, `mergeable_state=dirty` (conflict because base hasn't merged)
- **Blocked by:** PR #1657 must merge to main first; then #1674 can rebase cleanly
- Status: **⚠️ BLOCKED** (waiting on #1657 merge)

---

## 3. Not Started — Ordered by dependency-true critical path

### 3.1 Issue #1658 — Phase 6: direct_connection UNS bypass on Ignition chat path
- **P1, ready-for-agent** — NEXT UP for agent
- `grep direct_connection mira-pipeline/*.py` = 0 hits; `.claude/rules/direct-connection-uns-certified.md` is specified but not implemented
- `mira-pipeline/ignition_chat.py:203` calls `engine.process()` through the full chat-gate — this is a bug
- **Acceptance:** Ignition turn w/ asset_context → straight to grounded diagnosis (no card). Missing asset_context → 422. Hallucination audit flags 0 new violations.
- **Dependencies:** None (can start once #1657 merges and provides schema foundation)

### 3.2 Issue #1659 — Phase 7: citation enforcement + troubleshooting-session lifecycle
- **P1, ready-for-agent**
- `citation_compliance.py:7,54` is observe-only ("never blocks a response")
- `troubleshooting_sessions` table exists (Hub 019) but no open/close/timeout lifecycle wired
- **Dependencies:** Depends on #1658 (Phase 6) — must confirm context before session opens

### 3.3 Issue #1660 — Phase 8: DecisionTraceWriter + /decision-traces admin page
- **P2, ready-for-agent**
- `decision_traces` table exists (migration 032, PR #1657). No writer.
- `Supervisor.process_full` has a `trace_id` from Langfuse wrapper that is None when `LANGFUSE_SECRET_KEY` unset (prod default).
- **Dependencies:** None (schema is available once #1657 merges)

### 3.4 Issue #1661 — Phase 9: flaky-input detector (wedge demo)
- **P1, ready-for-agent**
- `flaky_input_signals` table exists (migration 034, PR #1657). Detector: `codegraph_search('flaky_input_detector')` = 0.
- **Dependencies:** Phase 5 done (PR #1657). Independent of #1658/#1659.

### 3.5 Issue #1662 — Phase 3: kg_writer proposal-transition helper
- **P1, ready-for-agent**
- `kg_writer.py:144` writes `kg_relationships` DIRECTLY at confidence 1.0, bypassing `relationship_proposals`
- ADR-0017 helpers `proposal_transition.py` / `proposal-transition.ts` do not exist (verified-absent)
- **Dependencies:** None (independent of Phase 6/7 work)

### 3.6 Issue #1663 — /proposals must render ai_suggestions (flywheel fix)
- **P1, ready-for-agent (bug)**
- `mira-hub/src/app/api/proposals/route.ts:127` reads ONLY `relationship_proposals`
- `ai_suggestions` rows of 5 types never surface to reviewers
- **Dependencies:** Depends on #1662 (proposal-transition helper must exist first)

### 3.7 Issue #1665 — Promote migrations staging→prod
- **human-only**
- Must be done by Mike after #1657 merges and is validated on staging
- **Skip for agent**

---

## 4. Verified-absent items (from Phase 0 audit in PR #1657)

| Item | File | Status |
|---|---|---|
| `direct_connection` source in ignition_chat.py | mira-pipeline/ignition_chat.py | ❌ not implemented |
| `proposal_transition.py` | mira_bots/shared/ | ❌ not implemented |
| `proposal-transition.ts` | mira-hub/lib/ | ❌ not implemented |
| `flaky_input_detector.py` | mira-bots/agents/ | ❌ not implemented |
| `decision_trace.py` (writer) | mira-bots/shared/ | ❌ not implemented |
| `/plc` Hub page | mira-hub/src/app/plc/ | ⚠️ check current state |
| Citation enforcement mode | citation_compliance.py | ❌ observe-only |
| `troubleshooting_session.py` lifecycle wrapper | mira-bots/shared/ | ❌ not implemented |

---

## 5. Completion order (recommended)

Once PR #1657 merges to main and #1674 merges (RLS verification):

1. **#1658** (Phase 6 — direct_connection bypass) — independent P1
2. **#1662** (Phase 3 — kg_writer proposal helper) — independent P1, high impact
3. **#1659** (Phase 7 — citation enforcement) — depends on #1658
4. **#1663** (/proposals fix) — depends on #1662
5. **#1660** (Phase 8 — DecisionTraceWriter) — P2, independent
6. **#1661** (Phase 9 — flaky detector, wedge demo) — P1, independent

---

## 6. Blocked by human action

- **PR #1657 CI re-trigger**: Push a trivial commit to `feat/dt2026-gap-closure` or re-run via GitHub Actions UI. All 22 checks were cancelled by the concurrency guards added in #1692.
- **PR #1657 merge**: Human review + merge to main. This unblocks everything above.
- **Migration promotion** (#1665): Staging → prod (human-only, after #1657 merges).
