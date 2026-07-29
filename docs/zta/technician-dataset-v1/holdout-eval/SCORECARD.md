# Technician v1 — Track 1 Blinded Hold-out Eval Scorecard (2026-07-28)

**Formal verdict (honesty rule ≥18/25 non-tie): NOT MET — judged tuned 14 / base 9 / tie 2.**
**Direction vs v0: tuned doubled (7 → 14), base fell (13 → 9). The v1 evidence contract
converted the loss into a win — just not an ≥18 sweep.**

## Run integrity

- Prompts: 25 reserved PF40 evidence-absent records, byte-identical to v0
  (v0-config hash `7efa6127…694c40a5` reconstructed exactly; v1 file hash
  `fe5eb9ab…b991c37e` differs only by the tuned-model metadata field).
- Models: base `Qwen/Qwen3.5-9B` (serverless) vs tuned
  `mike_578c/Qwen3.5-9B-technician-v1-29ed546c` (merged model, temp v2 dedicated
  deployment `dep_CdV9sNJmtzkzp9F9Nahqt`, `stopped_verified=True`; the deployment
  DELETE 409 is the known benign traffic-split cascade).
- Blinding: outputs `sha256:446719c5…ec0cf152`, sealed mapping `sha256:8c7df223…28dda109`.
- Judge protocol frozen BEFORE generation: `judge_panel_protocol.md`
  sha256 `4e368ffb2df160c5fe9c394a0c2d20679e7bc93183c9f0a346ed624aa0f58ef6`.
- Panel scores locked BEFORE unsealing: `panel_scores_locked.json`
  sha256 `03460467795a4cae685c8f5c676d23eb5ca9f6edb1c17181e342565bf0092d83`.
- Tuned side distribution in the blind: left 13 / right 12 (no side bias).
- Authorizations consumed: `techv1-holdout-eval-20260728-30cb` (eval),
  `techv1-holdout-ep-20260728-a649` (endpoint). Single-use, ledgered.

## Result

| Axis | tuned | base | tie |
|---|---|---|---|
| **Panel majority (final)** | **14** | 9 | 2 |
| Judge 1 — technician usefulness | 14 | 11 | 0 |
| Judge 2 — grounding/fabrication | **18** | **0** | 7 |
| Judge 3 — safety doctrine | 13 | 12 | 0 |

14 records decided 2-1 (dissents recorded in the judge files); 2 records were 1-1-1
three-way splits, scored as ties per protocol.

## Reading

- **The v0 failure mode is dead.** v0's tuned model collapsed into vacuous tautologies and
  lost diagnostic 0-9-1. v1's tuned model — trained on the evidence contract (Pattern B:
  evidence-absent → cite-or-refuse) — produced clean, honest refusals with correct safety
  floors and **zero grounding losses in 25 records** (18 wins, 7 ties, 0 losses).
- **Where base still won (9):** richness, not correctness. The Qwen3.5 base also refuses
  often, and when both sides refuse, judges rewarded the refusal carrying more actionable
  next steps / LOTO framing. Several base wins were records where the tuned answer was a
  thin one-liner refusal vs base's structured refusal. Notably, many base answers that DID
  elaborate fabricated a nonexistent "PowerFlex 4000 series" and wrong fault meanings —
  when that happened, tuned took the record.
- **Lever for v2 (or a v1.1 sitting):** keep the evidence contract, add refusal *richness* —
  Pattern B answers should refuse AND enumerate what to provide, where the fact lives, and
  the safety floor (the shape Judge 1/3 rewarded). The training answers already have this
  shape in the valued set; the diagnostic-B set trends terse.

## Spend

Training $4.00 (job `ft-6fe667a3-6b72`, 16,938 packed tokens, 3 epochs). Eval: temp v2
deployment ~5 min ready-to-stopped + 25 serverless base calls (recorded conservatively
against a $5.00-cap shared declaration; actual well under $1 on the v0 cost model).
