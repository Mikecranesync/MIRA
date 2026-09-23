# Jev Decision Fabric — calibration, and what it does not establish

**2026-09-23** · question set `decision-fabric-v1` · model `jev-1.13.0` ·
harness `tools/qa/jev_decision_probe.ts` (imports the shipping module, so the
payload measured is the payload production sends).

## The honest headline

Ten states, three repeats each, thirty live calls. Five of the eleven
probability questions separated divergent from sound **perfectly**, and
repeatability was strong. **But the thresholds below were fitted on the same ten
states they are scored against.** That is an in-sample optimum, not a
generalization estimate, and it is why no production threshold is proposed here.
The goal's instruction — *do not choose production thresholds yet* — is the right
call and this data does not overturn it.

## Repeatability — the one result that IS clean

Same state, three identical calls, maximum spread of any of the eleven signals:

| state | max spread | noisiest signal |
|---|---|---|
| D1 hmi→vfd (#3966) | 0.070 | ignored_evidence |
| D2 bearing (#3962) | 0.050 | contradicts_observations |
| D3 invented numeric | 0.040 | family_match |
| D4 wrong model, same vendor | 0.060 | ignored_evidence |
| S1 clean grounded | 0.040 | needs_human_review |
| S2 honest refusal | 0.040 | family_match |
| S3 right terms, premise declined | 0.070 | family_match |
| S4 distracting terms | 0.030 | family_match |
| S5 ambiguous identity | 0.030 | needs_human_review |
| S6 grounded with hedge | 0.040 | needs_human_review |

**Worst spread anywhere: 0.070.** This is not fitted — it is a direct
measurement, and it means the signal is stable enough that a threshold could in
principle be set without run-to-run flapping dominating it.

## Per-question separation (in-sample)

Mean over 3 runs; 4 divergent states vs 6 sound. `acc` is at the best threshold
**chosen on this same data**.

| question | div | sound | gap | best rule | acc | TP FP TN FN |
|---|---|---|---|---|---|---|
| follows_evidence | 0.11 | 0.78 | −0.67 | ≤0.18 | **1.00** | 4 0 6 0 |
| over_specificity | 0.77 | 0.18 | +0.59 | ≥0.27 | **1.00** | 4 0 6 0 |
| needs_human_review | 0.87 | 0.53 | +0.35 | ≥0.71 | **1.00** | 4 0 6 0 |
| regression_candidate | 0.58 | 0.19 | +0.39 | ≥0.26 | **1.00** | 4 0 6 0 |
| wrong_family_grounding | 0.39 | 0.05 | +0.34 | ≥0.16 | **1.00** | 4 0 6 0 |
| contradicts_observations | 0.63 | 0.13 | +0.50 | ≥0.27 | 0.90 | 3 0 6 1 |
| family_match | 0.16 | 0.55 | −0.38 | ≤0.35 | 0.90 | 4 1 5 0 |
| ignored_evidence | 0.43 | 0.19 | +0.25 | ≥0.27 | 0.90 | 3 0 6 1 |
| used_strongest_evidence | 0.19 | 0.65 | −0.45 | ≤0.19 | 0.90 | 3 0 6 1 |
| unsupported_numerics | 0.55 | 0.21 | +0.34 | ≥0.07 | 0.80 | 4 **2** 4 0 |
| answered_the_request | 0.59 | 0.75 | −0.16 | ≤0.16 | **0.70** | 1 0 6 3 |

## The two questions that are NOT ready, and why

**`answered_the_request` (0.70) — the weakest, and predictably so.** A *correct
refusal* does not answer the request. S2 ("I do not have the terminal torque
spec, check the manual") is exactly right and scores low on responsiveness. The
question conflates "MIRA failed to answer" with "MIRA correctly declined", which
are opposite outcomes. **Do not use it as a divergence signal.** Either re-word
it to exclude justified refusals or drop it — a question-set-version decision.

**`unsupported_numerics` (0.80, 2 false positives).** It fires on sound turns
that mention a parameter or a voltage in a *hedged* or *safety-isolation* context
— the same clause that caused #3963's deterministic detector to fire on 25 of 40
healthy turns. The judge is less wrong about this than the regex was, but not
clean, and this is the single question where a low threshold buys recall at a
real false-positive cost.

## The typed class question is the strongest single reading — with one caveat

`failure_class` never returned `none` for a divergent state and returned `none`
for five of six sound states, across all 30 calls:

| state | class | confidence |
|---|---|---|
| D1 hmi→vfd | `retrieval_mismatch` | 0.72–0.82 |
| D2 bearing | `identity` | 0.36–0.40 |
| D3 invented numeric | `missing_evidence` | 0.42–0.46 |
| D4 wrong model | `retrieval_mismatch` | 0.82–0.83 |
| S1 clean | `none` | 0.99 |
| S3 premise declined | `none` | 0.84–0.87 |
| S4 distracting terms | `none` | 0.90–0.91 |
| S5 ambiguous identity | `none` | 0.71–0.75 |
| S6 grounded w/ hedge | `none` | 0.44–0.50 |
| **S2 honest refusal** | **`missing_evidence`** | 0.50–0.58 |

D1 and D4 land on `retrieval_mismatch` — which is the *earliest wrong point* in
both, and the classification the #3966 root-cause analysis reached
independently. D2 lands on `identity`, which is likewise where that failure
actually begins (the subject established in turn 1 is lost).

**The caveat is S2.** "Missing evidence" is a true statement about that turn and
yet the turn is *correct* — MIRA said so and refused. So **`class != none` is not
a usable defect signal on its own**: it describes the situation, not the
mistake. A defect rule needs the class *plus* a signal that the answer went ahead
anyway (`follows_evidence` low, or `over_specificity` high). S2 scores
`over_specificity` 0.10 and `follows_evidence` 0.88, so the pair separates it
cleanly — but that is a rule to *test*, not one to adopt from ten states.

## Cost and latency

| | |
|---|---|
| p50 | 205 ms |
| p95 | 281 ms |
| input tokens, mean | 964 (range 917–1,023) |
| questions per request | 12 |
| turn-latency impact | zero — the call runs after `controller.close()` |

## What this does not establish

1. **n = 10.** Four divergent states, six sound. Any accuracy figure here has an
   error bar wider than the differences between the top five questions.
2. **Thresholds are fitted in-sample.** Reported to show separation exists, not
   to be adopted. `PROVISIONAL_THRESHOLDS` in `jev-candidates.ts` carries the
   same warning in code.
3. **The states are constructed, not sampled.** D1/D2 reproduce documented live
   failures and S1–S6 are written to be realistic, but none were drawn at random
   from staging traffic. Fresh-traffic calibration is the live acceptance run,
   not this.
4. **No pre-generation signal is measured.** The goal gates that on
   post-generation working first; it is not attempted here.

## Cross-references

- `docs/proofs/2026-09-23-jev-decision-privacy.md` — the payload, before enabling
- `docs/proofs/2026-09-23-3962-detector-comparison.md` — why a deterministic rule scored 0/11
- `mira-hub/src/capabilities/observability/jev-candidates.ts` — the provisional rules
