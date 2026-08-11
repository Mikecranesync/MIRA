# Phase 1.5 — Document Intelligence Bake-off & ARPK Go/No-Go

**Date:** 2026-08-11 · **Branch:** `exp/phase15-doc-intel-bakeoff` (stacked on held PR #3185)
**Harness:** `experiments/doc-intel-bakeoff/` (disposable; repro commands in its README)
**Baseline:** PR #3185 — immutable reference; nothing here modifies its guarantees.

> ## VERDICT: **B — thin evidence layer only.**
>
> Native document AI already answers technical-manual questions essentially perfectly
> (Gemini native-PDF: **28/28** on this benchmark, including every class the FactoryLM
> production path fails), and open-source parsing (Docling) already extracts structure,
> tables, and OCR text we must not rebuild. **ARPK as a portable compiled-document
> format is NOT justified by the evidence** — no `ARPK-CONCEPT-0.1.md` is created.
> What the measurements DO justify FactoryLM owning is thin and specific: the
> **evidence/provenance contract** (content-derived anchors, source hashes, revision
> identity, rights, tenant/doc boundary enforcement) plus **retrieval repair** in the
> serving path — because those are exactly the capabilities the winning systems
> measurably lack (self-asserted citations at ~90% precision, per-question whole-manual
> re-reads, daily-quota fragility, zero enforceable boundaries, no revision semantics).

---

## 1. Method

**Primary objective (per the Phase 1.5 directive): attempt to falsify the need for ARPK
and custom document intelligence.** We benchmarked what exists — the #3185 production
path, provider-native document AI, and current open-source parsers — on the questions
technical-manual QA actually fails on, and only then asked what durable layer (if any)
FactoryLM must own.

### Benchmark

27 questions across 15 adversarial classes (`experiments/doc-intel-bakeoff/questions.yaml`)
over four fixtures — every expected marker verified against the actual extracted page
text before any lane ran (no guessed oracles):

| fixture | pages | why |
|---|---|---|
| eufy RoboVac 11S / T2108 owner's manual (official CDN, sha `b2e7912e…`) | 16 | the consumer canary; carries the three #3185 known spec-table misses |
| PowerFlex 525 user manual 520-UM001**O**, Sept 2025 (Rockwell literature, sha `b9445a63…`) | 274 | the RET-001 heritage cases (F004/F005, A551 fault-clear) on a **newer revision** than the prod corpus |
| DURApulse GS10 user manual, 1st Ed Rev B (local copy, sha `090aa1b3…`) | 452 | the #3177 never-ingested manual; row×column spec lookups at scale |
| generated image-only excerpt of T2108 pp.12+15 | 2 | scanned/OCR class with known ground truth |

Classes: exact spec, table row/column, units, synonyms, ordered procedures, warnings,
figure-adjacent, scanned, answer-not-present, sibling-manual leakage, model ambiguity,
revision identity, multi-context values, lexically-easy control, structural-table.

### Lanes

| lane | kind | what it measures |
|---|---|---|
| `factorylm-baseline` | retrieval | the REAL #3185 code (`writePdfChunksForNode` + `retrieveNodeChunks` with docId scope) on a disposable pgvector/pg16 |
| `pymupdf` | retrieval | plain per-page text through a port of the #3185 chunker + held-constant SQLite-FTS5 BM25 |
| `pymupdf-tables` | retrieval | + pymupdf `find_tables()` row-context chunks (cheap geometric table extraction) |
| `docling` / `docling-tables` | retrieval | Docling 2.119.0 IR, tables flattened vs. row-context chunks, same FTS5 bed |
| `docling-scanned` | retrieval | Docling with OCR on the image-only fixture |
| `gemini-native` | answer | Gemini native-PDF document QA (whole manual attached per question), `gemini-3.6-flash`, temperature 0 |
| `textqa-docling` | answer | docling-tables retrieval top-6 → Groq/Cerebras `gpt-oss-120b` composes the answer; citations come from PARSER anchors, not the model |

Retrieval is **held constant** across parser lanes (stdlib SQLite FTS5, AND→OR two-pass
mirroring #3185's shape) so differences measure the *representation*, not retrieval tuning.
Scoring is fully deterministic: marker presence, page-citation match, abstention
detection, document-scope check. No LLM judges. Machine-readable results:
`experiments/doc-intel-bakeoff/out/results.jsonl` (one row per adapter×question with
versions, hashes, latency, cost, evidence).

### Honest exclusions

- **Marker 2.x** — model-weights license (modified OpenRAIL-M: <$5M revenue AND not
  "competitive with the Datalab API"). A benchmark win would be unusable in the product;
  the slot is wasted. Code is Apache-2.0; the weights are not.
- **PaddleOCR-VL** — top OmniDocBench scores, Apache-2.0, but failed its 30-minute
  install gate on this Windows/CPU box (`libpaddle` DLL import failure). Revisit on
  Linux/GPU; do not burn more laptop time on it.
- **olmOCR** — ~12 GB VRAM class; not runnable here.
- **MinerU** — no longer AGPL (relicensed Apache-based at v3.1.0, Apr 2026, with a
  UI-attribution obligation) but GPU-oriented; excluded on practicality, not license.
- **Groq / Together / Cerebras as native-document lanes** — none accepts PDFs (image-only
  vision; Groq caps 5 images/request; its only remaining vision model is a preview).
  They appear where they're actually good: the text-QA stage over parser output.
- **Anthropic/OpenAI** — not configured in this project (hard product constraint;
  no credentials invented).

### Budget

Declared: ≤ $3 metered inference. Actual: **[PENDING]** (per-row `cost_usd` in results;
Gemini free tier — costs are what the tokens *would* bill).

---

## 2. Results

Run r1, 2026-08-11. Machine-readable: `experiments/doc-intel-bakeoff/out/results.jsonl`
(regenerable via the README commands; `summarize.py --md` reproduces these tables).

### By adapter

| adapter | correct | citation | errors | avg lat (s) | est cost |
|---|---|---|---|---|---|
| **gemini-native** (whole PDF attached, 3.6-flash + 3.5-flash-lite) | **28/28** | 18/20 | 0 | 27.9 | $1.17 |
| **textqa-docling** (docling+FTS5 top-6 → Groq gpt-oss-120b) | **18/28** | 9/20 | 0 | 1.3 | ~$0 |
| pymupdf (FTS5, #3185 chunker) | 12/27 | 10/19 | 0 | <0.01 | 0 |
| pymupdf-tables (+find_tables) | 12/27 | 9/19 | 0 | <0.01 | 0 |
| docling (FTS5) | 11/27 | 8/19 | 0* | <0.01 | 0 |
| docling-tables (FTS5, row-context) | 10/27 | 10/19 | 0* | <0.01 | 0 |
| **factorylm-baseline** (REAL #3185, pg tsvector) | **8/27** | 5/19 | 0* | 0.01 | 0 |
| docling-scanned (OCR, scanned fixture only) | **2/2** | — | — | — | 0 |

\* error rows are by-design coverage gaps (the scanned fixture has no text-lane IR;
the OCR lane only covers the scanned fixture), not runtime failures.

### Per-class (correct/total, the decisive columns)

| class | #3185 | best-FTS5-parser | textqa | gemini |
|---|---|---|---|---|
| exact spec | 0/3 | 2/3 | 2/4 | **4/4** |
| table row×column | 2/4 | 1/4 | 0/4 | **4/4** |
| units | 0/2 | 1/2 | 2/2 | **2/2** |
| synonyms | 1/2 | 1/2 | 1/2 | **2/2** |
| procedures | 2/2 | 2/2 | 2/2 | 2/2 |
| warnings | 0/1 | 1/1 | 1/1 | **1/1** |
| scanned | 0/2 | 0/2 (2/2 with OCR lane) | 2/2 | **2/2** |
| answer-not-present | 0/2 | 0/2 | **2/2** | **2/2** |
| sibling leakage | **1/1** | 0/1 | 1/1 | 1/1 |
| model ambiguity | 1/2 | 1/2 | 1/2 | **2/2** |
| revision identity | 1/1 | 1/1 | 1/1 | 1/1 |
| multi-context | 0/2 | 1/2 | 0/2 | **2/2** |
| lexical control | 0/1 | 0/1 | 1/1 | **1/1** |
| structural table | 0/1 | 1/1 | 1/1 | **1/1** |
| figure-adjacent | 0/1 | 1/1 | 1/1 | 1/1 |

### Narrative findings (each traceable to result rows)

1. **Native model QA wins outright on answer quality.** Gemini with the whole PDF
   attached went 28/28 — including all three #3185 spec-table misses, the GS11N-10P5
   row×column lookup in a 452-page manual, both abstention traps, the wrong-manual scope
   question, revision identity, and both scanned pages. The cheap tier
   (`gemini-3.5-flash-lite`) answered its share correctly too. There is **no
   answer-quality gap left for custom document intelligence to close.**
2. **…but its wins are operationally fenced.** Every question re-reads the full manual
   (~258 tokens/page ⇒ ~117k tokens per GS10 question; ~$1.17 estimated for one
   28-question pass); the flagship model's free-tier daily quota exhausted mid-run
   (15/28 first-pass 429/503, then 15/15 429s on same-day retry — a second model tier's
   separate bucket was needed to finish); page citations are self-asserted (18/20 = 90%
   precision, no API anchors); and Files-API uploads expire in 48h. Deterministic on the
   repeat probe (temp 0, byte-identical), but determinism is a model property we don't
   control.
3. **The production retrieval shape loses exact-token questions to its own stemming.**
   The real #3185 lane (Postgres `english` tsvector) misses "What does fault F004 mean"
   against a *single 274-page manual* — while the identical chunker under unstemmed
   FTS5 finds it. The production PF525=RETRIEVAL root cause reproduced in a controlled
   corpus: a representation/config property, not corpus size.
4. **Parse-then-QA more than doubles the baseline for free.** docling+FTS5 top-6 →
   Groq `gpt-oss-120b` scores 18/28 at ~$0 and 1.3s/question, fixing every judgment
   class (abstention 2/2, scope 1/1, scanned 2/2 via OCR IR, units, warnings) — and its
   remaining failures are ALL retrieval misses, not answer-composition failures. Its
   citations (9/20) inherit retrieval's page errors — parser anchors only help when the
   right chunk is retrieved. Also NOT deterministic across reps (provider-side), unlike
   the retrieval lanes.
5. **The retrieval bottleneck is RANKING, not parsing.** Docling's IR contains the
   answers verbatim — its PF525 p161 table serializes to `F004 [Description]: DC bus
   voltage fell below the min value`, the exact lexical bridge the question needs — yet
   `docling-tables` still fails that question: BM25 length-normalization ranks the big
   table chunk below index/parameter pages that repeat the query tokens. Matches the
   2026 literature (reranking is the single largest retrieval lever, +17pp; BM25 beats
   dense on spec tables; structure-aware chunking doubles BM25 recall@1 *when ranking
   can surface it*).
6. **Cheap geometric table extraction is worthless; ML table extraction is necessary
   but not sufficient.** pymupdf `find_tables()` moved nothing (12→12). Docling's
   TableFormer extracts ruled tables beautifully (402 tables in PF525) but does NOT
   classify the T2108 Specifications key-value LAYOUT as a table — the spec-lookup
   problem is broader than ruled tables, which is exactly why the native-model lane
   (which reads layouts like a human) sweeps that class.
7. **OCR is a solved dependency, not a build.** Docling's OCR lane answered 2/2 on the
   image-only fixture on this CPU-only laptop.
8. **Only the FactoryLM path enforces boundaries.** #3185 was the only lane where
   sibling-manual isolation is *structural* (gate F: SQL predicate) rather than model
   good-behavior. Gemini also declined the wrong-manual question — but that is
   compliance, not enforcement, and nothing in a native-API path enforces tenancy.

---

## 3. ARPK falsification analysis

The 12 capabilities the ARPK concept claimed FactoryLM needs, scored against what the
measured systems already provide:

| capability | native (Gemini) | OSS parse (Docling) | #3185 today | needs owning? |
|---|---|---|---|---|
| durable structured facts (not transient answers) | ✗ transient | ◐ structure, no facts | ✗ chunks only | ◐ only as *evidence-linked extractions*, not a format |
| stable evidence anchors | ✗ self-asserted (90%) | ◐ bbox per parse, positional refs | ◐ page anchors | **✓ — content-derived anchor IDs (the one novel piece)** |
| reproducible citations | ✗ | ✓ from anchors | ✓ page-level | ✓ keep + deepen to region |
| document revision identity | ✗ | ✗ | ◐ sha only | **✓ — issue/inWork + supersession** |
| source hashes | ✗ | ✗ (non-crypto binary_hash) | **✓ (072 dedup)** | already ours |
| provider-independent portability | ✗ | ✓ | ✓ | via parser-adapter seam |
| deterministic query w/o re-reading PDF | ✗ (re-reads, throttles) | ✓ | ✓ | via parsed IR at rest |
| structured tables/specs/procedures | ✓ at answer time | ✓ ruled tables (not layouts) | ✗ | **use Docling; don't build** |
| fact↔evidence relationships | ✗ | ✗ | ✗ | ✓ thin join, if/when facts land |
| offline/local usability | ✗ | ✓ | ✓ | via Docling |
| model swap w/o recompiling knowledge | ✗ | ✓ | ✓ | via parse-then-QA architecture |
| enforceable doc/tenant boundaries | ✗ | ✗ | **✓ (gate F, RLS, is_private)** | already ours — the moat |

Reading: the LEFT columns falsify building document intelligence (parsing, OCR, tables,
answer quality — all commoditized or nearly so). The RIGHT column is small and specific:
anchors, revision/supersession, the fact↔evidence join *when needed*, and the boundary
enforcement FactoryLM already ships. **That is a thin evidence layer, not a portable
compiled-document standard** — hence Verdict B and no `ARPK-CONCEPT-0.1.md`. The
codename "ARPK" should be retired in favor of "the evidence contract."

---

## 4. Standards: reuse, don't invent

Full research (verified against current specs, Aug 2026) — summarized; the composition
below is what any durable layer should be built FROM, regardless of verdict:

| standard | verdict | what we take |
|---|---|---|
| **DoclingDocument** (schema 1.10, docling-core) | **reuse wholesale as the IR** | doc/page/block/table identity, `ProvenanceItem{page,bbox,charspan}`; the de-facto document-AI IR. Traps: `binary_hash` is non-cryptographic; `self_ref` is positional (unstable across re-parses); `coord_origin` is bimodal — pin TOPLEFT |
| **W3C Web Annotation** | **reuse wholesale for evidence anchors** | `SpecificResource` + `FragmentSelector`(#page)/`TextQuoteSelector`/`TextPositionSelector` + `refinedBy` composition; multi-selector redundancy = graceful anchor degradation |
| **BagIt (RFC 8493)** | **reuse wholesale for integrity** | `manifest-sha256` + `tagmanifest` + complete-vs-valid semantics |
| **PROV-O** | map ~8 predicates ("PROV-lite") | `wasGeneratedBy/wasDerivedFrom/wasRevisionOf/wasAttributedTo`, SoftwareAgent w/ versions |
| **S1000D** | map 3 concepts | composite doc identity; `issueNumber`+`inWork` revisioning; applicability as a referenced table |
| **AAS Handover Documentation (IDTA 02004-2-0) + VDI 2770** | map; **reuse the VDI 2770 class IDs verbatim** in the industrial profile | DocumentId(+domain,+isPrimary), Version/StatusValue, DocumentedEntities (asset binding); export target, not internal model |
| JSON-LD | discipline only | `@id`/`@type`/embedded `@context`; no framing/triplestores |
| RO-Crate | pattern only | `conformsTo` profile IRIs; detached-crate idea |
| DITA | ignore; steal 8 enum strings | task/concept/reference/troubleshooting/hazard fact kinds; hazard = signal-word/consequence/how-to-avoid |
| iiRDS 1.3 / IEC 63485 | watch | the standard most likely to claim this territory by 2028; keep one field mappable |
| C2PA | later | signatures only when a customer demands non-repudiation |

**What no standard provides** (the residual any owned layer must contribute):
(1) stable *content-derived* block anchor IDs (Docling's `self_ref` is positional);
(2) the fact↔evidence join (claim ← n anchors + extractor identity + confidence);
(3) anchor-preserving supersession (which anchors survived a revision — "the torque
spec moved from p.12 to p.14 and changed" is the maintenance-AI ballgame);
(4) a rights block.

## 5. Rights model (technical, not legal)

Adopted stance regardless of verdict: the safest initial consumer workflow is
**user-supplied private documents**; nothing in the core may assume redistribution.
Fields (carried per document, enforced at serving surfaces):

```
rights:
  source_url: <where it came from, if fetched>
  source_sha256: <pinned>
  user_supplied: true|false
  rights_holder: <string|unknown>
  license: <spdx-or-freeform|unknown>
  redistribution: none|excerpt|full|unknown     # default: none for user uploads,
  derivative_processing: allowed|unknown        #   unknown for fetched OEM docs
  visibility: private|tenant|public             # maps to is_private today
  excerpt_limit_words: <int|null>
```

`unknown` is a legitimate value everywhere; surfaces must fail CLOSED on `unknown`
redistribution (serve excerpts-with-citation to the owning tenant only — which is
exactly what #3185's `is_private=true` + doc-scoped chat already does).

## 6. Parser architecture (adopted regardless of verdict)

```
PDF/source → parser ADAPTER → normalized document IR → (optional structured extraction)
          → retrieval/indexes (disposable) → evidence → answer
```

- FactoryLM depends on the adapter interface, never on a specific parser. The bake-off's
  `adapters/` directory is the proof-of-shape: pymupdf and Docling normalize into one IR
  and are compared under identical retrieval.
- Indexes/embeddings are disposable acceleration structures — never canonical truth
  (already true in #3185: embeddings are a best-effort trailing pass; BM25 is generated
  from `content`).
- A stronger parser/model replaces the adapter without changing evidence semantics.

---

## 7. Technical debt discovered

1. **P0 — Groq model shutdown, production impact in days:** `llama-3.3-70b-versatile`
   and `llama-3.1-8b-instant` shut down **2026-08-16**; the Hub chat cascade defaults to
   `llama-3.3-70b-versatile` (`GROQ_MODEL ?? "llama-3.3-70b-versatile"` in the asset/node
   chat routes) and engine-side defaults may match. Migrate defaults (e.g.
   `openai/gpt-oss-120b`) before 08-16 or Hub chat's primary provider 404s.
2. **#3185 baseline vs. unstemmed BM25:** Postgres `english` stemming demonstrably costs
   exact-token recall (fault codes, part numbers). Candidate low-risk fix: dual-index
   (`simple` + `english`) or the fault-code side-stream (#3176's approach) generalized.
3. **Docling on Windows/CPU requires `TORCHDYNAMO_DISABLE=1`** (torch.compile requires
   a C++ compiler) and page-batched subprocesses on 16 GB machines (whole-manual parses
   `std::bad_alloc`). Recorded in the batched wrapper.
4. **paddlepaddle Windows wheel imports fail** (`libpaddle` DLL) — blocks the
   best-scoring open parser on this class of dev machine.
5. **Gemini free-tier TPM** makes whole-manual-per-question QA operationally fragile
   (15/28 first-pass throttle failures) — any native-doc lane needs caching (Files API
   48h expiry) and budget control.
6. `file` (libmagic) reports linearized-PDF page counts wrongly (said 18; real 274) —
   never use it for PDF metadata in tooling.
7. **Leak class: query-param credentials in persisted exception text.** httpx embeds
   the full request URL in `HTTPStatusError` messages; a `?key=` auth param put the
   live Gemini key into 30 persisted result rows. Caught by the gitleaks pre-commit
   (never committed/pushed); rows scrubbed; the adapter now sends the key ONLY via
   `x-goog-api-key` header. Rule for any tool that persists error text: auth in
   headers, never in URLs. (Rotating `GEMINI_API_KEY` is a cheap belt-and-braces
   option — the key only ever touched local gitignored files.)

## 8. Phase 2 recommendation (exact scope)

Ordered by measured leverage; each item cites its evidence. Everything rides the
existing one-pipeline + #3185 guarantees — no new pipeline, no new format.

**Step 0 (this week, independent of everything):** migrate the Groq default model off
`llama-3.3-70b-versatile` (shutdown 2026-08-16) in the Hub chat cascades and anywhere
engine-side — e.g. to `openai/gpt-oss-120b`.

1. **Answer stage over retrieved evidence (parse-then-QA) on the doc-chat path.**
   8/27 → 18/28 measured, ~$0 (Groq free tier), ~1.3s. This is the `textqa` lane
   productized: retrieved chunks → cite-or-refuse JSON answer with pages taken from
   chunk anchors. Slots into the existing NodeChat cascade (which already fronts an
   LLM); keeps citation_compliance semantics; abstention/scope classes go from 0 to
   green. NOT a new fast-path fork — it's the existing chat surface's grounding.
2. **Retrieval repair in the #3185 SQL path.**
   (a) exact-token side-channel: unstemmed (`simple`-config) tsvector OR'd with the
   `english` one — kills the stemming loss (F004-class; baseline 8 vs FTS5 12 measured);
   (b) candidate-pool widening + rerank (top-24 → rerank → 6) — the literature's +17pp
   lever and the fix for finding 5 (long table chunks ranked out); rerank via the free
   cascade LLM scoring or a small local cross-encoder — measure both.
3. **Docling behind the parser-adapter seam for uploads.** Replace/augment the unpdf
   text-only extraction with a Docling adapter emitting: real tables (row-context chunk
   text), `section_path` (headings), bbox anchors persisted into the EXISTING 045
   columns, and OCR fallback for zero-text PDFs (2/2 measured; converts 1c's honest
   failure into ingestion). Windows/CPU caveats are containerized away (dynamo off,
   page-batching, ~0.5-2s/page). Marker stays excluded (license); PaddleOCR-VL is the
   Linux/GPU upgrade candidate later.
4. **The thin evidence contract (the durable layer).** Metadata on existing rows/tables
   — not a file format: content-derived anchor IDs (`sha256(page ‖ quantized_bbox ‖
   normalized_text)[:16]`), Web-Annotation-shaped selector JSON per chunk, BagIt-style
   per-document manifest (source + IR + pages digests; 072's `content_sha256` is the
   seed), PROV-lite compile record (parser+versions+timestamps), S1000D-style
   `issue_number/in_work` + `wasRevisionOf` on documents, and the rights block (§5).
   VDI 2770 classification + AAS Handover export live in the industrial profile,
   deferred until a customer asks.
5. **Native-model document AI as an extraction/cross-check tool, not the serving
   path.** Gemini's 28/28 is best amortized per-DOCUMENT (extraction-time enrichment,
   golden-answer generation for validation questions, spec-table → structured facts),
   where cost is paid once and outputs are pinned to anchors — not per-question at
   ~117k tokens with daily-quota fragility and unverifiable self-citations.

**Explicitly NOT in Phase 2** (falsified or unjustified): a custom PDF parser, custom
OCR, custom table models, a `.arpk` file format, a new ontology, embedding-architecture
work (BM25+rerank beat dense on this class in the current literature; embeddings stay
the disposable trailing pass), and any weakening of #3185's gates.

## 9. Reproducing

See `experiments/doc-intel-bakeoff/README.md` — every command, pinned versions
(docling 2.119.0, pymupdf 1.28.0, gemini-3.6-flash, gpt-oss-120b), fixture hashes,
and the disposable-postgres baseline lane.
