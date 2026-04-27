# Overnight Runs — Playbook

> Source of truth for unattended Claude sessions. Born out of the 2026-04-25
> overnight run that produced 14 parity-sprint branches with 18 reviewer bugs
> (see `docs/competitors/pre-merge-review-2026-04-25.md`).

## Why overnight sessions degrade

1. **Context fills up.** Past ~200 turns, perf falls off; earlier
   instructions and architectural decisions start getting forgotten.
2. **Compounding errors.** Without a human checkpoint, a 90%-right decision
   at turn 300 becomes a structurally wrong foundation by turn 600.
3. **Scope creep.** Sessions tend to expand beyond what was asked. Nobody
   to say "that's not what I asked for."
4. **No deterministic gates.** Without a Stop hook that fails the build,
   sessions ship half-working code and move on.

## Hard rules (enforced by hooks, not by trust)

- **Stop hook** (`tools/hooks/stop-gate.sh`) — Claude cannot say "done"
  if `ruff check` on changed Python fails, `shellcheck -S warning` on
  changed shell scripts fails, or `mira-hub && npm run build` fails on a
  hub-touching change. Override `MIRA_SKIP_STOP_GATE=1` only for diagnostics.
- **Prod guard** (`tools/hooks/prod-guard.sh`) — Bash commands that
  match SSH-to-prod, `docker (restart|stop|down|kill)` on a known prod
  service, `nginx -s reload`, `systemctl restart mira-…`, or `kubectl
  apply|delete|rollout` are denied. Operator override: `MIRA_ALLOW_PROD=1`.
- **Pre-commit** (`.githooks/pre-commit`) — shellcheck + gitleaks +
  debug-artifact scan on staged files. Already wired (`git config
  core.hooksPath .githooks`).
- **CI on PR** (`.github/workflows/code-review.yml`) — shellcheck,
  ast-grep rules, cascade LLM review. Self-fix loop available via
  `bash scripts/pr_self_fix.sh <PR>` (max 3 iterations).

## Soft rules (operator discipline)

| Rule | Why |
|------|-----|
| Cap unattended work at ~200 turns | Past that, context degradation dominates. Break into 50–100 turn sessions with handoffs. |
| Worktree isolation, never main | Bad work gets thrown away cheaply. Worktrees live under `.claude/worktrees/<name>`. |
| Write a `PLAN.md` before sleeping | Forces explicit scope. Template: `docs/templates/overnight-PLAN.md`. |
| Write a `HANDOFF.md` before stopping | First thing operator reads in the morning. Template: `docs/templates/overnight-HANDOFF.md`. |
| Commit every 20–30 turns | Bisectable. Lets CI pipeline catch problems early. |
| Compact at 70% context, restart at 85% | Don't let auto-compaction at 95% lose load-bearing context. |

## Pre-sleep checklist (operator)

- [ ] PLAN.md is on the branch — numbered scope, OUT-of-scope listed, success criteria per item.
- [ ] Branch is in an isolated worktree, NOT main/develop/dev.
- [ ] `.claude/settings.json` has the Stop and prod-guard hooks active (default in this repo).
- [ ] No environment variable override is set (`echo $MIRA_ALLOW_PROD $MIRA_SKIP_STOP_GATE` should be empty).
- [ ] Token budget is set if your runner supports it.
- [ ] You know which branch and which review pipeline PR you'll be checking in the morning.

## Morning-review ritual (operator)

- [ ] Read `HANDOFF.md` top to bottom before opening any code.
- [ ] `git log --oneline main..HEAD` — commit count match the plan?
- [ ] `git diff main...HEAD --stat` — any out-of-scope files touched?
- [ ] Run the success-criteria commands listed in HANDOFF — do they pass *for you*?
- [ ] Skim PR review-pipeline comments. 🔴 IMPORTANT comments must be fixed before merge.
- [ ] Only then: cherry-pick / merge / discard.

## Anti-patterns from the 2026-04-25 run (do not repeat)

- Spawning subagents on overlapping write paths (causes worktree contamination).
- Treating an LLM "all gates green" claim as truth without running gates yourself.
- Merging a branch because it has many commits, not because it's mergeable.
- Letting a single session balloon past 500 turns "to finish one more thing."
- Documenting a known bug into KNOWN_ISSUES instead of fixing it.

See also: `subagent_dispatch_rules`, `mira_definition_of_done`, `mira_security_checklist`
in operator memory.
