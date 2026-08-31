# Fleet Gateway MCP v1

Bounded HTTPS control plane: **Grok/Foreman → Fleet Gateway → private/loopback CAO**.

- Issue: [#3532](https://github.com/Mikecranesync/MIRA/issues/3532)
- Spec: [`docs/specs/fleet-gateway-mcp.md`](../docs/specs/fleet-gateway-mcp.md)
- This is **not** `mira-mcp` (product diagnostics) and **not** a Pi/PLC gateway.

## What this PR does not do

Does not merge, deploy, expose CAO, bind CAO to a public interface, touch PLC/Ignition/COM3, or change Tailscale/credentials. Public CAO exposure is a later **Mike-approved** tunnel/VPS step.

MCP JSON-RPC 2.0 lives at `POST /mcp` (initialize, notifications/initialized, tools/list, tools/call, ping). REST `GET|POST /tools/{name}` remains. Unauthenticated `/mcp` is 401. `GET /health` stays open.

## Run (local / loopback)

```bash
# Copy .env.example to .env and set FLEET_GATEWAY_BEARER (never git, never echo).
./run-local.sh
```

Or:

```bash
set -a && source .env && set +a
PYTHONPATH=fleet-gateway python3 -m fleet_gateway   # from repo root
```

Defaults to `127.0.0.1:8765`. CAO is FakeCAO unless `FLEET_GATEWAY_CAO_URL=http://127.0.0.1:…`.
`launch_worker` creates a real git worktree under `/Users/bravonode/Mira-worktrees/fleet-e2e-<task>-<session>` from `/Users/bravonode/Mira` at `base_commit`. Worktrees are never deleted by this gateway.

## Tests

```bash
pytest fleet-gateway/tests -q
```
