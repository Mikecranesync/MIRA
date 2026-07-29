"""Tests for the relational distiller (pure core — no DB, no network).

Verifies the Phase 4b contract: a matched drive-pack FAULT turn distils into one
grounded ``<drive family> HAS_FAILURE_MODE <fault>`` assertion, while parameter
turns, unmatched (gap) turns, and engine turns distil to nothing — and the
extractor never mistakes the model token (GS10) for the fault, never invents a
token, and dedups repeat assertions. Pure-core only: nothing here touches the DB
or proposes anything (that path is exercised offline by the flywheel benchmark).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load tools/relational_distill.py by spec (same discipline as
# tests/test_harvest_golden_cases.py). The module adds its sibling tool dirs to
# sys.path itself; gap_report/gap_suggestion it imports are stdlib-only. It must
# be registered in sys.modules before exec so its ``@dataclass`` can resolve its
# own module (dataclasses looks up cls.__module__ there — Python 3.12+/3.14).
_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "relational_distill.py"
_spec = importlib.util.spec_from_file_location("relational_distill", _MOD_PATH)
rd = importlib.util.module_from_spec(_spec)
sys.modules["relational_distill"] = rd
_spec.loader.exec_module(rd)

_INDEX = {
    "durapulse_gs10": {
        "manual_id": "automationdirect_gs10_gs10m-um",
        "product_family": "DURApulse GS10",
        "vendor": "AutomationDirect",
    }
}


def _fault(pack_id, question, **meta_over):
    meta = {"surface": "drive_pack", "matched": True, "matched_kind": "fault", "pack_id": pack_id}
    meta.update(meta_over)
    return {"id": "t-" + question[:8], "meta": meta, "user_message": question}


# --- fault_token ------------------------------------------------------------


def test_fault_token_extracts_fault_mnemonic():
    assert rd.fault_token("what does fault CE10 mean?") == "CE10"


def test_fault_token_excludes_model_token():
    # "GS10" is the model (substring of the excluded family/pack) — not the fault.
    tok = rd.fault_token(
        "what does CE10 mean on the GS10?", exclude=("durapulse_gs10", "DURApulse GS10")
    )
    assert tok == "CE10"


def test_fault_token_ignores_dotted_parameter():
    # A dotted parameter id is a parameter, not a fault.
    assert rd.fault_token("what is P01.24?") is None


def test_fault_token_none_when_only_model():
    assert rd.fault_token("reset the GS10", exclude=("DURApulse GS10", "durapulse_gs10")) is None


# --- extract_relation_assertions --------------------------------------------


def test_matched_fault_turn_yields_one_edge():
    rows = [_fault("durapulse_gs10", "what does fault CE10 mean on the GS10?")]
    out = rd.extract_relation_assertions(rows, _INDEX)
    assert len(out) == 1
    a = out[0]
    assert a.source_name == "DURApulse GS10"  # from registry product_family
    assert a.target_name == "CE10"
    assert a.relation_type == "has_fault"  # proposal_writer maps → HAS_FAILURE_MODE


def test_parameter_turn_yields_nothing():
    rows = [_fault("durapulse_gs10", "what is P00.02?", matched_kind="parameter")]
    assert rd.extract_relation_assertions(rows, _INDEX) == []


def test_unmatched_turn_yields_nothing():
    # An unmatched (gap) fault turn is Phase-3b territory, not a grounded edge.
    rows = [_fault("durapulse_gs10", "what is fault XY99?", matched=False)]
    assert rd.extract_relation_assertions(rows, _INDEX) == []


def test_engine_turn_yields_nothing():
    rows = [{"id": "e1", "meta": {}, "user_message": "how does a VFD work?"}]
    assert rd.extract_relation_assertions(rows, _INDEX) == []


def test_repeated_edge_is_deduped():
    rows = [
        _fault("durapulse_gs10", "what does fault CE10 mean?"),
        _fault("durapulse_gs10", "CE10 again please"),
    ]
    out = rd.extract_relation_assertions(rows, _INDEX)
    assert len(out) == 1  # same (pack, family, CE10, has_fault) collapses


def test_source_name_falls_back_to_pack_id_when_unregistered():
    rows = [_fault("acme_x999", "what does fault Q10 mean?")]
    out = rd.extract_relation_assertions(rows, _INDEX)  # acme not in _INDEX
    assert len(out) == 1
    assert out[0].source_name == "acme_x999"
    assert out[0].target_name == "Q10"


def test_no_fabrication_when_no_fault_token():
    # A matched-fault turn with no fault-shaped token (only the model) → no edge.
    rows = [_fault("durapulse_gs10", "the GS10 is acting up")]
    assert rd.extract_relation_assertions(rows, _INDEX) == []


def test_evidence_cites_the_source_turn():
    rows = [_fault("durapulse_gs10", "what does fault CE10 mean?")]
    a = rd.extract_relation_assertions(rows, _INDEX)[0]
    assert a.source_turn_id in a.evidence
    assert "HAS_FAILURE_MODE" in a.reasoning
    assert "CE10" in a.reasoning
