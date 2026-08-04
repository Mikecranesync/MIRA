# Tool Selection

Use this reference after `factorylm-context-bridge` triggers.

## Question To Tool

| User or agent needs | Tool |
|---|---|
| "What asset is this?" / fuzzy lookup | `find_asset` |
| "What is this asset?" / tags/components summary | `get_asset_context` |
| "What evidence supports this mapping/diagnosis?" | `search_approved_evidence` |
| "What is this tag or UNS path?" | `get_tag_context` |
| "What is upstream/downstream/related?" | `list_related_assets` |
| "What does FactoryLM know about this fault?" | `get_diagnostic_context` |
| "What is the live value?" | `get_live_value` |
| "What SimLab scenario covers this behavior?" | `search_simlab_scenarios` |

## Safety Checks

- If the request asks to write, update, acknowledge, reset, command, tune, or
  control a PLC/tag/machine, refuse in this layer.
- If no verified asset/tag/evidence is found, return `found: false`; do not
  invent fields.
- If evidence is draft/internal, label it draft/internal and do not present it
  as approved.
- If live value has no approved tag allowlist row, report that no approved
  live-read path exists.

## Coding Patterns

Use this shape for new read-only tools:

```ts
async function getSomething(client: DbClient, input: Record<string, unknown>) {
  const id = asString(input, "id");
  if (!id) return notFound("get_something", "id is required");

  const { rows } = await client.query(
    `SELECT ... WHERE approval_state = 'verified' AND id = $1 LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return notFound("get_something", "verified context not found");

  return ok("get_something", { ... }, evidence, "verified", "verified");
}
```

Prefer bounded result sets and explicit status fields over free-form prose.
