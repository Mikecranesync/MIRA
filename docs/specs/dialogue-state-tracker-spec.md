# Dialogue State Tracker (Stage 1 DST) Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Per-`chat_id` finite-state machine that drives MIRA's **Guided Socratic Dialogue** (GSD): forces the diagnostic conversation to proceed in a known sequence (`IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED`) and enables side states (`ASSET_IDENTIFIED`, `ELECTRICAL_PRINT`, `SAFETY_ALERT`) without losing the conversation thread. The DST is what lets MIRA produce one-question-at-a-time replies instead of the LLM dumping a checklist.

## Scope
**IN scope**
- `STATE_ORDER` and side-state list in `mira-bots/shared/engine.py`
- `_advance_state()` validator — invalid LLM-suggested transitions hold at current state
- `_clear_diagnostic_carryover()` — required when transitioning out of `RESOLVED`
- SQLite `conversation_state` table (WAL) — state persistence per `chat_id`
- `Supervisor.reset(chat_id)` — IDLE wipe

**OUT of scope**
- Intent classification (`guardrails.classify_intent` — upstream of DST)
- LLM call / RAG retrieval (workers, downstream of DST)
- Multi-tenant isolation (handled by `MIRA_TENANT_ID`)

## Architecture
```
Supervisor.process(chat_id, msg)
  ├── load state row from conversation_state
  ├── classify_intent → maybe SAFETY_ALERT bypass
  ├── _advance_state(current, proposed) → validated_next
  │     ├── if RESOLVED → next non-IDLE → _clear_diagnostic_carryover()
  │     └── if invalid → hold at current
  ├── workers run with state in context
  └── persist new state row
```

Side states branch:
- `ASSET_IDENTIFIED` — equipment recognized via vision; future answers include asset context.
- `ELECTRICAL_PRINT` — handled by `PrintWorker` for follow-up Qs.
- `SAFETY_ALERT` — bypasses RAG and FSM order; returns canned safety response immediately.

## API Contract

### Library
```python
sup.reset(chat_id: str) -> None
sup.process_full(chat_id, message, photo_b64) -> dict
# returns {"reply", "confidence", "trace_id", "next_state"}
```

`next_state` is the validated state after this turn. Adapter logs/displays it for debugging only — should not branch UI on it.

### Persistence
SQLite table (created via `Supervisor._ensure_table()`):
```sql
CREATE TABLE IF NOT EXISTS conversation_state (
    chat_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    asset_id TEXT,
    asset_identified INT DEFAULT 0,
    cmms_pending INT DEFAULT 0,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    history_json TEXT,
    extras_json TEXT
);
```

WAL mode required for concurrent reads from `mira-mcp` and writes from bot adapters / pipeline.

## Configuration
No service-level env vars beyond shared:
| Var | Purpose |
|---|---|
| `MIRA_DB_PATH` | SQLite location |
| `MIRA_HISTORY_LIMIT` | Trim history per turn (default 20) |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Property tests for FSM validity | included in 11 hypothesis tests | maintain |
| Invalid-transition hold rate | required | regression test for every new state |
| RESOLVED → new fault carryover | bug fixed; test covers it (memory `feedback_resolved_state_wo_rebuild`) | maintain |
| Concurrent writers from bots + pipeline | WAL required | maintain |

## Acceptance Criteria
1. **State order:** A clean session walks `IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED` over consecutive turns when each turn provides the requested info.
2. **Invalid hold:** If the LLM proposes an out-of-order transition (e.g., `Q1 → DIAGNOSIS`), state stays at current and the LLM is re-prompted.
3. **Safety bypass:** A safety keyword at any state immediately yields `SAFETY_ALERT`; on the next message the FSM resumes at IDLE unless safety persists.
4. **RESOLVED rebuild:** After `RESOLVED`, a new fault report rebuilds the WO — `_clear_diagnostic_carryover` resets `state["state"]` AND clears `cmms_pending` (regression: clearing `cmms_pending` alone is insufficient).
5. **Reset wipe:** `sup.reset(chat_id)` returns the row to `IDLE` and empties `history_json`/`extras_json`.
6. **History cap:** With 50 turns, only the last `MIRA_HISTORY_LIMIT` survive in `history_json`.
7. **Concurrent safety:** Telegram and pipeline both writing for the same `chat_id` do not corrupt the row (WAL retry test).

## Known Issues
- DST is **Stage 1**: state is a flat enum with side states. Stage 2 (slot-based DST tracking equipment, fault codes, parts, time-since-last-PM) is planned but not built.
- LLM-suggested transitions occasionally try to skip ahead — invalid-hold rate matters as much as correct-advance rate.

## Change Log
- 2026-04 — `_clear_diagnostic_carryover` patched to reset `state["state"]` off RESOLVED (memory: feedback_resolved_state_wo_rebuild).
- 2026-04 — Property tests added under `tests/property/`.
