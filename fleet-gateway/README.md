# Fleet Gateway MCP v1

Bounded HTTPS control plane: **Grok/Foreman → Fleet Gateway → private/loopback CAO**.

v1.1 adds read-only `list_legacy_sessions` and fail-closed `adopt_legacy_session` (no launch/restart). Ownership gates: `message_worker` and `stop_worker` allow any fleet-created session (including superseded attempts), while `request_handoff` requires the LIVE session; all fail-closed. PID is display-only (not an identity token).

- Issue: [#3532](https://github.com/Mikecranesync/MIRA/issues/3532)
- Spec: [`docs/specs/fleet-gateway-mcp.md`](../docs/specs/fleet-gateway-mcp.md)
- This is **not** `mira-mcp` (product diagnostics) and **not** a Pi/PLC gateway.

## What this PR does not do

Does not merge, deploy, expose CAO, bind CAO to a public interface, touch PLC/Ignition/COM3, or change Tailscale/credentials. Public CAO exposure is a later **Mike-approved** tunnel/VPS step.

MCP JSON-RPC 2.0 lives at `POST /mcp` (initialize, notifications/initialized, tools/list, tools/call, ping). REST `GET|POST /tools/{name}` remains. Unauthenticated `/mcp` is 401. `GET /health` stays open.

## CAO adapter

When `FLEET_GATEWAY_CAO_URL` is set, the gateway uses `LoopbackCAOClient` to connect to an existing **colocated loopback cao-server** at `http://127.0.0.1:…`. The URL **must** be IPv4 `127.0.0.1` — `localhost`, `::1`, LAN addresses, and Tailscale IPs are refused by construction. Credentials in the URL are also refused.

**When unset (default):** `FakeCAO` in-process stub is used. This is the default for tests and local development without a running cao-server.

### Agent profile mapping

Local CAO has no `bravo` or `charlie` profiles. The Gateway maps to CAO built-in profiles:

| Gateway role | CAO `agent_profile` |
|---|---|
| `bravo` | `developer` |
| `charlie` | `reviewer` |

Provider mapping: `claude` → `claude_code`, `codex` → `codex`.

### Worktree management

The Gateway creates the git worktree **before** calling CAO and passes the real path as `working_directory`. CAO's `use_worktree` is never set — Gateway worktrees are never deleted by CAO.

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

Defaults to `127.0.0.1:8765`. CAO is FakeCAO unless `FLEET_GATEWAY_CAO_URL=http://127.0.0.1:…` (loopback only).
`launch_worker` creates a real git worktree under `/Users/bravonode/Mira-worktrees/fleet-e2e-<task>-<session>` from `/Users/bravonode/Mira` at `base_commit`. Worktrees are never deleted by this gateway.

## Tests

```bash
PYTHONPATH=fleet-gateway python3 -m pytest fleet-gateway/tests -q --no-header
```
