"""The flagship answer card is complete, grounded, and cites only real receipts."""
from __future__ import annotations

import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1]
if str(DEMO) not in sys.path:
    sys.path.insert(0, str(DEMO))

import conv_simple_demo as demo  # noqa: E402

MANIFEST = demo.load_manifest()
CARD = demo.build_answer_card(demo.FLAGSHIP, MANIFEST)
RENDERED = demo.render_card(CARD)


def test_card_has_all_nine_sections():
    for label in (
        "Most likely cause",
        "Confidence",
        "Why MIRA thinks that",
        "Evidence for",
        "Evidence against",
        "Manuals / procedures used",
        "Similar history",
        "Technician checks",
        "Human review needed",
    ):
        assert label in RENDERED, f"missing section: {label}"


def test_most_likely_cause_is_the_photoeye():
    assert "photoeye" in CARD.most_likely_cause.lower()
    assert CARD.confidence == "High"


def test_evidence_for_and_against_are_grounded_in_real_tags():
    joined_for = " ".join(CARD.evidence_for).lower()
    assert "di05_photoeye" in joined_for or "photoeye pe-101" in joined_for
    joined_against = " ".join(CARD.evidence_against).lower()
    assert "no gs10 fault" in joined_against  # rules out the VFD
    assert CARD.evidence_against, "must show evidence against alternatives"


def test_manuals_used_are_real_receipts_from_the_manifest():
    manifest_ids = {e["id"] for e in MANIFEST["evidence"]}
    assert CARD.manuals_used, "the card must cite manuals"
    for m in CARD.manuals_used:
        assert m["id"] in manifest_ids, f"invented receipt: {m['id']}"
        assert m["source"], m
    # at least the GS10 manual (rule-out) and the photoeye procedure are cited
    cited = {m["id"] for m in CARD.manuals_used}
    assert "gs10_user_manual" in cited
    assert "photoeye_notes" in cited


def test_human_review_flags_the_unknown_photoeye_model():
    joined = " ".join(CARD.human_review)
    assert "UNKNOWN_MODEL" in joined


def test_does_not_invent_a_photoeye_manufacturer():
    # the card may say PE-101 (the tag/role) but must NOT assert a fabricated manufacturer/model as fact
    for fake in ("omron e3z", "banner", "sick ", "keyence"):
        assert fake not in RENDERED.lower(), f"card asserts an unverified sensor maker: {fake}"


def test_card_is_deterministic():
    a = demo.render_card(demo.build_answer_card(demo.FLAGSHIP, MANIFEST))
    b = demo.render_card(demo.build_answer_card(demo.FLAGSHIP, MANIFEST))
    assert a == b
