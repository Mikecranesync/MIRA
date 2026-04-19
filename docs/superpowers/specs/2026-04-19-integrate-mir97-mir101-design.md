# Design: Integrate MIR-97 (#329) + MIR-101 (#336)

**Date:** 2026-04-19
**Status:** Approved
**Author:** Claude Opus 4.7 (brainstormed with Mike)

## Summary

Two stranded Multica agent branches carry work that is genuinely needed in `main`:

1. **#336** — `mira-mcp` openviking v0.2.6 API fix (bug).
2. **#329** — cross-session equipment memory in the GSD engine (feature).

Neither has an open PR. Both merge cleanly against current `origin/main`. This doc scopes integration as two sequential PRs.

## Motivation

### #336 (openviking v0.2.6)

`mira-mcp/requirements.txt` pins `openviking==0.2.6`, but `mira-mcp/context/viking_store.py` still calls the pre-0.2.6 `openviking.open(store_key, create=True)` API. The old API raises on 0.2.6 and the code silently falls through to the sqlite keyword-cosine fallback, so `RETRIEVAL_BACKEND=openviking` is effectively broken in production today. The fix swaps to the `SyncOpenViking` class-based API (`mkdir` / `write` / `search`).

### #329 (cross-session equipment memory)

When a tech starts a new chat session with MIRA (new `chat_id`), asset identification restarts from zero. For returning users this is pure friction. The feature adds a NeonDB table (`user_asset_sessions`) that persists the last-identified asset, open work order, and last seen fault per `chat_id`, with a 72-hour TTL. On IDLE-state session start the engine hydrates `state["asset_identified"]` from NeonDB if a row exists.

## Out of scope

- Re-authoring the 13 other stranded `agent/issue-*` branches.
- Wiping Multica backlog/in-review items from the board.
- Any refactoring of the Supervisor state machine beyond the three insertion points the feature requires.

## Approach — two sequential cherry-picks

### PR 1 — `fix(mira-mcp): openviking v0.2.6 SyncOpenViking API (#336)`

- Source commit: `2e772fd` on `origin/agent/issue-336`.
- Base branch: fresh branch off `origin/main` (e.g. `fix/openviking-v026-api`).
- Files changed: `mira-mcp/context/viking_store.py` (+25/-5), `mira-mcp/tests/test_viking_store.py` (+151 new).
- Semantics change: `ingest_text()` now returns `1` instead of a row_id. Callers in `mira-mcp` do not use the return value — verified via `grep -rn "ingest_text(" mira-mcp/`.
- Module-level `_ov_client` singleton is lazy-initialised; thread-safety acceptable because `mira-mcp` runs single-worker `uvicorn`.

### PR 2 — `feat(engine): cross-session equipment memory (#329)`

- Source commit: `8e334d0` on `origin/agent/issue-329`.
- Base branch: fresh branch off `origin/main` after PR 1 merges (e.g. `feat/cross-session-memory`).
- Files changed:
  - `mira-bots/shared/session_memory.py` (new, 194 LOC) — graceful-fail NeonDB CRUD following `neon_recall.py` conventions.
  - `mira-bots/shared/engine.py` (+40 LOC) — 3 insertion points inside `Supervisor`:
    1. On IDLE + no asset → `load_session()` to hydrate.
    2. After vision-path asset ID → `save_session()`.
    3. After text-path asset ID → `save_session()`.
  - `mira-core/mira-ingest/db/001_user_asset_sessions.sql` (new, 21 LOC) — reference-only; table actually auto-created at runtime via `ensure_table()`.
  - `tests/test_session_memory.py` (new, 263 LOC).

## Verification

### PR 1
- `pytest mira-mcp/tests/test_viking_store.py -v` (new file must pass, no regressions in other mira-mcp tests).
- Docker build `mira-mcp` locally, run with `RETRIEVAL_BACKEND=openviking`, call `POST /retrieve` and confirm no fallback warning in logs.

### PR 2
- `pytest tests/test_session_memory.py -v` (new file must pass).
- `pytest tests/` full suite — ensure the 3 engine insertion points don't break existing fixtures (76 offline, 39 golden).
- Manual Telegram smoke: identify asset in chat A → close session → open new chat with same `chat_id` → first message routes through IDLE restore path → MIRA references the prior asset without re-asking.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| NeonDB writes add latency to every IDLE session start | Graceful-fail: `load_session()` returns `None` on any exception, session proceeds unchanged |
| `user_asset_sessions` table never created on first deploy | `ensure_table()` called inside `save_session()` — self-healing on first successful write |
| `NEON_DATABASE_URL` missing in some bot-net container | `_get_engine()` returns `None`, `load_session`/`save_session` no-op silently |
| Openviking semantics change (return value) | Grep-verified no callers use return value; tests cover new shape |
| Stale TTL entries pollute state | `load_session` compares `age_hours > SESSION_TTL_HOURS` after fetch; stale rows are deleted eagerly on read |

## Rollout

- PR 1 ships independently. Merge-then-deploy via normal Bravo/VPS path. Monitor `mira-mcp` logs for openviking errors post-deploy.
- PR 2 ships after PR 1 lands and is verified in prod. Confirm `NEON_DATABASE_URL` reachable from `mira-pipeline` container on VPS before merging.

## References

- Multica board issues: MIR-101 (local `agent/issue-336`), MIR-97 (`agent/issue-329`).
- GitHub issues: `Mikecranesync/MIRA#336`, `Mikecranesync/MIRA#329`.
- Related convention: `mira-bots/shared/neon_recall.py` (lazy-import, graceful-fail NeonDB access pattern).
