"""LLM-disabled contract tests for the SCU2 gold package.

The committed PrintSynth graph must validate against the typed IR and satisfy the spec's acceptance
anchors + no-invention/PE-segregation invariants -- entirely from ``fixtures/scu2/graph.json``, with no
LLM or network call. This is the framework's regression floor: it proves a *learned* package answers
deterministically.

Guarded with ``importorskip("pydantic")`` so the lean offline-eval sweep skips it cleanly; it runs in
the dedicated PrintSense CI step (which installs pydantic).
"""

import pytest

pytest.importorskip("pydantic")

from printsense.models import PrintSynthGraph, TrustState, load_package  # noqa: E402


def _scu2() -> PrintSynthGraph:
    return load_package("scu2")


def test_graph_validates_against_ir():
    assert isinstance(_scu2(), PrintSynthGraph)


def test_acceptance_anchor_entities_present():
    tags = " ".join(e.tag for e in _scu2().all_entities())
    for anchor in ("-3/F1", "-3/F2", "-3/E1", "-4/G1", "-5/A100", "-5/A107"):
        assert anchor in tags, f"missing acceptance anchor {anchor}"


def test_f1_and_f2_are_distinct_branches():
    g = _scu2()
    assert g.find("-3/F1") and g.find("-3/F2")


def test_w_cables_are_cables_not_devices():
    g = _scu2()
    cable_tags = {c.tag for c in g.cables}
    device_tags = {d.tag for d in g.devices}
    assert any("W5443" in t for t in cable_tags) and any("W5471" in t for t in cable_tags)
    assert not any("W5443" in t or "W5471" in t for t in device_tags)


def test_pe_segregated_from_current_paths():
    g = _scu2()
    assert g.pe_bonds, "no PE bonds in graph"
    for pe in g.pe_bonds:
        t = (pe.type or "").lower()
        assert "line" not in t and "neutral" not in t, f"PE bond mislabeled as current path: {pe.tag}"


def test_seed_is_all_proposed_nothing_auto_verified():
    for e in _scu2().all_entities():
        assert e.trust == TrustState.proposed, f"{e.tag} was auto-promoted to {e.trust}"


def test_json_schema_exports():
    schema = PrintSynthGraph.model_json_schema()
    assert schema["title"] == "PrintSynthGraph"
    assert "devices" in schema["properties"]
