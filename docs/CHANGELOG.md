# MIRA Release Notes

Extracted from CLAUDE.md to keep the build-state file within the ~200 line compliance budget.
For current build state, see `CLAUDE.md` in project root.

### askmira-ignition/v1.0.0 (2026-06-06) — Ignition AskMira deploy lands on PMC Gateway
- **Cutover from sidecar to ask_api** — Ignition "Ask MIRA" panel on the PMC-station Garage Conveyor now routes Tailscale-direct from the Gateway-scope script to `mira-bots/ask_api/app.py` on `factorylm-prod` (`100.68.120.99:8011`), wrapping `Supervisor.process()`. PR Mikecranesync/MIRA#1620 (wrong-stack `/v1/chat/completions` cutover) closed; the official path is `feat/ask-mira-ignition-hmi` (MIRA_PLC) + the merged `/ask` endpoint chain (#1615 + #1629 + #1700).
- **Deploy mechanism** — Web UI Project Import after adding a `/AskMira` page entry to `com.inductiveautomation.perspective/page-config/config.json`. The AskMira `view.json` was already on disk; only the page-route mapping was missing.
- **Auth** — `ASK_API_KEY` optional gate intentionally off (`X-Mira-Key:""` both ends per view.json inline comment). PR #1746 audit's `MIRA_IGNITION_HMAC_KEY` claim is stale vs current code.
- **Re-test verdict** — R1 (CoT leak), R2 (multi-vendor citation salad), R3 (fault tunnel-vision), R4 (E-stop awareness) all FIXED vs 2026-06-01 baseline. R5 bimodal (2 s instructional / 45 s grounded). R6 sources populated on grounded replies. Single-shot per Perspective session works grounded answers from live PLC tags.
- **NEW follow-up** — view textarea→`view.custom.question` binding race causes follow-up clicks to send the previous question. Workaround: reload page between Q's. Fix is view-side (change propagation to immediate OR read text-area `.props.text` in the Gateway script).
- **Evidence:** `docs/demos/_audit/askmira-{deploy-session,rerun-engine-prebake,rerun}-2026-06-06.md`. Screenshots: `docs/promo-screenshots/2026-06-06_askmira-{gate3-deployed,q01-grounded-answer}_desktop.png`.

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
