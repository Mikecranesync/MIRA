# Phase 5: Agent Review + Garbage Collection — Design Spec

**Date:** 2026-04-17
**Status:** Design
**Goal:** Complete the harness engineering plan (8.5 → 9/10) with automated code review and repo hygiene.

---

## Context

Phases 1–4 added security scanning, type checking, coverage, architecture enforcement, property tests, and Docker scanning. Two gaps remain in the quality score:

1. **Agent review** — no automated check catches violations of CLAUDE.md rules, coding principles, or domain-specific patterns that static tools miss.
2. **Garbage collection** — 67 remote branches, stale coverage artifacts, dangling Docker images. No cleanup automation.

---

## Task 5.1: PostToolUse Code Review Hook

**What:** A shell script that runs after every Edit/Write, checking the modified file for anti-patterns that ruff/pyright/semgrep don't catch. Zero API calls, ~100ms.

**File:** `tools/review_hook.sh`

**Checks (grep-based):**

| # | Pattern | Severity | Rule Source |
|---|---------|----------|-------------|
| 1 | `TODO` without issue number | WARN | coding-principles.md |
| 2 | `asyncio.run()` inside async function | ERROR | python-standards.md |
| 3 | `yaml.load(` without SafeLoader | ERROR | python-standards.md |
| 4 | `import requests` | ERROR | python-standards.md |
| 5 | `.env` file reads (not via Doppler) | WARN | security-boundaries.md |
| 6 | `pool_size` or connection pooling in NeonDB code | ERROR | python-standards.md (NullPool only) |
| 7 | `:latest` or `:main` Docker tags | ERROR | security-boundaries.md |
| 8 | `pickle.load` / `pickle.loads` | ERROR | security-boundaries.md |
| 9 | `shell=True` in subprocess | WARN | security-boundaries.md |
| 10 | `print(` in non-CLI production code | WARN | python-standards.md |

**Behavior:**
- Receives `$CLAUDE_FILE_PATH` from the hook system
- Only checks `.py` and `Dockerfile` files (skip .md, .yml, .json, etc.)
- Outputs warnings/errors to stderr
- Exit code 0 always (advisory, not blocking) — blocking is handled by ruff/pyright/semgrep in CI
- Errors prefixed with `[review]` for easy identification in hook output

**Hook registration** in `.claude/settings.json`:
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "bash tools/review_hook.sh \"$CLAUDE_FILE_PATH\" 2>&1 || true"
  }]
}
```

Added to the existing PostToolUse array alongside ruff/pyright.

---

## Task 5.2: Stale Branch + Artifact Cleanup Script

**What:** A script that prunes merged remote branches, old worktree branches, stale test artifacts, and dangling Docker resources. Manual trigger or cron.

**File:** `tools/gc.sh`

**Actions:**

| # | Action | Scope | Safety |
|---|--------|-------|--------|
| 1 | Delete merged remote branches | `origin/*` except `main`, `dev` | Only branches fully merged into main |
| 2 | Delete old worktree branches | `worktree-issue-*` older than 14 days | Age-gated, merged-only |
| 3 | Remove `.coverage`, `.pytest_cache`, `__pycache__` | Repo root + all modules | Safe — regenerated on next run |
| 4 | Docker system prune | Dangling images + build cache | `--filter "until=168h"` (7 days) |
| 5 | Remove stale `/tmp/mira_*.lock` files | `/tmp/` | Only if older than 1 hour |

**Behavior:**
- `--dry-run` mode by default (shows what would be deleted, deletes nothing)
- `--execute` flag required to actually delete
- Outputs summary table at end: what was cleaned, how much space recovered
- Safe to run on any node (Alpha, Bravo, Charlie)

**CI integration:** None — this is a manual/cron tool, not a CI gate. Can be scheduled via `crontab` on Alpha if desired.

---

## Verification

1. **Review hook:** Edit a Python file with `import requests` — hook should output `[review] ERROR: Use httpx, not requests`
2. **GC script:** Run `bash tools/gc.sh --dry-run` — should list stale branches and artifacts without deleting
3. **Quality score:** Update QUALITY_SCORE.md to mark both Phase 5 items as complete

---

## Files Modified

| Action | File |
|--------|------|
| Create | `tools/review_hook.sh` |
| Create | `tools/gc.sh` |
| Modify | `.claude/settings.json` (add review hook to PostToolUse) |
| Modify | `docs/QUALITY_SCORE.md` (mark Phase 5 complete) |
| Modify | harness plan (check off Phase 5) |
