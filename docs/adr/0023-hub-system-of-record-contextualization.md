# ADR-0023: Hub is the System of Record for Contextualization; Offline & Telegram are Ingest Clients

## Status

Accepted — 2026-06-20

**Related:** ADR-0013 (Hub schema canonicalization — Hub owns the product
surface), ADR-0017 (proposal state machine — `proposed → approved` is an admin
action), ADR-0022 (Postgres-first storage).
**Implements:** Phase 0 + Phase 1/2 of
[`docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md`](../plans/2026-06-20-hubv3-contextualization-intake-prd.md).
**Builds on:** PR #2068 (`feat/plc-mapper-gui`) — migration `055_contextualization`
and the `/api/contextualization/*` routes.
**Artifacts:** `mira-hub/src/lib/contextualization/intake-contract.ts` (+ `.schema.json`),
`contracts/contextualization/intake_contract.py`. **Migration:** `056_contextualization_intake`.

---

## Context

Three ingest routes collect contextualization evidence and risk becoming three
separate systems of record:

1. **MIRA Hub / Command Center** (`app.factorylm.com/hub`).
2. **Offline FactoryLM Contextualizer** — Windows desktop app (PR #2068).
3. **Telegram / phone thin client** — photos, nameplates, field notes, docs.

If each platform mints its own assets, sources, UNS nodes, and project models,
the result is duplicate truth and unmergeable state. The HubV3 spec (Mike,
2026-06-20) makes the call: **the Hub is the single system of record; the others
become ingest clients that collect evidence and create proposals.**

The PR #2068 backbone (migration 055: `contextualization_projects`,
`ctx_sources`, `ctx_extractions`; `/import` accepting a `machine_context_bundle.zip`)
proves the offline→Hub loop, but has four gaps for "Hub owns truth" (PRD §4.1):
no sha256 dedup, no asset matching, no import-batch grouping, weak no-overwrite.
This ADR fixes the contract + dedup foundation (Phases 0–2); matching (P3),
approval/no-overwrite (P4), and client alignment (P5–P6) build on it.

## Decision

### 1. One shared **Contextualization Intake Contract**, authored once in three lockstep artifacts

- **TypeScript** (`intake-contract.ts`) — authoritative types + a dependency-free
  `validateIntakeContract()` (no zod; PRD §4 bans framework abstractions).
- **JSON Schema** (`intake-contract.schema.json`) — validation + documentation.
- **Python** (`contracts/contextualization/intake_contract.py`) — stdlib-only
  dataclasses + `validate_envelope()`, in a **neutral top-level `contracts/`**
  package so the offline Contextualizer (`mira-contextualizer`) and Telegram
  client (`mira-bots`) each import it without either module owning it.

The envelope (PRD §2): `contract_version`, `ingest_route ∈ {offline, telegram,
hub_upload}`, `project_hint`, `asset_hints`, `bundle_sha256`, `sources[]` (each
with `source_sha256`, `source_type`, `source_metadata`), `evidence`, `entities`,
`proposed_{signals,uns,i3x,faults,parameters,relationships}`, `provenance`,
`confidence`, and `review_status` (always `proposed` on intake).

### 2. Identity is UUID-first; names are matching evidence

`project_uuid · import_batch_uuid · asset_uuid · source_uuid · source_sha256 ·
evidence_uuid · signal_uuid · uns_node_uuid · relationship_uuid` are identity.
Names, asset numbers, tag names, serials, models, controller IPs, and UNS paths
are **matching evidence**, never the sole key.

### 3. Everything from a client enters as a proposal — nothing is auto-approved

`review_status` is fixed to `proposed` on intake (the validator rejects any
other value). Per ADR-0017, promotion to approved/verified is an admin action.

**Mapping of "everything lands proposed" to the 055 schema (deliberate, surfaced):**
the import **batch** carries `review_status = 'proposed'` (new `ctx_import_batches`
table), and imported tags land in `ctx_extractions.status = 'pending'` — the
existing not-yet-reviewed state. We do **not** add a 5th `'proposed'` value to
the `ctx_extractions` status CHECK, because the review UI (tabs
All/Pending/Accepted/Rejected) only knows `pending|accepted|rejected`; widening
it is P4/P7 work. The invariant honored is the one that matters: **no row enters
`accepted` on intake.** "proposed" == batch `review_status='proposed'` +
extractions `pending`.

### 4. Dedup grain (migration 056, extends 055)

| Grain | Key | Mechanism |
|---|---|---|
| Project | `(tenant_id, bundle_sha256)` | `bundle_sha256` column + partial UNIQUE on `contextualization_projects` |
| Import batch | `(tenant_id, bundle_sha256)` | new `ctx_import_batches` + partial UNIQUE |
| Source file | `(tenant_id, source_sha256)` | `source_sha256` column + partial UNIQUE on `ctx_sources` |

Partial (`WHERE … IS NOT NULL`) so manually-created projects / non-hashed
sources are unaffected. The import endpoint uses `ON CONFLICT … DO NOTHING`
against these indexes (PRD test 3: same source sha256 → no duplicate source row).

`ctx_sources.import_batch_id` (FK → `ctx_import_batches`, `ON DELETE SET NULL`)
groups a submission's sources. `ctx_extraction_asset_matches` is created now
(RLS + grants) but populated in **P3** — its `candidate_asset_id` is a **soft
UUID reference, no FK to `cmms_equipment`** (that full schema is upstream; a hard
FK would couple this migration to it and break a ctx-only test DB).

## Key sub-decisions

1. **`source_sha256` is added to `ctx_sources` even though the task's P1 list
   omitted it.** PRD test 3 is literally "same *source* sha256 does not
   duplicate *source* records" — source-level dedup is impossible without the
   column. The omission is treated as an oversight and corrected; flagged in the
   PR.
2. **`bundle_sha256` UNIQUE on `contextualization_projects` follows the task
   literally** and encodes one-project-per-bundle. PRD §2's longer-term model is
   project→many-batches; that generalization is deferred. Re-import of the same
   bundle is a no-op (existing project + batch reused; duplicate sources skipped).
3. **JSON contract path is additive; the existing multipart-zip path stays.**
   `/import` branches on content-type: `application/json` → intake contract;
   `multipart/form-data` → the existing offline bundle (`parseBundle`). P5
   migrates the offline client to the contract; until then both work.
4. **Hand-rolled validator, no zod.** Keeps the contract portable to the Python
   and JSON twins and honors PRD §4 (no framework over the data path).

## Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Let each client keep its own ingest shape, reconcile in the Hub | Three sources of truth; the exact failure HubV3 exists to prevent. |
| Add `'proposed'` to the `ctx_extractions` status CHECK | Breaks the review UI's `pending/accepted/rejected` model; UI change is P4/P7, out of P2 scope. |
| Hard FK `ctx_extraction_asset_matches.candidate_asset_id → cmms_equipment(id)` | Couples 056 to an upstream schema not in 055; breaks ctx-only ephemeral test DBs. Soft UUID ref + P3 resolution instead. |
| Use zod for validation | New dependency; can't share with the Python/JSON twins; PRD §4 bias against framework abstractions on the data path. |
| Replace the multipart-zip `/import` path | Would break the shipped offline bundle loop before P5 aligns it. Additive content-type branch instead. |

## Consequences

- **Positive.** One envelope, three consumers, validated identically. Re-import
  is idempotent (project/batch/source dedup). Nothing auto-approves. Telegram
  (P6) and the offline client (P5) now have a single shape to target. Asset
  matching (P3) has its staging table.
- **Negative / deferred.** `ctx_extractions` still uses `pending` (not a literal
  `proposed`) — a semantic, not behavioral, gap. One-project-per-bundle is a
  simplification vs PRD §2's project→many-batches. Asset matching, approval/
  publish, and no-overwrite enforcement are P3/P4. The Python twin has no
  consumer until P5/P6 (ships now so they can target it).
- **Numbering.** Migration `056` claimed for this lane; ADR `0023`. If `origin`
  grows a competing `056` before merge, rename with the master-plan's collision
  convention.

## Verification

- `intake-contract.test.ts` — validator accepts a well-formed envelope, rejects
  bad version / route / empty sources / missing source sha256 / non-proposed
  review_status; `intakeContractToImport` maps to insertable rows (all `pending`).
- `import.integration.test.ts` — against ephemeral `postgres:16` with
  `factorylm_app` role, migrations 055+056 applied, UUID tenant under
  `SET ROLE factorylm_app`: same `source_sha256` imported twice → exactly one
  `ctx_sources` row; batch lands `review_status='proposed'`.
- Migration gate: `apply-migrations.yml --dry-run` on staging via the PR's
  `migration-verify.yml` (never prod-first, never a direct staging psql from a
  code session — `docs/environments.md`).
