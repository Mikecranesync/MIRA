# MIRA — Current-State Gap-Closure Plan (Walker DT-2026 Alignment)

**Status:** Phase 0–5 + RLS tests complete (in PRs #1657 / #1674 — pending merge due to migration-number collision with main)
**Last updated:** 2026-06-04 (gap-closure driver run — cloud session)
**Authored:** 2026-06-02
**Owner:** Lead systems architect (gap-closure work stream)
**Governs:** the gap-closure work stream closing gaps in
`docs/plans/2026-06-01-mira-master-architecture-plan.md` (PRIMARY FOCUS).

> **Note:** The full component-level audit lives on the `feat/dt2026-gap-closure` branch at
> `docs/plans/current-state-gap-closure-plan.md` (same path, richer content). This file is
> the main-branch status tracker; it will be superseded by the branch version when #1657 merges.

---

## 1. Phase completion status

| Phase | Description | Status | PR/Issue |
|---|---|---|---|
| **0** | Repo truth audit (`docs/plans/current-state-gap-closure-plan.md`) | ✅ Done | PR #1657 (pending merge) |
| **1** | Schema: Hub migrations 032–037 (`decision_traces`, `tag_events`, `flaky_input_signals`, `approved_tags`, `current_tag_state`, `tag_event_diffs`) | ✅ Done | PR #1657 (pending merge) |
| **2** | Tag ingest API: `POST /api/v1/tags/ingest` on mira-relay (HMAC, allowlist, UNS, atomic) | ✅ Done | PR #1657 (pending merge) |
| **3a** | Ignition collector: signed `tag-stream.py` rewrite + `collector.py` pure module | ✅ Done | PR #1657 (pending merge) |
| **4** | Command Center tag-freshness (live/stale/unknown/simulated from `current_tag_state`) | ✅ Done | PR #1657 (pending merge) |
| **5** | Tag diff logger: `tag_diff_logger.py` + migration 037 meaningful-change stream | ✅ Done | PR #1657 (pending merge) |
| **RLS** | Integration tests for tag/trace tables under `factorylm_app` role | ✅ Done | PR #1674 (stacked on #1657) |
| **6** | direct_connection UNS bypass on Ignition chat path | 🔴 Not started | Issue #1658 (ready-for-agent) |
| **7** | Citation enforcement + troubleshooting-session lifecycle | 🔴 Not started | Issue #1659 (ready-for-agent, depends on Phase 6) |
| **3b** | `kg_writer` proposal-transition helper (stop auto-verifying edges) | 🔴 Not started | Issue #1662 (ready-for-agent) |
| **3c** | `/proposals` must render `ai_suggestions` | 🔴 Not started | Issue #1663 (depends on #1662) |
| **8** | DecisionTraceWriter + `/decision-traces` Hub page | 🔴 Not started | Issue #1660 (ready-for-agent) |
| **9** | Flaky-input detector (wedge demo) | 🔴 Not started | Issue #1661 (ready-for-agent) |
| **Deploy** | Promote migrations 032–039 to staging→prod + seed allowlist | 🟡 Human action | Issue #1665 (ready-for-human) |

---

## 2. Current blockers

### B1 — Migration number collision (blocks #1657 merge)

Main landed PR #1688 which added Hub migrations 030–033. Gap-closure PR #1657 also has migrations 032–037. Migrations 032 and 033 collide.

**Required rebase steps:**
1. `git fetch origin main && git rebase origin/main` on `feat/dt2026-gap-closure`
2. Rename migrations: 032 → 034, 033 → 035, 034 → 036, 035 → 037, 036 → 038, 037 → 039 (verify with `ls mira-hub/db/migrations/ | sort | tail -5` after fetch)
3. Update all cross-references to these numbers
4. Resolve `.github/workflows/ci.yml` concurrency block (both main and branch added `concurrency:` at the same position — keep main's version, drop branch duplicate)
5. Resolve `wiki/hot.md` three-way merge
6. Force-push branch, verify CI triggers

### B2 — PR #1674 stacked on #1657

#1674 (RLS tests) is based on `feat/dt2026-gap-closure`, not `main`. It cannot merge until #1657 merges. After #1657 merges + rebases, #1674 needs its base changed to `main` and `git rebase origin/main` applied.

---

## 3. Walker DT-2026 pipeline status at a glance (as of 2026-06-04)

Based on the Phase 0 audit (full detail on `feat/dt2026-gap-closure` branch):

| Stage | Status | Worst open gap |
|---|---|---|
| **Connect** | ✅ BUILT (Ignition WebDev → relay, HMAC) | `tag-stream.py` unsigned → fixed in #1657 |
| **Collect** | ✅ BUILT (versioned ingest API + allowlist + provenance) | Done in #1657 |
| **Store** | ✅ BUILT (migrations 032–039 once renumbered) | Migration collision → rebase needed |
| **Analyze** | ⚠️ PARTIAL | direct_connection bypass missing (#1658); citation compliance observe-only (#1659) |
| **Visualize** | ⚠️ PARTIAL | CC freshness done (#1657); `/proposals` only shows `relationship_proposals` not `ai_suggestions` (#1663) |
| **Pattern** | ⚠️ PARTIAL | kg_writer auto-verifies (#1662); flaky detector missing (#1661) |
| **Report** | ⚠️ PARTIAL | `decision_traces` table exists (#1657); writer not wired (#1660) |
| **Solve** | ✅ BUILT | CMMS tools + Atlas adapter functional |

---

## 4. Acceptance criteria for "Phase 0–5 merged"

- [ ] `feat/dt2026-gap-closure` rebased on `origin/main`, migrations renumbered (034–039)
- [ ] CI green: `apply-and-verify`, `Eval Offline`, `Docker Build Check` all pass
- [ ] PR #1657 merged to `main`
- [ ] PR #1674 rebased on `main` → CI green → merged
- [ ] Issue #1665 actioned: migrations promoted to staging, smoke tested, then prod

---

## 5. Next-issue ordering once PRs merge

1. **#1658** — Phase 6: direct_connection UNS bypass (unblocks Phase 7)
2. **#1662** — Phase 3: kg_writer proposal-transition helper (independent, unblocked now)
3. **#1659** — Phase 7: citation enforcement (depends on #1658)
4. **#1663** — /proposals ai_suggestions render (depends on #1662)
5. **#1660** — Phase 8: DecisionTraceWriter
6. **#1661** — Phase 9: flaky-input detector
