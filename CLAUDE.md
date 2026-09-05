# MIRA — Build State

**Version:** see `/VERSION` (authoritative overall counter; auto-tagged `vX.Y.Z` on merge — `docs/versioning.md`)
**One-liner:** FactoryLM is the existing maintenance app; MIRA is its conversational assistant. Make the mobile experience clean and useful, with equipment/document evidence customers can inspect. **Approved product direction → `NORTH_STAR.md` (2026-09-05).**
**Inference:** `INFERENCE_BACKEND=cloud` → Groq → Cerebras → Together (cascade, no Anthropic — removed PR #610) | `local` → Open WebUI → qwen2.5vl:7b
**Chat path (VPS):** User phone → Open WebUI → mira-pipeline (:9099) → Supervisor (shared/engine.py) → cascade providers

---

## North Star

- **Current product direction:** `NORTH_STAR.md` (2026-09-05). Upgrade the existing mobile app into a clean, chat-first experience. Preserve accounts, equipment, notebooks, documents, evidence, and native behavior. Slack/Foreman is the internal command center.
- **Current execution sequence:** `docs/product/2026-09-05-sellable-app-alignment.md`, tracked in [#3586](https://github.com/Mikecranesync/MIRA/issues/3586). Inventory current app → app-level chat/home/history → retained features → cited-answer proof → paid pilot readiness.
- **Beta proof remains required:** a stranger uploads their own equipment manual and gets a correctly cited answer without Mike repairing anything. Keep approved retrieval, tenant scoping, and refusal tests; refresh actual status for the build under review. See `docs/plans/2026-06-07-path-to-beta.md` and `.claude/rules/knowledge-entries-tenant-scoping.md`.
- **Preserved technical contracts:** `docs/THEORY_OF_OPERATIONS.md`, `docs/specs/maintenance-namespace-builder-spec.md`, `docs/specs/mira-component-intelligence-architecture.md`, and applicable `.claude/rules/`. Asset-agent validation and train-before-deploy gates still apply to deployment surfaces. General-help entry must not bypass asset-specific gates.
- **Priority reconciliation:** the prior 14-phase master plan and context-platform / Drive Commander lead positioning are implementation/history references. They no longer supersede the app delivery sequence. This is not blanket approval of pending architecture, providers, training, or releases.
- **GTM:** `STRATEGY.md`; previous assumptions are in `docs/product/2026-09-05-decision-history.md`. Verify pricing and pilot proof before selling.

## Coding Principles → `wiki/references/coding-principles.md`
## KANBAN Board → `wiki/references/kanban.md`

---

## Hard Constraints (PRD §4)

1. **Licenses:** Apache 2.0 or MIT ONLY.
2. **Cloud LLMs:** Groq + Cerebras + Together cascade (all free-tier, OpenAI-compat). NeonDB for persistence. Doppler-managed secrets. **No Anthropic in the diagnostic cascade** (removed PR #610 — never reintroduce there). Sole owner-authorized carve-out: the PrintSynth print-vision interpreter (PR #2661) — print-photo vision only, never chat/diagnosis.
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the LLM call.
4. **Secrets:** All via Doppler. Config is env-scoped: `factorylm/dev` (local), `factorylm/stg` (staging), `factorylm/prd` (production). Never commit `.env` to git. Never paste prod values into a dev shell — set them in `factorylm/dev`.
5. **Containers:** One per service. `restart: unless-stopped` + healthcheck. Pinned image versions.
6. **Commits:** Conventional format (`feat/fix/security/docs/refactor/test/chore/BREAKING`).
7. **UNS Compliance:** All data MUST conform to the Unified Namespace (ISA-95 ltree). See `.claude/rules/uns-compliance.md`. No free-form manufacturer/model string pairs — use UNS paths or entity FKs.
8. **Environments:** Dev / Staging / Production are separated and promoted in that order — see § **Environments** below.

---

## Environments (Dev / Staging / Production)

**Source of truth:** `docs/environments.md`. Read it before any infra/migration/deploy work.

| | DEV | STAGING | PROD |
|---|---|---|---|
| Where | CHARLIE local | CHARLIE + Neon staging branch | VPS (`165.245.138.91`) |
| Compose | `docker-compose.yml` | `docker-compose.staging.yml` (local-dev) + `docker-compose.staging-vps.yml` (VPS) | `docker-compose.saas.yml` |
| Doppler | `factorylm/dev` | `factorylm/stg` | `factorylm/prd` |
| Telegram | `@MiraDevBot` or none | `@Mira_stagong_bot` (token `TELEGRAM_BOT_TOKEN_STG`) | `@FactoryLM_Diagnose` |
| Safe to break | YES | YES (gate before promotion) | **NEVER** |

**Hard rules (do not bypass — `prod-guard.sh` enforces #1–#3):**
1. NEVER run `psql` / raw SQL against prod NeonDB from a code session. Use staging / dev / `db-inspect.yml`.
2. NEVER restart, rebuild, or `docker compose` a VPS container directly. Use `deploy-vps.yml`.
3. NEVER point a feature-branch build at `@FactoryLM_Diagnose`. Use a dev/staging/no-op adapter.
4. ALL engine / RAG / retrieval / classifier changes MUST pass the staging gate before deploy. Today: `smoke-test.yml` + the relevant `tests/eval/` regime.
5. Migrations: dev → staging → prod, via `apply-migrations.yml` (`dry-run` then `apply`). Never hand-edit prod schema.
6. KB seeds: staging first, verify BM25 retrieval, then prod via `apply-seeds.yml` / `seed-oem-manuals.yml`.

**Promotion workflow:** feature branch → PR → `smoke-test.yml` + reviews pass → merge to `main` → `deploy-vps.yml` (gated on smoke passing) → smoke against `factorylm.com` + `app.factorylm.com` → verify on `@FactoryLM_Diagnose`.

**Hotfix bypass:** `gh workflow run deploy-vps.yml -f services="…"`. File a follow-up PR within 24h that goes through the normal gate.

**Existing enforcement:** `tools/hooks/prod-guard.sh` is wired as a `PreToolUse(Bash)` hook in `.claude/settings.json`. Override (human only): `MIRA_ALLOW_PROD=1` per-shell.

---

## Repo Map

```
MIRA/
├── mira-core/       # Open WebUI + MCPO proxy + ingest service
├── mira-bots/       # Telegram, Slack adapters + shared diagnostic engine
├── mira-bridge/     # Node-RED orchestration, SQLite WAL shared state
├── mira-mcp/        # FastMCP server, NeonDB recall, equipment diagnostic tools
├── mira-pipeline/   # OpenAI-compat API wrapping Supervisor (shared/engine.py) — active VPS chat path
├── mira-web/        # PLG funnel — Hono/Bun, Stripe, /cmms landing + Mira AI chat
├── mira-cmms/       # Atlas CMMS — work orders, PM scheduling, asset registry
├── mira-crawler/    # KB ingest + manual chunker (OEM discovery pipeline)
├── mira-ops/        # Observability dashboards (Prometheus, Grafana, Flower)
├── mira-relay/      # Cloud relay endpoint for Ignition factory→cloud tag streaming (SaaS-only, in saas.yml)
├── mira-sidecar/    # ⚠️ LEGACY — ChromaDB RAG, superseded by mira-pipeline (ADR-0008); removed from prod 2026-05-20
├── mira-connect/    # ⚠️ DEFERRED — Modbus/PLC drivers (post-MVP, "Config 4")
├── wiki/            # LLM-maintained ops wiki (Karpathy pattern) — Obsidian vault
├── tests/           # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/            # PRD, ADRs, C4 diagrams, runbooks, CHANGELOG, env-vars, known-issues
├── tools/           # Photo pipeline, Google Drive ingest, migration scripts
└── plc/             # PLC program files
```

See local CLAUDE.md in each module for deep context.

## Container Map

<!-- BEGIN GENERATED container-map — tools/gen_container_map.py; regenerate: `python3 tools/gen_container_map.py --write`; verify: `--check`. Do not hand-edit. -->

**Dev** — `docker-compose.yml` include set + `docker-compose.override.yml` (env-var ports shown at their defaults):

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-core | 3000→8080 | core-net, bot-net |
| mira-mcpo | 8000 | core-net |
| mira-ingest | 127.0.0.1:8002→8001 | core-net |
| mira-tika | 127.0.0.1:9998 | core-net |
| mira-pipeline | 127.0.0.1:9099 | core-net |
| mira-bridge | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack *(profile: slack-dev)* | — | bot-net, core-net |
| mira-bot-teams *(profile: dormant)* | 8030 | bot-net, core-net |
| mira-bot-whatsapp *(profile: dormant)* | 8010 | bot-net, core-net |
| mira-bot-reddit *(profile: dormant)* | — | bot-net, core-net |
| mira-telegram-test-runner *(profile: test)* | — | core-net |
| mira-mcp | 127.0.0.1:8009→8000, 127.0.0.1:8010→8002, 127.0.0.1:8001 | core-net |
| atlas-db | 5433→5432 | cmms-net |
| atlas-minio | 9000, 9001 | cmms-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-frontend | 3100→3000 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |
| mira-redis | — | core-net |
| mira-celery-worker | — | core-net |
| mira-task-bridge | 8003 | core-net |
| mira-relay | 127.0.0.1:8765 | core-net |

**Prod (VPS)** — `docker-compose.saas.yml` (env-var ports shown at their defaults; container names differ from dev; Atlas CMMS runs as a separate compose project reached via external `cmms-ext`):

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-redis-saas | — | mira-net |
| mira-ingest-saas | 127.0.0.1:8002→8001 | mira-net |
| mira-mcp-saas | 127.0.0.1:8009→8000, 127.0.0.1:8001 | mira-net |
| mira-web | 127.0.0.1:3200→3000 | mira-net, cmms-ext |
| mira-pipeline-saas | 127.0.0.1:9099 | mira-net |
| mira-bot-telegram | — | mira-net |
| mira-bot-slack | — | mira-net |
| factorylm-foreman | — | mira-net |
| mira-ask-saas | 100.68.120.99:8011 | mira-net |
| mira-tika-saas | 127.0.0.1:9998 | mira-net |
| mira-relay | 127.0.0.1:8765 | mira-net |
| mira-sparkplug-consumer *(profile: sparkplug)* | — | mira-net, mosquitto-ext |
| nango-db | — | mira-net |
| nango-server | 127.0.0.1:3003, 127.0.0.1:3009 | mira-net |
| mira-hub | 127.0.0.1:3101→3000 | mira-net, cmms-ext |
| mira-synthetic-dogfood-worker | — | mira-net |
| mira-synthetic-dogfood-beat | — | mira-net |
| mira-historian-worker | — | mira-net |
| mira-historian-beat | — | mira-net |
| mira-cmms-sync | — | mira-net, cmms-ext |

Profile-gated rows start only with `docker compose --profile <name> up`. Staging: `docker-compose.staging-vps.yml` (`stg-*` names) — see `docs/environments.md`.

<!-- END GENERATED container-map -->

## Node Map

| Node | Hostname | User | Role | Tailscale IP | LAN IP | Subnet |
|------|----------|------|------|-------------|--------|--------|
| Alpha | Michaels-Mac-mini-2 | factorylm | Orchestrator (Celery) | 100.107.140.12 | 192.168.4.28 | 192.168.4.x |
| Bravo | FactoryLM-Bravo | bravonode | Compute (Ollama) | 100.86.236.11 | 192.168.1.11 | 192.168.1.x |
| Charlie | CharlieNodes-Mac-mini | charlienode | KB Host (MIRA) | 100.70.49.126 | 192.168.1.12 | 192.168.1.x |

**Connectivity:** Alpha↔Bravo/Charlie via Tailscale only (different subnets). Bravo↔Charlie via LAN (same subnet) with Tailscale fallback.
**SSH keys:** stored in Doppler `factorylm/prd` as `SSH_{NODE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS}`.
**Canonical source:** `deployment/network.yml`

---

## Start / Stop

```bash
doppler run --project factorylm --config prd -- docker compose up -d
docker compose down
docker compose logs -f <service>
bash install/smoke_test.sh
```

---

## Key Env Vars → `docs/env-vars.md` (25 vars, all Doppler `factorylm/prd`)

---

## Where to Resume → `wiki/hot.md`
## Offline Testing → `tests/eval/README.md`
## SimLab (ProveIt-style simulated factory benchmark) → `docs/simlab/README.md`
The flagship is a deterministic, headless **juice bottling line** (`simlab/` package): 8 machines
+ utilities, PackML states, PLC-style tags, UNS, 6 replayable fault scenarios, simulated docs,
MIRA diagnostic (evidence + rubric), train-before-deploy approval. `python -m simlab` runs it
locally. NOT a toy conveyor — the headless simulator is the source of truth; Factory I/O is an
optional visual layer only. Eval scenarios run against the real Supervisor via `tests/simlab/runner.py`.

---

## Mobile Regression Testing (default = emulator, not your phone)

**`tools/mobile-e2e/` is the default mobile regression gate.** It replays the full technician
journey against a deployed environment on an emulator - sign in, upload a manual, ingest+embed,
ask, grounded cited answer, citation resolves to the real passage - and **refuses to run against
a physical device** unless `--allow-physical` is passed.

```bash
export FLM_EMAIL='...' FLM_PASSWORD='...'
bash tools/mobile-e2e/run.sh manual.pdf "question without a question mark" <expected-page>
```

Pass a `--expect-page` you read out of the PDF **first**, so a green run means it cited the
right page rather than merely producing a citation.

**Reserve a physical device for exactly three things** - everything else is emulator work:

| Needs real hardware | Why |
|---|---|
| Cellular behaviour | the emulator is always on the host network |
| Real camera capture | no camera to miss (this is how #3353 stayed hidden) |
| Release-signed Play identity | needs the upload keystore + a Play-installed build |

Baseline these replaced: `docs/proofs/2026-08-21-pixel9a-mobile-production-proof.md`.
Emulator caveats + the eight adb traps the harness encodes: `tools/mobile-e2e/README.md`.

## Screenshot Rule (Promotional Materials Pipeline)

Every Playwright proof-of-work screenshot must ALSO be saved to `docs/promo-screenshots/` with a descriptive filename:
- Format: `YYYY-MM-DD_feature-name_viewport.png` (e.g., `2026-04-26_pm-calendar-auto-scheduled_desktop.png`)
- Always capture both desktop (1440x900) and mobile (412x915) viewports
- These feed the automated YouTube video pipeline in `tools/seedance-video-gen.py` and `tools/` video builders
- This folder is the single source of truth for all promotional visuals
- Include screenshots of: new features, before/after comparisons, key user flows, real data displays
- Never delete from this folder — it's an append-only archive

---

## Gotchas

- **macOS keychain over SSH** — `docker build`/`doppler` fail on Bravo/Charlie. Workaround: `docker cp` + restart. Bravo fixed with `doppler configure set token-storage file`.
- **NeonDB SSL from Windows** — `channel_binding` fails. Use macOS hosts instead.
- **Intent classifier** — defaults to `industrial` for unrecognized queries (biased toward helping); short greetings route to `greeting` only when <20 chars AND contain a greeting word. Fixed 2026-04-15 in #280. Still: test with realistic phrasing before assuming a bounce is a bug.
- **Competing Telegram pollers** — Only one process per bot token. Check CHARLIE for stale pollers.
- **Together AI is the third provider** — replaced Gemini (403-blocked in Doppler). Key-gated via `TOGETHERAI_API_KEY`; if all cloud providers fail, the cascade falls through to Open WebUI/Ollama.

---

## Pointers

- **Architecture (layer map + dependency rules):** `docs/ARCHITECTURE.md`
- **Quality score (domain grades):** `docs/QUALITY_SCORE.md`
- **Agent eval / tracing / observability audit + decision:** `docs/observability/mira-agent-eval-audit.md` — KEEP RAGAS/DeepEval/5-regime evals; EXTEND with `mira-bots/shared/agent_trace.py` (cloud-free per-turn trace + JSONL + optional OTel/Phoenix via `MIRA_OTEL_ENDPOINT`, off by default). Phoenix optional; no LangGraph (ADR-0011).
- **Harness plan (security/measurement/arch phases):** `docs/superpowers/plans/2026-04-17-harness-engineering-industrial-grade.md`
- **Release notes:** `docs/CHANGELOG.md`
- **Versioning & rollback (the version is DERIVED from the git tag — no `/VERSION` file since #3064; every merge auto-tags `vX.Y.Z` + a rollback checkpoint):** `docs/versioning.md` — `version-tag.yml`
- **Product offering (signal difference engine + contextual supervisor):** `docs/product/mira_difference_engine_offering.md` (positioning), `docs/product/mira_signal_difference_engine_prd.md` (PRD), `docs/plans/2026-06-30-mira-difference-engine-backlog.md` (backlog). Sharpens the `NORTH_STAR.md` wedge — "MIRA finds what changed, groups differences into machine events, explains what they mean." ~70% already built (`mira-relay` ingest + `tag_diff_logger` grouping + Supervisor); gaps = learned baselines + continuous historian. Read-only, no overclaim.
- **Kiosk / AskMira deploy + prod verify runbook:** `docs/runbooks/kiosk-askmira-deploy-and-verify.md` — read BEFORE shipping any `mira-bots/ask_api/`, kiosk-scoped engine fast-path, or AskMira `view.json` change. Documents the **`services=mira-ask`** dispatch + 9/10 Mode A hard-pass + Mode B browser verify.
- **All env vars:** `docs/env-vars.md`
- **Known issues / deferred / abandoned:** `docs/known-issues.md`
- **ADRs:** `docs/adr/`
- **Ops wiki:** `wiki/` — **Session start: read `wiki/hot.md`. Session end: update it.**
- **Wiki schema:** `wiki/SCHEMA.md`
- **Wiki sync across nodes + `~/MiraDrop/` auto-ingest:** `wiki/nodes/wiki-sync.md`
- **MiraDrop watcher (desktop drop folder → Hub `/api/uploads/folder`):** `tools/mira-drop-watcher/README.md`. LaunchAgent label `com.factorylm.mira-drop-watcher`. Drop a PDF in `~/MiraDrop/inbox/`, it lands chunked in OW knowledge collection "Facility Documents" within ~20 s; sidecars in `~/MiraDrop/done/`.
- **Skills:** `.claude/skills/`
- **Sprint state:** `.planning/STATE.md`
- **Active 90-day MVP plan:** `docs/plans/2026-04-19-mira-90-day-mvp.md` — locked 2026-04-19 → 2026-07-19; **read its "Currently in-flight" section + run the 3-command coordination check before claiming any work**
- **Active namespace-builder plan:** `docs/plans/2026-05-15-maintenance-namespace-builder.md` — integrates with the 90-day plan (Units 2/4/9a fold in as Phase 1/2/4 components); has its own "Currently in-flight" section — check both.
- **Maintenance Intelligence Module (self-onboarding Ignition module — "detect AND explain"):** resume `docs/RESUME_2026-06-14_maintenance-intelligence-module.md`; plan `~/.claude/plans/yes-map-the-path-warm-wadler.md`; proving plan `docs/plans/2026-06-14-proving-test-case-plan.md`. **Phase 1 DONE** (`83ea8e81`): the A0–A12 anomaly rules run **in-gateway** on a live Ignition tag snapshot (`ignition/webdev/FactoryLM/api/diagnose/`; rules in `plc/conv_simple_anomaly/rules_core.py`, dual Py2.7/3.12, drift-guarded by `tests/regime7_ignition/test_diagnose_parity.py`). NOTE: the Ignition **WebDev module is not installed** on the bench gateway (the HTTP endpoint 404s) — Phase 2 panel uses a Perspective project script, no WebDev needed.
- **Dev loop (pre-commit + watcher):** `wiki/references/dev-loop.md`
- **Karpathy principles (behavior rules):** `.claude/rules/karpathy-principles.md`
- **Subagent-driven development (defects/features):** `docs/agents/subagent-development-handbook.md` — contract IDs in `docs/contracts/contract-index.yaml` (red = the open defect queue); operational checklist `.claude/skills/defect-workflow/`; agents `investigator`/`test-engineer`/`implementer`/`contract-architect` + conversation/safety/security/release reviewers in `.claude/agents/`
- **Debugging & verification conventions:** `.claude/rules/debugging-conventions.md` — multi-cause perf debugging; verify schema/API paths before guessing
- **Materialized Evidence & recall-first architecture (North Star amendment 2026-07-20):** `docs/architecture/materialized-evidence.md` (5 layers) + `.claude/rules/materialized-evidence.md` (15 rules) + `docs/adr/0029-materialized-evidence.md` + inventory `docs/architecture/materialized-evidence-inventory.md`. Infer once, materialize every expensive discovery as durable typed versioned evidence, recall unless the evidence changed; the seed is `printsense/cas.py` (generalize, don't duplicate).
- **Environments doctrine (dev / staging / prod):** `docs/environments.md`
- **Enforcement layer:** `docs/specs/enforcement-layer-spec.md` — Playwright audit, write-path round-trip, enum drift, spec staleness, PR template, NeonDB canary
- **Claude Code v2.1+ defaults (Opus 4.7, xhigh, /effort, /autofix-pr, Routines):** `wiki/references/claude-code-v2.1.md`
- **MIRA Routines (cloud-side scheduled work):** `wiki/references/routines.md`
- **CodeGraph (semantic code index + MCP):** `wiki/references/codegraph.md` — usage rules in `.claude/rules/codegraph-usage.md`. Run `tools/codegraph-preflight.sh` before non-doc code work; trust the call-graph only after freshness passes. **Graphify is excluded from code navigation** (`.claude/rules/graphify-excluded.md`).
- **OCR regime (floor/model/paid lanes, recall gate, keep-alive):** docs/runbooks/ocr-regime.md
- **🧠 UNIFICATION PROGRAM — "One Technician Brain" (context is ACTIVE — read before any engine/dataset/context work — but the governing ADR/PRD are **NOT yet accepted**: status is **M1, awaiting Mike**. Honor the doctrine; do not treat it as ratified, and do not let "active" imply authorization):** PRD `docs/prd/2026-07-30-mira-unification-program.md` (goals G1–G6, workstreams WS1–WS6, milestones M0✅–M5) + decision `docs/adr/0033-one-technician-brain.md` (**status: Proposed — awaiting Mike; M1**) + execution order `docs/plans/2026-07-30-unification-path-forward.md` + **live state `docs/plans/2026-07-30-unification-program-state.md`** (tracked; `.planning/` is gitignored). **One conversational policy; specialists stay BELOW the conversation as typed-evidence producers; products are `task_mode`, not personas; corpus stays majority-general by structural cap.** Critical path: **WS1 runtime adoption of the context contract gates eval slice 13 → manifest freeze → any training spend** — `evidence_from_prior_decisions()` still has no production call site. No corpus re-scale before the review sitting; no paid run without a fresh signed authorization.

---

## Deferred / Archived Modules

| Module | Status | Why | Where to find it |
|---|---|---|---|
| `mira-hud` | **Archived 2026-04-19** | AR HMI demo, hardware-gated (Ignition + MCI badge reader), not in any compose, not customer-shippable in MVP window | branch `archive/mira-hud-2026-04` |
| `mira-prototype` | **Archived 2026-04-19** | Pre-VIM Flask MJPEG prototype, replaced by mira-pipeline + qwen2.5vl | branch `archive/mira-prototype-2026-04` |
| `mira-sidecar` | **Removed from prod 2026-05-20** | ChromaDB RAG, superseded by mira-pipeline (ADR-0008); not in `docker-compose.saas.yml`. Directory deletion tracked separately (convergence Gate 11). | still in repo |
| `mira-connect` | **Deferred to "Config 4"** (post-MVP) | Modbus TCP / PLC drivers; not in MVP critical path | still in repo, dormant |
| `mira-relay` | **Active SaaS infrastructure** (NOT deferred) | Cloud endpoint for Ignition factory→cloud tag streaming; powers MIRA Connect activation flow on `factorylm.com`. Lives in `docker-compose.saas.yml` only. | still in repo + saas.yml |

To restore an archived module: `git checkout archive/<branch> -- <module-dir>` then commit on a new branch.

---

## Verification Workflow

After every VPS deploy, run smoke tests against affected routes before claiming success:
```bash
bash install/smoke_test.sh
```
Report concrete results (status codes, container logs, or Playwright screenshots). Save screenshots to `docs/promo-screenshots/`. If smoke fails, rollback before reporting.

## Automated Code Review Pipeline

Installed 2026-04-20. Triggers on every PR to `main`/`develop`/`dev`.

| Component | File | What it does |
|-----------|------|-------------|
| GitHub Action | `.github/workflows/code-review.yml` | shellcheck → ast-grep (IPs/secrets) → cascade review (Groq → Cerebras → Gemini) → PR comment |
| ast-grep rules | `.ast-grep-rules/` | Hardcoded IPs, secrets, missing socket error handling, raw FastAPI body |
| ast-grep config | `sgconfig.yml` | Rule discovery (replaces diffray — diffray v0.5.4 requires OpenAI) |
| Self-fix script | `scripts/pr_self_fix.sh` | Reads 🔴 IMPORTANT review comments, asks the LLM cascade for patches, applies + pushes (up to 3 loops) |
| Pre-commit hook | `.githooks/pre-commit` | shellcheck + rg credential scan + debug artifact scan + actionlint (workflows) on staged files |

**To trigger manually:** `gh workflow run code-review.yml`
**To run self-fix:** `bash scripts/pr_self_fix.sh <PR_NUMBER>`
**Hook active:** `git config core.hooksPath .githooks` — **per-clone local config, NOT tracked in the repo**, so it is never "already set" for a fresh clone or a reset `.git/config`. Found unset on CHARLIE 2026-08-09 (it pointed at `.git/hooks`, which has no `pre-commit`), meaning the shellcheck + gitleaks + debug-artifact + actionlint gate had not been running at all. Verify with `git config core.hooksPath` (must print `.githooks`), and check the tools it needs are installed — it fails **open** with a yellow "not found — skipping" line, so a missing `gitleaks` looks the same as a clean scan.
**Tools required locally:** `shellcheck`, `rg`, `sg` (ast-grep), `scc`, `difft`, `actionlint`

---

## Capability closure — "merged" is not "done"

A capability is done when it is **connected** to a real consumer, **tested** by a named CI job, **enabled** somewhere real, and **proven** with evidence — or explicitly blocked/deferred/retired in `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` (validated by the gated `capability-closure` CI job). Before calling anything done, or when adding any `*_ENABLED` flag, use the `finish-capability` skill. Note the repository alone cannot tell you a flag's real state — a compose `${VAR:-0}` fallback looks identical to a live default; read Doppler. #3328 is what that costs.

## Architecture changes

Before any cross-module refactor, migration, consolidation, new service, dependency-direction change, canonical identity change, or legacy deletion, read and follow `docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`. Query the Architecture Registry (`docs/architecture/convergence/REGISTRY.yaml`) before planning. No architecture-affecting implementation may begin without an R0 known-good rollback point. Follow the gated workflow and independent adversarial-review requirements. Gate 0 outputs (drift, duplicates, ownership, backlog): `docs/architecture/convergence/GATE0_SUMMARY.md`.

## Release / PR Workflow

No PR bumps a version file and no PR hand-writes a changelog line. `/VERSION` and `.github/workflows/version-gate.yml` were **deleted 2026-08-02 (#3064)** — they were the shared line that put every open PR into conflict with every merge. `.github/workflows/version-tag.yml` derives the next semver from the latest `v*` tag plus the merge commit's **Conventional Commit type** (`feat`→minor, `fix`→patch, `feat!`/`BREAKING CHANGE`→major) and creates the tag, the paired `rollback/<date>-vX.Y.Z` checkpoint, and a GitHub Release. Release notes are generated from merged PRs (`.github/release.yml`); `docs/CHANGELOG.md` is frozen as an archive. So: write a well-formed Conventional Commit title, label the PR, and that's the whole authoring duty. See `docs/versioning.md`.

## Multi-Session Protocol

Multiple sessions work this repo in parallel. **Before claiming, isolating, pushing, or closing out any work, follow `.claude/rules/multi-session-protocol.md`** — durable work claims, actual-overlap checks, worktree/branch isolation, the Claude-implements/Codex-reviews adversarial gate (GREEN is exact-SHA, fail-closed, max 3 rounds), human-gated merge/deploy, bounded continuation, and the required session closeout.

## Git Workflow

`tools/hooks/git-state-guard.sh` (a `PreToolUse(Bash)` hook) blocks git mutators while the repo is mid-rebase or on a detached `HEAD` — **except** `git rebase --continue`/`--abort`/`--skip`/`--quit`, which are always allowed even mid-rebase, since they're the only way to resolve the wedge from inside a single Bash call. If a rebase gets wedged for a reason `--continue`/`--abort` can't resolve, **stop and ask the user** — don't retry with `MIRA_ALLOW_GIT_WEDGE=1`, `git reset --hard`, or by hand-deleting `.git/rebase-merge`. Those are destructive workarounds for a state a human should look at.

## Sub-agents / Worktrees

Any sub-agent dispatched for parallel work that will Edit/Write files MUST operate in its own isolated git worktree (`Agent` tool `isolation: "worktree"`) or have explicit confirmation there's no uncommitted foreign work in the shared checkout it could clobber — verified **before** running file/git commands, not after.

**Creating a worktree is an obligation to remove it.** The harness auto-removes one only when the agent made **no** changes, so cleanup never fires for a worktree that did work — push the branch, then `git worktree remove`. **Never leave a worktree holding `main`**: git allows one checkout per branch with no TTL, so a forgotten one blocks the shared checkout (this happened 2026-07-27; use `--detach origin/main` instead). Scripts that `git worktree add` must remove on **every** exit path via `trap … EXIT`, or deliberately reuse a **fixed** path with a defensive pre-clean — never a `$$`/timestamp-derived path. Don't delete other sessions' worktrees on a guess; `--merged` is a weak signal here (squash-merge). See `.claude/rules/subagent-worktree-isolation.md` and `docs/tech-debt/2026-07-27-worktree-clutter-rca.md`.

## Safety / Dangerous Commands

Before running `rm -rf`, `git reset --hard`, `git clean -f[d]`, or any other command that irreversibly discards data, print the exact resolved absolute path/target first and confirm it matches the intended target before executing. A deterministic floor (`tools/hooks/rm-guard.sh`, `PreToolUse(Bash)`) also hard-blocks a recursive+force `rm` that resolves to `/`, `$HOME`, the repo root, or any `.git` dir (override: `MIRA_ALLOW_RM=1`); it's a floor, not a substitute for the print-the-path discipline. See `.claude/rules/dangerous-commands-safety.md`.

## Security

Credentials and passwords come from environment variables (Doppler-managed, `factorylm/{dev,stg,prd}`) — never hardcoded in scripts, including one-off `tools/`/`plc/` ops scripts and seed/migration scripts. Enforced by `.ast-grep-rules/hardcoded-secret.yml` (every PR, `code-review.yml`) and `gitleaks protect --staged` (pre-commit). See `.claude/rules/security-boundaries.md`.

## CLAUDE.md Maintenance

This file targets **~120 lines** (map, not encyclopedia). Agent compliance drops past ~150.
- If you repeat an instruction in chat >2x, add it here.
- Delete rules Claude follows naturally. Audit monthly.
- Deep content lives in: `docs/`, `wiki/references/`, `tests/eval/`.
- Line count as of last audit: see `wc -l CLAUDE.md`

---

## Agent skills

### Issue tracker

GitHub Issues at `Mikecranesync/MIRA` via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Pocock canonical names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context. Root `CONTEXT-MAP.md` lists per-module contexts. Primary doctrine: `docs/THEORY_OF_OPERATIONS.md`. See `docs/agents/domain.md`.
