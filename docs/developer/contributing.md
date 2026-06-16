# Contributing

How to ship a change to MIRA — from branch to merged PR.

## Who can contribute

MIRA is a private, proprietary project (Cranesync). External contributions are not accepted. This document is for:

- Cranesync team members
- Contracted engineers with signed agreements
- Claude / AI agents running with direct instruction

## The golden path

1. **Start from an updated `main`** — `git checkout main && git pull`
2. **Create a branch** — `git checkout -b <type>/<short-description>`
3. **Write the code** — follow the conventions below
4. **Commit often** — small, focused commits with good messages (see Commit Conventions)
5. **Run the tests** — `pytest tests/ -m "not network"` for Python, `bun test` for TypeScript
6. **Push the branch** — `git push -u origin <branch>`
7. **Open a PR** — `gh pr create` with a descriptive title and the test plan filled in
8. **Fix any CI failures** — don't merge with red CI
9. **Wait for review** — even auto-merged PRs should pass the eval gate
10. **Squash-merge to main** — PR titles become the commit message on `main`

## Branch naming

```
<type>/<short-kebab-case-description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `security`.

Examples:
- `feat/qr-asset-tagging`
- `fix/fastmcp-v3-upgrade`
- `docs/qr-system-spec`
- `refactor/extract-guardrails-module`

## Commit conventions

Conventional Commits format:

```
<type>(<scope>): <short description>

<optional longer body>

<optional footers: Closes #123, Co-Authored-By, etc.>
```

Types (match branch-name types):

- `feat:` — new user-facing feature
- `fix:` — bug fix
- `security:` — security-specific fix
- `docs:` — documentation only
- `refactor:` — code restructuring, no behavior change
- `test:` — tests only
- `chore:` — build system, deps, tooling
- `BREAKING:` — prefix in the body when the change breaks an API or config

Scope is the affected service or module: `mira-web`, `mira-pipeline`, `engine`, `atlas`, etc.

**Good examples:**

```
feat(mira-web): add QR scan route handler at /m/:asset_tag

Implements the scan entry point described in the QR system spec.
Validates asset_tag charset, looks up tenant ownership via Atlas,
upserts asset_qr_tags and inserts qr_scan_events.

Closes #420
```

```
fix(engine): Q-trap off-by-one — fires at round 2 instead of 3

Counts every Q-state entry including the first from a non-Q
current state, so IDLE→Q1→Q2→Q3 reaches q_rounds=3 on the
third iteration as test_normal_progression expects.
```

**Bad examples** (don't do these):

```
update stuff
fixes
wip
more changes
```

## Code style

### Python

- **Runtime:** Python 3.12
- **Package manager:** `uv` (not pip, poetry, or conda)
- **Linter/Formatter:** `ruff` (not flake8, pylint, or black). Config in repo `pyproject.toml`.
  - `ruff check --fix <file>`
  - `ruff format <file>`
- **HTTP client:** `httpx` (not `requests` or `urllib`)
- **Type hints:** modern Python — `list[str]`, `dict[str, int]`, `str | None`
- **Async:** `asyncio` throughout. Never `asyncio.run()` inside async functions.
- **Logging:** `logging` stdlib, not `print()`. Service-specific logger names (`logging.getLogger("mira-gsd")`).

Full Python standards: [`.claude/rules/python-standards.md`](../../.claude/rules/python-standards.md)

### TypeScript / JavaScript

- **Runtime:** Bun (not Node). Sorry, npm scripts.
- **Package manager:** `bun` (not npm, yarn, pnpm)
- **Framework:** Hono for HTTP, React for any UI
- **Types:** strict mode. Avoid `any`.

### SQL

- Parameterized queries only. Never string-concat user input into SQL.
- Migrations live in `mira-core/mira-ingest/db/migrations/` with sequential prefixes (`NNN_description.sql`).

## Security rules (non-negotiable)

1. **Secrets:** Doppler only. Never `.env` committed to git. Never inline in code.
2. **Licenses:** Apache 2.0 or MIT only for dependencies. Flag any other license before installing.
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Containers:** One service per container. `restart: unless-stopped` + healthcheck. Pinned image versions (never `:latest` or `:main`).
5. **PII:** `InferenceRouter.sanitize_context()` must run before any cloud LLM call.

Full security boundaries: [`.claude/rules/security-boundaries.md`](../../.claude/rules/security-boundaries.md)

## Testing

### Required before PR

```bash
# Fast offline tests — must pass
pytest tests/ -m "not network and not slow"

# Lint + format — must pass
ruff check .
ruff format --check .

# TypeScript — per service
cd mira-web && bun test
```

### Required before merge to main

CI runs:
- Lint & Format
- Secrets Scan (gitleaks)
- Security Scan (semgrep)
- Unit Tests (with coverage)
- Architecture Check (layer rule enforcement)
- License Check (no forbidden licenses)
- Eval Offline (nightly fuller eval)
- Docker Build Check (Trivy CVE scan)

All must be green before merge. See [.github/workflows/ci.yml](../../.github/workflows/ci.yml).

## Pull Request template

When you `gh pr create`:

```markdown
## Summary

<1-2 sentences on what this changes and why>

## Changes

- <Bullet on each meaningful change>
- <Focus on user-facing or behavior changes>

## Test plan

- [ ] Local test for the happy path
- [ ] Local test for an edge case
- [ ] CI green on this branch
- [ ] (If applicable) Deploy to staging and verify the change live

Closes #<issue-number>
```

## Review standards

Before hitting "Merge," the reviewer checks:

- [ ] Does the code do what the PR description says?
- [ ] Are tests meaningful (not just coverage)?
- [ ] Any new dependencies? Check license.
- [ ] Any secrets committed? Re-check `git diff --cached`.
- [ ] Breaking change? Check Migration guide / docs updated.
- [ ] Does the commit message explain *why*, not just *what*?

## Getting help

- **Architecture questions:** [Architecture overview](architecture.md) or ask Mike
- **Deploy questions:** [Deployment](deployment.md) or `docs/runbooks/factorylm-vps.md`
- **CI failures:** check [wiki/hot.md](../../wiki/hot.md) for known-broken-main scenarios
- **Stuck debugging:** [`.claude/skills/diagnostic-workflow.md`](../../.claude/skills/diagnostic-workflow.md) or ask

## Where to go next

- [Local setup](local-setup.md) — if you haven't set up your dev env
- [Architecture](architecture.md) — understand the system before changing it
- [Deployment](deployment.md) — how to ship after merge
- [`CLAUDE.md`](../../CLAUDE.md) — canonical repo-level rules (this doc inherits from that)
