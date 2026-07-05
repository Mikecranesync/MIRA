"""Tests for shared.live_snapshot — pure, read-only live-tag normalization.

Covers the GS10/Micro820 decode parity with ask_api/app.py, the vfd_comm_ok
stale-trust rule, unknown-tag passthrough, None skipping, UNS-path keying, and
the status-block renderer. No infra: the module is pure.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from shared.live_snapshot import (  # noqa: E402
    GOOD,
    STALE,
    UNKNOWN,
    LiveTagSnapshot,
    assess_from_paths,
    assess_snapshots,
    normalize,
    render_machine_evidence,
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


def test_freq_setpoint_scaled_decode():
    """Sibling of test_scaled_decode_and_uns_path for vfd_freq_sp — raw 6000 -> 60.0 Hz."""
    s = _by_dp(normalize({"vfd_freq_sp": 6000}, BASE, source="ignition", ts=TS))["vfd_freq_sp"]
    assert s.value == 60.0
    assert s.unit == "Hz"
    assert s.quality == GOOD
    assert s.uns_path == f"{BASE}.vfd_freq_sp"
    assert "Freq setpoint: 60.0 Hz" in s.label


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


# ── assess_snapshots — the deterministic assessment (Hub summary mirror) ──────


def _assess(raw):
    return assess_snapshots(normalize(raw, BASE, source="bench", ts=TS))


def test_assess_vfd_healthy_but_stopped():
    # comms OK, no fault, DC bus present, 0 Hz, cmd STOP.
    a = _assess(
        {
            "vfd_comm_ok": True,
            "vfd_fault_code": 0,
            "vfd_dc_bus": 3200,  # /10 = 320 V
            "vfd_frequency": 0,
            "vfd_cmd_word": 1,  # STOP
        }
    )
    assert "healthy" in a
    assert "stopped" in a
    assert "command/permissive/interlock" in a
    # It must NOT tell the tech to replace the drive.
    assert "replace" not in a.lower()


def test_assess_active_fault_leads():
    a = _assess({"vfd_comm_ok": True, "vfd_fault_code": 21})  # oL overload
    assert a.startswith("Active VFD fault")
    assert "oL overload" in a


def test_assess_comms_lost_dominates():
    a = _assess({"vfd_comm_ok": False, "vfd_frequency": 6000})
    assert "comms are LOST" in a


def test_assess_running():
    a = _assess({"vfd_comm_ok": True, "vfd_fault_code": 0, "vfd_frequency": 3000})  # 30 Hz
    assert a.startswith("Machine running")


def test_assess_empty_is_none():
    assert assess_snapshots([]) is None


# ── envelope-driven analog assessment (ADR-0025 §4, Task 3) ──────────────────
#
# Only `assess_snapshots` (decoded engineering units) gets this check;
# `assess_from_paths` (Ignition wire form) stays silent on analog exactly as
# today — see the dedicated test in the `assess_from_paths` section below.


def test_assess_dc_bus_within_band_no_out_of_band_warning():
    # Same tags as test_assess_vfd_healthy_but_stopped: dc_bus 3200 -> 320.0 V,
    # squarely inside the pack's 300-340 V band.
    a = _assess(
        {
            "vfd_comm_ok": True,
            "vfd_fault_code": 0,
            "vfd_dc_bus": 3200,
            "vfd_frequency": 0,
            "vfd_cmd_word": 1,
        }
    )
    assert "healthy" in a
    assert "stopped" in a
    assert "below the normal" not in a
    assert "above the normal" not in a


def test_assess_dc_bus_below_min_out_of_band_observation():
    # 2100 -> 210.0 V, below the pack's 300 V floor.
    a = _assess(
        {
            "vfd_comm_ok": True,
            "vfd_fault_code": 0,
            "vfd_dc_bus": 2100,
            "vfd_frequency": 0,
            "vfd_cmd_word": 1,
        }
    )
    assert "DC bus" in a
    assert "210.0" in a
    assert "below the normal" in a
    assert "300" in a and "340" in a
    # Base assessment still leads; the observation is additive.
    assert "healthy" in a


def test_assess_dc_bus_above_max_out_of_band_observation():
    # 3600 -> 360.0 V, above the pack's 340 V ceiling.
    a = _assess(
        {
            "vfd_comm_ok": True,
            "vfd_fault_code": 0,
            "vfd_dc_bus": 3600,
            "vfd_frequency": 0,
            "vfd_cmd_word": 1,
        }
    )
    assert "DC bus" in a
    assert "360.0" in a
    assert "above the normal" in a
    assert "300" in a and "340" in a


def test_assess_datapoint_with_no_envelope_band_stays_silent():
    # The GS10 pack's `current` band ships with no min/max (only `rated`, and
    # that's null too) — no full band means no judgment, ever, at any value.
    a = _assess(
        {
            "vfd_comm_ok": True,
            "vfd_fault_code": 0,
            "vfd_current": 9999,  # far outside anything plausible
            "vfd_cmd_word": 2,  # RUN-ish, keeps this out of the stopped branch
            "vfd_frequency": 3000,
        }
    )
    assert "band" not in a


# ── render_machine_evidence — the structured section ─────────────────────────


def test_render_machine_evidence_has_header_labels_and_assessment():
    raw = {
        "vfd_comm_ok": True,
        "vfd_fault_code": 0,
        "vfd_dc_bus": 3200,
        "vfd_frequency": 0,
        "vfd_cmd_word": 1,
    }
    section = render_machine_evidence(normalize(raw, BASE, source="bench", ts=TS))
    assert section.startswith("## Live Machine Evidence (observed now)")
    # separation instruction
    assert "separate" in section
    assert "next checks" in section
    # decoded value labels are present
    assert "DC bus: 320.0 V" in section
    # the assessment line
    assert "Assessment:" in section
    assert "healthy" in section


def test_render_machine_evidence_marks_stale():
    section = render_machine_evidence(
        normalize({"vfd_comm_ok": False, "vfd_frequency": 6000}, BASE, source="bench", ts=TS)
    )
    assert "[STALE]" in section
    assert "VFD comms LOST" in section


def test_render_machine_evidence_empty():
    assert render_machine_evidence([]) == ""


# ── assess_from_paths — Ignition wire form (full-path keys, string values) ────


def _ign(leaf, value):
    """One Ignition-wire snapshot entry: full path + {"value": str} dict."""
    return {f"[default]Mira_Monitored/CV-101/{leaf}": {"value": value}}


def _merge(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


def test_assess_from_paths_healthy_but_stopped_from_enum_facts():
    snap = _merge(
        _ign("vfd_fault_code", "0"),
        _ign("vfd_comm_ok", "true"),
        _ign("vfd_cmd_word", "1"),  # STOP
        _ign("vfd_frequency", "0.0"),  # analog — ignored by the assessment
    )
    a = assess_from_paths(snap)
    assert "healthy" in a
    assert "stopped" in a
    assert "command/permissive/interlock" in a
    # It must NOT claim an analog number (scaling is ambiguous on the wire).
    assert "Hz" not in a and " V" not in a


def test_assess_from_paths_never_judges_analog_even_when_out_of_nominal_range():
    # dc_bus "210.0" would be out-of-band (below the 300 V floor) if it were
    # decoded engineering units — but on the Ignition wire the scaling is
    # ambiguous, so this MUST stay silent on it exactly like the in-band case
    # above. Guards the honesty boundary in the comment above assess_from_paths.
    snap = _merge(
        _ign("vfd_fault_code", "0"),
        _ign("vfd_comm_ok", "true"),
        _ign("vfd_cmd_word", "1"),  # STOP
        _ign("vfd_dc_bus", "210.0"),  # analog — ignored by the assessment
    )
    a = assess_from_paths(snap)
    assert "healthy" in a
    assert "stopped" in a
    assert "below the normal" not in a
    assert "band" not in a
    assert "Hz" not in a and " V" not in a


def test_assess_from_paths_active_fault():
    snap = _merge(_ign("vfd_fault_code", "58"), _ign("vfd_comm_ok", "true"))
    a = assess_from_paths(snap)
    assert a.startswith("Active VFD fault")
    assert "CE10 modbus timeout" in a


def test_assess_from_paths_false_string_is_comms_lost_not_truthy():
    # Regression guard: naive `if raw` treats the string "false" as truthy.
    a = assess_from_paths(_ign("vfd_comm_ok", "False"))
    assert "comms are LOST" in a


def test_assess_from_paths_ignores_unassessable_and_analog_only():
    # Arbitrary-keyed / pre-scaled tag → nothing assessable → honest None.
    assert assess_from_paths({"Motor_Current_A": {"value": 11.2}}) is None
    # Analog-only VFD tags (scaling-ambiguous) → also None, never a guess.
    assert assess_from_paths(_ign("vfd_dc_bus", "320.0")) is None


def test_assess_from_paths_accepts_bare_scalar_values():
    snap = {
        "[default]X/vfd_fault_code": 0,
        "[default]X/vfd_comm_ok": True,
        "[default]X/vfd_status_word": 3,  # RUNNING
    }
    a = assess_from_paths(snap)
    assert a.startswith("Machine running")


def test_assess_from_paths_empty_is_none():
    assert assess_from_paths(None) is None
    assert assess_from_paths({}) is None


# ── module-level register-key validation (fail fast at import, not KeyError) ──


def test_missing_register_key_raises_clear_error_at_import(monkeypatch):
    """If a future pack.json edit drops a register key this module's decode
    depends on, the module must fail loudly and actionably at import time —
    never with a bare KeyError deep inside `_scaled`/`_decode_one`."""
    import importlib

    import shared.drive_packs as drive_packs_pkg
    import shared.live_snapshot as live_snapshot_module
    from shared.drive_packs import load_pack as real_load_pack
    from shared.drive_packs.schema import DrivePack, LiveDecode

    good_pack = real_load_pack("durapulse_gs10")
    bad_registers = dict(good_pack.live_decode.registers)
    del bad_registers["vfd_freq_sp"]
    bad_pack = DrivePack(
        pack_id=good_pack.pack_id,
        schema_version=good_pack.schema_version,
        family=good_pack.family,
        nameplate=good_pack.nameplate,
        live_decode=LiveDecode(
            status_bits=good_pack.live_decode.status_bits,
            cmd_word=good_pack.live_decode.cmd_word,
            fault_codes=good_pack.live_decode.fault_codes,
            registers=bad_registers,
        ),
        envelope=good_pack.envelope,
        knowledge=good_pack.knowledge,
        provenance=good_pack.provenance,
    )

    monkeypatch.setattr(drive_packs_pkg, "load_pack", lambda pack_id: bad_pack)
    try:
        with pytest.raises(ValueError, match=r"durapulse_gs10.*vfd_freq_sp"):
            importlib.reload(live_snapshot_module)
    finally:
        # Undo the monkeypatch BEFORE reloading again, so the module comes
        # back up against the real, complete pack for any tests that follow.
        monkeypatch.undo()
        importlib.reload(live_snapshot_module)
