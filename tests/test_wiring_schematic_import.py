"""Tests for the schematic-extractor → wiring_connections import (PR-2).

Uses a fixture `/api/kg/schematic` payload (no live vision call). Proves:
  - only `electrically_connected` relationships become conductors (derived
    controls/protects edges are excluded);
  - the exact ref:terminal → row mapping;
  - the `{"ok":true,"result":{...}}` envelope and a raw payload are equivalent;
  - source/extractor/drawing/session provenance is preserved in evidence;
  - approval_state='proposed', proposed_by reflects the LLM extractor;
  - function_class is the honest 'unknown' (extractor gives no class) + gap marker;
  - endpoint ids reuse PR-1's deterministic namespace;
  - the reused PR-1 write_rows seam is idempotent.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
_MOD_PATH = _REPO / "tools" / "wiring_schematic_import.py"
_spec = importlib.util.spec_from_file_location("wiring_schematic_import", _MOD_PATH)
si = importlib.util.module_from_spec(_spec)
sys.modules["wiring_schematic_import"] = si
_spec.loader.exec_module(si)

_TENANT = "11111111-1111-1111-1111-111111111111"


def _result():
    """A representative /api/kg/schematic `result` (to_kg_payload) object."""
    return {
        "schematic_type": "iec_ladder",
        "parent_equipment_id": "PLANT-A:CV-101",
        "entities": [
            {
                "entity_id": "K1",
                "properties": {"subtype": "contactor", "drawing_ref": "cv101_panel.png"},
            },
            {"entity_id": "Q0.0", "properties": {"subtype": "plc_io"}},
            {"entity_id": "OL1", "properties": {"subtype": "overload"}},
            {"entity_id": "M1", "properties": {"subtype": "motor"}},
        ],
        "relationships": [
            {
                "source_entity_id": "K1",
                "target_entity_id": "Q0.0",
                "relationship_type": "electrically_connected",
                "properties": {
                    "from_terminal": "K1:A1",
                    "to_terminal": "Q0.0:24V",
                    "wire_number": "100",
                },
            },
            {
                "source_entity_id": "OL1",
                "target_entity_id": "M1",
                "relationship_type": "electrically_connected",
                "properties": {
                    "from_terminal": "OL1:T1",
                    "to_terminal": "M1:U",
                    "wire_number": "200",
                },
            },
            # derived semantic edges — NOT wires, must be excluded
            {
                "source_entity_id": "K1",
                "target_entity_id": "M1",
                "relationship_type": "controls",
                "properties": {"derived": True},
            },
            {
                "source_entity_id": "OL1",
                "target_entity_id": "M1",
                "relationship_type": "protects",
                "properties": {"derived": True},
            },
        ],
    }


# --- (1) only electrically_connected relationships become rows ---------------


def test_only_electrical_edges_become_rows():
    rows = si.kg_payload_to_rows(_result())
    assert len(rows) == 2  # controls + protects excluded


def test_envelope_and_raw_are_equivalent():
    enveloped = {"ok": True, "result": _result()}
    a = si.kg_payload_to_rows(enveloped)
    b = si.kg_payload_to_rows(_result())
    assert [r.natural_key() for r in a] == [r.natural_key() for r in b]


# --- (2) exact ref:terminal → row mapping -----------------------------------


def test_exact_mapping():
    by_wire = {r.wire_number: r for r in si.kg_payload_to_rows(_result())}
    assert set(by_wire) == {"100", "200"}
    k1 = by_wire["100"]
    assert k1.source_terminal == "A1" and k1.dest_terminal == "24V"
    assert k1.source_entity_id == si.base.entity_id("cv-101", "K1")  # PR-1 namespace reuse
    assert k1.dest_entity_id == si.base.entity_id("cv-101", "Q0.0")
    ol1 = by_wire["200"]
    assert ol1.source_terminal == "T1" and ol1.dest_terminal == "U"


# --- (4) provenance preserved -----------------------------------------------


def test_provenance_preserved():
    r = si.kg_payload_to_rows(_result())[0]
    ev = r.evidence_summary
    assert ev["extractor"] == "schematic_intelligence"
    assert ev["schematic_type"] == "iec_ladder"
    assert ev["drawing_ref"] == "cv101_panel.png"  # echoed from entity properties
    assert ev["parent_equipment_id"] == "PLANT-A:CV-101"
    assert ev["from_terminal"] == "K1:A1" and ev["to_terminal"] == "Q0.0:24V"
    assert ev["source_subtype"] == "contactor" and ev["dest_subtype"] == "plc_io"
    assert ev["source"] == "mira-mcp:/api/kg/schematic"
    assert r.drawing_reference == "cv101_panel.png"


def test_explicit_drawing_ref_overrides():
    r = si.kg_payload_to_rows(_result(), drawing_ref="tech-session-42")[0]
    assert r.drawing_reference == "tech-session-42"
    assert r.evidence_summary["drawing_ref"] == "tech-session-42"


# --- (5) approval + (6) function_class gap ----------------------------------


def test_approval_and_provenance_actor():
    for r in si.kg_payload_to_rows(_result()):
        assert r.approval_state == "proposed"
        assert r.proposed_by == "llm:schematic_intelligence"  # LLM-derived, auditable


def test_function_class_is_unknown_with_gap_marker():
    for r in si.kg_payload_to_rows(_result()):
        assert r.function_class == "unknown"  # extractor carries no class
        assert r.evidence_summary["function_class_source"] == "unclassified_by_extractor"


# --- dedup + empties --------------------------------------------------------


def test_duplicate_relationship_deduped():
    payload = _result()
    payload["relationships"].append(dict(payload["relationships"][0]))  # duplicate the K1→Q0.0 edge
    assert len(si.kg_payload_to_rows(payload)) == 2  # still 2 (dup collapsed)


def test_no_electrical_edges_yields_nothing():
    payload = {"schematic_type": "unknown", "entities": [], "relationships": []}
    assert si.kg_payload_to_rows(payload) == []


# --- (idempotency) reuse of the PR-1 write_rows seam ------------------------


class _FakeCursor:
    def __init__(self):
        self.store: set[tuple] = set()
        self.inserts: list[tuple] = []
        self._hit = False

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        if s.startswith("SELECT id FROM wiring_connections"):
            self._hit = tuple(params[:6]) in self.store
        elif s.startswith("INSERT INTO wiring_connections"):
            self.store.add(tuple(params[:6]))
            self.inserts.append(params)
            self._hit = False
        else:
            self._hit = False

    def fetchone(self):
        return ("id",) if self._hit else None


def test_write_rows_idempotent_via_reused_seam():
    rows = si.kg_payload_to_rows(_result())
    cur = _FakeCursor()
    assert si.base.write_rows(cur, _TENANT, rows) == (2, 0)
    assert si.base.write_rows(cur, _TENANT, rows) == (0, 2)  # re-run is a no-op
    # inserted rows carry proposed state + valid evidence JSON
    for params in cur.inserts:
        assert params[8] == "proposed"
        assert params[9] == "llm:schematic_intelligence"
        assert json.loads(params[10])["extractor"] == "schematic_intelligence"
