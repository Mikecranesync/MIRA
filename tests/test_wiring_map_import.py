"""Tests for the wiring_connections structured import (PR-1 seam proof).

Proves the five contract points for turning the cited CV-101 electrical model
(`plc/conv_simple_electrical/model/*.yaml`) into `wiring_connections` rows:
  1. the YAML loads;
  2. the expected connections are produced;
  3. duplicate writes are idempotent (dedup SELECT → skip);
  4. rows preserve source / evidence / provenance;
  5. approval_state defaults to 'proposed'.
Pure core + a FakeCursor for the write path — no real DB, no network, no vision.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load tools/wiring_map_import.py by spec; register in sys.modules before exec so
# its @dataclass can resolve its own module (Python 3.12+/3.14).
_REPO = Path(__file__).resolve().parents[1]
_MOD_PATH = _REPO / "tools" / "wiring_map_import.py"
_spec = importlib.util.spec_from_file_location("wiring_map_import", _MOD_PATH)
wmi = importlib.util.module_from_spec(_spec)
sys.modules["wiring_map_import"] = wmi
_spec.loader.exec_module(wmi)

_MODEL_DIR = _REPO / "plc" / "conv_simple_electrical" / "model"
_TENANT = "11111111-1111-1111-1111-111111111111"


def _rows():
    return wmi.load_wiring_rows(_MODEL_DIR)


# --- (1) the YAML loads -----------------------------------------------------


def test_yaml_loads_all_conductors():
    rows = _rows()
    assert len(rows) == 8  # the eight E-005 PLC-input conductors in wires.yaml


# --- (2) expected connections are produced ----------------------------------


def test_expected_connections_present():
    by_wire = {r.wire_number: r for r in _rows()}
    assert set(by_wire) == {"W24", "W200", "W201", "W202", "W203", "W204", "W205", "W0V"}

    fwd = by_wire["W200"]
    assert fwd.source_label == "SS1.FWD" and fwd.dest_label == "PLC1.I-00"
    assert fwd.source_terminal == "FWD" and fwd.dest_terminal == "I-00"
    assert fwd.function_class == "signal"

    # e-stop channels classify as safety; the 24 V rail as power; the common as ground.
    assert by_wire["W202"].function_class == "safety"  # e_stop NC
    assert by_wire["W203"].function_class == "safety"  # e_stop NO
    assert by_wire["W24"].function_class == "power"  # +24 VDC distribution
    assert by_wire["W0V"].function_class == "ground"  # 0V / input common


def test_endpoint_ids_are_deterministic():
    a = wmi.load_wiring_rows(_MODEL_DIR)
    b = wmi.load_wiring_rows(_MODEL_DIR)
    assert [r.natural_key() for r in a] == [r.natural_key() for r in b]
    # same tag → same id across calls; different tags → different ids
    assert wmi.entity_id("cv-101", "PLC1") == wmi.entity_id("cv-101", "PLC1")
    assert wmi.entity_id("cv-101", "PLC1") != wmi.entity_id("cv-101", "SS1")


def test_function_class_only_valid_values():
    for r in _rows():
        assert r.function_class in wmi._VALID_FUNCTION_CLASSES


# --- (4) rows preserve source / evidence / provenance -----------------------


def test_rows_preserve_source_and_evidence():
    for r in _rows():
        ev = r.evidence_summary
        assert ev["source"].endswith("plc/conv_simple_electrical/model/wires.yaml")
        assert ev["sheet"] == "E-005"
        assert ev["model_status"] == "field_verify"  # preserved verbatim, not upgraded
        assert ev["from"] == r.source_label and ev["to"] == r.dest_label
        assert ev["signal"]  # non-empty signal name
        assert r.drawing_reference  # cites the sheet + signal
    # the verified PLC terminal map is reflected in provenance
    fwd = next(r for r in _rows() if r.wire_number == "W200")
    assert fwd.evidence_summary["dest_terminal_verified"] is True  # PLC1.I-00 is verified


# --- (5) approval_state defaults to 'proposed' ------------------------------


def test_approval_state_is_proposed():
    for r in _rows():
        assert r.approval_state == "proposed"
        assert r.proposed_by == "import:conv_simple_electrical"


# --- (3) duplicate writes are idempotent ------------------------------------


class _FakeCursor:
    """Minimal stand-in: answers the dedup SELECT from what INSERT has stored."""

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
        else:  # set_config etc.
            self._hit = False

    def fetchone(self):
        return ("some-id",) if self._hit else None


def test_write_is_idempotent():
    rows = _rows()
    cur = _FakeCursor()

    inserted, skipped = wmi.write_rows(cur, _TENANT, rows)
    assert (inserted, skipped) == (8, 0)  # first run inserts all
    assert len(cur.inserts) == 8

    inserted2, skipped2 = wmi.write_rows(cur, _TENANT, rows)
    assert (inserted2, skipped2) == (0, 8)  # second run is a no-op
    assert len(cur.inserts) == 8  # no new inserts


def test_insert_params_carry_proposed_state_and_evidence_json():
    import json

    cur = _FakeCursor()
    wmi.write_rows(cur, _TENANT, _rows())
    # INSERT param order: (tenant, src_id, src_term, dst_id, dst_term, wire,
    #                      function_class, drawing_reference, approval_state,
    #                      proposed_by, evidence_json)
    for params in cur.inserts:
        assert params[0] == _TENANT
        assert params[8] == "proposed"  # approval_state
        assert params[9] == "import:conv_simple_electrical"  # proposed_by
        evidence = json.loads(params[10])  # valid JSON evidence summary
        assert evidence["model_status"] == "field_verify"
        assert "source" in evidence
