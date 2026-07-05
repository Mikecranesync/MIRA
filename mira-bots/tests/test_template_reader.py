"""Tests for ``FaultCodesTemplateReader`` — the FIRST concrete
``TemplateReader`` (ADR-0025 §1, layer 2; see ``cards.py``'s Protocol).

Backing data is injected at construction (a plain nested mapping) — this
module never touches a DB/network. Fixture values below are drawn from
``mira-core/scripts/seed_fault_codes.py`` GS10_NUMERIC (code 4 = "GFF — ground
fault", code 21 = "oL — overload") with realistic cause/action/citation text
for these tests; a real DB-backed adapter that queries NeonDB's
``fault_codes`` table is a separate, future concern.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.drive_packs import Citation, TemplateReader, build_cards, load_pack
from shared.drive_packs.template_reader import FaultCodeIntel, FaultCodesTemplateReader

PACK_ID = "durapulse_gs10"

GFF_CODE = 4
OVERLOAD_CODE = 21
UNKNOWN_CODE = 999  # not present in the fixture data (and not GS10 code 0)


def _reader() -> FaultCodesTemplateReader:
    return FaultCodesTemplateReader(
        {
            PACK_ID: {
                GFF_CODE: FaultCodeIntel(
                    cause=(
                        "Ground fault detected between a motor lead and earth, or "
                        "insulation breakdown in the motor windings."
                    ),
                    action=(
                        "Megger the motor leads and cable insulation; inspect for "
                        "damage; check drive output wiring for shorts to ground."
                    ),
                    doc="DURApulse GS10 User Manual",
                    page="6-4",
                    excerpt=(
                        "GFF: Ground fault — drive detected a ground fault condition "
                        "at start or during run."
                    ),
                ),
                OVERLOAD_CODE: FaultCodeIntel(
                    cause="Motor or drive load exceeded the overload threshold.",
                    action="Check for mechanical binding; verify motor FLA setting.",
                    doc="DURApulse GS10 User Manual",
                    page="6-9",
                    excerpt="oL: Overload — electronic overload protection tripped.",
                ),
                # Deliberately empty fields — the empty-field guard case.
                58: FaultCodeIntel(cause="", action="", doc="", page="", excerpt=""),
            }
        }
    )


def test_reader_is_structurally_a_template_reader():
    reader = _reader()
    assert isinstance(reader, TemplateReader)


def test_causes_for_known_code_returns_the_cause():
    reader = _reader()
    causes = reader.causes_for(PACK_ID, GFF_CODE)
    assert causes == [
        "Ground fault detected between a motor lead and earth, or insulation "
        "breakdown in the motor windings."
    ]


def test_checks_for_known_code_returns_the_action():
    reader = _reader()
    checks = reader.checks_for(PACK_ID, GFF_CODE)
    assert checks == [
        "Megger the motor leads and cable insulation; inspect for damage; "
        "check drive output wiring for shorts to ground."
    ]


def test_citations_for_known_code_returns_citation_fields():
    reader = _reader()
    citations = reader.citations_for(PACK_ID, GFF_CODE)
    assert citations == [
        Citation(
            doc="DURApulse GS10 User Manual",
            page="6-4",
            excerpt=(
                "GFF: Ground fault — drive detected a ground fault condition at "
                "start or during run."
            ),
        )
    ]


def test_second_known_code_is_independent():
    reader = _reader()
    assert reader.causes_for(PACK_ID, OVERLOAD_CODE) == [
        "Motor or drive load exceeded the overload threshold."
    ]
    assert reader.checks_for(PACK_ID, OVERLOAD_CODE) == [
        "Check for mechanical binding; verify motor FLA setting."
    ]
    assert reader.citations_for(PACK_ID, OVERLOAD_CODE) == [
        Citation(
            doc="DURApulse GS10 User Manual",
            page="6-9",
            excerpt="oL: Overload — electronic overload protection tripped.",
        )
    ]


def test_unknown_fault_code_returns_empty_for_all_three_no_raise():
    reader = _reader()
    assert reader.causes_for(PACK_ID, UNKNOWN_CODE) == []
    assert reader.checks_for(PACK_ID, UNKNOWN_CODE) == []
    assert reader.citations_for(PACK_ID, UNKNOWN_CODE) == []


def test_unknown_pack_id_returns_empty_for_all_three_no_raise():
    reader = _reader()
    assert reader.causes_for("some_other_pack", GFF_CODE) == []
    assert reader.checks_for("some_other_pack", GFF_CODE) == []
    assert reader.citations_for("some_other_pack", GFF_CODE) == []


def test_empty_fields_guard_returns_empty_not_list_of_empty_string():
    reader = _reader()
    assert reader.causes_for(PACK_ID, 58) == []
    assert reader.checks_for(PACK_ID, 58) == []
    assert reader.citations_for(PACK_ID, 58) == []


def test_integration_build_cards_uses_reader_for_known_code_only():
    pack = load_pack(PACK_ID)
    reader = _reader()
    cards = build_cards(pack, template_reader=reader)

    by_code = {int(card.fault_or_symptom.split(" ", 1)[0]): card for card in cards}

    ground_fault = by_code[GFF_CODE]
    assert ground_fault.likely_causes == [
        "Ground fault detected between a motor lead and earth, or insulation "
        "breakdown in the motor windings."
    ]
    assert ground_fault.first_checks == [
        "Megger the motor leads and cable insulation; inspect for damage; "
        "check drive output wiring for shorts to ground."
    ]
    assert ground_fault.citations == [
        Citation(
            doc="DURApulse GS10 User Manual",
            page="6-4",
            excerpt=(
                "GFF: Ground fault — drive detected a ground fault condition at "
                "start or during run."
            ),
        )
    ]

    # A code the reader does NOT know (e.g. 12, "Lvd undervoltage") still
    # falls back to pack-level citations with empty causes/checks.
    unknown_to_reader = by_code[12]
    assert unknown_to_reader.likely_causes == []
    assert unknown_to_reader.first_checks == []
    expected_pack_citations = [
        Citation(doc=s.get("doc", ""), page=s.get("page", ""), excerpt=s.get("excerpt", ""))
        for s in pack.provenance.sources
    ]
    assert unknown_to_reader.citations == expected_pack_citations
