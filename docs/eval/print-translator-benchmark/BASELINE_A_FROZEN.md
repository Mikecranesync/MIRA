# Baseline A is Frozen — Immutability Declaration

## Statement

**Baseline A (image-only mode, 10 cases) is now FROZEN and immutable.**

No files, grades, evidence records, or metadata under the `grades/`, `evidence/`, `responses/`, or `reports/` directories shall be modified, regenerated, or overwritten.

---

## Rationale

Baseline A is the canonical reference point for all Baseline B comparisons and regression testing. Any modification to Baseline A would:

1. **Invalidate the A/B comparison:** Delta scores (B−A) would become meaningless if A is retroactively changed.
2. **Break regression fixtures:** The known hallucinations in `regression_fixtures/known_hallucinations.json` reference specific claims from Baseline A cases; changing A invalidates the fixture.
3. **Compromise hard-failure classification:** Hard-failure cases (05, 20) are identified by reference to their Baseline A grades; changing A would require re-grading.
4. **Prevent reproducibility:** Future benchmark expansions assume A is stable; a frozen A enables trust in comparisons across time.

---

## Immutable Artifacts

The following files are FROZEN (protected by `BASELINE_A.sha256`):

### Grade Files
- `grades/03.primary.json` through `grades/25.primary.json` (10 cases)
- `grades/05.pass2.json`, `grades/17.pass2.json` (pass2 confirmations)

### Evidence Files
- `evidence/03.json` through `evidence/25.json` (candidate responses)
- `evidence/03.meta.json` through `evidence/25.meta.json` (metadata)

### Audit Files
- `before_after_classifier.json` (case-level before/after flags)
- `BASELINE_A.sha256` (SHA256 checksums of all above)

### Documentation
- `JUDGE_PROTOCOL.md` (grading criteria used for Baseline A)
- `SCHEMA.md` (data schema for Baseline A grades)

### Reports
- `reports/*.md` files that exist at the time of this freeze

---

## How to Verify Immutability

```bash
# From the benchmark directory:
sha256sum -c BASELINE_A.sha256

# Output: each file should show "OK" if unchanged.
# If any file shows "FAILED", Baseline A has been modified.
```

If any file fails the check:
1. **Stop immediately.** Do not proceed.
2. **Escalate:** Report to the project lead (Mike).
3. **Investigate:** Determine how and when the modification occurred.
4. **Restore:** Use the frozen checkpoint to restore Baseline A.

---

## Future Development (Baseline B and Beyond)

- **Baseline B** (image + OCR) has its own separate directory (`baseline_b/`) with independent grade/evidence/report files. Baseline B may evolve; Baseline A will not.
- **Baseline C** (if needed) would follow the same pattern: new directory, independent artifact set.
- **Regression fixtures** (`regression_fixtures/`) reference Baseline A and B; if they are updated, the fixtures must be re-validated against the current grading.

---

## Non-Regeneration Pledge

This freeze is a commitment: **Baseline A will not be regenerated, re-graded, or re-evaluated**, even if:
- New judge versions are available.
- New grading criteria are proposed.
- Inconsistencies are discovered between Baseline A and later grades.

**Baseline A is ground truth as of the freeze date.** Future calibration happens via technician review (calibration_packet/), not by re-running Baseline A.

---

## Acceptance Checklist

- [x] Baseline A files checksummed and locked (`BASELINE_A.sha256`).
- [x] Baseline A immutability documented (this file).
- [x] Baseline B isolated in separate directory (no risk of cross-contamination).
- [x] Regression fixtures reference Baseline A (frozen) and Baseline B (current).
- [x] Future expansions will not touch Baseline A.

---

## History

| Date | Event | Status |
|------|-------|--------|
| 2026-07-10 | Baseline A finalized at 10 cases (1 question each) | ✓ Frozen |
| 2026-07-10 | Baseline B completed (same 10 cases, with OCR) | Current |
| TBD | Corpus expanded to 25+ cases | Future (will not retro-modify A or B) |

---

## Contact

If you believe Baseline A has been modified or if you discover a hash mismatch:

**Do not regenerate or re-grade. Contact Mike immediately.**

Baseline A immutability is non-negotiable for the integrity of the benchmark.

