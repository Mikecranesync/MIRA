# MCP API

MIRA exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents — Claude, GPT, in-house orchestrators — can read and write your maintenance graph natively, without hand-rolling REST calls. Every `mira_*` tool is a thin wrapper over the same REST handlers described in this reference. The same API key, the same tenant isolation, the same RLS, the same rate limits.

Use the MCP surface when you are building an agent. Use the REST surface when you are building an application. Both surfaces are equivalent.

---

## Connection

```
https://mcp.factorylm.com
```

Authentication uses the same bearer token as the REST API:

```http
Authorization: Bearer mira_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

The MCP server resolves your tenant from the key and injects `app.tenant_id` on every database call. You never pass a tenant ID explicitly — the key is the tenant scope.

### Configuring the server in an MCP client

The block below registers MIRA as an MCP server in any client that follows the MCP JSON configuration convention (Claude Desktop, custom agent harnesses, etc.):

```json
{
  "mcpServers": {
    "mira": {
      "url": "https://mcp.factorylm.com",
      "headers": {
        "Authorization": "Bearer mira_live_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Replace the key value with the one generated at `/hub/admin/api-keys`. Sandbox keys (`mira_test_`) work the same way and are scoped to the sandbox tenant.

---

## Tool reference

Tools are grouped by domain. Every tool maps 1:1 to a REST endpoint — if you need the full request/response shape, follow the link in the "REST equivalent" column.

### Assets

| Tool | Purpose | Key args | REST equivalent |
|---|---|---|---|
| `mira_list_assets` | List assets in the tenant hierarchy | `site_id`, `type`, `criticality`, `search`, `limit`, `cursor` | `GET /api/v1/assets` |
| `mira_get_asset` | Get a single asset plus its recent work orders and child components | `id` (uuid or tag) | `GET /api/v1/assets/{id}` |
| `mira_create_asset` | Create a new asset or component node | `name`, `manufacturer`, `tag?`, `model?`, `parent_asset_id?`, `criticality?`, `custom_fields?`, `external_id?` | `POST /api/v1/assets` |

`mira_get_asset` returns the asset object enriched with `components` (direct children) and `recent_work_orders` (last five, by updated date) so an agent can orient itself in one call.

`mira_create_asset` accepts an `external_id` for idempotent upsert from customer systems — safe to call repeatedly with the same value.

### Work Orders

| Tool | Purpose | Key args | REST equivalent |
|---|---|---|---|
| `mira_list_work_orders` | List work orders, optionally filtered | `asset_id`, `status`, `priority`, `type`, `assigned_to`, `limit`, `cursor` | `GET /api/v1/work-orders` |
| `mira_create_work_order` | Open a new corrective or preventive work order | `asset_id`, `title`, `priority`, `type`, `fault_description?`, `assigned_to?`, `due_date?`, `external_id?` | `POST /api/v1/work-orders` |
| `mira_transition_work_order` | Move a work order through its lifecycle | `id`, `status` (`in_progress`\|`on_hold`\|`closed`), `resolution?`, `completion_notes?` | `PATCH /api/v1/work-orders/{id}` |

`mira_transition_work_order` enforces the same state-machine rules as the REST `PATCH`. Invalid transitions return `409` with an `error` string naming the violation.

### Knowledge and Diagnostics

| Tool | Purpose | Key args | REST equivalent |
|---|---|---|---|
| `mira_search_knowledge` | Full-text + BM25 search over the tenant knowledge base and the shared OEM corpus | `q`, `asset_id?`, `manufacturer?`, `limit?` | `GET /api/v1/knowledge/search` |
| `mira_diagnose` | Natural-language diagnostic question answered against live tenant data | `query`, `asset_id?`, `include_sources?`, `stream?` | `POST /api/v1/chat` |
| `mira_recall_fault_code` | Look up a fault code in the knowledge base and return matching procedures | `code`, `manufacturer?`, `model?` | `GET /api/v1/knowledge/search?q={code}&...` |

`mira_diagnose` is the headline tool. It routes the query through the same Groq → Cerebras → Gemini cascade used by the Slack and Telegram bots, grounded against the tenant's assets, work-order history, fault events, and uploaded manuals. Set `include_sources: true` to get cited evidence alongside the answer.

`mira_recall_fault_code` is a convenience wrapper: it constructs the search query for a specific fault code and returns the top matching procedures. Use it when an agent has extracted a fault code from a PLC tag or alarm event and needs the remediation steps without writing the search query from scratch.

### Ingest

| Tool | Purpose | Key args | REST equivalent |
|---|---|---|---|
| `mira_ingest_document` | Upload a PDF, image, or drawing for parsing and indexing | `file` (MCP file primitive), `asset_id?`, `kind` (`manual`\|`drawing`\|`photo`\|`nameplate`\|`other`), `title?`, `external_id?` | `POST /api/v1/ingest/documents` |
| `mira_ingest_timeseries` | Push a batch of UNS-compatible tag values | `tags` (array of `{path, value, quality, timestamp, unit?}`, max 500) | `POST /api/v1/ingest/timeseries` |

`mira_ingest_document` returns immediately with `status: "queued"`. Poll `GET /api/v1/ingest/jobs/{id}` until `status` reaches `indexed` before querying against the content (see [Ingest API](./ingest.md)).

`mira_ingest_timeseries` accepts the UNS VQT shape: `path` is a slash-separated namespace path (`factorylm/site/area/asset/signal`), `quality` is `good | bad | uncertain`. Up to 500 tag values per call; returns `{ "accepted": N, "rejected": M }` with a `rejected_rows` array on partial failures.

### Namespace

| Tool | Purpose | Key args | REST equivalent |
|---|---|---|---|
| `mira_resolve_uns_path` | Resolve a free-text asset reference (name, tag, model string) to a canonical UNS path | `query`, `site_id?` | `GET /api/v1/assets?search={query}` + resolver logic |
| `mira_list_proposals` | List pending AI suggestions (`ai_suggestions`: new entities, KG edges, doc links, fault codes…) | `status?` (`pending`\|`accepted`\|`rejected`), `type?`, `limit?`, `cursor?` | `GET /api/v1/kg/proposals` |

`mira_resolve_uns_path` is the agent-facing entry point to the UNS confirmation gate. Before an agent begins troubleshooting it should call this tool with the technician's free-text reference and confirm the returned path with the user. Do not skip this step on chat surfaces — see `.claude/rules/uns-confirmation-gate.md`.

`mira_list_proposals` exposes the AI proposal queue. Proposals are always in `pending` status on arrival; they are **never auto-approved**. Promotion to `approved` or `rejected` requires an admin action through the Hub UI or the Hub REST surface. Agents may read proposals and surface them to administrators, but must not write `status` directly. See [Knowledge Graph](./knowledge-graph.md) for the full approval model.

---

## Worked example

This example shows an agent configuring MIRA and running a diagnostic session. The agent uses `mira_diagnose` to answer a technician question, then calls `mira_search_knowledge` to surface the supporting procedure.

**Step 1 — register the server** (one-time, in the agent's MCP config):

```json
{
  "mcpServers": {
    "mira": {
      "url": "https://mcp.factorylm.com",
      "headers": { "Authorization": "Bearer mira_live_xxxxxxxxxxxxxxxxxxxxxxxx" }
    }
  }
}
```

**Step 2 — resolve the asset** (required before troubleshooting on a chat surface):

```python
result = await mira.mira_resolve_uns_path(query="PUMP-0042")
# → { "uns_path": "factorylm/northplant/bay7/PUMP-0042",
#     "asset_id": "uuid-...", "confidence": "high" }
```

**Step 3 — run the diagnostic**:

```python
answer = await mira.mira_diagnose(
    query="Why is PUMP-0042 cavitating on startup?",
    asset_id="uuid-...",
    include_sources=True,
)
# → {
#     "answer": "Likely causes: (1) air ingestion on suction side — your E-1042 fault ...",
#     "sources": [
#       { "type": "knowledge", "title": "Grundfos CR cavitation guide", "score": 0.91 },
#       { "type": "fault",     "code": "E-1042", "timestamp": "2026-05-11T14:30:00Z" },
#       { "type": "work_order","number": "WO-2024-0142" }
#     ],
#     "latency_ms": 1724
#   }
```

**Step 4 — pull the procedure** for the top knowledge hit:

```python
chunks = await mira.mira_search_knowledge(
    q="cavitation suction pressure NPSH CR series",
    manufacturer="Grundfos",
    limit=5,
)
# → { "items": [ { "content": "When suction pressure drops below NPSH ...", "score": 0.87 } ] }
```

---

## Auth, tenancy, and quotas

The MCP surface shares the REST surface's auth model exactly:

- **Same key prefix.** `mira_live_` for production, `mira_test_` for sandbox. Keys are generated and rotated at `/hub/admin/api-keys`.
- **Tenant-scoped.** Every tool call sees only the data for the tenant the key belongs to. Cross-tenant reads are not possible.
- **RLS-enforced.** The MCP server uses the same `withTenantContext` wrapper as the REST routes. No tool can bypass row-level security.
- **Same rate limits.** Tool calls count against the same per-tier quota as REST calls. The `X-RateLimit-*` headers are returned on the underlying HTTP responses; the MCP server surfaces `429` errors with a `retry_after` value when the limit is exceeded.
- **Same audit log.** Every tool invocation is written to `api_v1_audit_log` with the tool name as the `path` field.

See [API Reference — README](./README.md) for the full tier table and error format.

---

## Write rules

All write tools respect the same approval and RLS rules as the REST surface:

- Knowledge graph proposals created via `mira_ingest_document` or agent-generated ingest are always written with `status = proposed`. They are never auto-verified. An admin must approve them in the Hub before they influence diagnostic answers.
- Work order state transitions follow the same state machine as the REST `PATCH`. An agent cannot skip states.
- Tag values pushed via `mira_ingest_timeseries` are stored as-is; they do not create or modify asset records. Wire to an existing asset path or the values will be stored without an asset anchor.

For the full knowledge graph approval model — including what `proposed`, `verified`, and `needs_review` mean and who can promote them — see [Knowledge Graph](./knowledge-graph.md).
