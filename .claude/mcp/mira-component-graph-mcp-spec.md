# mira-component-graph-mcp — Spec

MCP server exposing the component knowledge graph. Read tools are unrestricted; write tools require admin context and persist as `proposed`.

**Status:** proposed.
**Underlying data:** NeonDB tables `kg_entities`, `kg_relationships` (`docs/migrations/004_kg_entities.sql`, `005_kg_relationships.sql`).
**Auth:** tenant scope required; admin role required for the three `mark_*` / `propose_*` write tools.

## Relationship statuses

```
proposed     — created by ingestion, LLM proposal, or technician hint; not yet trusted
needs_review — flagged by quality check; awaits human eyes
verified     — admin/technician confirmed; safe to ground answers on
rejected     — admin/technician rejected; do not propose again with same evidence
```

## Tools

### `find_component(component_id: str) -> Component`
One component by id. 404 if missing.

```jsonc
{
  "id": "...",
  "name": "Occupancy Sensor B16.2",
  "manufacturer": "Banner",
  "model": "Q4X",
  "uns_path": "...",
  "evidence": [...],
  "confidence": "verified|proposed|..."
}
```

### `search_components(query: str, tenant_id?: str, limit?: int = 10) -> list[Component]`
Free-text component search; backed by `kg_entities` name + tag fields.

### `get_relationships(component_id: str, status?: str) -> list[Relationship]`
Edges touching this component. Optionally filter by status.

```jsonc
{
  "id": "rel_...",
  "source": "component:pe_b16_2",
  "target": "fault:1.SOC_B16_2.OCCUPIED_TOO_LONG",
  "relation": "HasFaultMode",
  "status": "verified",
  "evidence": [{"type": "manual", "doc_id": "...", "page": 42}],
  "confidence": "high",
  "created_by": "...",
  "verified_by": "..."
}
```

### `propose_relationship(source: str, target: str, relation: str, evidence: list, tenant_id?: str) -> Relationship`
Write — persists with status `proposed`. Tenant + admin gated.

### `mark_relationship_verified(id: str, verified_by: str) -> Relationship`
Admin only. Promotes `proposed` → `verified`.

### `mark_relationship_rejected(id: str, rejected_by: str, reason: str) -> Relationship`
Admin only. Sets status `rejected`.

## Safety

- **No silent assertions.** Write tools never create a relationship at `verified` directly.
- **Evidence required on every proposal.** Empty `evidence` → reject the call.
- **Confidence required.**
- **Tenant isolation.** Cross-tenant lookups return 403.
- **Audit trail.** Every status change appends to `kg_relationship_audit` (or equivalent — match existing schema).

## Cross-references

- `.claude/skills/knowledge-graph-proposer/SKILL.md`
- `.claude/skills/component-profile-builder/SKILL.md`
- `docs/specs/uns-kg-unification-spec.md`
