# Fleet Gateway MCP v1
**Version:** 1.1
**Last Updated:** 2026-09-04
**Owner:** Mike Harper / FactoryLM
**Issue:** [#3532](https://github.com/Mikecranesync/MIRA/issues/3532)

## Purpose
Authenticated public HTTPS control plane for FactoryLM fleet workers (Grok/Foreman → Fleet Gateway → private/loopback CAO). Nine MCP tools (v1.1 additive: legacy discover + adopt). CAO, Tailscale, LAN, and worker internals stay off the public path.

This is **not** `mira-mcp` (product diagnostics / CMMS) and **not** `factorylm/gateway` (Pi/PLC). It lives in `fleet-gateway/`.

## Scope
**IN scope**
- Bearer-authenticated tool surface (`FLEET_GATEWAY_BEARER` from env, never git)
- Nine locked tools (three read, six mutate). v1 was seven; v1.1 adds `list_legacy_sessions` + `adopt_legacy_session` without weakening ownership.
- Mutate audit log (JSONL)
- Loopback-only CAO client (`127.0.0.1`) behind an interface; FakeCAO default/stub
- Isolated-worktree launch for `bravo` | `charlie` | `alpha` on `claude` | `codex`
- Durable HANDOFF artifacts; chat is never "done"

**OUT of scope (this PR / v1)**
- Merge, deploy, production mutation
- Public exposure of CAO (tunnel/VPS is a later **Mike-approved** step)
- Specialized / PLC / Ignition / COM3 nodes
- Worktree or data deletion
- Credential, network, or Tailscale changes
- Raw push to main
- Binding CAO to any public interface

## Architecture

```
Grok / Foreman ──HTTPS + Bearer──▶ Fleet Gateway (this package)
                                      │
                                      │  loopback HTTP client only
                                      │  (127.0.0.1, never bind)
                                      ▼
                                   CAO (private)
                                      │
                                      ▼
                          isolated worktrees (bravo|charlie)
```

- **Layer:** Control plane (fleet), not product diagnostics
- **Default bind:** `127.0.0.1:8765` (override with `FLEET_GATEWAY_HOST` / `FLEET_GATEWAY_PORT`)
- **CAO:** unset `FLEET_GATEWAY_CAO_URL` → FakeCAO stub. If set, URL **must** be `http(s)://127.0.0.1…` with no credentials — connects to an existing **colocated loopback cao-server**. This package never listens as CAO.
- **Agent profile mapping:** local CAO has no `bravo`/`charlie` profiles → `bravo` maps to `developer`, `charlie` maps to `reviewer` (CAO built-ins). Provider: `claude` → `claude_code`, `codex` → `codex`.
- **Worktrees:** Gateway creates the git worktree before calling CAO and passes the real path as `working_directory`. CAO `use_worktree` is never set; Gateway worktrees are never deleted by CAO.
- **Foreman never** connects to Tailscale, CAO, LAN, or worker ports.

Public TLS termination and any CAO tunnel are **not** this PR.

## API Contract

### Auth
`Authorization: Bearer ${FLEET_GATEWAY_BEARER}`. Missing configuration, missing header, or wrong token → refuse (HTTP 401 / `AuthenticationError`). Token is never committed, never logged, never returned.

`GET /health` is the only unauthenticated route and returns `{status, service}` with no topology.

`POST /mcp` is MCP JSON-RPC 2.0 (initialize, notifications/initialized, tools/list, tools/call, ping) for Cursor remote MCP. Unauthenticated `/mcp` is 401. `tools/call` uses the request `Authorization` header (never a server-injected token). REST `/tools` and `/tools/{name}` remain.

### Tools — nine (v1.1)

| Tool | Mode | Contract |
|---|---|---|
| `fleet_status` | read | Separate fields: `node_health`, `cao_health`, `claude_readiness`, `claude_auth`, `codex_readiness`, `codex_auth`, `current_session`, `current_task`, `heartbeat`, `context_used`, `context_remaining`. Never LAN/Tailscale IPs, CAO ports, or secrets. |
| `task_status` | read | `task_id`, `node`, `provider`, `branch`, `worktree`, `commit`, `handoff`, `tests`, `type_check`, `build`, `review_verdict`, `blockers`, `claimed_commit_matches_artifact` (bool). `done` is never inferred from chat. |
| `list_legacy_sessions` | read | Required `role` in `bravo`\|`charlie`\|`alpha`. Returns sessions on that node (node, provider, local_session_id, cwd, pid/tmux, bridge_session_id, classification, adoptable). Does **not** confer ownership. Never attaches or sends keys. |
| `launch_worker` | mutate | `role` = `bravo`\|`charlie`\|`alpha` only (specialized/PLC refused). Each is a physical node with its own loopback CAO + node-local (SSH) worktree; unknown nodes fail closed, never default to Bravo (#3552). Required: `provider` `claude`\|`codex`, `task_id`, `github_ref`, `base_commit`, `acceptance_criteria`. Always isolated worktree (`isolated_worktree=true`). No shell/merge/deploy. |
| `message_worker` | mutate | `text` to one `session_id`. Requires fleet ownership (artifact); unowned IDs raise `OwnershipError` before any CAO call. |
| `request_handoff` | mutate | Write durable HANDOFF artifact; stop claiming the task. Same ownership gate as `message_worker`. |
| `request_review` | mutate | Charlie only. Independent reviewer profile with tests / type-check / inspect-files. Reviews the exact Git ref, not a Bravo summary. |
| `stop_worker` | mutate | One `session_id`. Not a node, not CAO, not worktree delete. Same ownership gate as `message_worker`. |
| `adopt_legacy_session` | mutate | Required `role` + `external_id` (Remote Control/`bridgeSessionId`, local sessionId, tmux name, or pid). Succeeds only when exactly one live session on that node uniquely matches. Writes `fleet_owned=true` artifact with node, provider, local_session_id, cwd, pid/tmux, provenance. Does **not** launch or restart. Fail-closed: 0 matches, ambiguous, wrong-node, stale, protected (Gateway/CAO/system tmux — not ordinary Claude/Codex CLIs), already-owned. |

### Audit (every mutate)
JSONL record: `timestamp`, `requester`, `tool`, `task ID`, `target node/session`, `parameters` (secrets stripped), `outcome`. Reads are not audited. Rejected mutates are audited as `rejected` / `denied`.

### Hard deny (refuse by construction)
These tools are **not registered** and `invoke()` raises `DeniedToolError`: merge, deploy, production mutation, worktree/data deletion, credentials/secrets changes, network/Tailscale changes, release signing, PLC/Ignition/COM3, CAO config/ports, unrestricted shell/root, raw push to main.

## Configuration

| Var | Required | Default | Purpose |
|---|---|---|---|
| `FLEET_GATEWAY_BEARER` | yes | — | Bearer token. Empty → all tool calls refused. |
| `FLEET_GATEWAY_CAO_URL` | no | unset (FakeCAO) | Loopback CAO base URL. Non-`127.0.0.1` refused. |
| `FLEET_GATEWAY_DATA_DIR` | no | `fleet-gateway/var` | Audit JSONL + HANDOFF/task artifacts |
| `FLEET_GATEWAY_HOST` | no | `127.0.0.1` | HTTP bind. Public bind is not this PR. |
| `FLEET_GATEWAY_PORT` | no | `8765` | HTTP bind port (not a CAO port) |
| `FLEET_GATEWAY_CLAUDE_SESSIONS_DIR` | no | `~/.claude/sessions` | Bravo-only read-only Claude session metadata dir (`<pid>.json`). Charlie/Alpha stay empty without tunnel changes. |

Example env: `fleet-gateway/.env.example` (placeholders only).

## Quality Standards
| Metric | Target |
|---|---|
| Tools | Exactly 9; deny-list absent |
| Auth tests | Unauthenticated and wrong token rejected |
| Launch | specialized rejected; required fields + isolated worktree enforced |
| Review | non-Charlie rejected; exact git ref |
| Audit | written on mutate; secrets never logged |
| CAO | loopback-only; tests use FakeCAO |

## Acceptance Criteria
1. Unauthenticated requests are rejected.
2. Specialized / PLC launch is rejected.
3. Deny-list tools are not on the surface.
4. Every mutate writes an audit record (timestamp, requester, tool, task, target, redacted params, outcome).
5. `request_review` rejects non-Charlie sessions.
6. `launch_worker` requires provider + task_id + ref + base commit + acceptance criteria + isolated worktree.
7. `fleet_status` returns the split fields (node vs CAO, Claude vs Codex, session/task, heartbeat, context).
8. `task_status` includes `claimed_commit_matches_artifact`.
9. Secrets never appear in the audit log.
10. CAO adapter refuses non-loopback URLs and does not bind.
11. `list_legacy_sessions` is read-only and does not write fleet ownership.
12. `adopt_legacy_session` fail-closes on wrong-node, ambiguous, protected, stale, and already-owned; unique Remote Control match records provenance and then `message_worker`/`stop_worker` ownership rules apply.

**Done means** a durable Git ref with tests green — not an agent saying done. Draft PR only for this change (no merge, no deploy). #3533 / #3558 stay HELD.

## Known Issues
- FastMCP is optional at runtime (`fastmcp` extra). The locked tool names live in `fleet_gateway.contract` / `mcp_api` regardless. Native `POST /mcp` JSON-RPC does not require FastMCP.
- `launch_worker` creates a real `git worktree add --detach` directory and never deletes it.
- `LoopbackCAOClient` requires `FLEET_GATEWAY_CAO_URL=http://127.0.0.1:<port>` pointing to a running colocated cao-server. Non-`127.0.0.1` URLs are refused by construction.

## Change Log
- 2026-08-31 — v1 locked contract implemented on `feat/fleet-gateway-mcp-v1` (#3532).
- 2026-08-31 — Native MCP JSON-RPC `POST /mcp` + real isolated git worktrees (still HELD).
- 2026-09-02 — Physical-node router (#3533): `bravo` | `charlie` | `alpha`, each with its own loopback CAO (9889 / 19889-tunnel / 29889-tunnel) and node-local SSH worktrees. Fail-closed on unknown nodes (closes the #3552 class). Alpha added as a third fleet node. Still HELD.
- 2026-09-04 — v1.1 SAFE-LEGACY-SESSION-ADOPTION: `list_legacy_sessions` + `adopt_legacy_session`; port ownership fail-closed (`OwnershipError` before CAO on message/stop/handoff). Does not modify #3533 / #3558 branches.
