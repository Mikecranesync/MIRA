# Wiring-Print / Diagram Extraction — Prior-Work Recovery & Inventory

**Date:** 2026-07-09 · **Type:** read-only Discovery Recorder run (no rebuild) · **Status:** DISCOVERY COMPLETE
**Trigger:** "Search the repo + archived/old repos for prior work on chatting with electrical prints, wiring diagrams, OCR/PDF ingestion, print reading, schematic understanding, nameplate/diagram extraction, Tika/Docling pipelines, vision/KB ingestion, Telegram upload. Recover and inventory what already exists — do not rebuild. Then propose the shortest reuse path to a Machine Pack `wiring_map`."

**Method:** four parallel read-only sub-agent sweeps (ingest pipelines · chat-over-print + upload · wiring/schematic + Machine Pack · archived branches + sibling repos) + direct verification by the orchestrator (dormant-table usage, live-endpoint wiring, on-disk repo presence) + **two prior discovery records recovered** (`electrical_print_reuse_audit.md` 2026-07-02, `electrical_print_prior_artifact_recovery.md` 2026-07-03).

> **Bottom line:** almost nothing here needs to be built from scratch. The **reader** (schematic photo Q&A) is **already merged to main**; a **generator IR** (openclaw, MIT) is **already lifted in-tree**; a **live vision extractor** (`/api/kg/schematic`) already traces connections; and a **first-class `wiring_connections` table** already exists (schema-verified) — but is **DORMANT (no writer)**. The drive/Machine **Pack has no wiring section**. The shortest path to a Pack `wiring_map` is to **give the dormant `wiring_connections` table a writer fed by cited evidence, then add an optional Pack section + one scorecard gate** — wiring proven pieces together, not new architecture.

---

## 0. Commands run / artifacts inspected (audit trail)

- `ls Documents/GitHub/` → 28 dirs; all `mira-*` / `proveit-factory` are **worktree snapshots of the same monorepo** (Agent D), not unique repos.
- On-disk check for the prior audit's linchpin repos: `openclaw` **NOT FOUND** (already lifted in-tree, see §3), `factorylm-conveyor-demo` **NOT FOUND** (ignore-anyway), `MIRA_PLC` present at `C:/Users/hharp/Documents/CCW/MIRA_PLC`, `ladder-logic-editor` present.
- `git branch -a | grep -iE "wiring|print|ocr|ingest|vision|diagram|docling|tika"`; `git grep <ref>` reads (no checkouts).
- Dormant-table probe: `git grep -i wiring_connections` → only schema/verify/test hits, **no app writer/reader**.
- Live-endpoint probe: `git grep "schematic_intelligence|/api/kg/schematic|trace_connections"` → wired at `engine.py:1005/5216`, `mira-mcp/server.py:1020/971`.
- In-repo presence: `print_worker.py`, `plc/conv_simple_electrical/`, `docs/onboarding/cv-101-evidence/`, `tests/test_schematic_qa.py` all present.
- Prior records read in full: `docs/discovery/electrical_print_reuse_audit.md`, `…/electrical_print_prior_artifact_recovery.md`.

---

## 1. The map — every relevant file/module/test/doc

### A. PDF/Image → text/chunks/KB (ingestion)
| Path | Role | Status |
|---|---|---|
| `mira-crawler/ingest/converter.py` | PDF/HTML → blocks; `_format_table_markdown` (L74) table→md; `extract_from_tika` (L200); `extract_from_docling` (L279) | CURRENT; docling fn ORPHANED (falls back) |
| `mira-crawler/ingest/pdf_extract.py` | Local no-network PDF→md (`extract_pdf_text` L92) — the fix that replaced the dead docling `:5001` | CURRENT |
| `mira-crawler/ingest/chunker.py` | Section/table-aware chunker; `_detect_table_regions` (L221), `_split_table` (L257) | CURRENT (table logic relevant to wiring tables) |
| `mira-crawler/ingest/{embedder,store,kg_writer,dedup,quality}.py`, `extractors/{fault_codes,tag_classifier}.py`, `plc_permissive_extract.py` | embed (`embed_image` L50 exists), write `knowledge_entries`, KG upsert, dedup, quality gate, regex fault/tag extraction | CURRENT |
| `mira-crawler/tasks/full_ingest_pipeline.py` | 5-step cron; **docling `:5001` call REMOVED** (memory was stale) | CURRENT |
| `mira-crawler/tasks/ingest.py`, `_shared.py`, `gdrive/youtube/…` | Celery `ingest_url`; text-inline; source tasks | CURRENT |
| `mira-core/mira-ingest/main.py` | `POST /ingest/photo` (qwen2.5vl vision → embed → SQLite) = **the ONLY image→text path**; `ingest_document_kb` (legacy PDF→OW); `_route_collection` `_ELECTRICAL_RE` routes electrical PDFs to an "Electrical Prints" OW collection (routing only, no special extraction) | CURRENT (photo); legacy (PDF) |
| `mira-core/mira-ingest/db/neon.py` | pgvector recall + `knowledge_entries` writes (`insert_knowledge_entry` L346, `recall_by_image` L108) | CURRENT |
| `mira-core/mira-ingest/scripts/ingest_manuals.py`, `ingest_gdrive_docs.py`, `ingest_equipment_photos.py` | nightly manual/gdrive/photo crons (docling-primary → pdfplumber fallback) | DEGRADED (docling gone) / CURRENT |
| `mira-hub/src/lib/node-knowledge-ingest.ts` | **unpdf → chunk → `knowledge_entries` (`ingest_route='v2'`, `is_private=true`)** = the **current primary Hub PDF ingest** | CURRENT (ADR-0019 Slice 2) |
| `mira-hub/src/lib/{manual-rag,local-upload,uploads,node-document-proposals}.ts` | retrieval, upload lifecycle, KG edge proposals | CURRENT |

### B. Chat-over-print / upload flows
| Path | Role | Status |
|---|---|---|
| `mira-bots/telegram/bot.py` | `photo_handler` (L919), `document_handler` (L350, PDF-only, 20 MB), `_submit_photo_to_hub`/`_submit_doc_to_hub` (L308/330 → `/api/uploads/folder`), nameplate→drive-pack fast path | CURRENT |
| `mira-bots/slack/bot.py` | image MIME allowlist (L63), same engine `ELECTRICAL_PRINT` path; logs `has_citations` (L186) | CURRENT |
| `mira-bots/shared/engine.py` | `_analyze_schematic_with_question` (L891, image+OCR+question→vision cascade), `ELECTRICAL_PRINT` classify/state (L2426–2478), `_extract_schematic` (L993 → `/api/kg/schematic`, `persist:False`), `_summarize_schematic` (L1032), print follow-up → `PrintWorker` (L2513) | CURRENT — **this is the merged schematic reader** (`fix/schematic-photo-vision-qa`) |
| `mira-bots/shared/workers/print_worker.py` | `ELECTRICAL_PRINT_PROMPT` (L11, anti-hallucination "answer ONLY from OCR"); OCR-grounded multi-turn Q&A. Bypasses InferenceRouter → Open WebUI | CURRENT (working, **not** a stub) |
| `mira-bots/shared/workers/vision_worker.py` | classify ELECTRICAL_PRINT/NAMEPLATE/EQUIPMENT; `_detect_drawing_type` (ladder/one-line/P&ID/wiring/panel); glm-ocr + Tesseract backup | CURRENT (glm-ocr flaky, see §4) |
| `mira-bots/shared/workers/{nameplate_worker,photo_ingest_worker}.py` | nameplate extract; `propose_from_nameplate` → `ai_suggestions` (nameplate only) | CURRENT |
| `mira-bots/shared/workers/plc_worker.py` | canned "not connected" | STUB (Config 4) |
| `mira-hub/src/app/api/assets/[id]/chat/route.ts` | **the real cited chat** — `retrieveManualChunks` `(is_private=false OR tenant=caller)` (L343), drive-pack pre-check (L422), source chips (L570), cite-or-gap (L611), `decision_traces` (L643) | CURRENT |
| `mira-hub/src/app/api/quickstart/ask/route.ts` | public cite-or-refuse over `knowledge_entries` | CURRENT |
| `mira-hub/src/lib/local-upload.ts` + `mira-ingest-client.ts` | **the citability fork:** PDF → citable chunks (`writePdfChunksForNode`); **image → `forwardToPhotoIngest` = captioned photo record, NOT a citable chunk** | CURRENT (this is the image gap) |
| `mira-hub/src/app/api/documents/upload/route.ts` | tablet-demo single-row registrar | STUB (explicit) |
| `tools/mira-drop-watcher/main.py` | desktop drop-folder → `/api/uploads/folder`; same citability fork | CURRENT |

### C. Wiring / schematic structures (the four disjoint homes)
| Path | Role | Status |
|---|---|---|
| `mira-bots/shared/wiring_diagram/{schema,layout,renderer,symbols,style}.py` + `__init__.py` | **Generator IR** — `DiagramSpec`(Component/Terminal/Connection/Bus) → SVG/PDF (IEC-60617, 20 symbols). **Lifted from openclaw (MIT)** — cairosvg→PyMuPDF. Tested (`mira-bots/tests/test_wiring_diagram.py`) | CURRENT (in-tree) |
| `mira-mcp/schematic_intelligence.py` + `mira-mcp/server.py` (`/api/kg/schematic` L1020, `/persist` L971) + `kg_client.py` | **Live vision reader** — classify → detect_symbols → `trace_connections` → `to_kg_payload` (→ KG proposals) | CURRENT (LIVE endpoint) |
| `mira-hub/db/migrations/026_wiring_connections.sql` | **First-class `wiring_connections` table** — source/dest entity+terminal, wire_number, cable_id, gauge_awg, color, function_class (power/signal/safety/comm/ground), drawing_reference, approval_state. RLS + grants + indexes. Round-trip tested (`tests/integration/test_phase0_schema.py:137`), deploy-verified (`tools/verify_phase0_deploy.py`) | **DORMANT — provisioned + verified, but NO app writer/reader** |
| `plc/conv_simple_electrical/model/{devices,terminals,wires,sheets,e007_rs485,open_items}.yaml` + `render_sheet.py` | **Cited evidence data** — CV-101 device/terminal/wire schedule tagged `verified\|field_verify\|proposed` with `source:`; E-005/E-007 rendered | CURRENT (data; hand-authored) |
| `docs/references/industrial-wiring-diagram-standards.md` (§4) | **Reader doctrine** — `WiringPrintDocument`/`DeviceRecord`/`TerminalRecord`/`WireRecord`/`CableRecord`/mandatory `Evidence`; NEMA/JIC vs IEC/EPLAN vs ISA-5.1; §4.7 graph mapping (proposed→verified, human-only) | DOC-ONLY (spec) |
| `docs/onboarding/cv-101-evidence/{wiring_evidence,cv101_electrical_print,build_cv101_print}.md/py` | Authoritative CV-101 wiring photo evidence (wins all conflicts) | CURRENT (data) |

### D. Drive/Machine Pack + extraction + scorecard (the plug-in target)
| Path | Role | Status |
|---|---|---|
| `mira-bots/shared/drive_packs/schema.py` (L186–204) | `DrivePack` = `{nameplate, live_decode, envelope, knowledge, provenance, parameters, keypad_navigation}` — **NO wiring/terminal/connection field.** `_SUPPORTED_SCHEMA_VERSIONS={1,2}` (loader L40) | CURRENT (the gap) |
| `mira-bots/shared/drive_packs/{loader,ask,resolver,cards,nameplate,asset_identity}.py`, `packs/{durapulse_gs10,powerflex_525,powerflex_40}/pack.json` | pack load/resolve/render; "wiring/terminal" appears only in fault-action prose | CURRENT |
| `tools/drive-pack-extract/extractor.py` | manual PDF → cited pack fragment (`parse_faults`, `parse_parameters`, `verify_and_filter_entries` cite gate L1164, `assemble_pack_fragment` L1217 — emits fault/param/keypad only) | CURRENT |
| `tools/drive-pack-extract/scorecard.py` | cross-pack reliability gate (`score_pack` L64, `gates` L147, trust ladder, `--ci` L300). **L177 has a "wiring/keypad presence" placeholder comment that scores keypad only** — the natural wiring-gate seam | CURRENT |
| `tools/drive-pack-extract/grading/*`, `registry/*`, `gold/*` | per-pack grader (cite integrity, gold recall), manual registry, gold sets | CURRENT |

### E. Tests & docs
- Tests: `tests/test_schematic_qa.py` (+`SCHEMATIC_VISION_DATA`), `mira-bots/tests/test_wiring_diagram.py`, `tests/integration/test_phase0_schema.py` (`wiring_connections` round-trip), `tools/verify_phase0_deploy.py`, `tests/regime3_nameplate/`, `test_fsm_states.py`, `test_multi_photo.py`.
- Docs / prior discovery: **`docs/discovery/electrical_print_reuse_audit.md`** (the lift plan), **`…/electrical_print_prior_artifact_recovery.md`** (connection-table style §5.1), `docs/references/industrial-wiring-diagram-standards.md`, `docs/legacy/PRD-electrical-print-intelligence.md`, `docs/adr/0019-miradrop-ingest-v2.md` (image/PDF/**wiring diagram**→KB blueprint, mostly unbuilt), `docs/discovery/2026-07-07-prod-ingest-docling-and-vps-memory.md` + `docs/plans/2026-07-08-prod-ingest-storage-fixes.md` (the docling→Tika saga).

---

## 2. Which routines process images/PDFs into text/chunks/KB
- **Image → text:** ONE path — `mira-core/mira-ingest` `POST /ingest/photo` (qwen2.5vl vision → description → text+image embeddings → SQLite `equipment_photos`/`ai_suggestions`). **No wiring-image → terminal/wire extractor** in that path.
- **PDF → chunks → `knowledge_entries`:** four writers (Hub v2 unpdf = current primary; Celery `tasks/ingest`; cron `full_ingest_pipeline`; legacy `ingest_document_kb`→OW; nightly `ingest_manuals`). Scanned/no-text PDFs go through **Tika** (`mira-tika:9998`, replaced docling). Table structure via `converter._format_table_markdown` + `chunker._detect_table_regions`.
- **Drawing → structured symbols/connections:** `mira-mcp` `/api/kg/schematic` (`schematic_intelligence`: classify → symbols → `trace_connections` → KG payload). **This is the live reader seam** and the closest thing to a wiring extractor today.

## 3. Which routines support chatting over an uploaded print/drawing
- **Bot `ELECTRICAL_PRINT` path (works today):** upload image → `vision_worker` classify → `_analyze_schematic_with_question` / `build_print_reply` → `PrintWorker` multi-turn follow-ups. **OCR-grounded, anti-hallucination, but NOT citation-backed and session-scoped** (OCR lives in FSM `ctx`, not a corpus).
- **Hub cited chat (`assets/[id]/chat`, `quickstart/ask`):** full citation UX + cite-or-refuse — but retrieves **PDF manual chunks**, not drawings, and **no image → citable corpus**.
- **The gap:** an uploaded drawing **image** never becomes a citable `knowledge_entries` chunk (`forwardToPhotoIngest` → captioned photo record). The only push toward structure is the opportunistic `/api/kg/schematic` call (`persist:False` by default; persists only on an explicit "add this to documentation" follow-up).

## 4. Current / archived / broken / duplicated
- **Current & working:** merged schematic photo Q&A reader (`engine.py`, from `fix/schematic-photo-vision-qa`); `wiring_diagram` generator (in-tree, tested); `/api/kg/schematic` reader (live); Tika OCR; Hub v2 unpdf ingest; drive-pack extractor + scorecard.
- **Dormant (provisioned, unused):** `wiring_connections` table (mig 026) — schema-verified, **no writer/reader**. Ready destination for a `wiring_map`.
- **Broken / removed:** `mira-docling` removed from all compose (OOM 2026-06-06) → orphaned imports fall back to pdfplumber; `full_ingest_pipeline` `:5001` call **removed** (the memory saying it "still calls :5001" is **stale**); `glm-ocr` observed HTTP 400 in prod (2026-07-02) — prefer `qwen2.5vl`; the openclaw `diagram/` engine shipped with **no tests** (tests were added on lift).
- **Duplicated / fragmented:** 4 PDF→KB writers with divergent chunk size / `is_private` / dedup (Hub-v2 TS reimplements chunk+insert outside the shared `mira-crawler/ingest` lib); **~7 open branches** all doing the docling→Tika migration (`needs-ocr-tika-drain` #2539 is newest/most complete — consolidate before extending); the schematic reader is a **duplicate of main** (do not rebuild).
- **Doc-only / unbuilt:** `industrial-wiring-diagram-standards.md` §4 reader model; ADR-0019 mira-ingest-v2 (explicitly for "manual, photo, or **wiring diagram**" drops — mostly unbuilt); PRD Phase B/C (YOLOv8 symbol detection, PDF-print ingest) never built.
- **Ignore:** `mira-sidecar` (dead ChromaDB, no print value); `*-hud` tags (AR HMI); `feat/northwind-cv200-cloud-wiring` (name false-positive — Ignition cloud wiring); all sibling `Documents/GitHub/mira-*` dirs (monorepo worktree snapshots, nothing unique).

## 5. Shortest path to reuse for a Machine Pack `wiring_map`
Every piece except a **writer**, an **optional Pack section**, and **one scorecard gate** already exists. The chain:

1. **Extract** — reuse the live `/api/kg/schematic` (`schematic_intelligence`: symbols + `trace_connections`) for drawing **images**; reuse `converter` table extraction + Tika for **PDF** wiring sheets / connection tables / cable schedules.
2. **IR / field vocabulary** — reuse `wiring_diagram/schema.py` `Terminal`/`Connection` **or** the §4 `TerminalRecord`/`WireRecord`. Don't design a new shape.
3. **Evidence** — reuse the §4 mandatory `Evidence` block (page/grid/bbox/ocr_confidence) + `relationship_evidence`; `to_kg_payload` already emits proposals. **No evidence ⇒ not asserted (mark gap).**
4. **Structured store** — write into the **dormant `wiring_connections` table** (mig 026) as `approval_state='proposed'`, tenant-scoped. **This table's missing writer is the single highest-leverage gap.**
5. **Pack section** — add an **optional** `wiring_map` section to `drive_packs/schema.py` (bump `schema_version` → 3, additive/back-compat), assembled from that family/asset's **verified** `wiring_connections` rows.
6. **Validate** — extend `scorecard.py` at the L177 "wiring/keypad presence" seam with a wiring gate (presence + cite-integrity + no-invention), same trust ladder + `--ci`.
7. **Human gate** — `proposed → verified` on human sign-off only (Hub `/proposals`), never auto-verify (ADR-0017 / §4.7).

## 6. Proposed end-to-end workflow
See the companion runbook: **`docs/drive-commander/wiring-map-extraction-workflow.md`**.

```
upload (Telegram/Slack photo+PDF · Hub /api/uploads/folder · MiraDrop)
  → classify (vision_worker ELECTRICAL_PRINT + drawing_type · _ELECTRICAL_RE PDF routing)
  → EXTRACT   image → /api/kg/schematic (symbols + trace_connections)
              PDF   → converter tables + Tika OCR + §4 connection-table parse
  → EVIDENCE  each terminal/wire carries §4 Evidence; no evidence ⇒ gap (never invented)
  → STRUCTURE normalize → wiring_connections (mig 026), approval_state='proposed', + relationship_evidence
  → PACK      assemble drive-pack wiring_map (schema v3) from VERIFIED wiring_connections rows
  → SCORECARD scorecard.py wiring gate (presence · cite-integrity · no-invention · trust ladder · --ci)
  → HUMAN     proposed → verified on sign-off (Hub /proposals). Never auto-verify.
```

---

## 7. Conclusions
1. **The reader, the generator IR, the live extractor, and the product store all already exist.** The task is integration, not invention.
2. **The one structural hole is a writer for the dormant `wiring_connections` table** — it is schema-verified and unused. Everything downstream (pack section, scorecard) is additive once that seam is proven.
3. **The Pack has no wiring section** — that's the only drive-pack schema change, and it should be optional/back-compat (`schema_version` 2→3).
4. **Do not rebuild** the schematic reader (merged), the generator (lifted), or the ingest path (mid docling→Tika consolidation — coordinate with `fix/needs-ocr-tika-drain` #2539, don't fork it).
5. **Evidence-or-gap is non-negotiable** and already the house style (§4 Evidence, `verified\|field_verify\|proposed`, cite gates). Reuse it verbatim.

## 8. Recommended next PR (smallest proof, proven pieces only — DO NOT expand)
**Prove the dormant store with the cleanest cited data first, zero vision risk:**

> **PR — "wiring_connections writer proof (CV-101, gated)":** a small, read-only-input tool that loads the **already-cited** `plc/conv_simple_electrical/model/{terminals,wires,devices}.yaml` (status `verified`) and writes those wire records into `wiring_connections` (mig 026) as `approval_state='proposed'`, tenant-scoped, each row carrying its `source:` as evidence. Round-trip read-back test. **No pack change, no scorecard change, no vision call.**

Why this first: it exercises the single missing seam (the table's writer) with data that is already evidence-cited and human-verified, so it can't hallucinate. It proves the store + evidence discipline end-to-end. **Only after** that lands do we (PR-2) wire `/api/kg/schematic` output into the same writer for real drawings, then (PR-3) add the optional Pack `wiring_map` section + scorecard gate. Each is independently valuable and gated; **no new architecture until the writer seam is proven.**

**Ruled out for now (record the decision):** routing uploaded drawing **images** into the citable `knowledge_entries` corpus (the §3 gap) is a *separate* ingest change entangled with the live docling→Tika consolidation — defer until that cluster lands, and treat `wiring_connections` (structured) rather than `knowledge_entries` (chunks) as the wiring destination.

## Cross-references
- Companion runbook: `docs/drive-commander/wiring-map-extraction-workflow.md`
- Prior audits (recovered): `docs/discovery/electrical_print_reuse_audit.md`, `docs/discovery/electrical_print_prior_artifact_recovery.md`
- Reader doctrine: `docs/references/industrial-wiring-diagram-standards.md` (§4, §4.7)
- Store: `mira-hub/db/migrations/026_wiring_connections.sql`; reader: `mira-mcp/schematic_intelligence.py`; generator: `mira-bots/shared/wiring_diagram/`
- Evidence data: `plc/conv_simple_electrical/model/*.yaml`; `docs/onboarding/cv-101-evidence/`
- Ingest saga (coordinate, don't fork): `docs/discovery/2026-07-07-prod-ingest-docling-and-vps-memory.md`, `docs/plans/2026-07-08-prod-ingest-storage-fixes.md`, branch `fix/needs-ocr-tika-drain` (#2539); blueprint `docs/adr/0019-miradrop-ingest-v2.md`
- Pack plug-in points: `mira-bots/shared/drive_packs/schema.py`, `tools/drive-pack-extract/scorecard.py:177`
