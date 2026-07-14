"""Unit tests for the deterministic graph-integrity gates (``printsense.gates``).

Each test demonstrates one failure class on a minimal synthetic graph, plus the clean
case that must pass (the PRD §19.1 matrix). An ATV340-shaped mini-graph proves the
truth-free structural import-blockers fire together (durable spec §3). Dangling-reference
detection is deliberately deferred to the rubric-truth slice — verified here-adjacent that
truth-free dangling checks false-positive on the rich SCU2 graph.
"""

from __future__ import annotations

from printsense import gates


def _codes(failures: list[dict]) -> list[str]:
    return sorted(f["gate"] for f in failures)


# ---- G4 duplicate_identifier ------------------------------------------------


def test_duplicate_ids_flagged():
    g = {
        "devices": [{"tag": "M"}, {"tag": "M"}],
        "terminals": [{"tag": "CN9:PA/+"}, {"tag": "CN9:PA/+"}],
    }
    f = gates.check_duplicate_ids(g)
    assert _codes(f) == ["duplicate_identifier"]
    assert "M" in f[0]["items"] and "CN9:PA/+" in f[0]["items"]


def test_duplicate_ids_variant_qualified_passes():
    # Variant-qualified ids are distinct tags -> not a duplicate (the intended fix).
    g = {"devices": [{"tag": "S1S2:M"}, {"tag": "S3:M"}]}
    assert gates.check_duplicate_ids(g) == []


def test_duplicate_ids_ignores_unreadable():
    g = {"terminals": [{"tag": "UNREADABLE"}, {"tag": "UNREADABLE"}]}
    assert gates.check_duplicate_ids(g) == []


# ---- G8 off_page_from_pagination -------------------------------------------


def test_off_page_from_pagination_flagged():
    g = {
        "package": {"sheet": "1/2"},
        "off_page_references": [{"tag": "2/2", "evidence": "Footer '1/2'"}],
    }
    f = gates.check_off_page_from_pagination(g)
    assert _codes(f) == ["off_page_from_pagination"]
    assert f[0]["items"] == ["2/2"]


def test_off_page_real_reference_passes():
    # A genuine off-page ref (sheet coordinate / destination) is not bare N/M pagination.
    g = {
        "package": {"sheet": "1/2"},
        "off_page_references": [{"tag": "SH3-A5", "detail": "to sheet 3, zone A5"}],
    }
    assert gates.check_off_page_from_pagination(g) == []


def test_off_page_none_passes():
    assert gates.check_off_page_from_pagination({"package": {"sheet": "1/2"}}) == []


# ---- run_gates aggregation + ATV340 shape ----------------------------------


def test_run_gates_clean_graph():
    g = {"devices": [{"tag": "M"}], "terminals": [{"tag": "CN10:U"}]}
    r = gates.run_gates(g)
    assert r["codes"] == []
    assert r["failures"] == []


def test_run_gates_atv340_shape_fires_structural_blockers():
    # A minimal ATV340-shaped graph. The truth-free structural defects (unqualified
    # duplicate ids + pagination-as-off-page) fire here; the dangling CN3 and the
    # exact-label/path defects are caught in the rubric-truth slice.
    g = {
        "package": {"sheet": "1/2"},
        "devices": [{"tag": "ENC"}, {"tag": "ATV340"}],
        "terminals": [
            {"tag": "CN9:PA/+"}, {"tag": "CN9:PA/+"},  # S1/S2 vs S3, unqualified
            {"tag": "CN9:PC/-"}, {"tag": "CN9:PC/-"},
        ],
        "off_page_references": [{"tag": "2/2", "evidence": "Footer '1/2'"}],
    }
    r = gates.run_gates(g)
    assert r["codes"] == ["duplicate_identifier", "off_page_from_pagination"]
