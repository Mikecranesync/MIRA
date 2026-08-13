# Chat With Any Manual — research synthesis + design

**Date:** 2026-08-10 · **Author:** Claude (4 parallel research agents over the codebase, held PRs #3176/#3179/#3182/#3183, issue #3177, and the 2026-08 measurement docs)
**Question:** "How do we make MIRA read any user manual and chat with it — e.g. upload a Eufy RoboVac 11S PDF and ask it questions?"
**Status:** research + proposal. Nothing merged, nothing decided. Scope decision (§6) is Mike's.

> Repo-state caveat: the checkout researched was `codex/dogfood-useful-work`, ~450 commits behind
> `origin/main`. Where main differs materially (Open WebUI sunset `7b537b0cb`, page-number fixes
> `#2910`/`#2968`, text/markdown ingest `#2277`) the agents read main directly and it is noted.

---

## 1. TL;DR

**This already works today, on exactly one path.** Upload a PDF in the Hub → it lands as
`is_private=true` v2 chunks under the per-tenant **Inbox** node → open `/namespace?node=inbox&chat=1`
→ NodeChat answers with citations (filename + real page numbers). That is literally the beta-gate
chain, it is vendor-blind, and nothing in upload or ingest rejects or mis-tags a consumer manual —
manufacturer/model are simply NULL and BM25 doesn't care.

**What's missing is (a) document-scoped chat as a product surface** — NodeChat scopes to a
namespace subtree, so every doc in Inbox competes in one BM25 pool, and the document detail page's
"Ask MIRA" button is mock data + a Telegram deep link — **and (b) ingest quality** — the v2 writer
extracts zero metadata (no manufacturer/model/section_path), shreds tables with a 1000-char
page-bounded chunker, has no content-hash dedup, silently reports success on scanned PDFs (0
chunks), and its embed-on-write is fire-and-forget with 0% coverage on staging.

**The single highest-leverage finding:** every model-scoped retrieval stream — RET-001 (#3176),
manual_nav (#3183), product search, asset chat — is **inert for uploads by construction**, because
the v2 INSERT has no `manufacturer`/`model_number` columns. This is the same defect class the
measurement program proved for GS10 (#3177: INGEST, not RETRIEVAL). The upload door reproduces it
for every document.

---

## 2. What exists today (the working spine)

```
door                                   writer                          reader
/api/uploads/local  (browser blind) ┐
/api/uploads/folder (service token) ├→ resolveOrCreateInboxNode
/api/namespace/node/[id]/files ─────┘   → writePdfChunksForNode        retrieveNodeChunks
                                          (node-knowledge-ingest.ts)     (manual-rag.ts:375)
                                          unpdf → per-page 1000-char     BM25 AND→OR tsquery,
                                          chunks, is_private=true        UNS-subtree scoped,
                                          literal, real page numbers,    ingest_route='v2',
                                          doc_id, ingest_route='v2',     NO vendor filter,
                                          metadata.node_id               NO tenant-wide fallback
                                                                       → NodeChat SSE
                                                                         /api/namespace/node/[id]/chat
```

Key properties, verified with file:line by the research agents:

- **Tenant safety is right.** `is_private = true` as a SQL literal (`node-knowledge-ingest.ts:262-266`),
  hybrid read law honored; NodeChat runs tenant-only inside `withTenantContext`.
- **Page anchors are real** on v2 (`page_start = page_end = p+1`) — the "p160 == p1251" corruption is a
  legacy-corpus artifact, not a v2 one.
- **NodeChat is the one vendor-blind retriever.** No manufacturer scope, no model regex, no UNS gate
  dialogue — "the node selection IS the UNS location-confirmation gate" (route header, UNS-020).
- **Dead/misleading surfaces:** `/api/documents/upload` is a JSON demo shim (no bytes, 1 row);
  `POST /api/uploads` (Drive/Dropbox pick) fed Open WebUI, which main has sunset — that door now
  writes nowhere; `documents/[id]/page.tsx` renders a hardcoded `DOCS` mock and its "Ask MIRA"
  button is a Telegram deep link; `docs/runbooks/upload-manual-verify-citable.md` is stale (pre-#1592).

### Every other chat surface, and why it can't see the Eufy manual

| Surface | Verdict | Blocking mechanism |
|---|---|---|
| Hub NodeChat | ✅ works | — |
| Hub asset chat | ❌ | scopes BM25 by the *asset's* manufacturer; node chunks have NULL manufacturer, can never match (`manual-rag.ts:289`, `scopeCascade`) |
| Hub quickstart | ❌ by design | pinned to the system/OEM tenant |
| `/api/mira/ask` | ❌ | never touches `knowledge_entries` |
| Telegram/Slack | ❌ in practice | needs a `chat_tenant_map` row (no self-service command exists); unmapped chats collapse to `MIRA_TENANT_ID` = shared OEM corpus only; and the engine's routing sends "how do I clean…" to `_handle_instructional_question` — a **zero-retrieval** pure-LLM path |
| mira-web / mira-pipeline | ❌ | same engine, same tenant caveat |

---

## 3. What would bite a consumer manual (ranked, from the gap audit)

**Would NOT bite** (legacy-corpus artifacts): 1.80× duplication / 1,077 page conflicts (PF525 was
ingested five times; one upload = one ingest), page-index-as-page corruption (v2 pages are real),
the canonicalizer P0 (operator tool, never runs on uploads).

**Would bite:**

1. **P0 — no manufacturer/model on v2 chunks** → every model-scoped stream inert (see §1). Also:
   bot-side citation labels degrade to empty (`format_source_label`), and asset chat can never find
   the doc.
2. **P0 — safety tripwire misfire** (bot surfaces only): "should I disconnect power before cleaning
   the brush" → tier-1 `SAFETY_KEYWORDS_IMMEDIATE` ("disconnect power") → hard STOP reply **+ pages
   the maintenance channel** (`guardrails.py:77-104,826-827`; `engine.py:2241-2250`). Bypasses the
   educational carve-out by design.
3. **P0 — vendor rails fail open on unknown vendors** (bot surfaces): with `manufacturer=None`, the
   cross-vendor filter is skipped and the citation-relevance gate never fires — industrial chunks
   can silently ground and cite a vacuum answer (`rag_worker.py:720-751`; `citation_compliance.py:87,97`).
4. **P0 — prompts are industrial-hardcoded everywhere**, including NodeChat's persona; the engine's
   diagnostic ladder would ask a robot vacuum about three-phase input voltage. NodeChat's is a tone
   problem; the engine's is a correctness problem.
5. **P1 — alias collisions actively mis-scope consumer text:** "sew a seam on my Singer 4423" →
   SEW-Eurodrive @ 0.7 confidence; Omron (blood-pressure monitors), Delta (faucets); Python
   `canonical_vendor()` has an unbounded-substring bug ("Abbott"→ABB, "Kabota"→Rockwell) that the TS
   port fixed with word boundaries — the two disagree.
6. **P1 — chunking shreds structure:** 1000 chars, page-bounded, mid-word hard cuts past 50% window;
   tables flattened; `section_path` never written. The good chunker (table-aware, section-aware,
   sentence-boundary, quality labels) exists in `mira-crawler/ingest/chunker.py` and is unreachable
   from any upload door.
7. **P1 — no content-hash dedup on v2:** `source_url` embeds the uploadId, so re-uploading the same
   PDF produces a full second chunk set (documented incident: `gs10_fault_codes.pdf` ingested 158×).
   The only SHA-256 dedup in the stack lives on the dead Open WebUI path (and client-side in MiraDrop).
8. **P1 — scanned/image-only PDFs report success with 0 chunks** (`indexed:true, chunkCount:0`);
   no OCR on any live path (docling removed for OOM).
9. **P1 — embeddings are best-effort-then-silent:** fire-and-forget after the 201; staging is
   `OLLAMA_BASE_URL=disabled://staging` → **0% embedded** (and the beta gate runs against staging, so
   it has only ever proven BM25); prod pointed at an offline home-lab box per CHANGELOG. Mitigating:
   NodeChat is BM25-only, so doc chat works anyway. The embedding-coverage canary deliberately
   excludes `node_attachment`.
10. **P2 — measured retrieval limits transfer partially:** the 0.70 absolute cosine floor is a
    query/embedding-model property (correct chunks measured at 0.58–0.62), and BM25 `ts_rank_cd`
    rewards token repetition (spec tables beat procedure text). Small doc-scoped pools help a lot,
    but don't fix either mechanism. Production recall on the OEM corpus missed the expected passage
    on 4/5 answerable cases (broader than "reset" — includes plain F004 lookup).
11. **P2 — landmines:** `MIRA_ENFORCE_APPROVED_ASK/RETRIEVAL=true` would 412 every node upload
    (`verified` on `knowledge_entries` is never set by the verify route — it updates
    `namespace_direct_uploads.verified` instead); `kg_entities.approval_state` default is ambiguous
    between migrations 008 (`'verified'`) and 029 (`'proposed'`) and neither node creator sets it —
    if the live default were `'proposed'`, NodeChat would 404 on the Inbox node (beta gate passing
    implies it's `'verified'`; **verify with one `SELECT column_default` before building on it**).
12. **P2 — beta-gate assertion is weak:** `CITATION_MARKERS` includes `"["`/`"manual"`/`"—"` and the
    prompt instructs `[n]` citations, so a hallucinated `[1]` with zero retrieved chunks passes; the
    real `sources` SSE frame is parsed and discarded. One added assertion (`len(sources) > 0`) makes
    it airtight.

### What already works and should be the foundation

- `retrieveNodeChunks` — vendor-agnostic, tenant-safe, no widening. Right shape.
- `mira-crawler/ingest/uns.py` builders — fully domain-neutral (`enterprise.knowledge_base.eufy.robovac_11s` is clean and valid); retrieval never keys on `uns_path`, so an odd path costs only tree browsing.
- `manufacturer_normalize.py` doctrine — "unknown vendors pass through unchanged." Extend this posture upward; do NOT grow the alias table.
- `doc_id` is already written on every v2 chunk. Document-scoped retrieval is a WHERE clause away.
- Drive-pack `/ask` (`mira-bots/ask_api/drive_pack.py`) — the proven fast-path contract for doc-grounded Q&A (citation-or-refuse, falls through, read-only), but its universe is 3 hand-curated packs; it's a curated-artifact pattern, not chat-with-my-PDF.

---

## 4. Relationship to the held measurement work

- **#3176 (RET-001)** and **#3183 (manual_nav)** are both model-scoped ⇒ **inert for uploads until
  metadata extraction ships**. manual_nav additionally hardcodes `is_private = false` — it cannot see
  uploads at all.
- **manual_nav's 0/5 recall** came from navigating ONE physical ingest (~25% of distinct PF525
  content) and deriving hierarchy that ingest never wrote. If Phase 2 below writes real
  `section_path`/pages at upload time, the lane's preconditions invert: uploads become the corpus
  where structure-aware navigation is *cheap*, and its 0-contamination property is exactly what
  doc-scoped chat wants. Revisit it then — don't integrate it now.
- **#3179 (TRH)** and **#3182 (corpus safety)** apply cleanly, but TRH oracles and `corpus_health`
  are written against `is_private=false`; the upload product needs a private-rows oracle story.
- The program's own root-cause split (PF525=RETRIEVAL vs GS10=INGEST) predicts the upload wedge:
  **the upload door's problems are INGEST-class first.** Fix ingest metadata/structure before
  touching retrieval — consistent with the standing "measure the verbatim-quote ceiling before any
  query-side fix" law.

---

## 5. Proposed plan

### Phase 0 — nothing to build (today)
Upload the Eufy 11S PDF at app.factorylm.com (any Hub upload widget) → open
`/namespace?node=inbox&chat=1` → ask. Cited answers with filename + page. Two pre-checks worth one
minute each: `SELECT column_default` for `kg_entities.approval_state` on prod/staging (§3.11), and
confirm neither `MIRA_ENFORCE_APPROVED_*` env var is set.

### Phase 1 — "Chat with this document" (small, ships the product shape)
1. `retrieveDocumentChunks` = `retrieveNodeChunks` + `AND doc_id = $docId` (column already
   populated). Optional param on the existing function; no new pipeline (one-pipeline law intact).
2. Real documents list (replace the `DOCS` mock with `/api/documents`-backed data) + a per-document
   **Chat** button → the NodeChat component with a `docId` scope. Kill the Telegram deep link.
3. Neutral prompt variant for doc-scoped chat when `manufacturer` is NULL: keep the grounding +
   `[n]`-citation + safety rules, drop the "industrial equipment / techs on the floor" persona.
4. Server-side content-hash dedup at upload (SHA-256 per tenant → return the existing doc instead of
   re-chunking). Closes the 158× class.
5. Honest failure on zero extractable text ("this PDF appears to be scanned — no text layer") instead
   of `indexed:true, chunkCount:0`.
6. Beta-gate hardening: assert the `sources` SSE frame is non-empty.

### Phase 2 — ingest quality (makes the answers good and unlocks the held work)
1. **Metadata extraction at ingest:** title/manufacturer/model from the first pages (cheap LLM call
   on the cascade), pass-through unknown vendors unchanged, write `manufacturer`/`model_number` on
   the chunks + a doc-level record. This single change un-inerts #3176/#3183/product-search for
   uploads and fixes bot citation labels.
2. **Shared chunker:** port the crawler's table/section-aware chunker to the v2 writer (or extract it
   into a shared lib both call); write `section_path`.
3. **OCR fallback** for scanned PDFs (Tesseract; docling is dead).
4. **Embed-on-write hardening:** durable retry queue + resume, include `node_attachment` in the
   embedding-coverage canary — or explicitly commit doc-chat to BM25-only and document that.

### Phase 3 — retrieval + other surfaces (only after 1–2)
- Private-rows oracle story for TRH; re-run the frozen benchmark against a Phase-2-ingested manual;
  reconsider manual_nav on real structure.
- Telegram access: self-service `chat_tenant_map` link command + a doc-scoped fast-path
  (drive-pack contract: citation-or-refuse, falls through). Only then do the bot-surface P0s
  (safety-tripwire phrasing, fail-open vendor rails, `canonical_vendor` substring bug, alias
  collisions) become blocking; fix them as part of that work, not before.

### Explicitly NOT proposed
- Growing the vendor alias table to include consumer brands (wrong direction; pass-through doctrine).
- A second retrieval/ingest pipeline for uploads (one-pipeline law; everything above extends the
  existing v2 writer + `manual-rag.ts`).
- Making the Telegram engine answer consumer questions generically (scope, §6).

---

## 6. The scope decision (Mike's call, not engineering's)

Doctrine says, five times over, "not a generic chatbot," and NORTH_STAR L85 explicitly sequences the
**generic-upload beta behind Drive Commander**. Grep finds zero mention of consumer manuals — the
question is unaddressed, not rejected.

Two honest readings:

- **Narrow (doctrine-compliant):** Phases 1–2 are not a consumer pivot. "Upload any manual and chat
  with it" is the beta gate generalized — the context-layer wedge itself. The Eufy PDF is a *canary
  for vendor-agnosticism*: if the pipeline only works for the ~15 alias-table OEMs, it will fail the
  first stranger whose factory runs Fuji, Hitachi, or a no-name Chinese VFD. Every Phase 1–2 item
  improves the industrial product directly.
- **Broad (requires amending NORTH_STAR + scope-guard):** actually marketing "chat with any manual"
  to consumers. The scope guard as written classifies that Defer, and the bot-surface P0s (§3.2–3.4)
  make it unsafe on Telegram today.

Recommendation: take the narrow reading. Build Phases 1–2 as beta-gate/context-layer work, use the
Eufy manual as the standing vendor-agnosticism test fixture, and leave the broad reading parked
unless the wedge changes.
