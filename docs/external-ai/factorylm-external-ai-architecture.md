# FactoryLM External AI Architecture

Date: 2026-06-25

## Principle

FactoryLM is the governed industrial context layer. MIRA is one native client.
External AI tools should query FactoryLM context through safe, structured,
read-only calls. They should not duplicate MIRA, become a chatbot, or infer
factory facts from model memory.

## Phases

### Phase 1: Local FactoryLM Codex Skill

Status: started.

Repo skill:

- `.claude/skills/factorylm-context-bridge/SKILL.md`

Purpose:

- Teach Codex/Claude Code how to use FactoryLM context safely.
- Keep future coding sessions from adding raw SQL, write tools, or duplicate
  MIRA chat flows.

### Phase 2: Internal Read-Only FactoryLM Context API

Status: started.

Files:

- `mira-hub/src/lib/external-ai/context-skill.ts`
- `mira-hub/src/app/api/factorylm/context/route.ts`
- `mira-hub/docs/developer/factorylm-external-ai-skill.md`

Auth:

- Existing i3X bearer key first.
- Hub session fallback for internal/dev usage.
- No new customer API-key system yet.

Endpoint:

```http
POST /api/factorylm/context
Content-Type: application/json
Authorization: Bearer <existing i3X key>
```

Request:

```json
{
  "tool": "get_asset_context",
  "input": { "asset_id": "filler01" }
}
```

### Phase 3: Local MCP Server Wrapping The API

Status: planned.

Shape:

- Local stdio or streamable HTTP MCP server.
- Calls `/api/factorylm/context`.
- Exposes only read-only tools.
- Returns structured content and matching JSON text content for broad MCP
  compatibility.

Tool set:

- `find_asset`
- `get_asset_context`
- `search_approved_evidence`
- `get_tag_context`
- `list_related_assets`
- `get_diagnostic_context`
- `search_simlab_scenarios`
- `get_live_value`

Compatibility tools for ChatGPT/deep research later:

- `search`
- `fetch`

### Phase 4: Codex Plugin Bundling Skill And MCP Config

Status: start private/internal.

Initial plugin should bundle only the skill until the MCP server exists. Once
Phase 3 is real, add `mcpServers` to `.codex-plugin/plugin.json`.

Private plugin structure:

```text
plugins/factorylm-context/
  .codex-plugin/plugin.json
  skills/factorylm-context-bridge/SKILL.md
  skills/factorylm-context-bridge/references/tool-selection.md
```

Later:

```text
plugins/factorylm-context/.mcp.json
```

### Phase 5: Remote MCP Server For ChatGPT Custom Connector/App

Status: planned.

Requirements:

- HTTPS `/mcp` endpoint.
- OAuth 2.1 / MCP authorization spec support for customer data.
- Tenant/site scopes.
- Tool schemas and output schemas.
- `search`/`fetch` compatibility if targeting company knowledge/deep research.
- Optional ChatGPT UI only after data-only mode works.

### Phase 6: Customer-Scoped API Keys/OAuth, Audit Logs, Admin Controls

Status: planned.

Required before customer rollout:

- Customer-managed connector enable/disable.
- Scoped OAuth or API-key issuance.
- Scope model: tenant, site, asset namespace subtree, live value permission,
  draft/internal permission.
- Audit log for each tool call.
- Admin visibility into connected clients.
- Revocation and rotation.
- Rate limits.

### Phase 7: Publishable Plugin/App Package

Status: later.

Do not assume public acceptance. Build so it is publishable:

- Accurate metadata.
- Privacy policy and terms URLs.
- Screenshots if UI exists.
- Test prompts/responses.
- Security review materials.
- Tenant-boundary test evidence.

## Response Contract

Every FactoryLM external AI response should include:

- `ok`
- `found`
- `tool`
- `data`
- `evidence`
- `confidence`
- `approvalState`
- `notFoundReason` or `refusedReason` where relevant

Data should include, where available:

- asset ID
- asset name
- UNS path
- tenant/site context
- approval status
- citations/source references
- related tags
- related documents
- stale/draft/unapproved warnings

## Security Rules

- Read-only only.
- No PLC writes.
- No tag writes.
- No control actions.
- No raw SQL exposed.
- No database dumps.
- No unapproved document leakage unless explicitly marked internal/draft.
- No cross-tenant leakage.
- No hidden LLM fallback.
- No hallucinated fields.
- Evidence missing must be explicit.

## Immediate Backlog

1. Package current skill into `plugins/factorylm-context`.
2. Add local plugin validation to CI or a developer command.
3. Build a local MCP server that wraps `/api/factorylm/context`.
4. Add MCP tests for read-only tool schema and refusal behavior.
5. Add audit helper/table for external AI tool calls.
6. Add `search`/`fetch` compatibility tools over approved evidence.
7. Design OAuth scopes for ChatGPT remote MCP.
8. Add admin controls for connected external AI clients.
9. Add security review checklist and prompt-injection tests.
