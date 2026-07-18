"""OCR recall bench -- Tesseract vs golden-corpus ground truth ($0, deterministic).

The Phase-1 golden corpus (``printsense.benchmarks.golden_corpus``) knows
exactly which token strings are printed on each synthetic case's page.
Recall = |found| / |expected|, where a token counts as "found" if its exact
text (whitespace-normalized, uppercased) appears among
``line_items(ocr_tokens(png))`` for that case's rendered page. Used to (a)
sanity-check the Tesseract floor against known truth, and (b) gate CI so a
Tesseract/render/config regression can never ship silently — see
``tests/printsense/test_ocr_recall_gate.py``.

Fixture note (binding amendment, 2026-07-18): the OCR-regime-repair plan
(``docs/plans/2026-07-18-ocr-regime-repair.md``, Task B1) specifies
``printsense.benchmarks.persistent_qa_fixture`` as the ground-truth source.
That module exists only on an unmerged sibling branch. This bench uses the
GOLDEN CORPUS instead (``printsense.benchmarks.golden_corpus.CASES``, already
merged and truth-frozen) rendered through the PUBLIC
``printsense.benchmarks.single_photo_cases.draw_print_page``. Both fixture
shapes carry the same ``{"text", "bbox", "line"}`` token contract, so the
``recall()`` interface below is unchanged from the plan.
``single_photo_cases.py`` / ``golden_corpus.py`` are never-calibrate guarded
files (import-only, never edited) per the plan's Global Constraints.

Case selection: of golden_corpus's 14 cases, ``iec_contactor_control`` (8
tokens: a hyphen+slash device tag ``-91/K01``, two coil terminals ``A1``/
``A2``, two NO-contact terminals ``13``/``14``, and a resolved cross-sheet
anchor split across three tokens ``92.1`` / ``/`` / ``K911``) and
``estop_safety_chain`` (6 tokens: two hyphen+slash device tags ``-93/S01``/
``-93/K02``, two NC-contact terminals ``21``/``22``, two coil terminals
``A1``/``A2``) are the two richest, most token-dense SINGLE, stable pages in
the corpus (excluding the prose-heavy ``cross_sheet_von_nach`` case, the
deliberately-empty ``unreadable_page`` case, and the 1-2 token trivial cases
like ``cable_continuation``/``terminal_plan``). They stress exactly the token
shapes ``line_items`` must recover for the print-QA pipeline to work: hyphen+
slash device designations, bare 2-digit contact numbers, and a lone
punctuation token ("/"). Both are deterministic — the same PNG renders every
run, so recall is reproducible across CI runs (modulo Tesseract version
drift, which is what this gate exists to catch).

Known calibration risk (documented, not fixed -- the fixture is guarded):
``iec_contactor_control``'s "92.1 / K911" line renders with real glyph
extents of ~20px / ~5px / ~24px at x=1200 / x=1262 / x=1272 under PIL's
default font (measured locally) -- only a ~5px gap between the "/" and
"K911" glyphs. This may suppress recall on that specific line if Tesseract
merges or misreads the boundary. That is a property of the frozen fixture
render, not a bug in this bench; if the first CI run shows this case
dragging recall down, calibrate the floor from the measured number rather
than reworking the case (the never-calibrate guard covers the fixture, not
this bench's floor constant).
"""

from __future__ import annotations

import argparse
import sys

# The two cases this bench iterates by default -- see the case-selection
# rationale in the module docstring above.
DEFAULT_CASE_IDS = ["iec_contactor_control", "estop_safety_chain"]


def _norm(s: str) -> str:
    return " ".join(s.split()).upper()


def recall(base: dict, psm: int | None = None) -> dict:
    """Tesseract recall of one golden-corpus case's expected tokens.

    ``base`` is a case dict from ``golden_corpus.CASES`` (has a ``tokens``
    key: a list of ``{"text", "bbox", "line"}`` dicts). Renders the case's
    page, OCRs it, and reports how many of the case's expected token texts
    Tesseract actually recovered (whitespace-normalized, uppercased exact
    match against ``line_items(ocr_tokens(...))``).

    Raises ``printsense.xref_extractor.OcrUnavailable`` when Tesseract is not
    available in this environment (missing binary/library) -- callers decide
    whether to skip (tests) or exit with a clear message (the CLI below).

    ``psm`` is accepted for forward compatibility with a future PSM sweep but
    is NOT wired through to ``ocr_tokens`` today: that adapter has no ``psm``
    parameter, and the plan says add one only once a sweep -- run in a
    tesseract-capable environment -- shows >= 0.1 recall spread. This
    machine cannot run tesseract at all, so no sweep has been run; per the
    plan's YAGNI guidance the parameter is accepted-and-ignored here, not the
    adapter touched speculatively.
    """
    from printsense.benchmarks.single_photo_cases import draw_print_page
    from printsense.xref_extractor import line_items, ocr_tokens

    png = draw_print_page(base)
    tokens = ocr_tokens(png)
    found_set = {_norm(t) for t in line_items(tokens)}
    expected = [t["text"] for t in base["tokens"]]
    missing = [t for t in expected if _norm(t) not in found_set]
    return {
        "expected": len(expected),
        "found": len(expected) - len(missing),
        "recall": (len(expected) - len(missing)) / max(1, len(expected)),
        "missing": missing,
    }


def _case_by_id(case_id: str) -> dict:
    from printsense.benchmarks.golden_corpus import CASES

    for c in CASES:
        if c["case_id"] == case_id:
            return c
    raise KeyError(f"no golden_corpus case with case_id={case_id!r}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="OCR recall bench: Tesseract vs golden-corpus ground truth."
    )
    ap.add_argument(
        "--psm",
        type=int,
        default=None,
        help="reserved for a future PSM sweep; not wired to ocr_tokens yet (see module docstring)",
    )
    ap.add_argument(
        "--case",
        dest="case_id",
        default=None,
        help=f"golden_corpus case_id to bench (default: iterate {DEFAULT_CASE_IDS})",
    )
    args = ap.parse_args()

    if args.psm is not None:
        print("psm sweep requires tesseract environment; parameter reserved")

    from printsense.xref_extractor import OcrUnavailable

    case_ids = [args.case_id] if args.case_id else DEFAULT_CASE_IDS
    total_found = 0
    total_expected = 0
    for case_id in case_ids:
        base = _case_by_id(case_id)
        try:
            r = recall(base)
        except OcrUnavailable as exc:
            print(f"tesseract unavailable: {exc}")
            return 3
        total_found += r["found"]
        total_expected += r["expected"]
        print(
            f"case={case_id} recall={r['recall']:.2f} "
            f"({r['found']}/{r['expected']}) missing={r['missing']}"
        )

    overall = total_found / max(1, total_expected)
    print(f"overall recall={overall:.2f} ({total_found}/{total_expected})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
