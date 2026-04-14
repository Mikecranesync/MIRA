# PR #186 Merge — Pipeline + App Tuning → staging → main

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the 48-commit `feature/mira-pipeline` branch into `staging`, then promote `staging` into `main`, closing PRs #186 and #160. Clean up 3 stale PRs.

**Architecture:** Three-phase merge. First fix CI (ruff format on engine.py), then merge pipeline→staging (PR #186, 0 conflicts), then merge main→staging to sync (3 commits from main not on staging, 0 conflicts), then promote staging→main (closes #160). Finally close stale PRs #115, #116, #118.

**Tech Stack:** git, gh CLI, ruff

---

## Preflight State

```
main      (d0b6af1) — 3 commits ahead of staging, 0 conflicts
staging   (c937980) — 11 commits ahead of main (tenant isolation + mira-web)
pipeline  (8a42290) — 48 commits ahead of main, superset of staging
                       0 conflicts with staging or main
```

CI on #186: **Lint failing** — `mira-bots/shared/engine.py` needs `ruff format`.

---

### Task 1: Fix CI lint failure

**Files:**
- Modify: `mira-bots/shared/engine.py`

- [ ] **Step 1: Format engine.py**

```bash
cd /c/Users/hharp/Documents/MIRA
python -m ruff format mira-bots/shared/engine.py
```

- [ ] **Step 2: Verify ruff passes**

```bash
python -m ruff check mira-bots/shared/engine.py
```

Expected: `All checks passed!`

- [ ] **Step 3: Run tests**

```bash
python -m pytest tests/test_fsm_states.py tests/test_option_selection.py tests/test_tenant_isolation.py tests/test_gibberish_detection.py tests/test_session_context.py -v
```

Expected: all pass

- [ ] **Step 4: Commit and push**

```bash
git add mira-bots/shared/engine.py
git commit -m "chore: ruff format engine.py — fix CI lint gate"
git push origin feature/mira-pipeline
```

- [ ] **Step 5: Verify CI passes on PR #186**

```bash
# Wait ~2 min for CI, then:
gh pr checks 186 --repo Mikecranesync/MIRA
```

Expected: Lint & Format ✓

---

### Task 2: Merge feature/mira-pipeline → staging (PR #186)

**Files:** None modified — git merge only.

- [ ] **Step 1: Checkout staging and pull latest**

```bash
git checkout staging
git pull origin staging
```

- [ ] **Step 2: Merge pipeline branch**

```bash
git merge origin/feature/mira-pipeline --no-ff -m "feat: merge mira-pipeline — app tuning, FSM fixes, tenant isolation, Playwright audit (#186)"
```

Expected: Clean merge, 0 conflicts (verified via `git merge-tree`).

- [ ] **Step 3: Push staging**

```bash
git push origin staging
```

- [ ] **Step 4: Close PR #186 via gh**

```bash
gh pr close 186 --repo Mikecranesync/MIRA --comment "Merged to staging via local merge."
```

---

### Task 3: Sync main → staging (3 commits behind)

**Files:** None modified — git merge only.

- [ ] **Step 1: Merge main into staging**

```bash
git checkout staging
git merge origin/main --no-ff -m "chore: sync main → staging (LinkedIn automation, regime6 fix, v0.5.3 promote)"
```

Expected: Clean merge, 0 conflicts (verified).

- [ ] **Step 2: Push staging**

```bash
git push origin staging
```

---

### Task 4: Promote staging → main

**Files:** None modified — git merge only.

- [ ] **Step 1: Checkout main and merge staging**

```bash
git checkout main
git pull origin main
git merge origin/staging --no-ff -m "chore: promote staging → main — mira-pipeline, tenant isolation, app tuning"
```

- [ ] **Step 2: Push main**

```bash
git push origin main
```

- [ ] **Step 3: Close PR #160**

```bash
gh pr close 160 --repo Mikecranesync/MIRA --comment "Merged to main via staging promotion."
```

- [ ] **Step 4: Tag the release**

```bash
git tag -a v0.6.0 -m "v0.6.0 — mira-pipeline, tenant isolation, nameplate ingestion, app UX tuning"
git push origin v0.6.0
```

---

### Task 5: Clean up stale PRs and branches

- [ ] **Step 1: Close stale PRs**

```bash
gh pr close 115 --repo Mikecranesync/MIRA --comment "Superseded by RAG threshold fix in #180."
gh pr close 116 --repo Mikecranesync/MIRA --comment "Ruff cleanup landed in pipeline branch."
gh pr close 118 --repo Mikecranesync/MIRA --comment "Test fixes landed in pipeline branch."
```

- [ ] **Step 2: Delete merged feature branch**

```bash
git push origin --delete feature/mira-pipeline
git branch -d feature/mira-pipeline
```

- [ ] **Step 3: Verify final state**

```bash
git log origin/main --oneline -5
gh pr list --repo Mikecranesync/MIRA --state open
git branch -a --sort=-committerdate | head -10
```

Expected: main and staging in sync, PRs #160 and #186 closed, stale PRs closed, pipeline branch deleted.

---

## Verification

```bash
# Main and staging should be identical
git log origin/main..origin/staging --oneline   # should be empty
git log origin/staging..origin/main --oneline   # should be empty

# Tag exists
git tag -l v0.6.0

# No open PRs for pipeline
gh pr list --repo Mikecranesync/MIRA --state open --json number,title

# VPS still running the deployed code (no redeploy needed — already deployed from pipeline branch)
ssh vps "docker exec mira-pipeline-saas curl -sf http://localhost:9099/health"
```
