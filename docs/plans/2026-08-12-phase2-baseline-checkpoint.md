# Phase 2 Baseline Checkpoint — Equipment Notebook (2026-08-12)

**Status:** Phase 1 (NotebookLM-style equipment workflow) is clean, stable, reproducible,
and production-verified. This document is the starting line for Phase 2.

**Rollback point:** `rollback/2026-08-12-v3.261.3` (= `63595ee2a`, the build the 11/11
mobile loop was verified against). Every subsequent merge auto-tags its own rollback
checkpoint (`docs/versioning.md`).

---

## Known-good product state (production-verified, not assumed)

Verified on `app.factorylm.com` (mobile 412×915, fresh trial account, deployed build
confirmed via `/api/health` gitSha BEFORE testing — qa-skill discipline):

signup → notebook create → PDF upload → indexed → grounded answer (`Q141 set to 7…`) →
**normalized inline citation chip** (zero fullwidth `【】` in DOM) → citation tap →
correct document at correct page (`?page=1`, `Cited page 1`, iframe anchor) →
conversation + citation persist across reload → zero console errors.

**11 pass / 0 fail / 0 skip.** Evidence: PR #3189 comment (2026-08-12) +
`docs/promo-screenshots/2026-08-12_notebook-prod-rerun_*.png`.

## Architecture state (the components that own each concern)

| Concern | Where it lives |
|---|---|
| Ingestion (upload → chunks) | `mira-hub/src/lib/local-upload.ts` (+ `NoExtractableTextError` honesty); dedup via `hub_uploads.content_sha256` (migration 072) |
| Source storage | `namespace_direct_uploads` (raw PDF bytes), `hub_uploads` (metadata), `knowledge_entries` (chunks, `is_private=true`, embed-on-write) |
| Retrieval | `mira-hub/src/lib/manual-rag.ts` (BM25 + hybrid read-filter) + `notebook-query.ts` (query expansion, exact-token lane, rerank — #3196) |
| Notebook chat / answer | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — answer-first cite-or-refuse, citation entailment, zero-citations-on-refusal |
| Citation normalization | `makeCitationNormalizer` (gpt-oss `【n】`→`[n]`), unit-pinned by `answer-hygiene.test.ts` (required `mira-hub-unit` check) |
| Source viewer | `equipment/[id]/source/[docId]/page.tsx` (`?page=N` + `Cited page N` + iframe `#page=` anchor) |
| Conversation history | `equipment_notebook_turns` (migration 073); client hydration fixed in the Gate-I pass |
| Auth / tenancy | `mira-hub/src/lib/users.ts` + `session.ts` (UUID-only); signup = `hub_tenants` + `tenants` mirror + `hub_users` (trial, 7d) |
| Production deployment | merge to main → `deploy-vps.yml` (gated on smoke) → `app.factorylm.com`; version derived from git tag (`version-tag.yml`) |
| QA | local: `mira-hub/tests/equipment/` (loop + 11-property adversarial + visual specs); prod: manual mobile loop per the qa skill; QA-tenant cleanup: `qa-cleanup.yml` (#3209) |

## Active model/provider configuration (after #3190 + #3192)

| Path | Primary | Fallbacks |
|---|---|---|
| Notebook chat (hub) | Groq `openai/gpt-oss-120b` | Cerebras `gpt-oss-120b` → Gemini `gemini-2.5-flash` |
| Hub classifier/cascade (`cascade.ts`) | Groq `openai/gpt-oss-20b` | Cerebras `gpt-oss-120b` → Gemini `gemini-2.5-flash` |
| Diagnostic engine (mira-bots) | Groq → Cerebras → Together cascade (no Anthropic — PR #610) | Open WebUI/Ollama local fallthrough |
| Staging-gate judge | Groq `openai/gpt-oss-120b` @ `reasoning_effort=medium`, confirmation re-draw on hard fail (#3207) | Cerebras → Gemini judge cascade |

gpt-oss law (reused 3×): reasoning burns completion tokens AND scales with input length;
tight `json_object` caps hard-fail 400 empty → size caps to input, gate `reasoning_effort`
on `"gpt-oss" in model` (memory: `reference_gpt_oss_groq_migration_traps`).

## Remaining technical debt (ranked)

**P0 — blocks users or development**
- *(none known after the 2026-08-12 stabilization pass)*

**P1 — reliability / velocity**
- Staging-gate judge variance (#3195): FIXED — #3207 merged (medium effort + confirmation re-draw, 3/3 live gate passes); watch a few days of PR traffic to confirm the flap rate is gone.
- CI critical path ~8.5 min/PR. #3208's `-n auto` attempt was REVERTED (#3211) — xdist workers hit a collection-time SQLite lock in `test_equipment_photo_memory.py` (race; first run passed). The ~2-min win is real but gated on per-worker DB isolation — issue #3212. License-cache win (~87s) retained. Other levers (job split, guard-job consolidation, merge queue re `strict: true`) = Mike's call.
- **#3213 (found BY the fixed judge):** the engine's no-docs F004 reply intermittently carries a fabricated `[Source:]` citation (citation-compliance render-pass defect + the known F004 retrieval miss). The gate now fails honestly when the engine emits it — expect occasional legitimate staging-gate reds on unrelated PRs until fixed. True positive; do not re-weaken the judge.
- `tests/eval` referential-spec over-abstention (F1) — owned by the notebook→copilot arc (#3201/#3202 follow-up).
- Nightly eval-fixer loop bypasses branch protection when its checkout is stale — PR #3154 (open, green) fixes the cron pull; recommended merge.
- DeepEval offline ±8-fixture variance (#3116) still causes advisory-check noise.

**P2 — worthwhile later**
- Windows-local dev: `botbuilder` missing (test_teams_adapter uncollectable), `test_active_learner` 3 local failures, `sitemap-drift`/`cmms-deploy-env` fail locally (all pass in CI — Linux is authoritative).
- ~740 pre-May remote branches still untriaged (issue #1566); 2 stashes in the main checkout; `C:\wt-tech-dataset-v0*` worktrees held under dataset-freeze doctrine.
- Notebooks have no DELETE route (cleanup rides `qa-cleanup.yml` instead).
- AGENTS.md in mira-hub still tells agents to bump `/VERSION`/package.json (both retired — stale doc).

## Phase 2 boundary

**Phase 2 is industrial-maintenance intelligence and conversation quality — NOT another
pass over the Notebook UI foundation.** The upload→retrieve→cite→view loop is proven and
regression-protected; treat it as a platform. Phase-2-shaped work already queued: multi-turn
conversation memory (#3201) and broad-question completeness (#3202) — both HELD, green,
conflict-free, awaiting Mike; then the F1 referential-spec retrieval work (table-aware).

## The verification recipe (repeat after any risky merge)

1. `curl https://app.factorylm.com/api/health` → gitSha must equal the intended main SHA.
2. Run the mobile loop (fresh `notebook-qa-*@factorylm.com` account — the prefix is
   system-tagged and cleaned by `qa-cleanup.yml`): upload
   `mira-hub/tests/equipment/fixtures/diagnostic-fixture.pdf`, ask
   *"What parameter resets the fixture device and what value?"* → expect `Q141`… + tappable
   citation chip → tap → `diagnostic-fixture.pdf` @ `Cited page 1` → reload → turn persists,
   zero console errors, zero `【` in DOM.
