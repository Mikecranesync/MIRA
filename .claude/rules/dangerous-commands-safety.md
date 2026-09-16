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
4. **Doctrine for the judgment cases; a deterministic floor underneath.** A
   `PreToolUse` hook cannot verify "was the resolved path printed and confirmed
   first" — that requires the response text preceding the tool call, so *that*
   part is doctrine (self-audit + human review of the transcript, the same
   posture as `.claude/rules/train-before-deploy.md`). But the unambiguous
   *catastrophic* subset IS mechanically enforceable, and now is:
   **`tools/hooks/rm-guard.sh`** (a `PreToolUse(Bash)` hook) hard-blocks a
   recursive+force `rm` whose target *resolves* to the root filesystem (or a
   Windows drive root), your home directory, the repo root (or an ancestor), or
   any `.git` admin dir — after expanding variables (`rm -rf "$REPO"`),
   normalizing relative paths (`..`), following symlinks, and decoding the
   Git Bash/MSYS drive spelling (`/c/...`, `/cygdrive/c/...`) that `pwd` returns
   on Windows. A static `permissions.deny` glob can do none of that. Scope is
   deliberately narrow so legitimate scoped cleanup
   (`rm -rf .audit-worktrees/x`, `graphify-out/`, `node_modules`, `/tmp/...`)
   still passes. Override (human, per-shell): `MIRA_ALLOW_RM=1`.

   **The guard compares resolved targets, not spellings — and that is exactly
   where it has failed before.** Two spellings of one path that do not normalise
   together are a silent fail-open, on the one guard whose job is to fail
   closed: on Windows the containment test compared with a hardcoded `/` while
   `realpath` returned backslashes, and `os.path.realpath` read `/c/Users/...`
   as a literal `c` directory rather than the `C:` drive. Both allowed
   `rm -rf <repo root>` through. Linux CI was green throughout, because the
   implementation is correct there (#3827). Any future change to path handling
   needs a regression row per spelling **and** a safe control that must still
   pass — a normalization fix that starts denying legitimate cleanup has only
   traded one failure mode for another.

   **A guard approval is not proof that a destructive command is safe.** The
   hook is a floor, this rule is the ceiling: it cannot catch every judgment
   case, it can only deny what it recognises, and "it passed the hook" must
   never be read as "the target is correct". The
   print-the-resolved-path-first discipline above applies regardless of what
   the hook says.

## Relationship to existing guards

This rule is the general case; two narrower guards already exist and are
unaffected:

- **`tools/hooks/prod-guard.sh`** hard-blocks a specific class (prod-service
  mutations: container restart/compose, `nginx -s`, `systemctl`, direct
  writes to the VPS). It is a deterministic backstop for *production*
  specifically.
- **`tools/hooks/rm-guard.sh`** is the deterministic backstop for the
  *catastrophic local `rm -rf`* subset (root / home / repo-root / `.git`),
  resolving variables + symlinks + relative paths first (see rule 4). It
  complements — does not replace — this doctrine, which still covers the wider
  set of destructive local commands the hook can't safely pattern-match (a
  `git reset --hard` that discards uncommitted work, a `DROP TABLE`, an
  `rm -rf` on a *non*-catastrophic but still-wrong path).
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

- `tools/hooks/rm-guard.sh` + `tools/hooks/rm_guard.py` — the deterministic
  catastrophic-`rm -rf` floor (root / home / repo-root / `.git`), with
  variable/symlink/relative-path resolution; tests in `tests/test_rm_guard.py`
- `tools/hooks/prod-guard.sh` — the deterministic prod-mutation backstop
- `.claude/rules/subagent-worktree-isolation.md` — the parallel-dispatch
  analog (isolate instead of risking a shared checkout)
- `.claude/rules/session-discipline.md` — `git status -s` before commits,
  scoped commits
