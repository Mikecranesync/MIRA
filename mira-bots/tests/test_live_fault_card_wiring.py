"""Tests for the first runtime caller of ``build_cards`` — GS10 fault-card
enrichment wired into ``shared.live_snapshot.render_machine_evidence`` (Drive
Commander follow-up #2).

Before this wiring, ``build_cards`` (``shared/drive_packs/cards.py``) had no
runtime caller — it was only exercised in tests, so a decoded active GS10
fault never surfaced its enriched likely-causes/first-checks/citation in the
engine's ``## Live Machine Evidence`` section. This suite proves:

1. a known GS10 fault enriches the section with a diagnostic card,
2. an unknown/unmapped fault code keeps the existing safe one-line fallback,
3. missing/empty intel fields never produce a bad or empty-content block,
4. the whole path stays offline — no DB/network/socket import or use, and
5. the interim offline intel (``shared.drive_fault_intel``) can't drift from
   the pack's real fault-code table (no phantom codes, full coverage).
"""

from __future__ import annotations

import os
import socket
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import shared.live_snapshot as live_snapshot
from shared.drive_fault_intel import GS10_FAULT_INTEL, build_gs10_template_reader
from shared.drive_packs import build_cards, load_pack
from shared.drive_packs.template_reader import FaultCodeIntel, FaultCodesTemplateReader
from shared.live_snapshot import normalize, render_fault_diagnostic, render_machine_evidence

BASE = "enterprise.garage.line1.conveyor1"
TS = "2026-07-05T00:00:00Z"
PACK_ID = "durapulse_gs10"


def _snaps(raw_tags: dict):
    return normalize(raw_tags, BASE, source="bench", ts=TS)


# ---------------------------------------------------------------------------
# 1. Known GS10 fault enriches the card
# ---------------------------------------------------------------------------


def test_known_fault_enriches_machine_evidence():
    snaps = _snaps({"vfd_fault_code": 4, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)

    assert "### Fault diagnostic:" in text
    assert "Likely causes:" in text
    assert "First checks:" in text
    assert "Source:" in text
    assert "Ground fault detected" in text
    # The one-line assessment must still be present, not replaced.
    assert "Assessment:" in text
    assert "Active VFD fault: GFF ground fault" in text


# ---------------------------------------------------------------------------
# 2. Unknown fault keeps the safe fallback
# ---------------------------------------------------------------------------


def test_unknown_fault_keeps_safe_fallback():
    snaps = _snaps({"vfd_fault_code": 999, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)

    assert "Assessment:" in text
    assert "### Fault diagnostic:" not in text


def test_stale_fault_suppresses_card_but_keeps_comms_lost_caveat():
    # vfd_comm_ok False -> normalize() marks the fault snapshot STALE (last-known,
    # untrusted). The authoritative per-fault card must NOT render; the assessment
    # still leads with the comms-LOST caveat. (vfd_comm_ok is the master trust gate.)
    snaps = _snaps({"vfd_fault_code": 4, "vfd_comm_ok": False})
    text = render_machine_evidence(snaps)

    assert "### Fault diagnostic:" not in text
    assert "Likely causes:" not in text
    assert "comms are LOST" in text


# ---------------------------------------------------------------------------
# 3. Missing/empty fields don't create bad text
# ---------------------------------------------------------------------------


def test_render_fault_diagnostic_empty_for_no_active_fault():
    assert render_fault_diagnostic("no active fault") == ""


def test_render_fault_diagnostic_empty_for_unmapped_name():
    assert render_fault_diagnostic("some unmapped fault name") == ""


def test_empty_intel_fields_yield_no_diagnostic_block(monkeypatch):
    pack = load_pack(PACK_ID)
    reader = FaultCodesTemplateReader(
        {PACK_ID: {4: FaultCodeIntel(cause="", action="", doc="", page="", excerpt="")}}
    )
    cards = build_cards(pack, template_reader=reader)
    by_meaning = {c.meaning: c for c in cards}
    ground_fault = by_meaning["GFF ground fault"]

    # An all-empty intel entry must resolve like "no reader" — empty
    # causes/checks, pack-level citations only, never a stray "Source:" from
    # an empty doc.
    assert ground_fault.likely_causes == []
    assert ground_fault.first_checks == []

    # Swap the module-level card lookup for one whose card has empty
    # causes AND checks, and confirm render_fault_diagnostic stays silent.
    monkeypatch.setattr(
        live_snapshot, "_GS10_CARDS_BY_MEANING", {ground_fault.meaning: ground_fault}
    )
    assert render_fault_diagnostic("GFF ground fault") == ""


# ---------------------------------------------------------------------------
# 4. No DB/network dependency
# ---------------------------------------------------------------------------

_FORBIDDEN_IMPORT_ROOTS = (
    "psycopg",
    "asyncpg",
    "sqlalchemy",
    "httpx",
    "requests",
    "pymodbus",
    "pycomm3",
    "opcua",
    "snap7",
)


def test_offline_path_survives_socket_blocked(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("socket.socket must never be called on this path")

    monkeypatch.setattr(socket, "socket", _boom)

    reader = build_gs10_template_reader()
    assert reader is not None

    snaps = _snaps({"vfd_fault_code": 4, "vfd_comm_ok": True})
    text = render_machine_evidence(snaps)
    assert "### Fault diagnostic:" in text


def test_no_forbidden_imports_in_source():
    root = os.path.join(os.path.dirname(__file__), "..", "shared")
    for rel in ("drive_fault_intel.py", "live_snapshot.py"):
        path = os.path.join(root, rel)
        with open(path, encoding="utf-8") as f:
            source = f.read()
        for forbidden in _FORBIDDEN_IMPORT_ROOTS:
            assert forbidden not in source, f"{rel} references forbidden import '{forbidden}'"


def test_drive_fault_intel_does_not_use_socket():
    path = os.path.join(os.path.dirname(__file__), "..", "shared", "drive_fault_intel.py")
    with open(path, encoding="utf-8") as f:
        source = f.read()
    assert "import socket" not in source


# ---------------------------------------------------------------------------
# 5. Drift guard — GS10_FAULT_INTEL matches the pack's real fault codes
# ---------------------------------------------------------------------------


def test_gs10_fault_intel_matches_pack_fault_codes_exactly():
    pack = load_pack(PACK_ID)
    real_codes = {code for code in pack.live_decode.fault_codes if code != 0}
    assert set(GS10_FAULT_INTEL.keys()) == real_codes
