# Calibration Packet — Print Translator Benchmark

## Overview

This packet contains **5 distinct benchmark cases** spanning the full performance range of Baseline A (image-only mode), selected for technician calibration review. Each case represents a different level of performance and error type.

### Case Selection Rationale

| Case | Baseline A | Baseline B | Selection Reason |
|------|-----------|-----------|------------------|
| **18** | 88/100 ✓ | 85/100 ✓ | Strongest performance; minor omissions of secondary details |
| **09** | 78/100 ✓ | 79/100 ✓ | High performance; systematic omission of one key component (LOGIC selector) |
| **25** | 66/100 ✓ | 59/100 ✓ | Median performance; incomplete control sequence explanation |
| **05** | 31/100 ✗ | 44/100 ✗ | Weakest + hard failure; fabricated device + structural misunderstanding |
| **20** | 42/100 ✗ | 63/100 ✗ | Hard failure both baselines; pure fabrication (A) → error propagation (B) |

## How to Use This Packet

### For Technician Reviewers

1. **Read the document metadata** for each case to understand the source and standard.
2. **Examine the image** at the path provided (e.g., `C:\Users\hharp\Downloads\print-translator-eval-images\18.png`).
3. **Review the candidate response** (the "Baseline A Response" section shows the actual translator output).
4. **Read the Claude grade summary** to understand what was marked as correct, incomplete, or incorrect.
5. **Fill in the Technician Scorecard** with your independent assessment:
   - **Accept:** Response is safe and accurate for the task (wiring, troubleshooting, commissioning, etc.).
   - **Modify:** Response is mostly correct but needs clarification on specific points.
   - **Reject:** Response contains fundamental errors or omissions that would mislead a technician or cause wiring/commissioning errors.
   - **Technician Total Score:** Your independent score (0–100).
   - **Technician Hard Failure (Y/N):** Do YOU agree this is a hard failure?
   - **Technician Notes:** Explain your reasoning, especially for rejections.

### For Calibration Analysis (Post-Review)

After technician reviews are complete:
- Compare technician scores to Claude benchmark scores.
- Identify systematic disagreements (e.g., technicians consistently score higher/lower than the judge).
- Use technician notes to refine the judge's grading criteria for future iterations.
- Identify cases where the technician and judge agree (ground truth validation).

## Scoring Guidance

### Accept (Safe to deploy)
- Response is accurate and complete for the intended use case.
- Minor omissions are acceptable if they don't affect safety or core functionality.
- Technician would confidently use this explanation to wire, troubleshoot, or commission the equipment.
- **Example:** Case 18 (88/100) — correctly identifies all major components and power flow; minor omissions of footnote details don't affect wiring.

### Modify (Needs clarification)
- Response is mostly correct but has gaps or confusing descriptions that need revision.
- Technician might need to refer to the original print for clarification on specific points.
- No fundamental errors; risk is low if technician cross-checks the explanation against the print.
- **Example:** Case 09 (78/100) — correctly explains the safety relay logic but omits the LOGIC dial selector and Y32 monitoring output.

### Reject (Not safe)
- Response contains fabricated device identifiers, incorrect component assignments, or structural misunderstandings.
- Technician following this explanation could make wiring errors, fail to commission equipment, or create safety hazards.
- Hard failures fall into this category.
- **Example:** Case 05 (31/100) — fabricates "control transformer" and misunderstands CR coil wiring (K1/K2 as separate coils).
- **Example:** Case 20 (42/100) — fabricates "connector XC00" which doesn't exist on the print.

## Hard Failure Cases (Pre-marked)

Cases 05 and 20 are **pre-marked as hard failures** by the Claude benchmark judge. Your review serves to:
1. Validate the hard-failure classification (do you agree?).
2. Understand the root cause (fabrication vs. structural misunderstanding vs. error propagation).
3. Assess whether the failure is severe enough to warrant rejection in production.

**Do not feel obligated to agree with the pre-marked classification.** If you believe case 05 or 20 should be "Accept" or "Modify," explain your reasoning in the notes.

## Technician Role Assumption

For all cases, assume you are one of these personas:

- **Electrician/Technician:** Responsible for wiring and commissioning VFDs, starters, and control systems in a factory. You need clear, accurate, unambiguous instructions to avoid wiring errors.
- **Plant Maintenance Engineer:** Responsible for troubleshooting and maintaining these systems. You need explanation that helps you diagnose faults and understand failure modes.
- **Quality Inspector:** Responsible for verifying that wiring matches prints. You need an explanation that helps you audit the print for completeness and correctness.

Choose the persona that best matches the case's use case (e.g., case 18 is a connection diagram → Electrician/Commissioning; case 05 is a star/delta starter → Maintenance Engineer).

## Time Estimate

- **Per case:** 10–15 minutes (read document metadata, examine image, review response, fill scorecard).
- **Full packet:** 50–75 minutes for all 5 cases.

## Deliverables Expected

- **Completed scorecards** for all 5 cases (accept/modify/reject, score, notes).
- **Summary table** comparing technician scores to Claude scores (optional but valuable).
- **Calibration memo** (1–2 pages) highlighting any systematic disagreements or patterns.

---

## Questions?

If an image is unclear, a criterion is ambiguous, or a case doesn't fit the scenarios above, **note it in the scorecard.** Calibration feedback is most valuable when technician reviewers are explicit about their reasoning and any uncertainties.

Thank you for calibrating the Print Translator benchmark.
