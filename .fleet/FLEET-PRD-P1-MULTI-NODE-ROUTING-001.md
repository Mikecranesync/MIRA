# FLEET-PRD-P1-MULTI-NODE-ROUTING-001

## VERDICT

PASS - code-only multi-node Fleet Gateway routing implemented on branch
`fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001`.

Charlie launches now fail closed unless the Charlie physical node is explicitly
configured and validated. `role=charlie` never falls back to Bravo CAO, Bravo repo,
or Bravo worktree parent.

## Scope Boundary

This change is code/docs/tests only.

Physical Charlie wiring is NOT done. No installation or file changes were made on
the Charlie computer. No tunnels, networking, credentials, merge, or deployment
changes were made. PR #3533 remains HELD.

## Files Changed

- `fleet-gateway/fleet_gateway/node_config.py`
- `fleet-gateway/fleet_gateway/service.py`
- `fleet-gateway/fleet_gateway/factory.py`
- `fleet-gateway/fleet_gateway/errors.py`
- `fleet-gateway/tests/conftest.py`
- `fleet-gateway/tests/test_launch_worker.py`
- `fleet-gateway/tests/test_cao_loopback.py`
- `fleet-gateway/.env.example`
- `docs/specs/fleet-gateway-mcp.md`
- `wiki/hot.md`
- `.fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001.md`

## Behavior Proven

- Per-role `NodeConfig` carries CAO client, repo root, worktree parent, expected
  hostname, and path-prefix guard.
- Bravo may use `FLEET_GATEWAY_BRAVO_CAO_URL` or the legacy
  `FLEET_GATEWAY_CAO_URL`.
- Charlie is configured only by `FLEET_GATEWAY_CHARLIE_CAO_URL`.
- Missing Charlie config raises `NodeRoutingError` before any CAO launch.
- Charlie hostname mismatch raises `NodeRoutingError` before any CAO launch.
- Charlie repo/worktree paths outside `/Users/charlienode/...` raise
  `NodeRoutingError` before any CAO launch.
- Charlie CAO health not `ok` raises `NodeRoutingError` before any CAO launch.
- Target-node worktree provisioning uses the selected role's repo and worktree
  parent, then verifies the resulting path.
- Session follow-up calls route through the stored session role so Charlie
  sessions continue using Charlie's CAO client.

## Test Evidence

Command:

```bash
python3 -m pytest fleet-gateway/tests
```

Result:

```text
87 passed in 3.35s
```

Additional checks:

```bash
python3 -m compileall -q fleet-gateway/fleet_gateway
git diff --check
```

Result: both passed.

Note: `python3 -m ruff check fleet-gateway/fleet_gateway fleet-gateway/tests`
could not run because `ruff` is not installed in this Python environment.
