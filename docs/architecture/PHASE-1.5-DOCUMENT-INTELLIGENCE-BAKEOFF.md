# Phase 1.5 — Document Intelligence Bake-off & ARPK Go/No-Go

**Date:** 2026-08-11 · **Branch:** `exp/phase15-doc-intel-bakeoff` (stacked on held PR #3185)
**Harness:** `experiments/doc-intel-bakeoff/` (disposable; repro commands in its README)
**Baseline:** PR #3185 — immutable reference; nothing here modifies its guarantees.

> VERDICT: **[PENDING — filled from final benchmark data below]**

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

**[PENDING — full per-adapter and per-class tables from summarize.py, plus the
narrative findings. Interim findings already locked:]**

- **The production retrieval shape loses exact-token questions to its own stemming.**
  The real #3185 lane (Postgres `english` tsvector) misses "What does fault F004 mean"
  against a *single 274-page manual* — F004's fault-table page ranks below parameter-list
  pages — while the identical chunker under unstemmed FTS5 finds it. This reproduces the
  production PF525=RETRIEVAL root cause in miniature and confirms it is a property of
  the *representation/config*, not corpus size.
- **Cheap geometric table extraction is worthless for the spec-table class.** pymupdf
  `find_tables()` row-context chunks changed nothing (12/27 → 12/27): the T2108
  Specifications "table" is a designed key-value layout, not ruled lines, and it isn't
  detected. Docling's TableFormer detects real tables beautifully (error-tone and
  troubleshooting tables come out in perfect row-context form) but ALSO does not call
  the T2108 spec layout a table — evidence that "table-aware chunking" alone is not a
  silver bullet for spec lookups; the lexical-bridge problem is broader than ruled tables.
- **Gemini native-PDF QA is highly accurate when it answers** — **[PENDING exact n]** —
  with mostly-correct self-reported pages, but free-tier throttling killed 15/28
  whole-manual requests on the first pass (429/503), and each question costs a full
  manual re-read (~117k tokens per GS10 question). Whole-doc-per-question is an
  operational non-starter at fleet scale; page anchors are self-asserted, not returned
  by the API.

---

## 3. ARPK falsification analysis

**[PENDING — the 12-capability checklist scored against the measured lanes:]**
durable structured facts · stable evidence anchors · reproducible citations · revision
identity · source hashes · provider-independent portability · deterministic querying
without re-reading the PDF · structured tables/specs/procedures · fact↔evidence
relationships · offline/local usability · model-swap without recompiling · enforceable
document/tenant boundaries.

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

## 8. Phase 2 recommendation

**[PENDING — exact scope from the verdict.]**

## 9. Reproducing

See `experiments/doc-intel-bakeoff/README.md` — every command, pinned versions
(docling 2.119.0, pymupdf 1.28.0, gemini-3.6-flash, gpt-oss-120b), fixture hashes,
and the disposable-postgres baseline lane.
