# TASK — CHARLIE queue 2026-07-11 (cohesion-gap execution)

**Why:** BRAVO is executing the Drive Commander money-path build (Ollama restart, G120 pack, fault-lookup funnel, #2438 test, dogfood extension, chores). Mike is on wiring diagrams (PLC laptop). CHARLIE takes the non-colliding remainder of the 2026-07-11 audit (`wiki/orchestrator/STATE.md`): hygiene, docs cohesion, and Hub-side wiring support.
**SSoT:** `wiki/orchestrator/STATE.md` (this run), issues referenced per task.
**Ground rules for every subagent:** work in an own worktree branched off `origin/main` (never the shared checkout — it has uncommitted work and is 92 behind), draft PRs only (never merge), conventional commits, bump `/VERSION` on code PRs, verify every symbol/file claim against origin/main before acting.

| # | Task | Scope | Acceptance (pass/fail) |
|---|---|---|---|
| C0 | Verify-and-close sweep | gh issues/PRs only, no code | #2439/#2440/#2441/#2360 each verified at file:line on origin/main then closed w/ evidence comment (or left open w/ findings if NOT verified); RBAC Phase 2 issue filed; #2454 closed as explicit PARK; stale draft promo-director PRs closed |
| C1 | Promo-director cadence fix | discovery + smallest change | The daily COMPETITOR_ANALYSIS draft-PR automation located (node + trigger identified); cadence changed to weekly-if-material-diff via draft PR, or exact operator instructions written if the trigger lives off-repo |
| C2 | One-product-story docs PR | NORTH_STAR.md, docs/README, docs/product/what-is-mira.md, docs/product/mira_prd_v2.md | Draft PR: beta-gate claim scoped to what main proves (Hub NodeChat/staging), stale read-only claim corrected (v3.26.1), legacy copilot/whole-plant framings rewritten to point at the Drive Commander wedge (#2504/#2577) |
| C3 | 90-day MVP rescope proposal | docs/plans/2026-04-19-mira-90-day-mvp.md + comment on #2447 | Rescope comment posted on #2447 marked PROPOSED (Mike ratifies); plan doc header updated to PARK Units 3/5/7/8 + pointer to wayfinder #2577; draft PR |
| C4 | Wiring review surface (#2605) | mira-hub: route LLM-derived wiring_connections rows through ai_suggestions + approve path (mig-026 follow-up, ADR-0017 helpers) | Draft PR with tests green locally; status transitions ONLY via proposal-transition helpers; no direct `UPDATE … SET status`; migration (if any) follows .claude/rules/mira-hub-migrations.md |

**Not CHARLIE's (explicitly):** anything in mira-web/drive-packs (BRAVO), Stripe dashboard + DOPPLER_TOKEN + merges (Mike), mira-sidecar 398-chunk migration (prod write — gated, needs Mike's go), Bravo Ollama (BRAVO itself).
