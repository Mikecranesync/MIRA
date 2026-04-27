# Overnight PLAN — <branch-or-task-name>

> Copy this file to the working branch root as `PLAN.md` before kicking off an
> unattended Claude session. The session is instructed to re-read PLAN.md
> before each task and **stop after the numbered list is complete** — no scope
> expansion.

**Date queued:** YYYY-MM-DD
**Operator (you):** Mike
**Branch / worktree:** `<branch>` in `.claude/worktrees/<name>`
**Token budget:** <max tokens or "default">
**Max turns before forced compact:** 200

---

## Goal (one sentence)

<What does "good" look like at 7am? Concrete, testable.>

## In scope — numbered, ordered, **complete this list and STOP**

1. <Task 1 — exact files / endpoints touched>
2. <Task 2 — exact files / endpoints touched>
3. <Task 3 — …>

## Explicitly OUT of scope (do not touch)

- <Module / file / decision the session must NOT modify>
- <…>
- **Production deployments are blocked by `.claude/hooks/prod-guard.sh`.**
  If you find yourself wanting to SSH to prod, stop and write a HANDOFF note.

## Success criteria — per task

| # | Task | How "done" is measured |
|---|------|------------------------|
| 1 | …    | `pytest tests/eval/<...>` passes / `npm run build` exits 0 / curl <endpoint> returns 200 |
| 2 | …    | … |

## Stop conditions (any one → stop and write HANDOFF.md)

- A task in this list is blocked by missing context the operator did not provide.
- Stop-gate hook blocks the same gate twice in a row (real failure, not lint noise).
- Any modification would touch a file in the OUT-of-scope list.
- Token usage > 70% of budget (compact + handoff, do not power through).
- More than 5 consecutive turns spent on the same single failing test.

## Commit / branch policy

- Conventional commits (`feat/fix/security/...`).
- Commit every 20–30 turns of useful work, even if a task is mid-flight.
- Push to `<branch>` only. Never to `main`/`develop`/`dev`.
- After each push: PR review pipeline (`.github/workflows/code-review.yml`)
  fires. If 🔴 IMPORTANT comments appear, run `bash scripts/pr_self_fix.sh
  <PR>` once. If still red after one round, stop and write HANDOFF.

## Handoff protocol

- Write `HANDOFF.md` (template in `docs/templates/overnight-HANDOFF.md`)
  before stopping for any reason — success, blocked, or out of budget.
- HANDOFF.md is what the operator reads first thing in the morning.

## References for the session (read once at start, do not re-load)

- `CLAUDE.md` — repo map, hard constraints
- `.claude/rules/python-standards.md`
- `.claude/rules/security-boundaries.md`
- `wiki/references/overnight-runs.md` — playbook this PLAN is enforcing
- `docs/plans/2026-04-19-mira-90-day-mvp.md` — current sprint plan (read its
  "Currently in-flight" section before claiming any work)
