# IMIB v0.2: benchmarking MIRA without a human answer key

**Question from the owner:** can MIRA be benchmarked without Mike answering a pile of questions, and can the
benchmark itself be proven trustworthy first?

**Rules:** pre-registered in `PREREGISTRATION-v0.2.md`, commit `2736440bb`, pushed before any run. Every number
below is recomputed from `raw/` by `v02/analyze_v02.py` into `v02/results-v02.json`.

**Arms** (all production flags, k = 6, 2 repeats, deterministic):
- `pre` b980d42db, `parent` e28bb182d, `post` cc0d26c1d;
- `noexactlane`: cc0d26c1d with the exact-token lane disabled (a planted defect);
- `bm25`: page-level keyword search;
- `random`: a seeded random page order.

## Verdict on the method

**Fit for use. Every validation test passes.**

| Pre-registered test | Bar | Result |
|---|---|---|
| V1 discrimination (oem-fault) | BM25 ≥ 50% and random ≤ 10% at top-5 | **PASS**: BM25 79%, random 2% |
| V2 planted defect (oem-fault) | the NO-GO rule fires (≥ 2 net losses) | **PASS**: 42 lost, 0 gained (p < 1e-12) |
| V3 known change (#4791, oem-fault) | descriptive | Moved: 5 gained, 0 lost |
| V4 determinism | every arm identical across repeats | **PASS** |
| V5 key quality | key-builder tests green | **PASS**: 15/15, each guard proven red (`v02/red_runs.py`) |

The v0.1 sets missed the planted defect: 1 lost and 1 gained on 77 questions. The fault-code set catches it
42 to 0. So the manufacturer-keyed sets work as a regression gate, and they need nobody's time.

## The six methods

| # | Method | n | Outcome | What it proves | Cost |
|---|---|---|---|---|---|
| 1a | Manufacturer fault tables (`oem-fault`) | 174 / 7 manuals | **Works.** Key is page-checked and reproducible byte for byte. | Fault-code page retrieval; regression gate | $0 |
| 1b | Manufacturer index (`oem-index`) | 162 / 8 manuals | **Works.** Printed pages mapped to physical pages; every entry's words checked on the page. | Topic lookup | $0 |
| 2 | Reworded variants (`robust`) | 1,264 of 251 base questions | **Works.** Found a real defect (below). | Sensitivity to how techs type | $0 |
| 3 | Forum threads with a confirmed fix (`forum-resolved`) | 9 collected | **Not viable mechanically.** 1/9 maps to a page; the fixes name parameters found on many pages, or things no manual holds. | Nothing at this scale | $0 |
| 4 | SimLab breakdowns | 11 scenarios × 3 | **Works.** Deterministic checkpoints. | Multi-turn diagnosis behaviour | **$1.47** of $5 |
| 5 | Paid technicians | n/a | **Kit ready**, not posted (`v02/TECH_REVIEW_KIT.md`). | Independent expert key + κ | about $200–300 if hired |
| 6 | AI labelers, calibrated on the manufacturer key | 4 non-Claude models | **1 of 4 qualified** (bar 90%). | See below | **$0.42** of $3 |

**Paid spend: $1.89 against $8 of caps.** That includes $0.25 booked for 9 SimLab calls the first meter could not
price; that meter bug is fixed and covered by `v02/test_simlab_meter.py`.

## What the new sets say about MIRA

### Page retrieval, top-5 (Wilson 95% CIs in `results-v02.json`)

| Set | pre | post (prod) | planted defect | BM25 | random |
|---|---|---|---|---|---|
| oem-fault (174) | 94 (54%) | **99 (57%)** | 57 (33%) | 137 (79%) | 4 (2%) |
| oem-index (162) | 73 (45%) | **73 (45%)** | 74 (46%) | 107 (66%) | 7 (4%) |
| robust (1,264) | 666 (53%) | **696 (55%)** | 479 (38%) | 910 (72%) | 57 (5%) |

**#4791 on the manufacturer sets: INCONCLUSIVE** (the pre-registered rule).
- Pooled across oem-fault and oem-index: 5 gained, 0 lost, p = 0.0625, just short of the 0.05 bar.
- On `robust`, which is not part of the verdict rule, #4791 gained 30 and lost 0 (p < 1e-8).
- The direction is consistent: a small, real improvement for fault-code questions, and nothing lost.

**Keyword search still beats production MIRA** on every set, by 21–22 points on fault and index questions. It
loses on only 7–9 of the questions where MIRA wins. That matches v0.1.

### Robustness: the shop-floor way of typing a code breaks retrieval

Top-5 hit retention under each rewrite rule, on `post`: the base question hit, so did the variant still hit?

| Rule | Retained | |
|---|---|---|
| lowercase, no punctuation | 145/146 (99%) | |
| short product names (pf40, ML1100) | 129/133 (97%) | |
| chatter preamble | 139/147 (95%) | |
| terse keywords | 142/143 (99%) | |
| one typo | 63/71 (89%) | |
| **code typed differently** (`F33` → `fault 33`, `0002` → `code 2`, `0xF000` → `F000`) | **36/98 (37%)** | **flagged: < 80%** |

**This is the most actionable new finding.** When a tech types the fault number the way people say it, MIRA
loses about two-thirds of the right pages it found with the manual's own spelling. Pre-fix it was 22%, so #4791
helped a little.

### SimLab diagnosis (cc0d26c1d engine, 3 repeats)

- **Overall:** 11/33 scenario runs passed, about 33%. Per repeat: 4, 4 and 3 of 11.
- **Checkpoints:**

| Checkpoint | Passed |
|---|---|
| right subsystem identified | 15/15 |
| no crash / within turn budget | 33/33 |
| keywords present | 29/33 |
| isolation evidence | 12/15 |
| reached the expected diagnostic stage | 13/33 |
| **no premature blame** | **3/9** |

- **Pattern:** MIRA finds the right area but blames a component before ruling things out, and often doesn't
  reach the stage the scenario expects.
- **Caveats:** the scenarios are hand-written ("scenario_authored" truth), and #4791 did not change this engine.

## Can it replace Mike? Partly.

- **Regression gating: yes.** The manufacturer-keyed sets plus the reworded variants catch defects the AI-labelled
  sets missed, and need no human.
- **Real technician wording: no, not yet.**
  - Only `gpt-4.1-mini` cleared the 90% calibration bar: 98% on fault questions. Gemini Flash-Lite scored 87%,
    DeepSeek 88% and Llama 3.3 83%.
  - The rule needs two qualified labelers to agree before a case skips Mike, so his forum queue stays at 34.
  - **Independent of the bar:** all six AI labelers (four here, plus the two Claude labelers from v0.1) agree on
    only 8 of 34 forum questions. Real questions are genuinely ambiguous.
- **Safety: never automated.** All 32 safety calls stay with Mike by rule.
- **What Mike is asked, under the pre-registered rule** (`v02/mike-queue.json`):
  - 34 forum cases;
  - 32 safety calls;
  - 10+ hazard questions.
  - Lowering that means a second qualified labeler or paid technicians (method 5). Moving the 90% bar after
    seeing results would not be honest.

## Deviations from pre-registration

1. **DeepSeek labeler.** It was added after the first calibration left one qualified labeler. Qualification is
   judged only against manufacturer truth, never forum outcomes. It scored 88%: not qualified. No further
   models were tried.
2. **forum-resolved** produced 1 usable question, so it is not scored. It was pre-registered as "registered later";
   it was never run.
3. **SimLab meter.** The first attempt's 9 calls were not metered; they are booked at $0.25.
4. **SimLab used `INFERENCE_BACKEND=cloud`** on the dev Doppler config. The runner's own docstring says `-c prd`;
   it was not followed.

## Reproduce

```bash
cd docs/evals/benchmark-4791
python3 v02/oem_truth.py --pdf-dir <19 OEM PDFs>; python3 v02/robustness.py              # keys (deterministic)
BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench bash v02/run_v02.sh <wt-root> <out> oem-fault oem-index robust
python3 bm25_baseline.py <set>/<set>-questions.json raw/<set>/<set>-bm25-k10-r1.jsonl   # per set
python3 v02/random_baseline.py <set>/<set>-questions.json raw/<set>/<set>-random-k10-r1.jsonl
uv run --no-project --python 3.12 python v02/analyze_v02.py
uv run --no-project --python 3.12 --with pytest --with matplotlib python -m pytest -q test_*.py human-key v02
uv run --no-project --python 3.12 --with pytest python v02/red_runs.py
```

Paid lanes (only when re-validating; results are cached and never re-requested):
`v02/ai_labelers.py` and `v02/simlab_run.py`. Commands are in each docstring; budgets in `v02/BUDGET.md`.
