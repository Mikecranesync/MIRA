---
title: "UNS + KG — Empirical Benchmark Addendum"
date: 2026-05-23
status: "Empirical companion to docs/specs/uns-kg-standards-compliance.md (2026-05-07) — DRAFT"
author: "Claude (CHARLIE node) on behalf of Mike Harper"
parent_spec: "docs/specs/uns-kg-standards-compliance.md"
db_inspect_runs:
  - 2026-05-19T22:50: workflow run 26130051449 (PR #1443 verification)
  - 2026-05-23T12:43: workflow run 26332999674 (this addendum)
---

# UNS + KG — Empirical Benchmark Addendum (2026-05-23)

## Why this addendum exists

The 2026-05-07 spec (`docs/specs/uns-kg-standards-compliance.md`) scored MIRA's KG design against eight industry standards (ISA-95, ISO 14224, MIMOSA CCOM, W3C OWL/SOSA, OPC UA, Sparkplug B, NAMUR NE 107, ISO 55000). That work remains correct as a **design-level** benchmark and is not duplicated here.

This addendum is the **empirical** companion: how does the prod KG *actually look* today, 16 days later, against both (a) the standards in the parent spec and (b) the vocabulary the code is supposed to write? The data comes from two db-inspect runs against `factorylm/prd` NeonDB (rolbypassrls=t on `neondb_owner`, so RLS is not filtering the view): the 2026-05-19 22:50 UTC run from PR #1443's verification, and a fresh 2026-05-23 12:43 UTC run.

The findings are structured to be actionable, not encyclopedic. They are ordered by severity.

---

## Headline: a 269-edge regression between 2026-05-19 and 2026-05-23

| Metric | 2026-05-19 22:50 UTC | 2026-05-23 12:43 UTC | Δ |
|---|---|---|---|
| `kg_entities` rows | 600 | 84 | −516 |
| `kg_entities` NULL `uns_path` | 28 | 28 | 0 |
| `kg_relationships` rows | 299 | 42 | −257 |
| `has_manual` edges | 269 | **0** | −269 |
| `knowledge_entries` rows | 83,542 | 83,542 | 0 |

The 269 `has_manual` edges that PR #1443's backfill ran (commit `623a43d1`) and verified at 22:50 UTC on 2026-05-19 **no longer exist**. Sampling the current 42 `kg_relationships` rows shows the earliest `created_at` is 2026-04-28 and the latest is 2026-05-08 — every row created on 2026-05-19 is gone. The deletion appears selective: edges from before PR #1443 survived; edges created by PR #1443 did not.

**Likely vector (not confirmed):** migration `026_kg_entities_dedupe_and_constraint.sql` deletes duplicate `kg_entities` rows, and the FK `ON DELETE CASCADE` on `kg_relationships.source_id / target_id` (per migration 001) collapses the attached edges. PR #1443's backfill inserted 269 (mfr, model) → equipment+manual upserts; if any of those rows were treated as duplicates by 026's natural-key dedup (`tenant_id, entity_type, name`), the cascade would have wiped the new edges. The 026 file itself flags this behavior explicitly: *"Kept-row relationships from earlier writes are preserved"* — meaning new relationships attached to deduped duplicates are not.

I could not locate a prod `apply-migrations.yml` run between 2026-05-19 22:50 and 2026-05-23 12:43 that explicitly applies 026 (the 2026-05-22 23:36 run only ran the 014–018 check pass, no application). Either 026 was applied earlier than the listed runs, or another deletion vector exists (e.g., a manual `psql` against prod — which is explicitly banned by `docs/environments.md` rule #1, and would be a separate incident).

**This is an ops finding, not benchmark material.** It belongs in `docs/known-issues.md` and on Mike's desk before any further KG writes happen. The deferred recommendations from the previous session (has_fault backfill, NULL uns_path remediation) should not run until root cause is understood, or the same deletion vector will silently consume them too.

The memory note `project_kg_relationships_schema.md` claiming "verified PR outcome (299 rows / 269 has_manual)" is **frozen in time** — the verification was correct at 22:50 UTC; the durability assumption was wrong. The note has been updated to reflect this addendum.

---

## Empirical entity-type vocabulary: 11 in DB, 3 in `kg_writer.py`

`kg_writer.py` (the canonical ingest-side writer in `mira-crawler/ingest/`) only knows three `entity_type` values: `equipment`, `manual`, `fault_code`. The current prod `kg_entities` table has **11 distinct entity types**:

| `entity_type` | rows (2026-05-23) | NULL `uns_path` | empty `properties` | Written by `kg_writer.py`? |
|---|---|---|---|---|
| `work_order` | 16 | **16** | 0 | No |
| `equipment` | 15 | 0 | 0 | Yes |
| `component` | 14 | 0 | 0 | No |
| `manual` | 12 | **12** | 0 | Yes (but path builder unused) |
| `plc_tag` | 8 | 0 | 0 | No |
| `fault_code` | 5 | 0 | 0 | Yes |
| `area` | 4 | 0 | 1 | No |
| `site` | 3 | 0 | 0 | No |
| `line` | 3 | 0 | 1 | No |
| `tenant` | 2 | 0 | 0 | No |
| `asset` | 2 | 0 | 0 | No |

**Eight of eleven `entity_type` values are written by code outside `mira-crawler/ingest/kg_writer.py`.** A grep for `entity_type=` across `mira-crawler/`, `mira-bots/shared/`, and `mira-hub/db/migrations/` returns only the three in `kg_writer.py`; the other eight must be written from a different writer path (almost certainly `mira-hub/`'s onboarding wizard, namespace builder, or work-order endpoints — they correspond to the ISA-95 levels `site`/`area`/`line` and the CMMS surface `work_order`/`asset`/`plc_tag`/`component`).

**This is the actionable headline the 2026-05-07 spec does not have.** The KG is being populated by multiple writers with no shared vocabulary contract. There is no `kg_entities.entity_type CHECK` constraint, no enum table, no documented authoritative list. Drift is inevitable.

### Discrimination of the 28 NULL `uns_path` rows

The 28 NULL rows split cleanly into two cohorts:

- **16 × `work_order`.** No `work_order` path builder exists in `mira-crawler/ingest/uns.py`. The Hub writer that creates these rows is inserting them without a path. ISO 14224 § 8 explicitly addresses work-order data records, and ISA-95 places work orders in the Level-3 manufacturing operations management band. They *should* have a UNS path under `enterprise.{site}.{area}.cmms.work_orders.{wo_id}` or similar.
- **12 × `manual`.** `manual_path()` *exists* in `mira-crawler/ingest/uns.py` and is called by `kg_writer.register_equipment_and_manual()`. The 12 NULL manuals were therefore written by a different code path (likely the same Hub writer, which doesn't call `kg_writer`). This is the *manufacturer/model* path-builder gap noted in the 2026-05-07 spec § 2 ("Action item 2") flowing downstream into a second writer.

No `equipment`, `component`, `fault_code`, `plc_tag`, `site`, `area`, `line`, `tenant`, or `asset` row has a NULL `uns_path`. The 28 NULLs are entirely a `work_order` + `manual` problem and bound to whichever Hub writer creates them.

---

## Empirical relationship-type vocabulary: 10 in DB, 2 in `kg_writer.py`

`kg_writer.py` writes two `relationship_type` values: `has_manual`, `has_fault`. The current prod `kg_relationships` table has **10 distinct types** (and would have had 11 if the 269 `has_manual` had survived):

| `relationship_type` | rows (2026-05-23) | rows (2026-05-19) | Naming | Written by `kg_writer.py`? |
|---|---|---|---|---|
| `documented_in` | 12 | 12 | lower | No |
| `HAS_COMPONENT` | 11 | 5 | UPPER | No |
| `has_fault_code` | 5 | 5 | lower | **Conflicts with `has_fault`** |
| `LOCATED_IN` | 5 | 2 | UPPER | No |
| `POWERED_BY` | 2 | 1 | UPPER | No |
| `WIRED_TO` | 2 | 1 | UPPER | No |
| `MAPS_TO` | 2 | 1 | UPPER | No |
| `has_work_order` | 1 | 1 | lower | No |
| `USED_IN_LOGIC` | 1 | 1 | UPPER | No |
| `CAUSES` | 1 | 1 | UPPER | No |
| `has_manual` | 0 | **269** | lower | Yes — and **gone** |

Two specific problems beyond the headline:

**1. Naming inconsistency.** Seven types are UPPER_SNAKE; four are lower_snake. There is no shared convention. `kg_writer.py` writes lower_snake (`has_manual`, `has_fault`); the Hub writer mostly writes UPPER. A consumer doing `WHERE relationship_type = 'has_component'` would miss every Hub-written row; one doing `'HAS_COMPONENT'` would miss every backfill row. This is silent-failure territory.

**2. `has_fault` vs `has_fault_code` — same concept, different strings.** `kg_writer.register_fault_code()` writes `has_fault`. The DB has 5 `has_fault_code` rows from Hub. If the deferred has_fault backfill runs against the current schema as-is, it will create a **third edge type** for the same concept, splitting the graph further. **This blocks the has_fault backfill task** until the two writers agree on a string.

The 2026-05-07 spec did not raise this — it predates the Hub writer's relationship contributions. The spec's § 4 "Action item 3" reserved `MEASURES` and `LOCATED_ON` for future use; the DB now has `LOCATED_IN` (note: `_IN` not `_ON`). Drift is observable in production data.

---

## Properties JSONB richness

Of 84 rows, two have empty `properties`: 1 × `area`, 1 × `line`. The other 82 carry data. This is structurally aligned with the 2026-05-07 spec § 3 finding that `properties` is the MIMOSA `Attribute/AttributeSet` mechanism — but the *content* is unbounded and unvalidated. Sample from a `work_order` row:

```
{
  "status": "open",
  "priority": "medium",
  "equipment_id": "b2a90691-7baf-4a8f-b7e3-d2adfed5bdd6",
  "work_order_number": "MIRA-20260428-E97F"
}
```

No `failure_mode`, `failure_cause`, `failure_effect`, or `detection_method` (ISO 14224 Annex D). No `ne107_status` (NAMUR NE 107). No `condition_state` (ISO 55000). These are the same gaps the 2026-05-07 spec called out — they remain unaddressed. The properties-richness benchmark is unchanged.

---

## Updated compliance matrix (delta since 2026-05-07)

Only standards with changes are shown. **No new green, no new red since 2026-05-07.** Several reds got slightly worse because of the regression.

| Standard | Layer 1: UNS Path | Layer 2: Knowledge Graph | Δ since 2026-05-07 |
|---|---|---|---|
| **ISA-95** | ✅ | ⚠️ (path stops at Level 6 + relationship-type case drift) | naming inconsistency surfaced |
| **ISO 14224** | ⚠️ | ⚠️ (still no structured failure-mode attributes; 269 has_manual lost) | regressed |
| **MIMOSA CCOM** | ⚠️ | ⚠️ (InfoSource audit weakened — has_manual edges with `source_chunk_id` deleted) | regressed |
| **NAMUR NE 107** | N/A | ❌ (no `ne107_status` field; not started) | no change |
| **OPC UA** | ⚠️ | ⚠️ (Class/Instance gap unchanged; relationship-type case drift adds friction for browseable consumers) | naming inconsistency surfaced |

---

## Punch list — re-prioritized for 2026-05-23

### P0 — incident-response (before any more KG writes)

1. **Root-cause the 269-row deletion.** Pull every `apply-migrations.yml` run between 2026-05-19 22:50 and 2026-05-23 12:43; verify what (if any) migration touched `kg_entities` or `kg_relationships`. If none, audit prod Neon access logs for hand-run `DELETE`/`TRUNCATE`. The deletion mechanism must be understood before re-running PR #1443's backfill — otherwise the same vector will wipe the re-do.
2. **Add a kg_relationships canary** to `prod-readiness-check.yml` or a new workflow: alert if total rows drop by >10% between consecutive scheduled runs. The current 269-row loss went undetected for 4 days only because the next session looked.

### P1 — unblock the has_fault backfill

3. **Reconcile `has_fault` vs `has_fault_code`.** Either rename in `kg_writer.register_fault_code()` to match Hub's `has_fault_code`, or migrate the 5 Hub rows to `has_fault`. The former is one line; the latter is a one-time SQL update. The two-string status is silent-failure prone for any reader. Once chosen, document in `.claude/rules/uns-compliance.md`.
4. **Add CHECK constraint or lookup table for `relationship_type`.** Whichever convention wins (upper or lower), a database-side guard prevents drift from re-occurring. The current 10-type sprawl is the consequence of having no guard.
5. *Then* run the has_fault backfill (443 distinct fault_codes available). Estimated edges: ~443 if the slug-normalized join hits at >95% (db-inspect now contains the verification query — pending the workflow re-run with the cast fix in this PR).

### P2 — close the vocabulary contract gap (the actionable headline)

6. **Add a shared `entity_type` enum or lookup table.** The 11 types in DB include MVP-essential ones (`work_order`, `component`, `plc_tag`, `asset`, `site`, `area`, `line`) that `kg_writer.py` doesn't know exist. Decide on the authoritative writer (probably `mira-hub`'s schema for tenant/site/area/line/component/plc_tag/work_order, `mira-crawler` for equipment/manual/fault_code). Document in this file or as a CHECK.
7. **Document the Hub writer's path builders** for `work_order` and `manual`. Hub-created rows are NULL on `uns_path` (16 work_orders, 12 manuals). The Hub doesn't import `mira-crawler/ingest/uns.py`; it needs either an import or a local mirror. Both options are <50 LOC.

### P3 — graph-level schema additions from the 2026-05-07 spec

These [MVP] items from the 2026-05-07 spec § Recommendations have **not shipped** in the 16 days since:
- § 5: `properties.ne107_status` on fault_code (4 values, unstructured fault triage) — **not started**
- § 6: `properties.condition_state` on equipment (asset-health surface) — **not started**
- § 7: `TRIGGERS_PM` relation type (NE 107 → PM workflow) — **not started**

These are all JSONB-field or new-relation-type additions — no migration required for #5/#6. They unlock ISO 14224 § Annex D and NAMUR NE 107 compliance with minimal effort. Recommend bundling all three into a single PR after P0–P1 close.

### P4 — already-known gaps unchanged

The 2026-05-07 spec's other [Post-MVP] items (subunit/maintainable_item split, equipment_class entity, work_cell segment, CCOM XML export) remain post-MVP. No empirical signal changes their priority.

---

## What is NOT a finding

For the record, things that are *fine* (so future addenda don't re-litigate them):

- **RLS is correctly enabled** on both `kg_entities` and `kg_relationships` (verified 2026-05-23, identical policy as 2026-05-19). The `app.current_tenant_id` setting-based qual is intact.
- **Index coverage is good.** 11 indexes on `kg_entities` including gist on `uns_path` and a unique on `(tenant_id, entity_type, name)`; 11 on `kg_relationships` including the dedup unique. Read performance is not a bottleneck.
- **Schema columns match ADR-0013 hub-001 shape** (`source_id` / `target_id` / `relationship_type`). PR #1446's amendment is durable; the canonical-schema confusion is resolved.
- **knowledge_entries did not drop** (83,542 in both runs). The vector store is healthy; the regression is graph-only.

---

## Cross-references

- Parent spec (design-level standards alignment): `docs/specs/uns-kg-standards-compliance.md`
- Schema authority (2026-05-19 ADR amendment): `docs/adr/0013-uns-kg-schema-canonicalization.md`
- Path builders (authoritative): `mira-crawler/ingest/uns.py`
- KG writer (engine side, 3 entity types): `mira-crawler/ingest/kg_writer.py`
- Hub migrations (multiple entity types, unknown writer entry point): `mira-hub/db/migrations/021_namespace_builder.sql`, `025_kg_entities_natural_key.sql`, `026_kg_entities_dedupe_and_constraint.sql`, `027_ai_suggestions.sql`
- db-inspect workflow (probes used): `.github/workflows/db-inspect.yml`
- 2026-05-19 inspect: workflow run 26130051449
- 2026-05-23 inspect: workflow run 26332999674

---

*This addendum is data-driven and time-stamped. When the prod KG state changes meaningfully (post-incident remediation, new writer paths, new entity types), regenerate the empirical sections against fresh db-inspect output. Do not rewrite the 2026-05-07 parent spec to reflect operational drift — that spec is the design contract and should remain stable.*
