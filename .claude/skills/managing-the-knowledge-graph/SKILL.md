---
name: managing-the-knowledge-graph
description: Use when adding or changing knowledge-graph relationships, edge types, proposal generation, or the /graph review UI in the MIRA Hub (mira-hub) — including inferring component↔manual/work-order/fault/PLC-tag links, or touching kg_entities / kg_relationships / relationship_proposals / the inference worker.
---

# Managing the MIRA Knowledge Graph

## Overview

The KG is a **review surface, not a drawing tool.** The governing principle, in every layer:

> **MIRA proposes. The human verifies. The graph explains.**

Dashed edge = proposed by MIRA. Solid edge = verified by a human. All code is in `mira-hub`.

## The Iron Rule: never auto-verify

**No edge MIRA generates is ever written directly to `kg_relationships`.** Everything MIRA infers — *however deterministic or high-confidence* — is written as a `relationship_proposals` row (`status='proposed'`, `created_by='rule'`). The ONLY path into `kg_relationships` is a human action: `POST /api/proposals/[id]/decide {decision:"verify"}` (`src/app/api/proposals/[id]/decide/route.ts`).

| Rationalization | Reality |
|---|---|
| "This link is structural/deterministic (e.g. `work_orders.equipment_id`), so auto-verify is safe" | Still a proposal. Determinism sets high **confidence**, not **verified**. The human confirm IS the product. |
| "Confidence ≥ 0.9, no human needed" | No confidence value ever auto-promotes. There is no verify threshold. |
| "Inserting directly keeps the audit trail cleaner" | The proposal → decide path **is** the audit trail. |
| "Just this once / it's obvious" | Violating the letter is violating the spirit. Propose it. |

**Red flags — STOP and rewrite as a proposal if you catch yourself writing:** `INSERT INTO kg_relationships` inside a generator/worker; `approval_state='verified'` anywhere except the decide route; "auto-promote", "skip review", "confidence > X → verify".

## Adding a new relationship (the pattern)

1. **Edge type — reuse the canonical vocabulary.** Pick a type already in the `relationship_proposals` CHECK (migration `018` + later): `HAS_DOCUMENT` (component→manual), `HAS_COMPONENT`, `INSTANCE_OF`, `WIRED_TO`, `POWERED_BY`, `DRIVES`/`IS_DRIVEN_BY`, `OCCURS_ON`, `RESOLVED_BY`, `HAS_WORK_ORDER`, `HAS_PROCEDURE`, … **Do NOT invent a name** (`HAS_MANUAL`, `PERFORMED_ON`, `DOCUMENTED_BY`) when one fits. If genuinely none fits, add it to the CHECK in a new migration — and **renumber to the next free number** (`main` may have taken yours; run `npm run db:check-order`).
2. **Pure matcher** in `src/lib/knowledge-graph/inference.ts` — deterministic, no IO, fully unit-tested (`__tests__/inference.test.ts`). Returns candidate pairs + a plain reason. Be conservative: require real evidence, guard fuzzy/substring matches.
3. **Worker pass** in `scripts/kg-infer-proposals.ts` — query the nodes, run the matcher, write each via `upsertInferredProposal(client, tenant, {...})` (`proposals-writer.ts`). It's **idempotent**: skips if a verified edge OR a non-rejected proposal already exists (both directions), so re-runs and rejected pairs never duplicate.
4. **Evidence is mandatory.** Every proposal gets ≥1 `relationship_evidence` row (`evidence_type` from its CHECK: `oem_kb`, `document_page`, `work_order`, `manifest`, `plc_rung`, …) plus a human-readable `reasoning` string.

## How it renders + explains (`/graph`)

- `GET /api/kg/graph?includeProposals=true` UNIONs verified + proposed edges; proposed carry `proposalId` + `reasoning`. Page: `src/app/(hub)/graph/page.tsx`; canvas: `components/kg/GraphCanvas.tsx`.
- An edge renders **only if both endpoints are nodes in the payload** (both must be `kg_entities`). Proposals key entities by `kg_entities.id` (UUID) — NOT `installed_component_instances.id` (different id-space).
- Tap a dashed edge → evidence panel with **Confirm / Reject**. **Wording must be plain English for a maintenance tech.** Add a `FRIENDLY[<TYPE>]` entry in `page.tsx` (e.g. `HAS_DOCUMENT` → label "User manual", lead "MIRA found a manual that looks like it belongs to X", confirm "Link manual", reject "Not this one"). **Never show raw `HAS_DOCUMENT` or "Why MIRA thinks this" to a user.**
- Low-relationship state: if 0 verified and >0 proposed, show the empty-state banner and auto-enable "Show suggestions" — don't leave the user staring at disconnected dots.

## Gotchas

- `kg_entities` UNIQUE key is **(tenant_id, entity_type, `name`)** — not `entity_id`. Seeding/renaming by name collides with real nodes; SELECT-then-INSERT, never blind upsert on entity_id.
- Every query is **tenant-scoped** (`tenant_id = $1`, RLS). Take tenant from the session (`sessionOr401`), never a client param.
- Migrations: never auto-apply to prod. Use the **Apply NeonDB Migrations** GitHub workflow, **staging first** (`mode=dry-run` → `apply`), `--ref` the branch that has the file.
- Run the worker: `npx tsx scripts/kg-infer-proposals.ts --tenant-id <uuid>` (use bun if present; if `tsx` rejects top-level `await` under this CommonJS package, run an ESM `.mts` copy).

## Relationship priorities (build order)

component→manual ✅ · component→manufacturer · →model · →parent asset/machine · →PLC tag · VFD→motor · sensor→input tag · fault→component · work-order→component · procedure→component · wiring/schematic→component. Roadmap: `docs/superpowers/plans/2026-06-03-graph-relationship-roadmap.md`.
