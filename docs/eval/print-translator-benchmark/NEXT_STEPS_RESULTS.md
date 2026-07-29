# Next Steps Results — Print Translator Benchmark Deliverables

## Acceptance Checklist

The following 8 deliverable items have been completed and are ready for review:

### 1. Baseline A Immutability Checkpoint
- [x] **File:** `BASELINE_A_FROZEN.md`
- [x] **SHA256 checksums:** All Baseline A files verified (`BASELINE_A.sha256`).
- [x] **Immutability commitment:** Baseline A will not be regenerated or re-graded.
- [x] **Non-retroactive:** Baseline B is isolated in separate directory; no cross-contamination risk.

**Status: FROZEN ✓**

---

### 2. OCR Path Proof — Objective Evidence
- [x] **File:** `OCR_PATH_PROOF.md`
- [x] **Code trace:** Production `glm-ocr` integration documented end-to-end (Telegram bot → vision worker → theory prompt).
- [x] **File locations:** All files and line numbers cited (bot.py:943, vision_worker.py:203, print_translator.py:130–133).
- [x] **Fallback documented:** Error handling specified (line 212: empty OCR if unreachable).
- [x] **Caveat stated:** Baseline B used cascade-vision-OCR proxy (non-production). Production retest needed in staging/compose.

**Status: PROVEN ✓**

---

### 3. Baseline B Identical Inputs Verification
- [x] **Same 10 cases:** Baseline B uses the exact same print images and questions as Baseline A.
- [x] **Same judge:** Same `benchmark-judge-v1` grading protocol.
- [x] **Isolated OCR:** Only difference is the addition of OCR text (via cascade-vision-OCR proxy in Baseline B).
- [x] **No prompt tuning:** Prompt was not optimized against the judge; OCR simply added raw text.

**Status: VERIFIED ✓**

---

### 4. A/B Comparison Isolates OCR Variable
- [x] **File:** `baseline_b/reports/ab_comparison.md` + `.json`
- [x] **Per-case deltas:** All 10 cases compared (A score vs B score, delta, hard-failure status).
- [x] **Aggregate metrics:** Mean 65.4 → 66.6 (+1.2), median 64.5 → 68.0 (+3.5), HF rate 20% → 40% (+2 new).
- [x] **Category analysis:** Per-category averages (component_label_recognition, sequence_interlocks_logic, evidence_grounding, etc.).
- [x] **Hallucination inventory:** Eliminated (control transformer, XC00), persisted (K1/K2), and new (XC90, "Safety PLC").
- [x] **Decision:** OCR does NOT reliably reduce hallucinations. Confident-wrong assignments and error propagation remain.
- [x] **Honest caveat:** Baseline B used proxy OCR. Production glm-ocr retest needed.

**Status: REPORTED ✓**

---

### 5. Hard-Failure Judge Disagreement Report
- [x] **File:** `baseline_b/reports/judge_disagreement_report.md`
- [x] **4 hard-failure cases documented:**
  - Case 03: Reversed star/delta (primary 38, pass2 40, gap 2 points) — VERIFIED
  - Case 05: K1/K2 mislabel (primary 44) — Consistent with A-confirmed hard-failure
  - Case 17: Invented "Safety PLC" (primary 58, pass2 58, gap 0) — UNANIMOUS
  - Case 20: XC90 propagation (primary 63) — Provisional (OCR proxy caveat)
- [x] **No escalations:** All gaps < 15 points. Pass2 confirmations align.

**Status: VERIFIED ✓**

---

### 6. Regression Fixtures — Four Known Hallucinations
- [x] **File:** `regression_fixtures/known_hallucinations.json`
- [x] **Schema:** Case ID, baseline, severity, hallucinated claim, correct reading, visible evidence, error type, guard target.
- [x] **Four cases:**
  - 05: K1/K2 structural misunderstanding (A+B)
  - 05_a: Control transformer fabrication (A-only, eliminated by OCR in B)
  - 20: XC00 fabrication (A-only)
  - 20_b: XC90 propagation error (B, from OCR proxy)
- [x] **Test file:** `test_known_hallucinations.py`
  - Four @pytest.mark.skip tests (guard not yet built)
  - Test bodies assert what guard MUST flag
  - Runnable once evidence_binding_guard() exists

**Status: FIXTURES READY ✓**

---

### 7. Calibration Packet — Five Distinct Cases
- [x] **Directory:** `calibration_packet/`
- [x] **Case selection:** 18 (strongest A=88), 09 (high A=78), 25 (median A=66), 05 (hard-fail A=31), 20 (hard-fail A=42)
- [x] **Case files:**
  - `case_18.md` — ACS355 VFD connection (88/100, minor omissions)
  - `case_09.md` — Guardmaster 440R safety relay (78/100, LOGIC selector omitted)
  - `case_25.md` — Yaskawa V1000 VFD (66/100, incomplete sequence)
  - `case_05.md` — Star/Delta starter (31/100, hard failure: fabricated + structural misunderstanding)
  - `case_20.md` — Motor starter connectors (42/100, hard failure: hallucinated XC00/XC90)
- [x] **Structure per case:**
  - Document metadata (OEM, source URL, page, standard)
  - Image path for technician review
  - Baseline A candidate response (full text)
  - Claude grade summary (categories, deductions, hard-failure details)
  - Blank technician scorecard (accept/modify/reject, score, notes)
- [x] **README:** `calibration_packet/README.md` — scoring guidance, persona selection, time estimate, deliverables expected
- [x] **Blank scorecards:** Technician review fields left empty for independent assessment

**Status: READY ✓**

---

### 8. No Production Changes, No Deployment, No Prompt Optimization
- [x] **No code changes:** No edits to translator, engine, or OCR integration.
- [x] **No prompt optimization:** No tweaks to the theory-generation prompt against the benchmark judge.
- [x] **Experimental only:** Baseline B results are data-gathering only; no promotion to production.
- [x] **No deployment gate:** Baseline B does not control any live system behavior.
- [x] **Evidence-binding guard:** Proposed future guard is HYPOTHETICAL; not built, not tested, not deployed.

**Status: CONTAINED ✓**

---

## Headline Results

### Baseline A (Image-Only)
- **Mean:** 65.4/100 | **Median:** 64.5 | **Hard Failures:** 2/10 (20%)
- **Strength:** Core component identification, basic power/control flow
- **Weakness:** Omits secondary details, auxiliary contact numbering, safety interlock specifics

### Baseline B (Image + OCR Proxy)
- **Mean:** 66.6/100 | **Median:** 68.0 | **Hard Failures:** 4/10 (40%)**
- **Improvement:** +1.2 mean (+1.8%), +3.5 median (+5.4%)
- **Cost:** Hard-failure rate DOUBLED (20% → 40%)
- **Finding:** OCR eliminated 2 pure fabrications (control transformer, XC00) but introduced 2 NEW hard-failures (reversed star/delta, invented "Safety PLC") and 1 error-propagation case (XC90).

### Decision
**OCR grounding does NOT reliably reduce hallucinations.** Build a smallest deterministic evidence-binding guard that flags unsupported device/connector/part-number claims without visible text support. Guard must be:
- **Experimental** (not optimized against judge)
- **Non-deployed** (no production use yet)
- **Deterministic** (no LLM-based semantic checks; regex/token-set rules only)

### Caveat
**Baseline B used cascade-vision-OCR proxy, NOT production `glm-ocr`.** The error-propagation case (20: XC90) may be proxy-quality artifact. Production behavior unknown. Requires staging/compose retest against production `glm-ocr` before any claims about production OCR impact.

---

## Next-Steps Roadmap

| Phase | Target | Duration | Owner | Blocker |
|-------|--------|----------|-------|---------|
| **Technician Calibration** | 2026-07-24 | 2 weeks | Technician panel | Scorecard returns |
| **Staging OCR Retest** | 2026-08-01 | 1 week | Ops / MCP team | Production glm-ocr access |
| **Evidence Guard Prototype** | 2026-08-15 | 2 weeks | Core team | Guard spec finalized |
| **Corpus Expansion** | 2026-08-30 | 3 weeks | Labeling team | Print sourcing, grading |
| **Production Guard Evaluation** | 2026-09-15 | 2 weeks | Core team | Guard implementation done |

---

## Corpus Expansion Status

- **Current:** 10 prints (1 question each) = 10 cases
- **Target:** 25 prints (2 questions each) = 50 cases
- **Progress:** 10/50 cases (20%)
- **Disk:** 5MB / 12.5MB target (40% full)
- **Blocker:** Time/labor to render + grade 15 additional OEM prints

See `EXPANSION_STATUS.md` for full roadmap and resource estimates.

---

## Acceptance Criteria Summary

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Baseline A frozen | ✓ | BASELINE_A_FROZEN.md + BASELINE_A.sha256 |
| OCR-path documented | ✓ | OCR_PATH_PROOF.md (code trace) |
| Baseline B identical inputs | ✓ | Same 10 cases, same judge, only OCR added |
| A/B comparison isolates OCR | ✓ | ab_comparison.md + ab_comparison.json |
| Hard-failures verified | ✓ | judge_disagreement_report.md (4 cases, no escalations) |
| Regression fixtures ready | ✓ | known_hallucinations.json + test_known_hallucinations.py |
| Calibration packet ready | ✓ | 5 cases, blank scorecards, README |
| No prod/deploy/optimization | ✓ | Baseline B experimental only |

**All 8 items: COMPLETE ✓**

---

## Important Caveats

1. **Low statistical power (N=10).** Trends in this dataset (mean +1.2, HF +20%) may not hold on larger corpus. Need ≥25 cases for confidence.

2. **OCR proxy, not production glm-ocr.** Baseline B results are confounded by cascade-vision-OCR proxy quality. Production behavior is unknown. Staging retest essential.

3. **Technician review is ground truth.** Claude benchmark judge is authoritative for this analysis. Technician calibration review (scorecard) will validate or overturn specific hard-failure classifications.

4. **Evidence guard is hypothetical.** The proposed deterministic guard does not exist. It is a recommendation, not an implementation.

5. **Corpus incomplete.** 10 cases is a starting point. Full 50-case corpus needed for robust conclusions.

---

## Files Delivered

```
docs/eval/print-translator-benchmark/
├── baseline_b/
│   ├── reports/
│   │   ├── ab_comparison.md          ← A/B results
│   │   ├── ab_comparison.json
│   │   └── judge_disagreement_report.md
│   ├── grades/                        (baseline_b grade files)
│   ├── evidence/                      (baseline_b evidence files)
│   └── responses/                     (baseline_b response files)
├── regression_fixtures/
│   ├── known_hallucinations.json     ← 4 known-bad cases
│   └── test_known_hallucinations.py
├── calibration_packet/
│   ├── README.md                     ← Technician instructions
│   ├── case_18.md                    ← 5 calibration cases
│   ├── case_09.md
│   ├── case_25.md
│   ├── case_05.md
│   └── case_20.md
├── OCR_PATH_PROOF.md                 ← Production glm-ocr code trace
├── BASELINE_A_FROZEN.md              ← Immutability declaration
├── EXPANSION_STATUS.md               ← Corpus roadmap
└── NEXT_STEPS_RESULTS.md             ← This file
```

---

## Sign-Off

This benchmark report is complete and ready for:
1. **Technician calibration review** (scorecards blank, ready for return)
2. **Staging OCR retest** (production glm-ocr validation)
3. **Evidence-binding guard design** (hypothetical future work)
4. **Corpus expansion** (15 additional prints, 30 additional cases)

**No further work on Baseline A or B is required.** All artifacts are finalized, immutable, and ready for downstream use.

---

## Questions or Issues

If technician scorecards reveal systematic disagreements, or if the staging OCR retest shows production glm-ocr behaves differently than the proxy:
1. Document findings in a CALIBRATION_FINDINGS.md file (new, separate from this report).
2. Do NOT modify Baseline A or B.
3. Reference this NEXT_STEPS_RESULTS.md as the baseline truth.

