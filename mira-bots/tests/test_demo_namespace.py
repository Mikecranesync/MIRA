"""Offline tests for the demo-namespace resolver.

The resolver's DB lookup path is exercised in integration tests against a
seeded NeonDB; here we cover only the candidate-extraction helper, which
runs purely on the message string.

Spec: docs/plans/2026-05-14-demo-backend-plan.md (Phase 6 of the
2026-05-15 PR).
"""

from __future__ import annotations

from shared.demo_namespace import (
    DemoNamespaceMatch,
    _extract_candidates,
    resolve_demo_namespace,
)


def test_extract_tag_pe001():
    tags, names = _extract_candidates("PE-001 isn't reading")
    assert "PE-001" in tags
    assert names == []


def test_extract_tag_case_insensitive():
    tags, _ = _extract_candidates("pe-001 and mtr-001 are misbehaving")
    assert "PE-001" in tags
    assert "MTR-001" in tags


def test_extract_asset_name_conveyor_001():
    _, names = _extract_candidates("I'm working on Conveyor 001 today")
    # Name is preserved in original casing for ILIKE
    assert any(n.lower() == "conveyor 001" for n in names)


def test_extract_mixed_tag_and_name():
    tags, names = _extract_candidates(
        "Conveyor 001 keeps shutting off when PE-001 sees a tote"
    )
    assert "PE-001" in tags
    assert any(n.lower() == "conveyor 001" for n in names)


def test_extract_no_match_returns_empty():
    tags, names = _extract_candidates("Hello, I have a general question")
    assert tags == []
    assert names == []


def test_extract_ignores_short_garbage():
    # Single-letter prefixes or short numbers should NOT trip the tag regex
    tags, _ = _extract_candidates("F1 and X1 are not asset tags")
    assert tags == []


def test_resolve_returns_none_without_tenant():
    """No tenant → no lookup, no exception."""
    assert resolve_demo_namespace("Conveyor 001 down", None) is None


def test_resolve_returns_none_without_neon_url(monkeypatch):
    """No NEON_DATABASE_URL → graceful None."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    assert (
        resolve_demo_namespace("PE-001 not reading", "some-tenant-id")
        is None
    )


def test_resolve_returns_none_without_candidates(monkeypatch):
    """Message that doesn't mention any tag/name short-circuits before DB."""
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://nowhere")
    assert resolve_demo_namespace("Generic greeting hi", "tenant") is None


def test_match_dataclass_shape():
    m = DemoNamespaceMatch(
        asset_id="a",
        asset_name="Conveyor 001",
        asset_tag="CV-001",
        component_id="c",
        component_name="PE-001",
        component_plc_tag="Line5.CV001.PE001",
        matched_terms=("Conveyor 001", "PE-001"),
        confidence=1.0,
        uns_path="enterprise.demo.site.lake_wales",
    )
    d = m.as_dict()
    assert d["matched_terms"] == ["Conveyor 001", "PE-001"]
    assert d["confidence"] == 1.0
    assert d["asset_tag"] == "CV-001"
