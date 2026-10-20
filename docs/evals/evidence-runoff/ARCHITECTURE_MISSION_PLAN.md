# Evidence architecture mission: frozen plan (2026-10-20)

This plan is committed before any held-out page is chosen, labelled or extracted. Anything changed later is
an amendment with its reason, and any change made after outputs have been seen is reported with before
and after numbers.

**Scope.** Zero paid spend unless Mike approves a budget. No deploys, no enforcement, no licence-policy
decisions. Staging Neon may be read but never written. No Codex spend on these eval PRs.

## Frozen instruments

| Instrument | Pin |
|---|---|
| Table scorer | `tools/evidence-runoff/bench/score_tables.py`, sha256 `0e2a0cc9442535fb7323c6d1ad7d6f86aa6b20b050f7366ae82fe01906f4fe3e` (round-1 amendments 1–4, commit `38714f64`) |
| Shadow checker | main `c646755b` (#4550), through `shadowVerifyTurn` |
| MIRA-today text | `unpdf` + `chunkText(1000, 120)`, as `writePdfChunksForNode` |
| Retrieval | `retrieveNodeChunks` from main, called unmodified against a local throwaway Postgres; lexical only, the production setting |
| Docling | 2.140.0, OCR **off** (Linux has no ocrmac, and OCR licences are unresolved). Variants: v1, off. V2 was dropped after round 1 at 48% and is re-run only as a reference column |

## T1: independent answer-key check

- A blind Claude Sonnet subagent gets each page image, the table caption, the header list and the row
  label. It transcribes that row's cells.
- It never sees our cell values. `bench_gold.jsonl` is readable in the repo, and the agent is told not to
  open it. That instruction can't be enforced, so it is disclosed here.
- The check runs on the round-1 gold (32 pages) and on the held-out gold.
- **Report raw cell agreement before any adjudication.** Then adjudicate each disagreement by
  re-reading the image, and record which side was right.
- **Limitation:** both labellers are Claude, so this is a same-model-family check, not a
  provider-independent one.

## T2: held-out table set (B2-H)

**Page selection, by rule:**

1. Pages come from the same 16 manuals, plus two new ones:
   - `ch2` (GS10 installation chapter, sha `82fff0d7`);
   - `se-canopen-hw-setup`.
2. Excluded manuals:
   - `ch6`, another edition of the GS10 chapter already used;
   - PLC-5 `1785-rm001`, whose cipher text needs the decoder. That is a separate known finding.
3. Excluded pages: every page used in the runoff corpus, in the Docling report, or in round 1, and
   every page screened out in round 1.
4. For the 16 manuals, continue down each round-1 candidate list in its existing sha order. For the two
   new manuals, build the list with the round-1 rule plus Amendment 1.
5. Take the **next two qualifying pages per manual**, using the same screen rule. That gives up to
   36 pages.

**Gold:**

- Same conventions as round-1 Amendment 2.
- Labelled from page images and committed before any extractor runs on these pages.
- Checked under T1.

**Scoring:** the frozen scorer above, unchanged. Bars as in round 1:

- 90% point estimate and an 80% lower bound;
- an interval that does not overlap MIRA-today's.

If the scorer turns out to be wrong on held-out data, the frozen number is still the headline. Any fix is
reported beside it and does not replace it.

## T3: column test (decides A vs C for a deterministic checker)

**Question:** given a row label and a header, can the value be read deterministically from the
representation?

**Parsers:**

- **Markdown:** parse `|` tables into grids. Docling joins two-level headers with ` - `, so a header
  matches a column when its normalised text is a suffix of the column header.
- **`-layout` text:** a fair attempt.
  - The header line is the line holding the most headers in order.
  - Column x-ranges come from where each header starts.
  - In the row line (the line with the row label), the cell under a header is the run of 2+-space
    separated text whose start falls inside that header's range.
- **Plain, MIRA-today, and Docling-off blob cells:** these have no column structure, so the test is
  reported as not applicable. A parser that fails is not counted as tested.

**Pass:** the looked-up cell, normalised, equals the gold target value.

**What this measures:** whether a table-aware *checker* could use the output. It says nothing about
whether an *answer model* reading the text gets the value right; only a generation test shows that
(T5b).

**Development:** the parser may be debugged on round-1 pages only, reported as exploratory. It is frozen
by commit before the held-out run.

## T4: retrieval, separately

- **Questions:** real-36 Lane A and the public-50 questions with their accepted pages.
- **Corpora:** each manual's full text from:
  - MIRA-today (unpdf + chunkText);
  - Docling-off;
  - Docling-v1.

  Docling text is exported per page and chunked with the same `chunkText`.
- Each corpus is loaded into a local `knowledge_entries` table built from the staging schema, read
  read-only from staging.
- `retrieveNodeChunks(topK 6)` is scoped to the manual's doc id, as notebook chat does.
- **Metrics:** hit@1 and hit@6 against any accepted page, with Wilson intervals; the paired difference
  against MIRA-today; median retrieval milliseconds.

## T5: oracle

**(a) No-cost attribution on the 653 frozen answers.** Each wrong answer gets exactly one cause, tested
in this order:

1. **Retrieval:** no accepted page was cited.
2. **Extraction:** an accepted page was cited, but the gold value is missing from MIRA's stored text for
   that page.
3. **Generation:** an accepted page was cited and the value is present.

Limit: turns record cited pages, not everything that was retrieved.

**(b) Oracle regeneration** with the production model, given the gold page only, under three evidence
conditions: MIRA-today, Docling-off and Docling-v1. This is paid and is **not run without Mike's yes**.
The estimate for 120 questions × 3 conditions with gpt-5.4-mini is about $1, with a hard cap of $3.

## T6: architecture grid

**Extraction** {MIRA-today, Docling-off, Docling-v1} × **retrieval** {lexical} × **verification**:

- none;
- the current checker (V1b);
- a **table-aware checker (V3)**: look up the row and header in the cited page's markdown grid, then
  compare the cell.

V3 is developed on round-1 data only and evaluated once on held-out.

**Measures:**

- answer-evidence accuracy (B2/B2-H, T4);
- catch rate and false-flag rate (B1 on round 1, B1-H on held-out), each with an interval;
- ingest seconds per page and peak memory;
- checker milliseconds;
- dollars.

**Limit:** B1-H answers are templated, so V3 on templated items is an upper bound on what it would do
with real answers.

## Reporting

- Plain terms.
- Every number with its interval.
- Every deviation listed.
- The paid oracle run and the A/C choice are listed as Mike's decisions.

## Amendment 1 (before any held-out selection)

`ch2` and `ch6` are the **GS4** installation and troubleshooting chapters (real-36 manuals `gs4-ch2` and
`gs4-ch6`), not GS10. So `ch6` is not a duplicate, and it is **included** as a third new manual. The
exclusion in T2 was wrong.
