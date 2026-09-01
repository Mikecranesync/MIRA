# Post-Pixel merge train — PREPARED, NOT STARTED

Nothing below has been executed. Do not start until the Pixel baseline passes.

## Rollback anchor — capture before anything moves

```
KNOWN-GOOD main : 5307e922d8b8e68cd372652f082e91db47851303
short           : 5307e922d
title           : fix(hub): restore a failed message to the composer (CMPS-2, FLEET-012) (#3530)
last good deploy: success @ 5307e922d  2026-09-01T08:49:18Z
```

**Every merge to `main` auto-deploys nine production services** (push → Smoke
Test → `deploy-vps.yml`, `services` blank → `mira-pipeline mira-ingest mira-mcp
mira-hub mira-web mira-cmms-sync mira-bot-telegram mira-bot-slack mira-ask`).
There is no per-service merge. Budget one full prod deploy per step.

### Rollback

Reverting is preferred over force-pushing `main` — history stays honest and the
revert itself redeploys.

```bash
# 1. identify what landed
git log --oneline 5307e922d..origin/main

# 2. revert a single merge (repeat per step, newest first)
git checkout -b revert/<pr> origin/main
git revert -m 1 <merge-sha>
git push -u origin revert/<pr>
# open PR, let CI run, merge → this redeploys

# 3. verify you are back
git fetch origin && git log --oneline origin/main -1
```

**Do not** `git push --force` to `main`, and **do not** use `--admin`.

---

## The train

Each step: merge → wait for CI → wait for deploy → smoke → verify → only then next.

### Gate 0 — Pixel baseline PASS
`docs/testing/PIXEL-RUN.md` steps 0–2 pass (a normal answer works on device).
**If step 2 fails, the train does not start.**

### Step 1 — #3521 (safety-stop history exclusion)
- Two production lines: `HistoryTurn.safetyNotice?` + `&& !t.safetyNotice`.
- Verified clean against `5307e922d`; 63/63 green; mutation-proven (11 tests
  catch removal of the guard).
- Clear the hold (title marker), let `hold-gate` re-run, merge.

```bash
gh pr checks 3521            # expect all green except hold-gate before clearing
gh pr merge 3521 --squash
git fetch origin && git log --oneline origin/main -1
```

### Step 2 — CI / deploy / smoke
```bash
gh run list --workflow=smoke-test.yml --branch main --limit 1
gh run list --workflow=deploy-vps.yml --limit 1
```
Both must be `success` before continuing.

**Verify the actual behaviour** (not just green CI): in the hub, produce a safety
refusal, then ask a normal follow-up. The refusal text must not influence the
answer, and the thread must still show the banner.

### Step 3 — #3531 (Retry for AssetChat / NodeChat)
- Adversarial suite 31/31; source pins mutation-proven on **both** components
  (a `pop()` regression and an argument-swap regression are both caught).
- **Note:** this is web-only. The Pixel cannot validate it.

```bash
gh pr merge 3531 --squash
```

### Step 4 — CI / deploy / smoke (same commands as step 2)

### Step 5 — Focused Retry acceptance — **in the hub, not on the phone**
Because #3531 is `mira-hub`: open an asset chat, force a failure, confirm the
question returns to the composer, Retry sends exactly once, and a double-tap
produces exactly one answer.

*(The Pixel's own Retry — steps 6–7 of PIXEL-RUN.md — exercises mobile's
separate, already-shipped CMPS-2 path. Useful, but not evidence for #3531.)*

### Step 6 — ADR
`#3514` (docs-only, clean against main). See the review: content-correct but
**needs a wording pass** before it lands. Merge only after that edit.

### Step 7 — Soak CI
Not prepared — see the report. Do not merge a CI change on the same day as the
two behavioural merges above; a red nightly job is much harder to attribute when
two other things shipped hours earlier.

---

## Stop the train if

- Any smoke or deploy run is not `success`.
- The hub verification in step 2 or step 5 disagrees with the merged rule.
- `main` moves under you from another session mid-step (re-check before merging).
- Anything asks for `--admin` or a branch-protection change.
