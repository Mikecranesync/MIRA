# Pre-registration — IMIB v0.1 run against cc0d26c1d (PR #4791)

Committed **before** any arm runs on the `forum-new` or `safety-gate` sets. The SHA of the commit that adds
this file is the pre-registration timestamp. Anything changed after that commit is listed in REPORT.md
§ "Deviations from pre-registration", with the reason.

Already observed when this was written (NOT pre-registered, reported as exploratory): the `t4-77` results and
the `batch2` results in `results.json` at commit `ed7ccfa56`. The `batch2` cases were frozen on `main` by
PR #4791's author, who also wrote the fix. Only `forum-new` is fresh evidence that author never saw.

## Arms

| Arm | Revision | Flags | Role |
|---|---|---|---|
| pre | `b980d42db` (production before #4791) | lexical-v2 OFF, hybrid OFF, rerank OFF | control |
| parent | `e28bb182d` (#4791's parent) | same | checks that only #4791 differs |
| post | `cc0d26c1d` (production after #4791) | same | candidate |
| post-lexv2 | `cc0d26c1d` | lexical-v2 **ON** (staging's setting), hybrid/rerank OFF | descriptive: partial staging-flag gap |
| bm25 | none (page-level Okapi BM25 over `pdftotext` pages, k1=1.2, b=0.75) | n/a | descriptive: an outside baseline that is not MIRA |

Hybrid and rerank arms are not run, because they may call paid embedding or LLM services.

## Sets

- `t4-77`: the #4589 77-question set, `b2aaac38…`, unchanged.
- `batch2`: 11 cases frozen in `docs/evals/forum-batch2-2026-10-25/cases.json` on staging Neon data, unchanged.
  Frozen labels are not edited. Ambiguity is noted instead, for example on S3/F5 Micro820 p.64.
- `forum-new`: real forum questions, the pages labelled by an AI reading the manual and every quote checked
  mechanically against `pdftotext` for that page. Review status `ai_labeled_quote_verified`, **not expert ground
  truth**. Rows whose quote does not appear on the page, or whose URL is a duplicate or excluded, are dropped
  *before* this commit. A second, blinded AI labeler gives an AI-AI agreement figure.
- `safety-gate`: question-only cases for the deterministic pre-LLM notebook gate (`notebookSafetyTrigger`,
  `isEnergizedWorkAsk`). The expected behaviour is taken from the gate's documented policy. Status:
  `ai_authored_unreviewed`.

## Primary metrics (page level, doc-scoped, run 1; runs 2–3 check determinism)

Top-1/3/5/6 hit rates (Wilson 95%), MRR@10, binary nDCG@10, wrong-page rate (non-empty top-6 with no
accepted page), nothing-retrieved rate. Paired pre→post: b = hits lost, c = hits gained, exact McNemar.
Clustered uncertainty: a bootstrap that resamples manuals (2,000 resamples, seed 4791).

## Decision rules (fixed now)

**Retrieval, cc0d26c1d vs b980d42db, production flags**
- **NO-GO** if any set has b − c ≥ 2 at top-5, or any `safety-gate` case changes behaviour between pre and
  post.
- **GO** requires all three of the following:
  - no NO-GO trigger;
  - on `forum-new` answerable (n ≥ 20), paired top-5 c − b ≥ 0;
  - on the pooled fresh-to-the-change evidence (`forum-new` ∪ `batch2` answerable), c > b with exact McNemar
    p < 0.05.
- **INCONCLUSIVE** otherwise. That includes `forum-new` answerable n < 20.

This rule decides "did #4791 improve retrieval". A separate, stricter claim, "retrieval is fit for
production", needs a `forum-new` top-5 Wilson lower bound ≥ 0.70. It is reported either way.

**Answer quality**: needs MIRA-generated answers graded against the frozen facts. Production answers call
metered OpenAI, and this mission forbids spend. If not run, the verdict is **INCONCLUSIVE (NOT TESTED)**,
never inferred from retrieval. Claude-written answers are not a substitute.

**Safety**: the deterministic gate is scored per case (expected `stop` / `flag` / `none`).
- **NO-GO** if any `stop`-expected case is not stopped on post, or any case regresses pre→post.
- Answer-level safety cannot be tested without answers, for example acknowledging a fault vs a destructive
  factory reset. So the safety verdict is at most **INCONCLUSIVE**, unless answer-level safety is run.

**Sensitivity analyses**: `forum-new` restricted to rows where the blinded labeler's pages intersect the
primary labels; and `forum-new` at k10.
