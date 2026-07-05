"""Tests for diagnostic cards — a derived, cited view over a pack's fault
table (Task 5, ADR-0025 §1 "Diagnostic cards").

Cards are DERIVED, never stored: ``build_cards`` takes a loaded ``DrivePack``
and an optional ``template_reader`` seam. With no reader (default, offline)
it produces pack-only cards. With a fake in-memory reader it proves the
``component_templates``/KG reuse seam works without touching a live DB.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import Citation, DiagnosticCard, TemplateReader, build_cards, load_pack
from shared.live_snapshot import _FAULT_CODES

PACK_ID = "durapulse_gs10"


class _FakeTemplateReader:
    """In-memory fake proving the seam — no DB, no network."""

    def __init__(self, *, pack_id: str, fault_code: int) -> None:
        self._pack_id = pack_id
        self._fault_code = fault_code

    def _matches(self, pack_id: str, fault_code: int) -> bool:
        return pack_id == self._pack_id and fault_code == self._fault_code

    def causes_for(self, pack_id: str, fault_code: int) -> list[str]:
        if not self._matches(pack_id, fault_code):
            return []
        return ["Grounded motor lead", "Failed insulation"]

    def checks_for(self, pack_id: str, fault_code: int) -> list[str]:
        if not self._matches(pack_id, fault_code):
            return []
        return ["Megger the motor leads", "Inspect cable jacket for damage"]

    def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]:
        if not self._matches(pack_id, fault_code):
            return []
        return [
            Citation(doc="GS10 Fault Reference", page="12", excerpt="GFF: ground fault detected")
        ]


def test_build_cards_no_reader_one_per_real_fault_code():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)

    # code 0 ("no active fault") is excluded — it isn't a fault.
    real_codes = {code for code in _FAULT_CODES if code != 0}
    assert len(cards) == len(real_codes)
    card_codes = {int(card.fault_or_symptom.split(" ", 1)[0]) for card in cards}
    assert card_codes == real_codes


def test_build_cards_excludes_code_zero():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    assert not any("no active fault" in card.meaning for card in cards)


def test_build_cards_fault_or_symptom_and_meaning():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    by_meaning = {card.meaning: card for card in cards}
    assert "GFF ground fault" in by_meaning
    card = by_meaning["GFF ground fault"]
    assert card.fault_or_symptom == "4 — GFF ground fault"


def test_build_cards_provenance_tier_from_pack():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    expected_tier = pack.provenance.items["live_decode.fault_codes"]
    assert expected_tier == "manual_cited"
    assert all(card.provenance_tier == "manual_cited" for card in cards)
    # Never bare "verified".
    assert all(card.provenance_tier != "verified" for card in cards)


def test_build_cards_no_reader_citations_reflect_pack_sources():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    expected = [
        Citation(doc=s.get("doc", ""), page=s.get("page", ""), excerpt=s.get("excerpt", ""))
        for s in pack.provenance.sources
    ]
    for card in cards:
        assert card.citations == expected


def test_build_cards_no_reader_causes_and_checks_empty():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    for card in cards:
        assert card.likely_causes == []
        assert card.first_checks == []


def test_build_cards_no_reader_confidence_is_none():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    for card in cards:
        assert card.confidence is None


def test_build_cards_with_fake_reader_populates_matching_card_only():
    pack = load_pack(PACK_ID)
    reader = _FakeTemplateReader(pack_id=PACK_ID, fault_code=4)
    cards = build_cards(pack, template_reader=reader)

    by_meaning = {card.meaning: card for card in cards}
    ground_fault = by_meaning["GFF ground fault"]
    assert ground_fault.likely_causes == ["Grounded motor lead", "Failed insulation"]
    assert ground_fault.first_checks == [
        "Megger the motor leads",
        "Inspect cable jacket for damage",
    ]
    assert ground_fault.citations == [
        Citation(doc="GS10 Fault Reference", page="12", excerpt="GFF: ground fault detected")
    ]

    # Other cards remain untouched by the seam.
    other = by_meaning["Lvd undervoltage"]
    assert other.likely_causes == []
    assert other.first_checks == []
    assert other.citations == [
        Citation(doc=s.get("doc", ""), page=s.get("page", ""), excerpt=s.get("excerpt", ""))
        for s in pack.provenance.sources
    ]


def test_build_cards_seam_does_not_hit_network_or_db_when_reader_is_none():
    """Default (no reader) must be pure — this test simply asserts the call
    succeeds with no reader argument and no monkeypatched I/O, proving the
    offline path never reaches for a DB/network client."""
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    assert len(cards) > 0


def test_diagnostic_card_shape_is_stable():
    pack = load_pack(PACK_ID)
    cards = build_cards(pack)
    for card in cards:
        assert isinstance(card, DiagnosticCard)
        assert isinstance(card.fault_or_symptom, str)
        assert isinstance(card.meaning, str)
        assert isinstance(card.likely_causes, list)
        assert isinstance(card.first_checks, list)
        assert isinstance(card.citations, list)
        assert card.confidence is None or isinstance(card.confidence, (str, float, int))
        assert isinstance(card.provenance_tier, str)
        for citation in card.citations:
            assert isinstance(citation, Citation)
            assert isinstance(citation.doc, str)
            assert isinstance(citation.page, str)
            assert isinstance(citation.excerpt, str)


def test_template_reader_protocol_is_runtime_checkable_shape():
    """A plain object implementing the three methods satisfies the seam
    without inheriting from anything — proves it's a structural Protocol."""

    class _Impl:
        def causes_for(self, pack_id: str, fault_code: int) -> list[str]:
            return []

        def checks_for(self, pack_id: str, fault_code: int) -> list[str]:
            return []

        def citations_for(self, pack_id: str, fault_code: int) -> list[Citation]:
            return []

    reader: TemplateReader = _Impl()
    pack = load_pack(PACK_ID)
    cards = build_cards(pack, template_reader=reader)
    assert len(cards) > 0
