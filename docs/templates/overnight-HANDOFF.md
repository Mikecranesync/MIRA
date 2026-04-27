# Overnight HANDOFF — <branch-or-task-name>

> Written by the autonomous session before stopping. The morning operator
> reads this **first** — before reading any code or running any tests.

**Date stopped:** YYYY-MM-DD HH:MM (local)
**Reason stopped:** completed | blocked | budget | gate-failure-loop | out-of-scope-needed
**Branch:** `<branch>`
**Last commit:** `<sha> — <subject>`
**Turns used:** <n> / 200
**Token usage at stop:** <pct> %

---

## What was actually done (vs. PLAN.md)

| PLAN # | Task | Status | Evidence |
|--------|------|--------|----------|
| 1 | … | done | commit `<sha>`, test `<name>` passes |
| 2 | … | partial | implemented `<x>`, missing `<y>` |
| 3 | … | not-started | blocked by item 2 |

## What I did NOT touch (confirming scope discipline)

- <File / module from PLAN OUT-of-scope list — confirm untouched>
- `git diff main...HEAD --stat` summary: <paste counts>

## What's broken / risky (read this before merging)

- <Anything you're not sure about>
- <Tests that pass but feel fragile>
- <Any review-pipeline 🔴 comments that were not fixed and why>

## Open decisions for the operator

1. <Decision needed — with options A/B and my recommendation>
2. <…>

## Reproduce the state

```bash
cd .claude/worktrees/<name>
git log --oneline main..HEAD
git diff main...HEAD --stat
```

## Suggested morning checklist (operator)

- [ ] Read this HANDOFF top to bottom.
- [ ] `git log --oneline main..HEAD` — does the commit count match what you queued?
- [ ] `git diff main...HEAD --stat` — any files changed that aren't in PLAN scope?
- [ ] Run the evidence commands in the table above — do they actually pass for *you*?
- [ ] Skim the review pipeline PR comments.
- [ ] Only then: cherry-pick / merge / discard.
