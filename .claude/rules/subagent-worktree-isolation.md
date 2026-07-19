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
   parallel. This is cheap insurance; the worktree is auto-removed if the
   agent makes no changes.
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
