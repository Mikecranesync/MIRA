# KG + KB System: Architecture, Autonomous-Growth, and Answer/Citation-Quality Audit

**Date:** 2026-06-16
**Author:** Claude (Opus 4.8) on CHARLIE, at Mike's request
**Question:** Understand the knowledge-graph + knowledge-base system; verify it's growing
autonomously *as it should be*; benchmark the intelligence quality of its answers + citations.

> **Framing (per advisor):** these are not three separate questions — they are one chain.
> **Growth → Retrievability → Citation.** Rows can pile up in `knowledge_entries` and still be
> uncitable if they land on a route the retrieval path can't see. Read the three parts as a single
> pipeline with a known break in the middle (the upload→retrieval gap).

---

## Part 1 — Architecture (what the system *is*)

Two distinct stores share one UNS (ISA-95 ltree) address space:

| Store | Table(s) | Holds | Retrieval keys |
|---|---|---|---|
| **Knowledge Base (KB)** | `knowledge_entries` | Document chunks (manual text, fault-code rows, datasheets) + `embedding` (pgvector) + `content_tsv` (BM25) | `tenant_id`, `isa95_path`/`uns_path`, `metadata->>'node_id'` |
| **Knowledge Graph (KG)** | `kg_entities`, `kg_relationships` | Assets/components/manufacturers as UNS-addressed nodes + typed edges | `uns_path` (ltree ancestor query `<@`), `entity_id` |

**Two retrieval surfaces read the KB — and they use different grounding models** (this is the
crux of the upload→retrieval gap):

1. **Bot / chat path** — `mira-bots/shared/neon_recall.py::recall_knowledge` (`neon_recall.py:640`).
   *Hybrid* retrieval: dense vector (pgvector cosine) **+** structured fault-code lookup **+**
   product-name rerank **+** BM25. Scopes to `tenant_id = caller OR tenant_id = SHARED_TENANT_ID`
   (the OEM corpus, system tenant `78917b56-…`). This is the **active VPS chat path**.

2. **Hub NodeChat / folder=brain path** — `mira-hub/src/lib/manual-rag.ts::retrieveNodeChunks`
   (`manual-rag.ts:277`). BM25 over `content_tsv`, gathering a node **and its UNS subtree**
   (`uns_path <@ ltree`), filtered to `ingest_route = 'v2'` + `metadata->>'node_id'`. AND→OR
   tsquery fallback so conversational questions still ground. This is the **upload→retrieval path**
   (PR #1592), and the **only** path that sees per-tenant uploads.

**Citation** rides on `source_url` / `source_page` / `page_start` / `metadata->>'filename'`
carried through each chunk → becomes the citable title+page. Groundedness scoring +
KB-gap admission live in `mira-bots/shared/citation_compliance.py` + `engine.py`.

**Implication:** a manual uploaded by a customer (folder=brain, `ingest_route='v2'`, node-scoped)
is retrievable by the **Hub path** but NOT by the **bot/chat path** (which keys on tenant/shared +
vector/BM25, not `node_id` subtree). Two grounding models over one table = the documented gap.

---

## Part 2 — Is it growing autonomously *as it should be*?

### 2a. The write paths (code that exists)

| Table | Autonomous writer (code) | Gate |
|---|---|---|
| `knowledge_entries` | `mira-crawler/ingest/store.py` (crawl/folder-watch), Hub folder=brain upload (`node-knowledge-ingest.ts`) | none per-chunk |
| `kg_entities` (nodes) | `mira-crawler/ingest/kg_writer.py::upsert_entity` during chunk ingest | none (direct write) |
| `kg_relationships` (verified edges) | **propose-only** → `relationship_proposals` + `ai_suggestions`; human verifies at `/api/proposals/[id]/decide` | **human approval required** |

So *by design*: nodes + chunks grow without review; **verified edges require a human**. That part of
the design is correct (it's the "never auto-promote proposed→verified" rule).

### 2b. The critical distinction: **code that exists ≠ jobs that run in prod**

The crawler fleet (`mira-crawler` + Trigger.dev scheduled tasks — RSS/sitemap/YouTube/GDrive/
discovery) is **real code**, but the evidence says it is **not running against prod**:

- `mira-crawler` is only in the **dev** `docker-compose.yml` — **not** in the prod Container Map
  nor `docker-compose.saas.yml`.
- Prod Doppler (`factorylm/prd`) has **no `TRIGGER_*` secret** (only `APIFY_API_KEY` /
  `FIRECRAWL_API_KEY` — crawl *API keys*, not a scheduler). Trigger.dev cloud cannot deploy/run
  tasks against prod NeonDB without its secret.
- History: Trigger.dev was killed after the May-2026 VPS OOM incidents; revival was gated
  (see `project_vps_oom_docling_incidents`).

⇒ **Hypothesis: prod KG/KB is NOT growing from an autonomous crawler fleet.** The live growth that
*does* happen is **per-tenant uploads** (folder=brain) + any cron'd photo/GDrive scanners. The
~83.5k-chunk OEM corpus is a **one-time seed** (system tenant), not a continuously-fed stream.

### 2c. Live evidence (the arbiter: recency, not count)

Dispatched the sanctioned read-only prod probe (`db-inspect.yml` extended with per-table
`MAX(created_at)` + last-7d/30d counts + a `knowledge_entries` breakdown by `is_private` +
`source_type`): **run `27659198925` → `success`. PROD numbers (2026-06-17):**

**Per-table recency:**

| table | total | last 7d | last 30d | newest row |
|---|--:|--:|--:|---|
| `knowledge_entries` | 83,613 | **60** | **71** | 2026-06-16 |
| `kg_entities` | 971 | 351 | 902 | 2026-06-17 |
| `kg_relationships` | 304 | **1** | 274 | 2026-06-12 |
| `ai_suggestions` | **6** | **0** | 6 | 2026-05-25 |
| `relationship_proposals` | 21 | **0** | 6 | 2026-05-25 |

**`knowledge_entries` by class — the OEM corpus is FROZEN; all recent growth is uploads:**

| is_private | source_type | total | last 7d | last 30d | newest |
|---|---|--:|--:|--:|---|
| **t** | **node_attachment** (per-tenant upload) | 60 | **60** | **60** | 2026-06-16 |
| f | field_guide | 7 | 0 | 7 | 2026-06-02 |
| f | oem_manual | 4 | 0 | 4 | 2026-06-02 |
| f | gdrive (OEM seed) | **33,410** | 0 | **0** | 2026-04-06 |
| f | manual (OEM seed) | **32,421** | 0 | **0** | 2026-05-08 |
| f | equipment_manual | 11,996 | 0 | 0 | 2026-05-08 |
| f | youtube_transcript | 2,521 | 0 | 0 | 2026-04-24 |
| f | equipment_photo | 1,411 | 0 | 0 | 2026-03-30 |
| f | (12 more OEM source_types) | ~2,800 | 0 | 0 | Mar–May 2026 |

**Verdict (data-backed, no longer hypothesis):**
1. **The OEM KB corpus (~83.5k chunks, `is_private=false`) is STATIC** — *every* OEM source_type has
   **0 rows in the last 30 days**, newest dates Mar–early-May 2026. The autonomous crawler fleet
   (gdrive/youtube/manual/oem) produced **nothing in 30+ days** in prod. **Crawlers are not running
   in prod — confirmed.**
2. **All recent KB growth is per-tenant uploads** — the only 7d/30d rows are `node_attachment`
   (folder=brain), **60 chunks**, plus a tiny 11 from a 2026-06-02 manual seed. ~60 chunks/month,
   bursty, upload-driven. The KB is effectively a **static seed + a trickle of uploads**.
3. **`kg_entities` grew 902 in 30d but the KB it's extracted from barely grew (~71 chunks)** — that
   mismatch points squarely at **test/audit-node pollution** (#1982 "Namespace polluted with
   audit/test nodes", #1989 "212 inert `audit_<rand>` rows"; newest entity 2026-06-17 00:38 fits
   automated audit runs). The KG node count is inflating from **noise, not knowledge**. *(Confirm
   with `SELECT count(*) FROM kg_entities WHERE entity_id LIKE 'audit_%' OR name LIKE '%test%'`.)*
4. **The AI proposal flywheel is DEAD** — `ai_suggestions`: 6 total, **0 in 3+ weeks**;
   `relationship_proposals`: 21 ever, **0 in 7d**. The mechanism that's *supposed* to autonomously
   propose KG relationships from ingested content is not producing anything.
5. **Verified edges stalled** — `kg_relationships` grew 274 in a 30d batch (269 are `has_manual`
   document-attachment edges, not diagnostic relationships) then flatlined: **1 in the last 7 days.**

### 2d. Eyeball — the corpus IS present and citable (staging)

Ran one retrieval against the staging OEM corpus (`SHARED_TENANT_ID`, read-only):
`"PowerFlex 525 fault F0004 overcurrent"` → real Rockwell `520-um001` manual chunk via BM25, with
manufacturer/model/source-PDF metadata intact. So the corpus exists and is retrievable —
**any low citation score below is a real retrieval/answer gap, not an empty-corpus artifact.**
(Noise note: `"GS10 undervoltage"` surfaced a PowerMonitor doc *first* — BM25 cross-product noise.)

---

## Part 3 — Answer + citation quality benchmark

**Harness:** `tests/eval/offline_run.py --suite text` (in-process pipeline over the 59 text
fixtures), judge OFF, against the **staging** OEM corpus (`MIRA_TENANT_ID = SHARED_TENANT_ID`).
This exercises the **bot/chat path** over the OEM corpus — it does **NOT** test upload→retrieval
(that's the beta gate, `tests/beta/…`, still `xfail`).

**Measured from the live run (27 fixtures scored — representative sample; run stopped early because
the per-fixture staging session-write timeout made the tail low-value-per-minute and the numbers
were stable):**

| Metric | Value | Read |
|---|---|---|
| Citation present | **12 / 27 (~44%)** | <half of answers carried a source citation |
| Manual evidence retrieved | 15 / 27 (~56%) | retrieval surfaced manual chunks about half the time |
| **KG evidence utilized** | **0 / 27 (0%)** | the knowledge *graph* fed **zero** evidence into any answer — all grounding came from KB chunks (and now we know *why*: §2c — the KG is polluted + the proposal flywheel is dead) |
| KB-gap admissions | 15 | system honestly admits "not in KB" rather than hallucinating (safety-positive, coverage-negative) |
| Low-groundedness turn warnings | 56 | many turns flagged `<5 significant word overlap` with sources |

**Qualitative pattern (matches eval-failure cluster #1948):**
- Realistic tech phrasing breaks retrieval. `"PF525 showing F004, what's wrong?"` → `manual_evidence:
  []`, KB-gap, **no citation** — even though the corpus *has* the PF525 manual (the eyeball proved
  it). Cause: BM25 `plainto_tsquery` ANDs terms, and `PF525`≠`PowerFlex 525`, `F004`≠`F0004`
  (fault-code normalization). This is the #1807/#1808 BM25 AND-ing issue.
- When it *does* cite, it can **cross-cite the wrong model**: `"pf525 oc flt…"` cited PowerFlex 525
  **and** PowerFlex 700, with an off-topic chunk (RS485 addr / skip-frequency, not the OC fault).
  This is the #1948 "wrong-vendor / VFD doc-routing-miss" cluster.

**Caveats:** partial run (26/59); the `citations_present:true` count includes imprecise/cross-model
citations; staging corpus may differ slightly from prod; the run was slowed by staging
`troubleshooting_sessions` write timeouts (`TS_OPEN_FAIL` ×12, a latency artifact, non-fatal to
scoring).

---

## Bottom line (the chain)

- **Architecture:** sound; two stores, one UNS space, two retrieval models over the KB.
- **Growth — NO, it is not growing as it should (data-backed):** the OEM KB corpus is **frozen since
  early May** (every crawl source_type 0/30d); recent KB growth is **~60 upload chunks/month**; the
  AI proposal flywheel is **dead** (0 suggestions in 3+ weeks); verified edges **stalled** (1/7d);
  and `kg_entities` "growth" (902/30d) is almost certainly **test/audit pollution**, not knowledge.
  The *design* supports autonomous growth; the *running system* isn't doing it.
- **Quality:** the corpus is present and citable, yet **~44% citation rate** and **0% KG-evidence
  utilization** on the bot path, with retrieval breaking on realistic phrasing and occasional
  wrong-model cross-citation. The honesty layer works (15 KB-gap admissions, no hallucination
  storm), but **coverage + retrieval precision are the bottleneck**, not the corpus size. The 0% KG
  utilization is explained by §2c: the graph is polluted and the proposal engine is dead, so it has
  nothing trustworthy to contribute.

**Highest-leverage fixes, in order:**
1. **Retrieval robustness to real phrasing** — model-alias + fault-code normalization before BM25
   (`PF525`→`PowerFlex 525`, `F004`→`F0004`); the AND→OR fallback already exists in the Hub path,
   port/verify it on the bot path. (Closes most of the 42%→higher gap.)
2. **Close the upload→retrieval gap** (PR #1592 / beta gate) so *uploaded* manuals are citable on
   the bot path, not just the Hub node path.
3. **Make the KG earn its keep** — 0% KG-evidence means `kg_relationships` is currently inert for
   answering; either wire verified edges into the evidence packet or acknowledge the KG is a
   curation/UI artifact, not a retrieval input, today.

## Reproduce
- Growth: `gh workflow run db-inspect.yml --ref chore/db-inspect-growth-recency -f target=prod` →
  read "growth recency" + "growth by class" blocks in the run log.
- Quality: `PYTHONPATH=mira-bots doppler run -p factorylm -c stg -- env MIRA_TENANT_ID=78917b56-f85f-43bb-9a08-1bb98a6cd6c3 EVAL_DISABLE_JUDGE=1 /Users/charlienode/MIRA/.venv/bin/python tests/eval/offline_run.py --suite text`
- Corpus eyeball: same env, call `shared.neon_recall.recall_knowledge(embedding=None, tenant_id=SHARED_TENANT_ID, query_text=...)`.
