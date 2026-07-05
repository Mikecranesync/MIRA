"""Tests for the Ignition-wire-path analog assessment (Drive Commander
follow-up #2 — the scaling contract).

``assess_analog_from_paths`` is the sanctioned way through the hard boundary in
``assess_from_paths``: it assesses an analog wire value against the pack
envelope ONLY when the tag carries explicit, trusted scaling. Unknown/missing
scaling stays silent (no false alarm). The rendered card explains its own trust
(source value → scaling → engineering value → band → assessment).
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.live_snapshot import assess_analog_from_paths  # noqa: E402
from shared.wire_scaling import TagScaling  # noqa: E402

# The Ignition wire form: full browse-path keys, {"value": str} entries.
DC = "[default]Mira_Monitored/CV-101/vfd_dc_bus"


def test_raw_register_scaled_then_assessed_normal():
    out = assess_analog_from_paths(
        {DC: {"value": "3200"}},
        {DC: TagScaling(mode="raw_register", scale=0.1, unit="V")},
    )
    assert out is not None
    assert "DC bus: 320 V" in out
    assert "Source value: 3200" in out
    assert "×0.1" in out
    assert "Normal band: 300–340 V" in out
    assert "Assessment: normal" in out


def test_engineering_value_used_as_is_and_assessed_normal():
    out = assess_analog_from_paths(
        {DC: {"value": "320"}},
        {DC: TagScaling(mode="engineering_value", unit="V")},
    )
    assert out is not None
    assert "DC bus: 320 V" in out
    assert "already engineering units" in out
    assert "Assessment: normal" in out


def test_unknown_scaling_abstains():
    out = assess_analog_from_paths(
        {DC: {"value": "3200"}},
        {DC: TagScaling(mode="unknown")},
    )
    assert out is None


def test_missing_scaling_entry_abstains():
    out = assess_analog_from_paths({DC: {"value": "3200"}}, {})
    assert out is None


def test_ambiguous_3200_never_becomes_false_undervoltage():
    # The core safety property: an ambiguous raw 3200 with no explicit scaling
    # must NOT be read as 3200 V (over) or 32.0 V (a false undervoltage). It
    # must produce NO analog assessment at all.
    out = assess_analog_from_paths({DC: {"value": "3200"}}, {DC: TagScaling(mode="unknown")})
    assert out is None
    # And with no scaling map at all.
    assert assess_analog_from_paths({DC: {"value": "3200"}}, None) is None


def test_raw_register_out_of_band_below_explained():
    # 2100 ×0.1 = 210 V, below the 300–340 band → explained, not silent.
    out = assess_analog_from_paths(
        {DC: {"value": "2100"}},
        {DC: TagScaling(mode="raw_register", scale=0.1, unit="V")},
    )
    assert out is not None
    assert "DC bus: 210 V" in out
    assert "below" in out
    assert "undervoltage" in out


def test_raw_register_scale_falls_back_to_pack_when_omitted():
    # mode is explicit (raw_register) but scale omitted → inherit the pack's
    # trusted register scaling (0.1 for dc_bus).
    out = assess_analog_from_paths(
        {DC: {"value": "3200"}},
        {DC: TagScaling(mode="raw_register", scale=None, unit="V")},
    )
    assert out is not None
    assert "DC bus: 320 V" in out
    assert "Assessment: normal" in out


def test_current_has_no_band_so_stays_silent_even_with_scaling():
    # The pack's `current` envelope has no min/max → no band to compare against
    # → no assessment, even though scaling is explicit (honest abstention).
    cur = "[default]Mira_Monitored/CV-101/vfd_current"
    out = assess_analog_from_paths(
        {cur: {"value": "9999"}},
        {cur: TagScaling(mode="raw_register", scale=0.01, unit="A")},
    )
    assert out is None


def test_bare_scalar_value_accepted():
    out = assess_analog_from_paths(
        {DC: 3200},
        {DC: TagScaling(mode="raw_register", scale=0.1, unit="V")},
    )
    assert out is not None
    assert "DC bus: 320 V" in out


def test_empty_inputs_return_none():
    assert assess_analog_from_paths(None, {DC: TagScaling(mode="raw_register", scale=0.1)}) is None
    assert assess_analog_from_paths({}, {}) is None
