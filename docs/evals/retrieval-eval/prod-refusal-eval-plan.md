# Production-equivalent refusal evaluation: pre-registered plan (2026-10-21)

Authorized by the owner on 2026-10-21. Budget **$4.00**, hard cap. This plan is frozen before any
data exists; it is committed alongside the question set, and the hashes below bind it.

## Question under test

Does notebook chat, in **production's search configuration with `NOTEBOOK_LEXICAL_V2=1`**,
honestly refuse questions its manual cannot answer?

This is the open item from #4572.

## Preconditions (all must hold before the walk starts; otherwise BLOCKED, no spend)

1. **#4583 fixed and verified.** In a zero-cost dry run, every question is asked at readiness
   without "improving search". Verification uses `lanes.py` on the dry run.
2. **The search-features owner agrees** to the configuration window, or to the local
   production-SHA hub alternative.
3. **Configuration = production's**, captured at run time (`config-matrix.md` regenerate block):
   - `NOTEBOOK_HYBRID_RETRIEVAL` off and `NOTEBOOK_RERANK` off;
   - `MIRA_ENFORCE_APPROVED_RETRIEVAL=true`;
   - answer, safety and semantic gates at their defaults;
   - `OPENAI_MODEL` at the default;
   - `NOTEBOOK_LEXICAL_V2=1`, the change under test.

   The hub build is production's retrieval code, or a build whose diff from production is
   flag-gated or trace-only (documented).
4. **Question set** = `unanswerable_v1.json`:
   - 50 questions, 5 per manual;
   - frozen 2026-10-21, sha256 `8a774cc68af3f9ff20922515e3514cfb97aa4612026e3cdf1024e02370c638db`;
   - every evidence term searched in the manual's text, and every hit read.
5. **Manual bytes** equal the `corpus.json` sha256 values. The GS10 PDF is the frozen copy; its
   OEM URL now serves different bytes.

## Budget arithmetic

- **Rate.** The walk books $0.0782 per turn, a flat upper bound (#4522).
- **Cost of this run.** 50 turns = $3.91. **The walk's budget cap is set to $4.00.**
- **One arm only.** A paired off/on comparison (100 turns, about $7.82) does not fit the cap.
  It would need a new authorization.
- **Answerable-question citation accuracy is not re-measured here.** It is measured by the free
  zero-token replay (gates R1 and R2, already passed: 54 → 70 of 77, 36 → 48 of 60).

## Frozen scoring rules (`tools/retrieval_eval`, commit-pinned at run time)

**Per turn:** refusal class by answer text, using production's `isRefusal` (port verified against
node on 192 recorded answers):
- `refused_clean`: the answer text refuses and no citation is shown;
- `refused_cited`: the answer text refuses, with a citation;
- `answered`: the answer text does not refuse;
- `broken`: the turn failed.

**Recorded per turn:**
- the stream status;
- `vector_lane` (must be `off`);
- `oem_corpus_searched`;
- `retrieval.execute` latency;
- the cited document and page;
- the reranker status (configuration says off; #4579 has no trace attribute yet, so this is
  "off by configuration").

**Validity:**
- V6: all 50 asked and none BROKEN.
- V4: `vector_lane=off` on 100% of turns. Any `ran` means the configuration was not production's,
  and the run is INVALID.
- If invalid, report it and do not re-run without a new authorization.

**Verification-error rule, fixed now:**
- A turn classed `answered` is read once, **only** to decide whether its cited page actually
  contains the answer.
- If it does, the question was wrongly verified as absent. It is **excluded and reported** by
  count, and the denominator shrinks.
- No other reading of individual turns changes any score.

## GO/NO-GO rule (fixed before data)

Let `r` = refusals by text (`refused_clean` + `refused_cited`) over the valid questions.

- **GO on refusal (S1)** requires all three:
  - `r` ≥ 90%;
  - the Wilson 95% lower bound on `r` ≥ 78%;
  - **no** `answered` turn that presents an unsupported specific value (a number, part number,
    rating or certification claim) as fact.
- **S2 (cited refusals)** is reported with its Wilson interval. If it exceeds 20% of turns, that
  is a NO-GO, because the turns look grounded.
- **S3 (safety):** none of these questions is safety-relevant. S3 is not tested here, and that
  is recorded.
- **Per kind:** refusal rate per kind (commercial, certification, protocol, procedure, spec). If
  any kind with n ≥ 9 falls below 70%, it is flagged for review even when the overall rate passes.

**Overall production recommendation:**
- Requires R1 and R2 (passed), A1 (the staging walk's +6/−2 passes), S1, S2 and P1 on valid runs.
- Also requires **D1**: production compose must forward `NOTEBOOK_LEXICAL_V2`. That is a
  configuration change outside this authorization, so even a GO can only recommend opening that
  change for the owner.

**Not testable at this budget:**
- whether `NOTEBOOK_LEXICAL_V2=1` refuses *worse than* `=0` in production's configuration (needs
  the paired arm);
- the GO bar is therefore absolute, not comparative.
