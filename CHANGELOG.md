# CHANGELOG

All notable changes to MIRA are documented here.
Format: [Conventional Commits](https://www.conventionalcommits.org/)

## [Unreleased]

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
- VERSION file tracking at 0.4.0
- `develop` branch for feature isolation
- Pre-commit hook blocking direct commits to `main`
- Git tags `v0.4.0` baseline

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
