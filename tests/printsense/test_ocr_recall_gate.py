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

Floors are calibrated evidence, not guesses (measured - 0.10 per the plan).
CALIBRATED 2026-07-19 from the first real tesseract runs (CI run 29667433659
measured 0.00 at native render scale — the fixture pages' PIL default font is
unreadable to Tesseract at 1x; the bench now upscales 4x, see
``ocr_recall_bench._OCR_SCALE``): iec_contactor_control measured 0.75 → floor
0.65; estop_safety_chain measured 0.50 → floor 0.40 (persistent misses are the
hyphen-leading device tags and A1). Per-case floors, so a regression on the
stronger case can't hide under a single weakest-case constant. The
``ocr-recall-gate`` job runs pytest with ``-s`` so the ``print()`` below lands
in the CI log for future recalibration.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")  # printsense/__init__.py imports printsense.models

from printsense.xref_extractor import OcrUnavailable  # noqa: E402

# Calibrated (measured - 0.10) from the first real CI tesseract run at 4x
# render scale; see module docstring. Raise-only on recalibration.
RECALL_FLOORS = {
    "iec_contactor_control": 0.65,  # measured 0.75 (6/8; misses -91/K01, A1)
    "estop_safety_chain": 0.40,  # measured 0.50 (3/6; misses -93/S01, -93/K02, A1)
}

# The same two golden_corpus cases ocr_recall_bench.py iterates by default —
# see that module's docstring for the case-selection rationale.
_CASE_IDS = list(RECALL_FLOORS)


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
    assert r["recall"] >= RECALL_FLOORS[case_id], f"OCR recall regressed for {case_id}: {r}"
