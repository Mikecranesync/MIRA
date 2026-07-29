# DriveSense Manual-Keypad — Gap Report

> **Status:** Discovery. Maps the current repo to the desired service-pack / keypad-navigation
> product. Companion to `drivesense_manual_keypad_prd.md` and `drivesense_service_pack_schema_proposal.md`.
> **Grounded against** the `mira-drivesense-obj` worktree (main + `DriveDiagnostic` #2486, HEAD
> `5b5f6697`) via two read-only repo scouts + `docs/drive-commander/pack-construction-and-observability.md`.
> Every path below was verified to exist (or verified absent) in that worktree.

**Legend:** ✅ Built (shipped, runtime-wired) · 🟡 Partial · ❌ Missing · ⚠️ Risky · ⏸ Deferred ·
🚫 Do-not-build-yet.

---

## 1. Executive tiers

### ✅ Built
| Capability | Evidence |
|---|---|
| `DriveDiagnostic` structured object, both surfaces render it | `mira-bots/shared/live_snapshot.py` (`build_drive_diagnostic`, `render_machine_evidence`, `assess_from_paths`); `test_drive_diagnostic.py` |
| `DiagnosticCard` + `build_cards` (derived, cited, never stored) | `drive_packs/cards.py`; `test_drive_pack_cards.py` |
| `TemplateReader` Protocol + `FaultCodesTemplateReader` | `drive_packs/cards.py`, `drive_packs/template_reader.py` |
| GS10 fault card wired at runtime (offline `manual_cited`) | `drive_fault_intel.py`; `test_live_fault_card_wiring.py` |
| Pack schema/loader + GS10 `pack.json` + Hub byte-identical twin | `drive_packs/{schema,loader}.py`, `packs/durapulse_gs10/pack.json`, `mira-hub/src/lib/drive-packs/`; `test_drive_pack_hub_copy_sync.py` |
| Read-only shipping gate (AST scan of `drive_packs/**`) | `test_drive_packs_readonly.py` |
| KB ingest + retrieval (`knowledge_entries`, BM25 + vector) | `mira-crawler/ingest/`, `mira-hub/src/lib/manual-rag.ts`, `neon_recall.py` |
| **PDF table detection at ingest** (row-preserving markdown, `chunk_type="table"`) | `mira-crawler/ingest/converter.py`, `chunker.py` |
| Chunk-ID-level citation linkage | `component_template_sources.source_document_id`, `kg_entities/kg_relationships.source_chunk_id` |
| Provenance vocabulary enforced (`bench_verified`/`manual_cited`) | `drive_packs/loader.py::_VALID_PROVENANCE`, `schema.py` |

### 🟡 Partial
| Capability | State | Gap |
|---|---|---|
| Fault-table extraction | Regex extractor exists (`extractors/fault_codes.py`, fixed conf 0.85), feeds KG | Production fault data is **hand-curated** (`seed_fault_codes.py`, `drive_fault_intel.py`) with placeholder provenance (`page_num=0`, `source_chunk_id=''`) — not machine-extracted |
| `fault_codes` DB table | Exists + seeded (migration 002, `seed_fault_codes.py`) | **Not read at runtime** — the card path uses the offline `drive_fault_intel.py` duplicate; DB-backed reader deferred |
| `component_templates` for GS10 | Schema + LLM-cascade builder exist (`016_*`, `tools/build_component_template.py`) | "Appears to have only been dry-run" — no confirmed committed GS10 row; `page_numbers` never populated by the automated extractor |
| Page-level citation | Real PDF pages **on Path A** (`mira-crawler` pdfplumber, `page_num=page_idx+1`) | Path B (`mira-core/mira-ingest`) writes `source_page = chunk_index`; OCR/HTML fallback = `None`; **no discriminator column** to tell them apart |
| Evidence/confidence tiers | Vocabulary exists + enforced | Coarse: one confidence per extraction batch (0.55) or per extractor type (0.85), never per-fact; pack tier has no populated per-fault page |
| GS10 KB chunks | 5 chunks seeded (`tools/seeds/gs10-vfd-knowledge.sql`) | Tenant-scoped (`78917b56-…`), `embedding` NULL pending backfill, not linked to the pack |

### ❌ Missing (the actual work of this phase)
| Capability | Confirmed absent |
|---|---|
| **Structured parameter representation** (`P09.03` → name/purpose/values/default/range) | No `parameters` block in `pack.json`, no `parameter` field in `component_templates`, no parameter columns in `fault_codes` |
| **Keypad navigation representation** (ordered button steps) | Exists in **no** store/schema/dataclass anywhere in the repo |
| **`parameter` KG entity type** | `kg_writer.py` writes only `equipment`/`manual`/`fault_code`; no `parameter` type in code or any migration |
| **Fault↔parameter relationship** | No `relation_type` links a fault to a parameter (neither in-code nor KG) |
| **Parameter-table extractor** | Nothing turns a manual's parameter table into structured rows (register dict is hand-typed) |
| **Keypad-walkthrough extractor** | No code targets button-sequence extraction |
| Register `addr` values in the GS10 pack | All `null` (deferred, correctness-sensitive) |
| DB-backed fault reader | Offline `drive_fault_intel.py` stands in |
| Trace threading (`DriveDiagnostic` → `decision_traces`) | "Card layer and trace layer remain unwired" |
| Slack/Telegram/Hub surfaces rendering `DriveDiagnostic` | Object ready; consumers not built |

### ⚠️ Risky (must be designed around, not ignored)
1. **Page-citation honesty.** `knowledge_entries.source_page` is a real PDF page on one ingest path
   and a chunk index on another, with no column to distinguish them. *Mitigation:* section-level
   citation is the floor; `page` only when provably from the pdfplumber/Docling path or
   hand/bench-verified. Never fabricate. (PRD §12, schema proposal axiom 3.)
2. **Register-addr vs parameter-id conflation.** `live_decode.registers[*].addr` (Modbus telemetry)
   is *not* the keypad parameter number (`P09.03`). Mixing them is a correctness/safety defect.
   *Mitigation:* separate `parameters` block; `register_hint` optional and clearly distinct.
3. **Keypad-step correctness is safety-adjacent.** Wrong steps at an energized drive are a hazard.
   *Mitigation:* mandatory `view_only_warning`, required `confidence_tier`, `manual_cited`→
   `bench_verified` promotion, `mira-industrial-safety` supremacy, no edit execution.
4. **KG-schema ambiguity.** Two competing KG migrations (`docs/migrations/004/005` marked "PLANNED —
   do not run" vs live `mira-hub/db/migrations/001_knowledge_graph.sql`). *Mitigation:* first slice
   uses in-pack `related_faults[]` (Layer A); the KG edge (Layer B) is gated on resolving this.
5. **Tenant-scoped GS10 KB chunks.** The seed chunks belong to `78917b56-…`; packs have no tenant
   concept. *Mitigation:* first slice hand-curates the pack data offline (no KB-id pointers), exactly
   as `drive_fault_intel.py` does; KB linkage is a later, tenant-aware step.
6. **Auto-extraction accuracy.** A parameter/keypad extractor over manual tables will make mistakes.
   *Mitigation:* extraction is a *later* phase producing `proposed` cards that a human validates
   before deploy (train-before-deploy); the first slice is hand-curated, not extracted.

### ⏸ Deferred (real, valuable, explicitly later)
- `parameter` KG entities + fault↔parameter edges (Layer B).
- DB-backed reader over `fault_codes` (and, later, over a parameter store).
- Auto-extraction pipeline for parameter/keypad/fault tables (parsing plan).
- Register `addr` population + `knowledge.*` id-pointers + `confidence_for()`.
- Desktop fleet console / mobile point-of-service connector (ADR-0025, separate track).
- Trace threading (`decision_traces` — engine + Hub migration).

### 🚫 Do-not-build-yet
- Parameter/keypad **writes or edit execution** — never in beta.
- A full auto-extraction pipeline **as a precondition** for value.
- A complete **KG** before shipping the in-pack link.
- **Slack/Telegram** keypad rendering until the adapter layer is confirmed ready.
- A **giant GUI**.

---

## 2. Focus-area assessment (as requested)

| Focus area | Verdict | Note |
|---|---|---|
| Manual parsed into KB | 🟡 Partial | KB + table detection work; GS10 chunks tenant-scoped/unembedded, not pack-linked |
| Manual represented in KG | 🟡 Partial | `equipment`/`manual`/`fault_code` entities + `source_chunk_id` FKs exist; **no `parameter` entity, no fault↔parameter edge** |
| Structured parameter data | ❌ Missing | The core new work — no representation anywhere |
| Keypad navigation extraction | ❌ Missing | No schema, no extractor, no data |
| Fault-to-parameter linking | ❌ Missing | Neither in-code nor KG; first slice adds in-pack `related_faults[]` |
| Citations | 🟡 Partial | Chunk-ID ✅; page-level best-effort/source-path-dependent ⚠️ |
| Traceability | 🟡 Partial | `decision_traces` real, but card/parameter citations not threaded in |
| UI rendering | 🟡 Partial | Ask-MIRA text render exists for fault cards; parameter/keypad render is new; Hub component later |
| Slack/Telegram/HMI readiness | HMI ✅ / Slack·Telegram ❌ | `DriveDiagnostic` renders on engine + Ignition HMI paths today; Slack/Telegram consumers not built (adapters exist, rendering deferred) |

---

## 3. The one-sentence gap

> Everything from *"drive faulted"* to *"here's what the fault means and what to check first"* is
> **built and live**; everything from *"which parameter governs this and how do I navigate the keypad
> to view it"* is **missing** — because no structured representation of drive parameters or keypad
> steps exists anywhere in the codebase, and that structured layer (not more manual RAG) is exactly
> what this phase adds.

## 4. Cross-references
- `drivesense_manual_keypad_prd.md`, `drivesense_service_pack_schema_proposal.md`,
  `drivesense_manual_parsing_plan.md`, `drivesense_subagent_development_plan.md`,
  `drivesense_technician_keypad_workflow.md`.
- `docs/drive-commander/pack-construction-and-observability.md` (§7.1 roadmap), `docs/adr/0025-*.md`.
