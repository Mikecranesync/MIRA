"""#3708 step 4 — tools/cmms_equipment_uns_backfill.py runs every row through the
asset bridge and reconciles the column to the node. No DB: the script is loaded
by path, `bridge_asset` is replaced with a recorder, the engine is a fake."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from shared.asset_bridge import BridgeResult

REPO = Path(__file__).resolve().parents[2]
TENANT = "11111111-1111-4111-8111-111111111111"


@pytest.fixture(scope="module")
def bf():
    spec = importlib.util.spec_from_file_location(
        "cmms_backfill_under_test", REPO / "tools/cmms_equipment_uns_backfill.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cmms_backfill_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod


class FakeCursor:
    def __init__(self):
        self.executed: list[tuple[str, object]] = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))


def _row(**over):
    base = dict(
        id="a1",
        tenant_id=TENANT,
        equipment_number="CV-207",
        description="Infeed",
        manufacturer="Dorner",
        model_number="2200",
        current_path=None,
        node_path=None,
    )
    return SimpleNamespace(**{**base, **over})


def _recorder(monkeypatch, bf, result):
    calls = []

    def fake(cur, tenant_id, asset_id, tag, **kw):
        calls.append({"tenant_id": tenant_id, "asset_id": asset_id, "tag": tag, **kw})
        return result

    monkeypatch.setattr(bf, "bridge_asset", fake)
    return calls


def test_null_column_row_is_bridged_and_counted_as_set(bf, monkeypatch):
    calls = _recorder(
        monkeypatch,
        bf,
        BridgeResult(ok=True, uns_path="enterprise.main_site.cv_207", node_id="n1", created=True),
    )
    cur, stats = FakeCursor(), bf.Stats()
    bf.bridge_row(cur, _row(), stats)
    assert calls == [
        {
            "tenant_id": TENANT,
            "asset_id": "a1",
            "tag": "CV-207",
            "description": "Infeed",
            "manufacturer": "Dorner",
            "model": "2200",
        }
    ]
    assert (stats.nodes_created, stats.column_set, stats.column_reconciled) == (1, 1, 0)
    assert not cur.executed, (
        "the bridge's own NULL-only backfill stamped the column; no extra UPDATE"
    )


def test_isa95_stamped_row_is_reconciled_to_the_node_path(bf, monkeypatch):
    """The 2026-09-09 rows: column holds the ISA-95 form, no node. Column must follow the node."""
    _recorder(
        monkeypatch,
        bf,
        BridgeResult(ok=True, uns_path="enterprise.main_site.cv_207", node_id="n1", created=True),
    )
    cur, stats = FakeCursor(), bf.Stats()
    bf.bridge_row(
        cur,
        _row(current_path="enterprise.t.site.unassigned.area.unassigned.equipment.cv_207"),
        stats,
    )
    ((sql, params),) = cur.executed
    assert sql.startswith("UPDATE cmms_equipment SET uns_path = %s::ltree")
    assert params == ("enterprise.main_site.cv_207", TENANT, "a1")
    assert stats.column_reconciled == 1 and stats.column_set == 0


def test_agreeing_row_with_existing_node_writes_nothing(bf, monkeypatch):
    _recorder(
        monkeypatch,
        bf,
        BridgeResult(ok=True, uns_path="enterprise.main_site.cv_207", node_id="n9", created=False),
    )
    cur, stats = FakeCursor(), bf.Stats()
    bf.bridge_row(cur, _row(current_path="enterprise.main_site.cv_207"), stats)
    assert not cur.executed and stats.nodes_existing == 1 and stats.column_reconciled == 0


def test_bridge_failure_is_counted_by_reason_and_never_reconciles(bf, monkeypatch):
    _recorder(monkeypatch, bf, BridgeResult(ok=False, reason="no_uns_path"))
    cur, stats = FakeCursor(), bf.Stats()
    bf.bridge_row(cur, _row(equipment_number="???", current_path="x.y"), stats)
    assert stats.failed == {"no_uns_path": 1} and not cur.executed


def test_legacy_slug_tenant_is_never_sent_to_the_bridge(bf, monkeypatch):
    calls = _recorder(
        monkeypatch, bf, BridgeResult(ok=True, uns_path="p", node_id="n", created=True)
    )
    stats = bf.Stats()
    bf.bridge_row(FakeCursor(), _row(tenant_id="mike"), stats)
    assert calls == [] and stats.legacy_tenant == 1


def test_blank_equipment_number_falls_back_to_the_row_id_as_tag(bf, monkeypatch):
    calls = _recorder(
        monkeypatch, bf, BridgeResult(ok=True, uns_path="p", node_id="n", created=True)
    )
    bf.bridge_row(FakeCursor(), _row(equipment_number="  "), bf.Stats())
    assert calls[0]["tag"] == "a1"


def test_verification_is_clean_only_when_all_three_counts_are_zero(bf):
    V = bf.Verification
    assert V(total=10, legacy_tenant_rows=2, missing_path=0, missing_node=0, mismatched=0).clean
    assert (
        not V(10, 0, 1, 0, 0).clean and not V(10, 0, 0, 1, 0).clean and not V(10, 0, 0, 0, 1).clean
    )


def test_verification_sql_joins_the_node_by_tenant_and_entity_id_and_excludes_legacy_tenants(bf):
    sql = " ".join(bf._VERIFY.split())
    assert (
        "k.entity_type = 'equipment' AND k.entity_id = e.id::text AND k.tenant_id::text = e.tenant_id"
        in sql
    )
    assert "e.tenant_id !~ :uuid_re" in sql and "k.uns_path <> e.uns_path" in sql


def test_dry_run_bridges_nothing(bf, monkeypatch):
    calls = _recorder(
        monkeypatch, bf, BridgeResult(ok=True, uns_path="p", node_id="n", created=True)
    )
    rows = [_row(), _row(id="a2")]

    class _Res:
        def __init__(self, items):
            self._items = items

        def __iter__(self):
            return iter(self._items)

        def one(self):
            return SimpleNamespace(
                total=2, legacy_tenant_rows=0, missing_path=2, missing_node=2, mismatched=0
            )

    class _Conn:
        def execute(self, stmt, params=None):
            return _Res(
                rows
                if "LEFT JOIN kg_entities k" in str(stmt) and "count(*)" not in str(stmt)
                else []
            )

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Engine:
        def connect(self):
            return _Conn()

        def begin(self):
            raise AssertionError("dry-run must never open a write transaction")

    monkeypatch.setattr(bf, "_engine", lambda: _Engine())
    stats, v = bf.run(None, 100, commit=False)
    assert calls == [] and stats.scanned == 2 and v.missing_node == 2
