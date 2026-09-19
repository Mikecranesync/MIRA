# Shared Root Files Have an Owner

`PLAN.md` and `HANDOFF.md` at the repo root are **tracked, committed files**, not
per-session scratch. They belong to whichever run wrote them last. Writing one
without checking replaces another run's work — and merging that branch **deletes
theirs from `main`**.

This is the same shared-line problem the repo killed `/VERSION` over (#3064): one
filename, many concurrent writers, every write a conflict or a clobber.

## The rule

**Before writing a shared root file, establish who owns it.**

1. **Is it tracked?** `git ls-files --error-unmatch PLAN.md`. An untracked file is
   nobody's — write freely.
2. **Does this branch own it?** `git log origin/main..HEAD -1 -- PLAN.md`. A commit
   on your branch that already touched it means you are continuing your own work.
3. **Otherwise it is someone else's.** Write a **branch-scoped** name instead:
   `PLAN.<slice>.md`, `HANDOFF.<slice>.md`, and say why in the file's header.

The branch-scoped name satisfies everything the original instruction wanted: the
scope contract is still discoverable at the branch root, `test -f PLAN.md` still
passes (the tracked one exists), and nothing foreign is destroyed.

## The guarded names

`PLAN.md`, `HANDOFF.md`, `STATE.md`, `NOTES.md`, `TODO.md`, `RESUME.md`,
`SESSION.md` — **at the repo root only**. The same basename in a subdirectory
(`docs/plans/PLAN.md`) is a document, not a shared line, and is untouched.

## Why this exists

The `autonomous-run` skill's pre-flight said *"PLAN.md exists at branch root"* and
its closeout said *"write HANDOFF.md"*. Read literally — which is how an
unattended run reads everything — that instructs every overnight run to overwrite
the previous run's plan and handoff.

On 2026-09-15 (PR #3815) it happened **twice in one run**. Nothing was lost, but
only because the Write tool said "updated" rather than "created" and the agent
happened to look. **"Notice the tool output" is not a control.** Both root files
belonged to the #3760 baseline-defect run (`9e389cea7`) and would have been
deleted from `main` on merge.

The skill's wording has since been fixed to prescribe the branch-scoped name, and
the deterministic floor below catches the case where an agent follows an older
copy of the instruction anyway.

## The deterministic floor

`tools/hooks/shared-root-file-guard.sh` (a `PreToolUse(Write|Edit)` hook) denies a
write to a repo-root shared filename when the file is **tracked** and the current
branch has **never touched it**, naming the branch-scoped alternative in the
denial. Analysis lives in `tools/hooks/shared_root_file_guard.py` so it is
unit-tested (`tests/test_shared_root_file_guard.py`).

It deliberately **fails open** where it cannot know — no git repo, no
`origin/main` to compare against, an untracked file, a subdirectory copy. A guard
that blocked when it could not tell would wedge every repo without a remote,
which is a worse failure than the one it prevents.

Override, human, per-shell: `MIRA_ALLOW_SHARED_ROOT=1`. Use it when you genuinely
own the file and the guard cannot see that (a fresh branch legitimately taking
over the shared plan). Reaching for the override routinely means the answer was a
branch-scoped name.

## What a reviewer must catch

- ❌ A PR that modifies root `PLAN.md` / `HANDOFF.md` without being the run that
  owns them — check `git log origin/main..HEAD -- <file>`.
- ❌ A PR that **deletes** either file as a side effect of writing its own.
- ❌ A new skill, command, or runbook instructing an agent to "write `PLAN.md`"
  or "write `HANDOFF.md`" at the root without the ownership check.
- ❌ A new shared root filename introduced without adding it to BOTH
  `SHARED_ROOT_FILENAMES` and the wrapper's cheap-reject `case` — a name in only
  one is a guard that never runs.

## When this applies

- Any autonomous/overnight run, any session that writes a plan or handoff, any
  skill or command that names a root-level file.

## When this does NOT apply

- Files in subdirectories, untracked scratch, and the scratchpad directory.
- A branch that already owns the file and is continuing its own work.

## Cross-references

- `tools/hooks/shared-root-file-guard.sh` + `tools/hooks/shared_root_file_guard.py`
  — the floor; tests in `tests/test_shared_root_file_guard.py`
- `.claude/skills/autonomous-run/SKILL.md` — the instruction that caused this,
  now prescribing the branch-scoped name
- `.claude/rules/session-discipline.md` §3 — scoped commits / never sweep foreign WIP
- `.claude/rules/multi-session-protocol.md` §3 — never modify another session's work
- `.claude/rules/dangerous-commands-safety.md` — the same
  print-and-confirm-before-destroying discipline, for commands
