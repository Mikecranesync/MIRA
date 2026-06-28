# CHANGELOG

All notable changes to MIRA are documented here.
Format: [Conventional Commits](https://www.conventionalcommits.org/)

## [Unreleased]

### Added
- Run-centric fault detection (#2341): `machine_run`/`run_step`/`run_baseline`/`run_diff` schema (migration 038) plus a pure `run_engine` (segmentation → baseline → run-diff) driven by a gated Celery beat task (`MIRA_RUN_DIFF_ENABLED`). Records a run, learns a normal baseline, and diffs anomalous runs into evidence.
- Tag-diff historizer is now scheduled: a Celery beat task (every 5 min) drives the existing `tag_diff_logger` over the `tag_events` stream into `tag_event_diffs`, so the meaningful-change stream is actually produced (#2343).
- Historian Query API in `mira-relay`: swappable `HistorianAdapter` + Postgres impl, read endpoints (`/api/tags/live`, `/api/tags/{id}/history`, `POST /api/trends`, `/api/evidence/{id}`), and a tenant-scoped `/ws/tags` subscription socket; runs endpoint stubbed 501 pending the run schema (#2339).

### Fixed
- Hub QA credentials now seed real RBAC personas for every tenant role plus a second-tenant isolation user, and the saved-session helper fails unless a NextAuth session cookie exists.
- Hub secret-shopper QA password helper now accepts Hermes env vars, requires explicit prod confirmation, rejects weak passwords, and verifies the exact tenant member update.
- Hub CMMS quick links and Atlas record deep links now use the canonical Atlas app routes for preventive maintenance and work-order reporting.
- Hub production deploy wiring now passes the shared Hub-to-Atlas SSO signing configuration into `mira-hub`, and synthetic QA seeding can consume Doppler-backed per-persona credentials without logging password values.
- Hub CMMS links now go through a signed Hub-to-Atlas SSO handoff so authenticated Hub users land in FactoryLM Works without re-entering credentials.
- Hub lint debt is cleared across app pages, shared components, and e2e probes so `mira-hub` ESLint runs with zero errors and zero warnings.
- Hub CMMS quick links and Atlas record deep links now target the FactoryLM Works app routes (`/app/work-orders`, `/app/assets`, `/app/preventive-maintenance`, and `/app/reports`) instead of public marketing paths that render provider 404 pages.
- FactoryLM trailing-slash redirects now preserve the canonical HTTPS public host and reject hostile forwarded hosts, loopback forwarded hosts, and attacker-supplied public-host ports.
- Hub CMMS health coverage now guards against browser-facing links exposing the internal Docker hostname `cmms-backend`.
- RAG tenant isolation and prompt-boundary hardening: aggregate knowledge search stays shared-only, and retrieved docs are treated as untrusted reference data instead of system-role instructions.
- Hub synthetic-day QA now targets the current live asset-card links instead of stale table/card selectors.
- Hub mobile logout access: authenticated users can now sign out from the mobile More drawer, and the desktop sidebar sign-out control is wired to NextAuth.
- Hub namespace empty state now offers direct first-folder creation and an upload path for new maintenance managers.

### Added
- Hub readiness and Ask MIRA now gate answers on approved asset context, surface missing-context checklists, and filter unverified KG/live context from cited responses.
- Hub contextualization import now has a DB-backed integration harness, guarded Neon/Doppler runners, and disposable integration fixtures for proving the context-spine intake/review flow.
- Hub team settings now support self-serve tenant-scoped magic-link invites for admins and owners.
- Production-safe synthetic conveyor QA provisioning and persona-run guardrails for Hub pre-human-test checks.

### Changed
- Recorded the staging ingest-schema reconciliation and added a read-only drift probe plus migration immutability doctrine.

### Added
- **ProveIt proof packets**: auditable contextualized-diagnosis proof harness, self-verifying PDF packets, integrity tests, and an honest blind-spots report.
- **VFD Analyzer setup wizard** (Ignition `testing` sandbox): Connect → Verify → Map → Save tag-mapping flow with first-timer role education; Jython 2.7 unicode save bug fixed (config validator) — verified live end-to-end.
- **MIRA PLC Parser** (`mira-plc-parser/`): read-only, offline, vendor-agnostic export → IR pipeline (Rockwell L5X + tag CSV), closed-project detection with export instructions, offline CLI, PyInstaller packaging foundation.

## [0.5.2] — 2026-03-21

### Fixed
- **Docker SSH pulls** (BRAVO): disabled `docker-credential-osxkeychain` + `docker-credential-desktop` — `docker pull` now works over SSH without macOS keychain
- **Doppler SSH access** (BRAVO): service token via `DOPPLER_TOKEN` env var + rewrote `.doppler.yaml` to remove keychain token reference
- **Container image pinning**: mira-core pinned to `open-webui:v0.8.10`, mira-bridge pinned to `node-red:4.1.7-22` — no more `:latest` or `:main`
- **Volume migration**: data volumes migrated from `mira-core_*` prefix to `mira_*` prefix (root compose project name)
- **`.gitignore` cleanup**: added `*.bak`, removed redundant `data/mira.db` entry

### Added
- Git tags `v0.5.0` and `v0.5.1` created and pushed (were missing)
- All 5 locally-built Docker images tagged `v0.5.1` on BRAVO
- `/usr/local/bin` added to BRAVO `~/.zshrc` PATH for SSH sessions

## [0.5.1] — 2026-03-21

### Added
- `interactions` table in SQLite — append-only log of every user/bot exchange with `response_time_ms`
- `harvest-interactions.py` — automated quality flag pipeline: session resets, slow responses, confusion signals, premature endings, repeated questions
- Quality flags output to `mira-bots/tools/output/quality-flags.md` + `interaction-log.json`
- GitHub integration: `--post-github` flag posts summary to issue #18
- Launchd cron schedule documented for daily harvest on BRAVO (6am)

## [0.5.0] — 2026-03-21

### Fixed
- **Reset bug** (`engine.py`): active session messages classified as "off_topic" now fall through to RAG worker instead of resetting with "I help maintenance technicians..." — fixes photo → options → "I don't know yet" → reset flow
- **`last_question` persistence** (`engine.py`): photo-no-intent path now sets `session_context.last_question` so follow-up routing always has context
- **Grounding validation** (`engine.py`): threshold raised from 3 to 5 significant words, stop-words excluded from overlap calculation
- **FSM transition validation** (`engine.py`): invalid `next_state` from LLM rejected and logged instead of blindly accepted
- **Bare except blocks** (`engine.py`, `telemetry.py`, `rag_worker.py`): 4 silent `except Exception: pass` now log before passing

### Added
- Safety keywords expanded 11 → 21: rotating hazard, pinch point, entanglement, confined space, pressurized, caught in, crush/fall hazard, chemical spill, gas leak
- Technician abbreviation dictionary expanded 38 → 63 terms: seq, e-stop, pneu, cont, act, prox, sol, vlv, brg, enc, srv, io, di/do/ai/ao, pid, pmp, fdr, intlk, and more
- `MIRA_HISTORY_LIMIT` env var (default 20) — configurable conversation history limit
- C4 architecture diagrams rewritten as `flowchart`/`sequenceDiagram` for GitHub rendering
- Status audit system (`.planning/STATUS_AUDIT.md`)
- 18 GitHub issues created with labels, milestones (v0.5.0, v1.0.0), and tier classification

### Changed
- `docs/README.md` — updated container count (7→9), added missing doc links
- `docs/architecture/*.md` — all 5 diagrams use GitHub-renderable Mermaid syntax

## [0.4.1] — 2026-03-20

### Fixed
- **Photo batching** (`bot.py`): 4-second buffer groups rapid-fire multi-photo messages into a single batch response instead of N separate replies
- **Session context** (`engine.py`): equipment type and last question stored in `context.session_context` JSON; off-topic messages mid-session now recap the last diagnostic question instead of resetting
- **SESSION_FOLLOWUP routing** (`guardrails.py`, `engine.py`): `detect_session_followup()` catches mid-session link/URL/manufacturer/earlier-reference requests and routes them through the RAG pipeline instead of the off-topic guard
- **Self-reference memory** (`rag_worker.py`): "you said"/"earlier"/"before" queries inject last 3 MIRA assistant turns into system context so the model can accurately reference its own prior responses
- **Response deduplication** (`engine.py`): `deduplicate_options()` strips numbered option lines from the reply body before appending the options list, eliminating duplicate display

### Added
- `mira-bots/tests/test_conversation_continuity.py` — 4 unit tests for all fixes above

## [0.4.0] — 2026-03-20

### Added
- Langfuse telemetry wrapper (`shared/telemetry.py`) — graceful no-op when unconfigured
- `Supervisor._infer_confidence()` — keyword-based reply confidence scoring
- `Supervisor.process_full()` — structured return with reply, confidence, trace_id, next_state
- Reddit benchmark agent — harvest real questions, run through Supervisor, report confidence/latency
- Prejudged multi-turn benchmark — simulate full diagnostic conversations with known answers
- 10 hand-crafted seed cases (VFD, motor, PLC, compressor, conveyor, hydraulic, sensor, soft starter, chiller)
- Reddit solved thread parser — extract ground truth from community-verified fixes
- LLM judge with 5-dimension scoring (evidence utilization, path efficiency, GSD compliance, root cause alignment, expert comparison)
- FastAPI routes for benchmark agent (`/agents/reddit-benchmark/*`)
- MIRA AR HUD simulator prototype (`mira-prototype/`)
- VERSION file tracking at 0.4.0
- `develop` branch for feature isolation
- Pre-commit hook blocking direct commits to `main`

### Changed
- `.gitignore` — exclude `*.db`, `/data/`, `/output/`, `mira-bots/benchmark_results/`
- `.env.template` — document Langfuse and Reddit benchmark env vars
- Docker images remain pinned: Open WebUI v0.8.10, Node-RED 4.1.7-22

### Infrastructure
- 21 unit tests (8 reddit benchmark + 13 prejudged benchmark)
- Prompt versioning system established (v0.1 baseline)

## [0.1.0] — 2026-03-18

### Added
- Monorepo consolidation — mira-core, mira-bridge, mira-bots, mira-mcp unified
- Root `docker-compose.yml` with `include:` directives (requires Compose v2.20+)
- Root `.gitignore` — covers all sub-repos, secrets, orphan dirs
- `README.md` — 3-step clone-and-go setup
- `docs/AUDIT.md` — baseline state capture (7 sections)
- `docs/PRD_v1.0.md` — Config 1 MVP implementation plan
- `.planning/STATE.md` — running phase state and decision log
- `.planning/ROADMAP.md` — phase table with status
- `.claude/skills/smart-commit.md` — conventional commit automation skill
- `archives/` — pre-monorepo git history backups for all 4 sub-repos

### Context
- v0.3.1: Claude API inference router, dual-backend vision (claude|local)
- NeonDB wired in (v0.3.0): 5,493 knowledge entries, pgvector recall
- 7 Docker containers all healthy
- Telegram + Slack bots live in production
