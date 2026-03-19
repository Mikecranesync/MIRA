# CHANGELOG

All notable changes to MIRA are documented here.
Format: [Conventional Commits](https://www.conventionalcommits.org/)

## [Unreleased]

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
