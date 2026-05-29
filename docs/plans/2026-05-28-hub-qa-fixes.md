# Hub QA Fix Plan — `app.factorylm.com` (mira-hub)

**Date:** 2026-05-28
**Source:** QA Evaluation Report (Claude QA Engineer Mode), overall grade B− (74/100)
**Author:** Claude Code (BRAVO)
**Status:** PROPOSED — awaiting scope confirmation before execution

---

## 0. The one insight that reshapes everything

The QA report graded by **observed severity on prod**. That is not the same as **"real, fixable Hub code bug."** Two of the three highest-severity items are almost certainly **not code defects**:

- **Review Queue 500** — `src/lib/review-queue.ts::getReviewQueue` already wraps every data source (`fetchProposals`, cartoons, screenshots, audits) in individual `.catch() → []` handlers. No single source can bubble a 500. The only remaining throw paths are in `src/lib/tenant-context.ts::withTenantContext`: `pool.connect()`, `SET LOCAL ROLE factorylm_app`, or `set_config(...)`. → Likely a **prod environment gap** (`factorylm_app` role / RLS migration not applied to prod NeonDB) **or deploy lag** (prod running an older build from before the per-source `.catch()` hardening). Not a blind code edit.
- **Widespread 503 on `?_rsc=` prefetch** — every route's React Server Component prefetch returns 503 while pages still load via fallback. This is the signature of **server/proxy instability** (the documented VPS-OOM pattern, memory `project_vps_oom_docling`), not an application logic bug.

**Therefore the plan is reproduce-first, not edit-first.** Step 1 for the Critical/High items is to reproduce on staging/dev and read the real error — because (a) the local code may already be fixed and just undeployed, and (b) I am forbidden from psql-ing prod to confirm root cause (CLAUDE.md hard rule #1).

---

## 1. Triage table (QA finding → classification → verdict)

| # | QA finding | QA sev | Classification | Verdict / root cause |
|---|---|---|---|---|
| 1 | Admin Review Queue HTTP 500 | Critical | **Reproduce-first** | Local code is hardened; 500 source is `withTenantContext` (role/migration) or deploy lag. Confirm on staging before any edit. |
| 5 | Widespread 503 on all `?_rsc=` prefetch | High | **Infra / runtime** | VPS server/proxy instability (OOM pattern). Ops task: check container memory + logs first. No RSC code fix prescribed. |
| 2 | "monday context loading…" debug string | High | **Separate module** | Lives in `mira-scan-monday/frontend/src/App.jsx:46` — a monday.com marketplace micro-app, NOT mira-hub. Only shows transiently while the monday SDK loads; outside monday.com it cannot resolve. Severity is deployment-context-dependent. |
| 10 | Scan page light theme / no sidebar | Medium | **Separate module** | Same `mira-scan-monday` micro-app. The Hub's own `/scan` (`src/app/(hub)/scan/page.tsx`) is a different QR-scanner surface. Confirm what `app.factorylm.com/scan` actually serves. |
| 3 | Channels "0 connected" vs Atlas connected | High | **Real Hub bug (minor UI)** | `channels/page.tsx:296` `connectedCount` counts only the `connections` state object; the Atlas/CMMS card is rendered statically (lines ~405–413) and never added to that state. Counter undercounts. |
| 8 | Test/automation accounts in admin user list | Medium | **Real Hub bug (product)** | `playwright-probe@`, `e2e-trial-*`, `NeonDB Proof`, etc. visible in `admin/users`. Needs a filter/segregation rule. |
| 11 | Manufacturer dedup (Allen-Bradley vs Alien-Bradley) | Low | **Real data-quality (mira-crawler, not hub)** | OCR/extraction variants in the KB. Normalization belongs in the ingest pipeline (`mira-crawler/ingest/`), not the Hub render. |
| 13 | Proposals show "0 evidence" / all "by llm" | Low | **Likely demo data + possible real gap** | Confirm whether `relationship_evidence` rows are absent because seeds carry none (expected) vs. evidence not being attached on real proposals. |
| 14 | Feed stale (no activity 17+ days) / no staleness badge | Low | **Demo data + minor enhancement** | Feed dates (May 6–11) are demo seeds. A "stale data" indicator is a UX enhancement, not a bug. |
| 6 | 4 local assets vs 47 in Atlas CMMS | Medium | **Demo data — NOT a bug** | The 4 assets are Hub demo seeds (Stardust Racers ×2, TestSub, Garage Conveyor) from PR #1568/#1523; the 47 is the Atlas demo tenant. Expected divergence in a demo. |
| 7 | Two assets named "Stardust Racers" | Medium | **Demo data — NOT a bug** | Seeded duplicate (EQ-…071 / …072). Expected. |
| 9 | All 4 WOs overdue / generic "Issue: Stardust Racers" | Medium | **Demo data — NOT a bug** | Seeded work orders. Overdue because seed dates are static. |
| 12 | Trailing-slash API request duplication | Low | **Minor enhancement** | `/api/work-orders` vs `/api/work-orders/`. Tidy-up, not a bug. |
| — | No skeleton loaders (Feed, Proposals, WO) | Low | **Enhancement** | UX polish, not a ship-blocker. |
| — | No empty-state guidance ("—" everywhere) | Low | **Enhancement** | UX polish, downstream of demo data. |
| — | `/schedule` route 503 but not in sidebar | Low | **WIP route + 503 (#5)** | Route dir exists (`(hub)/schedule/`); unlinked. 503 is the same infra issue. |

**Net:** Of 14 numbered findings, **~3 are real Hub code/product bugs** (#3, #8, possibly #13), **2 are a separate module** (#2, #10), **2 are infra/ops** (#1 pending repro, #5), **4 are expected demo data** (#6, #7, #9, #14), and the rest are enhancements.

---

## 2. Workstreams (prioritized by "real, fixable Hub bug")

### WS-A — Reproduce & resolve the Critical/High runtime failures (do first; mostly NOT code)
1. **Review Queue 500:**
   - Reproduce on **staging** (`factorylm/stg`) or local dev with prod-shape schema. Hit `/api/admin/review/queue` and capture the `console.error("[api/admin/review/queue]", err)` output.
   - Branch on the error:
     - `role "factorylm_app" does not exist` → role/grant not provisioned on prod → fix via the migration/role-provisioning path (`apply-migrations.yml`), **not** a code edit.
     - `set_config` / RLS policy error → migration gap → same path.
     - No staging repro → **deploy lag**: prod is running pre-hardening code → fix = deploy current `main` via `deploy-vps.yml`.
   - Only if a genuine code defect surfaces: patch + golden/regression note + PR.
2. **503 on `?_rsc=` prefetch (+ `/schedule` 503):**
   - Ops, not code. On the VPS: check `mira-hub` container memory/limits and `docker logs` for OOM/restart loops (mirror the `mem_limit` fix from `project_vps_oom_docling`). Check the reverse proxy for RSC request handling/timeouts.
   - Output: either a compose `mem_limit`/healthcheck adjustment (PR to `docker-compose.saas.yml`) or a proxy config fix — decided by what the logs show.

### WS-B — Real Hub code/product bugs (surgical PRs, normal staging gate)
3. **Channels "0 connected" counter (#3):** include the statically-rendered Atlas/CMMS connection in `connectedCount` (or compute the header count from the same source of truth the cards render from). Single-file change in `channels/page.tsx`. Add a render test.
4. **Test-account filtering in admin/users (#8):** decide the rule (email pattern allowlist/denylist: `playwright`, `e2e-`, `*-test-*`, `NeonDB Proof`, `E2E Audit`) and a toggle to "show system accounts." Filter server-side in the users API, not just the client. Product decision embedded — default to hiding behind a toggle.
5. **Proposals "0 evidence" (#13):** confirm via staging query whether real (non-seed) proposals attach `relationship_evidence`. If seeds-only → document as expected. If real proposals lack evidence → trace the proposal-creation path (`relationship_proposals` + `relationship_evidence` writers) — that's a grounding bug worth a golden case.

### WS-C — Separate module: mira-scan-monday (scope confirmation needed)
6. **"monday context loading…" + theme (#2, #10):** First confirm what `app.factorylm.com/scan` serves. If it proxies the monday micro-app, the fix is in `mira-scan-monday/frontend/src/App.jsx` (guard/timeout the `getMondayContext()` await so the string resolves to a useful state outside monday.com). If the Hub should serve its own `(hub)/scan` QR page instead, the fix is a routing change in the Hub. Separate PR, separate module.

### WS-D — Data quality & enhancements (lowest priority; separate issues, not this sweep)
7. Manufacturer dedup/normalization in `mira-crawler/ingest/` (#11) — open as its own issue; it's an ingest-pipeline data-quality task.
8. Skeleton loaders, empty-state guidance, trailing-slash dedup, feed staleness badge — batch as a "Hub UX polish" issue.

---

## 3. Verification & deploy (respecting dev → staging → prod)

- **No prod psql, no direct VPS `docker compose`** (CLAUDE.md hard rules; `prod-guard.sh` enforced). Root-cause repro happens on **staging/dev**.
- Each WS-B code change: branch → PR → `smoke-test.yml` + relevant `tests/eval`/Hub tests pass → merge to `main` → `deploy-vps.yml` → smoke against `app.factorylm.com`.
- Migrations/role provisioning (if WS-A reveals one): `apply-migrations.yml` dry-run → apply, dev → staging → prod.
- **Screenshot rule:** any visible Hub UI change (Channels counter, admin users filter) → desktop + mobile screenshots to `docs/promo-screenshots/`.

---

## 4. Explicitly NOT doing (and why)

- ❌ "Fixing" the 4-vs-47 asset gap, duplicate Stardust Racers, overdue generic WOs, stale feed — **these are demo seeds**, working as designed for a demo tenant.
- ❌ Blind-editing the Review Queue route or adding RSC code for the 503 — both are likely environment/infra, confirmed only by staging repro + VPS logs.
- ❌ Touching prod directly to investigate.

---

## 5. Open decisions for the user (surface at review, don't block)

- **Execution scope:** full real-bug sweep (WS-A + WS-B + WS-C) vs. just Critical/High (WS-A) vs. plan-only.
- **Test-account filtering (#8):** hide-by-default-with-toggle (recommended) vs. hard-exclude vs. tag-and-keep-visible.
- **Scan (#2/#10):** is `app.factorylm.com/scan` *supposed* to be the monday micro-app, or the Hub's own QR page?
