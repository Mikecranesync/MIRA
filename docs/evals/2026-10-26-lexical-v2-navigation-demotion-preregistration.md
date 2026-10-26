# Pre-registration: demote contents and index pages under NOTEBOOK_LEXICAL_V2 (2026-10-26)

Committed before any run of the candidate. Baseline runs on unmodified `main` may already exist; they
do not depend on the candidate.

## Why

IMIB v0.2 (branch `eval/imib-auto-truth`) re-run on `main` with `NOTEBOOK_LEXICAL_V2=1`:

- Fault-code set (174): 136 right pages in the top 5, against 99 with the flag off and 137 for keyword search.
- Reworded set (1,264): 982, against 696 off and 910 for keyword search.
- Index-topic set, footer-free subset (116): top-1 falls from 34 (off) to **24** (on).

The top-1 losses go to the manual's own Table of Contents and Index pages (Micro810: pages 5, 123, 124).
IDF-sum scoring counts each question word once per chunk with no length normalisation
(`docs/specs/notebook-retrieval-idf-scoring.md` §2). A contents or index chunk lists every section title
once, so it holds every topic word and outranks the page that explains the topic.

## Change under test

- **Detector:** a deterministic test for navigation chunks in `notebook-query.ts`:
  - dot-leader contents lines (`Title . . . . 23`);
  - back-of-book index lines (`term 66`, `term 11, 12`).
- **Penalty:** applied in `rerankChunks` only when the caller passes `demoteNavigation`. The chunk is
  demoted, never dropped, so it still wins when it is the only match.
- **Gate:** `retrieveNodeChunks` passes `demoteNavigation` only when `NOTEBOOK_LEXICAL_V2=1`. With the flag
  off the output is unchanged. Production runs with the flag off.

Prior art: #4481 demoted contents and front matter for every flag state and every intent. It measured as
a net loss on the 77 real questions (2026-10-20). This candidate differs in three ways:
- it runs only with the flag on;
- it does not use early-page or front-matter signals;
- it targets only dot-leader and index-entry shapes.

## Harness

- `retrieval_rank.ts` from `c095b54c1`, sha256 `12ced03b…5f07`.
- Throwaway local Postgres with staging's `knowledge_entries` DDL.
- topK 6. Hybrid and rerank off.
- Each set is run with the flag off and on, for `main` and for the candidate.

## Sets

1. `t4-77`: 77 real technician questions, 19 manuals.
2. `oem-fault`: 174 questions.
3. `robust`: 1,264 questions.
4. `oem-index-clean`: the 116 index-topic questions without leaked page-footer text (no `Publication` in
   the question).
   - This set is built from the manuals' own index pages, so demoting those pages favours it by
     construction.
   - It is the **target**, not a deciding gate.

## Pass rule (all must hold; candidate vs `main`, flag on)

- **F0, flag off unchanged:** every set's flag-off rows are identical to `main`'s flag-off rows.
- **G1, real questions:** on `t4-77`, both of these net counts are at least 0:
  - right page in top 6, gained minus lost;
  - top-1, gained minus lost.
- **G2, fault codes:** on `oem-fault`, top-5 net (gained minus lost) is at least 0.
- **G3, reworded:** on `robust`, top-5 net (gained minus lost) is at least 0.
- **T1, target (reported):** `oem-index-clean` top-1 rises above 24. Reaching 34 (flag-off level) is the goal.

**Stop rule:** one candidate, run once. If any of F0 or G1–G3 fails, report and stop; no parameter tuning on
these sets. The penalty weight and detector thresholds below are fixed now.

## Fixed parameters

- **Contents (dot leader):**
  - a match is a run of four or more dots, single or space-separated, followed by a 1–4 digit number;
  - a chunk with **3 or more** matches is navigation.
- **Index:**
  - an entry line is a non-empty line of at most 60 characters that ends in a page reference
    (`\s\d{1,4}(,\s*\d{1,4})*$`) and starts with a letter or digit;
  - a chunk is navigation when **at least 8** lines are entries **and** entries are **at least 50%** of its
    non-empty lines;
  - on top of that, the chunk must contain a line that is exactly `Index`, or have entry lines making up
    at least 70% of its non-empty lines.
- **Penalty:** `score -= 2.0` for a navigation chunk. An exact code hit adds 3.0, so a navigation chunk that
  names the asked code still outranks one that doesn't.

## Amendment 1 (2026-10-26, after Codex review F1 on #4832, before the re-run)

**Why.** Codex showed that an 8-row specification table qualifies under the heading-less branch, the one
with entries at 70% or more of non-empty lines. It is demoted out of the top 6 for a question it
answers. A chunk scan of the 19 manuals (no benchmark questions involved) confirmed the branch also flags
value tables such as ACS355 p.272.

**Index rule, replaced.** Everything else stays as fixed above, including the dot-leader rule and the
penalty of 2.0.
- An entry line is unchanged: at most 60 characters, starts with a letter or digit, and ends in page
  references.
- A chunk qualifies only if it has at least 8 entries and entries make up at least 50% of its non-empty
  lines. Then:
  - with a line that is exactly `Index`, it is navigation;
  - otherwise it is navigation only when **at least 20** entries carry a label (the line minus its
    trailing page references) that contains **no digit**.

**The scan under the new rule.** The heading-less branch now flags only:
- back-of-book index continuation chunks;
- the ACS355 units-abbreviation table (pp.264–265).

ACS355 p.272 and Micro820 p.53 are no longer flagged.

**Re-run.** Same pass rule (F0, G1–G3), same sets and harness, against the same `main` baseline rows.
One run. If it fails, report and stop.
