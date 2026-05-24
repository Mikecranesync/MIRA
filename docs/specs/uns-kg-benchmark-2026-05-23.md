---
title: "UNS + KG — Empirical Benchmark Addendum"
date: 2026-05-23
status: "Empirical companion to docs/specs/uns-kg-standards-compliance.md (2026-05-07)"
author: "Claude (CHARLIE node) on behalf of Mike Harper"
parent_spec: "docs/specs/uns-kg-standards-compliance.md"
db_inspect_runs:
  - 2026-05-19T22:50 prod: workflow run 26130051449 (PR #1443 verification)
  - 2026-05-23T12:43 staging (default): workflow run 26332999674
  - 2026-05-23T13:11 staging (default): workflow run 26333596051
  - 2026-05-23T14:25 prod (explicit): workflow run 26335166454
---

# UNS + KG — Empirical Benchmark Addendum (2026-05-23)

## Why this addendum exists

The 2026-05-07 spec (`docs/specs/uns-kg-standards-compliance.md`) scored MIRA's KG design against eight industry standards (ISA-95, ISO 14224, MIMOSA CCOM, W3C OWL/SOSA, OPC UA, Sparkplug B, NAMUR NE 107, ISO 55000). That work remains correct as a **design-level** benchmark and is not duplicated here.

This addendum is the **empirical** companion: how does the prod KG *actually look* today, against both (a) the standards in the parent spec and (b) the vocabulary the code is supposed to write?

---

## Operator-error retrospective: the staging-vs-prod confusion

The first three runs of this addendum (workflow runs 26332999674 and 26333596051) hit `db-inspect.yml` without specifying `target=prod`. The workflow defaults to `target=staging`. The staging Neon branch is forked-from-prod but stale, so it has materially fewer rows than prod. The mistake produced a false "299 → 42 row regression" headline that does not exist in production. The PR #1505 commits that asserted this regression have been corrected. Prevention shipped in this same PR: db-inspect now prints the target as a `::notice::` annotation, pins it in the job-step summary, and stamps it into the psql session via a `:target` variable so every SQL block confirms which DB it queried. Lesson: read the job name. The 2026-05-23T12:43 run name was literally "Inspect staging" — the data was correct; the analyst was not.

The remainder of this addendum uses prod data from **workflow run 26335166454** (2026-05-23T14:25 UTC, target=prod explicit).

---

## Prod KG state, 2026-05-23

| Metric | 2026-05-19 22:50 UTC (prod) | 2026-05-23 14:25 UTC (prod) | Δ |
|---|---|---|---|
| `kg_entities` rows | 600 | 600 | 0 |
| `kg_entities` NULL `uns_path` | 28 | 28 | 0 |
| `kg_relationships` rows | 299 | 299 | 0 |
| `has_manual` edges | 269 | 269 | 0 |
| `knowledge_entries` rows | 83,542 | 83,542 | 0 |

**Prod is stable.** PR #1443's backfill (269 has_manual edges + 269 manual entities + 269 equipment entities) is durable. No regression.

---

## Empirical entity-type vocabulary: 11 in prod DB, 3 in `kg_writer.py`

`kg_writer.py` (the canonical ingest-side writer in `mira-crawler/ingest/`) writes three `entity_type` values: `equipment`, `manual`, `fault_code`. Prod `kg_entities` has **11 distinct entity types** with these counts:

| `entity_type` | rows (prod 2026-05-23) | NULL `uns_path` | empty `properties` | Written by `kg_writer.py`? |
|---|---|---|---|---|
| `manual` | 281 | **12** | 0 | Yes (12 NULLs from a non-kg_writer path) |
| `equipment` | 276 | 0 | 0 | Yes |
| `work_order` | 16 | **16** | 0 | No |
| `component` | 8 | 0 | 0 | No |
| `fault_code` | 5 | 0 | 0 | Yes |
| `plc_tag` | 4 | 0 | 0 | No |
| `area` | 3 | 0 | 1 | No |
| `site` | 2 | 0 | 0 | No |
| `line` | 2 | 0 | 1 | No |
| `asset` | 2 | 0 | 0 | No |
| `tenant` | 1 | 0 | 0 | No |

**Eight of eleven `entity_type` values are written by code outside `mira-crawler/ingest/kg_writer.py`.** A grep for `entity_type=` across `mira-crawler/`, `mira-bots/shared/`, and `mira-hub/db/migrations/` returns only the three in `kg_writer.py`; the other eight come from a different writer path — almost certainly `mira-hub/`'s onboarding wizard, namespace builder, work-order endpoints, and PLC-tag mapper. They correspond to ISA-95 structural levels (`site`/`area`/`line`) and the CMMS surface (`work_order`/`asset`/`plc_tag`/`component`).

**There is no shared vocabulary contract.** No `entity_type` CHECK constraint, no enum table, no documented authoritative list. Drift between writers is structurally inevitable. This is the actionable gap the 2026-05-07 spec does not surface — it predates the Hub writer's contributions.

### Discrimination of the 28 NULL `uns_path` rows

- **16 × `work_order`** — no work-order path builder exists in `mira-crawler/ingest/uns.py`. ISA-95 places work orders at Level 3 (manufacturing operations management); ISO 14224 § 8 explicitly addresses work-order data records. They should have a path under `enterprise.{site}.{area}.cmms.work_orders.{wo_id}` or equivalent. Fix lives in whichever Hub writer creates work_order entities (likely `mira-hub/src/app/api/work-orders/route.ts` or similar).
- **12 × `manual`** — `manual_path()` *exists* in `mira-crawler/ingest/uns.py` and is called by `kg_writer.register_equipment_and_manual()`. The remaining 269 `manual` rows DO have a `uns_path`. These 12 NULL-path manuals were therefore written by a different code path (likely Hub) that doesn't import the path builder.

No `equipment`, `component`, `fault_code`, `plc_tag`, `site`, `area`, `line`, `tenant`, or `asset` row has a NULL `uns_path`. The 28 NULLs are entirely a `work_order` + `manual`-from-Hub-path-builder gap.

---

## Empirical relationship-type vocabulary: 11 in prod DB, 2 in `kg_writer.py`

`kg_writer.py` writes two `relationship_type` values: `has_manual`, `has_fault`. Prod has **11 distinct types**:

| `relationship_type` | rows (prod 2026-05-23) | Naming | Written by `kg_writer.py`? |
|---|---|---|---|
| `has_manual` | 269 | lower | Yes (PR #1443 backfill) |
| `documented_in` | 12 | lower | No |
| `has_fault_code` | 5 | lower | **Conflicts with `has_fault`** |
| `HAS_COMPONENT` | 5 | UPPER | No |
| `LOCATED_IN` | 2 | UPPER | No |
| `MAPS_TO` | 1 | UPPER | No |
| `POWERED_BY` | 1 | UPPER | No |
| `WIRED_TO` | 1 | UPPER | No |
| `has_work_order` | 1 | lower | No |
| `USED_IN_LOGIC` | 1 | UPPER | No |
| `CAUSES` | 1 | UPPER | No |

Two specific problems:

**1. Naming inconsistency.** Six types are UPPER_SNAKE; five are lower_snake. There is no shared convention. `kg_writer.py` writes lower_snake (`has_manual`, `has_fault`); the Hub writer mostly writes UPPER. A consumer doing `WHERE relationship_type = 'has_component'` would miss every Hub-written row; one doing `'HAS_COMPONENT'` would miss every backfill row. Silent-failure territory.

**2. `has_fault` (kg_writer) vs `has_fault_code` (Hub) — same concept, different strings.** `kg_writer.register_fault_code()` writes `has_fault`. The DB has 5 `has_fault_code` rows from Hub. If the deferred has_fault backfill runs as-is, it creates a **third edge type** for the same concept. This blocks task #2 until reconciled.

---

## Properties JSONB richness

82 of 84 sampled rows carry data; 2 are empty (1 × `area`, 1 × `line`). The 2026-05-07 spec called out structured failure-mode attributes (ISO 14224 Annex D), NE 107 status, and condition_state — these remain unaddressed. Sample `work_order` properties:

```
{"status": "open", "priority": "medium",
 "equipment_id": "b2a90691-…", "work_order_number": "MIRA-…"}
```

No `failure_mode`, `failure_cause`, `failure_effect`, `detection_method`, `ne107_status`, or `condition_state`. The gap is unchanged from 2026-05-07.

---

## has_fault backfill viability — 324/443 (73 %) prod slug-match

The fault_codes ↔ equipment slug-normalized join (in `db-inspect.yml`) returned:

- 443 distinct `fault_codes` with manufacturer + equipment_model
- **324 matched** to an existing equipment entity by `LOWER(REGEXP_REPLACE(…, '[^a-zA-Z0-9]+', '_', 'g'))` on both (mfr, model)
- 119 unmatched (27 %) — likely manufacturer/model strings that the fault-code extractor stored differently than the equipment-name extractor

The has_fault backfill is **viable** against prod — 324 edges is meaningful coverage. The 119 unmatched rows are a separate normalization issue not blocking the first wave.

---

## Updated compliance matrix (delta since 2026-05-07)

| Standard | Layer 1 | Layer 2 | Δ since 2026-05-07 |
|---|---|---|---|
| **ISA-95** | ✅ | ⚠️ (relationship-type case drift surfaced) | naming inconsistency newly visible |
| **ISO 14224** | ⚠️ | ⚠️ (still no structured failure-mode attributes) | no change |
| **MIMOSA CCOM** | ⚠️ | ⚠️ (InfoSource audit holds — has_manual edges with source_chunk_id intact) | no change |
| **NAMUR NE 107** | N/A | ❌ (no `ne107_status` field) | no change |
| **OPC UA** | ⚠️ | ⚠️ (class/instance gap; relationship-case drift adds friction) | naming inconsistency newly visible |

No regressions. The 2026-05-07 matrix is still valid; this addendum just adds empirical color.

---

## Punch list — re-prioritized for 2026-05-23

### P1 — unblock has_fault backfill

1. **Reconcile `has_fault` vs `has_fault_code`.** Pick one string; document in `.claude/rules/uns-compliance.md`. Either rename in `kg_writer.register_fault_code()` to match Hub's `has_fault_code`, or update the 5 Hub rows. The two-string status is silent-failure prone.
2. **Run the has_fault backfill.** 324/443 prod matches are available. Mirror the has_manual backfill pattern in `tools/migrations/backfill_equipment_entities.py` — distinct (tenant, manufacturer, model, code) → call `kg_writer.register_fault_code()`. Dry-run, then commit.
3. **Add a CHECK constraint or lookup table for `relationship_type`.** Whichever convention wins, a DB-side guard prevents future drift. The current 11-type case-mixed sprawl is the consequence of having no guard.

### P2 — close the vocabulary contract gap

4. **Add a shared `entity_type` enum or lookup table.** The 11 types in prod include MVP-essential ones (`work_order`, `component`, `plc_tag`, `asset`, `site`, `area`, `line`) that `kg_writer.py` doesn't know exist. Decide on the authoritative writer (probably `mira-hub` for `tenant`/`site`/`area`/`line`/`component`/`plc_tag`/`work_order`/`asset`, `mira-crawler` for `equipment`/`manual`/`fault_code`).
5. **Document Hub's path-builder gap.** 16 work_order + 12 manual rows have NULL uns_path. Hub doesn't import `mira-crawler/ingest/uns.py`. Either import it or mirror the relevant builders locally (<50 LOC).

### P3 — graph-level schema additions from 2026-05-07 spec — STILL UNSHIPPED

- § 5: `properties.ne107_status` on fault_code — **not started**
- § 6: `properties.condition_state` on equipment — **not started**
- § 7: `TRIGGERS_PM` relation type — **not started**

JSONB-field additions; no migration needed for #5/#6. Bundle into one PR.

### P4 — post-MVP items from 2026-05-07 spec

- Subunit/maintainable_item split (ISO 14224)
- equipment_class entity (OPC UA)
- work_cell segment (ISA-95)
- CCOM XML export

No empirical signal changes priority.

---

## What is NOT a finding (so future addenda don't re-litigate)

- **No data regression.** Prod kg_entities=600 and kg_relationships=299 are unchanged from 2026-05-19. PR #1443 is durable.
- **RLS correctly enabled** on both `kg_entities` and `kg_relationships`. Connection user is `neondb_owner` with `rolbypassrls=t`.
- **Index coverage is good.** 11 indexes each on `kg_entities` and `kg_relationships`, including gist on `uns_path` and unique on `(tenant_id, entity_type, name)`. Read performance is not a bottleneck.
- **Schema matches hub-001** (`source_id` / `target_id` / `relationship_type`). ADR-0013 amendment from PR #1446 stands.
- **knowledge_entries unchanged** (83,542). Vector store is healthy.

---

## Cross-references

- Parent spec: `docs/specs/uns-kg-standards-compliance.md`
- Schema authority: `docs/adr/0013-uns-kg-schema-canonicalization.md`
- Path builders: `mira-crawler/ingest/uns.py`
- KG writer: `mira-crawler/ingest/kg_writer.py`
- Hub migrations (multiple entity types): `mira-hub/db/migrations/021_namespace_builder.sql`, `025_kg_entities_natural_key.sql`, `026_kg_entities_dedupe_and_constraint.sql`, `027_ai_suggestions.sql`
- db-inspect workflow: `.github/workflows/db-inspect.yml` (target now announced prominently — see the 2026-05-23 staging/prod confusion lesson above)
- Verified prod state: workflow run 26335166454

---

*This addendum is data-driven and time-stamped. When the prod KG state changes meaningfully, regenerate the empirical sections against fresh `db-inspect.yml -f target=prod` output. Do not rewrite the 2026-05-07 parent spec to reflect operational drift — that spec is the design contract.*
