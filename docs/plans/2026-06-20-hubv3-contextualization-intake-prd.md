# HubV3 — Hub-Centered Contextualization Intake (Phased Build PRD)

**Status:** DRAFT · **Date:** 2026-06-20 · **Source spec:** `HubV3.txt` (Mike, 2026-06-20)
**Builds on:** PR #2068 (`feat/plc-mapper-gui`) — contextualizer bundle + Hub `/api/contextualization/*` + migration `055_contextualization`. This PRD extends that baseline; it does **not** restart it.
**Owner doctrine:** root `CLAUDE.md` (Hub = Command Center, train-before-deploy), `.claude/rules/mira-hub-migrations.md`, `.claude/rules/knowledge-entries-tenant-scoping.md`, `.claude/rules/uns-compliance.md`.

> Gap-analysis sections marked `⟨GAP:…⟩` are filled from 3 read-only inspection agents (Hub state / offline bundle / Telegram). Everything else is derived directly from the spec and is stable.

---

## 1. Problem & Goal

Three ingest routes exist and risk becoming **three separate contextualization systems**:
1. **MIRA Hub / Command Center** — `app.factorylm.com/hub`
2. **Offline FactoryLM Contextualizer** — Windows desktop app (PR #2068)
3. **Telegram / phone thin client** — photos, nameplates, field notes, docs

**Goal:** Make the **Hub the single system of record** for contextualization. Offline + Telegram become **ingest clients** that *collect evidence and create proposals*; the Hub performs the **final merge, approval, publishing, and system-of-record update**.

### Core principle (non-negotiable)
- **Hub owns truth.** Clients collect evidence and create proposals. Hub does final merge/approval/publish.
- Offline or Telegram must **never** become a separate source of truth.
- Offline approval is **field/pre-review**, never final Hub approval.
- **No duplicate** assets, sources, UNS nodes, or project models across platforms.

---

## 2. Architecture Target — Shared Contextualization Intake Contract

All ingest routes submit the **same normalized envelope** to the Hub:

| Field | Meaning |
|---|---|
| `project_hint` | project/workspace hint |
| `asset_hints` | asset identity hints (name, number, mfr, model, serial, controller, IP, UNS path) |
| `source_metadata` | filename, mime, size, captured-at, uploader, location |
| `source_sha256` | content fingerprint (dedup key) |
| `evidence` | extracted evidence blocks (text/OCR/IR), with page/section refs |
| `entities` | normalized entities |
| `proposed_uns` | proposed UNS mappings (ISA-95 ltree) |
| `proposed_i3x` | proposed i3X projections |
| `proposed_faults` / `_parameters` / `_signals` / `_relationships` | domain proposals |
| `provenance` | source → evidence → entity chain |
| `confidence` | per-proposal band |
| `review_status` | always `proposed` / `pending` on intake |
| `ingest_route` | `offline` \| `telegram` \| `hub_upload` |

### Identity model (UUID-first; names are *aliases/matching evidence*, not identity)
`project_uuid · import_batch_uuid · asset_uuid · source_uuid · source_sha256 · evidence_uuid · signal_uuid · uns_node_uuid · relationship_uuid`

Names, asset numbers, tag names, serials, model numbers, controller IPs, UNS paths = **matching evidence**, never the sole key.

### Hub staging storage model (staged contextualization import)
```
Project → Import Batch → Sources → Evidence
       → Proposed Assets → Proposed Signals → Proposed Faults
       → Proposed Parameters → Proposed Relationships
       → Proposed UNS Mappings → Proposed i3X Objects
       → Review Queue → Approved Published Model
```

### Import behavior (the rules engine)
1. Dedup source files by `sha256`.
2. Match assets on: asset number, name, mfr, model, serial, controller type, controller IP, PLC program name, proposed UNS path, source history.
3. **Strong match** → stage proposals under existing asset.
4. **Probable match** → require human confirmation.
5. **No match** → create draft asset proposal.
6. **Never** blindly overwrite approved/verified Hub data.
7. Everything from external/offline/thin clients enters as **proposed/pending review**.
8. **Hub approval required** before publishing to project model, UNS, i3X, or MIRA KB.

---

## 3. Bundle / Export Contract (offline → Hub)

Deterministic `machine_context_bundle.zip` containing:
`manifest.json · profile.json · sources.json · evidence.json · uns.json · i3x.json · kg_entities.json · kg_relationships.json · signals.csv · fault_catalog.json · parameters.json · scorecard.json · review.json · documents/*.json (when allowed) · report.md · IMPORT.md`

**Export modes:**
1. **Full Evidence Bundle** — document IR/snippets/source refs + rich provenance.
2. **Sanitized Structured Context Bundle** — excludes raw documents, optionally strips sensitive snippets; keeps derived structured context, hashes, source refs, fault mappings, signal roles, UCUM units, ISO-14224 faults, UNS/i3X proposals.
   - **Naming:** call it *"sanitized structured context" / "derived machine context"* — **not** "anonymous" (it isn't).

**Standards backbone (keep):** UNS / ISA-95 hierarchy · CESMII i3X projections.
**Domain enrichment:** ISO 14224 fault shape (`fault_code → failure_mode → failure_mechanism/cause → maintenance_action/next_check`) · UCUM unit quantities (`symbol → UCUM code → quantity kind`).

---

## 4. Current-State Gap Analysis (from inspection agents)

### 4.1 Hub contextualization (worktree `MIRA-pr2068/mira-hub`)  *(inspected — partial backbone EXISTS)*
- **Migration `055` tables (all `tenant_id UUID`, RLS + `GRANT … factorylm_app`):**
  - `contextualization_projects` (id, tenant_id, name, description, status: active|completed|archived)
  - `ctx_sources` (project_id FK, source_type: l5x|st|plcopen|csv|manual|other, file_name, file_path, status: pending|processing|done|error, error_message)
  - `ctx_extractions` (project_id, source_id, tag_name, roles TEXT[], uns_path_proposed, i3x_element_id, evidence_json JSONB, confidence NUMERIC, status: pending|accepted|rejected)
- **Routes (`/api/contextualization`):** GET/POST projects · POST `/import` (bundle: unzip→parseBundle(manifest+review)→**new** project " (imported)" + sources + extractions) · POST `/[id]/sources` (upload→disk→`ctx_sources`→spawn `ctx_parse_worker.py`) · GET `/[id]/extractions` · PATCH `/[id]/extractions/[eid]` (status) · POST `/[id]/promote` (accepted → `kg_entities` type=signal approval_state=proposed + paired `ai_suggestions` type=kg_entity status=pending) · GET `/[id]/export?format=uns|i3x`.
- **Worker:** `ctx_parse_worker.py` runs `mira_plc_parser.pipeline.run()`, writes extractions with mapped confidence.
- **Review/approval today:** per-tag `ctx_extractions.status` (UI tabs All/Pending/Accepted/Rejected) **+** generic Hub `ai_suggestions`/`/proposals` queue via promote. `kg_entities.approval_state` enum exists (proposed|verified|rejected|needs_review|deprecated, mig 029).
- **CRITICAL GAPS for "Hub owns truth":**
  1. **No sha256 dedup** — re-importing the same bundle duplicates project+sources+extractions (fresh UUIDs; worker's `ON CONFLICT DO NOTHING` is inert).
  2. **No asset matching** — zero join to `cmms_equipment`; no strong/probable/none; tags float untethered. (`cmms_equipment` full schema is upstream, not in 055.)
  3. **No import-batch table** — each upload is a *separate project*; promote is immediate (no batch-level "hold for review then publish").
  4. **Weak no-overwrite** — promote does **not** read `kg_entities.approval_state`; it relies on `ON CONFLICT DO NOTHING`, silently skipping with no reason. Not approval-aware.
- **⇒ Phase sizing:** P1 = *extend* 055 (add `bundle_sha256` UNIQUE on projects, `ctx_import_batches`, `ctx_extraction_asset_matches`) — not a from-scratch staging model. P2 = add sha256 to `/import` + align it to the contract (endpoint exists). **P3 (asset matching) is the genuinely greenfield, highest-effort phase** (needs `cmms_equipment` match keys: name/serial/model/controller/IP/UNS path). P4 = add batch gate + make promote approval-aware (read `approval_state`, return skip reasons). Publish-to-UNS/i3X already exists via promote+export.

### 4.2 Offline Contextualizer bundle  *(inspected — further along than expected)*
- **Bundle files:** 15/16 already emitted (`manifest/profile/sources/uns/i3x/kg_entities/kg_relationships/signals.csv/fault_catalog/parameters/scorecard/review/report.md/IMPORT.md/documents/*.json`). **Only `evidence.json` MISSING** — evidence is currently embedded in `review.json` + `documents/*.json`, not aggregated.
- **Manifest already carries:** `asset_match` (machine/asset_type/mfr/model/serial/controller/IP/plc_program/proposed_uns_path/source_file_hashes), `import{intent: existing_asset|new_asset, policy: "propose_only", hub_asset_id}`, `counts`, `scorecard`, `sources[]` with sha256.
- **Profile (`.miraprofile`):** 14 identity fields incl. customer/site/area/line + controller/IP/PLC-program + `proposed_uns_path` + `hub_asset_id`; carries `sources[]` (with sha256 + extracted IR + decisions) and `exports[]` history.
- **Identity UUIDs present:** `project_id`, `source_uuid`, `extraction_uuid`, `export_uuid`, `source_sha256`. **Missing:** `evidence_uuid`, `signal_uuid`, `uns_node_uuid`, `relationship_uuid`, `import_batch_uuid` (Hub mints batch on ingest).
- **Export modes:** `format=uns|i3x|bundle|profile`. **NO sanitized/derived-context mode** — all exports include raw `documents/*.json`. → sanitized mode is greenfield.
- **⇒ Phase 5 is LIGHT:** add `evidence.json` (or alias existing embedded evidence into an aggregate) + the 4 missing entity UUIDs + a sanitized export mode. The bundle contract is otherwise ~done.

### 4.3 Telegram / thin client  *(inspected — GREENFIELD for intake)*
- **Captures today:** photos, PDFs, voice notes, field-note captions, nameplates (vision via `qwen2.5vl:7b`).
- **Where it goes:** `mira-bots/telegram/bot.py` → `mira-ingest` `/ingest/photo` (`{asset_tag, image}`) and `/ingest/document-kb` (`{file, filename, equipment_type, tenant_id}`) → Open WebUI KB + local SQLite. **Never touches the Hub.**
- **Hints/fingerprint:** `asset_tag` (caption split — partial) ✓ · `tenant_id` ✓ · timestamp ✓ (set by mira-ingest) · uploader **logged but not POSTed** · **sha256 only for PDFs inside mira-ingest, never submitted upstream** · project hint ❌ · location ❌ · full asset hints (mfr/model/serial/controller/IP/UNS) ❌.
- **No normalized envelope anywhere** — nothing builds the §2 intake shape. mira-ingest endpoints (`/ingest/photo`, `/ingest/document-kb` w/ per-tenant sha256 dedup, `/ingest/search*`, `/ingest/scrape-trigger`) write to KB/SQLite, not a Hub staging schema.
- **⇒ Phase 6 is fully greenfield**, but small: Telegram needs only to compute a sha256, attach project/asset hints + uploader + timestamp (+ location if available) + OCR-or-raw, and POST the Phase-0 contract to the Hub import endpoint — replacing its current `{asset_tag, image}`. It owns no truth. **Blocked on P0 (contract) + P2 (import accepts contract).** No Telegram code changes until then.

> **Reconciliation:** the Hub agent (scanning the `#2068` worktree) found `055` + `/api/contextualization/import` **present**; the Telegram agent (scanning **main**) reported them absent. Both correct — the backbone exists on `feat/plc-mapper-gui` but is **unmerged to main**. HubV3 therefore has a hard prerequisite: **#2068 merges first** (or HubV3 branches off it), else P1–P4 have nothing to extend.

---

## 5. Phased Build Plan

> Each phase is independently shippable, has a hard acceptance gate, and maps to specific subagents + design skills (see companion build plan: `2026-06-20-hubv3-build-plan.md`). Phases are ordered by dependency; the Hub backbone (P1–P4) must land before client alignment (P5–P6).

> **Prerequisite (P0 blocker):** PR **#2068** (`feat/plc-mapper-gui`) carries `055` + the `/api/contextualization/*` routes + the offline bundle. HubV3 **extends** that surface, so either **#2068 merges to main first**, or the HubV3 feature branch is cut **from `feat/plc-mapper-gui`**. Do not start P1 against `main` — the tables don't exist there yet.

### Phase 0 — Contract Definition (design, no schema)
- Define the **Contextualization Intake Contract** once, in three artifacts kept in lockstep: TS type (`mira-hub/src/lib/contextualization/intake-contract.ts`), Python dataclass (shared by offline + telegram), JSON Schema (validation + docs).
- ADR: "Hub is system of record; offline/Telegram are ingest clients."
- **Gate:** contract reviewed against §2 envelope + §3 bundle; ADR merged.

### Phase 1 — Hub Staging Schema
- Migration extending/aligning `055` to the full staging model (§2): import batches, sources (sha256 unique), evidence, proposed_{assets,signals,faults,parameters,relationships,uns,i3x}, review_queue — each with `approval_state ∈ {proposed,probable,approved,rejected,needs_review}`.
- Tenant scoping + RLS + `GRANT … TO factorylm_app` per `mira-hub-migrations.md` (match `tenant_id` type to the asset table it joins; UUID-only tenants authenticate).
- **Gate:** migration dry-run on staging green; tables + RLS verified with a UUID tenant.

### Phase 2 — Hub Import Endpoint + sha256 Dedup
- Align import endpoint to accept the Phase-0 contract; **everything lands as `proposed`**.
- Source dedup by sha256 (same source → no duplicate row).
- **Gate:** tests — contract accepted; same-sha256 no-dup; all rows `proposed`.

### Phase 3 — Asset Matching (strong / probable / none)
- Matching engine over name/number/mfr/model/serial/controller/IP/PLC-program/UNS-path/source-history.
- Strong → stage under existing asset; probable → flag `needs_confirmation`; none → draft asset proposal.
- **Gate:** tests — strong stages under existing; none creates draft; probable requires confirmation.

### Phase 4 — Review Queue + Approval + No-Overwrite
- Review queue (list + approve/reject) in Hub UI; approval **publishes** to project model + UNS + i3X + MIRA KB.
- Hard guard: imported proposals **never** overwrite `approved/verified` data.
- **Gate:** tests — UNS/i3X stay `proposed` until approved; approved data untouched by re-import.

### Phase 5 — Offline Bundle Alignment  *(LIGHT — bundle is ~95% done)*
- Add the **only missing file `evidence.json`** (aggregate the evidence currently embedded in `review.json`/`documents/*.json`); add the 4 missing entity UUIDs (`evidence_uuid`, `signal_uuid`, `uns_node_uuid`, `relationship_uuid`). `scorecard.json`, `asset_match`, `import{intent,policy}`, source sha256 **already exist** — don't rebuild them.
- Implement **full vs sanitized** export mode (greenfield — today every export ships raw `documents/*.json`).
- **Gate:** tests — sanitized bundle has no raw document payloads; full bundle preserves provenance; offline import → staged batch.

### Phase 6 — Telegram Thin Evidence Client
- Telegram submits the **same intake envelope** (photo/doc + project hint + asset hint + field note + timestamp + uploader + location + sha256 + OCR-if-available-else-raw).
- Routes through the same Hub import/staging pipeline; owns no truth.
- **Gate:** test — Telegram source enters the same import pipeline as offline/direct; lands `proposed`.

### Phase 7 — Shared UI/UX Alignment
- Same labels/mental model in Hub + offline: Projects/Workspaces · Assets/Machines · Sources · Evidence · Extracted Signals · Fault Catalog · Parameters · UNS Map · Scorecard · Review Queue · Import/Export History.
- Offline = "the offline experience of the Hub ingest path," not a different product.
- **Gate:** label parity audit (screenshot rule); designer review.

### Phase 8 — Tests + Garage Conveyor Demo
- Full test matrix (§6) green.
- Demo fixture: **Garage Demo / Micro820 Conveyor** — offline build → bundle → Hub import → batch/dedupe/match/stage → review → approve → publish → available to MIRA.
- Docs: Hub-as-SoR explainer + demo instructions.
- **Gate:** demo acceptance (§7) passes end-to-end; docs merged.

---

## 6. Test Matrix (acceptance)

1. Hub accepts shared contextualization intake contract.
2. Offline bundle imports into Hub as an import batch.
3. Same source sha256 does not duplicate source records.
4. Existing asset match stages proposals under existing asset.
5. No asset match creates draft asset proposal.
6. Probable match requires confirmation.
7. Imported proposals do not overwrite approved Hub data.
8. UNS/i3X remain proposed until approved.
9. Telegram/photo source enters same import pipeline as offline/direct upload.
10. Sanitized bundle does not include raw document payloads.
11. Full evidence bundle preserves provenance.
12. Conveyor demo fixture imports successfully → non-empty staged signals, UNS mappings, i3X objects, scorecard, and review queue.

---

## 7. Demo Acceptance Target — Garage Conveyor

**Flow:**
1. Offline: create/open profile "Garage Demo / Micro820 Conveyor".
2. Add evidence: Micro820/CCW export, PLC/tag CSV, GS10/GS11 drive manual PDF, nameplate/field photos, wiring diagram/screenshots.
3. Offline parses locally → proposed: asset identity, controller identity, signals/tags, UNS mappings, i3X projections, drive parameters, fault catalog, UCUM units/ranges/setpoints, ISO-14224 faults, scorecard.
4. Export `machine_context_bundle.zip`.
5. Import into Hub project.
6. Hub: create import batch → dedupe sources → match existing conveyor asset or propose new draft → stage signals/faults/parameters/UNS/i3X as pending review → show review queue → allow final approval → publish approved context into project model → make available to MIRA.

**Real fixtures on disk (verified):** `MIRA/plc/Micro820_v4.1.9_Program.st`, `MIRA/plc/MbSrvConf_v4.xml`, `Downloads/gs10usermanual.pdf`.

---

## 8. Deliverables (from spec)

- Code: shared Hub-centered import/staging flow.
- Docs: Hub as system of record; offline/Telegram as ingest clients.
- Demo instructions: Garage Demo / Micro820 Conveyor.
- Tests passing.
- Commit + push on the appropriate feature branch.

## 9. Non-Goals / Guardrails

- ❌ A separate offline truth system. One Hub-centered system, many ingest clients.
- ❌ Offline/Telegram final approval. Field/pre-review only.
- ❌ Duplicate assets/sources/UNS nodes/project models.
- ❌ Auto-promote `proposed → approved` (admin action only — ADR-0017).
- ❌ Overwrite approved/verified Hub data on import.
- ❌ "Anonymous" bundle naming — it's "sanitized structured context".
