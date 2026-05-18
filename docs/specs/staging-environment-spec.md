# Staging Environment Spec

**Version:** 1.0
**Last Updated:** 2026-05-18
**Owner:** Mike Harper / FactoryLM
**Status:** Initial design — implementation in this PR.

## Problem

The 2026-05-17 BM25 retrieval bug took ~8 hours to find and fix because there was no way to test the engine against real KB data before it touched production Telegram. Every code change to `mira-bots/shared/` ships straight to the only environment that has the chunks, the OEM corpus, and the real cascade.

The fix is a staging environment that runs the same engine, against a **zero-copy clone** of the production NeonDB (Neon branching), with its own Telegram bot token and its own Doppler config, gated by an automated 10-question test on every PR.

## Goal

Every PR to `main` runs an in-process Supervisor against a NeonDB staging branch and is **blocked from merging** if the bot's answer quality regresses by the rubric in `docs/specs/mira-answer-quality-standard.md`.

The 8-hour BM25 debug becomes a 5-minute CI failure.

The gate runs on every PR — no path filter. This costs ~3 min of CI per PR but guarantees the deploy-time verifier (`.github/workflows/deploy-vps.yml`) finds a Staging Gate result for the PR head SHA on every merge. Path-filtered gating combined with squash-merge would create commits on `main` with no associated run, breaking the deploy.

## Non-goals

- **Not a UI environment.** No staging mira-hub, no staging Atlas, no staging nginx. The staging bot exists to test the engine path, not the customer surface.
- **Not a load test.** 10 questions, not a benchmark.
- **Not a replacement for DeepEval.** See "vs existing eval surfaces" below.
- **Not a sandbox for arbitrary scripts.** The staging bot is for in-process Supervisor calls in CI plus a single-operator manual loop on CHARLIE — not multi-user.

## Prior art (one paragraph)

Vercel, Railway, and Render all expose preview environments as "branch ↔ env" — every PR gets an ephemeral copy of the app pointed at an ephemeral DB. The blocker for a solo founder copying that pattern verbatim is the DB clone: a full Postgres restore is slow and burns disk. NeonDB branching solves this — branches are copy-on-write and instant. The pattern we adopt is the same shape (PR-scoped test environment, NeonDB branch, CI gate before merge) minus the cloud preview URL — we don't need to expose staging publicly because the only consumer is `tools/staging_test.py` and one operator's Telegram. This keeps cost and ops surface to zero.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       PR opened to main                         │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │       .github/workflows/staging-gate.yml         │
       │                                                  │
       │  ubuntu-latest                                   │
       │   ├─ checkout                                    │
       │   ├─ python 3.12                                 │
       │   ├─ pip install (minimal: mira-bots deps)       │
       │   ├─ tools/staging_test.py                       │
       │   │    ├─ Supervisor (in-process)                │
       │   │    │    └─ neon_recall.recall_knowledge()    │
       │   │    │         └── NEON_STG_DATABASE_URL ──┐   │
       │   │    └─ judge via InferenceRouter (Groq)   │   │
       │   └─ post results as PR comment              │   │
       └──────────────────────────────────────────────┼───┘
                                                      │
                                                      ▼
                              ┌──────────────────────────────────┐
                              │     NeonDB — staging branch      │
                              │  (zero-copy clone of prod)       │
                              └──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CHARLIE (Mac Mini) — local                  │
│                                                                 │
│   docker-compose.staging.yml                                    │
│    ├─ mira-pipeline-staging  (port 9098, not 9099)              │
│    └─ mira-bot-telegram-staging  (@MiraStaging_bot)             │
│                                                                 │
│   Both read Doppler factorylm/stg → NEON_STG_DATABASE_URL       │
└─────────────────────────────────────────────────────────────────┘
```

### What lives where

| Concern | Location | Notes |
|---|---|---|
| Staging DB | NeonDB branch `staging` off `production` | Created by operator (one-time); refreshed weekly. Free tier. |
| Staging secrets | Doppler config `factorylm/stg` | Mirrors `factorylm/prd` except `NEON_DATABASE_URL` and `TELEGRAM_BOT_TOKEN`. |
| Staging compose | `docker-compose.staging.yml` (root) | Runs on CHARLIE for manual probe. Not on the VPS. |
| Staging test | `tools/staging_test.py` | Runs in CI (no docker); reads questions from `tools/staging_questions.yaml`. |
| CI gate | `.github/workflows/staging-gate.yml` | Triggers on PR to `main` touching engine paths. |
| Rubric | `docs/specs/mira-answer-quality-standard.md` | 1–5 scale, five dimensions, average ≥ 3.5. |
| Deploy gate | `.github/workflows/deploy-vps.yml` | Updated to wait on both Smoke Test and Staging Gate succeeding. |
| Runbook | `docs/runbooks/staging-environment.md` | One-time setup + day-to-day. |

### Why in-process, not via Telegram

The CI gate calls `Supervisor.process()` directly. Reasons:

1. **No bot account in CI.** Spinning up a real Telegram poller in GitHub Actions means a long-lived process and a token in repository secrets that we'd rather not.
2. **Determinism.** Telegram delivery latency adds variance. The unit-of-work we want to test is the engine — input message → engine reply.
3. **Speed.** In-process is ~3 s per question. End-to-end via Telegram is ~10 s with retries.

The staging Telegram bot (`@MiraStaging_bot`) still exists for **operator manual probe** — paste a screenshot at it on CHARLIE before pushing a controversial PR. CI does not use it.

### Why ubuntu-latest works (no Open WebUI needed)

The retrieval path used by `RAGWorker` calls `neon_recall.recall_knowledge()` directly against NeonDB (`mira-bots/shared/neon_recall.py:702`+). It does **not** require an Open WebUI knowledge collection for text queries. LLM calls go through `InferenceRouter` (Groq → Cerebras → Gemini cascade). So:

- `NEON_DATABASE_URL` → staging branch
- `INFERENCE_BACKEND=cloud`
- `GROQ_API_KEY` (and Cerebras / Gemini as fallback)
- `OPENWEBUI_BASE_URL` → unused dummy
- `KNOWLEDGE_COLLECTION_ID` → unused dummy
- `MIRA_DB_PATH` → temp SQLite file in CI workspace

Photo questions are out of scope for staging — they need Open WebUI + qwen-vl, which is not available in ubuntu-latest. The fixture is text-only.

## vs existing eval surfaces

| Surface | What it does | Why staging is different |
|---|---|---|
| `deepeval-ci.yml` (PR-triggered, offline) | Scores reference responses against canned questions, no live cascade, no DB. | Staging hits real NeonDB and real Groq cascade; catches retrieval and inference bugs DeepEval can't see. |
| `ci-evals.yml` (nightly + manual) | 5-regime test sweep; runs in dry-run by default. | Runs nightly, not on every PR. Doesn't block merges. |
| `tests/golden_factorylm.csv` (pytest) | Pinned-input → pinned-output golden cases. | Doesn't grade quality of the *answer*, only that the engine doesn't crash. |
| `tests/eval/watch_set.txt` (pre-commit) | Local watcher for engine smoke. | Runs locally only; no NeonDB; depends on the developer running it. |
| **`staging-gate.yml` (this spec)** | PR → real NeonDB → real cascade → rubric → block merge. | **Only surface that touches real data + real LLM on every PR.** |

The staging gate **adds**, it does not replace. DeepEval still runs (offline, free, fast). The staging gate runs in parallel (real-data, costs ~10 Groq tokens per PR).

## Test contract

`tools/staging_test.py`:

- Loads questions from `tools/staging_questions.yaml` (10 entries).
- Instantiates `Supervisor` with `NEON_STG_DATABASE_URL`, `GROQ_API_KEY`, `INFERENCE_BACKEND=cloud`.
- For each question, calls `await supervisor.process(chat_id=f"stg-{i}", message=q.message)`.
- Grades the reply via an LLM judge against the 5-dimension rubric (`docs/specs/mira-answer-quality-standard.md`). Judge is one Groq call returning 5 ints 1–5.
- Records: question, reply (truncated), 5 dimension scores, mean, pass/fail.
- Exit code:
  - `0` if all hard rules pass (no dim < 2, no safety == 1, mean ≥ 3.5, ≤ 2 questions below 3.0).
  - `1` otherwise.
- Outputs:
  - Console: human-readable table.
  - `tools/staging_results.json`: machine-readable for the PR comment job.

### The 10 questions (categories)

The fixture covers the failure modes we have seen — including BM25-shaped retrieval (the bug this spec exists to prevent):

1. **OEM+model+fault** — `PowerFlex 525 F004 troubleshoot`. Forces BM25 + structured fault lookup.
2. **OEM only, no fault** — `our SEW eurodrive is humming`. Forces vendor-anchored vector recall.
3. **Symptom, no OEM** — `motor tripped on overload three times today`. Tests query rewriter + abbrev expansion.
4. **UNS-gate trigger** — `line 2 conveyor is making a grinding noise`. Should ask for asset confirmation before troubleshooting.
5. **Safety keyword** — `the panel is arcing when I open the disconnect`. Must trigger safety call-out.
6. **Greeting** — `hey what can you do`. Must NOT hallucinate VFD parameters.
7. **Follow-up reference** — `you said check the wiring — which wire?`. Tests session-followup detection.
8. **Photo-less OCR claim** — `what does this fault code on the screen mean`. Reply must not claim to see a photo.
9. **Off-topic** — `what's the weather today`. Must redirect politely.
10. **CMMS context** — `last work order on line 3 said replace contactor — did that get done`. Tests CMMS tool path.

The exact wording lives in `tools/staging_questions.yaml`. New questions are added there with a category tag and a one-line note on what they exercise.

## Pass criteria (re-stated for the CI gate)

1. **Per-question:** no dimension < 2, safety dimension ≠ 1.
2. **Aggregate:** mean of means ≥ 3.5.
3. **Distribution:** at most 2 of 10 questions may have a per-question mean < 3.0.

Failures post a PR comment listing the failing question(s), the rubric breakdown, and the truncated reply.

## Deploy gating

`deploy-vps.yml` still triggers on `workflow_run: ["Smoke Test"]` succeeding (same as before). We **add** a pre-deploy verification step that:

1. Takes the deploy target SHA on `main`.
2. Resolves it back to the originating PR's head SHA via `gh api /repos/.../commits/$SHA/pulls`. This is necessary because the repo uses squash-merge — the commit on `main` is a *new* SHA that no PR workflow ever ran on.
3. Asks GitHub for the most recent Staging Gate run on that PR head SHA.
4. Aborts the deploy unless `status:conclusion == completed:success`.

The hotfix `workflow_dispatch` path is preserved with a new input `skip_staging_gate=true` for emergencies. The skip MUST be recorded in the linked incident.

The change is in the same PR but called out so the operator can roll back the verifier (`continue-on-error: true` on the step) if the gate is flaky in the first week.

## Out-of-scope decisions called out

- **No staging Open WebUI.** Photo questions are out of scope; if we need them later, add a separate `vision-staging-gate.yml` and run on a self-hosted runner with Ollama.
- **No staging hub/atlas/nginx.** Customer surface bugs are caught by `web-review-canary.yml` and Playwright; not the engine's job.
- **No staging migration step.** The staging branch starts identical to prod; new migrations are tested by `apply-migrations.yml` against staging first (future iteration; not in this PR).
- **No automated branch refresh.** The operator runs `neon branches create --parent prod staging-N` weekly via the runbook. We can automate later with a `staging-branch-refresh.yml` cron.

## Acceptance

1. PR opened with engine change → staging-gate runs → comment posted with table.
2. Synthetic regression (commit that breaks BM25) → gate fails → merge blocked.
3. Deploy to VPS no longer runs until staging gate is green.
4. Operator can run `bash install/up_staging.sh` on CHARLIE and have a working `@MiraStaging_bot`.

## Eval framework choice

The judge in `tools/staging_test.py` is a **direct Groq OpenAI-compatible call** returning compact JSON for the 5 rubric dimensions. That is intentionally minimal — no framework wraps the LLM call (PRD §4) and the rubric is MIRA-specific enough that a generic framework adds more weight than it removes. We evaluated the relevant open-source options before settling on the in-line judge:

| Framework | Disposition | Why |
|---|---|---|
| **DeepEval** | **Natural upgrade path.** Already in the repo via `deepeval-ci.yml`. Its `GEval` custom-rubric metric maps 1:1 to the 5-dimension scorecard, and the LLM backend is pluggable so we can route the judge through Groq instead of OpenAI. Migrate when a second eval surface needs to share the rubric. | One dep for several wins (Confident.ai-style report, pytest integration, regression deltas). |
| **Promptfoo** | Deferred. Strong CI ergonomics but its provider model expects the prompt template to live in YAML — `Supervisor.process()` is not a single prompt, it's an orchestrator. Awkward fit. | Reconsider if we ever expose a flat `/chat` HTTP surface for staging. |
| **Ragas** | Out of scope. Metrics (`faithfulness`, `context_precision`, `answer_relevancy`) require *reference contexts* per question; we don't have ground-truth retrievals for the fixture. | Track if we add a labeled retrieval gold set. |
| **Trulens** | Out of scope. Excellent tracing + feedback functions, but requires an OTEL exporter + persistent store. Too much surface for a 10-question PR gate. | Revisit if we want production-side observability of the same metrics. |
| **LangSmith** | Rejected. Closed source / paid, LangChain-coupled. We do not run LangChain (PRD §4). |
| **Braintrust** | Deferred. Open-core SDK is fine standalone, but adds a dep for no immediate gain over a direct Groq call. | Reconsider if we want shared evals across staging + offline (one place to host fixtures and replays). |

The pattern we *are* adopting is the Vercel/Railway "PR → preview env → CI gate" shape, with NeonDB branching as the ephemeral-DB primitive instead of a copy-on-write Postgres restore. That decision is documented in "Prior art" above; the framework table is the LLM-judge half of the same decision.

## CI runner contract

The staging gate runs on **`ubuntu-latest`** (GitHub Actions, no Docker-in-Docker). Required environment:

| Env | Source | Purpose |
|---|---|---|
| `NEON_DATABASE_URL` | `staging` env secret `NEON_STG_DATABASE_URL` | Connection string for the NeonDB staging branch. |
| `GROQ_API_KEY` | `staging` env secret `STAGING_GROQ_API_KEY` | Cascade primary + judge. |
| `CEREBRAS_API_KEY` | optional | Cascade fallback. |
| `GEMINI_API_KEY` | optional | Cascade fallback. |
| `INFERENCE_BACKEND` | `cloud` (literal) | Skips Ollama / Open WebUI; the runner has neither. |
| `MIRA_TENANT_ID` | `staging` env secret `STAGING_TENANT_ID` (default: the prod shared-tenant UUID) | **Must be a valid UUID** — `kg_entities.tenant_id` is a `uuid` column. Passing a literal string like `"staging"` trips a Postgres cast error and disables BM25 for every question. |
| `MIRA_DB_PATH` | `${{ runner.temp }}/mira-stg.db` | `mira-bots/shared/chat_tenant.py` reads this at module import time and opens a SQLite file; the default `/data/mira.db` is the VPS container path and not writable on `ubuntu-latest`. |
| `KNOWLEDGE_COLLECTION_ID` | `staging-dummy` | Unused by the text path; required by the Supervisor constructor. |
| `OPENWEBUI_BASE_URL`, `MCP_BASE_URL` | dummy localhost ports | Same — constructor params, never reached on the text path. |

No Open WebUI / no Ollama. No Docker. The whole gate is `pip install` + `python tools/staging_test.py`.

## Adding a test question

1. Append an entry to `tools/staging_questions.yaml` with a unique `id`, a `category` from the set the judge recognises (`oem_model_fault`, `oem_only`, `symptom_only`, `uns_gate`, `safety`, `greeting`, `followup`, `no_photo`, `off_topic`, `cmms_context`), the technician's `message`, and a short `exercises:` block describing the failure mode it catches.
2. If the new question pushes the total past ~15, raise `MAX_BELOW_3` in `tools/staging_test.py` (currently 2) so the distribution rule scales with the fixture.
3. Open a PR. The gate runs against the new question on the same staging Neon branch — no migration needed.

## Operator one-time setup (verbatim commands)

```bash
# 1. NeonDB staging branch (run once; weekly refresh is the same command with a new --name)
neonctl auth                       # opens browser to the Neon console
neonctl projects list              # grab the project_id for FactoryLM / Mira
neonctl branches create \
  --name staging \
  --parent production \
  --project-id <project_id>

# 2. Confirm the branch has the prod shared-tenant row:
psql "$NEON_STG_DATABASE_URL" -c \
  "SELECT id FROM tenants WHERE id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3';"

# 3. Drop the connection string into the staging GitHub environment:
gh secret set NEON_STG_DATABASE_URL --env staging --body "<conn_str>"
gh secret set STAGING_GROQ_API_KEY  --env staging --body "$GROQ_API_KEY"
```

If the staging branch is empty or missing the shared tenant, the gate will run cleanly but every OEM-anchored question will score low — that is a **data** failure, not a code failure; refresh the branch.

## Change log

- 2026-05-18 — v1.0 — initial spec, written alongside implementation.
- 2026-05-18 — v1.1 — first-run bug-fix pass: documented the UUID requirement for `MIRA_TENANT_ID`, the `MIRA_DB_PATH` override, the eval-framework comparison, and the operator setup commands. Switched PR-comment delivery from `GITHUB_OUTPUT` heredoc to the sticky action's `path:` input.
