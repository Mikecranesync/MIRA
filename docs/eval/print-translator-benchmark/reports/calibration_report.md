# Print Translator Benchmark — Technician Calibration Report

**Status:** PENDING — awaiting Mike's review and grading

---

## Overview

This report will document Mike's independent scoring of a representative sample of the 10 benchmark cases, used to:

1. Validate that the benchmark judge's scoring method aligns with expert technician judgment.
2. Identify any category-specific biases or blindness in the grading rubric.
3. Confirm that hard-failures (cases 05 and 20) are indeed unacceptable.
4. Establish a confidence interval for the full benchmark findings.

---

## Calibration Sample

**Target:** 5–10 cases (50–100% of seed baseline). Recommended stratification:

- At least 1 VFD case (e.g., 17 or 20)
- At least 1 PLC I/O case (e.g., 13 or 14)
- At least 1 safety case (e.g., 09)
- At least 1 motor control case (e.g., 03, 05, or 07)
- BOTH hard-failure cases (05 and 20) to validate hard-failure judgment

---

## Scoring Process

1. **Review the benchmark grade** for each assigned case (in `grades/<case_id>.primary.json`).
2. **Review the print evidence** (in `evidence/<case_id>.json`) and the image (at `evidence/images/<case_id>.png` or Downloads folder).
3. **Read the technician question** (in evidence JSON) and evaluate the model's response.
4. **Score independently** using the same 6-category rubric as the benchmark judge (see `grade_schema.json`).
5. **Record your scores** in the row below; optionally add notes on:
   - Whether you agree with the hard-failure designation
   - Whether the deductions identified by the judge are appropriate
   - Any category where you feel the judge was too harsh or too lenient

---

## Calibration Results

| Case ID | Category | Benchmark Total | Mike Total | Difference | Mike Hard-Failure | Match? | Notes |
|---------|----------|-----------------|-----------|------------|--------------------|--------|-------|
|         |          |                 |           |            |                    |        |       |
|         |          |                 |           |            |                    |        |       |
|         |          |                 |           |            |                    |        |       |
|         |          |                 |           |            |                    |        |       |
|         |          |                 |           |            |                    |        |       |

---

## Analysis (To be completed after scoring)

**Agreement threshold:** ≥80% of scored cases within ±5 points (spec §14).

**Agreement rate:** ___ / ___ = ___%

**Category-specific notes:**

- VFD cases: …
- PLC I/O cases: …
- Safety cases: …
- Motor control cases: …

**Hard-failure validation:**

- Case 05: Benchmark = hard-failure; Mike = …
- Case 20: Benchmark = hard-failure; Mike = …

**Rubric feedback:**

- Scoring clarity: [Any issues with the 6-category definitions?]
- Severity calibration: [Any deductions that felt wrong?]
- Hallucination detection: [Were the invented components obvious upon review?]

---

## Sign-Off

**Calibration authority:** Mike (Technician)

**Date completed:** [PENDING]

**Status:** PENDING

---

Generated: {datetime.now().isoformat()}
