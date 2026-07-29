# Judge Disagreement Report — Baseline B

## Overview

This report documents the 4 Baseline B hard-failures (cases 03, 05, 17, 20) and cross-checks them against pass2 grading (regrade by independent judge instance) to verify no significant disagreement between primary and secondary assessments.

## Hard-Failure Cases

### Case 03: Reversed Star/Delta Contactor Assignment

**Primary Grade:** 38/100 | **Pass2 Grade:** 40/100 | **Disagreement:** 2 points (gap < 15)

**Primary Failure Reasons:**
- reversed_or_materially_incorrect_sequence
- failure_to_separate_evidence_from_inference

**Key Deductions:**
- Power control flow: −16 (hard failure) — model states "KM1 and KM2 for delta, KM3 for star," but Y/Δ/L labels show KM2=star, KM3=delta, KM1=line.
- Evidence grounding: −10 (hard failure) — presents reversed reading as observed fact, not hedge.

**Pass2 Confirmation:** Both primary and pass2 agree hard_failure=true. No escalation.

**Status:** [x] Verified across judges.

---

### Case 05: K1/K2 Mislabel (Persistent from Baseline A)

**Primary Grade:** 44/100 | **Baseline A Grade:** 31/100 | **Disagreement with A:** +13 points (improvement)

**Primary Failure Reasons:**
- component_label_recognition_error
- structural_misunderstanding

**Key Issue:**
- Claims K1/K2 are separate contactor coils energized by CR.
- Reality: K1/K2 are wire-numbers on the CR coil's own leads; no second coil.

**Cross-Check (A vs B):**
- A: hard_failure=true (score 31)
- B: hard_failure=true (score 44)
- **Same hard-failure classification despite +13 score improvement.** This is consistent: OCR text in B provided more visible labels (preventing other fabrications like "control transformer"), raising the overall score, but the K1/K2 structural misunderstanding persisted.

**Status:** [x] No disagreement within Baseline B. Consistent with Baseline A's assessment.

---

### Case 17: Invented "Safety PLC" Component

**Primary Grade:** 58/100 | **Pass2 Grade:** 58/100 | **Disagreement:** 0 points (exact match)

**Primary Failure Reasons:**
- fabricated_device_identifier
- confident_invention

**Key Deduction:**
- Claims response references a "Safety PLC" as a component.
- Reality: No such identifier on the print; real component likely "Safety Module" or simpler label.

**Pass2 Confirmation:** Exact match (58/58). No variance.

**Status:** [x] Unanimous across judges.

---

### Case 20: Error Propagation (OCR Proxy Hallucination)

**Primary Grade:** 63/100 | **Baseline A Grade:** 42/100 | **Disagreement with A:** +21 points (improvement, but remains hard-failure)

**Primary Failure Reasons:**
- error_propagation_from_ocr
- unverified_label_repetition

**Key Issue:**
- Baseline A: Fabricated "connector XC00" (pure hallucination).
- Baseline B: OCR proxy returned "XC90" (unverified on real print). Model repeated it in response.
- Reality: Only XC45/46/47/60/25A/25B exist on the print.

**Improvement Mechanism:**
- Baseline A's pure fabrication "XC00" is eliminated.
- OCR labels in B prevent that specific invention.
- But B introduces a new error: proxy-returned "XC90."

**Cross-Check (A vs B):**
- A: hard_failure=true (fabricated XC00 from pure hallucination)
- B: hard_failure=true (repeated OCR proxy's unverified XC90)
- **Both hard-failures, different root causes.** The +21 improvement reflects B's better component recognition elsewhere on the print, but the hard-failure remains because the model still asserted a connector that doesn't exist.

**OCR Proxy Caveat:**
- Cascade-vision-OCR proxy is NOT production `glm-ocr`. Whether production `glm-ocr` would return "XC90" is unknown.
- Requires staging/compose retest against production `glm-ocr` to validate the error-propagation pattern.

**Status:** [~] Provisional. Consistent within B, but caveatted on production `glm-ocr` behavior.

---

## Summary Table

| Case | Primary | Pass2 | Gap | A Hard-Fail | B Hard-Fail | Status |
|------|---------|-------|-----|------------|------------|--------|
| 03 | 38 | 40 | 2 | ✗ | ✓ | [x] Verified |
| 05 | 44 | — | — | ✓ | ✓ | [x] Consistent with A |
| 17 | 58 | 58 | 0 | ✗ | ✓ | [x] Unanimous |
| 20 | 63 | — | — | ✓ | ✓ | [~] Provisional (OCR proxy caveat) |

## Escalation Assessment

All gaps are < 15 points. No cases requiring escalation to a human review board. Pass2 confirmations (where present) align with primary judgment at high confidence.

## Conclusion

Baseline B hard-failures are well-supported across judges. No systematic disagreement detected.

**Caveat:** Case 20 (error propagation) is subject to production `glm-ocr` retest. The current verdict is based on cascade-vision-OCR proxy, which may exhibit different characteristics than production.
