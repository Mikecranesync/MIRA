"""schema_version 2 for drive packs — additive parameter + keypad cards.

PR B (schema/types only). Proves:
  * a v1 pack (the real durapulse_gs10) still loads unchanged, with the new
    blocks defaulting empty;
  * a v2 pack parses — both from an in-memory dict (the ``_parse_pack`` seam)
    and from disk (``load_pack``);
  * the new ``ParameterCard`` / ``KeypadNavigationCard`` / ``ValueMeaning`` types
    parse with ``drive_family`` injected from ``pack_id``;
  * the loader enforces schema-version + safety validation (unknown version,
    empty ``view_only_warning``, bad provenance_tier, missing ``parameter_id``);
  * ``Citation`` is still importable from its old home (re-export intact);
  * ``DriveDiagnostic`` carries the new fields additively (default empty/None)
    and ``build_drive_diagnostic`` output is unchanged.

No manual parsing, no runtime keypad guidance, no DB/network/socket.
"""

from __future__ import annotations

import dataclasses
import json
import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from shared.drive_packs import (  # noqa: E402
    Citation,
    DrivePack,
    KeypadNavigationCard,
    ParameterCard,
    ValueMeaning,
    load_pack,
)
from shared.drive_packs import loader as _loader  # noqa: E402
from shared.drive_packs.loader import _parse_pack  # noqa: E402
from shared.live_snapshot import (  # noqa: E402
    DriveDiagnostic,
    build_drive_diagnostic,
    normalize,
)

PACK_ID = "test_v2_drive"


def _v2_raw(**overrides) -> dict:
    """A minimal but complete schema_version 2 pack dict."""
    raw = {
        "pack_id": PACK_ID,
        "schema_version": 2,
        "family": {"manufacturer": "TestCo", "series": "TX1", "aliases": ["tx1"]},
        "nameplate": {"match_keywords": ["TX1"]},
        "live_decode": {
            "status_bits": {},
            "cmd_word": {},
            "fault_codes": {"58": "CE10 modbus timeout"},
        },
        "envelope": {},
        "knowledge": {},
        "provenance": {"items": {}, "sources": [{"doc": "TX1 Manual", "page": "", "excerpt": ""}]},
        "parameters": [
            {
                "parameter_id": "P09.03",
                "name": "Comm Time-out Detection",
                "purpose": "Sets how the drive reacts to a lost Modbus master.",
                "value_meanings": [
                    {"value": "0", "meaning": "Warn and continue"},
                    {"value": "3", "meaning": "Fault and coast to stop"},
                ],
                "default": "3",
                "range": "0-3",
                "unit": None,
                "related_faults": ["CE10"],
                "source_citation": {"doc": "TX1 Manual", "page": "", "excerpt": "P09.03 ..."},
                "provenance_tier": "manual_cited",
                "confidence_tier": "medium",
            }
        ],
        "keypad_navigation": [
            {
                "goal": "View the Modbus comm-timeout setting",
                "parameter_id": "P09.03",
                "menu_group": "P09 - Communication",
                "keypad_steps": [
                    "Press MODE until 'PAr'",
                    "Scroll to P09.03",
                    "Press READ to view",
                ],
                "view_only_warning": "These steps only VIEW P09.03. Do not press ENTER to change it.",
                "source_citation": {"doc": "TX1 Manual", "page": "", "excerpt": ""},
                "confidence_tier": "medium",
                "provenance_tier": "manual_cited",
            }
        ],
    }
    raw.update(overrides)
    return raw


# ── v1 compatibility ─────────────────────────────────────────────────────────


def test_v1_pack_still_loads_with_empty_new_blocks():
    # A schema_version 1 pack (no parameters/keypad_navigation blocks) must still
    # load with those slots defaulting to empty. Uses a synthetic v1 dict via the
    # _parse_pack seam — the shipped durapulse_gs10 pack is now v2 (its P09.03/keypad
    # content shipped), so it can no longer serve as the "v1, empty blocks" example;
    # the shipped pack's v2 content is asserted in test_drive_packs.py.
    raw = _v2_raw(schema_version=1)
    del raw["parameters"]
    del raw["keypad_navigation"]
    pack = _parse_pack(raw, PACK_ID, "<v1-memory>")
    assert pack.schema_version == 1
    assert pack.parameters == []
    assert pack.keypad_navigation == []
    # v1 substance untouched.
    assert pack.live_decode.fault_codes[58] == "CE10 modbus timeout"


# ── v2 parse (dict seam) ─────────────────────────────────────────────────────


def test_v2_dict_parses():
    pack = _parse_pack(_v2_raw(), PACK_ID, "<memory>")
    assert isinstance(pack, DrivePack)
    assert pack.schema_version == 2
    assert len(pack.parameters) == 1
    assert len(pack.keypad_navigation) == 1


def test_v2_parameter_card_fields():
    pack = _parse_pack(_v2_raw(), PACK_ID, "<memory>")
    p = pack.parameters[0]
    assert isinstance(p, ParameterCard)
    assert p.drive_family == PACK_ID  # injected from pack_id, not repeated in JSON
    assert p.parameter_id == "P09.03"
    assert p.name == "Comm Time-out Detection"
    assert p.default == "3"
    assert p.related_faults == ["CE10"]
    # No 'related_parameters' key in the raw dict — defaults to [] (additive,
    # backward-compatible field; GS10's pack has none of these and must keep
    # loading unchanged).
    assert p.related_parameters == []
    assert p.provenance_tier == "manual_cited"
    assert p.confidence_tier == "medium"
    assert isinstance(p.source_citation, Citation)
    assert p.value_meanings == [
        ValueMeaning(value="0", meaning="Warn and continue"),
        ValueMeaning(value="3", meaning="Fault and coast to stop"),
    ]


def test_v2_parameter_card_related_parameters_round_trips():
    # Additive field: a ParameterCard JSON WITH related_parameters (the
    # "Related Parameters:" line, e.g. C125 -> P045) round-trips as a list.
    raw = _v2_raw()
    raw["parameters"][0]["related_parameters"] = ["P045", "C126"]
    pack = _parse_pack(raw, PACK_ID, "<memory>")
    p = pack.parameters[0]
    assert p.related_parameters == ["P045", "C126"]


def test_v2_parameter_card_related_parameters_defaults_empty_when_absent():
    # A ParameterCard JSON WITHOUT related_parameters (e.g. every GS10
    # parameter today) defaults to [] rather than raising or requiring the key.
    raw = _v2_raw()
    assert "related_parameters" not in raw["parameters"][0]
    pack = _parse_pack(raw, PACK_ID, "<memory>")
    assert pack.parameters[0].related_parameters == []


def test_v2_keypad_card_fields():
    pack = _parse_pack(_v2_raw(), PACK_ID, "<memory>")
    k = pack.keypad_navigation[0]
    assert isinstance(k, KeypadNavigationCard)
    assert k.drive_family == PACK_ID
    assert k.parameter_id == "P09.03"
    assert k.keypad_steps[0].startswith("Press MODE")
    assert k.view_only_warning  # non-empty (safety contract)
    assert k.edit_warning is None  # VIEW-only by default
    assert k.provenance_tier == "manual_cited"


# ── v2 parse (disk seam) ─────────────────────────────────────────────────────


def test_v2_loads_from_disk(tmp_path, monkeypatch):
    pack_dir = tmp_path / PACK_ID
    pack_dir.mkdir()
    (pack_dir / "pack.json").write_text(json.dumps(_v2_raw()), encoding="utf-8")
    monkeypatch.setattr(_loader, "_packs_dir", lambda: tmp_path)

    pack = load_pack(PACK_ID)
    assert pack.schema_version == 2
    assert pack.parameters[0].parameter_id == "P09.03"
    assert pack.keypad_navigation[0].view_only_warning


# ── validation ───────────────────────────────────────────────────────────────


def test_unsupported_schema_version_rejected():
    with pytest.raises(ValueError, match="unsupported schema_version"):
        _parse_pack(_v2_raw(schema_version=3), PACK_ID, "<memory>")


def test_empty_view_only_warning_rejected():
    raw = _v2_raw()
    raw["keypad_navigation"][0]["view_only_warning"] = "   "
    with pytest.raises(ValueError, match="view_only_warning"):
        _parse_pack(raw, PACK_ID, "<memory>")


def test_missing_parameter_id_rejected():
    raw = _v2_raw()
    del raw["parameters"][0]["parameter_id"]
    with pytest.raises(ValueError, match="parameter_id"):
        _parse_pack(raw, PACK_ID, "<memory>")


def test_bad_parameter_provenance_tier_rejected():
    raw = _v2_raw()
    raw["parameters"][0]["provenance_tier"] = "verified"  # reserved word, not allowed
    with pytest.raises(ValueError, match="provenance_tier"):
        _parse_pack(raw, PACK_ID, "<memory>")


def test_v1_pack_with_no_new_blocks_parses_empty():
    raw = _v2_raw(schema_version=1)
    del raw["parameters"]
    del raw["keypad_navigation"]
    pack = _parse_pack(raw, PACK_ID, "<memory>")
    assert pack.schema_version == 1
    assert pack.parameters == []
    assert pack.keypad_navigation == []


# ── Citation re-export intact ────────────────────────────────────────────────


def test_citation_reexported_from_cards():
    from shared.drive_packs.cards import Citation as CardsCitation
    from shared.drive_packs.schema import Citation as SchemaCitation

    assert CardsCitation is SchemaCitation is Citation


# ── DriveDiagnostic additive fields — existing output unchanged ───────────────

BASE = "enterprise.garage.line1.conveyor1"
TS = "2026-07-05T00:00:00Z"


def _snaps(raw_tags: dict):
    return normalize(raw_tags, BASE, source="bench", ts=TS)


def test_drive_diagnostic_new_fields_default_empty():
    diag = build_drive_diagnostic(_snaps({"vfd_fault_code": 4, "vfd_comm_ok": True}))
    # The GOOD-fault assessment + card path is unchanged...
    assert diag.assessment is not None
    assert diag.fault_card is not None
    # ...and the new carry slots are additive: build does NOT populate them.
    assert diag.related_parameters == []
    assert diag.keypad_navigation is None


def test_drive_diagnostic_can_carry_new_cards_and_is_frozen():
    p = _parse_pack(_v2_raw(), PACK_ID, "<memory>").parameters[0]
    k = _parse_pack(_v2_raw(), PACK_ID, "<memory>").keypad_navigation[0]
    diag = DriveDiagnostic(
        assessment="x", fault_card=None, related_parameters=[p], keypad_navigation=k
    )
    assert diag.related_parameters == [p]
    assert diag.keypad_navigation is k
    assert dataclasses.is_dataclass(DriveDiagnostic)
    with pytest.raises(dataclasses.FrozenInstanceError):
        diag.related_parameters = []
