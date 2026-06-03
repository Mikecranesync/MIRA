# Gap-Closure Plan — Current State

**Epic:** #1666 — DT-2026 gap closure → North Star: grounded, UNS-gated maintenance copilot
**Master plan:** `docs/plans/2026-06-01-mira-master-architecture-plan.md`
**Last updated:** 2026-06-03 (gap-closure driver, run 2)

---

## 1. What shipped — Phases 0–5 (PR #1657 — open, CI in progress)

Branch: `feat/dt2026-gap-closure`

| Phase | Capability | Status |
|---|---|---|
| 0 | Discovery & baseline (this doc) | ✅ |
| 1 | Schema: `032_decision_traces`, `033_tag_events`, `034_flaky_input_signals`, `035_approved_tags`, `036_current_tag_state_freshness`, `037_tag_event_diffs` | ✅ (migrations on branch) |
| 1 | `DecisionTraceWriter` class (`mira-bots/shared/decision_trace.py`) | ✅ |
| 2 | `POST /api/v1/tags/ingest` endpoint on mira-relay | ✅ |
| 2 | UNS topic map (`mira-crawler/ingest/uns_topic_map.py`) | ✅ |
| 3 | Ignition gateway tag collector (`ignition/gateway-scripts/tag-stream.py`) | ✅ |
| 3 | Ignition WebDev collector endpoint (`ignition/webdev/FactoryLM/api/tags/collector.py`) | ✅ |
| 4 | Command Center tag-freshness widget (`mira-hub/src/lib/command-center-freshness.ts`) | ✅ |
| 4 | `mira-pipeline/ignition_chat.py` — `uns_context.source` injection stub | ✅ |
| 5 | `mira-relay/flaky_detector.py` — flaky-input detector | ✅ |
| 5 | ADR-0022 (`docs/adr/0022-decision-trace-and-tag-stream-storage.md`) | ✅ |

**PR #1657 CI state (as of 2026-06-03 run 2):**
- ✅ Unit Tests, Lint, Security Scan, Architecture Check, License Check, Staging-gate, DeepEval
- ❌ `apply-and-verify` — fixed twice: (1) `032_decision_traces` `ts` column (`a4df7a3`), (2) `033_tag_events` `event_timestamp` column (`49bf0f1`)
- ❌ `E2E smoke (factorylm.com)` — expected failure in cloud CI (no VPS access), not a regression
- ⏳ `Eval Offline`, `Docker Build Check` — queued (re-triggered after latest push)

---

## 2. Open gap-closure issues (epic #1666 children)

| # | Title | Phase | Priority | State | Notes |
|---|---|---|---|---|---|
| #1664 | Verify RLS on tag/trace tables under factorylm_app role | P1 | P2 | PR open (#1674) | Stacked on #1657; needs #1657 merged first |
| **#1658** | **Phase 6 — Wire direct_connection UNS bypass on Ignition chat path** | **P6** | **P1** | **ready-for-agent** | **Next issue after #1657 merges** |
| #1659 | Phase 7 — Citation enforcement + session lifecycle | P7 | P1 | ready-for-agent | Depends on #1658 |
| #1660 | Phase 8 — DecisionTraceWriter + /decision-traces | P8 | P2 | ready-for-agent | |
| #1661 | Phase 9 — Flaky-input detector (wedge demo) | P9 | P1 | ready-for-agent | |
| #1662 | Phase 3 — kg_writer proposal-transition helper | P3 | P1 | ready-for-agent | |
| #1663 | Solve: /proposals must render ai_suggestions (flywheel fix) | P3 | P1 | ready-for-agent | Depends on #1662 |
| #1665 | Promote migrations to staging→prod + seed allowlist | P1 | P1 | **ready-for-human** | Human action: migration promotion |

---

## 3. PR status

| PR | Branch | Issue | CI | Notes |
|---|---|---|---|---|
| #1657 | `feat/dt2026-gap-closure` | #1666 (Phases 0–5) | ⚠️ 2 pending, 1 recurring failure (E2E smoke) | Gap-closure PR 1/2 |
| #1674 | `feat/dt2026-rls-verification-1664` | #1664 | No checks (stacked on #1657) | Gap-closure PR 2/2 — stacked |
| #1687 | `docs/gap-closure-driver-2026-06-03` | status sync | — | This doc |
| #1679 | `docs/gap-closure-status-sync-2026-06-03` | status sync | — | Earlier status sync |

**Gap-closure PR count: 2/2 (at limit). Do not open more until one merges.**

---

## 4. Schema refinement notes

### 4.1 `tag_events` column naming
The master plan appendix D2 used `ts` for the event timestamp. The implementation (`033_tag_events.sql`) uses `event_timestamp` for clarity. The staging NeonDB had the old schema from a previous CI run. Both `032_decision_traces.sql` and `033_tag_events.sql` now have idempotency DO blocks to handle the rename.

### 4.2 Migration number collisions
Main branch has `032_inferred_relationship_types.sql` and `033_kg_query_traces.sql`. PR #1657 adds `032_decision_traces.sql` and `033_tag_events.sql` (same number prefixes). The migration runner applies both alphabetically; both can coexist since table names differ. The collisions are not blocking but should be cleaned up in a follow-on PR by renumbering the gap-closure migrations to 038–043.

### 4.3 `approved_tags` migration (Phase 4 requirement)
Migration `035_approved_tags.sql` is on the branch. The `approved_tags.json` file-based allowlist still exists; dual-write cutover is required before removing the JSON file. Track in issue #1665.

---

## 5. Architecture guardrails (non-negotiable)

- **UNS location confirmation gate** — `engine._should_fire_uns_gate()` at `mira-bots/shared/engine.py:4541`. Never bypass for non-`direct_connection` sources.
- **direct_connection bypass** — `ignition_chat.py` must set `state["uns_context"]["source"]="direct_connection"` + `confidence="certified"` before calling `engine.process()`. #1658.
- **No auto-verify KG edges** — `proposed → verified` is always a human action (ADR-0017).
- **No Anthropic provider** — inference cascade is Groq → Cerebras → Gemini only.
- **No prod psql / VPS docker compose** — `prod-guard.sh` enforces.

---

## 6. Next action (when CI on #1657 turns green)

1. Both gap-closure PRs (#1657 + #1674) will be open with no failures → stop condition "2 open and green but unmerged."
2. Wait for human review + merge of #1657.
3. After #1657 merges: rebase #1674 onto main, verify RLS tests pass.
4. After #1674 merges: open next gap-closure PR for **#1658** (Phase 6 UNS bypass).

**Never exceed 2 concurrent open gap-closure PRs.**
