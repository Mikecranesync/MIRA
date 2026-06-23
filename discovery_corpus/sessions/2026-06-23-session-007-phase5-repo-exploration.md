# Session 007 — Deep repo exploration for FactoryLM/MIRA integration (Phase 5 design)

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 5 exploration)
**Class of work:** read-only repo exploration + integration design (NO implementation, NO migrations, NO new product code except reports)

> Mission: determine exactly how to wire the proven Phase 0–4 spine into the real FactoryLM Hub +
> MIRA without building a second product. Verify from repo evidence (file:line), do not assume.

---

## 1. Questions asked

Where should each spine part live inside the existing product? How does a customer upload evidence +
approve suggestions today? Where does the Phase 2/3 explanation plug in without a second chatbot? What
Ignition/HMI work already exists for ProveIt? Which objects map to existing tables / need migrations /
must not become new tables? What gates must Phase 5 pass? What is the smallest safe first PR?

## 2. Files / architecture inspected (existing MIRA repo, read-only)

5 parallel deep-dive sub-agents (after the 4.5 audit's 5):
- **Contextualization flow:** `api/contextualization/{route,[id]/sources,import,[id]/promote,batches/[id]/review}`, `lib/plc-proposals.ts`, `lib/suggestion-accept.ts`, `lib/proposals-writer.ts`, `lib/intake-contract.ts`.
- **MIRA seam:** `engine.py` (process_full/_make_result/_evidence_from_parsed/_schedule_decision_trace L1062–1363), `decision_trace.py`, `ignition_chat.py` envelope, `decision-trace/[id]/route.ts`, `WhyMiraThinksThis.tsx`, `citation_compliance.py`.
- **Ignition/HMI/PLC:** `plc/ignition-project/ConvSimpleLive/.../views/{MaintenancePanel,MiraAsk,AnomalyCard}`, `plc/conv_simple_anomaly/`, `ignition/webdev/FactoryLM/api/{diagnose,chat}`, `command-center`, `docs/plans/2026-06-22-proveit-2027-demo-runbook.md`.
- **Tests/gates:** `.github/workflows/{ci,migration-verify,staging-gate,smoke-test,hub-e2e,version-gate,kg-write-guard,proposal-state-canary}.yml`, `mira-hub` vitest config, `tests/integration/`, `tests/canary/`.

## 3. Assumptions tested

| # | Assumption | Result |
|---|---|---|
| A1 | The spine's FactoryModel has no Hub writer. | **CONFIRMED** → no writer; but `plc-proposals.ts` is the exact template + `/api/contextualization/import` header says **"P5 migrates the offline client onto the contract."** |
| A2 | The answer-card "hard" fields are already stored in `decision_traces` (4.5 claim). | **FAILED** → `context_ignored`/`next_check`/`decision_path` are **comment-only** (`WhyMiraThinksThis.tsx:21-22`), zero columns/code. Only `confidence` is a real column (mig 055). Need a new `explanation` JSONB. |
| A3 | `explain_cause` should be a transform in `ignition_chat`. | **FAILED** → that serves only Ignition + duplicates evidence shaping. Correct seam = pure post-processor in `engine.py:_schedule_decision_trace` (post-reply, fire-and-forget) → `decision_traces.explanation`. |
| A4 | `needs_review` is a simple `ADD COLUMN`. | **FAILED** → it's a `status` *value*; `ai_suggestions.status` has a 5-value CHECK (mig 027:86) → a DROP/ADD CONSTRAINT migration. |
| A5 | The Ask-MIRA HMI must be built. | **FAILED** → MaintenancePanel/MiraAsk/AnomalyCard + `ignition_chat` all BUILT; the gap is a one-line rewire (MiraAsk button → `/api/v1/ignition/chat` instead of bench `/ask`). |
| A6 | `mira-relay` can host the MQTT ingest. | **FAILED (confirmed from 4.5)** → relay is HTTP-only; no `mqtt_ingest`. (Transport deferred regardless.) |
| A7 | Merging is straightforward. | **PARTIAL** → phantom `Hub E2E` required-check → all merges need `--admin`; frozen-lockfile forbids bumping `mira-hub/package.json`; UUID-tenant trap in fixtures. |

## 4. Failed assumptions (the load-bearing corrections)

- **The answer-card fields are NOT parked columns** — they're deferred comments. This changes the DB plan (one new `explanation` JSONB) and the framing (the card is genuinely net-new, realized inside the engine).
- **`needs_review` is a CHECK swap, not a column add** — and if it becomes a *transition target* it must enter ADR-0017 (`proposal-transition.ts` + the Python helper + the canary), else the nightly canary drifts red.
- **Relationships have no ingestion writer** — the Intake Contract drops `proposed_relationships`; `relationship_proposals` requires both entities to exist first → a **second** PR (post-approval resolver), not part of the first.

## 5. Conclusions

- **Hub:** first PR = `factory-model-proposals.ts` (mirror `plc-proposals.ts`) → `ai_suggestions` (assets `kg_entity`, signals `tag_mapping`) + a `needs_review` CHECK migration. Accept path unchanged. Relationships = PR-2.
- **MIRA:** `explain_cause` pure post-processor in `_schedule_decision_trace` → new `decision_traces.explanation` JSONB; render in `WhyMiraThinksThis` + populate the empty `ignition_chat` envelope. No second endpoint/LLM. Bots-side: extend `recall_knowledge` to select mig-045 page/section.
- **Ignition:** reuse the built panel; rewire the Ask button to `/api/v1/ignition/chat`; fence the legacy VFD writes; defer WebDev install / live PLC / Sparkplug / OPC-UA.
- **DB:** two tiny idempotent migrations total (one CHECK swap, one JSONB column); no new tables.
- **Gates:** Version Gate (bump `/VERSION` only), Hub Unit Tests (vitest), Migration Verify (staging Neon — the real catch), Staging Gate, Smoke, Hub E2E (`--admin`), KG Write Guard, Migration Order. Add a vitest unit test (mock client) + a Python integration assertion.

## 6. Reusable architecture findings

The 8 reports ARE the artifact: `reports/phase5_repo_exploration/{repo_map, spine_to_platform_mapping,
hub_integration_plan, mira_integration_plan, ignition_hmi_reuse_plan, db_migration_plan,
phase5_recommended_first_pr, do_not_duplicate}.md`. Canonical seams to remember:
`plc-proposals.ts` (parser-IR→suggestions template), `suggestion-accept.ts` (accept→materialize),
`_schedule_decision_trace`/`build_trace_row` (explanation seam), `decision_traces.explanation` (storage),
`WhyMiraThinksThis.tsx` (card UI), `ignition_chat.py` envelope (Ignition render + direct_connection),
MiraAsk button rewire (HMI). The one schema change: `needs_review` on `ai_suggestions`. The one net-new
capability: the `explanation` field (ranked + for/against).

## 7. Final answer

**Spine = parallel codebase, NOT a second product; one integration layer from merged.** Recommended
sequence: **PR-1 Hub writer + `needs_review`** → **PR-2 relationship resolver** → **PR-3 MIRA `explanation`
field + render** → (later) Ignition button rewire → (later) MQTT subscriber adapter. **Defer** live PLC,
Sparkplug, OPC-UA, Modbus, dashboards, real-factory pilot. Smallest first PR fully specified in
`phase5_recommended_first_pr.md` (files, tests, gates, risks, rollback, acceptance).

## 8. Tests / fixtures added

None — exploration/design only. No code, no migrations, no package changes, no licensed data. Phase 0–4
gates (76 tests) untouched. Deliverable = the 8 reports + this session.

## 9. Verification pass (direct repo reads, not just agent claims)

Spot-checked the load-bearing first-PR + MIRA-seam references against the actual repo — all **verified
exact**: `plc-proposals.ts:66/135`, the `ai_suggestions` INSERT shape (`plc-proposals.ts:151-157`,
status hardcoded `'pending'` → the new writer needs a per-row status to emit `needs_review`),
`suggestion-accept.ts:57/111/155/186/188`, `027_ai_suggestions.sql:87` (5-value CHECK, no `needs_review`),
the "P5 migrates the offline client" comment (`contextualization/import/route.ts:27`), `engine.py:1062/
1093/1292` + `decision_trace.py:112`, and **no** existing factory-model writer / **no** `explanation`
column today. **One correction made:** the version-bump guidance. `mira-hub/AGENTS.md` requires bumping
**both** `/VERSION` and `mira-hub/package.json` for a schema-migration PR; the prior memory
`feedback_mira_hub_pkg_version_frozen_lockfile` ("never bump package.json") is **stale** — `mira-hub/
bun.lock` (lockfileVersion 1) carries the workspace root with `name` only and **no `version`**, so a
version-only bump is lockfile-safe. Captured in `reports/phase5_repo_exploration/verification.md`;
`phase5_recommended_first_pr.md` corrected (3 spots). A8 (version-bump assumption) → **FAILED/corrected**.
