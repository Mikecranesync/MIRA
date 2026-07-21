# PrintSense Generalization Test — Next-Step Execution Plan

> Operator directive, 2026-07-21. Governs the PrintSense generalization program that follows the
> five-case internet-print bench (mean ≈ 8.6/10, MiniMax free cascade, no-OCR path, ~$0.07).
> **Do all three, in order. Do not tune against individual test cases. Do not merge until the
> complete before/after report and artifacts are presented for review.**

## 1. Fix the test infrastructure first

Otherwise the next batch produces weaker evidence and requires manual grading again.

### Required fixes

- Repoint the LLM judge from Anthropic to the same approved free cascade used by the interpreter.
- Add independent download limits:
  - Maximum response size
  - Connection timeout
  - Total fetch timeout
  - Maximum PDF pages or a wiring-page extraction path
- Make one failed or oversized URL return a typed `SKIP`, not terminate the batch.
- Suppress `tag_flood_without_ocr` whenever OCR capability is explicitly unavailable.
- Preserve the following for every case:
  - Original image
  - Model response
  - Deterministic checks
  - Judge result
  - Latency
  - Cost

## 2. Commit this result as a durable benchmark report

This result is important enough to record.

The report should state exactly:

> PrintSense scored approximately 8.6/10 across five previously unseen internet electrical prints
> from five manufacturers, covering NEMA and IEC conventions, with 100% correct document
> classification and no identified fabrication, using the MiniMax free cascade on the no-OCR path
> for approximately $0.07 total inference cost.

Do not market it yet as “PrintSense understands any print.”

The defensible claim is:

> **PrintSense demonstrated strong generalization across unseen industrial electrical prints
> without corpus-specific training or OCR assistance.**

Store all reproducibility evidence: five source URLs, source-file hashes, timestamps, raw outputs,
grading rubric, grader notes, configuration identifier, model and provider information. This
prevents the benchmark from becoming an unverifiable anecdote.

## 3. Use the remaining budget on capability boundaries

Do not spend the remaining budget collecting more VFD-style wins. Prioritize genuinely different
visual and semantic structures:

1. Traditional relay ladder with cross-sheet references
2. PLC ladder-logic screenshot or exported rung sheet
3. Terminal-block or interconnection diagram
4. Control-panel layout or enclosure arrangement
5. P&ID
6. Pneumatic schematic
7. Hydraulic schematic
8. Safety circuit with prominent warnings and required reset behavior
9. Power-distribution single-line diagram
10. Multi-page print requiring cross-page reasoning

The objective is to identify **where PrintSense stops generalizing**, not to maximize the average score.

## Safety-warning improvement

Promoting printed warnings is a near-term product requirement, not merely a benchmark enhancement.

Add a dedicated extraction lane for: `DANGER`, `WARNING`, `CAUTION`, prohibitions ("never", "do
not", "must not"), required protective-device placement, bypass/isolation restrictions,
safety-category requirements, reset requirements.

The final PrintSense answer must contain a visibly separate **Safety and Manufacturer Warnings**
section that: preserves source wording closely, cites the relevant image/document region,
distinguishes printed manufacturer warnings from inferred guidance, and never invents safety
requirements absent from the source.

## Recommended success gate

Call the generalized-print milestone achieved only when:

- At least 15 total unseen prints have been tested
- At least 8 distinct diagram classes are represented
- Classification accuracy remains at least 95%
- No unsupported terminal, device, or connection claims occur
- Printed safety warnings are surfaced on every applicable case
- Failures are honest and localized rather than speculative
- The entire suite can rerun unattended without one URL terminating the batch

## Engineer instruction

> Fix the runner and judge, commit the current five-case generalization report with complete
> reproducibility evidence, add safety-warning elevation, then spend the remaining test budget on
> ten structurally different print classes with emphasis on discovering failure boundaries. Do not
> tune against individual test cases or merge until the complete before/after report and artifacts
> are presented for review.

---

## Implementation tracking (agent)

- **Phase 1 — infra fixes: DONE** (v3.185.0). judge→free cascade; connect + total-fetch-deadline +
  size cap; typed `SKIP` excluded from the failure exit; max-PDF-pages guard; `deterministic_grade.json`
  artifact; `tag_flood_without_ocr` suppressed when `ocr_available` is False. +6 hermetic tests, 102 green, ruff clean.
- **Phase 2 — benchmark report: PENDING.**
- **Phase 3 — 10 boundary-probing classes: PENDING** (metered, within the remaining ~$0.43 of the $0.50 cap).
- **Safety-warning elevation: PENDING** (product change to the print answer + a warnings lane).
