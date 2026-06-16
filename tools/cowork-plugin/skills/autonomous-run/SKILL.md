---
name: autonomous-run
description: Use at the start of any autonomous, overnight, or unattended work session in the MIRA repo. Trigger on any prompt that implies multi-hour unsupervised execution — "run overnight", "while I sleep", "do this autonomously", "go for it", "work through the night", "unattended", "background run", "long-running session", "before I wake up", "kick this off and let it run", or anything similar. Enforces the prevention framework installed 2026-04-26: PLAN.md scope-lock, worktree isolation, Stop-hook + prod-guard validation, commit cadence, HANDOFF discipline, and the hard stop conditions that prevent the 2026-04-25 regression pattern (14 branches, 18 reviewer bugs). MUST trigger before the first real tool call on any unsupervised work — "I'll be careful" is not a substitute for executing the pre-flight.
---

# Autonomous Run — Discipline for Unattended MIRA Sessions

Born from the 2026-04-25 overnight run that produced 14 branches and 18 reviewer bugs (post-mortem: `docs/competitors/pre-merge-review-2026-04-25.md`). This skill is the *operator-side discipline* that the deterministic hooks (`tools/hooks/stop-gate.sh`, `tools/hooks/prod-guard.sh`) cannot enforce on their own. The hooks block the worst outcomes; this skill prevents you from ever needing them to.

The full theory of why long unsupervised LLM sessions degrade is in `wiki/references/overnight-runs.md` — read it once, internalize, then come back here for the operating procedure.

## Pre-flight — execute every check before the first real tool call

A failed pre-flight is a STOP, not "proceed with caution". The 2026-04-25 run ignored its own setup; that's the failure mode this prevents. Run all seven, then ack the operator with the results before doing any work.

1. **Worktree isolation.** `git rev-parse --show-toplevel` — must not be `/Users/charlienode/MIRA` itself. Worktrees live under `.claude/worktrees/<name>`. If you're on the main checkout, refuse and ask the operator for the worktree path.

2. **Branch is not main/develop/dev.** `git branch --show-current` — if it returns any of those, refuse. The push target is your branch and only your branch.

3. **PLAN.md exists at branch root.** `test -f PLAN.md` — if missing, refuse. Template: `docs/templates/overnight-PLAN.md`. The PLAN must contain a numbered scope list, an explicit OUT-of-scope list, and per-task success criteria. If any of those are absent, ask the operator to fill them in before proceeding.

4. **Hooks are wired.** `jq '.hooks | keys' .claude/settings.json` should return at least `Stop`, `PreToolUse`, `PostToolUse`, `SessionStart`. Confirm `Stop[0].hooks[0].command` references `tools/hooks/stop-gate.sh` and `PreToolUse[0].hooks[0].command` references `tools/hooks/prod-guard.sh`. If missing, refuse — the hooks are the safety net.

5. **No override env vars set.** `echo "${MIRA_ALLOW_PROD:-}/${MIRA_SKIP_STOP_GATE:-}"` should print `/`. Those overrides exist for human-supervised use; an autonomous session has no business invoking them.

6. **Coordination check (per the 90-day MVP plan).** Read `docs/plans/2026-04-19-mira-90-day-mvp.md` "Currently in-flight" section AND run the 3-command coordination check it specifies. Confirm no other parallel work targets the same files PLAN.md touches.

7. **Read these operator-memory entries first** — they are standing rules, non-negotiable:
   - `automated_run_gates` — gates that MUST run before claiming done
   - `mira_definition_of_done` — what "done" actually means
   - `mira_security_checklist` — what the 2026-04-25 reviewer caught
   - `subagent_dispatch_rules` — no parallel subagents on overlapping writes
   - `mira_overnight_scaffolding` — locations of the templates/hooks/wiki

If all seven pass, ack with a single tight message: branch name, worktree path, the numbered scope items from PLAN.md, the explicit OUT-of-scope list. Then begin.

## Operating procedure — every turn

Work in tight loops: re-read PLAN → execute the next item → commit → check stop conditions.

**Re-read PLAN.md scope before starting each new numbered item.** Not the whole PLAN every turn — but before each task transition, glance at the scope and OUT-of-scope. If your next move would touch an OUT-of-scope path, STOP and write HANDOFF. Do not "expand the plan" mid-session — that's how 2026-04-25 produced 14 branches when it was asked for fewer.

**Commit every 20–30 turns of useful work, even if a task is mid-flight.** Conventional commits (`feat/fix/security/docs/refactor/test/chore/BREAKING`). Push to your branch every commit. CI fires (`.github/workflows/code-review.yml`); if 🔴 IMPORTANT comments appear on the PR, run `bash scripts/pr_self_fix.sh <PR>` *once*. If still red after one self-fix round, STOP and write HANDOFF — do not loop forever on review fixes.

**Never push to main/develop/dev. Never.** The worktree is your sandbox; the operator merges in the morning after reading HANDOFF.

**Never SSH to prod, restart prod containers, reload nginx, or apply kubectl changes.** The prod-guard hook will deny these (`tools/hooks/prod-guard.sh` blocks the patterns), but you should not even attempt them — denied calls waste turns and add nothing.

**Subagents:** Never parallelize on overlapping write paths. If two subagents would both write to `mira-pipeline/`, run them sequentially, or do the writes yourself after they research in parallel. The 2026-04-25 worktree contamination came from this exact mistake.

## Stop conditions — any one means stop and write HANDOFF

These are not suggestions. Several of these were hit on 2026-04-25 and ignored.

| Condition | Why it's a stop |
|-----------|-----------------|
| All PLAN.md tasks complete | The plan is the contract. Do not "while I'm here, also fix..." |
| Token usage > 70% of session budget | Past 70%, context degrades fast. Compact + handoff beats pushing through |
| Turn count > 200 | Same reason. Hand off to a fresh session |
| Stop-gate blocks the same gate twice in a row | That's a real failure, not lint noise. Surface it |
| A modification would touch an OUT-of-scope path | Scope discipline is the whole point of PLAN.md |
| 5 consecutive turns on the same failing test | You're stuck. A fresh perspective will help |
| Decision needed at the architecture/security/dependency level | Not an autonomous decision. Hand off |
| Pre-merge reviewer-style issue surfaces (the kind in `docs/competitors/pre-merge-review-2026-04-25.md`) | Stop, fix it, re-run gates. Do not "document and move on" — that's the anti-pattern |

When you stop, the LAST thing you do is write `HANDOFF.md` (template: `docs/templates/overnight-HANDOFF.md`) and commit it. Then literally stop.

## Before declaring "done"

The Stop hook will fire automatically and block "done" until the gates pass. But you should run the gates yourself FIRST — don't let the hook be your only test:

1. `git status && git log --oneline $(git merge-base origin/main HEAD)..HEAD` — does the commit set match PLAN scope? No drift?
2. `git diff --name-only $(git merge-base origin/main HEAD)..HEAD` — any file in OUT-of-scope?
3. `ruff check $(git diff --name-only $(git merge-base origin/main HEAD)..HEAD | grep '\.py$')` — must pass
4. If any `mira-hub/*` changed: `cd mira-hub && npm run build` — must exit 0
5. If any `.sh` changed: `shellcheck -S warning <files>` — must pass
6. Offline eval suite (per `tests/eval/README.md`): `pytest tests/eval/ -q` — must not regress baseline
7. Write `HANDOFF.md` with: what was done (vs PLAN row-by-row), what was skipped and why, what's risky, decisions needed from operator, exact reproduce commands
8. Final commit (including HANDOFF.md), push to branch
9. Then — and only then — say "done"

If a gate fails, fix it. Do NOT use `MIRA_SKIP_STOP_GATE=1` to bypass — that override exists for diagnosing the gate itself, not for shipping broken work. Same for `MIRA_ALLOW_PROD=1` — that's for human-supervised deploys.

## Anti-patterns from the 2026-04-25 run — do not repeat

- "All gates green" claim without re-running them yourself.
- Merging a branch because it has many commits, not because it's mergeable.
- Documenting a known bug into KNOWN_ISSUES instead of fixing it. The reviewer caught 18 of these.
- Spawning subagents on overlapping write paths, producing worktree contamination.
- Letting a session balloon past 500 turns "to finish one more thing."
- Treating PLAN.md as a suggestion rather than a contract.
- Trusting `git status` over actually running the gates.

## When the operator gives you the work

The operator will hand off the actual task after pre-flight passes and you ack. From that moment, the only legitimate "extending" is:

- Clarifying questions BEFORE the operator leaves (use the AskUserQuestion tool — one batched question, not a stream).
- HANDOFF questions written into HANDOFF.md when you stop.

Everything else is execute-the-plan. If a question arises mid-session that needs an operator answer, the answer is: stop and write it into HANDOFF.

## Why this discipline matters

The hooks (`stop-gate.sh`, `prod-guard.sh`, `pre-commit`) are deterministic floors — they keep catastrophes from leaving your worktree. But they cannot tell you to stop at turn 200 instead of 600, cannot tell you a task isn't in PLAN, cannot write HANDOFF.md for the operator. Those are skill-of-operator things, and on autonomous runs the operator is asleep. This skill is what fills the gap.

Concretely: if every overnight run ended with a clean HANDOFF.md, on-scope diffs, and gates green — the operator can merge in 10 minutes instead of doing 18 reviewer-bug fixes across 14 branches. That's the difference between autonomous work being useful and autonomous work being a tax.
