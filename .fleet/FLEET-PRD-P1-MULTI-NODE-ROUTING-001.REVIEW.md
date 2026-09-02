# FLEET-PRD-P1-MULTI-NODE-ROUTING-001 Independent Review

## VERDICT

PASS

Reviewed exact SHA: `057def3c191ee1c4840df5c14fda7ed2499891ef`
Reviewed branch: `fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001`
Review machine hostname: `FactoryLM-Bravo.local`
Review worktree path: `/Users/bravonode/Mira-worktrees/fleet-e2e-FLEET-PRD-P1-MULTI-NODE-ROUTING-001-REVIEW-65d188be0aee`
Review date: 2026-09-02

## Findings

BLOCKING: none.

IMPORTANT: none.

NIT: none.

## Review Scope

I re-read the code and tests directly at the reviewed SHA. I did not rely on the implementer's summary.

Focused files reviewed:

- `fleet-gateway/fleet_gateway/node_config.py`
- `fleet-gateway/fleet_gateway/factory.py`
- `fleet-gateway/fleet_gateway/service.py`
- `fleet-gateway/fleet_gateway/errors.py`
- `fleet-gateway/fleet_gateway/worktree.py`
- `fleet-gateway/fleet_gateway/cao.py`
- `fleet-gateway/tests/conftest.py`
- `fleet-gateway/tests/test_launch_worker.py`
- `fleet-gateway/tests/test_cao_loopback.py`
- `docs/specs/fleet-gateway-mcp.md`
- `fleet-gateway/.env.example`
- `.fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001.md`

## Evidence

1. Distinct Bravo vs Charlie `NodeConfig`: PASS.
   `node_config.py` defines separate Bravo and Charlie defaults for CAO client, repo, worktree parent, expected hostname, and expected path prefix. `factory.py` keeps legacy `FLEET_GATEWAY_CAO_URL` as Bravo-only and only creates Charlie config from `FLEET_GATEWAY_CHARLIE_CAO_URL`.

2. Charlie fail-closed behavior: PASS.
   `service._node_config_for_launch()` raises `NodeRoutingError` when `role=charlie` lacks Charlie config, with explicit "refusing Bravo fallback" text. `validate_launch_target()` refuses Charlie launches on hostname mismatch, repo/worktree path prefix mismatch, Charlie CAO health exception, or Charlie CAO health not `ok`.

3. No Bravo fallback for Charlie: PASS.
   Charlie launch selects the Charlie config before validation/provisioning. Missing Charlie config, invalid Charlie identity, bad Charlie paths, and unhealthy Charlie CAO all raise before `launch_worker` is called on any CAO client.

4. Target-node worktree provisioning and verification: PASS.
   `service._launch_worker()` provisions through `config.worktrees()` using the selected role's repo and worktree parent, passes the resulting `working_directory` to that role's CAO, and then records the returned session role for follow-up routing. `verify_worktree_path()` refuses a worktree outside the selected parent and adds the `/Users/charlienode` prefix guard for Charlie.

5. Tests prove the fail-closed cases: PASS.
   `test_launch_worker.py` covers missing Charlie config, wrong hostname, Bravo-style paths, unhealthy Charlie CAO, and target worktree parent separation. `test_cao_loopback.py` covers legacy CAO URL as Bravo-only and Charlie-specific CAO URL behavior.

6. No merge/deploy/tunnel/credential/Charlie-machine changes in reviewed commit: PASS.
   The reviewed commit touches Fleet Gateway code, tests, docs, `.env.example` placeholders, `.fleet` proof docs, and `wiki/hot.md`. It does not change deployment workflows, tunnel setup, real credentials, networking configuration, or files on the physical Charlie machine. I did not merge, deploy, change networking, change credentials, or install anything on Charlie.

7. #3533 not merged by this work: PASS.
   `gh pr view 3533` reports state `OPEN`, `isDraft=true`, `mergeCommit=null`, `mergedAt=null`. `git merge-base --is-ancestor 057def3c191ee1c4840df5c14fda7ed2499891ef origin/main` returned `1`, so the reviewed SHA is not on `origin/main`.

## Test Re-run

Command:

```bash
python3 -m pytest fleet-gateway/tests
```

Result:

```text
collected 87 items
87 passed in 3.52s
```

Environment:

```text
platform darwin -- Python 3.14.4, pytest-9.0.2, pluggy-1.6.0
rootdir: /Users/bravonode/Mira-worktrees/fleet-e2e-FLEET-PRD-P1-MULTI-NODE-ROUTING-001-REVIEW-65d188be0aee
```

## Boundary

This is an independent code review on Bravo only. Physical Charlie wiring remains blocked. Do not merge until Mike says.
