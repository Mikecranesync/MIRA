"""Typed contradiction detection in the system graph (Phase B, W3). Hermetic.

Synthetic fixtures only. Six contradiction types:
alias_variation, kind_mismatch, terminal_conflict, contact_semantic_conflict,
impossible_continuity, safety_significant (escalation flag on the others).
Phase A `violations` codes stay unchanged (compat)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import systemgraph  # noqa: E402


def _index(**overrides) -> dict:
    base = {
        "safety_critical": ["61/62"],
        "sheets": [
            {
                "sheet": "1",
                "quality": "clear_upright",
                "devices": [{"tag": "-1/K01", "kind": "contactor", "ev": "obs"}],
                "contact_chains": [{"chain": "61/62", "form": "NC"}],
                "xrefs": [
                    {"sig": "CTRL", "dir": "out", "peer": "S2.1", "ev": "obs",
                     "terminal": "-1/K01:13"},
                    {"sig": "PWR", "dir": "out", "peer": "S2.4", "ev": "obs"},
                ],
            },
            {
                "sheet": "2",
                "quality": "clear_upright",
                "devices": [{"tag": "-1/K01:24VDC", "kind": "contactor", "ev": "obs"}],
                "contact_chains": [{"chain": "61/62", "form": "NO"}],
                "xrefs": [
                    {"sig": "PWR", "dir": "out", "peer": "S1.4", "ev": "obs"},
                ],
            },
            {
                "sheet": "3",
                "quality": "clear_upright",
                "devices": [],
                "xrefs": [
                    {"sig": "CTRL2", "dir": "out", "peer": "S4.1", "ev": "obs",
                     "terminal": "-1/K01:13"},
                ],
            },
            {"sheet": "4", "quality": "clear_upright", "devices": [], "xrefs": []},
        ],
    }
    base.update(overrides)
    return base


def _types(graph: dict) -> list[str]:
    return [c["type"] for c in graph["contradictions"]]


def test_alias_variation_detected_across_sheets():
    g = systemgraph.build_system_graph(_index())
    aliases = [c for c in g["contradictions"] if c["type"] == "alias_variation"]
    assert aliases, _types(g)
    forms = set(aliases[0]["forms"])
    assert forms == {"-1/K01", "-1/K01:24VDC"}


def test_kind_mismatch_re_emitted_as_typed_contradiction():
    idx = _index()
    idx["sheets"][1]["devices"][0] = {"tag": "-1/K01", "kind": "relay", "ev": "obs"}
    g = systemgraph.build_system_graph(idx)
    assert "kind_mismatch" in _types(g)
    # Phase A compat: the untyped violation code is still present
    assert any(v["code"] == "duplicate_conflict" for v in g["violations"])


def test_terminal_conflict_same_terminal_two_peers():
    g = systemgraph.build_system_graph(_index())
    conflicts = [c for c in g["contradictions"] if c["type"] == "terminal_conflict"]
    assert conflicts, _types(g)
    c = conflicts[0]
    assert c["terminal"] == "-1/K01:13"
    assert set(c["peer_sheets"]) == {"2", "4"}


def test_contact_semantic_conflict_and_safety_escalation():
    g = systemgraph.build_system_graph(_index())
    conflicts = [c for c in g["contradictions"]
                 if c["type"] == "contact_semantic_conflict"]
    assert conflicts, _types(g)
    c = conflicts[0]
    assert c["chain"] == "61/62"
    assert set(c["forms"]) == {"NC", "NO"}
    # 61/62 is in safety_critical -> escalated
    assert c["safety"] is True


def test_impossible_continuity_both_ends_drive_out():
    g = systemgraph.build_system_graph(_index())
    conflicts = [c for c in g["contradictions"]
                 if c["type"] == "impossible_continuity"]
    assert conflicts, _types(g)
    c = conflicts[0]
    assert c["sig"] == "PWR"
    assert set(c["sheets"]) == {"1", "2"}
    # phantom always-driven signals always escalate (safety review)
    assert c["safety"] is True


def test_non_safety_contradiction_not_escalated():
    g = systemgraph.build_system_graph(_index())
    terminal = [c for c in g["contradictions"] if c["type"] == "terminal_conflict"][0]
    assert terminal.get("safety") is not True


def test_clean_index_has_no_contradictions():
    idx = {
        "sheets": [
            {"sheet": "1", "quality": "clear_upright",
             "devices": [{"tag": "-1/K01", "kind": "contactor", "ev": "obs"}],
             "xrefs": [{"sig": "CTRL", "dir": "out", "peer": "S2.1", "ev": "obs"}]},
            {"sheet": "2", "quality": "clear_upright", "devices": [],
             "xrefs": [{"sig": "CTRL", "dir": "in", "peer": "S1.1", "ev": "obs"}]},
        ]
    }
    g = systemgraph.build_system_graph(idx)
    assert g["contradictions"] == []
    assert g["summary"]["contradictions"] == 0
