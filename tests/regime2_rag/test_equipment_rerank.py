"""Unit tests for the production equipment-aware rerank (Phase 1).

Pure-function tests for `neon_recall._rerank_for_equipment` — no DB, no Ollama,
no network. Gates the Phase 1 claim: given mixed-vendor candidates and an
equipment-tagged query, the matching-vendor chunk floats to the top; and a query
about a vendor the harness denylisted (V1000) still returns that vendor.
"""
from __future__ import annotations

import sys
from pathlib import Path

# mira-bots on path so `shared.neon_recall` imports without a live env.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mira-bots"))
from shared import neon_recall  # noqa: E402


def _chunk(mfr, model, content="generic drive content about faults and parameters"):
    return {"manufacturer": mfr, "model_number": model, "content": content}


def test_gs10_query_floats_gs10_above_other_vendor():
    # RRF-ordered pool with the WRONG vendor on top (the real bug: GS10 query
    # returned Yaskawa V1000 #1).
    rows = [
        _chunk("Yaskawa", "V1000", "V1000 prevents overcurrent and motor overload oL1"),
        _chunk("ABB", "ACH580", "ACH580 overcurrent during acceleration"),
        _chunk("AutomationDirect", "GS10", "GS10 overcurrent fault oc-A during acceleration"),
    ]
    out = neon_recall._rerank_for_equipment(rows, "GS10 overcurrent fault during acceleration")
    assert out[0]["model_number"] == "GS10", [r["model_number"] for r in out]


def test_no_equipment_in_query_is_identity():
    rows = [_chunk("Yaskawa", "V1000"), _chunk("AutomationDirect", "GS10")]
    out = neon_recall._rerank_for_equipment(rows, "how do I improve motor efficiency")
    assert out == rows  # unchanged order, same objects


def test_denylisted_vendor_query_still_returns_that_vendor():
    # The harness rerank hardcodes powerflex/guardmaster/v1000 as ALWAYS-negative;
    # prod must NOT — a real PowerFlex question must surface PowerFlex. (PowerFlex
    # is on the harness denylist AND recognized by _extract_product_names, so it
    # is the valid regression probe; V1000 isn't extracted today, so it no-ops.)
    rows = [
        _chunk("AutomationDirect", "GS10", "GS10 fault table"),
        _chunk("Rockwell Automation", "PowerFlex 525", "PowerFlex 525 parameter write over Modbus"),
    ]
    out = neon_recall._rerank_for_equipment(
        rows, "How do I write a parameter to a PowerFlex 525 over Modbus?"
    )
    assert out[0]["model_number"] == "PowerFlex 525", [r["model_number"] for r in out]


def test_meta_match_outranks_content_only_match():
    rows = [
        _chunk("Generic", "X", "this chunk merely mentions micro820 once in prose"),
        _chunk("Rockwell Automation", "Micro820", "controller config"),
    ]
    out = neon_recall._rerank_for_equipment(rows, "Micro820 high speed counter")
    assert out[0]["model_number"] == "Micro820"


def test_stable_order_within_same_score():
    # Two non-matching chunks keep their original relative order.
    rows = [_chunk("ABB", "ACH580"), _chunk("Yaskawa", "V1000")]
    out = neon_recall._rerank_for_equipment(rows, "GS10 wiring")
    assert [r["model_number"] for r in out] == ["ACH580", "V1000"]
