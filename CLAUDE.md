# MIRA — Build State

**Version:** v3.4.0 | **Updated:** 2026-05-07
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=cloud` → Groq → Cerebras → Gemini (cascade, no Anthropic — removed PR #610) | `local` → Open WebUI → qwen2.5vl:7b
**Chat path (VPS):** User phone → Open WebUI → mira-pipeline (:9099) → Supervisor (shared/engine.py) → cascade providers

---

## North Star
- **PRIMARY FOCUS — Master implementation plan:** `docs/plans/2026-06-01-mira-master-architecture-plan.md` — 14-phase build plan governing all current development. Every session must align to this plan. No unrelated dev projects until all phases are complete.
- **PRIMARY:** `docs/THEORY_OF_OPERATIONS.md` — what MIRA is, how it works, why. Read first before any feature work.
- **Contract:** `docs/specs/maintenance-namespace-builder-spec.md` — the namespace-builder product surface (UNS gate, AI proposals, readiness levels).
- **Implementation-level architecture:** `docs/specs/mira-component-intelligence-architecture.md` — component templates, KG mechanics. (Self-declared "supersedes" header is historical; the TOO doc re-layers the hierarchy.)
- **Commercial flywheel:** `NORTH_STAR.md` (still authoritative for offers + flywheel mechanics).
- **GTM motion:** `STRATEGY.md` (still authoritative for ICP + competitive table).

## Coding Principles → `wiki/references/coding-principles.md`
## KANBAN Board → `wiki/references/kanban.md`

---

## Hard Constraints (PRD §4)

1. **Licenses:** Apache 2.0 or MIT ONLY.
2. **Cloud LLMs:** Groq + Cerebras + Gemini cascade (all free-tier, OpenAI-compat). NeonDB for persistence. Doppler-managed secrets. **No Anthropic** (removed PR #610 — never reintroduce).
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
| Compose | `docker-compose.yml` | `docker-compose.staging.yml` *(TODO)* | `docker-compose.saas.yml` |
| Doppler | `factorylm/dev` | `factorylm/stg` | `factorylm/prd` |
| Telegram | `@MiraDevBot` or none | `@MiraStagingBot` *(TODO)* | `@FactoryLM_Diagnose` |
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
├── mira-sidecar/    # ⚠️ LEGACY — ChromaDB RAG, superseded by mira-pipeline (ADR-0008); sunset pending OEM migration
├── mira-connect/    # ⚠️ DEFERRED — Modbus/PLC drivers (post-MVP, "Config 4")
├── wiki/            # LLM-maintained ops wiki (Karpathy pattern) — Obsidian vault
├── tests/           # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/            # PRD, ADRs, C4 diagrams, runbooks, CHANGELOG, env-vars, known-issues
├── tools/           # Photo pipeline, Google Drive ingest, migration scripts
└── plc/             # PLC program files
```

See local CLAUDE.md in each module for deep context.

## Container Map

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-core | 3000→8080 | core-net, bot-net |
| mira-pipeline | 9099 | core-net |
| mira-ingest | 8002→8001 | core-net |
| mira-mcp | 8000, 8001 | core-net |
| mira-docling | 5001 | core-net |
| mira-bridge | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack | — | bot-net, core-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-db | 5433 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |

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

---

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
- **Gemini key blocked** — 403 in Doppler. Cascade falls through to next provider; if all fail, falls through to Open WebUI/Ollama.

---

## Pointers

- **Architecture (layer map + dependency rules):** `docs/ARCHITECTURE.md`
- **Quality score (domain grades):** `docs/QUALITY_SCORE.md`
- **Harness plan (security/measurement/arch phases):** `docs/superpowers/plans/2026-04-17-harness-engineering-industrial-grade.md`
- **Release notes:** `docs/CHANGELOG.md`
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
- **Dev loop (pre-commit + watcher):** `wiki/references/dev-loop.md`
- **Karpathy principles (behavior rules):** `.claude/rules/karpathy-principles.md`
- **Environments doctrine (dev / staging / prod):** `docs/environments.md`
- **Enforcement layer:** `docs/specs/enforcement-layer-spec.md` — Playwright audit, write-path round-trip, enum drift, spec staleness, PR template, NeonDB canary
- **Claude Code v2.1+ defaults (Opus 4.7, xhigh, /effort, /autofix-pr, Routines):** `wiki/references/claude-code-v2.1.md`
- **MIRA Routines (cloud-side scheduled work):** `wiki/references/routines.md`
- **CodeGraph (semantic code index + MCP):** `wiki/references/codegraph.md` — usage rules in `.claude/rules/codegraph-usage.md`

---

## Deferred / Archived Modules

| Module | Status | Why | Where to find it |
|---|---|---|---|
| `mira-hud` | **Archived 2026-04-19** | AR HMI demo, hardware-gated (Ignition + MCI badge reader), not in any compose, not customer-shippable in MVP window | branch `archive/mira-hud-2026-04` |
| `mira-prototype` | **Archived 2026-04-19** | Pre-VIM Flask MJPEG prototype, replaced by mira-pipeline + qwen2.5vl | branch `archive/mira-prototype-2026-04` |
| `mira-sidecar` | **Sunset pending** | ChromaDB RAG; awaiting OEM migration to Open WebUI KB before stop. Tracked in `docs/known-issues.md`. | still in repo |
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
| Pre-commit hook | `.githooks/pre-commit` | shellcheck + rg credential scan + debug artifact scan on staged files |

**To trigger manually:** `gh workflow run code-review.yml`
**To run self-fix:** `bash scripts/pr_self_fix.sh <PR_NUMBER>`
**Hook active:** `git config core.hooksPath .githooks` (already set in this repo)
**Tools required locally:** `shellcheck`, `rg`, `sg` (ast-grep), `scc`, `difft`

---

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
