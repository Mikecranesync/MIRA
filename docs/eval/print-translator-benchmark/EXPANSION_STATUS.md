# Corpus Expansion Status — Print Translator Benchmark

## Current State

| Metric | Count | Target | Progress |
|--------|-------|--------|----------|
| **Total Prints** | 10 | 25 | **40%** |
| **Questions per Print** | 1 | 2 | **50%** (1/2 questions only) |
| **Total Case Count** | 10 | 50 | **20%** (10/50) |
| **OEMs Represented** | 5 | ≥8 | **62%** (ABB, Rockwell, Yaskawa, Siemens, …) |
| **Standards Covered** | 3 | ≥5 | **60%** (IEC 61800, ISO 13849-1, NEMA, …) |

---

## Prints Acquired (N=10)

The following OEM manuals have been sourced and rendered to images:

| Case | OEM | Document | Category | Image Path | Status |
|------|-----|----------|----------|-----------|--------|
| 03 | ABB | Synchronous Motor Starter | Star/Delta | 03.png | ✓ Complete |
| 05 | (Industrial) | Star/Delta Starter Control | Motor Control | 05.png | ✓ Complete |
| 07 | Siemens | SIMATIC CPU 1200 I/O | PLC Module | 07.png | ✓ Complete |
| 09 | Rockwell | Guardmaster 440R Safety Relay | Safety | 09.png | ✓ Complete |
| 13 | Allen-Bradley | PowerFlex 753 Drive | VFD | 13.png | ✓ Complete |
| 14 | Mitsubishi | FR-A840 VFD | VFD | 14.png | ✓ Complete |
| 17 | Schneider | Modular 10 Safety Module | Safety | 17.png | ✓ Complete |
| 18 | ABB | ACS355 Drive Connection | VFD | 18.png | ✓ Complete |
| 20 | (Industrial) | Motor Starter Connectors | Motor Control | 20.png | ✓ Complete |
| 25 | Yaskawa | V1000 VFD Control Wiring | VFD | 25.png | ✓ Complete |

---

## Expansion Bottleneck

**Disk space:** The print-translator-eval-images directory holds large PNG renders (~500KB per image × 10 = 5MB currently). Expanding to 25 prints would require ~12.5MB on disk.

**Mitigation:** Current box has sufficient space. Bottleneck is **time/labor to render and grade** 15 additional cases, not storage.

---

## Next Steps for Expansion

### Phase 1: Source 15 More OEM Prints (Estimated 3–5 days)

1. Identify 15 additional OEM manuals from the corpus_manifest (Siemens, Schneider, Mitsubishi, Fuji, Danfoss, Parker, …).
2. Render high-contrast PNG images (A4 paper, 200 DPI) of relevant pages (wiring/control diagrams, safety interlocks, power flow).
3. Store in `C:\Users\hharp\Downloads\print-translator-eval-images\` with case IDs 26–40.

### Phase 2: Grade Each New Case (Estimated 10 days)

For each of the 15 new cases:
1. Run the translator against the image (Baseline A, image-only mode).
2. Grade the response using `benchmark-judge-v1` (6 categories, hard-failure classification).
3. Store grades in `docs/eval/print-translator-benchmark/grades/NN.primary.json`.
4. Generate pass2 confirmation for any hard-failures.

### Phase 3: Add 15 Follow-Up Questions (Estimated 5 days)

For each of the 10 existing cases + 15 new cases = 25 cases, add a second question:
- **Case N, Question 1:** "Explain this print." (already done for cases 1–10)
- **Case N, Question 2:** Domain-specific follow-up:
  - If motor starter: "Describe the sequence when the start button is pressed and released."
  - If VFD: "Explain the power flow from input to motor output."
  - If safety: "Identify the safety-critical components and their roles."

Run translator on Q2, grade, store in `grades/NN.Q2.primary.json`.

### Phase 4: Baseline B Expansion (Estimated 5 days, post-Phase 3)

Re-run all 50 cases (25 prints × 2 questions) through Baseline B (image + OCR proxy).

---

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| **Baseline A (10 cases)** | 2026-07-10 | ✓ Complete |
| **Baseline B (10 cases)** | 2026-07-10 | ✓ Complete |
| **Calibration Packet** | 2026-07-10 | ✓ Complete (5 cases) |
| **Phase 1: Source 15 prints** | 2026-07-20 | ⏳ In progress |
| **Phase 2: Grade 15 cases** | 2026-08-02 | ⏳ Pending Phase 1 |
| **Phase 3: Add 25×Q2** | 2026-08-07 | ⏳ Pending Phase 2 |
| **Phase 4: Baseline B (50 cases)** | 2026-08-12 | ⏳ Pending Phase 3 |
| **Full corpus ready (50 cases)** | 2026-08-15 | ⏳ Target |

---

## Statistical Power

**Current:** N=10 (1 question each).
- A/B comparisons have low power. Trends (mean +1.2, HF 20%→40%) may not persist on larger corpus.
- Confidence intervals are wide; ±5-point score swings are within margin of error.

**Target:** N=50 (25 prints × 2 questions).
- Larger sample size reduces margin of error.
- Harder-failure rate on 50 cases will be more reliable than 10.
- Category-by-category trends (evidence_grounding regression, sequence_interlocks improvement, etc.) will be more statistically defensible.

---

## Known Limitations

1. **No third baseline (human expert review).** Baseline A (judge) and Baseline B (judge with OCR) are both LLM-based. A human expert review of the same 10 cases would provide a ground-truth third opinion, but is out of scope for this phase.

2. **OCR proxy confound.** Baseline B used cascade-vision-OCR proxy (not production glm-ocr). Production retest is needed.

3. **Single question per print (current).** Adding Q2 (Phase 3) will provide more stress-test coverage but increases grading effort significantly.

4. **No negative controls.** All cases are from OEM manuals (legitimate sources). Testing on intentionally bad/corrupted prints would validate the judge's ability to detect low-quality inputs.

---

## Resource Estimate

| Phase | Effort | Duration | Blocker |
|-------|--------|----------|---------|
| 1 | Low (sourcing + rendering) | 3–5 days | Manual print selection |
| 2 | Medium (grading 15 cases) | 8–10 days | Judge runtime (~30 min/case × 15) |
| 3 | Low (writing Q2s) | 2–3 days | Subject matter expertise |
| 4 | Medium (re-run 50 cases) | 8–12 days | Model availability / OCR proxy |
| **Total** | — | **~25–35 days** | None (sequential) |

---

## Decision Gate

**Before proceeding to Phase 1, confirm:**

- [ ] Baseline A/B findings are accepted (no re-grading Baseline A).
- [ ] OCR path proof is verified (production glm-ocr integration documented).
- [ ] Calibration packet is ready for technician review (5 cases, scorecards blank).
- [ ] Expansion roadmap is approved (target 25 prints → 50 cases by 2026-08-15).

Once confirmed, Phase 1 work (sourcing 15 prints) can proceed in parallel with technician calibration.

