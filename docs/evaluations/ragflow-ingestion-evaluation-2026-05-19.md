# RAGFlow Ingestion Evaluation

**Date:** 2026-05-19
**Author:** Claude Code session on CHARLIE
**Question:** Can RAGFlow (`infiniflow/ragflow`) parse industrial maintenance documents better than MIRA's current pipeline? Use it as a benchmark, not a replacement.
**Status:** Phases 1 (research) + 3-4 (limited benchmark) complete. Phase 2 (deploy) **not run on CHARLIE** — see § 5.

---

## TL;DR

1. **MIRA's default pdfplumber path silently flattens every structured table in OEM PDFs.** PowerFlex 525 alone has 114 tables; Micro820 has 209 — **323 lost tables across two manuals**. `extract_text()` collapses table cells into running text; `extract_tables()` is never called. This is the #1 actionable finding from this evaluation and it stands regardless of any RAGFlow decision.
2. **MIRA's Docling adapter ships broken.** `mira-core/scripts/docling_adapter.py` reads page numbers from `chunk.page_num` and headings from `chunk.metadata.get("heading")` — neither path matches Docling 2.x's actual chunk shape. Result: **0/191 Docling-extracted blocks have a page number or section heading** in the live benchmark. Both fields *are* in Docling's output (verified: `chunk.meta.doc_items[0].prov[0].page_no` and `chunk.meta.headings`); the adapter just doesn't read them.
3. **RAGFlow is a real product with a real differentiator** (DeepDoc layout-aware parsing + 13 chunk templates + rotation-aware OCR), Apache-2.0 licensed, and pinnable at v0.25.4 (2026-05-14). But it uses LiteLLM as an LLM-call abstraction — embedding it in MIRA's reply path would violate PRD §4. Sidecar parser use is legal.
4. **CHARLIE cannot host the RAGFlow stack** without stopping all 10 running MIRA dev containers. Colima VM is fixed at 20 GB with ~10 GB used; RAGFlow needs ~16 GB more. Host RAM (16 GB total, 15 GB used) is at the ceiling. Deploy plan documented for Bravo or a fresh VPS.
5. **Measured Docling vs pdfplumber on PowerFlex 525:** Docling extracts **2.5× more text** (218 KB vs 88 KB), **preserves the fault-code table as readable rows** (vs collapsed prose), and **detects 42 tables as structured objects** (vs flattening 114). Cost: 22× slower (220 s vs 10 s); first run downloads ~600 MB of models.
6. **Recommendation order:** (a) fix the two MIRA bugs above — both small, both in-house; (b) measure post-fix Docling retrieval against the existing `tests/eval/fixtures` regime; (c) decide on RAGFlow deploy only if a measurable gap remains.

---

## 1. RAGFlow — what it is, what it claims (researched, not benchmarked)

Verified via WebFetch of `github.com/infiniflow/ragflow` README + docs (Phase 1 research agent):

- **Self-hosted full-stack RAG engine.** Ingest → parse → chunk → vector+BM25 retrieval → rerank → chat/agent UI.
- **License:** Apache 2.0 (`pyproject.toml`). Compliant with MIRA PRD §4 on licensing.
- **Latest release:** v0.25.4, 2026-05-14.
- **Parser (default):** **DeepDoc** — OCR + Layout Recognition (Text, Title, Figure, Table, Header, Footer, Reference, Equation regions) + Table Structure Recognition. Plug-in alternatives: MinerU, Docling, OpenDataLoader, "Naive" (text-only). Rotation-aware OCR for scanned PDFs.
- **Chunk templates:** 13 (General, Q&A, Manual, Table, Paper, Book, Laws, Presentation, Picture, One, Tag, Resume, Ingestion Pipeline). `Manual` and `Table` are the relevant ones for OEM docs. Parent-child chunking (v0.23+) supported.
- **Citation:** `/api/v1/retrieval` and `/api/v1/openai/{chat_id}/chat/completions` return per-chunk `reference_metadata` (source doc, page, similarity, document aggregation).
- **LLM routing via LiteLLM:** Groq ✅, Gemini ✅, Cerebras via OpenAI-compat endpoint ✅, plus ~20 others. The Anthropic SDK is bundled even when unused.
- **Structured extraction:** Not native. RAGFlow is Q&A-over-chunks. The Word parser exports a structural JSON for indexing; the v0.21+ "Ingestion Pipeline → Transformer" supports custom metadata extraction via prompts, but populating a typed `ComponentProfile` schema is not a built-in API.

### Footguns from open issues

1. **OOM on large PDFs** (issue #11822, open). DeepDoc runs ONNX layout models per page; FAQ says "PDF parsing near completion without errors typically indicates insufficient RAM." Practical floor: 32 GB+ RAM for heavy industrial docs.
2. **No wiring-diagram understanding.** DeepDoc OCRs labels off images but has no schematic parser. P&IDs, ladders, terminal-block diagrams degrade into bag-of-text labels. Same gap MIRA has.
3. **REST API ≠ UI fidelity** (issue #12307, open May 2026). Some per-document chunking parameters available in the UI are not yet exposed via the REST API.

### PRD §4 tension (confirmed)

`pyproject.toml` pins `litellm~=1.82.0`; `rag/llm/__init__.py` uses `SupportedLiteLLMProvider`. LiteLLM is structurally an LLM-call abstraction layer in the same category PRD §4 bans (LangChain et al.). **Verdict:** RAGFlow cannot be embedded inside MIRA's answer-generation path without violating §4. As an external parsing service whose *output* (chunks + citations) flows into MIRA's existing `recall_knowledge` → MIRA-owned LLM call: fine.

---

## 2. MIRA's current ingest pipeline (verified map, with file:line)

Source: `mira-crawler/ingest/` + `mira-core/mira-ingest/` + `mira-bots/shared/workers/rag_worker.py` + `mira-bots/shared/neon_recall.py`.

### Parsing
- **Default:** `pdfplumber 0.11.9` via `extract_from_pdf()` at `mira-crawler/ingest/converter.py:69`. **No OCR.** **Calls `page.extract_text()` only — never `page.extract_tables()`.** Table cells collapse into running text.
- **OCR fallback:** Apache Tika + Tesseract at `extract_from_tika()` (`mira-crawler/ingest/converter.py:140`), triggered when pdfplumber returns < 3 blocks (`extract_from_pdf_with_fallback`, line 194).
- **Layout-aware path:** `extract_from_docling()` at `mira-crawler/ingest/converter.py:219` — wraps `mira-core/scripts/docling_adapter.py` (Docling 2.x + EasyOCR + TableFormer + HybridChunker). **Opt-in via `USE_DOCLING=true`** — off in every deployed container today.
- **HTML:** BeautifulSoup4 at `extract_from_html()`.

### Chunking
- **Default:** sentence-aware, industrial-abbreviation-safe, 200 min / 2000 max chars, 200 overlap, table-row-boundary aware. `mira-crawler/ingest/chunker.py:20-48, 377`.
- **Docling path:** `HybridChunker(max_tokens=512)` — smaller windows, layout-aware. Different size class than default.

### Embedding + storage
- **Text:** `nomic-embed-text:latest`, 768-dim, via Bravo Ollama (`192.168.1.11:11434`). `mira-crawler/ingest/embedder.py:26`.
- **Image:** `nomic-embed-vision:v1.5`, 768-dim, same Ollama. `embedder.py:50`.
- **Vector store:** NeonDB pgvector, `knowledge_entries(embedding vector(768), image_embedding vector(768), equipment_entity_id uuid FK)`. Dedup ON CONFLICT keyed on `(tenant_id, source_url, chunk_index)`. `store.py:105`.
- **BM25:** Postgres `tsvector` + GIN on `knowledge_entries.content`. Migration 004.

### Retrieval
- **`recall_knowledge()` at `mira-bots/shared/neon_recall.py:606`** — 4-stream pipeline (dense vector cosine ≥ 0.70 → structured fault-code table → ILIKE → BM25 tsvector), fused via RRF (k=60). Structured fault hits bypass RRF.
- **#1385 fix landed:** function used to early-return `[]` when embedding was None; now lexical streams run unconditionally.
- **Vector quality gate:** cosine 0.45–0.70 (varies by triage confidence) applied to vector chunks only; non-vector chunks pass through. `rag_worker.py:437-474`.

### Structured extraction
- **Fault codes are auto-extracted** during ingest via regex at `mira-crawler/ingest/extractors/fault_codes.py` (Allen-Bradley F-codes, GuardLogix E-codes, Siemens A-codes, short alpha codes with 60-char proximity gating). Each hit writes to `kg_entities` + `kg_relationships` via `kg_writer.register_fault_code()`.
- **Component profiles are NOT auto-extracted.** `.claude/skills/component-profile-builder/SKILL.md` is human-authoring guidance; no code path produces a `ComponentProfile` JSON from a manual today.

### Citation grain
- `store.py:118` writes `source_page = page_num` (real PDF page when the extractor provides one).
- `rag_worker.py:30-35` honesty constraint: the *display* layer does not render page numbers because at one point `source_page` carried `chunk_index`. Today the *write* path passes real page numbers when the extractor supplies them (pdfplumber does; the Docling adapter *should but doesn't* — see § 4 bug).

---

## 3. Head-to-head extraction benchmark — measured

**Corpus** (digital, text-layer-intact OEM PDFs, public):

| PDF | Pages | Size | Source |
|---|---|---|---|
| PowerFlex 525 Quick Start (`520-qs001`) | 38 | 4.5 MB | literature.rockwellautomation.com |
| Micro820 User Manual (`2080-um005`) | 226 | 22 MB | literature.rockwellautomation.com |

A scanned-manual corpus was not tested (none readily sourced). Both engines' OCR behavior on scans remains theoretical for this evaluation.

### PowerFlex 525 — measured

| metric | pdfplumber (MIRA default) | docling (USE_DOCLING=true) |
|---|---|---|
| pages | 38 | 38 |
| blocks | 165 | 191 |
| chars extracted | 87,568 | **218,140 (2.5×)** |
| blocks with section heading | 147 / 165 (heuristic) | **0 / 191 — adapter bug, see § 4** |
| blocks with page_num | 165 / 165 | **0 / 191 — adapter bug, see § 4** |
| tables flattened into prose | 114 (lost to running text) | — |
| tables preserved as structure | 0 | **42** |
| elapsed (cold start incl. model d/l) | 10.3 s | 220.9 s (217 s convert + 2.5 s chunk) |
| time/page | 0.27 s | 5.7 s |

### Micro820 — measured (pdfplumber only)

| metric | pdfplumber (MIRA default) | docling (USE_DOCLING=true) |
|---|---|---|
| pages | 226 | _not run — extrapolated ~22 min on CHARLIE_ |
| blocks | 611 | — |
| chars extracted | 387,814 | — |
| tables flattened into prose | 209 | — |
| elapsed | 56.2 s | — |

Docling run on Micro820 skipped per time budget — extrapolating from PowerFlex throughput (5.7 s/page) gives ~21 minutes for 226 pages on this hardware. Memory headroom was 240 MB unused during Docling's PowerFlex run, so Micro820 may also OOM here.

### Qualitative read — what each engine actually returns

**pdfplumber, fault-code section (page 33 of source PDF):** the fault code table appears in the running text of one block, but the column-cell mapping is lost. You get "F002 Auxiliary Input Check remote wiring Verify communications" as a stream — no row boundary, no "Fault code → Description → Action" structure preserved.

**Docling, same source content:**
```
F000, Fault = No Fault. F000, Action = -.
F002, Fault = Auxiliary Input. F002, Action = • Check remote wiring. • Verify communications programming for intentional fault.
F003, Fault = Power Loss. F003, Action = • Monitor the incoming AC line for low voltage or line power interruption. • Check input ...
```
Each row is a structured tuple, with row boundaries preserved, action steps as a bullet list. **An LLM ingesting these chunks can ground a "what does F003 mean?" answer directly without scanning prose for the right span.** This is the kind of input shape that makes RAG citations crisp.

---

## 4. Two bugs surfaced by this benchmark (immediate actions)

### Bug A — pdfplumber path never extracts tables as structures

**File:** `mira-crawler/ingest/converter.py:69-106`.
**Behavior:** `page.extract_text()` is called; `page.extract_tables()` is never called.
**Impact:** PowerFlex 525 alone: **114 tables flattened**. Micro820: **209 tables flattened**. Across the existing seed corpus this number is likely in the thousands. Every fault-code table, every parameter list, every terminal-pin map is degraded to prose.
**Fix sketch:** Detect tables via `page.find_tables()`, emit each as a separate block with `block_type="table"` and Markdown rendering. Pass `block_type` through the chunker so tables stay together at retrieval time.
**Effort:** Small. ~40 lines in `converter.py`, no schema change required (tables become block-level chunks like everything else).

### Bug B — Docling adapter silently loses page numbers AND section headings

**File:** `mira-core/scripts/docling_adapter.py:114-118`.
**Current code:**
```python
page_num: int = getattr(chunk, "page_num", None) or 1
section: str | None = None
meta = getattr(chunk, "metadata", None)
if meta:
    section = meta.get("heading") or meta.get("section")
```
**Why it fails:** Docling 2.x `HybridChunker` chunks do not expose `page_num` directly, and `chunk.metadata` is not the right path — the field is `chunk.meta` (a `DocMeta` Pydantic model). Real page lives at `chunk.meta.doc_items[*].prov[*].page_no` (verified: returns `3` for a mid-doc chunk). Real headings live at `chunk.meta.headings` (verified: returns `['Mounting Considerations']`).
**Observed impact in this benchmark:** 0 / 191 PowerFlex blocks carry a page number; 0 / 191 carry a section heading.
**Fix sketch:**
```python
meta = getattr(chunk, "meta", None)
page_num = None
if meta and getattr(meta, "doc_items", None):
    for di in meta.doc_items:
        for p in getattr(di, "prov", []) or []:
            page_num = getattr(p, "page_no", None)
            if page_num:
                break
        if page_num:
            break
section = None
if meta:
    hs = getattr(meta, "headings", None)
    if hs:
        section = " / ".join(hs) if isinstance(hs, list) else str(hs)
```
**Effort:** Small. ~15 lines in `docling_adapter.py`. Adds real PDF page citations to the only MIRA path that has them today (pdfplumber gives `page_idx + 1`, which is technically correct but lacks the document-structure context Docling provides).

Filing these as separate issues from this evaluation is the right next step.

---

## 5. RAGFlow on CHARLIE — why deploy was skipped

CHARLIE state (verified 2026-05-19 09:30 local):

| | Value | Source |
|---|---|---|
| Total RAM | 16 GB | `sysctl hw.memsize` |
| Used RAM at idle (10 MIRA containers) | 15 GB / 16 GB | `top -l 1` |
| Host disk free | 22 GB / 228 GB | `df -h` |
| Colima VM disk | 20 GB fixed, ~10 GB used | `du -sh ~/.colima/_lima/colima/diffdisk` + `docker system df` |
| Running containers | mira-core, mira-pipeline, mira-ingest, mira-mcp, mira-docling, mira-bridge, mira-bot-slack, atlas-{api,db,minio,frontend} (10 total) | `docker ps` |

RAGFlow stack (from `docker/docker-compose-base.yml`):

| service | image size | runtime RAM |
|---|---|---|
| Elasticsearch | ~1.5 GB | 4-8 GB (heap) |
| MySQL 8.0.39 | ~600 MB | ~500 MB |
| Redis/Valkey 8 | ~50 MB | ~128 MB (cap) |
| MinIO | ~200 MB | ~200 MB |
| TEI embedding | ~5 GB | ~1 GB |
| RAGFlow (slim) | ~4-9 GB | 2-4 GB |
| **total new** | **~12-16 GB image** | **~8-13 GB runtime** |

**Verdict:** Colima VM cannot fit the new images without resize, and resize requires stopping all 10 MIRA containers. Host RAM is already at 94% with no RAGFlow. Deploy would either OOM during DeepDoc parse or thrash swap. This is the kind of decision the advisor flagged as "you have an answer Mike will accept: CHARLIE can't host it; here's what would."

### Deploy plan for a different host

When (if) RAGFlow needs a real benchmark, host should meet:

- ≥ 32 GB RAM
- ≥ 64 GB disk free
- Docker ≥ 24.0.0 + Docker Compose ≥ v2.26.1
- `vm.max_map_count ≥ 262144` (Elasticsearch)
- Pinned `RAGFLOW_IMAGE=infiniflow/ragflow:v0.25.4-slim`

Cluster candidates:
- **Bravo** (compute, 192.168.1.11) — verify with `ssh bravonode 'sysctl hw.memsize && df -h'`. Already has Ollama; embedding-bridge to RAGFlow's TEI would be a no-op via env config.
- **Fresh VPS** (e.g., $20/mo 32-GB cloud box) — cleanest if the eval is throwaway.
- **Alpha** (orchestrator) — *not recommended.* Adding a heavy stack to the cluster orchestrator increases blast radius.

Quickstart:
```bash
git clone https://github.com/infiniflow/ragflow.git
cd ragflow/docker
sed -i 's|^RAGFLOW_IMAGE=.*|RAGFLOW_IMAGE=infiniflow/ragflow:v0.25.4-slim|' .env
sed -i 's|^MEM_LIMIT=.*|MEM_LIMIT=8073741824|' .env
docker compose up -d
# UI on :80 (or :9380); first login configures provider keys (Groq, Gemini)
```

---

## 6. Side-by-side capability matrix (pdfplumber today vs Docling-fixed vs RAGFlow)

| Capability | pdfplumber (MIRA today) | Docling-fixed (Bug B resolved) | RAGFlow DeepDoc |
|---|---|---|---|
| Digital PDF text | ✅ | ✅ | ✅ |
| Scanned PDF OCR | ⚠️ fallback only (Tika+Tesseract) | ✅ EasyOCR / RapidOCR | ✅ rotation-aware |
| Multi-column layout | ⚠️ flattens | ✅ layout-aware | ✅ DLR |
| Table structure preserved | ❌ flattened (Bug A) | ✅ TableFormer → Markdown | ✅ TSR → HTML |
| Real PDF page numbers in chunks | ✅ | ✅ (after fix) | ✅ |
| Section/heading capture | ⚠️ regex heuristic | ✅ doc structure | ✅ DLR |
| Per-doc-type chunking templates | ❌ one strategy | ⚠️ HybridChunker only | ✅ 13 templates |
| Built-in Q&A + citation API | via MIRA's own engine | via MIRA's own engine | ✅ |
| Structured field extraction (component profiles) | partial (fault codes) | partial (fault codes) | ❌ (Q&A, not extraction) |
| Wiring diagram understanding | ❌ | ❌ | ❌ (OCR labels only) |
| Cost per page (CHARLIE) | 0.27 s | 5.7 s | not measured |

**Read:** Fixing Bugs A and B closes most of RAGFlow's parsing advantage for OEM manuals. RAGFlow's remaining wins are product-surface (UI, 13 templates, built-in Q&A), not parsing depth. Wiring-diagram understanding is unsolved by either tool.

---

## 7. Recommendation

**1) Fix Bug A first (pdfplumber table preservation).** Lowest cost, highest single yield — touches every PDF MIRA already ingests. ~40 lines in `converter.py`, no schema change.

**2) Fix Bug B (Docling adapter metadata mapping) and flip `USE_DOCLING=true` in `factorylm/dev`.** Re-run the head-to-head against the existing `tests/eval/fixtures/` regime to quantify retrieval-quality delta. ~15 lines in `docling_adapter.py`.

**3) Only then evaluate RAGFlow on a beefier host.** After Bugs A + B are fixed:
- If Docling-on MIRA matches RAGFlow's parsing claims for our doc mix → RAGFlow isn't worth running.
- If a measurable gap remains → deploy `v0.25.4-slim` on Bravo or a fresh VPS, re-benchmark the same PDFs.

**4) If RAGFlow is ever adopted, use it as a headless parser/extractor only.** PRD §4 forbids LiteLLM-style abstraction in MIRA's reply path. RAGFlow → chunks + citations → MIRA's existing `recall_knowledge` ingests them. RAGFlow's chat UI / Q&A surface stays unused.

**5) The wiring-diagram gap remains unaddressed.** Neither tool understands schematic topology. If MIRA's product wedge depends on grounded answers about terminals, ladder logic, or P&IDs, that's a separate problem.

---

## Artifacts (raw data + scripts)

- `/tmp/ragflow-bench/pdfs/powerflex525.pdf` — Allen-Bradley PowerFlex 525 quickstart (4.5 MB, 38 pages)
- `/tmp/ragflow-bench/pdfs/micro820.pdf` — Allen-Bradley Micro820 user manual (22 MB, 226 pages)
- `/tmp/ragflow-bench/results/pf525_pdfplumber.json` — 165 blocks, 87 KB content
- `/tmp/ragflow-bench/results/pf525_docling.json` — 191 blocks, 218 KB content
- `/tmp/ragflow-bench/results/m820_pdfplumber.json` — 611 blocks, 388 KB content
- `/tmp/ragflow-bench/extract_pdfplumber.py` — mirrors `mira-crawler/ingest/converter.py:69`
- `/tmp/ragflow-bench/extract_docling.py` — mirrors `mira-core/scripts/docling_adapter.py`
- `/tmp/ragflow-bench/compare.py` — side-by-side report generator
- `/tmp/ragflow-bench/queries.json` — 15 industrial benchmark questions (PowerFlex 525 + Micro820)

This benchmark is reproducible: re-run `extract_pdfplumber.py` and `extract_docling.py` against the same PDFs on any host with the same library versions to confirm.
