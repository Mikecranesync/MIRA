# Fleet Gateway MCP v1

Bounded HTTPS control plane: **Grok/Foreman → Fleet Gateway → private/loopback CAO**.

- Issue: [#3532](https://github.com/Mikecranesync/MIRA/issues/3532)
- Spec: [`docs/specs/fleet-gateway-mcp.md`](../docs/specs/fleet-gateway-mcp.md)
- This is **not** `mira-mcp` (product diagnostics) and **not** a Pi/PLC gateway.

## What this PR does not do

Does not merge, deploy, expose CAO, bind CAO to a public interface, touch PLC/Ignition/COM3, or change Tailscale/credentials. Public CAO exposure is a later **Mike-approved** tunnel/VPS step.

MCP JSON-RPC 2.0 lives at `POST /mcp` (initialize, notifications/initialized, tools/list, tools/call, ping). REST `GET|POST /tools/{name}` remains. Unauthenticated `/mcp` is 401. `GET /health` stays open.

## CAO adapter

When `FLEET_GATEWAY_CAO_URL` is set, the gateway uses `LoopbackCAOClient` to connect to an existing **colocated loopback cao-server** at `http://127.0.0.1:…`. The URL **must** be IPv4 `127.0.0.1` — `localhost`, `::1`, LAN addresses, and Tailscale IPs are refused by construction. Credentials in the URL are also refused.

**When unset (default):** `FakeCAO` in-process stub is used. This is the default for tests and local development without a running cao-server.

### Per-node routing (#3552)

`FLEET_GATEWAY_CAO_URL` alone resolves **one** CAO for every role — `role` is only an
agent-profile label, so `role=charlie` still lands on whichever CAO that URL names. Set a
per-role URL to make `role` select a *node*:

| Env var | Points at |
|---|---|
| `FLEET_GATEWAY_CAO_URL_BRAVO` | Bravo's own local CAO, e.g. `http://127.0.0.1:9889` |
| `FLEET_GATEWAY_CAO_URL_CHARLIE` | Charlie's CAO via an SSH `-L` forward, e.g. `http://127.0.0.1:19889` |
| `FLEET_GATEWAY_CAO_URL` | optional fallback for roles with no per-role URL |

When any per-role URL is set the gateway uses `RoutingCAOClient`: `launch_worker` routes on
`spec["role"]` and remembers which node owns the resulting session, so later session-keyed
calls (`message_worker`, `stop_worker`, …) follow it. A role that is neither mapped nor
covered by the fallback **fails closed** with `CaoConfigError` — it never silently reaches
another node's CAO.

Remote nodes stay loopback-only: a remote CAO is reached by forwarding it to a **local**
127.0.0.1 port, never by binding it to a LAN or Tailscale address. `assert_loopback_cao_url`
still refuses anything that is not literal `127.0.0.1`.

Adding a node is a contract + env change, not a code change: add the role to
`contract.ALLOWED_ROLES` and set `FLEET_GATEWAY_CAO_URL_<ROLE>`. Roles in
`contract.REJECTED_ROLES` (PLC / Ignition / specialized) remain refused.

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
