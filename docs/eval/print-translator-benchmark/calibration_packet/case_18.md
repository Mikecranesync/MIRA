# Calibration Case 18: ACS355 Drive Connection Diagram

## Document Metadata

| Field | Value |
|-------|-------|
| **OEM** | ABB |
| **Document** | ACS355 Drive User Manual (EN_ACS355_UM_E_A5) |
| **Source URL** | library.e.abb.com/public/805f31a82d524d8aa8a750011e2cd001/EN_ACS355_UM_E_A5.pdf |
| **Page** | 50 |
| **Category** | VFD (Variable Frequency Drive) |
| **Standard** | IEC 61800-5-1 |

## Image Reference

**Path:** `C:\Users\hharp\Downloads\print-translator-eval-images\18.png`

## Question Posed

*Explain this print.*

## Baseline A Response (Candidate)

```
## 1. What this appears to be
This appears to be a connection diagram for connecting power cables to a drive and motor system.

## 2. Main visible components
The main visible components are:
* A drive with input and output connections
* A motor
* Grounding points (PE)
* Power supply lines (L1/L, L2/N, L3/-)
* Brake resistor connections (BRK+, BRK-)

## 3. Plain-English theory of operation
The drive appears to be connected to a motor with three-phase power lines (U1, V1, W1). The drive has input connections for power (L1/L, L2/N, L3/-) and output connections for the motor (U2, V2, W2). There are also connections for a brake resistor (BRK+, BRK-). The diagram shows grounding points (PE) for the drive and motor.

## 4. What must be true for it to work
For the system to work, the following conditions must be met:
* Proper connections between the drive, motor, and power supply
* Correct grounding of the drive and motor (PE connections)
* Optional brake resistor connected correctly (if used)

## 5. What would stop it from working
The system would not work if:
* Power supply connections are incorrect or missing
* Grounding connections (PE) are not properly made
* Brake resistor connections are incorrect or missing (if used)
* Motor connections (U1, V1, W1) are incorrect or loose

## 6. Unclear or unreadable items
Nothing major appears to be unreadable in the provided image.
```

## Claude Grade Summary

| Metric | Score |
|--------|-------|
| **Total Score** | 88/100 |
| **Hard Failure** | No |

### Category Scores
- Classification & Answerability: 10/10
- Component Label Recognition: 14/20 (−6 for omissions)
- Power & Control Flow: 18/20 (−2 for incomplete BRK+/BRK− description)
- Sequence & Interlocks Logic: 20/20
- Evidence Grounding: 18/20 (−2 for U1/V1/W1 terminology confusion)
- Technician Usefulness: 8/10 (−2 for omitting safety disconnection info)

### Top 3 Deductions

1. **Missing supply disconnecting device (−3 points, material severity)**
   - The diagram shows manual disconnect/switch symbols below each INPUT terminal (U1/L, V1/N, W1) and below BRK+/BRK−, tied to footnote 5.
   - The response never mentions the disconnect symbols or footnote 5 reference.
   - **Correction:** Note that the customer-supplied supply disconnecting device (switch symbols) is shown upstream of each input terminal, referenced by footnote 5, and the padlock icon marks a lockable disconnect point.

2. **Missing footnote callouts and alternative connections (−3 points, minor severity)**
   - The diagram includes numbered footnotes (1)–7) governing cable-shield grounding, safety disconnection, phase information, and alternative BRK+/BRK− uses.
   - The response omits all footnote references and the 'Optional brake resistor or Common DC' text box.
   - **Correction:** Mention that BRK+/BRK− can alternatively be wired for a Common DC bus per the labeled box, not only a brake resistor.

3. **Incomplete BRK+/BRK− description (−2 points, minor severity)**
   - The diagram's own label under BRK+/BRK− reads "Optional brake resistor or Common DC" (with footnote 3 referencing the Common DC application guide).
   - The response describes them only as brake-resistor terminals, omitting the Common DC alternative.
   - **Correction:** State that BRK+/BRK− can serve either an optional brake resistor or a Common DC bus connection.

## Technician Scorecard

**This section is left blank for technician review. Please mark your assessment:**

```
[ ] Accept (matches the print and provides clear, actionable guidance)
[ ] Modify (response is mostly correct but needs clarification on: _______________)
[ ] Reject (response contains fundamental errors or omissions)

Technician Total Score:  _____ / 100

Technician Hard Failure (Y/N): _____

Technician Notes:
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

## Instructions for Review

1. **Compare the candidate response to the actual print** (image 18.png).
2. **Verify the three deductions above** — do you agree that the disconnect symbols, footnotes, and BRK+/BRK− alternative uses are visible and material?
3. **Score the response** as a technician would: would you trust this explanation when wiring the drive?
4. **Mark hard failure** if you believe the response would actively mislead a technician or omit critical safety information (e.g., the disconnect device).
5. **Leave notes** on any additional issues or praise for correctness.

---

## Notes for Calibration

- **Baseline A (image-only):** No OCR text was available for this case. The judge acknowledged this in the context notes and did not penalize the response for missing fine text details it could not possibly have OCR'd.
- **Strength:** The response correctly identifies the main functional elements (three-phase input, drive output, motor, brake/Common DC option, grounding).
- **Weakness:** Omits practical safety features (disconnecting device, footnote safety warnings) that would be critical to a technician's wiring checklist.
- **Overall:** A strong response that covers the major functional flow but misses secondary but operationally important details. Score 88/100 reflects "good but not complete."

