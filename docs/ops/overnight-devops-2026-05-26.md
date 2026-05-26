# Overnight DevOps — 2026-05-26 → 2026-05-27

> **Self-contained prompt for an autonomous overnight Claude Code session.**
> Generated 2026-05-26 ~17:15 PT on CHARLIE. Mike is asleep.
> This file is the ENTIRE task list. Do not invent extra work.

---

## STEP 0 — Bootstrap (do this first, every session)

```bash
# 1. Read the doctrine
cat wiki/hot.md            # session state
cat CLAUDE.md              # build state + repo map
cat .claude/CLAUDE.md      # product rules
cat docs/environments.md   # env separation rules
cat docs/known-issues.md   # current known issues

# 2. Sync with origin
git fetch origin --prune
git log main..origin/main --oneline | head -20   # "behind by N" check
```

If `main` is behind origin/main, **rebase before doing anything**:
```bash
git checkout main && git pull --ff-only origin main
```

---

## SAFETY RAILS — read twice, never bypass

The `prod-guard.sh` `PreToolUse(Bash)` hook will block dangerous commands. These rails are stricter than the hook — follow both.

### DO NOT
- ❌ **Deploy to production.** `deploy-vps.yml` is off-limits tonight. No `gh workflow run deploy-vps.yml`.
- ❌ **Run any migration against prod NeonDB.** Not even `dry-run` — leave it for Mike to gate.
- ❌ **Restart, rebuild, or compose anything on the VPS** (165.245.138.91). No SSH-to-prod actions.
- ❌ **Run `psql` / raw SQL against prod NeonDB.** Use staging or `db-inspect.yml` only — and only if a task explicitly needs it.
- ❌ **Point any build at `@FactoryLM_Diagnose`** (the prod Telegram bot).
- ❌ **Modify `mira-bots/shared/engine.py`** — single chokepoint, in-flight conversational-engine work on PR #1563. Hands off tonight.
- ❌ **Merge PR #1563** — staging-gate is failing; needs Mike's review.
- ❌ **Reintroduce Anthropic** as a provider. Cascade is Groq → Cerebras → Gemini (per CLAUDE.md PRD §4).
- ❌ **Force-push, `git reset --hard origin/...`, or delete remote branches** without explicit task authorization below.
- ❌ **Auto-promote `proposed → verified`** in `kg_relationships`. No KG state changes overnight.
- ❌ **Touch `tools/lead-hunter/.hourly_state.json` or `marketing/prospects/*.jsonl`** — these are mutated by routines, not by humans.

### DO
- ✅ Work on `chore/overnight-ops-2026-05-26` (cut from origin/main below).
- ✅ Commit early, commit often. Conventional Commits (`chore:`, `fix:`, `docs:`).
- ✅ For each task, **leave evidence**: a commit, a closed issue, a comment, or a screenshot. "I think it's done" is not done.
- ✅ Run `ruff check --fix` + `ruff format` on any Python you touch.
- ✅ If a task is genuinely blocked, write the blocker into the completion checklist at the bottom and move on. Do not stall.
- ✅ Time-box: if any single task exceeds **45 min**, mark it deferred and move on.

### Working branch setup

```bash
git fetch origin --prune
git checkout -b chore/overnight-ops-2026-05-26 origin/main
```

---

## TASK 1 — Merge PR #1567 (known-issues audit) ⭐ green and ready

**Why:** Mike's documentation audit shipped 2026-05-26 14:40Z; only check is `staging-gate` and it's GREEN. Lowest-risk merge of the night.

**Steps:**
```bash
gh pr view 1567 --json mergeable,statusCheckRollup -q '.mergeable + " | " + (.statusCheckRollup[0].conclusion)'
# Expect: "MERGEABLE | SUCCESS"

gh pr merge 1567 --squash --delete-branch
```

**Success criteria:** PR #1567 shows `state: MERGED`; branch `chore/known-issues-audit-2026-05-26` is gone from `gh pr list`.

**If it's no longer green** (rare — main may have moved): post a comment on the PR explaining and skip.

---

## TASK 2 — Triage 12 open Dependabot PRs

**Why:** Mike already batched most on 2026-05-25 (#1532–#1548). Four remain open with **major-version bumps** Mike held back (issue #1565 tracks). The newest four (#1547, #1546, #1540, #1536) are dupes of already-merged PRs from the same Dependabot dirs.

**Steps:**

```bash
gh pr list --state open --search "is:open author:app/dependabot" --limit 20 \
  --json number,title,createdAt -q '.[] | "\(.number)\t\(.title)"'
```

For each Dependabot PR:

1. Check if a newer PR from the **same dependency + dir** has already been merged:
   ```bash
   gh pr list --state merged --search "<package-name> in /<dir>" --limit 3
   ```
2. If yes (dupe / superseded) → close with comment `"superseded by #<merged-pr>"`.
3. If no, and it's a **patch / minor bump**:
   - Trigger CI: `gh pr comment <num> --body "@dependabot recreate"` (only if checks have not run)
   - If all checks pass and no engine/auth/db file changed → merge `--squash --delete-branch`.
4. If it's a **major bump** → add it to issue #1565's checklist via a comment, leave PR open.

**Hard limits for this task:**
- Do NOT merge any PR that touches `mira-bots/shared/engine.py`, `mira-bots/shared/inference/`, or any migration file.
- Do NOT merge `starlette` 0.52 → 1.1 (#1540) — major breaking, must go through issue #1565.
- Cap: merge at most **3** Dependabot PRs tonight. Anything past 3 = note + defer.

**Success criteria:** open Dependabot PR count drops; any closed dupes have a comment linking the superseding PR; #1565 has an updated checklist comment.

---

## TASK 3 — Clean up stale local branches (issue #1566)

**Why:** CHARLIE has 99 local branches. Issue #1566 explicitly asks for triage of feat/fix/data branches with commits ahead of main.

**Steps:**

```bash
# Branches fully merged into origin/main — safe to delete locally
git fetch origin --prune
git branch --merged origin/main | grep -vE '^\*|^ +main$' > /tmp/branches-merged.txt
wc -l /tmp/branches-merged.txt
cat /tmp/branches-merged.txt
```

For branches in that file:
1. Delete locally only — **never** `git push --delete origin/<branch>`:
   ```bash
   xargs -n1 git branch -d < /tmp/branches-merged.txt
   ```
2. Skip any that fail (`-d` refuses unsafe deletes; that's by design — leave them).

For `claude/<adjective-name>-<hash>` branches older than 7 days that are **not** behind an open PR:
```bash
gh pr list --state open --json headRefName -q '.[].headRefName' > /tmp/open-pr-branches.txt
# Then for each claude/* branch: check if it's in /tmp/open-pr-branches.txt; if not + last commit > 7d ago + not merged: list it
git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:short)' refs/heads/claude/
```

**Do not delete `claude/*` branches** if any of:
- It appears in `/tmp/open-pr-branches.txt`.
- Its tip commit is unmerged AND younger than 7 days.

For ones that pass all checks → `git branch -D <name>` locally only.

**Cap:** delete at most **25** branches tonight. Stop and write the count to the checklist.

**Success criteria:** local branch count reduced; report the before/after count in the completion checklist; no remote branches deleted.

---

## TASK 4 — Worktree cleanup (`~/MIRA/.claude/worktrees/`)

**Why:** 5 worktrees present (`determined-maxwell-d05243`, `friendly-cannon-ce934d`, `stupefied-noyce`, `tech-debt-hub-ux-batch-2-2026-04-26`, `tools`). Several look like old throwaway agent worktrees. The `tools` one looks like infrastructure — **do not touch `tools`**.

**Steps:**

```bash
cd ~/MIRA
git worktree list
```

For each worktree (except `tools`):
1. `cd` into it, check `git status` + `git log -1 --format='%ai %s'`.
2. If clean + last commit > 14 days ago + branch is merged or abandoned → `git worktree remove --force <path>`.
3. If dirty → leave alone, note in checklist.

**Hard rule:** never remove the `tools` worktree. Never remove a worktree with uncommitted changes.

**Success criteria:** worktree count reduced; report before/after count in checklist.

---

## TASK 5 — Close issue #1564 (anthropic purge from stale requirements)

**Why:** Three `requirements*.txt` files still reference `anthropic`. Policy says no Anthropic. This is a documented tech-debt issue with a clear scope.

**Steps:**

```bash
# Find them
rg -l '^anthropic([=<>!~]|\s*$)' --glob '*requirements*.txt' --glob '*.in'
```

For each file:
1. Read it. Confirm `anthropic` is not actually imported anywhere from that module (use `codegraph_search` for `anthropic` symbol references in the corresponding source dir).
2. Remove the `anthropic==X.Y.Z` line.
3. If a `pyproject.toml` or `requirements.in` lives next to it, edit that file too.

Then:
```bash
ruff check --fix .  # safety check (shouldn't flag anything for txt edits)
git add -p          # review every hunk
git commit -m "chore(deps): purge anthropic from 3 stale requirements files (closes #1564)"
git push -u origin chore/overnight-ops-2026-05-26
gh pr create --title "chore(deps): purge anthropic from stale requirements (closes #1564)" \
             --body "Removes lingering \`anthropic\` deps from N requirements files. Policy compliance — see PR #610 + CLAUDE.md PRD §4. Closes #1564." \
             --base main
```

**Success criteria:** PR opened, CI green, all `anthropic` references gone from `requirements*.txt`. Do NOT merge yourself — let Mike review in the morning.

**If you find Anthropic actually IS imported somewhere:** STOP, do not remove the dep, comment on #1564 with the import location + filepath.

---

## TASK 6 — Investigate flaky `Namespace inline-create E2E (post-deploy)` workflow

**Why:** Failed 4× on `main` today (runs 26452206123, 26452238106, 26452311834, 26452312102, 26456140315). All workflow_run-triggered. This is a post-deploy regression signal we can't ignore.

**Steps:**

```bash
gh run view 26456140315 --log 2>&1 | tail -100
```

Look for: container start failures, NeonDB tenant-uuid validation errors (issue #1474 / #1442 are related), assertion mismatches, or a stale fixture.

**Do NOT fix it tonight** — engine/Hub changes are out of scope. Instead:
1. Write a 6-line summary of the root cause (or "unable to determine — needs prod logs") into a new issue.
2. File the issue:
   ```bash
   gh issue create --title "Flaky: Namespace inline-create E2E (post-deploy) — 5 failures on main 2026-05-26" \
                   --body "<your summary>\n\nRuns: 26452206123, 26452238106, 26452311834, 26452312102, 26456140315\n\nObserved: ...\nLikely cause: ...\nNot fixed overnight per scope." \
                   --label bug
   ```

**Success criteria:** issue filed with run links + suspected cause.

---

## TASK 7 — Regenerate the stalled eval scorecard

**Why:** `wiki/hot.md` reports the offline scorecard hasn't changed since 2026-05-06 (20 days stale). Every eval-fixer routine is now dup-closing — wiring problem, not code problem.

**Steps:**

```bash
# Run offline (no prod LLMs needed — uses fixtures + cached scoring)
doppler run --project factorylm --config dev -- python3 tests/eval/offline_run.py --suite text 2>&1 | tail -60
```

This must use `factorylm/dev`, **never `prd`**.

If the run produces a new scorecard file under `tests/eval/runs/`:
```bash
git add tests/eval/runs/<new-file>
git commit -m "chore(eval): regenerate offline scorecard $(date +%F)"
```

Then update `wiki/hot.md` with a fresh `## eval-fixer run — 2026-05-26` block reporting the new pass rate.

**If it errors out:** capture the first 30 lines of error output, paste them into a new issue titled `eval: offline_run.py broken — 2026-05-26`, link #1419, and move on.

**Success criteria:** either a new scorecard file is committed, or an issue is filed explaining why not.

---

## TASK 8 — Update `wiki/hot.md` and `docs/known-issues.md`

**Why:** Session-end discipline. Future sessions read these first.

**Steps:**

Append a new section to the **top** of `wiki/hot.md`:

```markdown
## Session — 2026-05-26 (overnight ops)

- Merged: <list PR numbers actually merged>
- Closed: <list issues actually closed>
- Filed: <list new issues filed>
- Branches deleted locally: N (was M, now M-N)
- Worktrees removed: N (was 5, now 5-N)
- Deferred / blocked: <bullet list>
- Open follow-ups for Mike: <bullet list, max 5 items>
```

Then check `docs/known-issues.md` — if you closed any issue that was listed there, update or remove the row.

Commit:
```bash
git add wiki/hot.md docs/known-issues.md
git commit -m "docs(wiki): overnight ops session 2026-05-26 — handoff"
git push
```

**Success criteria:** `wiki/hot.md` has a 2026-05-26 overnight section; `docs/known-issues.md` matches reality.

---

## COMPLETION CHECKLIST — fill before exiting

Copy this block, fill it in, and paste it as the final message:

```
=== OVERNIGHT OPS 2026-05-26 — COMPLETION REPORT ===

Branch: chore/overnight-ops-2026-05-26 (pushed: yes/no)

Task 1 (merge PR #1567):           [DONE | SKIPPED — reason] — evidence: <commit/PR>
Task 2 (dependabot triage):        [DONE — merged N, closed M] — list: <PR #s>
Task 3 (stale branches):           [DONE — deleted N local] — before: 99, after: <X>
Task 4 (worktrees):                [DONE — removed N]        — before: 5, after: <X>
Task 5 (anthropic purge #1564):    [PR opened: #<num>]       — evidence: <PR link>
Task 6 (flaky E2E investigation):  [issue filed: #<num>]     — link
Task 7 (eval scorecard):           [committed: <file> | failed: issue #<num>]
Task 8 (wiki/known-issues):        [DONE]                    — commit: <hash>

Open follow-ups for Mike (max 5):
- ...

Hard stops hit (if any):
- ...

Time elapsed: <Xh Ym>
```

Then push everything:
```bash
git push -u origin chore/overnight-ops-2026-05-26
```

Do NOT merge the overnight branch yourself. Mike reviews in the morning.

---

## REFERENCE — read-only commands you may use freely

- `gh pr list`, `gh pr view`, `gh pr checks`, `gh pr comment`, `gh pr merge` (only where Task 1/2 says so)
- `gh issue list`, `gh issue view`, `gh issue create`, `gh issue close`
- `gh run list`, `gh run view`
- `git fetch`, `git log`, `git status`, `git diff`, `git branch -d` (local only)
- `codegraph_*` MCP tools (read-only by design)
- `rg`, `ls`, `cat`, `wc`
- `ruff check`, `ruff format`
- `doppler run --project factorylm --config dev -- <cmd>` (NEVER `--config prd`)

## REFERENCE — commands that are PROHIBITED tonight

- `gh workflow run deploy-vps.yml`
- `gh workflow run apply-migrations.yml` (even dry-run)
- `docker compose` on the VPS / SSH to 165.245.138.91
- `psql` against any prod connection string
- `git push --force`, `git push --delete origin/<branch>`
- Any edit to `mira-bots/shared/engine.py`
- Any edit to files under `mira-bots/shared/inference/`
- `doppler run --project factorylm --config prd -- <anything>`

If you find yourself reaching for one of these — stop, write it in the deferred section of the checklist, and move on.
