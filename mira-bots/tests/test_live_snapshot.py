"""Tests for shared.live_snapshot — pure, read-only live-tag normalization.

Covers the GS10/Micro820 decode parity with ask_api/app.py, the vfd_comm_ok
stale-trust rule, unknown-tag passthrough, None skipping, UNS-path keying, and
the status-block renderer. No infra: the module is pure.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.live_snapshot import (  # noqa: E402
    GOOD,
    STALE,
    UNKNOWN,
    LiveTagSnapshot,
    normalize,
    render_status_block,
)

BASE = "enterprise.garage.line1.conveyor1"
TS = "2026-06-04T04:00:00Z"


def _by_dp(snaps: list[LiveTagSnapshot]) -> dict[str, LiveTagSnapshot]:
    return {s.datapoint: s for s in snaps}


def test_empty_or_none_returns_empty():
    assert normalize(None, BASE, source="bench", ts=TS) == []
    assert normalize({}, BASE, source="bench", ts=TS) == []


def test_none_values_skipped():
    snaps = normalize({"vfd_frequency": None, "vfd_current": 1234}, BASE, source="bench", ts=TS)
    dps = _by_dp(snaps)
    assert "vfd_frequency" not in dps
    assert "vfd_current" in dps


def test_scaled_decode_and_uns_path():
    snaps = normalize({"vfd_frequency": 6000}, BASE, source="ignition", ts=TS)
    s = snaps[0]
    assert s.value == 60.0
    assert s.unit == "Hz"
    assert s.quality == GOOD
    assert s.uns_path == f"{BASE}.vfd_frequency"
    assert s.datapoint == "vfd_frequency"
    assert s.source == "ignition"
    assert s.ts == TS
    assert "60.0 Hz" in s.label


def test_fault_code_mapping():
    s = _by_dp(normalize({"vfd_fault_code": 58}, BASE, source="bench", ts=TS))["vfd_fault_code"]
    assert s.value == "CE10 modbus timeout"
    assert "FAULT" in s.label and "58" in s.label


def test_fault_code_zero_is_no_fault():
    s = _by_dp(normalize({"vfd_fault_code": 0}, BASE, source="bench", ts=TS))["vfd_fault_code"]
    assert s.value == "no active fault"


def test_status_word_low_bits():
    s = _by_dp(normalize({"vfd_status_word": 0b11}, BASE, source="bench", ts=TS))["vfd_status_word"]
    assert s.value == "RUNNING"


def test_comm_ok_false_marks_vfd_values_stale_but_not_plant_io():
    raw = {
        "vfd_comm_ok": False,
        "vfd_frequency": 6000,
        "vfd_fault_code": 21,
        "DI_02": True,  # e-stop, read straight from PLC, not via VFD comms
    }
    dps = _by_dp(normalize(raw, BASE, source="bench", ts=TS))
    assert dps["vfd_frequency"].quality == STALE
    assert dps["vfd_fault_code"].quality == STALE
    # the trust gate itself is trustworthy, and plant I/O is unaffected
    assert dps["vfd_comm_ok"].quality == GOOD
    assert dps["DI_02"].quality == GOOD


def test_comm_ok_true_keeps_vfd_values_good():
    dps = _by_dp(normalize({"vfd_comm_ok": True, "vfd_current": 350}, BASE, source="bench", ts=TS))
    assert dps["vfd_current"].quality == GOOD


def test_unknown_tag_passthrough():
    s = _by_dp(normalize({"weird_tag": 7}, BASE, source="bench", ts=TS))["weird_tag"]
    assert s.value == 7
    assert s.quality == UNKNOWN
    assert s.label == "weird_tag: 7"


def test_non_numeric_scaled_tag_falls_back_to_passthrough():
    # a scaled key with a non-numeric value must not raise
    s = _by_dp(normalize({"vfd_frequency": "n/a"}, BASE, source="bench", ts=TS))["vfd_frequency"]
    assert s.value == "n/a"
    assert s.quality == UNKNOWN


def test_render_status_block_marks_stale_and_has_header():
    raw = {"vfd_comm_ok": False, "vfd_frequency": 6000}
    block = render_status_block(normalize(raw, BASE, source="bench", ts=TS))
    assert block.startswith("[LIVE CONVEYOR STATUS]")
    assert "[STALE]" in block
    assert "VFD comms LOST" in block


def test_render_status_block_empty():
    assert render_status_block([]) == ""


def test_no_uns_base_uses_datapoint_only():
    s = normalize({"vfd_current": 350}, "", source="bench", ts=TS)[0]
    assert s.uns_path == "vfd_current"
