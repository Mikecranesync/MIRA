# Architecture Pattern: {{Pattern Name}}

> Copy this template into `architecture-patterns/{{slug}}.md`. Patterns are recurring structural ideas seen across multiple sources — not company-specific implementations.

## Identity

- **Pattern name:** {{e.g., "Sparkplug B group_id = site, edge_node_id = area-line-asset"}}
- **One-line description:** {{what the pattern does}}
- **Where we've seen it:** {{list companies / repos / videos that exhibit this pattern, linked}}
- **Maturity:** {{emerging / common / standard / contested}}
- **Last reviewed:** {{YYYY-MM-DD}}

## The pattern

{{2-5 paragraphs. Describe the pattern abstractly — topic shapes, schema shapes, deployment topology, etc. Use code/text examples.}}

```
# example topic / schema / shape
```

## Why it exists (problem solved)

{{What pain does this pattern address? Cite the sources that motivated it.}}

## Variants we've seen

| Variant | Source | Trade-off |
|---|---|---|
| {{...}} | {{company file}} | {{when to prefer}} |

## Trade-offs

- **Pros:** {{...}}
- **Cons:** {{...}}
- **Doesn't help when:** {{counter-cases — be honest}}

## MIRA relevance

- **Where this would live in MIRA:** {{e.g., `mira-crawler/ingest/uns.py`, `kg_relationships`}}
- **What it would replace / complement:** {{specific existing code / decision}}
- **Adoption risk:** {{low / medium / high — why}}
- **ADR needed?** {{yes/no — link if drafted}}

## Open questions

- [ ] {{things to confirm before adopting}}

## Sources

- {{linked source notes from repos/ or videos/}}
