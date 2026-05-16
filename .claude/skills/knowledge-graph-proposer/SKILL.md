---
name: knowledge-graph-proposer
description: Use when MIRA needs to propose, verify, or reject relationships in the knowledge graph. Triggers on edits to `mira-crawler/ingest/kg_writer.py`, MCP tools that touch `kg_relationships`, or whenever a feature would create new edges in the graph.
---

# Knowledge-Graph Proposer

Help MIRA build a knowledge graph safely. The graph is in `kg_entities` + `kg_relationships` (NeonDB; migrations 004 + 005 in `docs/migrations/`).

The graph is high-value because answers cite it as evidence. Poisoning the graph poisons every downstream answer. **Defend it.**

## Relationship types

| Relation | Example |
|---|---|
| `HasComponent` | asset → component (Conveyor B16 → PE-B16-2) |
| `DescribesComponent` | tag → component (1.SOC_B16_2 → PE-B16-2) |
| `HasFaultMode` | component → fault (PE-B16-2 → OCCUPIED_TOO_LONG) |
| `DocumentsComponent` | manual → component (Banner Q4X manual → PE-B16-2) |
| `ResolvesFault` | work-order → fault (WO-1234 → OCCUPIED_TOO_LONG) |
| `RequiresPart` | component/fault → part (PE-B16-2 → Q4XTBLD-Q8) |
| `WiresTo` | component → circuit (PE-B16-2 → Drawing-7-Sheet-4-Term-X3-7) |

Other relations (`SharesLine`, `DrivesMotor`, `FeedsAsset`) are allowed but must justify their semantics with a one-line definition stored alongside.

## Statuses

```
proposed     — created by ingestion, LLM proposal, or technician hint; not yet trusted
needs_review — flagged by quality checks; awaits human eyes
verified     — admin/technician confirmed; safe to cite as evidence in answers
rejected     — admin/technician rejected; do not re-propose with same evidence
```

## Hard rules

1. **Never silently assert new relationships.** Every write call persists a row with explicit `status`.
2. **Default status is `proposed`** unless admin context promotes it directly to `verified`.
3. **Store evidence with every relationship.** Empty evidence → reject the proposal at the API boundary.
4. **Include confidence** (`low|medium|high` or numeric per existing column convention).
5. **Tenant isolation.** Relationships are per-tenant; don't cross-pollinate.
6. **Audit trail.** Every status change appends to `kg_relationship_audit` (or equivalent).
7. **Don't auto-promote on weak signals.** A thumbs-up emoji is not confirmation. Require a button click or explicit text.
8. **Idempotent.** Re-proposing the same (source, target, relation) with the same evidence should update, not duplicate.

## Evidence types (use these strings)

- `manual` — `{type: manual, doc_id, page}`
- `wiring_drawing` — `{type: wiring_drawing, drawing_id, sheet}`
- `plc_comment` / `ladder_comment` / `st_reference` — `{type: ..., ref}`
- `naming_convention` — `{type: naming_convention, ref}`
- `wo_history` — `{type: wo_history, wo_ids: [...], count}`
- `technician_confirm` — `{type: technician_confirm, user_id, session_id, message_id}`
- `admin_approval` — `{type: admin_approval, user_id, ts}`
- `public_datasheet` — `{type: public_datasheet, source}` (lowest trust — generic only)

## Anti-patterns (these poison the graph)

- Writing `verified` relationships directly from ingestion (extraction is `proposed` by definition)
- Inferring `HasComponent` from filename without manual evidence
- Promoting on the first weak hint
- Creating new relation types without a written semantics
- Skipping the audit log
- Allowing the same (source, target, relation) to exist twice
- Cross-tenant writes
- Rejecting without a `reason`

## Promotion workflow

1. **propose** — Ingestion, LLM proposal, or technician hint creates row with status `proposed` + evidence + confidence
2. **review queue** — Admin UI surfaces `proposed` and `needs_review` rows ranked by impact (high-confidence, high-traffic asset first)
3. **verify** — Admin/technician clicks ✅; status → `verified`; audit row written; record `verified_by` + `verified_at`
4. **reject** — Admin/technician clicks ❌ + provides reason; status → `rejected`; audit row written; future re-propose with same evidence rejected

`needs_review` is for the quality-check job to flag relationships that look wrong (e.g., a `HasComponent` from a sensor to a different sensor — likely an error).

## What to do when invoked

1. Identify the proposal source — ingestion, miner, technician hint
2. Verify evidence is present and non-empty
3. Verify confidence is set
4. Verify the relationship type is in the allowed set
5. Verify idempotency — check for existing (source, target, relation) row
6. Persist as `proposed` (or `verified` if admin context)
7. Append audit row
8. If proposal volume is high, group into an admin review batch

## Cross-references

- `mira-crawler/ingest/kg_writer.py` — KG persistence
- `docs/migrations/004_kg_entities.sql`, `005_kg_relationships.sql` — schema
- `.claude/mcp/mira-component-graph-mcp-spec.md`
- `.claude/skills/component-profile-builder/SKILL.md`
- `.claude/skills/work-order-history-miner/SKILL.md`
- `.claude/skills/plc-tag-mapper/SKILL.md`
- `.claude/rules/uns-compliance.md`
