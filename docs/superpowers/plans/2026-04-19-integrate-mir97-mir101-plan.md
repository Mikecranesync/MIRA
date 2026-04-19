# Integrate MIR-97 (#329) + MIR-101 (#336) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rescue two stranded Multica agent branches (`agent/issue-336`, `agent/issue-329`) into `main` via two sequential PRs.

**Architecture:** Cherry-pick one commit per PR from each agent branch onto a fresh branch off latest `origin/main`. Run the test suite that already ships on each branch. Open PR, review, merge, deploy. Ship PR 1 (bug fix) before PR 2 (feature) so they can be independently verified and reverted.

**Tech Stack:** Python 3.12, uv, pytest, FastMCP (mira-mcp), SQLAlchemy + NeonDB (session_memory), Git cherry-pick + GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-04-19-integrate-mir97-mir101-design.md`

---

## Pre-flight

Run these once before starting. Both PRs depend on the working copy being clean.

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --porcelain`
Expected: empty output (no uncommitted changes).

If not empty: commit or stash your work first. The spec commit (`975fcae`) on `fix/fastmcp-v3-upgrade` is fine to leave.

- [ ] **Step 2: Fetch latest from origin**

Run: `git fetch origin --prune`
Expected: fetches any new refs; no errors.

- [ ] **Step 3: Verify the two source commits exist on remote**

Run:
```bash
git show --oneline -s origin/agent/issue-336 -- 2>&1 | head -1
git show --oneline -s origin/agent/issue-329 -- 2>&1 | head -1
```
Expected:
```
2e772fd fix(mira-mcp): replace openviking.open() with v0.2.6 class-based API (#336)
8e334d0 feat(engine): cross-session equipment memory — persist asset state across chat sessions
```

- [ ] **Step 4: Confirm `gh` CLI is authenticated**

Run: `gh auth status`
Expected: `Logged in to github.com as <user>` with `admin:org`, `repo`, `workflow` scopes.

---

# PR 1 — fix(mira-mcp): openviking v0.2.6 SyncOpenViking API (#336)

### Task 1: Create the integration branch

**Files:** (none yet — branch creation only)

- [ ] **Step 1: Create fresh branch off origin/main**

Run:
```bash
git switch -c fix/openviking-v026-api origin/main
```
Expected: `Switched to a new branch 'fix/openviking-v026-api'`

- [ ] **Step 2: Confirm branch base**

Run: `git log --oneline HEAD~1..HEAD`
Expected: last commit is whatever is at `origin/main` HEAD (not the spec commit — we branched off `origin/main`, not `fix/fastmcp-v3-upgrade`).

### Task 2: Cherry-pick the fix

**Files:**
- Modify: `mira-mcp/context/viking_store.py` (+25 / -5 via cherry-pick)
- Create: `mira-mcp/tests/test_viking_store.py` (+151 via cherry-pick)

- [ ] **Step 1: Cherry-pick `2e772fd`**

Run:
```bash
git cherry-pick 2e772fd
```
Expected: cherry-pick succeeds with no conflicts. New commit SHA will be printed.

If conflict: abort with `git cherry-pick --abort` and escalate — spec verified merge-tree is clean as of 2026-04-19.

- [ ] **Step 2: Verify the two files changed**

Run: `git show --stat HEAD`
Expected:
```
 mira-mcp/context/viking_store.py    |  30 +++++--
 mira-mcp/tests/test_viking_store.py | 151 ++++++++++++++++++++++++++++++++++++
 2 files changed, 176 insertions(+), 5 deletions(-)
```

### Task 3: Run the new test file

**Files:**
- Test: `mira-mcp/tests/test_viking_store.py`

- [ ] **Step 1: Install mira-mcp test deps if needed**

Run:
```bash
cd mira-mcp && uv pip install -e '.[test]' 2>&1 | tail -5
```
Expected: either installs cleanly or reports "Already satisfied." If there's no extras group, run `uv pip install -r requirements.txt pytest` instead.

- [ ] **Step 2: Run new test file**

Run:
```bash
cd mira-mcp && python -m pytest tests/test_viking_store.py -v 2>&1 | tail -40
```
Expected: every test in the file passes. If `openviking` is not installed in the venv, tests should still pass — the fallback codepath is exercised.

If a test fails: do NOT patch the test to make it pass. Read the failure, decide whether the source commit is buggy or the env is wrong. Escalate if unsure.

- [ ] **Step 3: Run full mira-mcp test suite for regressions**

Run:
```bash
cd mira-mcp && python -m pytest tests/ -v 2>&1 | tail -20
```
Expected: all pre-existing tests still pass. No new failures.

### Task 4: Smoke-test the changed import path locally

**Files:** (none modified)

- [ ] **Step 1: Import the module in isolation**

Run:
```bash
cd mira-mcp && python -c "from context.viking_store import ingest_text, retrieve; print('import ok')"
```
Expected: `import ok`. No ImportError.

- [ ] **Step 2: Confirm no stale reference to old API**

Run (from repo root):
```bash
grep -n "openviking\.open(" mira-mcp/
```
Expected: no matches. Old `openviking.open(...)` call is gone.

### Task 5: Push and open PR

**Files:** (PR metadata only)

- [ ] **Step 1: Push branch**

Run:
```bash
git push -u origin fix/openviking-v026-api
```
Expected: branch pushed.

- [ ] **Step 2: Verify commit landed on remote**

Run: `git log origin/fix/openviking-v026-api --oneline -1`
Expected: same SHA as local HEAD.

- [ ] **Step 3: Open PR**

Run:
```bash
gh pr create --base main --head fix/openviking-v026-api \
  --title "fix(mira-mcp): openviking v0.2.6 SyncOpenViking API (#336)" \
  --body "$(cat <<'EOF'
## Summary
- Swap `mira-mcp/context/viking_store.py` from the pre-0.2.6 `openviking.open()` API to the new `SyncOpenViking` class (`mkdir` / `write` / `search`).
- `mira-mcp/requirements.txt` already pins `openviking==0.2.6`, so the old API path silently fell through to the sqlite fallback in production — this restores the vector retrieval path.
- Add `mira-mcp/tests/test_viking_store.py` (151 lines) covering both openviking and fallback paths.

## Behavior change
- `ingest_text()` now returns `1` on the openviking path instead of a row_id. The only caller (`ingest_pdf` at `viking_store.py:107`) does not use the return value — grep-verified.

## Test plan
- [x] `pytest mira-mcp/tests/test_viking_store.py -v`
- [x] Full `mira-mcp` test suite — no regressions
- [ ] Post-merge smoke: confirm `RETRIEVAL_BACKEND=openviking` no longer logs "openviking.search failed" on prod

Closes #336.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: `gh` prints the PR URL. Record it.

- [ ] **Step 4: Verify PR is open and shows the expected diff**

Run:
```bash
gh pr view --json state,files | head -30
```
Expected: `"state":"OPEN"`, two files listed (`mira-mcp/context/viking_store.py`, `mira-mcp/tests/test_viking_store.py`).

### Task 6: Merge when green

**Files:** (none)

- [ ] **Step 1: Wait for CI to complete**

Run: `gh pr checks`
Expected: all checks `pass`. If any fail, fix before merging — do not force-merge.

- [ ] **Step 2: Request user review before merge**

Stop here and ask Mike:
> "PR 1 green. Want me to merge #336 now or wait?"

Do not merge until the user approves.

- [ ] **Step 3: Merge (after approval)**

Run:
```bash
gh pr merge --squash --delete-branch
```
Expected: PR merged, branch deleted locally and on remote.

- [ ] **Step 4: Verify merge**

Run: `git fetch origin && git log origin/main --oneline -3`
Expected: squashed merge commit appears at tip of main.

- [ ] **Step 5: Close the Multica MIR-101 card**

Run:
```bash
ssh charlienode@100.70.49.126 "multica issue status 65b1f2e4-c59a-4706-9574-d86b3c1c2c88 done 2>&1 || multica issue update MIR-101 --status done 2>&1" | head -5
```
Expected: MIR-101 moved to `done`. If the CLI signature doesn't match, check `multica issue status --help` on Charlie and adapt.

---

# PR 2 — feat(engine): cross-session equipment memory (#329)

Do NOT start this section until PR 1 is merged and verified in prod.

### Task 7: Create the integration branch from fresh main

**Files:** (branch only)

- [ ] **Step 1: Update main reference**

Run: `git fetch origin`
Expected: `origin/main` now includes the PR 1 merge commit.

- [ ] **Step 2: Create fresh branch off updated origin/main**

Run:
```bash
git switch -c feat/cross-session-memory origin/main
```
Expected: `Switched to a new branch 'feat/cross-session-memory'`.

### Task 8: Cherry-pick the feature commit

**Files:**
- Create: `mira-bots/shared/session_memory.py` (194 lines)
- Create: `mira-core/mira-ingest/db/001_user_asset_sessions.sql` (21 lines)
- Create: `tests/test_session_memory.py` (263 lines)
- Modify: `mira-bots/shared/engine.py` (+40 lines at 3 insertion points)

- [ ] **Step 1: Cherry-pick `8e334d0`**

Run: `git cherry-pick 8e334d0`
Expected: cherry-pick succeeds with no conflicts.

If conflict on `mira-bots/shared/engine.py`: abort with `git cherry-pick --abort`. Engine.py has had heavy recent activity (Q-trap, envelope, P0 fixes); a conflict post-PR-1 is possible. Resolve manually only if you can read the conflict and understand both sides — otherwise escalate.

- [ ] **Step 2: Verify the four files changed**

Run: `git show --stat HEAD`
Expected:
```
 mira-bots/shared/engine.py                         |  40 ++++
 mira-bots/shared/session_memory.py                 | 194 +++++++++++++++
 mira-core/mira-ingest/db/001_user_asset_sessions.sql |  21 ++
 tests/test_session_memory.py                       | 263 +++++++++++++++++++++
 4 files changed, 518 insertions(+)
```

### Task 9: Run the new test file

**Files:**
- Test: `tests/test_session_memory.py`

- [ ] **Step 1: Ensure test deps installed**

Run (from repo root):
```bash
uv pip install -r requirements.txt -r requirements-dev.txt 2>&1 | tail -5
```
Expected: resolves cleanly. If `requirements-dev.txt` doesn't exist, run `uv pip install pytest pytest-asyncio sqlalchemy`.

- [ ] **Step 2: Run the session_memory test file**

Run:
```bash
python -m pytest tests/test_session_memory.py -v 2>&1 | tail -40
```
Expected: all tests pass. Tests are designed to work without a live NeonDB (they mock the engine).

- [ ] **Step 3: Run the broader bot test suite for regressions in engine.py**

Run:
```bash
python -m pytest tests/ -k "not slow and not integration" -v 2>&1 | tail -30
```
Expected: no new failures vs `origin/main` baseline. If `tests/eval/` takes too long, scope down to `tests/test_engine*.py`.

### Task 10: Static check the three engine.py insertion points

**Files:** (review only)

- [ ] **Step 1: Show the engine.py diff**

Run: `git diff HEAD~1 HEAD -- mira-bots/shared/engine.py`
Expected: three additions —
  1. Import: `from . import session_memory`
  2. IDLE-restore block inside the main `diagnose`/chat entry (reads `load_session`).
  3. Two `save_session(...)` calls after asset identification (vision + text paths).

Visually confirm nothing else in engine.py is touched. If extra lines appear, investigate before proceeding.

- [ ] **Step 2: Check for env var reference**

Run: `grep -n "MIRA_SESSION_TTL_HOURS\|NEON_DATABASE_URL" mira-bots/shared/session_memory.py`
Expected: one ref to `MIRA_SESSION_TTL_HOURS` (TTL default 72), one ref to `NEON_DATABASE_URL`.

### Task 11: Confirm NeonDB connectivity from dev env

**Files:** (none)

- [ ] **Step 1: Verify NEON_DATABASE_URL is reachable**

Run:
```bash
doppler run --project factorylm --config prd -- python -c "
import os
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
url = os.environ['NEON_DATABASE_URL']
eng = create_engine(url, poolclass=NullPool, connect_args={'sslmode':'require'})
with eng.connect() as c:
    print(c.execute(text('SELECT 1')).scalar())
"
```
Expected: prints `1`. If you're on Windows and hit the `channel_binding` SSL issue (per CLAUDE.md gotcha), SSH to Bravo/Charlie and run from there, or skip this step and rely on prod's graceful-fail behavior.

- [ ] **Step 2: Smoke-test `ensure_table()` against dev Neon**

Run:
```bash
doppler run --project factorylm --config prd -- python -c "
from mira_bots.shared.session_memory import ensure_table
print('ensure_table:', ensure_table())
"
```
Expected: `ensure_table: True`. If the import path doesn't work, adjust PYTHONPATH or run from `mira-bots/`.

If this fails with DB errors: the graceful-fail code paths still allow the PR to merge (the feature is a silent no-op until the table exists), but flag it in the PR body.

### Task 12: Push and open PR

**Files:** (PR metadata only)

- [ ] **Step 1: Push branch**

Run: `git push -u origin feat/cross-session-memory`
Expected: branch pushed.

- [ ] **Step 2: Open PR**

Run:
```bash
gh pr create --base main --head feat/cross-session-memory \
  --title "feat(engine): cross-session equipment memory (#329)" \
  --body "$(cat <<'EOF'
## Summary
- Add `mira-bots/shared/session_memory.py` — graceful-fail NeonDB CRUD following `neon_recall.py` conventions.
- Persist the last-identified asset + open work order + last seen fault per `chat_id` in a new `user_asset_sessions` table (auto-created via `ensure_table()`; 72h TTL via `MIRA_SESSION_TTL_HOURS`).
- Hook into `Supervisor` at three points in `mira-bots/shared/engine.py`:
  1. On IDLE + no asset → hydrate from NeonDB.
  2. After vision-path asset ID → persist.
  3. After text-path asset ID → persist.
- 263 lines of tests in `tests/test_session_memory.py`.

## Behavior change
- First request in a fresh session may now do a single NeonDB `SELECT` (≤100ms p50 in Neon us-east-1). Returns `None` on any DB error — session proceeds unchanged.
- Returning techs will see MIRA reference the prior asset without re-identifying.

## Risks
- New Neon roundtrip on session start. Mitigated: `load_session` returns `None` on any exception; no user-visible failure mode.
- `user_asset_sessions` table created on first successful write via `ensure_table()` — no separate migration.

## Deploy checklist
- [ ] Verify `NEON_DATABASE_URL` is set in `mira-pipeline` + bot containers on VPS.
- [ ] After deploy, watch logs for `session_memory:` lines; expect `ensure_table` on first real request.

## Test plan
- [x] `pytest tests/test_session_memory.py -v`
- [x] Full bot test suite — no regressions on engine.py paths
- [ ] Manual Telegram: identify asset in chat A → new session → confirm MIRA references prior asset

Closes #329.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: `gh` prints the PR URL.

- [ ] **Step 3: Verify PR matches expected diff**

Run: `gh pr view --json state,additions,deletions,changedFiles`
Expected: `"state":"OPEN"`, `"additions":518`, `"deletions":0`, `"changedFiles":4`.

### Task 13: Merge when green

**Files:** (none)

- [ ] **Step 1: Wait for CI**

Run: `gh pr checks`
Expected: all checks pass.

- [ ] **Step 2: Request user review before merge**

Stop and ask Mike:
> "PR 2 green. Want me to merge #329 now or wait?"

Do not merge until approved.

- [ ] **Step 3: Merge (after approval)**

Run: `gh pr merge --squash --delete-branch`
Expected: merged, branch deleted.

- [ ] **Step 4: Verify merge**

Run: `git fetch origin && git log origin/main --oneline -3`
Expected: squashed merge commit at tip.

### Task 14: Post-merge production verification

**Files:** (none)

- [ ] **Step 1: Deploy to VPS**

Run:
```bash
ssh root@165.245.138.91 "cd /opt/mira && git pull && doppler run --project factorylm --config prd -- docker compose up -d --force-recreate mira-pipeline"
```
Expected: container recreated, healthy.

- [ ] **Step 2: Confirm the table was created on Neon**

Run:
```bash
doppler run --project factorylm --config prd -- python -c "
import os
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
eng = create_engine(os.environ['NEON_DATABASE_URL'], poolclass=NullPool, connect_args={'sslmode':'require'})
with eng.connect() as c:
    print(c.execute(text(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='user_asset_sessions'\")).scalar())
"
```
Expected: `1`. Table is self-created on first write — if `0`, no session has triggered persistence yet. Send a Telegram message with a fault code to trigger one, then re-run.

- [ ] **Step 3: Exercise the full loop**

Via Telegram:
1. Send a photo of a VFD nameplate → MIRA IDs the asset.
2. Close the session (no messages for ~5 min is fine — no explicit close needed).
3. Start a new message in the same thread.
4. MIRA should reference the prior asset without re-asking.

Record the result in the PR as a comment.

- [ ] **Step 4: Close MIR-97 on Multica**

Run:
```bash
ssh charlienode@100.70.49.126 "multica issue status 8eaaae8e-9263-4391-ac10-b5bed68bac3f done 2>&1 || multica issue update MIR-97 --status done 2>&1" | head -5
```
Expected: MIR-97 moved to `done`.

---

## Self-review

**Spec coverage:**
- PR 1 covers openviking API fix + tests + caller-compat check → Tasks 1–6. ✅
- PR 2 covers session_memory module + engine hooks + table auto-create + tests + TTL env var + graceful-fail + prod verification → Tasks 7–14. ✅
- "Run PR 1 before PR 2" ordering enforced by placing Task 7 explicitly after PR 1 merge. ✅
- Risks section (Neon latency, table creation, NEON URL missing, openviking semantics, TTL) → covered in PR bodies + Task 11 dev-smoke + Task 14 prod-smoke. ✅

**Placeholder scan:** No TBDs or "implement later". One conditional: "if `openviking` not installed" fallback — intentional. ✅

**Type consistency:** `ingest_text` / `retrieve` / `load_session` / `save_session` / `ensure_table` signatures used identically across tasks. No method-name drift. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-integrate-mir97-mir101-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — one fresh subagent per Task, two-stage review between, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
