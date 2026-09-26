# Product workflow benchmarks

Status: **Proposed foundation; no new runner or scheduler**

A benchmark is a repeatable technician task with evidence and rules for judging it.
It is not a hidden final answer for MIRA to memorize. This directory catalogs workflow
contracts; execution and grading must reuse existing MIRA tooling where suitable.

Follow the [owner principles](../../docs/product/OWNER_OPERATING_PRINCIPLES.md) and
[mission contract](../../docs/product/REFINEMENT_MISSION_CONTRACT.md). Reuse the existing
[Answer Radar records](../../answer_radar/schema.py), [freezing](../../answer_radar/freeze.py),
[scoring](../../answer_radar/score.py), and [reporting](../../answer_radar/report.py) only
where their contracts fit. Their existence is not proof of a working mobile-photo
runner. Any adaptation must be a separately bounded, reviewed slice.

## Separate three things

| Material | Purpose | Publication boundary |
| --- | --- | --- |
| Deterministic fixtures | Test software behavior with controlled inputs | Synthetic or explicitly licensed/sanitized examples only |
| Real-world evidence | The original private photos, prompts and conversations | Protected local/approved storage; never copied to public GitHub by default |
| Scoring contract | Explain supported facts, unknowns, controls and acceptance | Public structure; evaluator-only facts remain separate from MIRA's input |

Keep Answer Radar's rights and independence vocabulary. Evaluation permission does
not imply public export, training permission, or cross-tenant reuse. Match private
artifacts with hashes and scoped IDs, not public download links or credentials.

## Every benchmark must declare

- ID, version, owner, origin failure and rights/retention rules.
- Literal inputs and evidence references with original hashes.
- Visible facts, acceptable interpretations, unsupported interpretations, known unknowns.
- The kind of next question/evidence request that would advance the task.
- Safety boundary, including both unsafe and nearby safe requests.
- UX expectations: progress, persistence, retry, evidence viewing and navigation.
- Opposite controls, required surfaces, repeated-run count and acceptance rule fixed before testing.
- Seven-layer grading, scoring provenance and reviewer independence.
- Frozen source/build/backend/model/environment identities for each evaluated run.
- Public summary and protected full-artifact locations, including all failed attempts.

Do not rely primarily on matching a hidden final diagnosis. Score evidence faithfulness,
usefulness and safe behavior even when several interpretations are reasonable. Separate
software assertions from judgments about real generated answers. Preserve evaluator
corrections as amendments; never rewrite history to hide a failed trial.

Cases used to tune prompts/code become DEVELOPMENT or REGRESSION under the existing
Answer Radar split definitions. They do not return to FRESH. A new model call on a
familiar photograph is not an unseen benchmark. Model judges require evidence and
independence records; agreement between two runs of the same model is insufficient.

## Initial catalog

| Benchmark | State | What it exercises |
| --- | --- | --- |
| [BENCH-FIREPLACE-001](BENCH-FIREPLACE-001/README.md) | Proposed workflow contract; private evidence; final replay incomplete | Multiple photos, drawings, labels, context, safety, recovery, phone/web continuity |

Grow toward roughly ten high-value workflows only from demonstrated failures. Candidate
families include control panels, drawings, multiple-photo diagnosis, VFD/PLC I/O/motor
faults, nameplates, mechanical/hydraulic/pneumatic systems, equipment plus manuals,
ambiguous or poor images, incomplete information, unsafe requests and legitimate safe
troubleshooting, long conversations, interrupted uploads and cross-device continuity.
These are a selection pool, not claims that benchmarks or runners already exist.

## Measurements stay separate

Track evidence-faithful answers, unsupported claims, association errors and context loss;
useful follow-ups, generic checklists and unnecessary refusals; unsafe advice and false
safety blocks; uploads, retry, persistence, source opening, device continuity and latency;
regression escapes, benchmark regressions, duplicate architecture and missions completed
without owner intervention. Record numerator, denominator, attempted/skipped/unknown runs,
benchmark split, exact candidate and grading provenance. Do not combine these into one
“MIRA quality score” that hides a safety or correctness failure. Repeated tuned cases
must not be presented as independent samples of customer performance.
