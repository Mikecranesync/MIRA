# Baseline A vs Baseline B: OCR Grounding Impact Analysis

## Executive Summary

OCR integration via cascade-vision-OCR proxy produced **minimal mean improvement** (+1.2 points) but **doubled the hard-failure rate** (20% → 40%), with mixed results: OCR eliminated 2 pure freelance fabrications but introduced error propagation and confident-wrong assignments.

## Per-Case Results

| Case | A | B | Delta | A Hard-Fail | B Hard-Fail | A→B Transition |
|------|---|---|-------|------------|------------|-----------------|
| 03 | 59 | 38 | −21 | ✗ | ✓ | CLEAN → HF (reversed star/delta) |
| 05 | 31 | 44 | +13 | ✓ | ✓ | HF → HF (K1/K2 mislabel persists) |
| 07 | 60 | 73 | +13 | ✗ | ✗ | CLEAN → CLEAN (gain +13) |
| 09 | 78 | 79 | +1 | ✗ | ✗ | CLEAN → CLEAN (stable) |
| 13 | 82 | 89 | +7 | ✗ | ✗ | CLEAN → CLEAN (gain +7) |
| 14 | 85 | 78 | −7 | ✗ | ✗ | CLEAN → CLEAN (regression −7) |
| 17 | 63 | 58 | −5 | ✗ | ✓ | CLEAN → HF (invented "Safety PLC") |
| 18 | 88 | 85 | −3 | ✗ | ✗ | CLEAN → CLEAN (stable) |
| 20 | 42 | 63 | +21 | ✓ | ✓ | HF → HF (XC00 eliminated, XC90 hallucinated) |
| 25 | 66 | 59 | −7 | ✗ | ✗ | CLEAN → CLEAN (regression −7) |

## Aggregate Scores

| Metric | Baseline A | Baseline B | Change |
|--------|-----------|-----------|--------|
| **Mean** | 65.4 | 66.6 | +1.2 (1.8%) |
| **Median** | 64.5 | 68.0 | +3.5 |
| **Std Dev** | 17.4 | 16.8 | −0.6 |
| **Hard-Failure Count** | 2/10 (20%) | 4/10 (40%) | **+2 NEW HF** |
| **Min** | 31 | 38 | +7 floor |

## Per-Category Analysis

### Component Label Recognition
- **A avg**: 8.1
- **B avg**: 7.9
- **Trend**: −0.2 (neutral)
- **Note**: OCR did not significantly improve identification of visible labels; cases that missed component lists in A still struggle in B.

### Sequence/Interlocks Logic
- **A avg**: 6.2
- **B avg**: 6.8
- **Trend**: +0.6
- **Note**: Modest improvement; OCR text occasionally helped clarify timing relationships (e.g., case 07 +13).

### Evidence Grounding
- **A avg**: 8.9
- **B avg**: 7.5
- **Trend**: −1.4 (REGRESSION)
- **Note**: OCR grounding **decreased** confidence that claims are supported. Two new "hard-failure" classifications driven by grounded-but-confident-wrong readings (cases 03, 17).

### Power/Control Flow
- **A avg**: 10.3
- **B avg**: 9.8
- **Trend**: −0.5
- **Note**: Stable; no systematic directional pressure from OCR.

### Technician Usefulness
- **A avg**: 6.2
- **B avg**: 6.1
- **Trend**: −0.1
- **Note**: Functionally identical; neither A nor B consistently produces actionable advice.

## Hallucination Inventory

### Eliminated by B (OCR gave real text to anchor on)
- **Case 05 (A)**: "control transformer supplies control power" → Baseline A freely invented the device; OCR labels "C.T. = current transformers" prevented the same fabrication in B.
- **Case 20 (A)**: "connector XC00" → Baseline A hallucinated; OCR labels showed only XC45/46/47/60/25A/25B.

### New/Persisted Errors Introduced by B
- **Case 03 (B)**: Reversed star/delta contactor assignment (KM2↔KM3). NOT an OCR artifact — the Y/Δ/L labels ARE legible in OCR; the model simply read them backwards, then stated the reversed assignment with confidence.
- **Case 17 (B)**: Invented "Safety PLC" as a component. OCR did not help prevent confident-wrong naming; the real component likely has a simpler label.
- **Case 05 (B)**: K1/K2 mislabeling persisted (claimed separate coils, actually wire-numbers on a single coil). OCR present but didn't disambiguate.

### Error Propagation (OCR proxy quality issue)
- **Case 20 (B primary)**: OCR proxy returned "XC90" (unverified). Model repeated it verbatim in the response. When benchmarked against the real print, only XC45/46/47/60/25A/25B existed.
  - **Caveat**: Cascade-vision-OCR proxy is NOT production `glm-ocr`. The hallucinated "XC90" label may reflect proxy quality rather than production glm-OCR behavior. Needs retest against production `glm-ocr` in a staging/compose environment.

## Confident-Wrong Assignments

These are NOT pure fabrications (OCR might have returned *something*), but high-confidence assertions of the wrong meaning:

| Case | Assertion | Reality | Root Cause |
|------|-----------|---------|-----------|
| 03 | KM1/KM2 delta, KM3 star | Y/Δ/L labels show KM2=star, KM3=delta, KM1=line | Model inverted a legible label |
| 17 | "Safety PLC" component | Likely "Safety Module" or simpler device name | OCR couldn't prevent semantic hallucination |
| 05 | K1/K2 are separate contactor coils | K1/K2 are wire-numbers on CR coil's own leads | Structural misunderstanding, not OCR-fixable |

## Decision

**OCR grounding does NOT reliably reduce hallucinations.** The mechanism is threefold:

1. **Pure fabrication (favorable):** OCR text anchors the response when the model would otherwise invent. Cases 05, 20 saw real text provided, eliminating device inventions.

2. **Error propagation (unfavorable):** OCR proxy (non-production) returned `"XC90"` where none existed. Model believed it and included it verbatim. Whether production `glm-ocr` exhibits the same proxy-quality issue is unknown.

3. **Confident-wrong assignment (unfavorable, OCR-independent):** Even when OCR text is present (case 03: Y/Δ/L labels ARE readable in cascade-vision-OCR), the model can read it and state the OPPOSITE with confidence. Cases 03, 17, 05 hard-failures are structural misunderstandings, not gaps OCR can close.

## Recommendation

**Build a SMALLEST deterministic evidence-binding guard** that prevents the translator from asserting specific identifiers (component names, connectors, part numbers) as facts without visible, legible support. This guard:

- Flags assertions like "XC90" against the set of legible tokens extracted by OCR.
- Prevents confident-wrong readings like "KM1 and KM2 are delta" when Y/Δ labels are legible (requires semantic understanding of "opposite" pairings, beyond scope of this iteration).
- Remains EXPERIMENTAL; do NOT optimize the prompt against the judge.
- Do NOT deploy to production.

OCR proxy caveat: Baseline B used cascade-vision-OCR proxy (production `glm-ocr` unreachable from this box). The error-propagation case (20: XC90) is confounded by proxy quality. Staging/compose retest against production `glm-ocr` is needed to validate whether the propagation pattern holds in production.

## Honest Caveats

- Baseline B corpus is 10 cases (1 question each). Statistical power is low; ±1.2-point mean differences may not persist on larger corpus.
- The hard-failure *increase* (20% → 40%) is real on this set but based on N=10. Need ≥25 cases before claiming a reliable trend.
- Corpus is still expanding; these are initial-stage results.
