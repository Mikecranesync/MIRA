# FOUNDATION-002A Charlie independent review

- **Verdict:** PASS
- **Reviewed SHA:** `dea7edb7239c6c3bdfd83da10d5ec5fc264201da`
- **Range:** `51deaa840f212ffef56e862ce09cd9864b327fac..dea7edb7239c6c3bdfd83da10d5ec5fc264201da`
- **Reviewer:** Charlie (independent Integration/QA)
- **Review worktree:** `/Users/bravonode/Mira-worktrees/fleet-e2e-FOUNDATION-002A-review` (detached, isolated; not Bravo adapter cwd, not live Gateway cwd)
- **When:** 2026-08-31 ~20:00 ET
- **Do not merge. Do not deploy.**

This review does **not** trust Bravo's summary. Evidence is `git show` / `git diff` on the SHA, source inspection, CAO 2.5.0 installed package (`cli_agent_orchestrator==2.5.0`) route signatures (no live `9889` calls), and pytest run in **this** worktree.

Commits in range:

1. `0a0d994c818b638d6e6cdebdc62d870209e38275` — real loopback CAO adapter + task session history
2. `dea7edb7239c6c3bdfd83da10d5ec5fc264201da` — assert retry uses commit B not A

## Pytest Charlie ran (not Bravo's claim)

```text
cd /Users/bravonode/Mira-worktrees/fleet-e2e-FOUNDATION-002A-review
PATH=/opt/homebrew/bin:$PATH PYTHONPATH=fleet-gateway python3 -m pytest fleet-gateway/tests -q --no-header
..........................................................               [100%]
58 passed in 2.30s
58 tests collected
```

Repeat observation on the same SHA after discarding an accidental Claude `run-local.sh` edit (reverted; worktree clean at reviewed SHA): **58 passed in 2.30s**.

## Criteria

### 1. LoopbackCAOClient talks CAO 2.5.0 — PASS

Checked against installed CAO 2.5.0 `cli_agent_orchestrator/api/main.py` (local package, not a live probe):

| Gateway method | Adapter call | CAO 2.5.0 route |
|---|---|---|
| `fleet_snapshot` | `GET /health` (`cao.py:279`) | `@app.get("/health")` L1539 |
| `launch_worker` | `POST /sessions` (`cao.py:386`) | `@app.post("/sessions")` L2859 |
| `message_worker` | `POST /terminals/{id}/input?message=` (`cao.py:417-421`) | `@app.post("/terminals/{terminal_id}/input")` L3434 (`message: str` query) |
| `stop_worker` | `POST /terminals/{id}/exit` + `DELETE /sessions/{name}` (`cao.py:473,478`) | L3570 / L3031. Session delete tears down tmux/registry, not Gateway git worktrees. |

- **Not** `GET /status`. **Not** `POST /workers`. Confirmed by full `cao.py` read of `LoopbackCAOClient`.
- **Refuses non-127.0.0.1:** `assert_loopback_cao_url` (`cao.py:52-61`) requires `http(s)` + hostname exactly `127.0.0.1`, no URL credentials. Constructor pins `self.base_url` through it (`cao.py:224`). Covered by `test_cao_loopback.py` (localhost, `::1`, `0.0.0.0`, LAN, Tailscale CGNAT, creds).
- **Never binds:** client is `urllib.request.urlopen` only. No `bind(`/`listen(`/`HTTPServer`. Gateway HTTP bind is separate (`http_app.default_bind_host` defaults `127.0.0.1`); this package never listens as CAO.
- **Never `use_worktree=true`:** `launch_worker` query is only `agent_profile`, `provider`, `session_name`, optional `working_directory` (`cao.py:374-380`). CAO 2.5.0 `POST /sessions` has **no** `use_worktree` parameter (that flag exists on `POST /sessions/{name}/terminals`, default `False`). Gateway never sets it.
- Profile mapping: `bravo→developer`, `charlie→reviewer`; provider `claude→claude_code`, `codex→codex` (`cao.py:24-27, 367-368`). Matches local CAO built-ins.
- `stop_worker` does not delete Gateway worktrees: Gateway `WorktreeProvisioner` has no remove path (`worktree.py:1,35` "Never rm -rf"); `service._stop_worker` hard-refuses `delete_worktree` (`service.py:402-407`); CAO stop is tmux exit + session delete.

### 2. Worktree created BEFORE CAO launch; `working_directory` passed in — PASS

`service._launch_worker` (`service.py:260-276`):

1. `temp_session = uuid.uuid4().hex[:12]`
2. `self.worktrees.create(...)` → `git worktree add --detach` (`worktree.py:54-62`)
3. `spec["working_directory"] = worktree`
4. **then** `self.cao.launch_worker(spec)`
5. `record_worktree(session_id, worktree)` after CAO returns

FakeCAO honors `working_directory` as `worktree` (`cao.py:125-126`). LoopbackCAOClient forwards it as the CAO query param (`cao.py:379-380`).

### 3. Reused `task_id` / attempts / retry commit / session-only stop — PASS

- **Latest session:** FakeCAO `_latest_by_task[task_id] = session_id` on each launch (`cao.py:140-141`); `task_snapshot` returns that live session (`cao.py:104-111`). LoopbackCAOClient scans `_session_order` reversed (`cao.py:348-357`). `task_status` overlays snapshot `session_id`/`status`/`worktree`/`claimed_commit` on the artifact (`service.py:176-192,226`).
- **`attempts[]`:** `ArtifactStore.write_task` pushes the prior top-level record when `session_id` changes (`store.py:35-40`); preserves history on same-session updates (`store.py:41-43`).
- **Failed then retry does not inherit failed commit:** `test_failed_first_attempt_second_session_wins` launches commit A, stops, launches commit B; asserts `status.commit == commit_b`, `claimed_commit_matches_artifact is True`, artifact `claimed_commit == commit_b`, `attempts[]` contains `base_commit == commit_a`. Charlie observed this test pass in the 58-test run.
- **`stop_worker(session_id only)`:** `service.py:412-420` resolves `task_id` via `find_task_id_for_session` and writes `status=stopped`. `test_stop_worker_session_only_updates_task_status` asserts `task_status.status != "running"`. Passed.

### 4. pytest in THIS worktree — PASS

Charlie ran (twice) `PATH=/opt/homebrew/bin:$PATH PYTHONPATH=fleet-gateway python3 -m pytest fleet-gateway/tests -q --no-header` from `/Users/bravonode/Mira-worktrees/fleet-e2e-FOUNDATION-002A-review` at `dea7edb7239c6c3bdfd83da10d5ec5fc264201da`: **58 passed**.

### 5. No merge / deploy / CAO public bind / secrets in git — PASS

- Diff is 7 files: spec, `.env.example` (placeholder `change-me-to-a-long-random-token` only), README, `cao.py`, `service.py`, `store.py`, new `test_regression_002A.py`.
- No merge/deploy/push-main code paths added. Launch deny-list still includes `merge`/`deploy`/`push_main`/`delete_worktree` (`service.py:425-438`).
- Loopback client still refuses non-`127.0.0.1`. CAO plist on this machine remains `--host 127.0.0.1` (observed; not modified by this SHA).
- Secret-like token scan of the range: none.

### 6. Durable review artifact — this file

Written in the isolated review worktree and committed as review-only evidence on the HELD branch `feat/fleet-gateway-mcp-v1`. **Not merged to main.**

## Findings

No blocking defects vs the PASS criteria.

## Residuals (non-blocking)

1. Worktree directory is named with a **temp UUID**, not the CAO `session_name` (`service.py:262-266`). Path is still passed as `working_directory` before launch; functional.
2. `find_task_id_for_session` matches **historical** `attempts[]` session ids (`store.py:62-65`) then always writes **top-level** `status=stopped`. Stopping an old attempt after a retry would mark the current task stopped. Criterion 3's session-only stop of the *current* session is correct and tested.
3. `LoopbackCAOClient._sessions` is in-process only; Gateway restart loses terminal_id mapping. Artifact store remains durable.
4. Live `task_snapshot` (loopback) does not include `claimed_commit`/`base_commit`; retry-commit correctness on the live path relies on the artifact + FakeCAO coverage. Tests use FakeCAO for that assertion.
5. Adapter tests mock `urlopen`; Charlie did **not** curl port 9889 (forbidden). Wire mapping was checked against the installed CAO 2.5.0 source.
6. `stop_worker` swallows CAO exit/delete errors (`cao.py:474-480`) and still records local `stopped`.
7. Terminal messages go as query `message=` (CAO 2.5.0 FastAPI signature). Fine for this PR; noisy if secrets ever appear in chat text.
8. A Claude Code `-p` pass was attempted from this worktree; it drifted (unrelated `run-local.sh` SC2155 edit). That edit was **reverted** before this artifact. Verdict is from Charlie's own diff/source/pytest, not Bravo and not that Claude run.

## Blockers

None for FOUNDATION-002A acceptance. Branch remains HELD: no merge, no deploy, no CAO public bind.
