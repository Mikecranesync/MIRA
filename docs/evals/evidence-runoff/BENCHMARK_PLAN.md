# Evidence benchmark: frozen plan (2026-10-20)

This plan is committed before any page is labelled or any extractor output is examined. Anything the
results change after this commit is reported as a deviation, not slipped in.

There are two questions, both asked before either capability is enabled in production:

- **B1:** does the shadow claim checker catch wrong answers on pages it has never seen?
- **B2:** does a table parser keep a value in the right row and column?

## What is frozen

| Item | Value |
|---|---|
| Checker code | `mira-hub/src/capabilities/claim-verifier.ts` and `claim-verifier-shadow.ts` at #4550 head `f8e43506506de101485b47ad5babc077bddb5adf`, invoked through `shadowVerifyTurn` (the function the chat route calls), `joinWrappedLines: true` |
| MIRA-today text | `unpdf` `extractText(mergePages:false)` then `chunkText(1000, 120)`, exactly the calls in `writePdfChunksForNode` |
| Docling | 2.140.0 (`requirements-docling.lock.txt`), three variants: TableFormer v1 (default), TableFormerV2, table structure off |
| Flat text | `pdftotext` plain and `pdftotext -layout` (poppler, as installed) |

## Page selection (fixed rule, no hand-picking)

1. Manuals: the 10 public-50 manuals plus `oem-manual-micro810` and the five Schneider guides
   (m171, m172, x80-analog, lxm32a-canopen, premium-async-serial), 16 in all.
2. Candidate pages: those whose plain `pdftotext` contains a caption matching `\bTable\s+\d` (a manual's
   own table label, which no compared extractor creates).
3. Excluded: every page cited anywhere in the runoff corpus (124 manual/page pairs) and the eight
   `docling_report.json` pages.
4. Order the candidates by `sha256("<manual sha256>:<page>")` and walk them in that order. Skip a page
   whose rendered image shows no table with at least two data rows and two value columns. Take the
   **first two** that qualify per manual.

## Gold (read from the rendered page image, never from any extractor's text)

- Render the page at 110 dpi with `pdftoppm`. Use the first qualifying table on the page.
- Record the header cells in order. Record **three rows**: the first data row, the middle one
  (`ceil(n/2)`) and the last, each with all of its non-empty cells in order.
- Target cell for row `i` (0, 1 or 2): value column `1 + (i mod (ncols - 1))`, column 0 being the row label.
- The gold file is written and committed before any extractor output is opened.

## B2 table metric

A target cell **counts as recovered** only when both of these hold:

- **Row integrity:** one line of the output (one markdown row for Docling) contains the row label and
  every recorded cell of that row, left to right.
- **Header integrity:** the headers appear in order within the six lines before that row.

Normalisation, applied to both sides:

- lowercase;
- replace `|` with a space and collapse runs of whitespace;
- `…`, `...` and `-` ranges are equivalent;
- typographic dashes and quotes are folded.

Report per extractor:

- cells recovered / cells, with a Wilson 95% interval;
- seconds per page;
- peak RSS.

**Bar:** a parser is "accurate on technical tables" when its point estimate is at least **90%** and the
lower bound of its interval is at least **80%**. It must also beat MIRA-today by a non-overlapping interval
before it is worth the cost.

## B1 checker set (built from the gold, labels true by construction)

For each gold target cell whose value is not repeated elsewhere in its table:

| Variant | Answer | Cites | Truth |
|---|---|---|---|
| `correct` | `The <header> for <row label> is <value> [1].` | its page | correct |
| `wrong_cell` | same sentence, but the value of a different cell in the same table (different row, different column) | its page | wrong |
| `wrong_page` | the correct sentence | the manual's other selected page | wrong |

- The question is `What is the <header> for <row label>?`.
- Evidence is the MIRA-today chunks of the cited page.

Report the checker's coverage (the share of items where it gave a verdict) and its catch and false-flag
rates, each with a Wilson 95% interval, overall and restricted to items where it gave a verdict.

**Bar for "detects incorrect answers":**

- among the items where the checker gives a verdict, the catch rate on `wrong_*` items is at least 80%
  (point estimate);
- the upper bound of the false-flag interval on `correct` items is at most 10%;
- coverage is stated alongside, and a low coverage is a finding rather than a failure.

**Known limit stated in advance:** these answers are templated, not model-written, so B1 tests whether
the checker binds values to subjects. It does not test whether it parses free-form prose. That needs shadow
traffic on staging, which is what the shadow flag is for.

## Not in scope

- No paid inference: zero tokens, no staging writes.
- No threshold or checker change after the gold is committed. Any fix found here goes into a follow-up
  and gets a new fresh set.
