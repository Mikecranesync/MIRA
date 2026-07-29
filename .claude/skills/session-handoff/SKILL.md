---
name: session-handoff
description: Use at the end of a working session, before handing off, or when asked "what's left / what's unmerged / did we push everything". Screens the repo for uncommitted work, stray worktrees, unpushed branches, stashes, and outstanding operator-only actions — and enforces the rule that foreign WIP is never swept into a commit.
---

# Session Handoff

The purpose of a handoff is not to make the tree look clean. It is to make the
**real state legible** — including the parts that are someone else's problem, and
the parts that only a human can finish.

A handoff that says "all done, everything pushed" while 46 branches carry
commits that exist nowhere but one laptop's disk is worse than no handoff: it
converts an inventory problem into a data-loss problem.

## The hard rule

**Never commit or push work you did not create.**

This repo routinely carries in-flight work from concurrent sessions and other
agents. `git add -A` / `git add .` over a shared checkout is how another
session's half-finished work gets committed under your name, or how a secret in
an unstaged file reaches the remote.

When asked to "commit and push everything", the correct response is:

1. Commit and push **your own** work.
2. **Report** everything else — precisely, with counts and paths.
3. Ask before touching foreign WIP.

If you cannot tell whether a change is yours, it is not yours.

## Run the screening

Run all of it. Report the numbers even when they are boring — a zero is a
finding.

### 1. Worktrees — dirty state, drift, unpushed commits

```bash
git fetch origin main --quiet
git worktree list --porcelain | grep '^worktree ' | sed 's/^worktree //' | while read -r wt; do
  b=$(git -C "$wt" branch --show-current 2>/dev/null); b=${b:-"(detached)"}
  d=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l)
  ab=$(git -C "$wt" rev-list --left-right --count origin/main...HEAD 2>/dev/null | tr '\t' '/')
  unp=""
  if [ "$b" != "(detached)" ]; then
    if git -C "$wt" rev-parse --verify "origin/$b" >/dev/null 2>&1; then
      n=$(git -C "$wt" rev-list --count "origin/$b..HEAD" 2>/dev/null)
      [ "$n" -gt 0 ] 2>/dev/null && unp="UNPUSHED:$n"
    else
      unp="NO-REMOTE"
    fi
  fi
  printf "%-46s %-42s dirty=%-4s behind/ahead=%-10s %s\n" "$(basename "$wt")" "$b" "$d" "$ab" "$unp"
done
```

`NO-REMOTE` is the one to escalate: those commits exist only on this disk.

### 2. Branches that exist nowhere else

```bash
tot=0; risk=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  tot=$((tot+1))
  if ! git rev-parse --verify "origin/$b" >/dev/null 2>&1; then
    n=$(git rev-list --count "origin/main..$b" 2>/dev/null)
    [ "$n" -gt 0 ] 2>/dev/null && { risk=$((risk+1)); echo "  LOCAL-ONLY: $b (+$n)"; }
  fi
done
echo "local branches: $tot | local-only carrying commits: $risk"
echo "unmerged vs main: $(git branch --no-merged origin/main | wc -l)"
```

### 3. Stashes

```bash
git stash list
```

Never `git stash drop` or `git stash clear` to tidy up, and never pop a stash
you did not create. Stashes are how other sessions park work.

### 4. Open PRs

```bash
gh pr list --state open --json number,title,headRefName,isDraft \
  --jq '.[] | "\(.number)\t\(.headRefName)\t\(.title)"'
```

Separate **yours** (report status: green/red, mergeable, awaiting approval) from
everyone else's (report the count only).

### 5. Your own footprint

```bash
git worktree list | grep -E '<your worktree paths>'
git ls-remote --heads origin '<your branch patterns>'
```

Every worktree you created is removed, every branch you created is merged or
explicitly parked with a reason. Use `git worktree remove <path>` — on Windows a
plain `rm -rf` fails on locked files and leaves a corrupt registration behind.

## What the handoff must state

Split the report in two, because they need different actions:

**Mine** — merge SHAs, resulting `/VERSION`, what was verified and how, what
was deliberately not done and why, worktrees/branches cleaned up.

**Not mine / pre-existing** — counts and paths only. Dirty checkouts, stashes,
local-only branches, other open PRs. Do not fix, do not commit, do not judge —
just make it visible so the human can triage.

Then, separately and unmissably:

**Blocked on a human** — anything an agent must not do:

- **Production mutations.** Restarting a service, applying a seed or migration
  to prod, redeploying a daemon that writes to a production database. Hand over
  the exact commands to run with `!`, do not run them. Check what a process
  actually connects to — a "dev box" running `doppler run --config prd` is
  writing to production.
- **Credential exposure.** If a secret appeared in output this session — in a
  plist, an env dump, a log — say so plainly, name the file, and recommend
  rotation. Do not reproduce the value in the handoff.
- **Approvals** you were told to wait for.

## What "done" does not mean

State the gap between merged and working. Merging does not deploy; a fix that
requires an operator step is **not live**, and a handoff that implies otherwise
is wrong. Likewise a declaration is not an action — adding a URL to a config
means a job will fetch it later, not that it has been fetched.

## Anti-patterns

- ❌ `git add -A` in a shared checkout "to be thorough".
- ❌ Reporting "everything is pushed" without checking for `NO-REMOTE` branches.
- ❌ Cleaning up other sessions' worktrees or stashes to make the list shorter.
- ❌ Listing what shipped without listing what is still blocked on a human.
- ❌ Saying "verified" for something that was assumed. If a check was
  simulated, sampled, or skipped, say which.
- ❌ Quietly dropping an item you could not finish. Name it and say why.

## Cross-references

- `.claude/rules/session-discipline.md` — scoped commits; never sweep foreign WIP
- `.claude/rules/subagent-worktree-isolation.md` — why parallel work gets its own worktree
- `.claude/rules/dangerous-commands-safety.md` — print the resolved path before anything destructive
- `docs/environments.md` — what may never be mutated from a session
- `.planning/STATE.md` — the durable checkpoint a long task writes as it goes
