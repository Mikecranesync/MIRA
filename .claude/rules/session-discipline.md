# Session Discipline

Behavior rules distilled from the 2026-06-08 `/insights` report (65 sessions).
They target the friction patterns that cost the most time: building on wrong
premises, reporting gains from partial test runs, bundling foreign WIP into
commits, unsafe migrations/seeds, and losing work to context exhaustion.

These complement `karpathy-principles.md` (think/simplify/surgical/goal-driven)
and `debugging-conventions.md` (verify schema + API paths before guessing).
They govern *behavior*, not syntax.

---

## 1. Premise verification

Before implementing, verify **every stated premise** against the actual
codebase + `git log` — don't take the request's framing on faith.

- **File paths, table/column names, function/symbol names** — confirm they
  exist (CodeGraph / `Grep` / `Read`) before building on them. The task that
  says "edit `foo.py`'s `bar()`" is wrong often enough to check first.
- **Bug status** — "X is broken" may already be fixed on `main`. Check `git
  log` / the file before re-fixing. (See `feedback_lost_session_commit_check`:
  trust git over a claim that work was lost.)
- **Branch / environment** — confirm you're on the branch and env the task
  assumes. A "stale feature branch, N behind main" is a common trap.
- **Numbers in the plan** (line counts, row counts, "<150 lines", "29/47
  done") drift. Re-measure before relying on one.

**Surface every mismatch before building** — don't silently "fix" the premise
or silently proceed on the wrong one. One clarifying line now beats a reverted
PR later.

## 2. Regression recheck

After any change intended to **raise** an eval/test pass rate or fix a
regression:

- **Re-run the *full* affected suite** and compare to the baseline you captured
  *before* the change. Never report "+N" from a partial / single-fixture run.
- **Distinguish pre-existing `main` failures from branch-introduced
  regressions.** A red test you didn't cause is not your "+1 to fix"; a green
  test you turned red is a regression you must own. Check against `origin/main`
  HEAD when in doubt.
- **Net, not gross.** "9 fixtures newly pass" means nothing if 6 newly fail.
  Report the net and the regressions explicitly.

Evidence beats assertion (Karpathy #4, Cluster Law 1): show the before/after
numbers, not "should be better now".

## 3. Scoped commits

Stage only the files **your change touched**.

- **Never `git add -A` / `git add .`** when untracked or foreign WIP exists in
  the tree. Name the paths explicitly (`git add path/a path/b`).
- Known noise in this repo to never sweep in: `tools/__init__.py`,
  `ANTIGRAVITY_*.md`, stray `tools/yt-pipeline/` worktree artifacts, scratch
  logs. If you didn't create it and your change doesn't need it, leave it.
- **Never touch a stash you didn't create**, and never `git stash drop`/`clear`
  to "clean up" — that's how other sessions' work disappears.
- One atomic commit per logical change; conventional-commit message.

`git status -s` before every commit; if the staged set includes a file you
can't trace to the request, unstage it.

## 4. Migration / seed safety

Before applying a migration or seed (see `docs/environments.md`,
`.claude/CLAUDE.md` § "Environment boundaries"):

- **Confirm prerequisite migrations exist in the *target* env.** A migration
  that `ALTER`s a table created by an earlier migration fails if that earlier
  one never ran in this env. (Hub `ON CONFLICT` orphaned by migs 025/026 —
  #1792 — is the canonical bite.)
- **Validate schema constraints against the *live* schema, not your memory:**
  UUID vs TEXT key types, enum / CHECK membership (lowercase vs canonical
  relation-type values), and `ON CONFLICT` targets must match a real unique
  constraint.
- **dev → staging → prod, in that order**, via `apply-migrations.yml`
  (`dry-run` then `apply`). Never hand-edit prod schema; never seed prod first
  (retrieval is proven on staging-shape data — #1385).

## 5. Long-task checkpoint discipline  (P4)

For any task likely to exceed the context window — long evals, multi-file
builds, codebase maps, multi-phase plans:

- **Write a handoff to `.planning/STATE.md` early and after each phase**, not
  at the end. Capture: what's done (with evidence), what's next, what's
  blocked, and any manual steps owed to the operator. Context exhaustion must
  never lose ground — the working-tree STATE.md is the recovery point.
- **Make the deliverable durable before long-running calls.** Commit the
  finished slice before kicking off a 35-minute eval or an advisor round; a
  durable result survives a dropped session, an unwritten one doesn't.
- **Run 30-min+ evals and builds as background jobs** (`run_in_background`),
  not blocking interactive calls — blocking burns context you'll want for the
  next phase. Poll/collect when they signal completion.
- Prefer many small verified commits over one large unverified one. Each commit
  is a checkpoint you can resume from.

---

## When this applies

- Every non-trivial task in this repo. Rules 1–3 are near-universal; rule 4
  fires on any DB/migration/seed work; rule 5 fires on long/multi-phase work.

## When this does NOT apply

- Trivial one-line / typo fixes (Karpathy tradeoff note: don't ceremoniously
  apply all five to a typo).
- Pure read-only investigation that produces no commit.

## Cross-references

- `.claude/rules/karpathy-principles.md` — think / simplify / surgical / goal-driven
- `.claude/rules/debugging-conventions.md` — verify schema + API paths; multi-cause perf
- `docs/environments.md` — dev / staging / prod promotion + migration discipline
- `.planning/STATE.md` — the checkpoint file rule 5 writes to
