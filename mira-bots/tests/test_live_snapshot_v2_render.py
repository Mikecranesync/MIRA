"""Tests for wiring the DriveSense schema-v2 cards (``ParameterCard`` /
``KeypadNavigationCard``) into the diagnostic path (PR D).

``build_drive_diagnostic`` populates ``related_parameters``/``keypad_navigation``
from the module-global pack (``shared.live_snapshot._GS10_PACK``). For the
SHIPPED v1 pack both blocks are empty, so this is a no-op and both rendering
surfaces (``render_machine_evidence``, ``assess_from_paths``) are
byte-identical to their pre-v2 behavior -- proven here by asserting no
parameter/keypad text appears anywhere in their output. The v2 behavior is
proven separately by monkeypatching the module global with the PR C fixture
pack (``tests/fixtures/drive_packs/gs10_v2_pack.json``), which carries a real,
manual-cited P09.03 parameter + keypad-navigation card related to fault CE10.
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
# 1. v1 render_machine_evidence is byte-identical: no parameter/keypad text
# ---------------------------------------------------------------------------


def test_v1_render_machine_evidence_has_no_parameter_or_keypad_text():
    # NOTE: don't assert "P09.03" is absent here -- the SHIPPED v1 pack's own
    # fault-card enrichment (`shared.drive_fault_intel`, unrelated to the
    # schema-v2 ParameterCard this PR wires in) already cites "P09.03" in its
    # first-checks text for this fault. The section-header markers below are
    # what this PR actually adds, so they're the correct byte-identical proof.
    snaps = _snaps({"vfd_fault_code": 58, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)
    assert "Related parameter" not in text
    assert "Keypad" not in text


def test_v1_render_machine_evidence_no_fault_and_stale_also_clean():
    no_fault = render_machine_evidence(
        _snaps({"vfd_fault_code": 0, "vfd_comm_ok": True, "vfd_cmd_word": 1})
    )
    stale = render_machine_evidence(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": False}))
    for text in (no_fault, stale):
        assert "Related parameter" not in text
        assert "Keypad" not in text


# ---------------------------------------------------------------------------
# 2. v1 assess_from_paths is byte-identical: no parameter/keypad text
# ---------------------------------------------------------------------------


def test_v1_assess_from_paths_has_no_parameter_or_keypad_text():
    # Same caveat as above: the v1 fault card's own text already cites "P09.03".
    text = assess_from_paths(_merge(_ign("vfd_fault_code", "58"), _ign("vfd_comm_ok", "true")))
    assert text is not None
    assert "Related parameter" not in text
    assert "Keypad" not in text


# ---------------------------------------------------------------------------
# 3. v1 build_drive_diagnostic -- empty related_parameters + None keypad
# ---------------------------------------------------------------------------


def test_v1_build_drive_diagnostic_empty_v2_slots():
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 58, "vfd_comm_ok": True}))
    assert diag.fault_card is not None  # sanity: this IS a GOOD active fault
    assert diag.related_parameters == []
    assert diag.keypad_navigation is None


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
