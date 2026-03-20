# CHANGELOG

All notable changes to MIRA are documented here.
Format: [Conventional Commits](https://www.conventionalcommits.org/)

## [Unreleased]

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

### Changed
- `.gitignore` — exclude `*.db`, `/data/`, `/output/`, `mira-bots/benchmark_results/`
- `.env.template` — document Langfuse and Reddit benchmark env vars
- Docker images remain pinned: Open WebUI v0.8.10, Node-RED 4.1.7-22

### Infrastructure
- 21 unit tests (8 reddit benchmark + 13 prejudged benchmark)
- Prompt versioning system established (v0.1 baseline)
- VERSION file added at repo root

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
