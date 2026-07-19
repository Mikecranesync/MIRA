"""Messy-caption routing lane (owner direction 2026-07-17): realistic,
often-terrible technician English must route to the print path; small talk
must not. The corpus is frozen like every other Phase-2 truth file."""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

from printsense.benchmarks import messy_captions as mc  # noqa: E402
from shared.print_translator import is_print_question  # noqa: E402


def test_corpus_frozen():
    committed = (REPO / "printsense/benchmarks/messy_captions.sha256").read_text().strip()
    assert committed == mc.messy_digest(), (
        "messy-caption corpus edited without refreezing — deliberate two-file diff only"
    )


def test_every_messy_variant_routes():
    r = mc.routing_report(is_print_question)
    assert r["misses"] == [], f"messy captions no longer route: {r['misses']}"
    assert r["recall"] == 1.0


def test_negative_controls_do_not_route():
    r = mc.routing_report(is_print_question)
    assert r["false_routes"] == [], f"non-questions falsely route: {r['false_routes']}"


def test_variants_map_to_real_phase2_cases():
    from printsense.benchmarks import single_photo_cases as spc

    known = set(spc.case_ids())
    parents = {v["parent"] for v in mc.VARIANTS}
    assert parents <= known, f"unknown parent case ids: {parents - known}"


def test_plausible_false_positive_captions_still_rejected():
    """Precision spot-checks beyond the frozen negatives."""
    for caption in (
        "what time u open",  # question word, zero print context
        "thanks bud",
        "call me when your free",
        "ordered the new belt",
    ):
        assert not is_print_question(caption), caption


def test_equipment_identification_stays_with_nameplate_flow():
    """'what drive is this?' belongs to the nameplate->drive-pack path; print
    context (a tag / print word) rescues it back to the print path."""
    for caption in ("what drive is this?", "what model is this", "what vfd is this??"):
        assert not is_print_question(caption), caption
    for caption in ("what drive feeds this circuit", "what drive is -91/K01"):
        assert is_print_question(caption), caption
