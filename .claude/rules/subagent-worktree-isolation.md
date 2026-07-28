# Sub-agent Worktree Isolation

Any sub-agent dispatched for parallel work that will `Edit`/`Write` files MUST
operate in an isolated git worktree, or have explicit confirmation that there
is no uncommitted work in the shared checkout it could clobber. Verify
isolation **before** running any file/git commands — not after.

## Why

(Added 2026-07-06, from a Claude Code usage-insights report.) Two separate
incidents where a dispatched sub-agent mutated the shared checkout instead of
an isolated one, nearly destroying uncommitted work. The shared `~/MIRA`
checkout routinely carries in-flight WIP from other sessions (see
`project_concurrent_writers` — background sessions can revert edits or move
`HEAD` out from under you). A sub-agent that edits files in that same
checkout inherits that risk with none of the visibility a human has.

## Rule

1. **Default to `isolation: "worktree"`** on the `Agent` tool call for any
   dispatch that will write code — especially when running >1 agent in
   parallel. This is cheap insurance.
   ⚠️ **Do not read the auto-removal as "cleanup is handled."** The harness
   removes the worktree only when the agent made **no changes** — so it fires
   exactly for the dispatches that did nothing, and **never** for one that did
   work. A worktree exists in order to change things, so in practice every
   useful worktree survives until someone removes it. See § **Teardown**.
2. **Never assume a sub-agent "must" be isolated by default — verify it.**
   Don't reason "it's just a small edit" as an excuse to skip isolation.
   Check `git status -s` in the target checkout immediately before dispatch;
   if it shows uncommitted changes that aren't yours, isolation is mandatory,
   not optional.
3. **Read-only sub-agents (research, search, review) are exempt.** Isolation
   is for agents that call `Edit`/`Write`/`git commit` — a read-only agent
   cannot clobber anything.
4. **When isolation is skipped**, the dispatch prompt must say explicitly why
   (e.g. "confirmed clean tree, single agent, no parallel dispatch") — don't
   skip it silently.

## Teardown (added 2026-07-27 — the missing half of this rule)

Creating a worktree is an obligation to remove it. Until 2026-07-27 this rule
mandated creation and said nothing about teardown, which is the documented root
cause of 65 accumulated worktrees on CHARLIE
(`docs/tech-debt/2026-07-27-worktree-clutter-rca.md`).

5. **Whoever creates a worktree removes it** — in the same session, once the
   work is merged, abandoned, or pushed to a branch. `git worktree remove <path>`
   (add `--force` only if you accept discarding what's in it), then delete the
   branch if it's merged or dead. Pushing the branch first makes removal free:
   the commits live on `origin`, the checkout is disposable.
6. **Never leave a worktree holding `main`** (or any branch someone else will
   need). Git allows exactly **one** checkout per branch, with no TTL — a
   forgotten worktree holds that name hostage indefinitely. This is the
   highest-severity failure mode, not disk: on 2026-07-27 a worktree abandoned
   eight days earlier held `main` and blocked the shared checkout entirely.
   If you need `main`, use `--detach` at `origin/main` instead of checking out
   the branch.
7. **Scripts that create worktrees clean up on every exit path.** See
   § **Scripts** below.
8. **Before ending a long session, check your own leftovers:**
   `git worktree list` — remove the ones you created. Do **not** remove other
   sessions' worktrees on a guess: a dirty worktree may hold the only copy of
   someone's work, and `git branch --merged` is a weak signal in this repo
   because it squash-merges (an unmerged-looking branch may be landed, and a
   merged-looking one may be superseded rather than shipped).

## Scripts

Any script that runs `git worktree add` MUST do one of these two things. Both
are in the tree already; copy the one that fits.

**(a) Ephemeral — remove on every exit path, via `trap`.** Not just the happy
path: an error, a `set -e` abort, or Ctrl-C must also clean up. A `trap … EXIT`
is the only construct that covers all of them; a `remove` before each `exit` is
not sufficient.

```bash
WT="$(mktemp -d)/wt"
cleanup() { cd "$REPO" 2>/dev/null && git worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT
git worktree add --detach "$WT" origin/main
```

**(b) Deliberately left behind for a human — then use a FIXED path plus a
defensive pre-clean**, so repeated runs reuse one worktree instead of accreting
a new one each time, and so a leak from a previous run is repaired on the next.
`tools/orchestrator/refresh-graph.sh` is the reference for the pre-clean;
`run-merge-and-verify.command` is the reference for a deliberate leave-behind.

```bash
WT=".claude/worktrees/<stable-name>"        # fixed, not date/PID-stamped
git worktree remove --force "$WT" 2>/dev/null   # repair a previous leak
git worktree add --detach "$WT" origin/main
```

**Never** derive a worktree path from `$$`, a timestamp, or a run id unless
pattern (a) guarantees its removal — that is how one script becomes N worktrees.

## When this applies

- Any `Agent` tool call (or manual `git worktree add`) that dispatches a
  sub-agent expected to mutate files, especially when dispatching multiple
  agents in parallel against the same repo.

## When this does NOT apply

- Read-only sub-agents (`Explore`, research forks, review-only dispatches).
- A single foreground session doing its own edits (not a dispatched
  sub-agent) — ordinary `git status` hygiene before destructive git ops
  applies instead; see `.claude/rules/dangerous-commands-safety.md` and
  `.claude/rules/session-discipline.md` rule 3 (scoped commits).

## Cross-references

- Global `~/.claude/CLAUDE.md` § "Subagent Worktree Isolation" — the
  cluster-wide version of this rule (applies to every project, not just
  MIRA); this file is the MIRA-local pointer + rationale.
- `.claude/rules/session-discipline.md` — scoped commits, premise
  verification (the shared-checkout WIP problem this rule guards against).
- `project_concurrent_writers` (session memory) — the incident record for
  shared-checkout collisions.
- `docs/tech-debt/2026-07-27-worktree-clutter-rca.md` — why 65 worktrees
  accumulated, the branch-name-capture failure, and the fixes § **Teardown**
  and § **Scripts** implement.
- `.claude/rules/codegraph-usage.md` blind spot #5 — a nested worktree that
  isn't gitignored gets **indexed**, inflating `callers`/`impact`. Another
  reason not to leave one lying around inside the repo.
