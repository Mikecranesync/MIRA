# Print Translator Benchmark — Judge Disagreement & Escalation Report

## Overview

- **Pass2 (escalation) cases:** 2 (cases 05, 20)
- **Escalation trigger:** gap ≥10 points OR hard-failure detected
- **Technician-review queue:** Cases with gap ≥15 AND judge disagreement on hard-failure


## Case 05

### Pass 1 (Initial Grade)
- **Total:** 31/100
- **Confidence:** high
- **Hard-failure:** True
- **Categories:** classification_answerability:7, component_label_recognition:8, power_control_flow:4, sequence_interlocks_logic:6, evidence_grounding_unsupported_claims:3, technician_usefulness_clarity:3

### Pass 2 (Escalation Grade)
- **Total:** 44/100
- **Hard-failure:** True
- **Categories:** classification_answerability:8, component_label_recognition:11, power_control_flow:6, sequence_interlocks_logic:8, evidence_grounding_unsupported_claims:5, technician_usefulness_clarity:6

### Comparison
- **Gap:** 13 points (Pass2 higher)
- **Hard-failure agreement:** ✓ AGREE
- **Disposition:** **No escalation** — gap < 15; judges agree; acceptable variance

## Case 20

### Pass 1 (Initial Grade)
- **Total:** 42/100
- **Confidence:** medium
- **Hard-failure:** True
- **Categories:** classification_answerability:8, component_label_recognition:7, power_control_flow:8, sequence_interlocks_logic:8, evidence_grounding_unsupported_claims:6, technician_usefulness_clarity:5

### Pass 2 (Escalation Grade)
- **Total:** 32/100
- **Hard-failure:** True
- **Categories:** classification_answerability:8, component_label_recognition:6, power_control_flow:7, sequence_interlocks_logic:2, evidence_grounding_unsupported_claims:5, technician_usefulness_clarity:4

### Comparison
- **Gap:** 10 points (Pass1 higher)
- **Hard-failure agreement:** ✓ AGREE
- **Disposition:** **No escalation** — gap < 15; judges agree; acceptable variance

---

## Summary

- **Technician-review escalations:** 0 (no cases exceeded the 15-point threshold AND judge disagreement)
- **Both hard-failures confirmed:** Cases 05 and 20 both show hard-failure in pass1 and pass2, with gaps <15 (acceptable variance)
- **Judge agreement rate:** 100% on hard-failure status (2/2 escalations confirmed as hard-failures by both judges)

---

Generated: 2026-07-10T05:36:45.650776
