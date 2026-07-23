# FactoryLM External AI Context Skill

FactoryLM is the governed industrial context layer. MIRA is one native client.
External AI tools such as Codex, Claude Code, future MCP clients, or scoped API
connectors should query FactoryLM through small, structured, read-only calls.

This skill is the first internal developer-facing bridge. It is not a chatbot
and does not generate troubleshooting prose. It returns JSON context that a
caller can cite or inspect before deciding what to do next.

## Location

- Library: `src/lib/external-ai/context-skill.ts`
- API route: `src/app/api/factorylm/context/route.ts`
- Tests: `src/lib/external-ai/context-skill.test.ts`
  and `src/app/api/factorylm/context/__tests__/route.test.ts`

## Tool Surface

Call `factoryLmContextSkill.call(...)` or create an injectable instance with
`createFactoryLmContextSkill(...)`.

```ts
import { factoryLmContextSkill } from "@/lib/external-ai/context-skill";

const result = await factoryLmContextSkill.call({
  tool: "get_asset_context",
  context: { tenantId },
  input: { asset_id: "filler01" },
});
```

Supported tools:

- `find_asset({ query, limit? })`
- `get_asset_context({ asset_id | assetId | uns_path })`
- `search_approved_evidence({ asset_id, query, limit?, includeDraft? })`
- `get_tag_context({ tag_or_uns_path })`
- `list_related_assets({ asset_id })`
- `get_diagnostic_context({ asset_id?, fault_code? })`
- `get_live_value({ tag_or_uns_path })`
- `search_simlab_scenarios({ query, limit? })`

## API Surface

The first API wrapper is:

```http
POST /api/factorylm/context
Content-Type: application/json
Authorization: Bearer <existing i3X API key>
```

Request:

```json
{
  "tool": "get_asset_context",
  "input": { "asset_id": "filler01" }
}
```

The route resolves tenancy with existing auth only:

1. Existing i3X bearer key via `i3x_api_keys`
2. Hub session cookie fallback for internal/developer use

It does not create a new customer API-key system. It delegates to the same
internal skill dispatcher, so unsupported or write-like tool names return the
standard refusal envelope.

Every response uses a consistent envelope:

```json
{
  "ok": true,
  "found": true,
  "tool": "get_asset_context",
  "data": {},
  "evidence": [],
  "confidence": "verified",
  "approvalState": "verified"
}
```

When nothing is found, `found` is `false` and `notFoundReason` is set. Unknown
or unsafe tool names return `ok: false` with `refusedReason`.

## Reused FactoryLM/MIRA Surfaces

- Tenant boundaries use `withTenantContext`, which drops into the app role and
  sets tenant RLS variables.
- Asset/entity reads use `kg_entities` and require `approval_state = 'verified'`.
- Related assets reuse the i3X relationship helpers in `src/lib/i3x/data-access.ts`.
- Live values are gated through `approved_tags` before reading
  `live_signal_cache`.
- Evidence search reads `knowledge_entries` under the asset namespace subtree
  and defaults to `verified = true`.
- SimLab search reads deterministic scenario YAML fixtures and marks them
  `internal`.

## Safety Rules

- Read-only only.
- No PLC writes.
- No tag writes.
- No direct SQL exposed to callers.
- No raw database dumping.
- No unapproved documents by default.
- Tenant/site boundaries must be supplied by the trusted caller context.
- Draft evidence is only returned when the caller explicitly passes
  `includeDraft: true`; those records remain marked `draft`.

## Example Usage By External AI Tools

Before answering "What is this asset?":

1. Call `find_asset({ query })`.
2. If a single high-confidence candidate returns, call `get_asset_context`.
3. Use `evidence` and `approvalState` fields in the final answer.
4. If `found: false`, ask the operator for a better asset, tag, or UNS path.

Before answering "What tags belong to it?":

1. Call `get_asset_context({ asset_id })`.
2. Read `data.approvedTags`.
3. Never invent tags that are not returned.

Before answering "What evidence supports this mapping?":

1. Call `search_approved_evidence({ asset_id, query })`.
2. Cite only returned evidence references.

Before answering "What is the live value?":

1. Call `get_live_value({ tag_or_uns_path })`.
2. If the result is not found, report that no approved live-read path exists.

## Follow-Up Backlog

- Add audit logging for tool calls if/when a shared tool-call audit helper exists.
- Add a FastMCP wrapper that delegates to this library rather than duplicating SQL.
- Add scoped customer connector/API-key support on top of the i3X key model.
- Add richer diagnostic context by reusing or refactoring
  `maintenanceContext` without exposing write-capable KG dispatch operations.
- Add pagination/cursors for large namespace searches.
