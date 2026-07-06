"""The FIRST real GS10 schema_version 2 pack fixture — CE10 <-> P09.03 (PR C).

Hand-curated, manual-cited content for the communication-timeout
troubleshooting path: ``P09.03`` ("COM1 Time-out Detection") is the
parameter that governs how long the drive tolerates a lost RS-485 Modbus
master before declaring fault ``CE10``. Every fact asserted here traces to
the DURApulse GS10 AC Drive User Manual (1st Ed., Rev B) — see the evidence
pack this fixture was authored from. Nothing here is invented.

The fixture lives under ``mira-bots/tests/fixtures/drive_packs/`` — NOT under
the shipped ``mira-bots/shared/drive_packs/packs/`` — precisely so it never
enters the provable-read-only "pack.json is pure v1 data" gate
(``test_drive_packs_readonly.py::test_pack_json_is_pure_data``), which scans
only the shipped packs directory and does not (yet) know about the v2
``parameters``/``keypad_navigation`` keys.

Data + tests only: no schema/loader/runtime edits, no new surfaces, no
keypad card wired into any diagnosis path.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

from shared.drive_packs import Citation, KeypadNavigationCard, ParameterCard, load_pack  # noqa: E402
from shared.drive_packs.loader import _parse_pack  # noqa: E402

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "drive_packs" / "gs10_v2_pack.json"

_MANUAL_DOC = "DURApulse GS10 AC Drive User Manual (1st Ed., Rev B)"


def _load_fixture_pack():
    raw = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))
    return _parse_pack(raw, "durapulse_gs10", str(_FIXTURE_PATH))


# ── fixture loads as a v2 pack ───────────────────────────────────────────────


def test_fixture_loads_as_schema_version_2():
    pack = _load_fixture_pack()
    assert pack.schema_version == 2
    assert pack.pack_id == "durapulse_gs10"
    # v1 substance carried over from the real shipped pack is intact.
    assert pack.live_decode.fault_codes[58] == "CE10 modbus timeout"


# ── ParameterCard P09.03 — every field per the evidence pack ────────────────


def test_p0903_parameter_card_fields():
    pack = _load_fixture_pack()
    assert len(pack.parameters) == 1
    p = pack.parameters[0]

    assert isinstance(p, ParameterCard)
    assert p.drive_family == "durapulse_gs10"  # injected from pack_id, not repeated in JSON
    assert p.parameter_id == "P09.03"
    assert p.name == "COM1 Time-out Detection"
    assert p.range == "00–1000 sec"  # en dash, verbatim from the manual
    assert p.default == "00"
    assert p.unit == "sec"
    assert "CE10" in p.related_faults
    assert p.provenance_tier == "manual_cited"
    assert p.value_meanings == []  # manual documents a continuous value, not an enum table


def test_p0903_citation_is_real_manual_page():
    pack = _load_fixture_pack()
    citation = pack.parameters[0].source_citation
    assert isinstance(citation, Citation)
    assert citation.doc == _MANUAL_DOC
    assert citation.page == "4-188"
    assert "CE10" in citation.excerpt
    assert "P09.03" in citation.excerpt


# ── KeypadNavigationCard — viewing P09.03 on the built-in keypad ────────────


def test_p0903_keypad_navigation_card_fields():
    pack = _load_fixture_pack()
    assert len(pack.keypad_navigation) == 1
    k = pack.keypad_navigation[0]

    assert isinstance(k, KeypadNavigationCard)
    assert k.drive_family == "durapulse_gs10"
    assert k.parameter_id == "P09.03"
    assert k.menu_group == "P09 Communication Parameters"
    assert len(k.keypad_steps) >= 4
    assert k.provenance_tier == "manual_cited"
    # the safety contract: a non-empty view-only warning is mandatory.
    assert k.view_only_warning
    assert "VIEW" in k.view_only_warning
    assert k.edit_warning is None  # beta ships VIEW-only


def test_p0903_keypad_citation_is_real_manual_page():
    pack = _load_fixture_pack()
    citation = pack.keypad_navigation[0].source_citation
    assert isinstance(citation, Citation)
    assert citation.doc == _MANUAL_DOC
    assert citation.page == "3-6"
    assert "Parameter Setting Instructions" in citation.excerpt


# ── v1 compat re-check (PR B covers the mechanics; this is a light re-assert) ─


def test_shipped_v1_pack_still_loads_unaffected():
    pack = load_pack("durapulse_gs10")
    assert pack.schema_version == 1
    assert pack.parameters == []
    assert pack.keypad_navigation == []
