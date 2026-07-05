"""Tests for shared.wire_scaling — the pure Ignition per-tag scaling contract.

The trust boundary for analog assessment on the Ignition wire path: a wire
value is converted to engineering units ONLY when its scaling mode is explicit
(``raw_register`` with a scale, or ``engineering_value``). ``unknown`` /
missing / bad input returns ``None`` so the caller abstains (ADR-0025 §4 —
confidently wrong is worse than silent). No I/O here; the pack fallback for a
missing ``raw_register`` scale lives in ``live_snapshot``, not this pure layer.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.wire_scaling import TagScaling, from_jsonb, to_engineering  # noqa: E402


# ── to_engineering ───────────────────────────────────────────────────────────


def test_raw_register_applies_scale():
    s = TagScaling(mode="raw_register", scale=0.1, unit="V")
    assert to_engineering(3200, s) == 320.0


def test_engineering_value_used_as_is():
    s = TagScaling(mode="engineering_value", unit="V")
    assert to_engineering(320, s) == 320.0


def test_unknown_abstains():
    assert to_engineering(3200, TagScaling(mode="unknown")) is None


def test_raw_register_without_scale_abstains():
    # Pure layer is strict: no scale => cannot convert. The pack-register scale
    # fallback is the caller's job (live_snapshot), not this module's.
    assert to_engineering(3200, TagScaling(mode="raw_register", scale=None)) is None


def test_bad_input_abstains():
    s = TagScaling(mode="raw_register", scale=0.1)
    assert to_engineering("not-a-number", s) is None
    assert to_engineering(None, s) is None


def test_string_numeric_is_coerced():
    s = TagScaling(mode="raw_register", scale=0.1, unit="V")
    assert to_engineering("3200", s) == 320.0


def test_engineering_value_string_is_coerced():
    assert to_engineering("320.0", TagScaling(mode="engineering_value")) == 320.0


# ── from_jsonb (reads the tag_entities.scaling column value) ──────────────────


def test_from_jsonb_none_is_unknown():
    s = from_jsonb(None, unit="V")
    assert s.mode == "unknown"
    assert s.unit == "V"


def test_from_jsonb_reads_contract_shape():
    s = from_jsonb({"mode": "raw_register", "scale": 0.1}, unit="V")
    assert s.mode == "raw_register"
    assert s.scale == 0.1
    assert s.unit == "V"


def test_from_jsonb_engineering_value_shape():
    s = from_jsonb({"mode": "engineering_value"}, unit="A")
    assert s.mode == "engineering_value"
    assert s.unit == "A"


def test_from_jsonb_unrecognized_mode_is_unknown():
    assert from_jsonb({"mode": "nonsense"}, unit="A").mode == "unknown"


def test_from_jsonb_dict_without_mode_is_unknown():
    # Migration 025's documented linear-map shape has no "mode"; we do NOT guess
    # a mode from it in v1 — treat as unknown (honest abstention).
    s = from_jsonb({"raw_min": 0, "raw_max": 65535, "eng_min": 0, "eng_max": 6553.5}, unit="V")
    assert s.mode == "unknown"
