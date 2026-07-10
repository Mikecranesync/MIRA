# MIRA Print Translator Benchmark Report
**Date:** 2026-07-10

## ⚠️ NON-AUTHORITATIVE NOTICE

**This benchmark is NOT authoritative until Mike completes the technician calibration sample (§9 of JUDGE_PROTOCOL.md).** It is a **10-case SEED baseline — below the spec's ≥25-print minimum**. This report is advisory only and must be expanded via the LIVE_TELEGRAM_RUNBOOK before any product decisions are made.

---

## Executive Summary

- **Total cases evaluated:** 10 (seed baseline)
- **Mean quality score:** 65.4/100
- **Median quality score:** 64.5/100
- **Score range:** 31 – 88
- **Hard-failure rate:** 2/10 (20%)
- **Refusal rate:** 0/10 (0%)
- **Answerability rate:** 10/10 (100%)

### Before/After PR #2608 (Classifier Fix)
- **Pre-PR:** 1/10 cases triggered print classification (10%)
- **Post-PR:** 10/10 cases triggered print classification (100%)
- **Improvement:** 9/10 cases newly classified (90pp gain)

### Confidence Distribution
- High: 8 cases
- Medium: 2 cases

---

## Score Distribution

### Threshold Breakdown
- **≥80:** 3 cases (30.0%)
- **70-79:** 1 cases (10.0%)
- **60-69:** 3 cases (30.0%)
- **50-59:** 1 cases (10.0%)
- **<50:** 2 cases (20.0%)

### All Scores
- Case 03: 59/100 (confidence: medium)
- Case 05: 31/100 (confidence: high) ⚠️ HARD-FAILURE
- Case 07: 60/100 (confidence: high)
- Case 09: 78/100 (confidence: high)
- Case 13: 82/100 (confidence: high)
- Case 14: 85/100 (confidence: high)
- Case 17: 63/100 (confidence: high)
- Case 18: 88/100 (confidence: high)
- Case 20: 42/100 (confidence: medium) ⚠️ HARD-FAILURE
- Case 25: 66/100 (confidence: high)

### Judge Escalation Results

**Case 05:**
- Pass 1 total: 31/100 (hard-failure: True)
- Pass 2 total: 44/100 (hard-failure: True)
- Gap: 13 points
- Disposition: Hard-failure confirmed by both judges; gap < 15 → no escalation to technician review

**Case 20:**
- Pass 1 total: 42/100 (hard-failure: True)
- Pass 2 total: 32/100 (hard-failure: True)
- Gap: 10 points
- Disposition: Hard-failure confirmed by both judges; gap < 15 → no escalation to technician review

---

## Interpretation

100% of these 10 cases were successfully classified as electrical prints (or answerable as such) by the **post-PR #2608 classifier**, compared to just 10% under the pre-fix logic. This 90-point gain in classification trigger rate demonstrates the effectiveness of the classifier improvements.

**Quality profile:**
- Mean score 65.4/100 places the seed baseline at upper-mid range.
- Median 64.5 confirms the distribution is relatively balanced (not skewed by outliers).
- Hard-failure rate (20%, n=2) reflects a specific, repeatable hallucination mode: **invented component tags not visually present or legible in the image**. Both cases (05 and 20) occurred in image-only runs without OCR assistance.
- Answerability 100% shows the print-selection filter is working correctly.
- Confidence split (8 high, 2 medium, 0 low) suggests the classifier and grading logic are aligned and non-fragile.

**Hallucination risk (image-only):** All hard-failures involved image-only processing (no OCR) where the model asserted components (control transformer, main contactors K1/K2, connectors XC00/XC90) that either don't exist on the print or are actually different component types. This is a known OCR-degraded mode captured in the lab and documented in the full hallucination report.

**Escalation:** Both hard-failure cases were independently re-graded by pass2 judges and confirmed. Neither gap (05: 13 pts, 20: 10 pts) exceeded the 15-point threshold to trigger technician-review escalation. Both judges agreed on hard-failure status.

---

## Acceptance Checklist (§14, Spec 2.2)

- [ ] Mike calibration: ≥5–10 representative cases reviewed and scored by Mike (10–20% of seed).
- [ ] Agreement threshold: ≥80% of calibration cases have Mike–benchmark difference ≤5 points.
- [ ] Category coverage: At least one VFD, one PLC I/O, one safety, one motor control checked.
- [ ] Hard-failure validation: Technician confirms both cases (05, 20) are indeed hard-failures.
- [ ] Hallucination pattern: Image-only inventory confirmed; OCR-enabled baseline requested or set as prerequisite.
- [ ] Classifier trigger rate: Confirmed, documented, stable across ≥2 independent reruns.

**Status:** PENDING — awaiting Mike's calibration sample.

---

## Next Steps

1. **Expand to ≥25-case benchmark** via LIVE_TELEGRAM_RUNBOOK or deliberate corpus selection (each category ≥5 cases).
2. **Collect technician feedback** on 5–10 cases (at minimum) to calibrate grade definition and identify any category-specific blindness.
3. **If OCR available,** re-run pass1 on all cases with OCR + text extraction to establish a baseline for the image-only hallucination risk quantification.
4. **Document improvements** (e.g., prompt refinements, guard-rail additions) and re-run the full benchmark to measure delta.

---

## Schema & Methodology

- **Grade schema:** `{'20', 'category_scores', 'total', 'deductions', 'hard_failure', 'overall_confidence', 'judge_version', …}` per `grade_schema.json`.
- **Deduction severities:** minor (0–5 pts), material (5–15 pts), hard_failure (≥15 pts or invented content).
- **Hard-failure trigger:** unsupported claim with high/medium confidence.
- **Judge protocol:** `JUDGE_PROTOCOL.md` (10 categories, per-claim evidence, §1–§14).
- **Pass1 vs pass2:** Independent judge reviews of cases with gap ≥10 or hard-failure detected.

---

## Files in This Report

- `BENCHMARK_REPORT.md` (this file)
- `overall.json` (machine-readable summary)
- `scores_by_category.md` & `.json` (per-category breakdown)
- `hallucination_report.md` (detailed deduction analysis)
- `judge_disagreement_report.md` (pass1 vs pass2 findings)
- `technician_review_worksheet.csv` (template for Mike's calibration)
- `calibration_report.md` (template for calibration results, PENDING)
- `README.md` (entry point and methodology)

---

Generated: 2026-07-10T05:36:45.648292
