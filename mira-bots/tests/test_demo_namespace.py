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
    tags, names = _extract_candidates("Conveyor 001 keeps shutting off when PE-001 sees a tote")
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
    assert resolve_demo_namespace("PE-001 not reading", "some-tenant-id") is None


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


# ── cmms_equipment fallback tier (2026-08-02 round-3 probe) ─────────────────
#
# Staging CV-101 exists ONLY in cmms_equipment (the physical-asset registry
# the relay allowlist seed, QR deep-link, and live overlay key on) — the gate
# looped with candidate=None on the literal tag. The resolver must fall back
# to cmms_equipment.equipment_number when kg_entities has no row.


def _fake_sqlalchemy(rows_by_marker):
    """Fake sqlalchemy modules whose conn dispatches on a SQL substring."""
    import types

    class _Row:
        def __init__(self, mapping):
            self._mapping = mapping

    class _Result:
        def __init__(self, row):
            self._row = row

        def fetchone(self):
            return _Row(self._row) if self._row else None

    class _Conn:
        def execute(self, sql, params):
            for marker, row in rows_by_marker.items():
                if marker in str(sql):
                    return _Result(row)
            return _Result(None)

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    class _Engine:
        def connect(self):
            return _Conn()

    fake = types.SimpleNamespace(create_engine=lambda *a, **k: _Engine(), text=lambda s: s)
    fake_pool = types.SimpleNamespace(NullPool=object())
    return {"sqlalchemy": fake, "sqlalchemy.pool": fake_pool}


def test_resolve_falls_back_to_cmms_equipment(monkeypatch):
    import sys
    from unittest.mock import patch

    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://test")
    fakes = _fake_sqlalchemy(
        {
            "FROM cmms_equipment": {
                "id": "42",
                "name": "Conv_Simple Bench Conveyor",
                "asset_tag": "CV-101",
                "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
            },
        }
    )
    with patch.dict(sys.modules, fakes):
        m = resolve_demo_namespace("cv-101 conveyor", "tenant-uuid")

    assert m is not None
    assert m.asset_tag == "CV-101"
    assert m.uns_path == "enterprise.home_garage.conveyor_lab.conveyor_1"
    # ≥ the engine's 0.7 gate-candidate threshold, so the confirm prompt fires
    # with the equipment named instead of the generic make/model ask.
    assert m.confidence >= 0.7


def test_resolve_prefers_kg_entities_over_cmms(monkeypatch):
    """kg_entities is the verified namespace — cmms is a fallback, not a rival."""
    import sys
    from unittest.mock import patch

    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://test")
    fakes = _fake_sqlalchemy(
        {
            "FROM kg_entities": {
                "id": "kg-1",
                "name": "Bench Conveyor",
                "asset_tag": "CV-101",
                "uns_path": "enterprise.garage.demo_cell.cv_101",
            },
            "FROM cmms_equipment": {
                "id": "42",
                "name": "Conv_Simple Bench Conveyor",
                "asset_tag": "CV-101",
                "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
            },
        }
    )
    with patch.dict(sys.modules, fakes):
        m = resolve_demo_namespace("CV-101 is stopped", "tenant-uuid")

    assert m is not None
    assert m.asset_id == "kg-1"
    assert m.uns_path == "enterprise.garage.demo_cell.cv_101"
