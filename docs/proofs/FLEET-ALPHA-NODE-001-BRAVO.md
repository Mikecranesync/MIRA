# FLEET-ALPHA-NODE-001-BRAVO — Alpha as Gateway Node 3

**Authored by:** Bravo (Charlie Reviewer session)
**Base SHA:** 17f9a391a (live Gateway process)
**Reference:** a5dc67cac (Charlie's 6-file delta, used as read-only spec — NOT merged)
**Worktree:** fleet-e2e-FLEET-ALPHA-NODE-001-BRAVO-1814b07ab58f
**Date:** 2026-09-02

---

## Files Changed (+delta re-applied on this isolated worktree)

| File | Change |
|---|---|
| `fleet-gateway/fleet_gateway/contract.py` | `alpha` removed from `REJECTED_ROLES`; added to `ALLOWED_ROLES` (now `{bravo, charlie, alpha}`) |
| `fleet-gateway/fleet_gateway/factory.py` | `alpha_worktrees_from_env` imported; `DEFAULT_ALPHA_CAO_URL = http://127.0.0.1:29889`; `alpha` `NodeTarget` wired into `router_from_env`; docstring updated to "Three physical nodes" |
| `fleet-gateway/fleet_gateway/worktree.py` | `ALPHA_REPO`, `ALPHA_PARENT`, `ALPHA_SSH_HOST` constants; `alpha_worktrees_from_env()` provisioner |
| `fleet-gateway/fleet_gateway/service.py` | Error messages updated: "non-fleet" + dynamic `sorted(ALLOWED_ROLES)` listing |
| `fleet-gateway/tests/test_node_routing.py` | Imports `ALPHA_REPO`, `ALPHA_PARENT`, `alpha_worktrees_from_env`; `_three_node_service()` helper; 3 new regression tests |
| `docs/proofs/FLEET-ALPHA-NODE-001-BRAVO.md` | This file |

## Test Results

```
93 passed, 1 warning in 3.95s
```

All pre-existing 90 tests green. 3 new Alpha regression tests added:

- `test_alpha_launch_selects_alpha_cao` — Alpha launch goes to Alpha CAO only; Bravo + Charlie CAOs receive zero calls.
- `test_alpha_worktree_is_alpha_local_over_ssh` — Default paths are `/Users/factorylm/MIRA` + `/Users/factorylm/MIRA-worktrees`; `ssh_host=alpha`; every filesystem op goes over SSH; no local `/Users/factorylm` path touched.
- `test_alpha_followup_routes_to_alpha` — A follow-up `message_worker` to an Alpha session routes back to Alpha CAO; Bravo + Charlie messages remain empty.

## Alpha mkdir Proof

```
drwxr-xr-x  2 factorylm  staff  64 Sep  2 23:08 /Users/factorylm/MIRA-worktrees
```

Created via: `ssh alpha "mkdir -p /Users/factorylm/MIRA-worktrees"` — directory only, no CAO reconfiguration.

## Tunnel Port

`com.factorylm.alpha-cao-tunnel` LaunchAgent on Bravo listens on `127.0.0.1:29889` (SSH tunnel → Alpha `127.0.0.1:9889`).

```
ssh  27545 bravonode  4u  IPv4  TCP localhost:29889 (LISTEN)
```

Charlie uses `19889`. No port conflict; tunnel pre-existed and was not recreated.

## Fail-Closed Behavior

- `FLEET_GATEWAY_CAO_URL_ALPHA` not set in live `.env` → `_cao_for_node("FLEET_GATEWAY_CAO_URL_ALPHA")` returns `FakeCAO()`. Real Alpha work requires the env var to be set explicitly — the Gateway never silently falls back to Bravo or Charlie.
- `alpha.repo` (`/Users/factorylm/MIRA`) is checked via SSH before any worktree operation; if the repo is absent or the tunnel is dead, `WorktreeProvisioner.create()` raises `ContractViolation` — no Bravo/Charlie path is ever substituted.
- `role=alpha` with a dead CAO HTTP-fails at the CAO call site; it does not silently route elsewhere.

## What the Live Gateway Must NOT Do Until Charlie Reviews

1. **Do not restart the live Gateway** (`17f9a391a` is still running; this commit is on an isolated worktree/branch only).
2. **Do not set `FLEET_GATEWAY_CAO_URL_ALPHA`** in the live `.env` until Charlie's adversarial review passes.
3. **Do not merge** this branch to `main`. PR #3533 stays HELD.
4. **Do not activate this worktree** as the running process; it is a reviewable artifact only.

## Session Closeout

```
Status: GREEN
Owned slice: FLEET-ALPHA-NODE-001 — Alpha as fleet node 3
Worktree: fleet-e2e-FLEET-ALPHA-NODE-001-BRAVO-1814b07ab58f
Branch: HEAD (isolated worktree, not on main)
Base SHA: 17f9a391a
HEAD SHA: (see git log after commit)
Changes: 6 files — contract/factory/worktree/service/tests/proof
Validation/tests: 93 passed
Adversarial review: PENDING (Charlie)
Unresolved findings: none yet
Rollback: revert this commit; live Gateway at 17f9a391a is unaffected
Collision check: #3533 HELD; this branch is isolated; no push to main
Next unclaimed slice: Charlie adversarial review of this commit
Authorization to begin next slice: NO — human gate required
Human action required: Foreman or Mike triggers Charlie review gate
```
