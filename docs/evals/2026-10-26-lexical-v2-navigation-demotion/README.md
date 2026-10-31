# Results: contents and index demotion under NOTEBOOK_LEXICAL_V2 (2026-10-26)

**Rule:** `../2026-10-26-lexical-v2-navigation-demotion-preregistration.md`, committed `1ec29ded6`
before the candidate ran.
**Candidates:**
- `21ef26bc6`, the original run (`scores.txt`);
- `e882d724b`, amendment 1 after Codex F1 (`scores-amendment1.txt`). **This is the PR's code.**
**Baseline:** `main` at `1ec29ded6`, whose runtime code is `main` `4e89f24aa`.
**Verdict: PASS on both runs** (F0, G1, G2 and G3 all hold).

## Amendment 1 results (the shipped code), flag on

| Set | Measure | Flag off | `main`, flag on | Amendment 1 | Gained / lost |
|---|---|---|---|---|---|
| 77 real questions | top 6 | 52 | 69 | 69 | 0 / 0 |
| 77 real questions | top 1 | 31 | 42 | **43** | 1 / 0 |
| Fault codes (174) | top 5 | 99 | 136 | 136 | 0 / 0 |
| Fault codes (174) | top 1 | 72 | 78 | **82** | 4 / 0 |
| Reworded (1,264) | top 5 | 696 | 982 | 984 | 2 / 0 |
| Reworded (1,264) | top 1 | 485 | 606 | **625** | 19 / 0 |
| Index topics, clean (116) | top 1 | 34 | 24 | **38** | 14 / 0 |
| Index topics, clean (116) | top 5 | 60 | 68 | 73 | 6 / 1 |

Amendment 1 keeps spec and value tables out of the index rule. The cost is smaller top-1 gains than the
original run on three sets; nothing is lost.

## Original run (`21ef26bc6`), flag on (candidate vs `main`)

| Set | Measure | Flag off (prod today) | `main`, flag on | Candidate, flag on | Gained / lost |
|---|---|---|---|---|---|
| 77 real questions | top 6 | 52 | 69 | 69 | 0 / 0 |
| 77 real questions | top 1 | 31 | 42 | **45** | 3 / 0 |
| Fault codes (174) | top 5 | 99 | 136 | 136 | 0 / 0 |
| Fault codes (174) | top 1 | 72 | 78 | **85** | 7 / 0 |
| Reworded (1,264) | top 5 | 696 | 982 | 984 | 2 / 0 |
| Reworded (1,264) | top 1 | 485 | 606 | **643** | 37 / 0 |
| Index topics, clean (116) | top 1 | 34 | 24 | **38** | 14 / 0 |
| Index topics, clean (116) | top 5 | 60 | 68 | 73 | 6 / 1 |

- **F0 holds.** With the flag off, the candidate's rows are identical to `main`'s on every set.
- **Keyword search on the same sets:**
  - fault codes: top 5 137, top 1 87;
  - reworded: top 5 910, top 1 531;
  - clean index topics: top 5 77, top 1 43.

## Known weakness (original run; narrowed by amendment 1)

The thresholds were fixed before the run. A scan of every chunk in the 19 manuals used here shows what the detector
flags:

- **Mostly:** front contents pages, back-of-book index pages, and chapter mini-contents in the Schneider
  manuals.
- **Also, a few value tables:**
  - ACS355 p.272, a `TIMED FUNC 1 SRC` option list;
  - Micro820 p.53, chunk 2;
  - a handful of single chunks elsewhere.

Those chunks are demoted, not dropped. No question in these sets lost a hit because of them.

**After amendment 1,** the heading-less index branch flags only:
- back-of-book index continuation chunks;
- the ACS355 units-abbreviation table (pp.264–265).

The dot-leader rule still flags chapter mini-contents.

## Not measured here

- **Refusals on unanswerable questions.** That is #4572's release blocker for production, and the
  pre-registered walk in `docs/evals/retrieval-eval/prod-refusal-eval-plan.md`. Every set here is
  answerable-only.
- **Answer text and citations.** This is retrieval only.

## Reproduce

- **Harness:** `retrieval_rank.ts` from `c095b54c1`, sha256 `12ced03b…5f07`.
- **Database:** a throwaway pgvector/pg16 with staging's `knowledge_entries` DDL
  (`docs/evals/benchmark-4791/harness/ke_schema_bakeoff.sql` on `eval/imib-auto-truth`).
- **Settings:** topK 6, hybrid and rerank off.
- **Question sets and manuals:** IMIB v0.2 on `eval/imib-auto-truth`.
- **Rows:** raw rows are in `raw/`, as gzipped JSONL named `<label>-<set>-<off|on>`.
- **Scoring:** run `python3 score.py --questions <benchmark-4791 dir> --cand cand2` (or `--cand cand`).
  It reads `raw/` directly.
