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

### Agent profile mapping

Local CAO has no `bravo` or `charlie` profiles. The Gateway maps to CAO built-in profiles:

| Gateway role | CAO `agent_profile` |
|---|---|
| `bravo` | `developer` |
| `charlie` | `reviewer` |

Provider mapping: `claude` → `claude_code`, `codex` → `codex`.

### Worktree management

The Gateway creates the git worktree **before** calling CAO and passes the real path as `working_directory`. CAO's `use_worktree` is never set — Gateway worktrees are never deleted by CAO.

**Fetch before add:** When a remote node (Charlie, Alpha) is asked to provision a worktree at a `base_commit` SHA that the node's clone has not yet fetched, `WorktreeProvisioner._ensure_commit()` fetches the commit before calling `git worktree add`. The fetch tries in order: the specific SHA (GitHub serves reachable SHAs by id), then the provided `ref` branch/tag if given. Both fetches are scoped (--no-tags, 120s wall timeout, no --depth/--filter) because the worktree needs full history for `git diff <base>..HEAD` during code review. If the commit remains unreachable after all bounded attempts, `create()` raises `ContractViolation("base_commit is not reachable after fetch")` with a distinct error message so operators can diagnose fetch failures vs. disk failures.

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
