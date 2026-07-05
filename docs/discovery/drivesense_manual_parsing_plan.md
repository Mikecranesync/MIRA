# DriveSense Manual Parsing Plan — Fault / Parameter / Keypad Extraction

> **Status:** Discovery. Describes how a drive manual becomes the structured cards in
> `drivesense_service_pack_schema_proposal.md`. **This is a *later* phase** — the first product
> slice hand-curates GS10 data (`manual_cited`), exactly as `drive_fault_intel.py` did for fault
> cards. Extraction is how the *second and later* families scale, not a precondition for value.
> **Grounded against** the `mira-drivesense-obj` worktree via the manual-parsing repo scout.

---

## 1. What the ingest pipeline already gives us

The `mira-crawler` Celery pipeline (`tasks/ingest.py::ingest_url`) is a real, working asset:

- **`converter.py::extract_from_pdf`** (pdfplumber default) emits blocks with a **real PDF page**
  (`"page_num": page_idx + 1`, line 137) and runs `page.extract_tables()`, emitting **table blocks**
  as row-preserving GitHub-flavored markdown tagged `chunk_type="table"` (`_format_table_markdown`).
  Tables are **not** flattened into prose.
- **`chunker.py::chunk_blocks`** carries `page_num`/`section` through unchanged and splits long tables
  at row boundaries with the header re-prepended (`_detect_table_regions`, `_split_table`).
- **`store.py::insert_chunk`** writes `page_num → knowledge_entries.source_page` and puts
  `chunk_index`/`section`/`chunk_type` in the `metadata` JSONB.
- **`extractors/fault_codes.py`** already regex-extracts `(code, ~80-char snippet)` pairs from chunk
  text (prose or table alike) and densifies the KG via `kg_writer.register_fault_code`.

**Implication:** the raw material for structured extraction — page-numbered, section-tagged,
row-preserving table chunks — **already exists**. The gap is a parser that turns those table chunks
into `ParameterCard` / `KeypadNavigationCard` rows, plus honest citation handling.

## 2. The citation-honesty problem (design around it, don't ignore it)

Two ingest paths write `knowledge_entries.source_page` with **different meanings** and **no
discriminator column**:

| Path | Code | `source_page` holds |
|---|---|---|
| A (Celery, pdfplumber/Docling) | `mira-crawler/ingest/store.py:125` ← `converter.py:137` | **real PDF page** |
| B (legacy photo/RAG ingest) | `mira-core/mira-ingest/db/neon.py:399` | **chunk index** (not a page) |
| OCR / HTML fallback | `extract_from_tika`, `extract_from_html` | `None` |

Hand-curated data is worse: `seed_fault_codes.py` writes `page_num=0`, `source_chunk_id=''`.

**Rules for this plan (enforced by the schema proposal's Citation model):**
1. **Section is the citation floor.** Always capture a `section` string (present in chunk metadata).
2. **A `page` is emitted only when provable** — the row came through Path A (pdfplumber/Docling) or a
   human/bench verified it against a known page. Otherwise `page = null`.
3. **Record which path produced a row.** The extractor should stamp its own confidence and a
   `source_path` marker on the cards it produces, so a consumer can trust a page number. (A tiny
   `metadata.ingest_path` on new chunks, or deriving it from the extractor, closes this — see §6.)
4. **Never let a hand-typed placeholder (`page_num=0`) surface as a real page.** Treat `0`/`''` as
   "no page," cite section-level.

## 3. Extraction targets, in dependency order

### 3.1 Parameter tables → `ParameterCard`
- **Input:** `chunk_type="table"` chunks from the manual's parameter-list chapter (GS10: the P-group
  tables). Columns are typically `Pxx.yy | Name | Range | Default | Unit | (setting meanings)`.
- **Method:** a new extractor parallel to `extractors/fault_codes.py`, operating on table chunks
  (structured input, not free prose). Map columns → `ParameterCard` fields; parse setting-value rows
  into `value_meanings[]` only when the table documents them.
- **Output:** `proposed` `ParameterCard`s with `source_citation` (section + provable page),
  `provenance_tier="manual_cited"`, a computed `confidence_tier`.
- **Caveat:** column layouts differ per OEM; the first extractor targets the **Automation Direct GS10
  manual layout specifically**, not a universal parser. Generalization is a later concern.

### 3.2 Fault tables → fault-card enrichment (already partly built)
- The regex extractor + hand-curated `drive_fault_intel.py` already cover GS10 faults. The extraction
  path here is to **replace the hand-curated dict** with table-extracted rows carrying real
  `source_citation`s, and to derive `related_faults` linkage from the parameter tables (a parameter's
  fault reference, e.g. P09.03 → CE10).

### 3.3 Keypad walkthroughs → `KeypadNavigationCard` (the hard one)
- **Input:** the manual's "keypad operation / how to view a parameter" section — usually **prose with
  small figures**, not a clean table. This is the least structured source.
- **Method (staged):**
  1. *First families: hand-curated.* A human reads the keypad chapter and writes `keypad_steps[]`
     with a section citation. This is the honest, safe starting point (matches `drive_fault_intel.py`).
  2. *Later: LLM-assisted extraction* over the keypad-section chunks, producing `proposed` cards that
     a human **validates on the bench** before promotion to `bench_verified`. Never auto-verify keypad
     steps — they're safety-adjacent.
- **Output:** `proposed` `KeypadNavigationCard`s, mandatory `view_only_warning`, `confidence_tier`
  starting `low`/`medium`, promoted to `bench_verified` after a bench pass.

## 4. Where extracted data lands

- **Manual text:** stays in `knowledge_entries` (unchanged — the law).
- **Structured parameter/keypad cards:** into the family's **`pack.json` v2 blocks** (`parameters[]`,
  `keypad_navigation[]`) — offline, read-only-gate-covered, shipped in image (schema proposal §7).
  Rationale: this structured shape exists in no store; putting it in the pack avoids a new migration,
  a tenant decision, and a DB dependency for first value.
- **Citations:** `Citation` carries `chunk_id` (→ `knowledge_entries.id`) when a source chunk exists,
  plus section and provable page.
- **Fault↔parameter links:** in-pack `related_faults[]` first (Layer A); KG edges later (Layer B),
  reusing `kg_*.source_chunk_id` for evidence once the KG-schema ambiguity is resolved.

## 5. Confidence & evidence tiers (honest, coarse)

- Pack tier stays the closed set `bench_verified` | `manual_cited`.
- `confidence_tier` on cards is a **coarse band** (`low`/`medium`/`high`) — not a fake calibrated
  float. Do not reuse the extractor constants (0.55/0.85) as if they were per-fact scores.
- A keypad card is `manual_cited` + (`low`|`medium`) until a bench pass promotes it to
  `bench_verified` + `high`.

## 6. The one small infra improvement worth doing early

Add a **provenance discriminator** so page citations are trustworthy: stamp `metadata.ingest_path`
(`"pdfplumber"` / `"tika_ocr"` / `"chunk_index"`) on new `knowledge_entries` rows (a one-line change
in each `store` path). Then a citation can *prove* its page is real. This is optional for the
hand-curated first slice but is the unlock for trustworthy auto-extracted page citations. Until it
lands, extraction cites section-level unless it can independently confirm the page.

## 7. Phasing

| Phase | Scope | Provenance |
|---|---|---|
| **P0 (this product phase)** | Hand-curate GS10 parameter + keypad cards for the CE10→P09.03 case (+ a few params) into `pack.json` v2 | `manual_cited`, section-cited |
| **P1** | Add `metadata.ingest_path` discriminator; parameter-table extractor for the GS10 manual layout → `proposed` cards | `manual_cited`, provable page when Path A |
| **P2** | LLM-assisted keypad-walkthrough extraction → `proposed` cards; human bench validation → `bench_verified` | mixed, promoted on bench |
| **P3** | Generalize to PowerFlex 525 layout; KG Layer B fault↔parameter edges | admin-verified |

**P0 requires no extraction at all** — it is the hand-curated fixture the PRD's first slice ships.
This plan is the roadmap for P1+ so scaling to more families doesn't stay hand-work forever.

## 8. Out of scope for this plan
- A universal cross-OEM table parser (start OEM-specific).
- Auto-verifying keypad steps (always human-in-the-loop for safety-adjacent guidance).
- Re-ingesting or migrating existing `knowledge_entries` rows.
- Editing the KB or KG schemas (the KG edge work is gated on the separate schema decision).

## 9. Cross-references
- `drivesense_service_pack_schema_proposal.md` (the target shapes), `drivesense_manual_keypad_prd.md`,
  `drivesense_manual_keypad_gap_report.md`, `drivesense_subagent_development_plan.md`.
- `mira-crawler/ingest/{converter,chunker,store}.py`, `mira-crawler/ingest/extractors/fault_codes.py`.
- `.claude/rules/knowledge-entries-tenant-scoping.md`, `docs/migrations/001_knowledge_entries.sql`,
  `mira-hub/db/migrations/016_component_templates.sql`.
