# Graph Relationship Intelligence — Roadmap

**Product principle:** *MIRA proposes. The human verifies. The graph explains.*

The `/graph` page is a **review and explanation surface**, not a manual drawing tool.
MIRA automatically proposes relationships from evidence; the human confirms, rejects, or
corrects them. Dashed = proposed by MIRA; solid = verified. **No edge is ever auto-verified.**

## Implemented (PR: feat/graph-component-manual-proposals)

- **Component → manual proposals (`HAS_DOCUMENT`)** — `inferComponentManualPairs` matches a
  component/equipment node to a manual node by exact model, manufacturer+model, or
  model-in-title (conservative, deterministic). The `kg-infer-proposals` worker writes them as
  `relationship_proposals` (`created_by='rule'`, `status='proposed'`) with `oem_kb` evidence.
- **The graph explains** — tapping a dashed edge opens a panel: edge type, source → target,
  "Why MIRA thinks this" (the proposal `reasoning`), and **Confirm / Reject** actions
  (`POST /api/proposals/:id/decide`).
- **Discoverability** — when a tenant has 0 verified edges but >0 proposed, the page shows a
  banner ("MIRA found N proposed relationships…") and auto-enables *Show suggestions* so the
  user isn't staring at disconnected dots.

## Deferred (follow-ups)

- Per-row **evidence bullets** from `relationship_evidence` (currently the panel shows the
  single `reasoning` string; a `GET /api/proposals/:id` could return the full evidence chain).
- **"Wrong target" / "find better match" / "ask MIRA why"** review actions (Confirm + Reject
  are wired; the others need new endpoints).
- **Scheduling** the generator (currently a manual `npx tsx scripts/kg-infer-proposals.ts
  --tenant-id <uuid>` run).
- Matching against `knowledge_entries` (manual *chunks*) in addition to `manual` kg_entities.

## Maintenance-first relationship priorities (next edge types, in order)

1. component → manual ✅ (this PR)
2. component → manufacturer
3. component → model number
4. component → parent asset / machine
5. component → PLC tag · PLC tag → physical component
6. VFD → motor
7. sensor → input tag
8. fault → component
9. work order → component
10. procedure → component
11. wiring diagram → component
12. schematic / logic block → component

Each follows the same loop: deterministic/evidence-based proposal → dashed edge → human
verify. Prefer the canonical edge types already in the `relationship_proposals` CHECK
(`HAS_DOCUMENT`, `HAS_COMPONENT`, `WIRED_TO`, `DRIVES`/`IS_DRIVEN_BY`, `OCCURS_ON`, …) —
do not invent conflicting names.
