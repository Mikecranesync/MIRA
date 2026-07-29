# Dependabot Wave 3 — Triage & Merge-Go List

**Date:** 2026-06-12 · **Author:** agent (Wave 3 goal) · **Status:** agent-side DONE; merges await Mike's go.

## TL;DR

The two stale premises in the goal were both wrong (verified, not assumed):

1. **No workflow PR was needed.** "E2E smoke" *is* the smoke-test gate job — already
   bun-migrated by #1855. "Unit Tests" (ci.yml `test-unit`) is **pure Python, zero npm** —
   its RED was a stale engine-bug failure (`test_reranking … assert 'GS10 VFD' in 'Help'`,
   June-8 run) already fixed on `main` by #1872/#1873. Both jobs are GREEN on `main` now.
2. **The "dup pairs" are not duplicates.** They bump the same package in **different
   modules** — closing either leaves a module un-bumped:
   - #1799 python-multipart in `mira-core/mira-ingest` vs #1800 in `mira-mcp`
   - #1793 beautifulsoup4 in `mira-crawler` vs #1797 in `mira-core/mira-ingest`

**Real unblock = rebase each PR onto `main`** (`@dependabot rebase`). Proven on #1804 + #1799:
after rebase both went GREEN on E2E smoke + Unit Tests + staging-gate. No `package-lock.json`
regen touched (per `reference_mira_hub_lockfile_npm_version`).

## CI coverage caveat (read before trusting "green")

The `Unit Tests` job installs only `mira-core/mira-ingest` + `mira-bots/{telegram,teams}`
requirements. It does **NOT** import `mira-mcp` or `mira-crawler` deps. So for bumps in those
modules, green CI says nothing about the bump itself — those are classified on **semver +
changelog**, flagged `[CI doesn't exercise]`.

## Classification

### ✅ SAFE — rebased onto main, gates green (Mike's merge-go)

| PR | Bump | Module | Type | CI exercises? | Note |
|----|------|--------|------|---------------|------|
| #1799 | python-multipart 0.0.30→0.0.32 | mira-core/mira-ingest | patch | yes | **proven green** |
| #1804 | praw 7.8.1→7.8.2 | mira-bots/telegram | patch | yes | **proven green** |
| #1797 | beautifulsoup4 →4.15.0 | mira-core/mira-ingest | minor | yes | |
| #1798 | uvicorn 0.48→0.49 | mira-core/mira-ingest | minor (0.x) | yes | |
| #1793 | beautifulsoup4 →4.15.0 | mira-crawler | minor | no | semver-safe |
| #1800 | python-multipart 0.0.30→0.0.32 | mira-mcp | patch | no | semver-safe |
| #1803 | fastmcp 3.3.*→3.4.* | mira-mcp | minor | no | semver-safe |
| #1794 | hono 4.12.23→4.12.24 | mira-web | patch | no | trivial patch |

### ⛔ HOLD — human review of breaking changes (do NOT bulk-merge)

| PR | Bump | Module | Why HOLD |
|----|------|--------|----------|
| #1795 | redis 5.2.1→**8.0.0** | mira-crawler | 3 major versions; client API/behavior changes. CI doesn't exercise. |
| #1801 | starlette 0.52.1→**1.2.1** | mira-mcp | major 0.x→1.x; ASGI/middleware breaking changes; fastmcp/starlette pin interplay. CI doesn't exercise. |
| #1796 | actions/upload-artifact **4→7** | (workflows) | 3 major action versions; verify changelog for breaking output/retention changes before merge. |
| #1805 | openviking 0.3.20→0.3.24 | mira-mcp | **explicit pin warning preserved**: openviking pulls litellm pinning `python-dotenv==1.0.1`, conflicts with fastmcp 3.x `>=1.1.0`. Bump keeps the warning comment → needs human confirm the conflict is resolved at 0.3.24. CI doesn't exercise. |

## DONE-WHEN resolution (honest mapping)

- ~~Workflow bun-migration PR + its staging-gate green~~ → **moot**: already done in #1855 (E2E smoke);
  Unit Tests is Python (no npm); both green on main. Opening a PR would be a no-op.
- ~~Close 2 dup PRs~~ → **moot**: the pairs are not dups (different modules). Closing would lose a bump.
- Each remaining bump labeled SAFE/HOLD with one-line reason → **done** (tables above).
- SAFE set update-branched to staging-gate green → **done** (8 PRs rebased, gates green).
- Consolidated merge-go list for Mike → **this file**.

## Merge-go (Mike's call)

**Merge together (SAFE):** #1799 #1804 #1797 #1798 #1793 #1800 #1803 #1794
**Hold for review:** #1795 (redis major) · #1801 (starlette major) · #1796 (upload-artifact 3-major) · #1805 (openviking pin-conflict)
