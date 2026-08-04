# FactoryLM Codex Plugin And ChatGPT MCP Research

Date: 2026-06-25

Status: private/internal research note. This is the decision record for moving
from the local FactoryLM context skill toward a Codex plugin and later a
ChatGPT MCP app/connector.

## Official Sources Checked

- OpenAI Codex skills: `https://developers.openai.com/codex/skills`
- OpenAI Codex plugins overview: `https://developers.openai.com/codex/plugins`
- OpenAI Codex plugin authoring: `https://developers.openai.com/codex/plugins/build`
- OpenAI Codex MCP configuration: `https://developers.openai.com/codex/mcp`
- OpenAI Apps SDK quickstart: `https://developers.openai.com/apps-sdk/quickstart`
- OpenAI Apps SDK MCP server guide: `https://developers.openai.com/apps-sdk/build/mcp-server`
- OpenAI Apps SDK connect from ChatGPT: `https://developers.openai.com/apps-sdk/deploy/connect-chatgpt`
- OpenAI Apps SDK authentication: `https://developers.openai.com/apps-sdk/build/auth`
- OpenAI Apps SDK security/privacy: `https://developers.openai.com/apps-sdk/guides/security-privacy`
- OpenAI remote MCP guide for ChatGPT/API integrations: `https://developers.openai.com/api/docs/mcp`

## 1. Skill Vs Plugin Vs MCP Server Vs ChatGPT Custom MCP App

**Codex skill:** a local or bundled workflow made of `SKILL.md` plus optional
references/scripts/assets. Codex loads skill metadata first and only reads the
full instructions when triggered. Skills are best for proving repeatable agent
behavior, like "query FactoryLM context before answering."

**Codex plugin:** an installable distribution unit for Codex. OpenAI documents
plugins as bundles that can contain skills, app integrations, and MCP servers.
Use a plugin when the workflow needs to be shared, installed, bundled with MCP
configuration, or presented as a stable package.

**MCP server:** a service that exposes tools and context over the Model Context
Protocol. For Codex, MCP servers can be stdio or streamable HTTP, and Codex can
configure bearer-token or OAuth auth for HTTP servers. For ChatGPT Apps, MCP is
the required backend protocol: the server lists tools, handles tool calls,
returns structured content, and may point to optional UI resources.

**ChatGPT custom MCP app/connector:** current OpenAI docs use "apps" for the
ChatGPT product surface, with older "connector" terminology still relevant for
data-only apps. A ChatGPT app needs a remote HTTPS MCP server. If no UI is
needed, it can be a data-only app exposing tools; if UI is needed, it can also
serve a widget resource rendered inside ChatGPT.

## 2. What Files/Config Does A Codex Plugin Require?

Minimum plugin structure:

```text
factorylm-context/
  .codex-plugin/
    plugin.json
  skills/
    factorylm-context-bridge/
      SKILL.md
```

Required manifest path:

```text
.codex-plugin/plugin.json
```

Minimum manifest fields from the OpenAI plugin docs:

```json
{
  "name": "factorylm-context",
  "version": "0.1.0",
  "description": "Read-only FactoryLM context access for external AI tools.",
  "skills": "./skills/"
}
```

For usable presentation and validation, include author/interface metadata. MCP
configuration can be a sibling `.mcp.json` and referenced by `mcpServers`, but
only after an actual MCP server exists.

## 3. Can A Codex Plugin Bundle A Skill And MCP Server Config?

Yes. OpenAI's Codex docs state that plugins can bundle skills and may also
bundle MCP server configuration. Codex MCP docs also describe plugin-provided
MCP servers controlled through user `config.toml` under `plugins.*.mcp_servers`.

For FactoryLM, the safe order is:

1. Bundle the proven skill now.
2. Add local MCP config only after a working MCP server exists.
3. Add remote MCP config only after HTTPS auth, tenant scope, and audit logging
   are implemented.

## 4. What Would FactoryLM Need To Expose Through MCP?

The MCP server should wrap the internal FactoryLM context API, not database
tables. Initial tools should mirror the current context skill:

- `find_asset(query)`
- `get_asset_context(asset_id)`
- `search_approved_evidence(asset_id, query)`
- `get_tag_context(tag_or_uns_path)`
- `list_related_assets(asset_id)`
- `get_diagnostic_context(asset_id?, fault_code?)`
- `search_simlab_scenarios(query)`
- `get_live_value(tag_or_uns_path)` only through approved live-read paths

For ChatGPT company knowledge/deep research compatibility, OpenAI's remote MCP
guide also expects read-only `search` and `fetch` tools with structured result
objects. FactoryLM should add those as a compatibility layer over approved
evidence and asset/document context.

## 5. What Is Required For A ChatGPT Custom MCP Connector/App?

The ChatGPT-facing version requires:

- A remote HTTPS MCP endpoint, typically `/mcp`.
- Tool descriptors with clear names, descriptions, input schemas, and output
  schemas.
- Structured tool results, preferably `structuredContent`.
- Authentication for customer-specific data. OpenAI's Apps SDK auth docs expect
  OAuth 2.1 conforming to the MCP authorization spec for protected resources.
- Protected resource metadata at
  `/.well-known/oauth-protected-resource` or equivalent `WWW-Authenticate`
  discovery.
- OAuth authorization server metadata, PKCE support, scopes, redirect URI
  allowlisting, token audience/resource validation, and per-request bearer token
  verification.
- For ChatGPT development setup, create a connector in ChatGPT settings using
  the public `/mcp` endpoint. For local development, use a secure tunnel.
- Optional UI bundle only if FactoryLM wants a richer app experience. Data-only
  context access can skip UI.

## 6. What Can Be Built Privately Before Public Submission?

Build now:

- Repo-local Codex skill.
- Internal read-only FactoryLM context API.
- Private Codex plugin bundling the skill.
- Local MCP server wrapping the internal API.
- Local or private marketplace entry for testing.
- Remote MCP prototype behind non-public auth.
- Admin-only customer API-key/OAuth experiments.
- Security tests, tenant-boundary tests, prompt-injection tests, and audit logs.

Do not assume public/plugin-store acceptance yet. OpenAI docs currently point
ChatGPT public distribution through app submission guidelines, while Codex
plugins can be local, marketplace-backed, or workspace-shared. Treat public
distribution as a later packaging/review phase.

## 7. Mandatory Security Requirements For Factory Data

FactoryLM's external AI bridge must enforce:

- Read-only only.
- No PLC writes.
- No tag writes.
- No control actions.
- No raw SQL exposure.
- No database dump endpoints.
- No unapproved document leakage unless explicitly marked draft/internal.
- No cross-tenant leakage.
- No hallucinated fields or hidden LLM fallback.
- Tenant/site boundaries via existing RLS/session/API-key patterns.
- Least-privilege scopes for remote OAuth/API keys.
- Tool descriptions that discourage misuse.
- Server-side input validation for every tool call.
- Audit logs for who called which tool, tenant/site, arguments summary,
  result status, and correlation ID.
- PII/secret redaction in logs.
- Explicit stale/draft/unapproved warnings in tool output.

OpenAI's Apps SDK security guidance also emphasizes least privilege, explicit
consent, defense in depth, prompt-injection assumptions, input validation, and
audit logging. Those map directly to FactoryLM's factory-data safety model.

## Repo Inspection Summary

Existing reusable pieces:

- `mira-hub/src/lib/external-ai/context-skill.ts`:
  internal dispatcher for read-only structured FactoryLM context.
- `mira-hub/src/app/api/factorylm/context/route.ts`:
  current internal API wrapper using i3X bearer auth or Hub session fallback.
- `mira-hub/src/lib/i3x/data-access.ts` and `mira-hub/src/lib/i3x/*`:
  verified-entity projection, related objects, approved-tag live reads.
- `mira-hub/src/lib/manual-rag.ts`:
  approved document retrieval and citation/source helpers.
- `mira-hub/src/lib/tenant-context.ts`:
  app-role RLS tenant isolation.
- `mira-hub/src/lib/session.ts` and `mira-hub/src/lib/i3x/auth.ts`:
  session and bearer-key tenant resolution patterns.
- `mira-hub/src/app/api/mira/ask/route.ts` and
  `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts`:
  MIRA chat surfaces to reuse conceptually but not duplicate.
- `tests/simlab/scenarios/*.yaml` and `simlab/`:
  deterministic diagnostic scenario context.
- `mira-mcp/server.py`:
  existing MCP server, but it includes write-capable CMMS/diagnostic tools and
  should not be reused directly for this read-only bridge.
- `.claude/skills/*`:
  repo-local agent skill pattern.

Current gap:

- No dedicated read-only FactoryLM MCP server yet.
- No Codex plugin package yet.
- No customer-scoped OAuth/API-key model for ChatGPT remote MCP yet.
- No shared audit helper for external AI tool calls yet.
