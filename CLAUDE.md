# MIRA Agent Bootstrap Policy

**Policy revision:** 2.0 | **Effective date:** 2026-07-28 | **Supersedes:** `98a617a9`
**Changelog:** `docs/agents/claude-policy-changelog.md`

MIRA is the grounded maintenance agent. FactoryLM is the maintenance-context
layer. Lead with context, not a generic copilot. Product doctrine:
`NORTH_STAR.md`, `docs/THEORY_OF_OPERATIONS.md`.

## Load Order

1. Read this file first.
2. Read `wiki/hot.md` for current repo state before substantive work.
3. Read active task plans; start with `docs/plans/` and `CONTEXT-MAP.md`.
4. Read module-local `CLAUDE.md` files before editing inside a module.
5. After substantive project-state changes, update `wiki/hot.md`.

## Non-Negotiable Constraints

1. Licenses: Apache 2.0 or MIT only.
2. Secrets come from Doppler (`factorylm/dev`, `factorylm/stg`, `factorylm/prd`).
   Never commit `.env` files or paste prod values into dev.
3. UNS compliance is mandatory. Use UNS paths or entity FKs, not free-form
   manufacturer/model pairs. See `.claude/rules/uns-compliance.md`.
4. Containers use one service per container, pinned images, healthchecks, and
   `restart: unless-stopped`. Never use `privileged: true`,
   `network_mode: host`, or floating image tags.
5. Conventional commits: `feat`, `fix`, `security`, `docs`, `refactor`,
   `test`, `chore`, or `BREAKING`.
6. Do not auto-promote `proposed` knowledge-graph state to `verified`.
7. Do not reintroduce Anthropic into the diagnostic cascade. The only current
   owner-approved carve-out is the gated PrintSense print-vision interpreter.

## Providers And Frameworks

The diagnostic cascade is Groq -> Cerebras -> Together via
`mira-bots/shared/inference/router.py`. Providers are key-enabled and
OpenAI-compatible.

LangChain is permitted. The old LangChain ban and the broad ban on frameworks
that abstract LLM calls are superseded by this policy.

Prefer direct provider calls for simple paths. Adopt orchestration frameworks
only when they reduce total complexity, preserve provider portability, and
include tests. Do not rewrite stable production paths solely to adopt a
framework.

LangGraph remains excluded unless separately approved. ADR-0011 is still the
current decision for the diagnostic FSM: no LangGraph migration.

## Environment Boundaries

Source of truth: `docs/environments.md`.

1. Dev, staging, and production are separated and promoted in that order.
2. Never run `psql` or raw SQL against prod NeonDB; use dev, staging, or
   `db-inspect.yml`.
3. Never restart, rebuild, or `docker compose` a VPS prod container directly;
   use `deploy-vps.yml`.
4. Never point feature-branch bots, evals, or scrapers at `@FactoryLM_Diagnose`.
5. Engine, RAG, retrieval, classifier, migration, and KB-seed changes must pass
   the staging path before production promotion.
6. Migrations go dev -> staging -> prod via `apply-migrations.yml` (`dry-run`
   before `apply`). Never hand-edit prod schema.
7. KB seeds go staging first; verify retrieval before prod.
8. Hotfix deploy bypasses require a follow-up PR within 24 hours.
`tools/hooks/prod-guard.sh` enforces obvious prod blast-radius cases; it is a
floor, not a substitute for judgment.

## Release And Verification

Shippable code PRs bump `/VERSION` and update `docs/CHANGELOG.md`; docs/wiki
PRs are exempt. See `docs/versioning.md`.

Before claiming success, report concrete verification: tests, status codes,
logs, screenshots, or workflow runs. Visual proof: `docs/runbooks/visual-proof.md`.

Use `docs/agents/code-review.md` for the automated review pipeline and
`scripts/pr_self_fix.sh` workflow. Treat AI review comments as signals to
verify, not facts to apply blindly.

## Git And Worktrees

Before branch work, fetch and verify freshness against `origin/main`. If a
checkout is dirty, detached, or stale, use a clean isolated worktree or branch
from `origin/main`.

`tools/hooks/git-state-guard.sh` blocks git mutators while the repo is
mid-rebase or detached, except `git rebase --continue`, `--abort`, `--skip`,
and `--quit`. If those cannot unwind the state, stop and ask.

Write-capable sub-agents must use isolated worktrees unless the shared checkout
is explicitly verified clean. Creating a worktree creates a teardown
obligation: push or abandon the branch, then remove it. Never leave a worktree
holding `main`; use `--detach origin/main`. Scripts that create worktrees must
trap cleanup on every exit path or reuse one fixed path with defensive
pre-clean. Do not delete other sessions' worktrees from `--merged` heuristics.
See `.claude/rules/subagent-worktree-isolation.md`.

Before destructive commands such as `rm -rf`, `git reset --hard`, or
`git clean -fd`, print the resolved absolute target and confirm it is the
intended target. See `.claude/rules/dangerous-commands-safety.md`.

## Security

Credentials, passwords, tokens, and private customer data never belong in
scripts, fixtures, prompts, logs, screenshots, PR bodies, or commits. Use
`.claude/rules/security-boundaries.md`, gitleaks, ast-grep, and staged diff review.

## Routing Map

- Product doctrine: `NORTH_STAR.md`, `STRATEGY.md`, `docs/THEORY_OF_OPERATIONS.md`.
- Architecture: `docs/ARCHITECTURE.md`, `CONTEXT-MAP.md`, module `CLAUDE.md`.
- Container inventory: `docs/architecture/container-map.md`.
- Network/node inventory: `deployment/network.yml`.
- Environments, deploys, migrations, hotfixes: `docs/environments.md`.
- Env vars: `docs/env-vars.md`.
- Deferred, archived, and abandoned work: `docs/known-issues.md`.
- Issues, triage labels, and domain-doc routing: `docs/agents/`.
- CodeGraph usage: `wiki/references/codegraph.md`, `.claude/rules/codegraph-usage.md`.

## Rollout Rule

Sessions started before this policy merges may finish only their current
scoped task. Before new work, update from `main`, start a fresh session, run
`/memory`, and confirm Policy revision 2.0 is loaded.

## Maintenance

This file targets 110-130 lines, maximum 140. Keep root policy durable and short.
