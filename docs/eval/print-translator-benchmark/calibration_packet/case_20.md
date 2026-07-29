# Calibration Case 20: Motor Starter Connector Labels — HARD FAILURE (A and B)

## Document Metadata

| Field | Value |
|-------|-------|
| **OEM** | (Industrial Motor Starter) |
| **Document** | Motor Starter Power Distribution Diagram |
| **Category** | Motor Starters |
| **Standard** | IEC 61800 / NEMA |

## Image Reference

**Path:** `C:\Users\hharp\Downloads\print-translator-eval-images\20.png`

## Question Posed

*Explain this print.*

## Baseline A vs Baseline B: Different Hallucinations, Same Hard Failure

### Baseline A Response (Score: 42/100 — Hard Failure)
**Fabricated Claim:** "Connector XC00 is present and provides..." 
- This is a pure hallucination; XC00 does not appear anywhere on the print.
- Only XC45, XC46, XC47, XC60, 25A, and 25B are labeled on the diagram.

### Baseline B Response (Score: 63/100 — Hard Failure)
**Fabricated Claim:** "Connector XC90 is present and..."
- Baseline B eliminates the pure fabrication "XC00" (because OCR labels made real connectors visible).
- But introduces a NEW error: "XC90" (returned by OCR proxy, not on real print).
- Model repeated OCR proxy's unverified label verbatim.
- **CAVEAT:** Cascade-vision-OCR proxy is NOT production `glm-ocr`. Whether production glm-ocr would return "XC90" is unknown. Requires staging/compose retest.

## Claude Grade Summary — Baseline A

| Metric | Score |
|--------|-------|
| **Total Score** | 42/100 |
| **Hard Failure** | YES |

### Hard Failure Reason (Baseline A)
- Fabricated specific connector identifier ("XC00") not present on print

### Top Deduction

**Fabricated Connector XC00 (−10 points, severe)**
- **Claim:** "Connector XC00 is involved in the main power distribution..."
- **Truth:** XC00 does not appear on the print. Real connectors labeled: XC45, XC46, XC47, XC60, 25A, 25B only.
- **Impact:** Technician following this explanation might search for a non-existent connector or misidentify wiring.

## Claude Grade Summary — Baseline B

| Metric | Score |
|--------|-------|
| **Total Score** | 63/100 |
| **Hard Failure** | YES |

### Hard Failure Reason (Baseline B)
- Error propagation: model repeated OCR proxy's unverified "XC90" label

### Key Observation

**Baseline B shows an improvement (+21 points) due to better component recognition elsewhere on the print, but remains hard-failure because of the hallucinated XC90.**

This is the canonical error-propagation case: OCR returned data the model believed and repeated, creating a NEW fabrication that looks like evidence-grounded (because it came from OCR) but is factually wrong.

## Technician Scorecard

**This section is left blank for technician review. Please mark your assessment:**

```
[ ] Accept (connector identifications are accurate for wiring)
[ ] Modify (mostly correct but needs clarification on: _______________)
[ ] REJECT — HARD FAILURE (response fabricates or propagates incorrect connector identifiers)

Technician Total Score:  _____ / 100

Technician Hard Failure (Y/N): _____

Technician Notes (REQUIRED for rejection):
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

## Instructions for Review

**IMPORTANT: This is a HARD FAILURE case in BOTH baselines. Your review will establish the severity and the root cause of the error.**

1. **Verify the actual connectors on the print:**
   - What connector identifiers are ACTUALLY labeled on the diagram?
   - Is XC00 present? (Baseline A claims it is.)
   - Is XC90 present? (Baseline B claims it is.)
   - Are there any other connectors that might be misread as XC00/XC90?

2. **Assess the impact of the error:**
   - If a technician followed this explanation to wire the circuit, would they fail to connect the right connectors?
   - Is the error severe enough to warrant a hard-failure classification?

3. **Evaluate the root cause:**
   - **Baseline A:** Pure model hallucination (no OCR provided real text).
   - **Baseline B:** Error propagation from OCR (proxy returned an unverified label; model repeated it).
   - Is one root cause more concerning than the other?

4. **Consider the OCR proxy caveat:**
   - Baseline B used cascade-vision-OCR proxy, not production `glm-ocr`.
   - The XC90 error might be proxy-quality-specific.
   - Do you think production `glm-ocr` would exhibit the same behavior?

5. **Leave detailed notes** on the hard-failure classification and root cause.

---

## Notes for Calibration

- **Baseline A (image-only):** Score 42/100, hard failure. Pure fabrication of "XC00" connector. No OCR to anchor the response.
- **Baseline B (image + OCR proxy):** Score 63/100, hard failure. Fabrication of "XC90" (introduced by OCR proxy). Real connectors are now visible (XC45/46/47/60/25A/25B), showing that OCR did help with component recognition overall (+21 score improvement), but model still hallucinated a connector.
- **This is a critical benchmark case for OCR impact:** It shows both the benefit (real connectors now visible, other components recognized) and the risk (model propagates unverified OCR labels without validation).
- **Risk level:** HIGH — technicians relying on this explanation would be unable to identify the correct connector and would fail to complete the wiring correctly.
- **Regression fixture:** Both the pure fabrication (XC00, Baseline A) and the propagation error (XC90, Baseline B) are in `regression_fixtures/known_hallucinations.json` and should be flagged by a future `evidence_binding_guard()` function.

