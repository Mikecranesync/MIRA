"""Pure-logic tests for the schematic intelligence pipeline (#806 / Phase 5).

These tests do NOT make real LLM calls; they wire a fake vision_call closure
and verify the validators / pipeline / KG-payload shape.
"""

from __future__ import annotations

import json

import pytest
from schematic_intelligence import (
    SCHEMATIC_TYPES,
    SYMBOL_TYPES,
    Connection,
    SchematicResult,
    Symbol,
    parse_classification,
    parse_connections,
    parse_symbols,
    run_schematic_pipeline,
    to_kg_payload,
)

# ── parse_classification ──────────────────────────────────────────────────


def test_classification_accepts_known_type():
    assert parse_classification('{"schematic_type":"iec_ladder"}') == "iec_ladder"
    assert parse_classification('{"schematic_type":"ansi_one_line"}') == "ansi_one_line"


def test_classification_falls_back_to_unknown_on_off_allowlist():
    assert parse_classification('{"schematic_type":"made_up_thing"}') == "unknown"


def test_classification_survives_garbage():
    assert parse_classification("not json") == "unknown"
    assert parse_classification("") == "unknown"
    assert parse_classification("{}") == "unknown"


# ── parse_symbols ─────────────────────────────────────────────────────────


def test_symbols_accepts_iec_designators():
    raw = json.dumps(
        {
            "symbols": [
                {"type": "contactor", "ref": "K1", "terminals": ["A1", "A2"]},
                {"type": "motor", "ref": "M1", "terminals": ["U", "V", "W"]},
                {"type": "overload", "ref": "OL1"},
            ]
        }
    )
    syms = parse_symbols(raw)
    assert {s.ref for s in syms} == {"K1", "M1", "OL1"}
    assert {s.type for s in syms} == {"contactor", "motor", "overload"}


def test_symbols_accepts_ansi_designators():
    raw = json.dumps(
        {
            "symbols": [
                {"type": "relay", "ref": "CR1"},
                {"type": "motor", "ref": "MTR-1"},
                {"type": "plc_io", "ref": "Q0.0"},
            ]
        }
    )
    syms = parse_symbols(raw)
    assert {s.ref for s in syms} == {"CR1", "MTR-1", "Q0.0"}


def test_symbols_drops_off_allowlist_types():
    raw = json.dumps({"symbols": [{"type": "wormhole_generator", "ref": "K1"}]})
    assert parse_symbols(raw) == []


def test_symbols_drops_invalid_designators():
    raw = json.dumps({"symbols": [{"type": "contactor", "ref": "this is not a ref"}]})
    assert parse_symbols(raw) == []


def test_symbols_dedups_by_ref():
    raw = json.dumps(
        {
            "symbols": [
                {"type": "contactor", "ref": "K1"},
                {"type": "contactor", "ref": "K1"},
            ]
        }
    )
    assert len(parse_symbols(raw)) == 1


def test_symbols_survives_garbage():
    assert parse_symbols("not json") == []
    assert parse_symbols('{"symbols":"nope"}') == []


# ── parse_connections ─────────────────────────────────────────────────────


def test_connections_accepts_known_endpoints():
    raw = json.dumps(
        {
            "connections": [
                {"from": "K1:A1", "to": "Q0.0:24V", "wire_number": "100"},
                {"from": "K1:13", "to": "M1:U", "wire_number": None},
            ]
        }
    )
    conns = parse_connections(raw, {"K1", "Q0.0", "M1"})
    assert len(conns) == 2
    assert conns[0].wire_number == "100"
    assert conns[1].wire_number is None


def test_connections_drops_unknown_endpoints():
    raw = json.dumps({"connections": [{"from": "K1:A1", "to": "GHOST:99"}]})
    assert parse_connections(raw, {"K1"}) == []


def test_connections_drops_self_loops():
    raw = json.dumps({"connections": [{"from": "K1:A1", "to": "K1:A1"}]})
    assert parse_connections(raw, {"K1"}) == []


# ── run_schematic_pipeline ────────────────────────────────────────────────


class FakeVision:
    def __init__(self, responses: list[str]):
        self.responses = list(responses)
        self.calls = 0

    def __call__(self, prompt: str, image_bytes: bytes, opts: dict) -> str:
        self.calls += 1
        return self.responses.pop(0) if self.responses else ""


def test_pipeline_three_passes_in_order():
    vision = FakeVision(
        [
            json.dumps({"schematic_type": "iec_ladder"}),
            json.dumps(
                {
                    "symbols": [
                        {"type": "contactor", "ref": "K1", "terminals": ["A1", "A2"]},
                        {"type": "motor", "ref": "M1", "terminals": ["U"]},
                    ]
                }
            ),
            json.dumps({"connections": [{"from": "K1:13", "to": "M1:U"}]}),
        ]
    )
    out = run_schematic_pipeline(b"fake-png-bytes", vision_call=vision)
    assert vision.calls == 3
    assert out.schematic_type == "iec_ladder"
    assert len(out.symbols) == 2
    assert len(out.connections) == 1


def test_pipeline_skips_connection_pass_when_too_few_symbols():
    vision = FakeVision(
        [
            json.dumps({"schematic_type": "iec_ladder"}),
            json.dumps({"symbols": [{"type": "motor", "ref": "M1"}]}),
        ]
    )
    out = run_schematic_pipeline(b"fake", vision_call=vision)
    assert vision.calls == 2
    assert out.connections == []


def test_pipeline_returns_unknown_when_classifier_fails():
    vision = FakeVision(["", json.dumps({"symbols": []})])
    out = run_schematic_pipeline(b"fake", vision_call=vision)
    assert out.schematic_type == "unknown"
    assert "classification fell back to unknown" in out.notes


# ── to_kg_payload ─────────────────────────────────────────────────────────


def _result_with_motor_circuit() -> SchematicResult:
    return SchematicResult(
        schematic_type="iec_ladder",
        symbols=[
            Symbol(type="contactor", ref="K1"),
            Symbol(type="overload", ref="OL1"),
            Symbol(type="motor", ref="M1"),
        ],
        connections=[
            Connection(from_ref="K1:13", to_ref="OL1:T1"),
            Connection(from_ref="OL1:T2", to_ref="M1:U"),
        ],
    )


def test_kg_payload_emits_one_entity_per_symbol():
    payload = to_kg_payload(_result_with_motor_circuit(), parent_equipment_id="VFD-07")
    refs = [e["entity_id"] for e in payload["entities"]]
    assert refs == ["K1", "OL1", "M1"]
    for e in payload["entities"]:
        assert e["entity_type"] == "electrical_component"
        assert e["properties"]["parent_equipment_id"] == "VFD-07"


def test_kg_payload_inserts_electrically_connected_relationships():
    payload = to_kg_payload(_result_with_motor_circuit())
    ec = [r for r in payload["relationships"] if r["relationship_type"] == "electrically_connected"]
    assert len(ec) == 2


def test_kg_payload_infers_controls_and_protects_for_motor_circuit():
    payload = to_kg_payload(_result_with_motor_circuit())
    rel_types = {r["relationship_type"] for r in payload["relationships"]}
    assert "controls" in rel_types
    assert "protects" in rel_types
    controls = [r for r in payload["relationships"] if r["relationship_type"] == "controls"]
    assert controls[0]["source_entity_id"] == "K1"
    assert controls[0]["target_entity_id"] == "M1"
    assert controls[0]["properties"]["derived"] is True


# ── Allowlist sanity checks ───────────────────────────────────────────────


def test_schematic_types_includes_unknown():
    assert "unknown" in SCHEMATIC_TYPES
    assert "iec_ladder" in SCHEMATIC_TYPES
    assert "ansi_one_line" in SCHEMATIC_TYPES


def test_symbol_types_covers_iec_motor_circuit_basics():
    for required in ("contactor", "overload", "motor", "fuse", "plc_io", "vfd"):
        assert required in SYMBOL_TYPES


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
