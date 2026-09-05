# FLEET-PRD-P1-FAILCLOSED-REFUSE-STOP-001 — Ownership Fail-Closed Proof

## Task
PRD Test B: Fleet Gateway refuses to stop/control/cleanup any session it cannot prove the fleet owns.

## Host
FactoryLM-Bravo.local (bravonode)

## Branch
fleet/FLEET-PRD-P1-FAILCLOSED-REFUSE-STOP-001

## Base SHA
ca504cf95843810b4a9cc121d111fb050dcedb0a

## Implementation Summary

**Files changed:**
- `fleet-gateway/fleet_gateway/errors.py` — added `OwnershipError(http_status=403)`
- `fleet-gateway/fleet_gateway/store.py` — added `ArtifactStore.is_fleet_owned(session_id) -> bool` (wraps `find_task_id_for_session`)
- `fleet-gateway/fleet_gateway/service.py` — added `fleet_owned: True` to launch record; added `_require_fleet_ownership(session_id)` helper; wired it into `_message_worker`, `_request_handoff`, `_stop_worker` — all call `_require_fleet_ownership` **before** any CAO call
- `fleet-gateway/tests/test_ownership_fail_closed.py` — 7 regression tests (new)

**Ownership proof mechanism:**  
Artifact store (`ArtifactStore`) is the durable source of truth. `launch_worker` writes `fleet_owned: True` into the task artifact. Any control path (`stop_worker`, `message_worker`, `request_handoff`) calls `_require_fleet_ownership(session_id)` which scans the artifact store. If no artifact matches → `OwnershipError(403)` is raised before any CAO call (fail-closed by construction). `delete_worktree` is already in `DENIED_TOOLS` and hard-denied by `_stop_worker`'s ContractViolation guard — covered by construction.

## Test Results

```
77 passed, 0 failed, 0 regressions
```

Tests covering all 4 required regression cases:
1. `test_stop_fleet_owned_session_succeeds` — stop of fleet-owned session works + CAO call confirmed
2. `test_stop_unknown_session_refused` — OwnershipError raised; CAO.stop_worker never called
3. `test_stop_unowned_live_session_refused` — CAO-resident but not artifact-owned; refused; session untouched
4. `test_message_unowned_session_refused` — message_worker refused on unowned session
5. `test_handoff_unowned_session_refused` — request_handoff refused on unowned session
6. `test_delete_worktree_refused_by_construction` — ContractViolation gate fires before ownership check
7. `test_stop_fleet_owned_does_not_affect_other_sessions` — protected session stays alive after fleet-owned stop

## PROTECTED Sessions — BEFORE (19 total)

```
cao-BOOTSTRAP-001
cao-BOOTSTRAP-001-028c6adb
cao-BOOTSTRAP-001-587bc633
cao-BOOTSTRAP-001-CHARLIE-LEDGER-2a1a4e13
cao-BOOTSTRAP-001-charlie
cao-FLEET-PRD-P1-FAILCLOSED-001-c2e07650   ← this session (my driver)
cao-FLEET-SESSION-LIFETIME-001-9d376c1c
cao-FLEET-SESSION-LIFETIME-001-revie-1a908de6
cao-fleet-001-bravo
cao-fleet-001-bravo-cont
cao-fleet-001-finish
cao-fleet-001-fix
cao-fleet-001-fix2
cao-fleet-002-b2
cao-fleet-002-bravo
cao-fleet-002-commit
cao-fleet-002-fix
cao-mvp-claude-bravo2
fleet-gateway
```

All 19 classified PROTECTED. No sessions were stopped, killed, attached, messaged, or reused.

## PROTECTED Sessions — AFTER (19 total)

All 19 sessions remain ALIVE. Test suite creates only in-process FakeCAO sessions (no tmux/real CAO sessions created or destroyed during tests).

## Refusal Evidence (Synthetic Unowned Session)

The following synthetic session IDs were used in tests and all received `OwnershipError(403)` before any CAO call:
- `synthetic-unowned-never-launched-aabbcc` (unknown, never in artifact store)
- `synthetic-unowned-deadbeef` (injected into FakeCAO sessions, not fleet-launched)
- `synthetic-unowned-msg-ccddee` (message_worker refusal)
- `synthetic-unowned-handoff-ffeedd` (request_handoff refusal)

None of these triggered a CAO call — proven by `cao.calls` assertion in each test.

## Hard Constraints Honored
- ✅ #3533 not merged, not touched
- ✅ feat/fleet-gateway-mcp-v1 tip not pushed
- ✅ Charlie routing not started
- ✅ PLC/Ignition/COM3/credentials/networking not touched
- ✅ All 19 PROTECTED sessions ALIVE after all tests
- ✅ No real CAO sessions created or destroyed during tests (FakeCAO only)

## PR
DRAFT — see PR for do-not-merge label. Branch: fleet/FLEET-PRD-P1-FAILCLOSED-REFUSE-STOP-001
