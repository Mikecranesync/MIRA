"""Tests for the structured, surface-agnostic ``DriveDiagnostic`` object
(``shared.live_snapshot.build_drive_diagnostic``).

Both existing DriveSense surfaces -- the engine's ``render_machine_evidence``
and Ignition's ``assess_from_paths`` -- compose the SAME deterministic
assessment + active-fault card. This suite proves the new object is the single
source of truth both surfaces build from (a behavior-preserving refactor, not
a new feature): a structured payload for a GOOD fault, the STALE-suppression
gate, the unmapped/no-fault/empty cases, that both surfaces render identical
card text from the object, that it stays offline, and that it is frozen.
"""

from __future__ import annotations

import dataclasses
import socket
import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from shared.drive_packs import DiagnosticCard  # noqa: E402
from shared.live_snapshot import (  # noqa: E402
    DriveDiagnostic,
    _render_fault_card,
    assess_from_paths,
    build_drive_diagnostic,
    normalize,
    render_machine_evidence,
)

BASE = "enterprise.garage.line1.conveyor1"
TS = "2026-07-05T00:00:00Z"


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


# ---------------------------------------------------------------------------
# 1. Builds a structured object for a GOOD fault
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_good_fault():
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 4, "vfd_comm_ok": True}))

    assert isinstance(diag, DriveDiagnostic)
    assert diag.assessment is not None
    assert "Active VFD fault" in diag.assessment

    assert isinstance(diag.fault_card, DiagnosticCard)
    assert diag.fault_card.likely_causes
    assert diag.fault_card.first_checks
    assert diag.fault_card.citations
    assert "Ground fault detected" in "; ".join(diag.fault_card.likely_causes)


# ---------------------------------------------------------------------------
# 2. STALE fault -> fault_card is None
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_stale_fault_suppresses_card():
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 4, "vfd_comm_ok": False}))

    assert diag.fault_card is None
    assert diag.assessment is not None
    assert "comms are LOST" in diag.assessment


# ---------------------------------------------------------------------------
# 3. Unknown/unmapped fault -> fault_card None, assessment present
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_unmapped_fault_no_card():
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 999, "vfd_comm_ok": True}))

    assert diag.fault_card is None
    assert diag.assessment is not None
    assert "Active VFD fault" in diag.assessment


# ---------------------------------------------------------------------------
# 4. No active fault -> fault_card None (healthy-but-stopped)
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_no_active_fault_no_card():
    diag = build_drive_diagnostic(
        _snaps({"vfd_fault_code": 0, "vfd_comm_ok": True, "vfd_cmd_word": 1})
    )

    assert diag.fault_card is None
    assert diag.assessment is not None


# ---------------------------------------------------------------------------
# 5. Empty snapshots -> assessment None + fault_card None
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_empty_snapshots():
    diag = build_drive_diagnostic([])

    assert diag.assessment is None
    assert diag.fault_card is None


# ---------------------------------------------------------------------------
# 6. The object is the single source of truth for both surfaces
# ---------------------------------------------------------------------------


def test_object_fault_card_text_is_substring_of_both_surfaces():
    snaps = _snaps({"vfd_fault_code": 4, "vfd_comm_ok": True})
    diag = build_drive_diagnostic(snaps)
    assert diag.fault_card is not None
    card_text = _render_fault_card(diag.fault_card)

    engine_text = render_machine_evidence(snaps)
    ignition_text = assess_from_paths(
        _merge(_ign("vfd_fault_code", "4"), _ign("vfd_comm_ok", "true"))
    )

    assert card_text in engine_text
    assert card_text in ignition_text


# ---------------------------------------------------------------------------
# 7. No DB/socket
# ---------------------------------------------------------------------------


def test_build_drive_diagnostic_survives_socket_blocked(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("socket.socket must never be called on this path")

    monkeypatch.setattr(socket, "socket", _boom)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 4, "vfd_comm_ok": True}))
    assert diag.fault_card is not None
    assert diag.assessment is not None


# ---------------------------------------------------------------------------
# 8. Frozen/immutable
# ---------------------------------------------------------------------------


def test_drive_diagnostic_is_frozen_dataclass():
    assert dataclasses.is_dataclass(DriveDiagnostic)

    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 4, "vfd_comm_ok": True}))
    with pytest.raises(dataclasses.FrozenInstanceError):
        diag.assessment = "tampered"
