# BOOTSTRAP-EXCEPTION BOOTSTRAP-001 — Handoff

## New SHA
`d078b3db82d8677fea77d20b10e3e4fede5a36b7`

## Branch
`feat/fleet-gateway-BOOTSTRAP-001` (pushed to origin)

## Files Changed

| File | Change |
|---|---|
| `fleet-gateway/fleet_gateway/cao.py` | Two bug fixes in `LoopbackCAOClient` (see below) |
| `fleet-gateway/tests/test_cao_integration.py` | New: 12 integration + compatibility tests |

## Bug Fixes

### 1. `get_session` — nested CAO response parsing (cao.py:485)

**Problem:** Real CAO `GET /sessions/{name}` returns `{"session": {...}, "terminals": [...]}`.
The old code did `merged = dict(resp)` which stored the nested envelope verbatim, so
`terminal_id` and `terminal_status` were never extracted.

**Fix:** Extract `resp["session"]` fields (excluding `session.status` which is a tmux concept,
`"detached"/"attached"`, not a task status). Extract `terminals[0].id` → `terminal_id` and
`terminals[0].status` → `terminal_status`. In-process map fills remaining gaps via `setdefault`.

### 2. `task_snapshot` — dead session detection (cao.py:348)

**Problem:** `task_snapshot` read only the in-process `_sessions` map. If a CAO terminal died
(status `completed` or `error`) without an explicit `stop_worker` call, the task still appeared
`"running"` in `task_status` responses.

**Fix:** `task_snapshot` now calls `get_session` on the latest session to refresh live terminal
status. If `terminal_status` is `completed` or `error`, both the returned dict and the
in-process map entry are marked `"stopped"`.

## Real CAO Compatibility Checks Performed

- Confirmed CAO running at `127.0.0.1:9889` (version 0.0.1)
- `GET /health` → `{"status":"ok","components":{"cao":"ok","claude":"ok",...}}`
- `GET /agents/providers` → list including `claude_code` and `codex`
- `GET /agents/profiles` → confirmed `reviewer` is a real built-in profile (not invented)
- `GET /sessions/{name}` → real nested payload captured: `{"session":{...},"terminals":[{...}]}`
- `POST /sessions` mapping: `bravo→developer`, `charlie→reviewer`, `claude→claude_code`, `codex→codex`
- `POST /terminals/{id}/input?message=` and `POST /terminals/{id}/exit` — endpoints verified correct
- Old endpoints `/status` and `/workers` confirmed absent from `cao.py` source (test asserts this)

## pytest Results

```
70 passed in 2.15s
```

58 original tests + 12 new in `test_cao_integration.py`:
- 3 live read-only probes (skip if CAO down): health, providers list, claude_code+codex present
- 4 `get_session` unit tests (mock): nested parse, flat fallback, network error fallback, unknown session
- 4 `task_snapshot` unit tests (mock): completed→stopped, error→stopped, running stays running, no session
- 1 source scan: asserts `/status` and `/workers` NOT in `cao.py` (would fail on old client)

## Remaining Blockers

1. **#3533 still HELD** — no merge or deploy performed per hard boundary
2. **`launch_worker` not smoke-tested end-to-end** — creating a real CAO session was not done
   (would spawn a live `claude_code` agent; deferred per cautious boundary + Charlie review requirement)
3. **`task_snapshot` live refresh adds an HTTP call per poll** — acceptable for v1 frequency,
   but could be throttled/cached in a follow-up if polling becomes frequent
4. **Live Gateway not restarted** — fixes are in the branch; Gateway restart requires Charlie review first
