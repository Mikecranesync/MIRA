"""Scout reports + frontier packets — evidence links, determinism (PR-G).

Synthetic fictional package: sheets 91-93, pages pA/pB/pC, devices -91/K01…
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import packets, reports  # noqa: E402

MANIFEST = {"pages": [
    {"page_sha": "pA", "source_index": 0, "duplicate_of": None},
    {"page_sha": "pB", "source_index": 1, "duplicate_of": None},
    {"page_sha": "pC", "source_index": 2, "duplicate_of": None},
    {"page_sha": "pA", "source_index": 3, "duplicate_of": 0},
]}
PAYLOADS = {
    "pA": {"sheet_id": "91", "sheet_title": "supply",
           "devices": [{"tag": "-91/K01", "bbox": [1, 2, 3, 4]}]},
    "pB": {"sheet_id": "92", "sheet_title": "control",
           "devices": [{"tag": "-92/K02"}]},
    "pC": {"sheet_id": "93", "unreadable": True, "devices": []},
}
XREFS = [
    {"source_page": "91", "raw_reference": "92.1 / K911",
     "resolution": "resolved", "target_page": "pB",
     "target_sheet_lexical": "92", "evidence_bbox": [9, 9, 20, 20]},
    {"source_page": "91", "raw_reference": "99.1 / K999",
     "resolution": "missing_target", "target_page": None,
     "target_sheet_lexical": "99"},
    {"source_page": "92", "raw_reference": "93.4 / K912",
     "resolution": "contradictory", "target_page": "pC",
     "target_sheet_lexical": "93"},
]


def _env():
    return reports.build_scout_reports(MANIFEST, PAYLOADS, XREFS)


def test_banner_and_no_reconstruction_claim():
    env = _env()
    assert env["banner"].startswith("Preliminary package inventory")
    assert env["system_reconstruction_performed"] is False


def test_device_register_links_page_evidence():
    inv = _env()["inventory"]
    row = inv["device_register"]["-91/K01"][0]
    assert row["page_sha"] == "pA" and row["bbox"] == [1, 2, 3, 4]
    assert inv["page_device_index"]["-92/K02"] == ["pB"]


def test_missing_duplicate_unreadable_reports():
    inv = _env()["inventory"]
    assert inv["missing_page_report"] == [
        {"sheet_id": "99", "evidence": "referenced by extracted xref"}]
    assert inv["duplicate_page_report"][0]["page_sha"] == "pA"
    assert inv["unreadable_page_report"][0]["page_sha"] == "pC"


def test_subsystem_clusters_follow_resolved_xrefs_only():
    inv = _env()["inventory"]
    clusters = inv["subsystem_clusters"]
    assert ["pA", "pB"] in clusters          # linked by the resolved edge
    assert ["pC"] in clusters                # contradictory edge never links


def test_xref_and_contradiction_reports_partition():
    inv = _env()["inventory"]
    assert len(inv["xref_report"]["resolved"]) == 1
    assert len(inv["xref_report"]["unresolved"]) == 1
    assert len(inv["contradiction_report"]) == 1


def test_packet_deterministic_content_addressed_and_scoped():
    kw = dict(subsystem="Synthetic Unit 91",
              relevant_pages=["pA", "pB", "91", "92"],
              xref_records=XREFS, device_count=2,
              ocr_excerpts=[{"page_sha": "pA", "text": "K01"},
                            {"page_sha": "pZ", "text": "out-of-scope"}])
    p1, p2 = packets.build_packet(**kw), packets.build_packet(**kw)
    assert p1["packet_id"] == p2["packet_id"]
    assert p1["resolved_xrefs"] == 1 and p1["contradictions"] == 1
    assert all(e["page_sha"] != "pZ" for e in p1["ocr_excerpts"])
    assert not any("provider" in k or "model" in k for k in p1)


def test_packet_schema_and_bounds_fail_closed():
    with pytest.raises(ValueError):
        packets.build_packet("s", ["p1"], [], 0,
                             requested_outputs=["write_marketing_copy"])
    big = [{"page_sha": "p1", "text": "x" * 70000}]
    with pytest.raises(ValueError):
        packets.build_packet("s", ["p1"], [], 0, ocr_excerpts=big)
