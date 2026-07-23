# FactoryLM External AI Developer Usage

FactoryLM external AI access is private/local first.

## Use With Codex Today

Start in the MIRA repo and invoke the repo skill:

```text
$factorylm-context-bridge
Find the conveyor asset and show approved evidence.
```

The skill points Codex at:

- `mira-hub/src/lib/external-ai/context-skill.ts`
- `mira-hub/src/app/api/factorylm/context/route.ts`
- `mira-hub/docs/developer/factorylm-external-ai-skill.md`

## Use The Internal API

From an authenticated Hub session or with an existing i3X bearer key:

```bash
curl -sS https://app.example.com/api/factorylm/context \
  -H "content-type: application/json" \
  -H "authorization: Bearer $I3X_API_KEY" \
  -d '{
    "tool": "find_asset",
    "input": { "query": "conveyor" }
  }'
```

Local development can call the library directly in tests:

```ts
import { factoryLmContextSkill } from "@/lib/external-ai/context-skill";

const result = await factoryLmContextSkill.call({
  tool: "get_asset_context",
  input: { asset_id: "filler01" },
  context: { tenantId },
});
```

## Private Codex Plugin Draft

The private plugin package lives at:

```text
plugins/factorylm-context/
```

It currently bundles the `factorylm-context-bridge` skill only. MCP config is
intentionally absent until the dedicated read-only MCP server exists.

## Expected Result Style

Answers should be grounded in returned JSON, not model memory:

- cite `evidence`
- report `approvalState`
- preserve `notFoundReason`
- say when live data is unavailable or not approved
- do not invent tags, assets, documents, fault codes, or live values

## Next Developer Milestone

Build the local MCP server wrapper for `POST /api/factorylm/context`, then add
that server to the private Codex plugin as `.mcp.json`.
