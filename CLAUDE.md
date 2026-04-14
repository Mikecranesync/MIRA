# MIRA — Build State

**Version:** v2.7.0
**Updated:** 2026-04-14
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=cloud` → Gemini → Groq → Cerebras → Claude (cascade) | `INFERENCE_BACKEND=local` → Open WebUI → qwen2.5vl:7b
**Chat path (VPS):** User phone → Open WebUI → mira-pipeline (:9099, OpenAI-compat) → GSDEngine → Anthropic API

---

## KANBAN Board

**Board:** https://github.com/users/Mikecranesync/projects/4 (project ID: 4, owner: Mikecranesync)

### On Session Start
Run this to see what's open and in-progress:
```bash
gh project item-list 4 --owner Mikecranesync --format json --limit 100 | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
for s in ['In Progress', 'Todo']:
    hits = [i for i in items if i.get('status') == s]
    if hits:
        print(f'\n## {s} ({len(hits)})')
        for i in hits: print(f'  {i[\"title\"]}')
"
```

### On Every Commit
After committing, add any new GitHub issues to the board and move resolved issues to Done:
```bash
# Add a new issue to the board
gh project item-add 4 --owner Mikecranesync --url <issue-url>

# Move an item to In Progress
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 47fc9ee4

# Move an item to Done
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 98236657

# Get item IDs
gh project item-list 4 --owner Mikecranesync --format json --limit 100 | python3 -c "
import sys, json
for i in json.load(sys.stdin)['items']:
    print(i['id'], i.get('status',''), i['title'][:60])
"
```

### Rules
- Every GitHub issue created during a session → add to board immediately
- Every issue closed by a commit → move to Done on the board
- Never leave the board stale: if you fix something, update the status

---

## Repo Map

```
MIRA/
├── mira-core/          # Open WebUI + MCPO proxy + ingest service (3 containers)
├── mira-bots/          # Telegram, Slack, Teams, WhatsApp adapters + shared diagnostic engine (4 containers)
├── mira-bridge/        # Node-RED orchestration, SQLite WAL shared state (1 container)
├── mira-mcp/           # FastMCP server, NeonDB recall, equipment diagnostic tools (1 container)
├── mira-pipeline/      # OpenAI-compat API wrapping GSDEngine — active VPS chat path
├── mira-web/           # PLG web frontend (Next.js, :3200) — deployed on VPS, not publicly routed
├── mira-cmms/          # Atlas CMMS — work orders, PM scheduling, asset registry (4 containers)
├── mira-hud/           # AR HUD desktop app (Express + Socket.IO, standalone)
├── mira-sidecar/       # ⚠️  LEGACY — ChromaDB RAG backend, superseded by mira-pipeline (ADR-0008)
│                       #    Do NOT add new callers. OEM doc migration pending before removal.
├── mira-web/           # PLG acquisition funnel — Hono/Bun, /cmms landing + Mira AI chat (1 container)
├── wiki/               # LLM-maintained ops wiki (Karpathy pattern) — open as Obsidian vault
├── tests/              # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/               # PRD, ADRs, architecture C4 diagrams, runbooks
├── tools/              # Photo pipeline, Google Drive/Photos ingest, Reddit→TG curation, migration scripts
├── install/            # Setup scripts, smoke tests
├── deployment/         # Admin guide, customer agreement
└── plc/                # PLC program files (deferred to Config 4)
```

See local CLAUDE.md in each module for deep context.

**Flows & architecture maps:** Persistent copies in `~/.claude/projects/.../memory/flows/` — Tailscale network, ingest pipeline, C4 index, fault diagnosis, photo pipeline.

### Knowledge Ingest Route

```
Apify/Firecrawl/rclone → manual_cache → ingest_manuals.py (2:15am)
→ Docling/pdfplumber → chunk_blocks() [mira-crawler/ingest/chunker.py]
→ TOKEN CAP 2000 (Gemma+nomic safe) → Ollama embed (BRAVO:11434)
→ NeonDB knowledge_entries (25K rows) → 4-stage retrieval
```

Endpoints: `mira-ingest :8002 POST /ingest/photo` | `mira-mcp :8009 POST /ingest/pdf`
Key files: `mira-crawler/ingest/chunker.py` | `mira-core/scripts/ingest_manuals.py` | `mira-core/mira-ingest/db/neon.py`
Full diagram: `~/.claude/projects/.../memory/flows/knowledge-ingest-pipeline.md`

---

## Container Map

| Container         | Host Port(s) | Network(s)        | Healthcheck                 |
|-------------------|--------------|-------------------|-----------------------------|
| mira-core         | 3000 → 8080  | core-net, bot-net | GET /health                 |
| mira-pipeline     | 9099         | core-net          | curl /health                |
| mira-mcpo         | 8000         | core-net          | GET /mira-mcp/docs (bearer) |
| mira-ingest       | 8002 → 8001  | core-net          | Python urlopen /health      |
| mira-docling      | 5001         | core-net          | curl /health                |
| mira-bridge       | 1880         | core-net          | GET /                       |
| mira-mcp          | 8000, 8001   | core-net          | Python urlopen /sse         |
| mira-bot-telegram | —            | bot-net, core-net | import check                |
| mira-bot-slack    | —            | bot-net, core-net | import check                |
| mira-bot-teams    | —            | bot-net, core-net | import check                |
| mira-bot-whatsapp | —            | bot-net, core-net | import check                |
| mira-bot-reddit   | —            | bot-net, core-net | import check                |
| atlas-db          | 5433         | cmms-net          | pg_isready                  |
| atlas-api         | 8088 → 8080  | cmms-net, core-net| GET /actuator/health        |
| atlas-frontend    | 3100 → 3000  | cmms-net          | GET /                       |
| atlas-minio       | 9000, 9001   | cmms-net          | mc ready local              |
| mira-web          | 3200 → 3000  | core-net, cmms-net| curl /api/health            |

---

## Start / Stop

```bash
# Start all services
doppler run --project factorylm --config prd -- docker compose up -d

# Stop
docker compose down

# Logs
docker compose logs -f <service>

# Smoke test
bash install/smoke_test.sh
```

---

## Hard Constraints (PRD §4 — Non-Negotiable)

1. **Licenses:** Apache 2.0 or MIT ONLY. Flag any other license before installing.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Secrets:** All secrets via Doppler (`factorylm/prd`). Never in `.env` files committed to git.
5. **Containers:** One service per container. Every container: `restart: unless-stopped` + healthcheck.
6. **Docker images:** Pinned to exact version SHA or semver tag. Never `:latest` or `:main`.
7. **Build tool:** Claude Code. All implementation prompts written as Claude Code instructions.
8. **Commits:** Conventional commit format (`feat/fix/security/docs/refactor/test/chore/BREAKING`).
9. **Config 4 deferred:** No Modbus, PLC, or VFD code until Config 1 MVP ships.

---

## Commit Convention

```
feat: short description of new feature
fix: short description of bug fix
security: security hardening
docs: documentation only
refactor: code restructuring, no behavior change
test: tests only
chore: build system, deps, tooling
```

---

## Key Env Vars (Doppler: factorylm/prd)

| Var                  | Used By                              |
|----------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram                    |
| `SLACK_BOT_TOKEN`    | mira-bot-slack                       |
| `SLACK_APP_TOKEN`    | mira-bot-slack (Socket Mode)         |
| `ANTHROPIC_API_KEY`  | mira-bots (Claude inference)         |
| `INFERENCE_BACKEND`  | mira-bots — `"cloud"` (cascade) or `"local"` |
| `GEMINI_API_KEY`     | mira-bots, mira-pipeline (Gemini — primary free tier) |
| `GEMINI_MODEL`       | mira-bots, mira-pipeline — default: gemini-2.5-flash |
| `GEMINI_VISION_MODEL`| mira-bots, mira-pipeline — default: gemini-2.5-flash |
| `GROQ_API_KEY`       | mira-bots, mira-pipeline (Groq — secondary free tier) |
| `GROQ_MODEL`         | mira-bots, mira-pipeline — default: llama-3.3-70b-versatile |
| `GROQ_VISION_MODEL`  | mira-bots, mira-pipeline — default: meta-llama/llama-4-scout-17b-16e-instruct |
| `CEREBRAS_API_KEY`   | mira-bots (Cerebras — tertiary free tier) |
| `CEREBRAS_MODEL`     | mira-bots — default: llama3.1-8b |
| `CLAUDE_MODEL`       | mira-bots — default: claude-sonnet-4-6 |
| `OPENWEBUI_API_KEY`  | mira-bots, mira-ingest, mira-pipeline |
| `PIPELINE_API_KEY`   | mira-pipeline (bearer auth), mira-core (OPENAI_API_KEYS) |
| `MCP_REST_API_KEY`   | mira-mcp (server), mira-bots (client)|
| `NEON_DATABASE_URL`  | mira-ingest (NeonDB)                 |
| `MIRA_TENANT_ID`     | mira-ingest (tenant scoping)         |
| `KNOWLEDGE_COLLECTION_ID` | mira-bots, mira-ingest          |
| `LANGFUSE_SECRET_KEY`| mira-bots (tracing)                  |
| `LANGFUSE_PUBLIC_KEY`| mira-bots (tracing)                  |
| `MIRA_SERVER_BASE_URL` | Remote clients (no port)           |
| `ATLAS_DB_PASSWORD`  | atlas-db (PostgreSQL)                |
| `ATLAS_JWT_SECRET`   | atlas-api (JWT signing)              |
| `ATLAS_MINIO_PASSWORD`| atlas-minio (file storage)          |

---

## Deferred Features

| Feature                      | Deferred To | Reason                      |
|------------------------------|-------------|-----------------------------|
| Modbus / PLC / VFD           | Config 4    | Out of scope for Config 1 MVP |
| NVIDIA Nemotron reranker     | **Active**  | Enabled when NVIDIA_API_KEY set (feature-flagged) |
| Kokoro TTS                   | Post-MVP    | Nice-to-have                |
| CMMS integration             | **Active**  | Atlas CMMS (mira-cmms/)     |

---

## Abandoned Approaches

| Approach | Replaced With | Why It Failed |
|----------|--------------|---------------|
| NemoClaw / NeMo Guardrails | Custom supervisor/worker | Not production-ready (Mar 17) |
| PRAW OAuth for Reddit | No-auth public JSON endpoints | Too heavy — credentials, app registration, rate limits |
| zhangzhengfu nameplate dataset | Own golden set from Google Photos | Empty repo, dead Baidu Pan links, no license |
| Google Photos API direct | rclone + Ollama triage | OAuth consent screen "Testing" mode returned empty results |
| GWS CLI for Gmail | IMAP with Doppler app passwords | Scope registration issues on Windows |
| glm-ocr model (as primary) | qwen2.5vl handles vision | Consistent 400 errors — retained as optional fallback in vision_worker.py |
| mira-sidecar (ChromaDB RAG backend) | mira-pipeline + Open WebUI KB | ADR-0008 (Apr 2026): pipeline wraps GSDEngine directly; Open WebUI native KB (Docling) replaces ChromaDB. Sidecar still running pending OEM doc migration (398 chunks). |

---

## Known Broken / Incomplete

- **Gemini key blocked** — `GEMINI_API_KEY` in Doppler returns 403 "Your project has been denied access". Get fresh key from aistudio.google.com and update Doppler `factorylm/prd`. Cascade falls through to Groq/Claude in the meantime (smoke-tested OK).
- **Teams + WhatsApp** — Code-complete, pending cloud setup (Azure Bot Service, WhatsApp Business API)
- **PLC at 192.168.1.100** — Unreachable from PLC laptop; needs physical check (power/switch/cable)
- **Charlie Doppler keychain** — Same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`
- **Charlie HUD** — Needs local terminal session to start (keychain blocks SSH start of Doppler)
- **Reddit benchmark** — 15/16 questions hit intent guard canned responses, not real inference
- **No CD pipeline** — CI validates but deploy to Bravo is manual (docker cp or SSH)
- **NVIDIA NIM / Nemotron** — API key in Doppler but Regime 5 eval tests blocked on it
- **mira-sidecar OEM migration pending** — 398 OEM chunks in `shared_oem` ChromaDB must move to Open WebUI KB before sidecar can be stopped. Script: `tools/migrate_sidecar_oem_to_owui.py`. Runbook: `docs/runbooks/sidecar-oem-migration.md`.
- **mira-web → mira-pipeline cutover pending** — `mira-web/src/lib/mira-chat.ts` calls sidecar `:5000/rag`; must be rewritten to call pipeline `:9099/v1/chat/completions` before mira-web is publicly routed.


---

## Gotchas

- **macOS keychain over SSH** — `docker build` and `doppler` both fail on Bravo/Charlie over SSH. Workaround: `docker cp` + `docker commit` + `docker restart`. Bravo fixed with `doppler configure set token-storage file`.
- **NeonDB SSL from Windows** — `channel_binding` fails. Run NeonDB queries from macOS (Bravo/Charlie) instead.
- **Intent guard false positives** — `classify_intent()` in guardrails.py catches real maintenance questions as greetings/off-topic. Test with realistic phrasing.
- **PRD claims vs reality** — v1.0.0 PRD overstated 8 of 13 features as "already built". Always fact-check PRD claims against actual code.
- **Competing Telegram pollers** — Only one process can poll a bot token. If bot seems dead, check that CHARLIE or another host isn't running a stale poller.

---

## Release Notes

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

---

## Where to Resume

- **`feature/vim` branch** — Merged to main. VIM phases 1A→4 + mira-crawler phases 1→4 + Docling adapter all integrated.
- **Photo pipeline on Bravo** — 3,694 confirmed equipment photos in `~/takeout_staging/ollama_confirmed/`. Ready for KB ingest at scale.
- **LlamaIndex RAG upgrade** — PRD complete (`MIRA_LlamaIndex_RAG_PRD.docx.md`). Replaces hand-rolled RAG in rag_worker.py with LlamaIndex orchestration. Ready to build.
- **Bot quality tuning** — RAG quality gate (0.70 threshold), NeonDB-only retrieval, Nemotron reranking active. Next: fix intent guard false positives.
- **Pilz forensic follow-ups** — Issue #207 filed: per-call tenant_id in Celery ingest, structured model extraction, model-level KB coverage check, mira-gsd logger propagation to docker logs.

---

## Continuous Eval Loop

MIRA has two automated eval tiers — 51 scenario fixtures (31 `NN_*.yaml` + 20 `vfd_*.yaml`), 5 binary checkpoints + 4 LLM-as-judge dimensions (v2.6.0+).

| Path | Purpose |
|------|---------|
| `tests/eval/fixtures/` | YAML scenario fixtures (51 total: 31 `NN_*.yaml` + 20 VFD `vfd_*.yaml`) |
| `tests/eval/run_eval.py` | CLI runner — `python3 tests/eval/run_eval.py` |
| `tests/eval/grader.py` | 5 binary checkpoint definitions |
| `tests/eval/judge.py` | LLM-as-judge — 4 Likert dimensions, cross-model routing |
| `tests/eval/test_judge.py` | Offline unit tests for judge (mocked APIs) |
| `tests/eval/celery_tasks.py` | Celery tasks: hourly (no judge) + nightly (with judge) |
| `tests/eval/runs/YYYY-MM-DD.md` | Hourly scorecard (binary checkpoints only) |
| `tests/eval/runs/YYYY-MM-DDTHHMM-judge.md` | Nightly scorecard (checkpoints + judge scores) |
| `tests/eval/runs/YYYY-MM-DDTHHMM-judge.jsonl` | Raw judge JSON (one object per scenario) |

### Running manually

```bash
# Full eval with judge (default — reads GROQ_API_KEY / ANTHROPIC_API_KEY from Doppler):
cd /opt/mira && doppler run --project factorylm --config prd -- python3 tests/eval/run_eval.py

# Fast eval without judge (same as hourly Celery run):
cd /opt/mira && EVAL_DISABLE_JUDGE=1 python3 tests/eval/run_eval.py

# Dry run — fixture loading only, no HTTP calls:
cd /opt/mira && python3 tests/eval/run_eval.py --dry-run

# Logs: /var/log/mira-eval.log
```

### Judge environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `EVAL_DISABLE_JUDGE` | Set `"1"` to skip all judge calls (hourly cheap mode) | `"0"` (enabled) |
| `GROQ_API_KEY` | Judge provider when response generated by Claude | — |
| `ANTHROPIC_API_KEY` | Judge provider when response generated by Groq/Cerebras | — |
| `GEMINI_API_KEY` | Optional judge (currently blocked — key returns 403) | — |
| `GROQ_MODEL` | Groq judge model | `llama-3.3-70b-versatile` |
| `CLAUDE_MODEL` | Claude judge model | `claude-sonnet-4-6` |

### Cross-model judge routing (ADR-0010)

Judge calls are routed AWAY from the provider that generated the response:
- Claude-generated → Groq judge (fallback: Gemini)
- Groq/Cerebras/Gemini-generated → Claude judge
- Unknown origin → Claude judge (fallback: Groq)

### Celery Beat schedules (on VPS: /opt/master_of_puppets/celery_app.py)

```python
from celery.schedules import crontab
# Hourly — binary checkpoints only, no judge
'mira-eval-every-60-min': {'task': 'mira_eval.run_batch', 'schedule': 3600.0}
# Nightly 03:00 UTC — checkpoints + LLM-as-judge
'mira-eval-nightly-with-judge': {'task': 'mira_eval.run_batch_with_judge', 'schedule': crontab(hour=3, minute=0)}
# Nightly 04:00 UTC — active learning: 👎 feedback → anonymized fixtures → draft PR
'mira-active-learning-nightly': {'task': 'mira_active_learning.run_nightly', 'schedule': crontab(hour=4, minute=0)}
```

### Adding a scenario

Copy any file in `tests/eval/fixtures/`, edit the `turns` and ground-truth fields, save as
`NN_description.yaml`. It runs automatically. Optional field: `judge_generated_by: "groq"` to
override cross-model routing for a specific fixture.

**Baseline (2026-04-14):** 8/11 pass (binary). Known failures:
- `gs20_cross_vendor_03` — pipeline says Allen-Bradley PowerFlex for GS20 (cross-vendor hallucination)
- `yaskawa_out_of_kb_04` — no honesty signal for uncovered equipment
- `pilz_manual_miss_11` — regression guard for GET_DOCUMENTATION intent (v2.4.0 fix)

**Design doc:** `docs/adr/0010-karpathy-eval-alignment.md`

---

## Active Learning Loop (v2.7.0)

Nightly Celery task at **04:00 UTC** (after judge eval at 03:00): scans `feedback_log` for
`/bad` ratings since last run, anonymizes each conversation via Claude, infers pass criteria from
the rating reason, generates a YAML eval fixture, and opens a **draft GitHub PR** to
`tests/eval/fixtures/auto-generated/`. Reviewers promote fixtures to `tests/eval/fixtures/` after
verifying anonymization and criteria accuracy.

| Path | Purpose |
|------|---------|
| `mira-bots/tools/active_learner.py` | Core `ActiveLearner` class |
| `tests/eval/active_learning_tasks.py` | Celery `mira_active_learning.run_nightly` task |
| `tests/eval/fixtures/auto-generated/` | Draft fixtures pending review |
| `mira-bots/tests/tools/test_active_learner.py` | Unit tests |

**Env vars** (add to Doppler `factorylm/prd`):

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `ACTIVE_LEARNING_GH_TOKEN` | YES | — | GitHub PAT with `contents:write` + `pull_requests:write` |
| `ACTIVE_LEARNING_DISABLED` | no | `0` | Set to `1` to skip without removing beat schedule |
| `ACTIVE_LEARNING_MIN_CONFIDENCE` | no | `0.6` | Drop fixture if Claude criteria confidence < threshold |
| `ACTIVE_LEARNING_MAX_FIXTURES_PER_RUN` | no | `10` | Cap fixtures per nightly run (keeps PR reviewable) |
| `ACTIVE_LEARNING_STATE_PATH` | no | `/opt/mira/data/active_learning_state.json` | Checkpoint file |

**Deploy:**
```bash
cp tests/eval/active_learning_tasks.py /opt/master_of_puppets/workers/mira_active_learning_tasks.py
supervisorctl restart master_of_puppets_worker
```

**Dry-run** (inspect output before first PR):
```bash
cd /opt/mira && MIRA_DB_PATH=/opt/mira/data/mira.db \
  python3 mira-bots/tools/active_learner.py --dry-run --output /tmp/active_learning_dryrun
```

---

## Pointers

- `.claude/skills/` — domain skills for diagnostic workflow, adapters, inference, HUD, ingest
- `docs/adr/` — Architecture Decision Records
- `docs/runbooks/` — operational runbooks
- `wiki/` — LLM-maintained ops wiki (Karpathy pattern). **Session start: read `wiki/hot.md`. Session end: update it.**
- `wiki/SCHEMA.md` — operating instructions for the wiki
- `.planning/STATE.md` — current sprint state and next task
- `KNOWLEDGE.md` — deep institutional knowledge (architecture decisions, abandoned approaches, recurring problems)
- `DEVLOG.md` — chronological development diary (Mar 11–27, 2026)
