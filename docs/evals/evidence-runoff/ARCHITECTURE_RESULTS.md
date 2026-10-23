# Evidence architecture mission: results (2026-10-20)

**Plan and decision rules:** `ARCHITECTURE_MISSION_PLAN.md`. The rules were frozen before any held-out number was seen:
- Amendment 2, commit `398548c53`;
- Amendment 3, commit `a84b3f849`.

**Cost:** everything here is offline and cost zero dollars. No paid model call was made.

**Production:** nothing in this document changes production, and nothing here is enabled anywhere.

## The answer in one paragraph

Retrieval, not extraction, is what costs us right answers. Swapping MIRA's text extractor for Docling does not move retrieval at all:
- right page in the top six: 53/77 with Docling-off and 49/77 with Docling-v1, against 54/77 today;
- this holds although Docling reads tables far better (89% against 41% of table rows intact on held-out pages).

The two open retrieval drafts (#4481, #4483) make retrieval **worse**. Neither should merge as written.

The one clearly positive result is the **table-aware checker (V3)**:
- on held-out data it caught **43 of 47** wrong-cell answers;
- the current checker caught **none**;
- it wrongly flagged 2 of 58 correct answers.

But V3 needs Docling's table-structure model, which brings in the licence question, and it was tested only on templated answers, offline.

**Recommended next step:** keep MIRA-today extraction. Put the retrieval effort where the misses are (see "What to do next"). Treat V3 as a shadow-mode candidate that waits on the licence decision.

## 1. Answer keys (T1)

| Set | Raw agreement between two independent labellers | Gold errors found after adjudication |
|---|---|---|
| Round 1 | 314/318 cells (98.7%) | 0 |
| Held-out | 350/370 cells (94.6%) | 0 |

Every disagreement was settled by re-reading the page image, and in each case the gold value stood. The adjudication files are `tools/evidence-runoff/data/t1_*_adjudication.json`.

**Limit:** both labellers are Claude, so this is a same-model-family check.

## 2. Table extraction, held-out (B2-H, frozen scorer)

38 pages, 19 manuals, 93 scored rows. The scorer has sha256 `0e2a0cc9…`, is unmodified, and is run through `heldout_b2.py`. Docling here is per-page and OCR-off, the same method as round 1.

| Extractor | Rows recovered | 95% interval |
|---|---|---|
| Docling, table structure off (licence option C) | **83/93 (89.2%)** | 81.3–94.1 |
| Docling v1 tables (licence option A) | 78/93 (83.9%) | 75.1–90.0 |
| MIRA today (unpdf + chunking) | 38/93 (40.9%) | 31.4–51.0 |
| Docling v2 tables (reference) | 37/93 (39.8%) | 30.4–49.9 |
| pdftotext `-layout` | 30/93 (32.3%) | 23.6–42.3 |
| pdftotext plain | 0/93 | 0–4.0 |

**Bar (frozen):** a 90% point estimate, a lower bound of at least 80%, and an interval that doesn't overlap MIRA-today's.
- Neither Docling option meets it. Option C misses the point estimate by one row's worth.
- Round 1 ranked v1 above off (77/84 against 62/84). The held-out run reverses that.

## 3. Column test, held-out (T3-H): can a program read the right cell?

Given a row label and a column header, read the value straight out of the representation.

| Representation | Correct cells | 95% interval |
|---|---|---|
| Docling v1 markdown | 71/91 (78.0%) | 68.5–85.3 |
| `-layout` text | 55/91 (60.4%) | 50.2–69.9 |
| Docling v2 markdown | 28/91 (30.8%) | 22.2–40.9 |
| Docling off / MIRA today | not applicable (no column structure) | |

**Rule (amendment 2):** v1 needs at least 80% with a lower bound of at least 65%. It scored 78.0%, so **the A-versus-C question is inconclusive for a table checker.**

## 4. Retrieval (T4): right page in the top six

The 77 real questions are real-36 Lane A plus public-50. Retrieval is `retrieveNodeChunks` from main, unmodified, lexical as in production, topK 6, scoped to the document.

| Corpus | Top 6 | Top 1 | p50 latency | Paired against MIRA today |
|---|---|---|---|---|
| MIRA today | 54/77 | 31/77 | 21–24 ms | n/a |
| Docling off (whole manual) | 53/77 | 30/77 | 41 ms | top 6: lost gs10-ch6-q5 and micro820-in-q2, gained smc50-q3. No detectable difference |
| Docling v1 (whole manual) | 49/77 | 28/77 | 46 ms | top 6: gained gs10-ch6-q3, smc50-q3, tq-12, tq-23; lost gs10-ch6-q5, pf4m-q3, micro820-in-q2, smcflex-q2, tq-02, tq-04, tq-06, tq-07, tq-34 (p=0.27). No detectable difference; the point estimate is worse |

**Rule:** exact McNemar, p < 0.05 and a net gain to call it better. Neither Docling variant is better. v1 is 5 questions worse on the point estimate and twice as slow.

### The two open retrieval drafts (amendment 3), applied onto main

| Arm | Top 6 | Gained | Lost | Top 1 | McNemar p |
|---|---|---|---|---|---|
| main (re-run, reproduces 54/31) | 54/77 | | | 31/77 | |
| + #4481 demote TOC/front matter | 51/77 | tq-12, tq-37 | micro820-in-q1, micro820-in-q2, tq-02, tq-07, tq-34 | 31/77 | 0.45 |
| + #4483 identifier boost | 50/77 | tq-23 | micro820-in-q2, tq-30, tq-34, tq-35, tq-42 | 32/77 | 0.22 |
| + both | 47/77 | tq-12, tq-23 | 9 lost | 30/77 | 0.065 |

**Verdict under the frozen rule: reject, as written.** The evidence is posted on both PRs.

## 5. Where wrong answers come from (T5a, 653 frozen answers, no cost)

| First failing stage | Hard failures |
|---|---|
| Retrieval (no accepted page cited; T4 confirms the page was missed) | **81 of 118** |
| Generation (accepted page cited, value present in our text) | about 27 |
| Extraction (accepted page cited, value absent from our text) | 1 |

**Not run: T5b**, the oracle that hands the model the right page under each extractor. It costs about $0.85 (cap $3) and is your decision. It is the only test that would show whether Docling's cleaner tables help the *answer model* when it has the right page.

## 6. Checkers (B1-H, held-out, templated answers)

| Checker | Wrong cell caught | Wrong page caught | Correct answers wrongly flagged |
|---|---|---|---|
| Current (V1b, on main, off) | **0/47** (0–7.6%) | 8/58 | 1/58 (1.7%) |
| Table-aware V3 (frozen `1eb90ca0`, run once) | **43/47 (91.5%)** (80.1–96.6) | 6/58 | **2/58 (3.4%)** (1.0–11.7) |
| V1b + V3 combined | 43/47 | 12/58 | 3/58 (5.2%) |

- **The V3 runner** reproduced the development numbers exactly before it touched held-out data (34/42 caught, 1/53 false flags).
- **Paired against the current checker on the 47 wrong-cell items:** V3 caught 43 that the current checker missed, and the reverse happened 0 times (p < 1e-12).
- **Bar** (amendment 2, rule 4: catch ≥70% with lower bound ≥50%; false flags ≤5% with upper bound ≤12%):
  - V3 alone **passes**.
  - The combination fails on false flags (5.2%).
- **The two false flags** are answers that quote only part of a long cell, so V3 can't tie the value to the cell that was asked.
- **The four misses** are wrong answers whose value never appears as a whole cell.
- **Limits:**
  - The answers are templated, so this is an upper bound.
  - Offline detection is not live protection.
  - V3 needs Docling **v1** table markdown, which is licence option A.

Checker cost: p50 0.75 ms, max 7.5 ms per answer.

## 7. Resource cost of extraction (this machine, Apple M4)

| Extractor | Seconds per page | Peak memory |
|---|---|---|
| MIRA today (unpdf), 19 manuals / 3,301 pages | 0.0018 | 381 MB |
| Docling off, whole manuals | 0.468 (about 260×) | 2.7 GB |
| Docling v1, whole manuals | 0.729 (about 400×) | 2.8 GB |
| Docling v1, per page (round 1, median) | 1.46 | 4.3 GB |

Docling at either option is more than 5× MIRA-today. Under amendment 2 that is an operating cost needing your sign-off, on top of the licence.

## 8. Licences: checked today, at the exact cached revisions

| Component | Revision | Licence |
|---|---|---|
| docling, docling-core, docling-parse, docling-ibm-models | 2.140.0, 2.103.0, 7.22.3, 4.0.3 | MIT |
| Layout model `docling-layout-heron` (used by **both** A and C) | `8f39ad3c` | Apache-2.0 |
| TableFormer v1 weights `docling-models`, revision Docling pins (`v2.3.0`, `fc0f2d45`) | | **CDLA-Permissive-2.0 only** |
| The same weight bytes (sha256 `2a7d6c92…` verified) on `docling-models` `main` (`2199320`, re-checked live today) | | CDLA-Permissive-2.0 **or** Apache-2.0 |
| TableFormerV2 | `e41ba5da` | Apache-2.0 |
| torch (Docling runtime dependency) | 2.14.1 | Apache-2.0 plus BSD/BSL components: outside a strict "Apache or MIT only" reading, under either option |

**Unresolved and left for you:**
- whether loading the CDLA-or-Apache revision satisfies the policy (option A);
- whether torch's BSD components are acceptable.

Background: `DOCLING_LICENCE.md`.

## 9. The product on staging, as a customer would use it (phone size, 412×915)

**Environment:** staging `b7d64bf3e` (main minus #4550, whose checker is off anyway), a throwaway account, and the Micro820 installation instructions (24 pages).

| Step | Result |
|---|---|
| Upload and index | indexed, 53 chunks |
| "Maximum off-state current for the isolated inputs 04 to 11" | **1.5 mA**, cites p.18. Correct row, column, value and unit. The neighbouring column's 0.5 mA was not used |
| Tap the citation | opens the PDF at p.18, and the table shows 1.5 mA in the isolated column |
| Re-upload the identical file in the app, then ask for the *other* column | **0.5 mA**, cites p.18. Still one source, same document id, no duplicate copy |
| A question the manual cannot answer (scan time for 500 rungs) | `insufficient_evidence`, 0 citations, says the excerpts don't contain it |

Screenshots are in `docs/promo-screenshots/2026-10-20_staging-micro820-*_mobile.png`.

**Observations, not fixed:**
- The honest refusal carries the label "General guidance — not grounded in this machine's documents", which is odd wording for "your manual doesn't say".
- The notebook record reports `sourceCount: 0` next to a list holding one source.

## What to do next

1. **Retrieval.**
   - Don't merge #4481 or #4483 as written.
   - The Phase-0 finding that the answer text must be *visible* in the top six (`.planning/retrieval-phase0/`) remains the target.
   - Pages like se-lxm32a, where retrieval returns front pages 1–6, are the clearest shape. A fix should be measured on this same 77-question harness first; it takes minutes and costs nothing.
2. **Extraction.** Keep MIRA-today. Docling buys table fidelity but no retrieval, costs about 260× the CPU, and carries the licence question.
3. **Checker.** If licence option A is approved, V3 is the candidate for **shadow** mode (logged, never blocking) to collect real-answer catch and false-flag rates. Otherwise inconclusive.
4. **Paid oracle (T5b).** Run it only if you want to know whether better tables help the answer model on the right page.
