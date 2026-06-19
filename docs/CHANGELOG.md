# MIRA Release Notes

Extracted from CLAUDE.md to keep the build-state file within the ~200 line compliance budget.
For current build state, see `CLAUDE.md` in project root.

### v3.27.9 (2026-06-19) — fix(hub): unbreak repo-wide Hub E2E — stale onboarding specs (#2108)
- The `Hub E2E (command-center + onboarding)` check had been failing on every hub PR since the onboarding-flow change. Two stale assumptions in the e2e specs: #1993 inserted an upload step between Review and Try (so `step-try` no longer appears right after `onboarding-finish`), and #1976 routed client fetches through `${API_BASE}/api/assets/` (trailing slash, which the bare `**/api/assets` route mock no longer matched).
- Walk the new upload step (`step-upload` → `onboarding-upload-continue`) and mock the trailing-slash assets path in `onboarding-validate.spec.ts` + `onboarding-walkthrough.spec.ts`. Test-only; no product behavior change. Unblocks Hub E2E for all open hub PRs.

### v3.27.8 (2026-06-17) — chore(qa): land Hermes outside-in QA tooling + durable login helper on main (#2013)
- Cherry-picks the validated Hermes QA scaffolding out of the mixed `chore/hermes-qa-durable-account` branch onto `main`, so any checkout (and the Hermes dogfood agent) actually has it — the tooling existed only on an unmerged branch, which is why #2013 read as "still blocked" even though the durable test account + login path were live.
- **`dogfood-output/qa-login-save-state.mjs`** — durable-account Playwright login helper: signs into `app.factorylm.com` with the password flow and saves `dogfood-output/.auth/app-state.json` for reuse. Re-verified against prod from a clean checkout (`ok:true`, lands authenticated; `/hub`→`/onboarding/`, `/command-center/` + `/namespace/` authenticated).
- **`tools/qa/`** — `README.md` runbook (durable `hermes-qa-maint@example.com` account + Doppler `factorylm/dev` creds + mint command), `lib.mjs` (Playwright resolver), browser-smoke, console/network capture, manual-upload smoke, and the dedupe-first issue creator.
- No engine/prod/runtime code; additive QA tooling only.

### v3.27.0 (2026-06-17) — feat(mira): "Why MIRA Thinks This" decision-trace panel (Phase 2)
- **Northstar alignment Phase 2** (`docs/specs/why-mira-thinks-this-spec.md`, PRD §11). Every Hub `AssetChat` answer can now expand into an evidence + confidence + missing-context + feedback panel, turning MIRA into a *challengeable* agent.
- **`mira-hub/src/app/api/assets/[id]/chat/route.ts`** — the Hub chat route now writes its own `decision_traces` row (`platform='hub'`) at stream end (best-effort, never blocks the stream) and emits the `trace_id` up-front over SSE. (The Hub chat previously wrote no trace at all — only the engine surfaces did.)
- **`mira-hub/src/app/api/decision-trace/[id]/route.ts`** (new) — tenant-scoped read API (`withTenantContext`; cross-tenant → 404).
- **`mira-hub/src/app/api/decision-trace/[id]/feedback/route.ts`** (new) — `POST` records trace-linked feedback (`good`/`bad`/`missing_context`/`needs_review`); the trace must belong to the caller's tenant.
- **`mira-hub/src/components/WhyMiraThinksThis.tsx`** (new) + **`AssetChat.tsx`** — the expandable panel, in house style. Renders **only real data** (manual/tag/KG evidence, citations badge, heuristic confidence, `outcome='kb_gap'`→missing-context); PRD §11 `decision_path`/`context_ignored`/`next_check` are **deferred (Phase 2.1)** and intentionally not faked.
- **`mira-hub/db/migrations/055_decision_trace_confidence_and_feedback.sql`** (new) — adds `decision_traces.confidence` + the `decision_trace_feedback` table (UUID tenant family; RLS + grants; idempotent). Seeds Phase 10 (feedback consolidation).
- Tests: 7 new vitest route tests (tenant-scoping 404s, verdict validation, ownership checks). Full Hub unit suite green (719 passing; 1 pre-existing unrelated `sitemap-drift` failure).

### v3.26.1 (2026-06-17) — security(ignition): customer-shipped Ignition bundle is read-only (no plant writes)
- **`ignition/project/com.inductiveautomation.perspective/`** — removed all `system.tag.writeBlocking` plant-write paths from the customer-shipped Perspective bundle, per `docs/mira-ignition-secure-architecture.md` ("read-only by default") and `.claude/rules/fieldbus-readonly.md`. VFD control (speed setpoint, FWD/STOP/REV, fault reset) is **bench-only** — it lives in `plc/live_monitor.py` / the ConvSimpleLive bench project, never in the shipped bundle.
  - **SpeedControl** view (pure VFD control: speed slider/numeric + FWD/STOP/REV writing `VFD_CmdWord`) **removed** from the bundle — view deleted + dropped from `page-config/config.json` and the `NavBar`. It was never in the intended read-only bundle (`ConveyorStatus`/`Chat`/`FaultLog`/`NavBar`).
  - **FaultLog** view kept but made **read-only**: removed the `ClearFaultsButton` (`writeBlocking VFD_CmdWord 2`); the accompanying note now directs operators to clear faults at the VFD keypad (MIRA is read-only). No faked/inert STOP/CLEAR controls remain.
- **`tests/regime7_ignition/test_no_customer_write_paths.py`** (new) — CI guard: fails if any shipped Perspective view re-introduces `system.tag.write*`, or if `SpeedControl` reappears in the bundle. Prevents the read-only HMI from silently becoming a control surface again.
- Note: gateway-script writes to `[default]Mira_Alerts/*` **memory** tags (`tag-change-fsm-monitor.py`, `timer-stuck-state.py`) are internal anomaly alerts, not plant writes, and are intentionally out of scope of this guard.

### v3.25.0 (2026-06-16) — feat(staging): digital-twin review layer + migration-collision doctrine
- **`tools/staging/staging-smoke.sh`** — deterministic curl-and-assert health gate for the staging twin (Cluster Law 2: a binary check is a script, not an LLM). Asserts the externally-reachable review surfaces (Hub 4101, Web 4200) return 200; probes pipeline/atlas best-effort (the deploy workflow is authoritative for those on `127.0.0.1`). shellcheck-clean; verified live (Hub+Web PASS).
- **`tools/staging/hermes-staging-review.sh`** — async qualitative review: runs the smoke gate first, and only on PASS asks Hermes (on CHARLIE) to browse the staging Hub and post a terse verdict to Telegram. Advisory, never a CI gate.
- **`docs/runbooks/staging-twin-review.md`** — the operating model: prod auto-deploys on push-to-main, so the twin reviews the **candidate ref before merge** (`deploy-staging.yml --ref <branch>` → review → merge → prod). Documents the two-layer gate + the deferred hard-gate follow-up. Pairs with the `--ref` fix (v3.24.9 / #2063).
- **`.claude/rules/mira-hub-migrations.md` §7** — new doctrine: duplicate numeric migration prefixes are COSMETIC (the runner keys `schema_migrations` by full basename, not prefix); renumbering an already-applied migration makes the runner re-run it → drift. Do not renumber applied migrations.

### v3.24.9 (2026-06-16) — fix(ci): deploy-staging honors dispatched `--ref`
- **`.github/workflows/deploy-staging.yml`** — the VPS deploy step runs over an ssh heredoc quoted with `<< 'ENDSSH'`, so `GITHUB_REF_NAME` was evaluated *on the VPS* (where it's unset) and the deploy ref always fell back to `staging`. Every `workflow_dispatch --ref <X>` silently deployed the `staging` branch regardless of `X`. Fix threads the runner's `github.ref_name` through the ssh command line as `DEPLOY_REF`, and the heredoc now reads `REF="${DEPLOY_REF:-${GITHUB_REF_NAME:-staging}}"`. Unblocks `--ref main` staging deploys. Cherry-picked from `test/staging-1901-deploy` (`a5cd0fcc`) to land on main independently of the #1901 onboarding stack.

### ops/kiosk-runbook (2026-06-06) — AskMira / mira-ask deploy + prod verify runbook + close `services` gap
- **`docs/runbooks/kiosk-askmira-deploy-and-verify.md`** — new dedicated runbook covering when this routine applies (`mira-bots/ask_api/`, kiosk engine fast-paths, AskMira view), the required deploy dispatch (`services=mira-ask`), verification sequence (Mode A bake + Mode B browser drive), guardrails (no scorer/golden weakening, no `mira-pipeline /v1/chat/completions`, no Anthropic, kiosk-scoped), and the known Q1 length caveat as a separate-PR follow-up. Created because the 2026-06-06 PR #1754 / #1755 / MIRA_PLC#25 cycle surfaced no existing doctrine for this path.
- **`.github/workflows/deploy-vps.yml` line 199** — added `mira-ask` to default `TARGETS`. Auto-deploys triggered by Smoke Test no longer skip the kiosk path. Engine changes shipping to Telegram / Slack will also rebuild `mira-ask-saas`. Closes the gap recorded in the 2026-06-06 fix cycle (auto-deploy after PR #1754 left `mira-ask` on its 47-hour-old image; manual `services=mira-ask` dispatch was required as a workaround).
- **`CLAUDE.md` Pointers** — added a link to the runbook.

### mira-hub/v1.5.3 (2026-05-09) — Allow /pricing in robots.txt + nginx HTTP/2 (closes #1104, #1106)
- **`mira-hub/src/app/robots.ts`** — Added `/pricing` to allow list so crawlers can index the pricing/conversion page.
- **`nginx-phase2-live.conf`** — Added `http2` to both `listen 443 ssl` directives (app.factorylm.com + chat.factorylm.com). Estimated 1,440ms savings on login page LCP.

### v2.7.0 (2026-04-14) — Active learning loop: production 👎 → fixtures → draft PR (closes #219)
- **`mira-bots/tools/active_learner.py`** — `ActiveLearner` class: scans `feedback_log` for `/bad` entries, reconstructs conversations from `interactions`, anonymizes via Claude (PII stripped, vendor/model preserved), infers eval pass criteria with confidence gate (default: 0.6), generates YAML fixtures matching existing eval schema.
- **`tests/eval/active_learning_tasks.py`** — Celery `shared_task` `mira_active_learning.run_nightly` at 04:00 UTC. File-based lock (30-min stale timeout). Honors `ACTIVE_LEARNING_DISABLED=1` env var.
- **`tests/eval/fixtures/auto-generated/`** — Fixture staging area. Draft PR opened to this path; reviewed fixtures promoted to `tests/eval/fixtures/` with sequential numbering.
- **Draft PR format**: one commit per run, PR title `auto: active-learning fixtures from YYYY-MM-DD feedback (N new)`, body includes fixture table + review checklist + hashed source chat_ids.
- **`ACTIVE_LEARNING_GH_TOKEN`** — New Doppler secret required: GitHub PAT with `contents:write` + `pull_requests:write`.
- **Eval still 10/10** — Active learner runs independently; does not affect existing eval harness.

### v2.6.0 (2026-04-14) — LLM-as-judge eval layer — closes #217 (Karpathy alignment P0)
- **`tests/eval/judge.py`** — Cross-model LLM judge. Four Likert dimensions (1–5): `groundedness`, `helpfulness`, `tone`, `instruction_following`. Routes judge calls away from the response generator: Claude-generated → Groq judge; Groq/Cerebras-generated → Claude judge; unknown → Claude. Implements ADR-0010 gap #1.
- **`tests/eval/run_eval.py`** — Judge integration: `run_scenario()` calls `judge.grade()` once per scenario (last response, last user question). Scorecard gains four judge columns + aggregate summary section with trend arrows vs. previous run. Raw judge JSON written to `{scorecard_stem}-judge.jsonl`. `EVAL_DISABLE_JUDGE=1` skips all judge calls.
- **`tests/eval/celery_tasks.py`** — New `mira_eval.run_batch_with_judge` task (03:00 UTC nightly). Hourly `mira_eval.run_batch` now explicitly sets `EVAL_DISABLE_JUDGE=1` (fast/cheap). Separate lock files — nightly judge run does not block hourly run.
- **`tests/eval/test_judge.py`** — 12 offline unit tests (mocked APIs). Covers: disabled mode, provider routing (5 cases), JSON parsing + validation, red-team keyword-stuffed gibberish (scores ≤2 on groundedness/helpfulness), pass case (scores ≥4 all dimensions), Pilz manual-miss (instruction_following ≤2).
- **`tests/eval/fixtures/11_pilz_manual_miss.yaml`** — Regression guard for `GET_DOCUMENTATION` intent. Reconstructed from chat `b500953b` (2026-04-14 Pilz forensic). Verifies "find a manual" returns vendor URL, not a diagnostic question. Judge target for `instruction_following` validation.
- **Deploy:** No container restart needed. `judge.py` calls external APIs (Groq/Anthropic) directly from the eval subprocess. VPS Celery worker needs restart to register `mira_eval.run_batch_with_judge` task + add Beat schedule entry.

### v2.5.2 (2026-04-14) — Hotfix: Apify crawlerType enum fix (closes #230)
- **`crawlerType: playwright:chrome`** — Fixed invalid enum value `"playwright"` in `crawl_routes.yaml` and `route_fallback.py`. Apify rejects bare `"playwright"`; valid values are `playwright:chrome`, `playwright:firefox`, `playwright:adaptive`. Confirmed from e2e Pilz job `2f78ae8b`.
- **`route_fallback.py` reads from YAML** — `crawlerType` sourced from `params.get("crawlerType", "playwright:chrome")` instead of hardcoded.

### v2.5.1 (2026-04-14) — Phase 2 Route Fallback Registry — ADR-0009 (closes #211)
- **`config/crawl_routes.yaml`** — Vendor-specific strategy priority lists. Pilz, Yaskawa, Siemens, ABB skip `apify_cheerio` and start with `apify_playwright` (JS-rendered SPAs).
- **`mira-core/mira-ingest/route_fallback.py`** — Fallback orchestrator: `LOW_QUALITY`/`SHELL_ONLY`/`EMPTY` automatically retries through `apify_playwright → duckduckgo_site_search → llm_discover_url`.
- **Three fallback strategies**: Apify Playwright (Chromium headless), DuckDuckGo site-scoped PDF search, LLM URL discovery (Gemini→Groq→Claude-Haiku + HTTP HEAD validation).
- **Budget controls**: max 3 strategies, $0.20 hard stop. `SKIP_ON_RETRY` prevents re-running the failed primary.
- **Eval**: 10/10. Scorecard: `tests/eval/runs/2026-04-14-v2.5.1-pre.md`.

### v2.5.0 (2026-04-14) — Phase 1 Crawl Verification Layer (closes #210)
- **`crawl_verifier.py`** — New post-crawl QA module. Every Apify run now produces a verified outcome code: `SUCCESS`, `LOW_QUALITY`, `SHELL_ONLY`, `EMPTY`, `FAILED`. Zero silent greens.
- **Key metric: `avg_content_length`** — Discriminates real manual content (10K–50K chars/page) from download listing pages (700–3,500 chars/page). 4,000 char threshold. This is what catches the Yaskawa/Pilz patterns.
- **Honest technician notifications** — `LOW_QUALITY`/`SHELL_ONLY` sends "found listing pages, not manual content — send a PDF directly" instead of "New knowledge added ✅".
- **`GET /ingest/crawl-verifications`** — Last 50 verification records as JSON. Used by eval loop and future dashboard.
- **`POST /ingest/crawl-classify-historical`** — Retroactive run classification for past crawls.
- **KB write correlation** — `_ingest_scraped_text` now returns bool and logs `kb_ok` with `run_id`, so auth failures (like the v2.4.0 OPENWEBUI_API_KEY incident) are visible.
- **Proof-of-concept**: Yaskawa V1000 run `Brgo1xN4QLjhr0Pgc` (previously "SUCCEEDED") classified as `LOW_QUALITY` — 103 listing pages, avg 1,736 chars, content_density=0.12.
- **Sample scorecard**: `tests/eval/crawl-verifications/2026-04-14-sample.md`
- **Eval**: 10/10 (no regression).

### v2.4.1 (2026-04-14) — Hotfix: safety keywords, doc phrase gap, OPENWEBUI_API_KEY
- **Safety keywords expanded** — `SAFETY_KEYWORDS` now includes electrical isolation / live-work phrases: `"isolate the power"`, `"isolating power"`, `"de-energize"`, `"de-energizing"`, `"pull the fuse"`, `"pull the breaker"`, `"live wire"`, `"live panel"`, `"working on live"`, and more. Forensic: Mike's Turn 2 description of pulling cables from a live distribution block was routed to diagnostic FSM instead of STOP escalation.
- **`_DOCUMENTATION_PHRASES` expanded** — Added 12 article-agnostic variants: `"find a manual"`, `"get a manual"`, `"need a manual"`, `"looking for a manual"`, `"looking for the manual"`, `"find a datasheet"`, etc. Forensic: Mike's exact phrase `"Can you find a manual for this kind of distribution block"` returned Q3 FSM instead of vendor URL + scrape-trigger.
- **System prompt Rule 21** — MIRA must never confirm unverified user actions as fact. Reflect user's exact words, do not add specificity. Forensic: `"I pulled the big one"` → MIRA said `"You've removed the main power cable"` (false attribution).
- **OPENWEBUI_API_KEY rotated** — Stale key `sk-c416...` replaced with current valid key from Open WebUI DB. All Apify crawl results were silently failing to write to KB (0/N ingested on every job). Rotated in Doppler + redeployed `mira-ingest`. KB writes now return 200.
- **Eval:** 10/10. Scorecard: `tests/eval/runs/2026-04-14-v2.4.1-pre.md`.

### v2.4.0 (2026-04-14) — GET_DOCUMENTATION intent + cross-vendor guard
- **`GET_DOCUMENTATION` intent** — `classify_intent()` now returns `"documentation"` for explicit manual/datasheet/pinout requests (checked before `industrial` so "manual" doesn't swallow doc queries). Responds immediately with vendor support URL, no LLM call (~17ms). Closes #203.
- **Cross-vendor contamination guard** — `rag_worker` clears chunks when query vendor ≠ chunk manufacturer → honesty directive fires. Fixes GS20 queries returning Allen-Bradley content. Closes #204.
- **Async scrape-trigger** — On `documentation` intent, `engine._fire_scrape_trigger()` fires as `asyncio.create_task()` → `POST mira-ingest:/ingest/scrape-trigger` → Apify actor starts crawling vendor docs. End-to-end confirmed: Pilz query → Apify run `9ELqsnRqp384TeoxJ` completed.
- **None guard** — `vendor_support_url(None)` / `vendor_name_from_text(None)` no longer crash when `asset_identified` state is `None`.
- **Eval runner fix** — `run_date` UnboundLocalError when `--output` is a `.md` path (nightly Celery runner).
- **APIFY_API_KEY** wired into `mira-ingest` container via `docker-compose.saas.yml`.
- **Eval baseline:** 10/10 (was 8/10). Scorecard: `tests/eval/runs/2026-04-14-v2.4.0-pre.md`.
- **Follow-up:** #207 (per-call tenant_id, model extraction, model-level KB check, logger propagation).

### v0.5.4 (2026-04-14) — P0 Open WebUI UX fixes
- **P0-1**: Continue button (`### Task: Continue generating...`) now echoes last assistant turn instead of returning blank
- **P0-2**: Regenerate button dedup — FSM rolls back to prior state when identical user message detected in consecutive turns
- **P0-3**: PDF uploads in OW now route to `mira-ingest /ingest/document-kb` instead of silently falling through to OW native embedding
- **Rollback anchor:** `v0.5.3-pre-p0-ux` tag on commit before merge; to roll back: `git checkout v0.5.3-pre-p0-ux` → rebuild `mira-pipeline`
