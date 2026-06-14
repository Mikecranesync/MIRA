# Runbook — Verify & Benchmark the in-Hub streaming ingest-v2 PDF path

**Last verified:** 2026-06-13 against the **dev** Neon branch (`factorylm/dev`, endpoint `ep-lingering-salad`).
**Code under test:** `mira-hub/src/lib/node-knowledge-ingest.ts` (`writePdfChunksForNode` / `ingestPdfToNode`).
**Memory-bounding change:** PR #1935 (Slice 1) — plan: `docs/plans/2026-06-13-streaming-ingest-v2-slice1.md`.
**Reusable benchmark:** `mira-hub/scripts/bench-ingest-v2.ts`.

---

## 1. What this path is

When a PDF is uploaded to a UNS namespace node (the node-attach door,
`POST /api/namespace/node/[id]/files`) — or routed to the per-tenant Inbox node
from a blind upload (`mira-hub/src/lib/local-upload.ts`) — it flows through the
**single v2 chunk writer**:

```
route → ingestPdfToNode()            (creates the hub_uploads row)
        └─ writePdfChunksForNode()    (unpdf extract → chunk → INSERT knowledge_entries)
              ↳ rows: ingest_route='v2', is_private=true, metadata.node_id=<node>
```

Those rows become BM25-citable via `retrieveNodeChunks()` (`mira-hub/src/lib/manual-rag.ts`),
which is what the chat surface calls to ground answers. This path does **not** use
the legacy Open-WebUI → docling service; on any error it falls back to that legacy
path (the `try/catch` in `local-upload.ts`), so a v2 defect degrades **quietly**.

### Slice-1 memory behaviour (PR #1935)
- Chunks are written in **bounded multi-row batches** (`BATCH_ROWS=50`), not one
  array of every chunk + one INSERT per chunk; each page's text is released after
  chunking.
- `NODE_INGEST_CONCURRENCY` (default **1**) serializes parses so concurrent large
  uploads don't multiply the in-memory PDF peak. **50 MB upload cap is a policy
  bound, not architectural** — the file + extracted text are still loaded whole;
  true any-size needs per-page streaming extraction (Slice 2). See the plan doc.

---

## 2. How to run the benchmark (dev only)

> Writes to `knowledge_entries` / `hub_uploads`. The script only ever touches
> `BENCH_`-prefixed rows and self-cleans, and refuses to run unless the DB host is
> the known dev endpoint. **Never point it at prod.**

```bash
cd ~/mira-ingestv2/mira-hub        # or the worktree of the branch under test
bun install                        # ensure unpdf/pg resolve (a symlinked node_modules can be stale)
cd ..
doppler run -p factorylm -c dev -- bun mira-hub/scripts/bench-ingest-v2.ts
```

It (1) ingests a set of real PDFs through the **real** `ingestPdfToNode` (the
RLS-enforced `factorylm_app` INSERT path), (2) verifies each via the owner pool,
(3) proves citation with the **real** `retrieveNodeChunks`, (4) deletes every
`BENCH_` row it created and asserts zero remain.

**Filter the noise:** wrap with `| grep -vE "SECURITY WARNING|sslmode|standardFontDataUrl|^\s+at "`.
Two benign warnings are expected: the pg `sslmode` deprecation notice, and pdfjs
`standardFontDataUrl` font warnings on some PDFs (extraction still succeeds).

### Dev fixtures used (override via env)
- Tenant `78917b56-…` ("FactoryLM BRAVO — Lake Wales FL"), node `f42ec123-…`
  (`enterprise.knowledge_base.accolift.2730070.manuals`).
- Find replacements: `select id, tenant_id, uns_path from kg_entities limit 5;`
- Override with `BENCH_TENANT` / `BENCH_NODE` / `BENCH_UNS` / `BENCH_ROOT`.

---

## 3. What "verified" means (per upload)

The owner-pool check (BYPASSRLS) asserts all of:
| Check | Why it matters |
|---|---|
| `rows_in_db == returned chunkCount` | every chunk it claimed actually persisted (no silent drop) |
| `bool_and(ingest_route='v2')` | used the new path, did **not** fall back to OW |
| `bool_and(is_private=true)` | #1903 tenant-privacy invariant holds in a real DB |
| `count(distinct chunk_index) == chunkCount` | batched multi-row INSERT has no intra-statement `ON CONFLICT` self-collision |
| `max(page_end)` == real page count | per-page tracking correct across the whole document |

> Cleanup MUST use the **owner** connection: `withTenantContext` runs as
> `factorylm_app` (RLS, no BYPASSRLS) which has INSERT/SELECT but **not** the
> DELETE needed here — an in-context DELETE rolls back the whole transaction
> (this is why a first cleanup attempt left 73 rows behind on 2026-06-13).

---

## 4. Recorded results — 2026-06-13 (dev)

Ingest + verify (6/6 PASS, then fully cleaned up, 0 rows left):

| File | KB | Pages | Chunks | Rows in DB | ms | chunks/s | KB/s | verified |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| MIRA_DOCS_MAP_2026-06-07.pdf | 11 | 3 | 9 | 9 | 1246 | 7.2 | 9 | PASS |
| Conv_Simple_Prog3_Modbus_Polling.pdf | 598 | 15 | 43 | 43 | 681 | 63.1 | 879 | PASS |
| Conv_Simple_LadderFirst.pdf | 627 | 24 | 53 | 53 | 843 | 62.9 | 744 | PASS |
| Conv_Simple_UDFB_Intro.pdf | 750 | 21 | 52 | 52 | 664 | 78.3 | 1129 | PASS |
| Conv_Simple_Complete.pdf | 967 | 27 | 73 | 73 | 907 | 80.5 | 1066 | PASS |
| 2026-06-01-dt-alignment-analysis.pdf | 664 | 9 | 47 | 47 | 610 | 77.0 | 1089 | PASS |

Notes:
- **Steady-state ≈ 60–80 chunks/s, ≈ 750–1130 KB/s.** The 11 KB row's low rate
  (1246 ms / 9 KB·s⁻¹) is the **cold-start outlier** — the first call pays
  module load + unpdf init + first DB connect. Discount it for throughput.
- The 73-chunk file crosses the `BATCH_ROWS=50` boundary (two flushes) and still
  lands all 73 — the batched path is exercised, not just single-batch cases.
- A prior ad-hoc run produced identical chunk counts (e.g. Conv_Simple_Complete =
  73 both times); timings within ~15% — **reliable and repeatable**.

Citation (real `retrieveNodeChunks`, BM25 across the ingested set):

| Query | Top hit (file · page · rank) | Correct source? |
|---|---|---|
| "RS-485 wiring and Modbus polling" | Conv_Simple_Complete · p1 · 0.0333 | ✅ overview/RS-485 page |
| "how do I build a UDFB" | Conv_Simple_UDFB_Intro · p7 · 0.0788 | ✅ the UDFB doc, not the others |
| "what does the motor starter rung do" | Conv_Simple_Complete · p15 · 0.0922 | ✅ motor_starter UDFB rung page |

Cross-document ranking picks the right file per query → uploaded manuals are
findable **and** correctly attributed (filename + page) for grounding.

---

## 5. What is proven vs. still open

**Proven (real dev DB, real functions):** PDF → chunk → store works end-to-end;
all chunks persist; rows are private + tagged v2; batched multi-row INSERT is
correct across the batch boundary; the content is retrievable with correct page
citations via the real BM25 path. This closes the "the new SQL has never run
against Postgres" gap from PR #1935's review.

**Proven by §7 (now covered):**
1. ~~HTTP + auth layer.~~ **Covered** — §7 drives the real credentials login + the
   real upload *screen* (not the API), on the standalone build.
2. ~~LLM-generated cited answer.~~ **Covered** — §7 asserts a live-cascade answer
   with a citation chip + `[n]` marker, 5/5 runs.

**Still open:**
3. **Latency under concurrency.** The route `await`s the parse synchronously
   (`route.ts:178`), so with `NODE_INGEST_CONCURRENCY=1` concurrent large uploads
   queue and could hit a gateway timeout. Tradeoff documented on PR #1935. (§7
   ran serially — it does not stress concurrent uploads.)
4. **pdfjs font warnings** (`standardFontDataUrl`) are benign here but mean glyph
   coverage isn't guaranteed for unusual fonts; not investigated.
5. **Large-file E2E.** §7 uses the 2 KB beta-gate fixture (1 chunk). The
   multi-batch path is proven at the DB level (§4, 73 chunks) but not yet through
   the full UI on a 1000-page manual.

---

## 7. Full E2E — login + upload screen + AI cited answer (5 monitored runs)

**Spec:** `mira-hub/tests/e2e/ingest-v2-e2e-5run.spec.ts`. This is the
"stranger logs in, uploads their own manual through the UI, asks a question,
gets a cited answer" path — end to end, no mocks, on the **standalone build**.

### Why standalone (not `next dev`)
The worst historical bug on this path (#1899) was an unpdf-in-the-standalone-bundle
500 that `next dev` cannot reproduce (dev resolves unpdf from `node_modules`). So
the recorded runs use the real standalone server. **Next 16 note:** `next start`
prints `"next start" does not work with "output: standalone"` — use the standalone
server directly, and copy the static assets it doesn't auto-include:

```bash
cd ~/mira-ingestv2/mira-hub
bun install                                   # real install so unpdf resolves
doppler run -p factorylm -c dev -- npx next build
cp -r .next/static .next/standalone/.next/static    # standalone omits these
PORT=3017 HOSTNAME=127.0.0.1 doppler run -p factorylm -c dev -- \
  node .next/standalone/server.js             # terminal A — stays running
```

**basePath gotcha:** building without `NEXT_PUBLIC_BASE_PATH` defaults `basePath`
to `/hub` (next.config.ts), so the app serves under `/hub` — point the spec there.
(Build with `NEXT_PUBLIC_BASE_PATH=""` to serve at root.)

```bash
# terminal B
HUB_URL=http://localhost:3017/hub E2E_RUNS=5 doppler run -p factorylm -c dev -- \
  npx playwright test tests/e2e/ingest-v2-e2e-5run.spec.ts --workers=1 --reporter=line
```

### What each run does (and how it's scored)
Fresh registered tenant → seed 2 nodes → real credentials sign-in → **drive the
upload screen** (`[data-testid="namespace-file-input"]`.setInputFiles, the control
the page wires to `POST /node/:id/files`) → poll the DB for v2 chunks → **Ask MIRA
in the UI**.

**The deterministic PASS signal is a `[n]` citation marker in the STREAMED ASSISTANT
PROSE** — not the on-page filename. Why: the uploaded filename also appears in the
node's attached-file list, and the citation **chip** can render *before* the answer
streams in (first-pass run 5 captured an empty answer yet had the chip — proof the
chip alone is too weak). The `[n]` marker exists only once the AI has actually
written a cited answer, so gating on it both isolates the citation and removes the
race. A run PASSES only on `cited (prose [n]) && chip ("[n] <file> p.N" resolves to
the uploaded manual) && non-empty prose`; the chip regex's `[n]`+`p.N` shape also
distinguishes it from a plain file-list row. Verdicts separate infra flake from path
failure: chat ≠ 200 or no prose streamed = **PROVIDER_FLAKE** (Gemini is blocked, so
the cascade is really Groq→Cerebras); prose written but no `[n]` = **PATH_FAIL**
(grounding gap). Per-run cleanup in `finally` + an `afterAll` sweep by `mark`/email
prefix.

### Recorded results — 2026-06-13 (dev, standalone build, fixture `zephyr-zx9000-service-manual.pdf`, question "fault ZX-451")

**5 PASS / 0 PROVIDER_FLAKE / 0 PATH_FAIL** (40.9 s total). Every run: prose `[n]`
citation marker present (`cited`) AND the `[n] <file> p.N` chip resolved to the
uploaded manual (`chip`):

| Run | Verdict | Upload chunks | Upload ms | cited (prose [n]) | chip | Answer ms | chat HTTP |
|--:|:--|--:|--:|:--:|:--:|--:|--:|
| 1 | PASS | 1 | 2487 | ✅ | ✅ | 870 | 200 |
| 2 | PASS | 1 | 2386 | ✅ | ✅ | 870 | 200 |
| 3 | PASS | 1 | 2436 | ✅ | ✅ | 875 | 200 |
| 4 | PASS | 1 | 2458 | ✅ | ✅ | 1876 | 200 |
| 5 | PASS | 1 | 2410 | ✅ | ✅ | 1877 | 200 |

The live cascade (Groq) produced a grounded, cited answer every run — full prose
captured all 5 (the hardened gate waits for the marker, so there's no capture race):

> "The cause of Fault ZX-451 is the PT-7 pressure transducer drifting outside the
> 4-20 mA calibration band, usually after a cold-start or following a manifold
> reseal **[1]**. To fix it: 1. Recalibrate the PT-7 transducer to 4.2 mA…"

The `[1]` marker in the prose + the `[1] zephyr-zx9000-service-manual.pdf p.1` chip
prove the answer is grounded in the *uploaded* manual, not generic knowledge. All
test tenants/nodes/chunks cleaned up (verified 0 left).

> History note: a first pass scored 5/5 on chip-presence alone, but run 5's prose
> had not streamed in at capture time — the chip rendered first. That exposed that
> chip-alone is too weak a signal, so the gate was moved to the in-prose `[n]`
> marker (above). The corrected gate is what the table reports.

> Artifacts (`tests/e2e/.artifacts/` — screenshots + results JSON) are gitignored;
> the table above is the durable record.

---

## 6. Cross-references
- `mira-hub/scripts/bench-ingest-v2.ts` — §1–4 DB-level benchmark executable
- `mira-hub/tests/e2e/ingest-v2-e2e-5run.spec.ts` — §7 full-E2E (login + upload screen + cited answer)
- `mira-hub/tests/e2e/folder-upload-citation-proof.spec.ts` — the #1899 single-run template §7 extends
- `docs/plans/2026-06-13-streaming-ingest-v2-slice1.md` — Slice 1 plan + honest memory accounting
- PR #1935 — the memory-bounding change (supersedes #1933)
- `mira-hub/src/lib/node-knowledge-ingest.ts` / `manual-rag.ts` — code under test
- `.claude/rules/knowledge-entries-tenant-scoping.md` — the `is_private` invariant (#1903)
