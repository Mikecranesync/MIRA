# Calibration Case 25: Yaskawa V1000 VFD Control Wiring

## Document Metadata

| Field | Value |
|-------|-------|
| **OEM** | Yaskawa |
| **Document** | V1000 VFD Control Wiring (Technical Data WD.V1000.01) |
| **Source URL** | www.yaskawa.com/delegate/getAttachment?documentId=WD.V1000.01&cmd=documents&documentName=WD.V1000.01.pdf |
| **Page** | 1 |
| **Category** | Reversing/Braking |
| **Standard** | IEC 61800 |

## Image Reference

**Path:** `C:\Users\hharp\Downloads\print-translator-eval-images\25.png`

## Question Posed

*Describe the theory of operation.*

## Baseline A Response Summary

The candidate provided a structured explanation covering:
- Single-phase and three-phase power supplies
- Motor with cooling fan
- Optional DC reactor, thermal relay, braking resistor
- Digital inputs (S1–S7) for control
- Analog monitor output
- MEMOBUS/Modbus communication
- Sequence: power → drive → motor; inputs control operation.

**Score: 66/100 | Hard Failure: No**

## Claude Grade Summary

| Metric | Score |
|--------|-------|
| **Total Score** | 66/100 |
| **Hard Failure** | No |

### Category Scores
- Classification & Answerability: 9/10 (−1 minor)
- Component Label Recognition: 11/20 (−9 for misidentified/missing components)
- Power & Control Flow: 13/20 (−7 for missing EMC filter, incorrect brake logic)
- Sequence & Interlocks Logic: 10/20 (−10 for incomplete start/stop sequence)
- Evidence Grounding: 12/20 (−8 for fabricated features)
- Technician Usefulness: 11/20 (−9 for missing critical operation details)

### Key Deductions Summary

- **Missing EMC filter** (−3): Not mentioned despite being visible on the power input side.
- **Incorrect brake logic attribution** (−4): Brake resistor behavior misunderstood.
- **Incomplete digital input sequence** (−6): Missing forward/reverse pushbutton logic and interlock behavior.
- **Fabricated features** (−4): References features not visible on this print (external fault input fabrication).
- **Vague optional component treatment** (−3): Says components "can be installed as needed" without specific circuit conditions.

## Technician Scorecard

**This section is left blank for technician review. Please mark your assessment:**

```
[ ] Accept (theory of operation is clear and complete for commissioning)
[ ] Modify (mostly correct but needs clarification on: _______________)
[ ] Reject (response omits key control logic or contains fundamental errors)

Technician Total Score:  _____ / 100

Technician Hard Failure (Y/N): _____

Technician Notes:
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

## Instructions for Review

1. **Compare the candidate response to the actual print** (image 25.png).
2. **Verify the key deductions:**
   - Is the EMC filter visible and important for this VFD?
   - Are the brake resistor connections accurately described?
   - Is the digital input sequence (S1–S7) complete, especially forward/reverse logic?
   - Are there fabricated features (not on the print) in the response?
3. **Score the response** as a commissioning technician: would you have enough detail to set up this drive?
4. **Mark hard failure** if key control sequences are fundamentally wrong.
5. **Leave notes** on completeness and accuracy.

---

## Notes for Calibration

- **Baseline A (image-only):** No OCR. Candidate identified major functional blocks but missed secondary components and details.
- **Strength:** Correctly identifies the overall power/control architecture and digital input concept.
- **Weakness:** Omits EMC filter, mischaracterizes brake logic, and provides vague treatment of the control sequence. Missing specific interlock and pushbutton logic is a significant gap for a control-wiring explanation.
- **Overall:** A median-range response (66/100) that shows understanding of VFD architecture but lacks the precision needed for detailed commissioning. This is a "competent but incomplete" benchmark case.

