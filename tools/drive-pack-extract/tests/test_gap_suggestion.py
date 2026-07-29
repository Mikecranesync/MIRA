"""Tests for the drive-pack gap → review-suggestion builder (pure — no DB).

Covers the Phase 3b contract: only *registered* packs over the threshold become
``drive_pack_update`` suggestions; each row carries a ``registry_manual_id`` so
the existing accept→drain re-extraction works; nothing is auto-promoted.
"""

from __future__ import annotations

import json

import gap_report
import gap_suggestion

# A minimal registry: one pack registered, matching sources.json's shape.
_REGISTRY = {
    "manuals": [
        {
            "manual_id": "automationdirect_gs10_gs10m-um",
            "pack_id": "durapulse_gs10",
            "product_family": "DURApulse GS10",
            "vendor": "AutomationDirect",
        },
        # An entry missing pack_id must not be indexed (can't route a gap to it).
        {"manual_id": "orphan_um", "product_family": "Orphan"},
    ]
}


def _report(*packs):
    return {"generated_at": "2026-07-08T00:00:00", "total_gaps": 0, "packs": list(packs)}


def _pack(pack_id, gap_count, tokens):
    return {"pack_id": pack_id, "gap_count": gap_count, "tokens": tokens}


def _tok(token, count, last_asked="2026-07-08T10:00:00", samples=None):
    return {
        "token": token,
        "count": count,
        "last_asked": last_asked,
        "samples": samples if samples is not None else [f"what is {token}?"],
    }


# --- load_pack_manual_index -------------------------------------------------


def test_index_maps_pack_to_manual_and_skips_incomplete():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    assert index["durapulse_gs10"]["manual_id"] == "automationdirect_gs10_gs10m-um"
    assert index["durapulse_gs10"]["product_family"] == "DURApulse GS10"
    # The entry without a pack_id is not indexed.
    assert "orphan_um" not in index
    assert len(index) == 1


def test_index_tolerates_empty_registry():
    assert gap_suggestion.load_pack_manual_index({}) == {}
    assert gap_suggestion.load_pack_manual_index({"manuals": None}) == {}


# --- build_gap_suggestions --------------------------------------------------


def test_registered_pack_over_threshold_becomes_suggestion():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    report = _report(_pack("durapulse_gs10", 5, [_tok("P02.00", 3), _tok("P02.01", 2)]))
    out = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)

    assert len(out) == 1
    s = out[0]
    assert s["suggestion_type"] == "drive_pack_update"
    assert s["risk_level"] == "low"
    ed = s["extracted_data"]
    # The provenance that makes accept→drain re-extraction work.
    assert ed["registry_manual_id"] == "automationdirect_gs10_gs10m-um"
    # Deduped independently from the kb-growth bridge.
    assert ed["source"] == "gap_report"
    assert ed["kind"] == "coverage_gap"
    assert ed["pack_id"] == "durapulse_gs10"
    assert ed["gap_count"] == 5
    assert ed["review_only"] is True
    assert [t["token"] for t in ed["top_tokens"]] == ["P02.00", "P02.01"]


def test_below_threshold_excluded():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    report = _report(_pack("durapulse_gs10", 2, [_tok("P02.00", 2)]))
    assert gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3) == []


def test_unregistered_pack_excluded():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    report = _report(_pack("unknown_pack", 99, [_tok("P02.00", 99)]))
    # No manual to route to → skipped even though it's over the threshold.
    assert gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3) == []


def test_title_and_body_carry_the_worklist():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    report = _report(
        _pack("durapulse_gs10", 4, [_tok("P02.00", 3, samples=["what does P02.00 do"])])
    )
    s = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)[0]
    assert "DURApulse GS10" in s["title"]
    assert "4 unmatched question(s)" in s["title"]
    # Body renders the token worklist + the by-hand grounding command with the id.
    assert "P02.00" in s["body"]
    assert "asked 3×" in s["body"]
    assert "automationdirect_gs10_gs10m-um" in s["body"]
    assert "REVIEW-ONLY" in s["body"]
    assert "update_candidate.py" in s["body"]


def test_token_worklist_capped_on_row():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    many = [_tok(f"P{i:02d}.00", 20 - i) for i in range(15)]
    report = _report(_pack("durapulse_gs10", 200, many))
    s = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)[0]
    assert len(s["extracted_data"]["top_tokens"]) == gap_suggestion._MAX_TOKENS_IN_ROW


def test_multiple_packs_ranked_and_filtered():
    reg = {
        "manuals": [
            {"manual_id": "m_gs10", "pack_id": "durapulse_gs10", "product_family": "GS10"},
            {"manual_id": "m_pf525", "pack_id": "powerflex_525", "product_family": "PF525"},
        ]
    }
    index = gap_suggestion.load_pack_manual_index(reg)
    report = _report(
        _pack("durapulse_gs10", 3, [_tok("P02.00", 3)]),
        _pack("powerflex_525", 10, [_tok("A001", 10)]),
        _pack("unregistered", 50, [_tok("X", 50)]),  # dropped
    )
    out = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)
    packs = [s["extracted_data"]["pack_id"] for s in out]
    assert packs == ["durapulse_gs10", "powerflex_525"]  # report order preserved
    assert "unregistered" not in packs


def test_extracted_data_is_json_serializable():
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    report = _report(_pack("durapulse_gs10", 5, [_tok("P02.00", 5)]))
    s = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)[0]
    # The DB glue does json.dumps(extracted_data) — must not raise.
    round_tripped = json.loads(json.dumps(s["extracted_data"]))
    assert round_tripped["pack_id"] == "durapulse_gs10"


def test_end_to_end_from_raw_rows_via_gap_report():
    """Raw conversation_eval rows → aggregate_gaps → build_gap_suggestions."""
    index = gap_suggestion.load_pack_manual_index(_REGISTRY)
    rows = [
        {"pack_id": "durapulse_gs10", "user_message": "what is P02.00", "created_at": "2026-07-01"},
        {"pack_id": "durapulse_gs10", "user_message": "P02.00 again?", "created_at": "2026-07-02"},
        {"pack_id": "durapulse_gs10", "user_message": "and P02.01?", "created_at": "2026-07-03"},
    ]
    report = gap_report.aggregate_gaps(rows, generated_at="2026-07-08T00:00:00")
    out = gap_suggestion.build_gap_suggestions(report, index, min_gap_count=3)
    assert len(out) == 1
    assert out[0]["extracted_data"]["gap_count"] == 3
