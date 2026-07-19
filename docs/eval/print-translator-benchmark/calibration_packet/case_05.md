# Calibration Case 05: Star/Delta Starter Control Circuit — HARD FAILURE

## Document Metadata

| Field | Value |
|-------|-------|
| **OEM** | (Industrial Starter) |
| **Document** | Star/Delta Starter Control Circuit Diagram |
| **Category** | Motor Control Starters |
| **Standard** | IEC 61800 / NEMA |

## Image Reference

**Path:** `C:\Users\hharp\Downloads\print-translator-eval-images\05.png`

## Question Posed

*Explain this print.*

## Baseline A Response Summary

**HARD FAILURE — Score: 31/100**

The candidate provided a response that included:
- Identification of the three contactors (KM1, KM2, KM3)
- Reference to FR1 thermal relay and KT timer
- **FABRICATED CLAIM:** "A control transformer supplies control power" (eliminated in Baseline B by OCR)
- **STRUCTURAL MISUNDERSTANDING:** "K1/K2 are separate contactor coils energized by CR" (persists in Baseline B)
- Some correct references to the motor and power wiring

**Key Failures:**
- Fabricated device (control transformer) that doesn't appear on the print
- Misunderstood CR coil's wire-number labels as separate coil identifiers
- Incorrect star/delta/line contactor assignments (or unclear)

## Claude Grade Summary

| Metric | Score |
|--------|-------|
| **Total Score** | 31/100 |
| **Hard Failure** | YES |

### Hard Failure Reasons
- Fabricated device identifier ("control transformer")
- Structural misunderstanding of the CR coil wiring (K1/K2 as separate coils vs. wire-numbers)

### Top 3 Deductions

1. **Fabricated "control transformer" device (−6 points, severe)**
   - **Claim:** "A control transformer supplies control power."
   - **Truth:** The print labels "C.T. = current transformers" (not control transformers). There is no control transformer. Control power comes from a separate source.
   - **Evidence:** The legible text on the print clearly states the C.T. purpose and labels.
   - **Baseline B:** This fabrication WAS ELIMINATED because OCR made the C.T. label visible.

2. **K1/K2 structural misunderstanding (−8 points, severe)**
   - **Claim:** "K1/K2 are separate contactor coils energized by CR."
   - **Truth:** K1/K2 are wire-number labels on the CR coil's own leads, not separate coils. There is only ONE coil (CR), with K1 and K2 marking different terminals on that coil.
   - **Evidence:** The diagram clearly shows K1 and K2 as points on a single coil terminal block, not as distinct coil symbols.
   - **Baseline B:** This misunderstanding PERSISTS in Baseline B (score 44), indicating OCR does not resolve structural misunderstandings without semantic guardrails.

3. **Incorrect or omitted component labeling (−5 points, material)**
   - Missing or incorrect assignment of star/delta/line contactors (KM2=star/Y, KM3=delta/Δ, KM1=line/L per visible labels).
   - Omitted auxiliary contact numbering and interlock logic.

## Technician Scorecard

**This section is left blank for technician review. Please mark your assessment:**

```
[ ] Accept (explanation is safe and accurate for troubleshooting)
[ ] Modify (mostly correct but needs clarification on: _______________)
[ ] REJECT — HARD FAILURE (response contains fabricated devices or fundamental misunderstandings that would mislead a technician)

Technician Total Score:  _____ / 100

Technician Hard Failure (Y/N): _____

Technician Notes (REQUIRED for rejection):
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

## Instructions for Review

**IMPORTANT: This is a HARD FAILURE case. Your review will establish whether the hard-failure classification is correct.**

1. **Verify the fabricated "control transformer" claim:**
   - Does the print actually show or reference a "control transformer"?
   - What does the print label the C.T.? (Is it clearly "current transformers"?)
   - Would a technician be misled by this fabrication?

2. **Verify the K1/K2 structural error:**
   - Are K1 and K2 drawn as separate coil symbols, or as wire-number labels on a single coil?
   - Is the misunderstanding clear enough to warrant a hard failure?
   - Would a technician make a wiring error based on this explanation?

3. **Assess overall safety and correctness:**
   - If a technician used this explanation to troubleshoot or commission this starter, would they be at risk?
   - Is the hard-failure classification justified?

4. **Leave detailed notes** explaining your agreement or disagreement with the hard-failure assessment.

---

## Notes for Calibration

- **Baseline A (image-only):** Score 31/100, hard failure due to fabricated device and structural misunderstanding.
- **Baseline B (image + OCR):** Score 44/100, hard failure persists (K1/K2 misunderstanding), but fabricated control transformer is eliminated by OCR.
- **This is a critical benchmark case:** It demonstrates that OCR CAN prevent pure fabrications (the control transformer) but CANNOT prevent structural misunderstandings (K1/K2) without additional semantic guardrails.
- **Risk level:** HIGH — this explanation would actively mislead a technician attempting to troubleshoot or understand the circuit.

