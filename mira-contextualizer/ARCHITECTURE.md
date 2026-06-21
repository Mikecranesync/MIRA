# FactoryLM Contextualizer — Architecture Overview

> Engineering reference for the offline-first Windows desktop app that turns raw industrial
> engineering files into reviewable, structured factory context and a portable export bundle.
> Companion to `README.md` (user-facing) and `PACKAGING.md` (build/installer).

## 1. What it is

A single **offline-first Windows desktop app** that ingests industrial engineering files (PLC program
exports, Connected Components Workbench projects, and machine/drive manuals in PDF/Word/Excel/image
form), **deterministically** extracts factory context (tags, signals, fault codes, parameters,
engineering units/ranges/setpoints, fault cause→next-check), lets a human accept/reject each
proposal, scores how "answerable" the resulting machine model is, and exports a **portable,
self-describing bundle** that the online MIRA Hub can import later.

Design premise: plant floors often have no reliable internet. Contextualize on a laptop at the
machine, carry the result on USB, sync when back online.

**Hard product stance:** no LLM, no cloud in the reasoning path. Extraction may use bundled *offline*
OCR; all *contextualization* is pure rules (regex + curated vocab + table-column awareness). The
tradeoff is deliberate — auditable and reproducible over "smart but unverifiable."

## 2. Tech stack & constraints

| Aspect | Choice |
|---|---|
| Language | Python 3.12 target |
| Core runtime deps | **stdlib only** — `http.server`, `sqlite3`, `json`, `zipfile` |
| Document stack (optional `[docs]` extra) | `pdfminer.six`, `pypdfium2` (page raster, no poppler), `Pillow`, `python-docx`, `openpyxl`, `pytesseract` |
| OCR | Tesseract (Apache-2.0), bundled optionally; **degrades gracefully** if absent |
| GUI | Plain HTML/CSS/vanilla-JS served on `127.0.0.1`, opened as a chromeless **Edge app-mode** window (falls back to default browser) |
| Storage | Local **SQLite** (WAL), per-user at `%LOCALAPPDATA%\MiraContextualizer\store.db` |
| Packaging | **PyInstaller onedir** (~205 MB) + optional **Inno Setup** installer |
| Licensing | Apache-2.0 / MIT only |

No network calls anywhere. No auth (binds to localhost; single-user by design).

## 3. Architecture & module map

~1,700 LOC of source, ~700 LOC of tests, 57 tests. Layered so the server and storage never learn
what *kind* of file they hold.

```
app.py (114)        Desktop launcher: start server thread, open Edge app window,
                    resolve frozen paths (sys._MEIPASS), wire bundled Tesseract.
   │
server.py (286)     stdlib HTTP server. JSON API + static GUI on 127.0.0.1.
   │                Route table mirrors the Hub's /api/contextualization/* shape.
   ├── engine.py (83)         Router for PLC/CCW *text* sources → extraction rows.
   │      └── ccw.py (278)    Connected Components Workbench depth: Modbus map,
   │                          LogicalValues, Structured Text, whole-project merge.
   │      └── (mira_plc_parser, sibling pkg)  Rockwell L5X / tag-CSV pipeline + UNS proposal.
   ├── extract.py (160)       Heavy *document* extraction → normalized "Document IR"
   │                          (PDF digital+scanned/OCR, Word, Excel, images, html, csv).
   ├── contextualize.py (110) Deterministic entity *spotting* over the Document IR
   │      └── manuals.py (294)   deep table mining: fault cause→next-check + units/ranges/setpoints
   ├── scorecard.py (88)      Per-project "answerability" grade + prioritized gaps.
   ├── bundle.py (183)        Portable export bundle (the deliverable).
   └── store.py (226)         SQLite store (projects / sources / extractions).

gui/index.html (317)   Single-page UI: project list, source upload (drag-drop),
                       review table (accept/reject), scorecard bar, export.
```

**Process model:** one `ThreadingHTTPServer`, one shared SQLite connection guarded by a
`threading.Lock` (writes serialized; fine for a single local user). The browser window is a separate
Edge process pointed at the local port.

## 4. Data model (SQLite — `store.py`)

Three tables, mirroring the Hub's contextualization schema (migration 055) minus tenancy/RLS:

- **`projects`** — `id, name, description, status, timestamps`
- **`sources`** — one row per uploaded file: `source_type, file_name, status, error_message,
  extracted_json` (the Document IR is cached here for export)
- **`extractions`** — the core unit. One row per proposed signal/entity: `tag_name, roles (JSON),
  uns_path_proposed, i3x_element_id, evidence_json (JSON), confidence (0–1),
  status (pending|accepted|rejected)`

`evidence_json` is the flexible field — provenance (file/page/snippet) plus type-specific facts
(`data_type`, `modbus_address`, `units`, `range`, `setpoint`, `cause`, `next_check`, …). Everything
downstream (review UI, scorecard, export) reads from these rows.

## 5. Ingestion pipelines

Three ingestion paths, all producing the same `extractions` row shape:

**(a) PLC text exports** (`engine.py` + sibling `mira_plc_parser`) — Rockwell **L5X**, PLCopen XML,
tag CSVs. Runs the same deterministic parser the Hub worker uses; emits tags with roles + proposed
UNS paths.

**(b) CCW projects** (`ccw.py`) — A CCW project is a *folder*, not one file. Parses the
contextualizable pieces under `Controller/Controller/`: `MbSrvConf.xml` (Modbus map: named vars →
address + data type), `LogicalValues.csv` (full tag list), `.st/.stf/.iecst` Structured Text (VAR
declarations, inline comments, physical terminal labels, controller model + IP). Merges all files in
a project into one deduped tag set, and **guides** the user when they upload the wrong file (e.g.
`.vssettings` IDE prefs) instead of failing silently.

**(c) Documents** (`extract.py` → `contextualize.py` → `manuals.py`) — Any manual/datasheet:
1. `extract.py` produces a **Document IR**: a flat list of `DocBlock`s (`text|table|ocr`, page,
   section, confidence). Scanned PDF pages are rasterized (pypdfium2) and OCR'd (Tesseract); missing
   OCR engine → warning + low-confidence block, never a crash.
2. `contextualize.py` **spots entities** via regex + curated vocab: fault codes, drive parameters,
   catalog numbers, model families, manufacturers, and **cross-references to the project's PLC tags**.
3. `manuals.py` **mines depth**: fault tables → `cause`/`next_check`; spec/parameter tables →
   `units`/`range`/`setpoint`, **tied to the matching PLC tag** by name or shared engineering quantity.

### Offline document parsing (how, specifically)

"Offline" is structural: there is no HTTP client in the extraction path. `extract.extract()` routes
by file extension to a per-format function (all third-party imports are **lazy**, so the core never
loads the heavy stack). PDFs: `pdfminer.six` pulls embedded text per page; a page with <10 chars is
treated as scanned → `pypdfium2` rasterizes *that page* to a PIL image at 2× and **Tesseract** OCRs
it. The OCR engine is a bundled local C++ binary (`vendor/tesseract/`), wired via
`app._configure_bundled_tesseract()`; if absent, OCR degrades gracefully and digital formats still
work.

## 6. From raw → structured (the core transform)

Structured data is produced in two stages: (1) each input is parsed into extraction *rows*; (2) the
*accepted* rows are **projected** into structured formats at export time (`bundle.py`).

### Where UNS paths come from (`mira-plc-parser/uns.py`)

UNS paths follow ISA-95: `enterprise / site / area / line / asset / signal`. `propose_uns()`:
- **Upper 4 levels** aren't in any export (plant context) → placeholders (`line` defaults to the
  slugified controller name); the user sets the real prefix once.
- **`asset`** — prefix match: an asset candidate whose name prefixes the tag wins (`Conv` →
  `Conv_Fault` → asset `conv`). Empty if none (tag sits under the line).
- **`signal`** — the standardized role word (frequency/current/fault/speed/torque/running…) if the
  parser flagged it a VFD signal, else the slugged tag name.
- **Confidence**: `high` = standardized signal + matched asset; `medium` = one; `low` = neither.

> ⚠️ **Current limitation:** UNS/i3X auto-generation runs **only for the Rockwell L5X / tag-CSV
> path**. The **CCW/Micro820** path and the **document** path produce rich rows but leave
> `uns_path_proposed = None` — they are extracted and reviewable but **not yet auto-placed** in the
> ISA-95 hierarchy (and the GUI "Proposed UNS" column is read-only). So for a CCW-only or manual-only
> project, `uns.json`/`i3x.json` are empty while `kg_entities`, `kg_relationships`, `signals.csv`,
> `review.json`, `documents/`, and the scorecard all populate. Closing this is the top roadmap item
> (see §12).

### How accepted rows project into each output (`bundle.py`)

- **`uns.json`** — accepted rows with a UNS path → `{tag, unsPath, roles, confidence}`.
- **`i3x.json`** — **CESMII i3X** objectInstances, built by *walking each UNS path's segments*:
  every non-leaf segment → a `container` instance, the leaf → a `signal` instance, each with a
  `parentId` chain, `typeElementId` (`urn:mira:type:container|signal`), `namespaceUri`, and (on
  leaves) `metadata: {roles, confidence}`. A flat path list becomes a containment tree.
- **`kg_entities.json`** — each accepted row → a **proposed** KG entity: a `signal` (+ parent
  `asset`) when UNS-placed, else typed by role (`fault_code`/`parameter`/`catalog_number`/
  `manufacturer`/`tag_reference`); all carry `provenance` + `approval_state:"proposed"`.
- **`kg_relationships.json`** — `HAS_SIGNAL` (asset→signal) for UNS-placed signals; `MENTIONS`
  (document→tag) for `tag_reference` rows, with page + snippet evidence. All `proposed`.
- **`signals.csv`** — flat `tag, uns_path, roles, confidence, source`.
- **`documents/<file>.json`** — the raw Document IR per upload (knowledge-base seed).
- **`review.json`** — full accept/reject audit trail with provenance for every candidate.
- **`scorecard.json`** + **`manifest.json`** (tool/version/time, per-source **sha256**, counts,
  grade) + **`report.md`** + **`IMPORT.md`**.

```
raw file → [parser by type] → extraction rows (tag, roles, evidence_json)
         → human accept/reject in the review table
         → [bundle.py projections] → uns.json · i3x.json · kg_*.json · signals.csv · documents/ · review.json
```

## 7. The scorecard (`scorecard.py`) — answerability, not buildout

Per project, a 0–100 score across **13 weighted dimensions** in 3 tiers (foundational → meaning →
diagnostic), mapping to grades **Skeleton → Inventory → Described → Diagnosable → Answer-ready**.
Highest-weight dimensions are the diagnostic two: **units/ranges/setpoints** and **fault
cause→next-check**. Returns score, grade, per-dimension coverage, and a **prioritized "top gaps"**
list (foundational-first) — i.e. the single most valuable next file to add. Measured effect of the
manual-driven extractor: a CCW Modbus inventory scores **38 / Inventory**; the same project after
mining one drive manual scores **66 / Diagnosable** with both diagnostic dimensions at full coverage.

## 8. HTTP API surface (`server.py`, all on `127.0.0.1`)

```
GET    /api/projects                          list projects
POST   /api/projects                          create
GET    /api/projects/{id}                     project + sources
POST   /api/projects/{id}/sources             add a source (JSON text OR octet-stream upload)
POST   /api/projects/{id}/ccw-import          import a whole CCW folder (JSON files[]) or .zip/.ccwx
GET    /api/projects/{id}/extractions         list proposals
GET    /api/projects/{id}/scorecard           answerability grade
GET    /api/projects/{id}/export?format=uns|i3x|bundle
PATCH  /api/extractions/{id}                  accept / reject / pending
```

## 9. Packaging & build

Build from `mira-contextualizer/`: `pip install -e ".[docs,packaging]"` then
`pyinstaller MIRA-Contextualizer.spec`. **Onedir** (not onefile) — native libs + OCR models extract
slowly under onefile and the installer lays the tree once. The spec collects the GUI dir (resolved at
runtime from `sys._MEIPASS`), the sibling `mira_plc_parser`, and the document stack. Installer:
`ISCC.exe installer.iss` → per-user Setup.exe. Frozen-path contracts pinned by `tests/test_packaging.py`
(absolute imports in the entry; GUI shipped as data named `gui`). Frozen-verify:
`FactoryLM-Contextualizer.exe --version` and `--selftest` (exit 0).

## 10. Testing

57 tests (~700 LOC), pure/deterministic (fixed string in → fixed rows out): each parser
(`test_ccw`, `test_extract`, `test_contextualize`, `test_manuals`), the store, scorecard, bundle,
server routes, and frozen-path contracts. Run `python -m pytest` from `mira-contextualizer/`. Lint:
`ruff`.

## 11. Consuming side (online)

The bundle is import-ready for `POST /api/contextualization/import` in `mira-hub`: it recreates the
project + accepted extractions, seeds `knowledge_entries` from `documents/` (`is_private=true`), and
the Hub's Promote flow lands the proposed `kg_entities`/`kg_relationships` for admin review.
Everything is `proposed` — a human verifies on the Hub before anything becomes trusted.

## 12. Known limitations / review focus

1. **UNS/i3X is L5X-only today** (§6). CCW/Micro820 and document entities are extracted but not
   auto-placed in the ISA-95 hierarchy. Top roadmap item: UNS auto-placement for the CCW path (reuse
   `propose_uns` asset-prefix + role logic) and a structured industry-standard projection for
   document-derived maintenance knowledge.
2. **Coverage is best-effort regex/heuristics.** Real manuals vary; OCR'd tables degrade. The design
   is "strong on structured tables/codes, silent on free prose." Pressure-test `manuals.py` table
   detection against messy real PDFs.
3. **Semantic tag-tie** (units→tag by shared engineering token) is the least-certain logic —
   conservative and flagged `match:"semantic"` for human review.
4. **OCR not bundled by default** — `vendor/tesseract/` must be populated before packaging or scanned
   PDFs/images won't OCR (digital formats still work).
5. **Single shared SQLite connection + lock**, no auth — correct for single-user localhost only.

## Cross-references
- `README.md` — user-facing overview
- `PACKAGING.md` — PyInstaller + Inno build, frozen verification
- `mira-plc-parser/mira_plc_parser/uns.py` — UNS path proposal (ISA-95)
- `mira_contextualizer/bundle.py` — the structured projections (UNS/i3X/KG/CSV)
- `mira_contextualizer/manuals.py` — manual-driven depth extractor
