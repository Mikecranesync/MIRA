# Print Translator Benchmark — Grading Schema

**schema_version: 1** · **judge_version: `benchmark-judge-v1`**

This is the versioned grading schema for the Print Translator automated benchmark
(spec: `C:\Users\hharp\AppData\Local\Temp\claude\...\benchmark_instructions.txt`, the
"M.I.R.A. Print Translator Automated Benchmark and Claude Judge Instructions" field-validation
spec). Machine-readable form: `grade_schema.json` (JSON Schema draft-07) in this directory. This
file is the human-readable companion — read both together.

This document defines **the schema only**. The judging instructions (how a judge subagent must
apply this schema to a case) live in `JUDGE_PROTOCOL.md`. This harness does not run judges — it
prepares evidence packages and expects `grades/<case_id>.json` files conforming to this schema to
be dropped in by a separate judge dispatch.

## Versioning rule

`schema_version` (this file + `grade_schema.json`) and `judge_version` (`JUDGE_PROTOCOL.md`) are
independent counters. Per spec §12 ("do not silently change the judge prompt or model version" /
"version the corpus, translator, classifier, runner, judge instructions, and grading schema"):

- A change to the **rubric categories, point values, or required grade fields** bumps
  `schema_version` and this file + `grade_schema.json` together.
- A change to **how the judge is instructed to apply the schema** (wording, examples, escalation
  thresholds) bumps `judge_version` in `JUDGE_PROTOCOL.md`.
- **Never rewrite a grade file already produced under an older `schema_version`/`judge_version` to
  match a newer one.** Re-grade under the new version and keep both, same discipline as
  `.claude/rules/mira-hub-migrations.md` §8 (immutable applied artifacts) applied to eval output.

## The 100-point rubric (spec §5, exact)

| Category (JSON key) | Points | What the judge measures |
|---|---|---|
| `classification_answerability` | 10 | Correctly identifies the image as an electrical print and recognizes whether the visible evidence is sufficient to answer. |
| `component_label_recognition` | 20 | Correctly identifies devices, symbols, tags, wire numbers, terminals, coils, contacts, and labels that are actually visible. |
| `power_control_flow` | 20 | Accurately explains current path, control power, enabling conditions, outputs, and major functional relationships. |
| `sequence_interlocks_logic` | 20 | Correctly explains operating sequence, permissives, interlocks, contact/coil relationships, and likely state transitions. |
| `evidence_grounding_unsupported_claims` | 20 | Separates visible facts from inference, avoids invention, and appropriately handles unreadable or ambiguous evidence. |
| `technician_usefulness_clarity` | 10 | Provides a concise, practical explanation that helps a maintenance technician understand the print without creating false confidence. |
| **Total** | **100** | |

`category_scores` in a grade holds **points awarded** (0..max), not points deducted.
`total` = sum of `category_scores`, computed arithmetically by the judge.

## Grade record shape (per case)

Each `grades/<case_id>.json` (produced by a judge, not by this harness) is one JSON object:

- `schema_version` (=1), `case_id` (e.g. `"03"`)
- `category_scores` — the 6 keys above
- `total` — sum, 0..100
- `deductions[]` — one entry per point loss (see below); may be empty for a perfect score
- `hard_failure` (bool) + `hard_failure_reasons[]` — non-empty iff `hard_failure` is true
- `answerable` (bool) — was the visible evidence sufficient to attempt an answer
- `refusal` (bool) — did the translator itself decline
- `overall_confidence` ∈ `{low, medium, high}`
- `judge_version` (=`"benchmark-judge-v1"`), `judge_pass` ∈ `{1, 2}`
- `notes` (optional free text)

### Deduction shape (spec §6, exact — every field required)

- `claim` — the exact translator statement (verbatim quote) or the specific omitted concept
- `evidence` — what is visible in the drawing that supports/contradicts/fails to support it
- `category` — which of the 6 rubric categories this deduction is charged against
- `points_deducted` — number ≥ 0
- `severity` ∈ `{minor, material, severe, hard_failure}`
- `correction` — concise recommended correction
- `confidence` ∈ `{low, medium, high}`

### Hard-failure reasons (spec §7, exact set)

`hard_failure_reasons` entries are drawn from a fixed enum so hallucination reports can be
aggregated mechanically:

- `invented_safety_device_or_component`
- `reversed_or_materially_incorrect_sequence`
- `unsupported_dangerous_troubleshooting_advice`
- `false_certainty_from_unreadable_evidence`
- `failure_to_separate_evidence_from_inference`

## What this harness does NOT do

This harness (this directory + `tools/print_translator_eval/benchmark/`) builds evidence packages
and reads/aggregates grades. **It does not grade.** Grading is a separate Sonnet judge subagent
dispatch following `JUDGE_PROTOCOL.md`, writing `grades/<case_id>.json` files matching this schema.
`aggregate.py` tolerates an empty `grades/` directory and reports "0 grades yet".
