# MIRA Print Translator Benchmark — Seed Baseline Results

## What This Is

A **10-case seed baseline** evaluation of the MIRA print translator's ability to analyze electrical wiring diagrams and answer technician questions about their operation and troubleshooting. Graded using the protocol in `JUDGE_PROTOCOL.md`, with hardcopy results in `grades/<case_id>.primary.json` and evidence in `evidence/<case_id>.json`.

## Headline Results

- **Mean quality score:** 65.4 / 100
- **Hard-failure rate:** 20% (2 cases with invented components, both image-only)
- **Classifier improvement:** 10% → 100% trigger rate (PR #2608)
- **Authoritativeness:** SEED BASELINE only — expand to ≥25 cases before product decisions

## Files in This Package

### Reports (Start Here)

1. **`BENCHMARK_REPORT.md`** — Executive summary with score distribution, pass-threshold table, before/after PR #2608, and interpretation
2. **`overall.json`** — Machine-readable summary (statistics, confidence, escalations)
3. **`scores_by_category.md` / `.json`** — Breakdown by circuit type (VFD, PLC I/O, safety, motor control)
4. **`hallucination_report.md`** — Detailed inventory of every deduction, with emphasis on the 2 hard-failure hallucinations (image-only, invented tags)
5. **`judge_disagreement_report.md`** — Pass1 vs pass2 escalation findings (both hard-failures confirmed, no technician-review escalations)
6. **`technician_review_worksheet.csv`** — Blank template for Mike's calibration sample (≥5–10 cases, AUTO fields + BLANK columns for Mike's scores)
7. **`calibration_report.md`** — Template for calibration results; PENDING completion

### Reference

- **`JUDGE_PROTOCOL.md`** — Full grading methodology (10 categories, per-claim evidence, §1–§14, acceptance checklist)
- **`SCHEMA.md`** — Input spec (case structure, evidence shape, print formats)
- **`grade_schema.json`** — Output JSON schema for grades
- **`grades/<case_id>.primary.json`** — Individual case grades (10 cases: 03, 05, 07, 09, 13, 14, 17, 18, 20, 25)
- **`grades/<case_id>.pass2.json`** — Escalation re-grades for cases 05 and 20 (independent judge)
- **`evidence/<case_id>.json`** — Provenance: OEM, standard, question, image path
- **`evidence/<case_id>.meta.json`** — Metadata: date, model version, OCR status
- **`before_after_classifier.json`** — Classifier trigger counts before and after PR #2608

### Images

Print images are stored in the Downloads folder (not in the repo). Load them by reference in `evidence/<case_id>.json`'s `image_path` field.

---

## Quick Start

1. **Read `BENCHMARK_REPORT.md`** for the headline numbers.
2. **Skim `scores_by_category.md`** to understand performance by circuit type.
3. **Open `hallucination_report.md`** to see what went wrong (and why: all hard-failures were image-only, no OCR).
4. **Review `technician_review_worksheet.csv`** to see which cases Mike needs to calibrate.
5. **After Mike's calibration:** Compare his scores to the benchmark in `calibration_report.md` to validate the grading method.

---

## Key Findings

### The Good

- **100% classification success:** All 10 cases were successfully classified as electrical prints (or answerable as such) by the post-PR #2608 classifier.
- **Mean 65.4 / 100:** Upper-mid range for a seed baseline; suggests the model is competent at the task but needs refinement.
- **8/10 high confidence:** The grading logic is aligned and non-fragile; low refusal rate (0%) and high answerability (100%).

### The Bad

- **20% hard-failures:** Both cases involved image-only input (no OCR) and invented component tags (control transformer, K1/K2 as separate devices, XC00/XC90 connectors).
- **Image-only hallucination risk:** All deductions concentrated in cases without OCR text extraction. With OCR, model grounds on actual labels.
- **Seed baseline, not authoritative:** 10 cases is below the spec's 25-case minimum. Expand via LIVE_TELEGRAM_RUNBOOK before any product go/no-go decision.

---

## Acceptance Checklist (§14, Spec 2.2)

- [ ] Mike calibration: ≥5–10 representative cases reviewed and scored (10–20% of seed).
- [ ] Agreement: ≥80% of calibration cases within ±5 points of benchmark.
- [ ] Category coverage: At least one VFD, one PLC I/O, one safety, one motor control calibrated.
- [ ] Hard-failure validation: Both cases 05 and 20 confirmed as hard-failures by technician.
- [ ] Hallucination pattern confirmed: All hard-failures image-only, OCR-degraded mode.
- [ ] Classifier stability: 10%→100% trigger rate confirmed via independent rerun.

**Current status:** All but Mike's calibration complete. PENDING.

---

## Next Steps

1. **Calibration:** Mike reviews 5–10 cases from the worksheet; records scores in `calibration_report.md`.
2. **Expansion:** Deliberate corpus selection or LIVE_TELEGRAM_RUNBOOK to reach ≥25 cases.
3. **If OCR available:** Re-run pass1 on all 10 cases with OCR to quantify image-only risk.
4. **Prompt improvement:** Document any refinements (e.g., guard-rails for image-only, OCR-required gates) and re-run full benchmark to measure delta.

---

## Schema & Methodology

- **Grade schema:** See `grade_schema.json` (case_id, category_scores, total, deductions, hard_failure, overall_confidence, …)
- **Judge protocol:** `JUDGE_PROTOCOL.md` (6 categories × 10 points each, per-claim evidence, severity tiers)
- **Deduction severities:**
  - **minor:** 0–5 points (missed detail, incomplete explanation)
  - **material:** 5–15 points (significant gap, misunderstanding)
  - **hard_failure:** ≥15 points OR invented/unsupported claim with high/medium confidence
- **Hard-failure = no-pass:** A response with one or more hard-failure deductions cannot be acceptable to a technician, regardless of mean score.

---

## Glossary

| Term | Definition |
|------|-----------|
| **seed baseline** | ≤10 initial cases; non-authoritative until Mike calibrates + ≥25-case expansion |
| **hard-failure** | Response asserts a claim unsupported by evidence (hallucination) with high/medium confidence; or ≥15-point deduction |
| **image-only** | Print provided as image, OCR text not extracted; model grounds on visual shapes alone |
| **OCR-degraded** | Image-only mode; model hallucinates plausible component labels when it lacks actual text to anchor on |
| **pass2** | Independent re-grade of a case due to pass1 gap ≥10 or hard-failure (PR #2599+) |
| **calibration** | Expert technician (Mike) independently scores a sample; used to validate the benchmark judge's grading method |
| **categorization** | Each print categorized by circuit type (VFD, PLC I/O, safety, motor control, etc.) |

---

## Links & References

- **MIRA repository:** https://github.com/Mikecranesync/MIRA
- **Spec & methodology:** `docs/eval/print-translator-benchmark/JUDGE_PROTOCOL.md` (§1–§14)
- **Runbook (to expand):** `docs/runbooks/print-translator-live-telegram-runbook.md`
- **Benchmark folder:** `docs/eval/print-translator-benchmark/`

---

Generated: {datetime.now().isoformat()}
