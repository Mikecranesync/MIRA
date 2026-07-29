"""Deterministic multi-sheet system-graph builder — hermetic tests.

Fixture is a fully SYNTHETIC 5-sheet mini-book (fictional tags, no real
corpus content). It exercises every classification and honesty rule:

- sheet 1  clear    : device -1/K01, xref CTRL -> S2 (resolved), MAINS -> EXT (external)
- sheet 2  clear    : device -2/U01, xref CTRL <- S1, FIB -> S3 (unverifiable: peer missing)
- sheet 3  MISSING  : carries a deliberate ev:"obs" device (phantom_observation)
- sheet 4  BLURRED  : carries a deliberate ev:"obs" xref (phantom_observation)
- sheet 5  clear    : -5/A01 ok; -4/X9 (prefix_mismatch); -1/K01 again with a
                      conflicting kind (duplicate_conflict); xrefs FIB2 <- S3
                      (unverifiable), GHOST -> S9 (dangling), BLR <- S4 (unverifiable)
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import systemgraph  # noqa: E402


def _minibook() -> dict:
    return {
        "sheets": [
            {
                "sheet": "1",
                "quality": "clear_upright",
                "devices": [{"tag": "-1/K01", "kind": "contactor", "ev": "obs"}],
                "xrefs": [
                    {"sig": "CTRL", "dir": "out", "peer": "S2.1", "ev": "obs"},
                    {"sig": "MAINS", "dir": "in", "peer": "EXT:PSU", "ev": "obs"},
                ],
            },
            {
                "sheet": "2",
                "quality": "clear_rotated",
                "devices": [{"tag": "-2/U01", "kind": "drive", "ev": "obs"}],
                "xrefs": [
                    {"sig": "CTRL", "dir": "in", "peer": "S1.1", "ev": "obs"},
                    {"sig": "FIB", "dir": "out", "peer": "S3.0", "ev": "obs"},
                ],
            },
            {
                "sheet": "3",
                "quality": "missing",
                "devices": [{"tag": "-3/U02", "kind": "drive", "ev": "obs"}],
                "xrefs": [],
            },
            {
                "sheet": "4",
                "quality": "blurred",
                "devices": [],
                "xrefs": [{"sig": "AUX", "dir": "out", "peer": "S5.0", "ev": "obs"}],
            },
            {
                "sheet": "5",
                "quality": "clear_upright",
                "devices": [
                    {"tag": "-5/A01", "kind": "coupler", "ev": "obs"},
                    {"tag": "-4/X9", "kind": "terminal", "ev": "obs"},
                    {"tag": "-1/K01", "kind": "relay", "ev": "obs"},
                ],
                "xrefs": [
                    {"sig": "FIB2", "dir": "in", "peer": "S3.9", "ev": "obs"},
                    {"sig": "GHOST", "dir": "out", "peer": "S9.1", "ev": "obs"},
                    {"sig": "BLR", "dir": "in", "peer": "S4.2", "ev": "obs"},
                ],
            },
        ]
    }


def _graph() -> dict:
    return systemgraph.build_system_graph(_minibook())


def _edge(graph: dict, sig: str) -> dict:
    matches = [e for e in graph["edges"] if e["sig"] == sig]
    assert matches, f"edge {sig!r} not found in {[e['sig'] for e in graph['edges']]}"
    return matches[0]


def test_edge_classification_covers_all_four_classes():
    g = _graph()
    assert _edge(g, "CTRL")["cls"] == "resolved"
    assert _edge(g, "MAINS")["cls"] == "external"
    assert _edge(g, "GHOST")["cls"] == "dangling"
    # peers that exist but are missing/blurred are UNVERIFIABLE, never resolved
    assert _edge(g, "FIB")["cls"] == "unverifiable"
    assert _edge(g, "FIB2")["cls"] == "unverifiable"
    assert _edge(g, "BLR")["cls"] == "unverifiable"


def test_every_edge_carries_provenance():
    g = _graph()
    for edge in g["edges"]:
        assert edge["src"], edge
        assert edge["ev"] in {"obs", "inf"}, edge


def test_phantom_observation_on_missing_and_blurred_sheets():
    g = _graph()
    phantoms = [v for v in g["violations"] if v["code"] == "phantom_observation"]
    items = {(v["sheet"], v["item"]) for v in phantoms}
    assert ("3", "-3/U02") in items  # device claimed observed on a MISSING sheet
    assert ("4", "AUX") in items  # xref claimed observed on a BLURRED sheet
    # and the phantom facts must NOT enter the graph
    assert "-3/U02" not in {d["tag"] for d in g["devices"]}
    assert not [e for e in g["edges"] if e["sig"] == "AUX"]


def test_prefix_mismatch_violation():
    g = _graph()
    mismatches = [v for v in g["violations"] if v["code"] == "prefix_mismatch"]
    assert any(v["item"] == "-4/X9" and v["sheet"] == "5" for v in mismatches)


def test_duplicate_conflict_and_identity_merge():
    g = _graph()
    # -1/K01 appears on sheets 1 and 5 -> ONE node with both sheets...
    k01 = [d for d in g["devices"] if d["tag"] == "-1/K01"]
    assert len(k01) == 1
    assert set(k01[0]["sheets"]) == {"1", "5"}
    # ...but with conflicting kinds -> flagged
    conflicts = [v for v in g["violations"] if v["code"] == "duplicate_conflict"]
    assert any(v["item"] == "-1/K01" for v in conflicts)


def test_summary_counts_are_consistent():
    g = _graph()
    s = g["summary"]
    assert s["sheets"] == 5
    assert s["observable_sheets"] == 3
    assert s["devices"] == 4  # -1/K01, -2/U01, -5/A01, -4/X9 (phantom excluded)
    by_cls = s["edges_by_class"]
    # CTRL is declared on BOTH endpoints (out on S1, in on S2) — each
    # declaration is its own evidence edge; that duality is what reciprocity
    # checks are built on.
    assert by_cls["resolved"] == 2
    assert by_cls["external"] == 1
    assert by_cls["dangling"] == 1
    assert by_cls["unverifiable"] == 3
    assert s["violations"] == len(g["violations"]) == 4


def test_unobservable_sheet_with_inference_marked_facts_is_allowed():
    """ev:'inf' entries on a missing sheet are the HONEST way to record
    expectations — they must not raise phantom_observation and must land
    in the graph marked ev='inf'."""
    index = _minibook()
    index["sheets"][2]["xrefs"] = [
        {"sig": "EXPECTED_LINK", "dir": "out", "peer": "S2.0", "ev": "inf"}
    ]
    index["sheets"][2]["devices"] = []
    g = systemgraph.build_system_graph(index)
    assert not [v for v in g["violations"] if v["code"] == "phantom_observation"
                and v["sheet"] == "3"]
    edge = _edge(g, "EXPECTED_LINK")
    assert edge["ev"] == "inf"
