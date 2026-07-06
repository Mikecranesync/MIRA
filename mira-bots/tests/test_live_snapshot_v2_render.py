"""Tests for wiring the DriveSense schema-v2 cards (``ParameterCard`` /
``KeypadNavigationCard``) into the diagnostic path (PR D), and the live flip
of the SHIPPED pack to schema_version 2 (PR E).

``build_drive_diagnostic`` populates ``related_parameters``/``keypad_navigation``
from the module-global pack (``shared.live_snapshot._GS10_PACK``). The SHIPPED
``durapulse_gs10`` pack is now schema_version 2 and carries the real,
manual-cited P09.03 parameter + keypad-navigation card related to fault CE10
-- so a GOOD (non-stale) CE10 fault now renders the "Related parameter" and
"Keypad (view-only)" sections on BOTH rendering surfaces
(``render_machine_evidence``, ``assess_from_paths``), with no monkeypatch
needed. That live proof is asserted directly below. The safety properties
(view-only warning always present, no write imperative on a step line, a
STALE/comm-lost fault renders no card at all) are asserted both against the
shipped pack directly and, further down, against the standalone PR C fixture
pack (``tests/fixtures/drive_packs/gs10_v2_pack.json``) via monkeypatch --
kept as an independent regression pin that doesn't depend on whichever pack
happens to be shipped.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

import shared.live_snapshot as ls  # noqa: E402
from shared.drive_packs.loader import _parse_pack  # noqa: E402
from shared.live_snapshot import (  # noqa: E402
    assess_from_paths,
    build_drive_diagnostic,
    normalize,
    render_machine_evidence,
)

BASE = "enterprise.garage.line1.conveyor1"
TS = "2026-07-05T00:00:00Z"

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "drive_packs" / "gs10_v2_pack.json"


def _snaps(raw_tags: dict):
    return normalize(raw_tags, BASE, source="bench", ts=TS)


def _ign(leaf, value):
    """One Ignition-wire snapshot entry: full path + {"value": str} dict."""
    return {f"[default]Mira_Monitored/CV-101/{leaf}": {"value": value}}


def _merge(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


def _load_v2_fixture_pack():
    raw = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))
    return _parse_pack(raw, "durapulse_gs10", str(_FIXTURE_PATH))


# ---------------------------------------------------------------------------
# CE10 confirmation: raw code 58 decodes to the "CE10 modbus timeout" name
# that the fixture's ParameterCard.related_faults matches against.
# ---------------------------------------------------------------------------


def test_fault_58_decodes_to_ce10_modbus_timeout():
    fault = ls._dp(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))["vfd_fault_code"]
    assert fault.value == "CE10 modbus timeout"


# ---------------------------------------------------------------------------
# 1. LIVE PROOF -- shipped pack's build_drive_diagnostic populates the P09.03
#    parameter + keypad card for a GOOD CE10 fault, no monkeypatch needed.
# ---------------------------------------------------------------------------


def test_shipped_pack_build_drive_diagnostic_populates_p0903_live():
    """The shipped ``durapulse_gs10`` pack is now schema_version 2 -- this is
    the flip-live proof: no monkeypatch, just the module-global pack that
    ships in ``mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json``."""
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))

    assert diag.fault_card is not None  # sanity: this IS a GOOD active fault
    assert len(diag.related_parameters) == 1
    assert diag.related_parameters[0].parameter_id == "P09.03"
    assert "CE10" in diag.related_parameters[0].related_faults
    assert diag.keypad_navigation is not None
    assert diag.keypad_navigation.parameter_id == "P09.03"


# ---------------------------------------------------------------------------
# 2. LIVE PROOF -- render_machine_evidence carries the parameter + keypad
#    sections, with the manual citations, for the shipped pack.
# ---------------------------------------------------------------------------


def test_shipped_pack_render_machine_evidence_has_parameter_and_keypad_sections_live():
    snaps = _snaps({"vfd_fault_code": 58, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)

    assert "Related parameter" in text
    assert "Keypad" in text
    assert "P09.03" in text
    assert "COM1 Time-out Detection" in text
    # manual citations for both cards (source_citation.page from the fixture).
    assert "4-188" in text
    assert "3-6" in text
    assert "Source:" in text


def test_shipped_pack_render_machine_evidence_no_fault_and_stale_still_clean():
    """Safety property, kept unchanged: a fault-free or STALE/comm-lost
    reading renders no parameter/keypad card at all, even though the shipped
    pack now carries P09.03/keypad content."""
    no_fault = render_machine_evidence(
        _snaps({"vfd_fault_code": 0, "vfd_comm_ok": True, "vfd_cmd_word": 1})
    )
    stale = render_machine_evidence(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": False}))
    for text in (no_fault, stale):
        assert "Related parameter" not in text
        assert "Keypad" not in text


# ---------------------------------------------------------------------------
# 3. LIVE PROOF -- assess_from_paths (the Ignition-wire surface) carries the
#    same parameter + keypad sections for the shipped pack.
# ---------------------------------------------------------------------------


def test_shipped_pack_assess_from_paths_has_parameter_and_keypad_sections_live():
    text = assess_from_paths(_merge(_ign("vfd_fault_code", "58"), _ign("vfd_comm_ok", "true")))

    assert text is not None
    assert "Related parameter" in text
    assert "Keypad" in text
    assert "P09.03" in text
    assert "COM1 Time-out Detection" in text
    assert "4-188" in text
    assert "3-6" in text
    assert "Source:" in text


# ---------------------------------------------------------------------------
# 4. v2 fixture populates P09.03 for a CE10 fault
# ---------------------------------------------------------------------------


def test_v2_build_drive_diagnostic_populates_p0903(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))

    assert diag.fault_card is not None
    assert len(diag.related_parameters) == 1
    assert diag.related_parameters[0].parameter_id == "P09.03"
    assert diag.keypad_navigation is not None
    assert diag.keypad_navigation.parameter_id == "P09.03"


# ---------------------------------------------------------------------------
# 5. v2 render: parameter + keypad sections appear in both surfaces
# ---------------------------------------------------------------------------


def test_v2_render_machine_evidence_has_parameter_and_keypad_sections(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    snaps = _snaps({"vfd_fault_code": 58, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)

    assert "P09.03" in text
    assert "COM1 Time-out Detection" in text
    assert "Keypad (view-only)" in text


def test_v2_assess_from_paths_has_parameter_and_keypad_sections(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    text = assess_from_paths(_merge(_ign("vfd_fault_code", "58"), _ign("vfd_comm_ok", "true")))

    assert text is not None
    assert "P09.03" in text
    assert "Keypad (view-only)" in text


# ---------------------------------------------------------------------------
# 6. keypad always warns whenever keypad text renders
# ---------------------------------------------------------------------------


def test_v2_keypad_render_always_includes_view_only_warning(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))
    assert diag.keypad_navigation is not None
    rendered = ls._render_keypad_card(diag.keypad_navigation)

    assert rendered  # non-empty: this pack's warning is non-blank
    assert diag.keypad_navigation.view_only_warning in rendered
    assert "View only" in rendered

    # Also present in the full rendered surfaces.
    text = render_machine_evidence(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))
    assert diag.keypad_navigation.view_only_warning in text


# ---------------------------------------------------------------------------
# 7. no write/change/save imperative in the numbered keypad STEP lines
# ---------------------------------------------------------------------------

_WRITE_IMPERATIVE = re.compile(r"\b(save|write|change|set|store|confirm the change)\b", re.I)


def test_v2_keypad_step_lines_carry_no_write_imperative(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))
    assert diag.keypad_navigation is not None
    rendered = ls._render_keypad_card(diag.keypad_navigation)

    # Scope to the numbered step lines only (the warning legitimately says
    # "changes and saves the setting" as a PROHIBITION -- that's fine there,
    # it must not appear on a step line).
    step_lines = [line for line in rendered.splitlines() if re.match(r"^\d+\.\s", line)]
    assert step_lines  # sanity: there ARE numbered steps
    for line in step_lines:
        assert not _WRITE_IMPERATIVE.search(line), f"write imperative found in step: {line!r}"


# ---------------------------------------------------------------------------
# 8. STALE/bad-quality fault -> fault_card None + empty parameters/keypad +
#    no card text, even with the v2 pack monkeypatched.
# ---------------------------------------------------------------------------


def test_v2_stale_fault_suppresses_everything(monkeypatch):
    v2 = _load_v2_fixture_pack()
    monkeypatch.setattr(ls, "_GS10_PACK", v2)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": False}))
    assert diag.fault_card is None
    assert diag.related_parameters == []
    assert diag.keypad_navigation is None

    text = render_machine_evidence(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": False}))
    assert "Fault diagnostic" not in text
    assert "Related parameter" not in text
    assert "Keypad" not in text
    assert "P09.03" not in text

    ign_text = assess_from_paths(_merge(_ign("vfd_fault_code", "58"), _ign("vfd_comm_ok", "false")))
    assert ign_text is not None
    assert "Fault diagnostic" not in ign_text
    assert "Related parameter" not in ign_text
    assert "Keypad" not in ign_text
    assert "P09.03" not in ign_text
