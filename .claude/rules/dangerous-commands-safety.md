# Dangerous Commands Safety

Before running any command that **irreversibly discards data or history** —
`rm -rf`, `git reset --hard`, `git clean -f`/`-fd`, `git checkout -- .`,
`git restore .`, dropping a database/table, or force-overwriting a file —
print the exact **resolved absolute path** (or target) first, and confirm it
matches the intended target, before executing.

## Rule

1. **Resolve before you run.** Don't execute a destructive command against a
   relative or ambiguous path. Run `pwd` / `realpath <path>` (or the
   equivalent for the resource in question — e.g. the full DB connection
   string's host, not just "prod") and state the resolved target in the same
   turn, before the destructive command.
2. **State the target explicitly, then act.** "This will delete
   `/Users/charlienode/MIRA/.worktrees/stale-branch` (not the main checkout)"
   — said out loud, in the response — before the `rm -rf` runs. Silent
   execution of a destructive command is the failure mode this rule exists
   to prevent.
3. **When in doubt about scope, narrow the command or ask.** A destructive
   command that could plausibly hit more than the intended target (a glob, a
   missing trailing slash, a `..` in the path) gets rewritten to be
   unambiguous, or the user is asked to confirm, before it runs.
4. **This is doctrine, not a hook.** A `PreToolUse` hook can pattern-match
   the command text but cannot verify "was the resolved path printed and
   confirmed first" — that requires the response text preceding the tool
   call. Enforcement is self-audit + human review of the transcript, the
   same posture as `.claude/rules/train-before-deploy.md`.

## Relationship to existing guards

This rule is the general case; two narrower guards already exist and are
unaffected:

- **`tools/hooks/prod-guard.sh`** hard-blocks a specific class (prod-service
  mutations: container restart/compose, `nginx -s`, `systemctl`, direct
  writes to the VPS). It is a deterministic backstop for *production*
  specifically — this rule covers the wider set of destructive **local**
  commands prod-guard doesn't pattern-match (an errant `rm -rf` in the local
  checkout, a `git reset --hard` that discards uncommitted work).
- **The Git Safety Protocol** in the system prompt already requires
  `git status` before any command that could discard uncommitted work
  (`git checkout`/`restore`/`reset`/`clean` in a git repo) — this rule
  extends the same discipline to non-git destructive commands (`rm -rf`
  outside a repo, dropping a table) and adds the explicit
  "print-the-resolved-path-first" step.

## When this applies

- Any `rm -rf`, `git reset --hard`, `git clean -f[d]`,
  `git checkout -- .`/`git restore .`, `DROP TABLE`/`DROP DATABASE`, or
  force-overwrite of a file that cannot be recovered from `git`.

## When this does NOT apply

- Reversible operations (a plain `git checkout <branch>`, a soft `git reset`,
  deleting a file that's tracked and recoverable via `git checkout -- <file>`).
- Deleting scratch files you created yourself this session in a scratchpad
  directory — see the top-level "Executing actions with care" guidance.

## Cross-references

- `tools/hooks/prod-guard.sh` — the deterministic prod-mutation backstop
- `.claude/rules/subagent-worktree-isolation.md` — the parallel-dispatch
  analog (isolate instead of risking a shared checkout)
- `.claude/rules/session-discipline.md` — `git status -s` before commits,
  scoped commits
