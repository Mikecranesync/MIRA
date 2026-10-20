# Evidence benchmark results (2026-10-20)

This benchmark asks two questions before either capability is switched on in production:

- Can MIRA catch a wrong answer on pages it has never seen?
- Can it read a technical table without putting a value in the wrong row or column?

Everything is zero-token and frozen. The pieces:

- **Plan:** `BENCHMARK_PLAN.md`, committed before labelling, with amendments 1–4.
- **Gold:** `tools/evidence-runoff/data/bench_gold.jsonl` holds 32 table pages from 16 real manuals and
  93 hand-read rows, read from page images and committed before any extractor ran.
- **Results:** `tools/evidence-runoff/results/bench_tables.json` and `bench_checker.json`.
- **Checker under test:** #4550 head `f8e43506`, through `shadowVerifyTurn`, the exact function the chat
  route calls. Codex review round 3 is GREEN on that head.

## B2: technical tables (84 scored cells)

| Extractor | Cells recovered (row + header intact) | 95% interval | Value next to its row label | s/page (median / max) | Peak RSS |
|---|---|---|---|---|---|
| **MIRA today** (unpdf → 1000-char chunks) | 28 (33%) | 24–44% | 79% | — | — |
| pdftotext plain | 3 (4%) | 1–10% | 16% | — | — |
| pdftotext -layout | 25 (30%) | 21–40% | 82% | — | — |
| Docling, table structure off | 62 (74%) | 64–82% | 88% | 0.34 / 3.75 | 3.3 GB |
| **Docling, TableFormer v1** | **77 (92%)** | **84–96%** | 99% | 1.46 / 4.51 | 4.3 GB |
| Docling, TableFormerV2 (Apache-2.0) | 40 (48%) | 37–58% | 82% | 1.05 / 5.92 | 4.1 GB |

- **TableFormer v1 is the only extractor that meets the bar**: point estimate at least 90%, lower bound
  at least 80%, and an interval that doesn't overlap MIRA-today's.
  - The pass is **provisional**: under the scorer as frozen before outputs were seen, it scored 78.6%.
    The three later fixes are listed in amendment 4. Each was a confirmed scorer artefact and applied to
    every method, but they were made after looking.
  - Confirming it needs a fresh page set.
- **MIRA today keeps a value next to its row label 79% of the time, but the whole row and its column
  headers only 33% of the time.** The row label and the number survive; which column the number
  belongs to does not. This is the "1800 vs 180 VA" failure class seen in the runoff.
- **TableFormerV2 is not a substitute.** It collapses columns: one Schneider row came out as a single
  description cell holding `15624 WORD -1 - 0…5 V…`.
- **Docling with table structure off** scores 74%, but only because it writes each table as one
  reading-order line. Rows stay intact; columns are not structural.
- **Cost on CHARLIE (M4).** Docling holds 3.3–4.3 GB of memory, and the first page includes model
  load. That memory profile is why Docling was removed from the VPS before (Tika replaced it), so a
  production parser would need its own sized host or an offline ingest job.

## B1: the shadow claim checker on unseen pages (148 templated items)

| | Result | 95% interval |
|---|---|---|
| Coverage (items where the checker gave a verdict) | 23/148 (16%) | 11–22% |
| Wrong answers caught, of all 95 | 11 (12%) | 7–20% |
| Wrong answers caught, of the 14 it judged | 11 (79%) | 52–92% |
| Correct answers wrongly flagged, of all 53 | 2 (4%) | 1–13% |
| Correct answers wrongly flagged, of the 9 it judged | 2 (22%) | 6–55% |

By kind of wrong answer:

| Wrong answer | Flagged |
|---|---|
| Wrong page cited | 9/53 |
| Value from a different cell of the same table | 2/42 |

**The bar is not met.** The pre-set bar was an 80% catch rate among judged items and a false-flag
interval upper bound of at most 10%; the results are 79% and 55%. Three causes, read from the
individual items (no checker change was made):

1. **Table questions rarely contain a strong subject.** That means a mnemonic, a code or an address.
   Without one the checker has nothing to bind a value to, so any value printed anywhere on the cited
   page passes. Examples:
   - "2.5 µs" given as Standard Outputs for *Controller current* was marked supported;
   - "3 A" given as the High Speed Output for *Turn-off time* was marked supported.

   This is exactly the "right table, wrong cell" failure, and today's checker cannot see it.
2. **Both false flags are one normalisation gap.** The answer says `0.8 mm2`, while the stored chunk
   has `0.8 mm` and a detached superscript `2`. So `0.8 mm²` reads as absent.
3. **Coverage is low by design.** Prose values (descriptions, states, names) produce no typed claim.

## What this means

- **Detecting wrong answers:** the shadow checker reliably catches wrong-page citations and wrong codes
  or addresses where the question names one. It does **not** yet catch wrong-cell table answers, which
  are the commonest real table error.
  - Keep it in **shadow** (#4550, off by default). Do not use it to block or relabel answers.
  - The fix it points to: verify values against the table row and column, not against page proximity.
    That needs a table-aware text layer first (B2).
- **Reading tables:** structural parsing works. On these pages TableFormer v1 is 92% against 33% for
  what MIRA stores today. The Apache-only alternatives are clearly worse: V2 scores 48%, and table-off
  74% without real columns.
  - The data supports licence option **A**: load the byte-identical v1 weights from the dual-licensed
    revision. That is if policy accepts the dual licence; see `DOCLING_LICENCE.md`.
- **Licence items still open before any production use:**
  - On Linux there is no ocrmac. The default OCR is torch RapidOCR or EasyOCR, whose weights are not
    documented model-by-model. Pin the SHA-documented ONNX RapidOCR models, or turn OCR off.
  - The Heron layout model follows `main`. Pin it to a commit.
  - Docling is not in production today: Tika is, so none of this is urgent.

## Limits

- The B1 answers are templated, not model-written: they test binding, not prose parsing. Real-answer
  evidence comes from staging shadow traces once the flag is set to `shadow`.
- 32 pages and 84 cells is a small sample. The intervals above say how small.
- A single labeller (Claude) read the gold. It needs an independent audit before anyone quotes it as a
  headline.
