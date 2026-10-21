# Evidence-sufficiency floor trial for NOTEBOOK_LEXICAL_V2 (2026-10-21, $0): NOT proposed for activation

**Design (smallest change in the existing path):**
- A default-off `NOTEBOOK_LEXICAL_V2_MIN_COVERAGE=θ` inside `idfSql`.
- A candidate must cover θ of the question's IDF mass. A question lexeme absent from the scope counts at the maximum IDF.
- A filtered-out turn takes the existing no-coverage → refusal path.
- Two variants were tested:
  - **per-candidate:** every candidate below θ is dropped (diff not kept);
  - **turn-level:** refuse only when the *best* candidate is below θ (`turn-level-floor.diff`).

**Selection rule, fixed before any number was seen:** the largest θ with zero hit@6 loss and zero empty result on dev-77 compared with ungated ON. Negatives are reported only. They are a **proxy**: each question is asked of a manual from another product family. They are not hand-verified as unanswerable, and they were never used to choose θ.

| arm (turn-level) | hit@1 | hit@6 | answerable emptied | negatives emptied /77 | answerable hit@6 lost |
|---|---|---|---|---|---|
| OFF | 31 | 52 | 0 | 41 | (baseline) |
| ON | 42 | 69 | 0 | 41 | — |
| ON θ=0.3 | 41 | 67 | 3 | 56 | tq-12, tq-14, tq-42 |
| ON θ=0.4 | 40 | 66 | 5 | 57 | +tq-23 |
| ON θ=0.5 | 39 | 64 | 6 | 61 | +gs10-ch6-q3, tq-34 |

The per-candidate variant is in `gate-k6.jsonl`. It is no better: θ=0.3 also loses tq-12, tq-14 and tq-42.

**Verdict: FAIL on the pre-declared rule at every θ. No activation is proposed.**
- **The false refusals are the worst kind.**
  - tq-12 and tq-14 ask about pulling the RFI jumper on a high-leg delta while the drive is energised.
  - tq-42 asks for a lockout order.
  - Their gold pages exist. The questions use words the manual never does ("high-leg", "delta", "lock"), so a coverage gate refuses exactly the turns where a cited warning matters most.
- **The 41 negatives emptied by both arms** are emptied by the existing model-applicability filter (`admit`), not by IDF. Only 36/77 negatives were at stake at all.

**What this points to instead (not built):**
- The refusal decision belongs at the answer stage, where the model reads the evidence, with the claim verifier (`NOTEBOOK_CLAIM_VERIFIER`, already shadowed) as the deterministic check. A retrieval-side lexical floor cannot tell "the manual uses different words" from "the manual doesn't cover this".
- Measure it on the new frozen refusal/safety set, not on dev.
