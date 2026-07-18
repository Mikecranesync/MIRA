"""CI gate: Tesseract recall on the golden-corpus fixture must stay >= floor.

Skips (does not fail) where tesseract is unavailable — the dedicated
``ocr-recall-gate`` job in ``.github/workflows/ci.yml`` installs
``tesseract-ocr`` via apt specifically so this test can run for real; every
other CI job (and local Windows dev, per
``docs/plans/2026-07-18-ocr-regime-repair.md`` Global Constraints) has no
tesseract binary and is expected to skip here rather than fail. The existing
"PrintSense interpreter + grader gate" step in the Unit Tests job installs
Pillow but deliberately omits pytesseract (see its comment in ci.yml) — this
file is the one place in CI where a real Tesseract recall regression can be
caught.

RECALL_FLOOR is calibrated evidence, not a guess. Task B1 of the OCR-regime
plan says: set it to (measured - 0.10) at implementation time. This machine
has no tesseract binary at all (confirmed:
``pytesseract.get_tesseract_version()`` raises ``TesseractNotFoundError``), so
no measurement was possible before this file was written — 0.60 is kept as
the documented starting floor from the plan. CALIBRATE UPWARD after the first
CI run: the ``ocr-recall-gate`` job runs pytest with ``-s`` specifically so
the ``print()`` below lands in the CI log for that purpose.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")  # printsense/__init__.py imports printsense.models

from printsense.xref_extractor import OcrUnavailable  # noqa: E402

RECALL_FLOOR = 0.60  # ADJUST at calibration time to (measured - 0.10); see module docstring.

# The same two golden_corpus cases ocr_recall_bench.py iterates by default —
# see that module's docstring for the case-selection rationale.
_CASE_IDS = ["iec_contactor_control", "estop_safety_chain"]


def _case(case_id: str) -> dict:
    from printsense.benchmarks.golden_corpus import CASES

    for c in CASES:
        if c["case_id"] == case_id:
            return c
    raise KeyError(f"no golden_corpus case with case_id={case_id!r}")


@pytest.mark.parametrize("case_id", _CASE_IDS)
def test_fixture_recall_floor(case_id):
    from printsense.benchmarks.ocr_recall_bench import recall

    try:
        r = recall(_case(case_id))
    except OcrUnavailable:
        pytest.skip("tesseract unavailable in this environment")

    # Printed unconditionally (before the assert) so a floor FAILURE still
    # shows the measured number in the log, not just "assert False".
    print(
        f"[ocr-recall] case={case_id} recall={r['recall']:.2f} "
        f"({r['found']}/{r['expected']}) missing={r['missing']}"
    )
    assert r["recall"] >= RECALL_FLOOR, f"OCR recall regressed for {case_id}: {r}"
