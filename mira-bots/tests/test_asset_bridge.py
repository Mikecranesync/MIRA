"""#3708 — the Python asset bridge mirrors the Hub's and every Python inserter uses it.

Three layers:
  1. unit: ``shared.asset_bridge`` against a scripted DB-API cursor (SQL sequence,
     params, savepoints, idempotency, unique fallback, failure containment);
  2. call sites: hub_neon / pm_scheduler / tools/atlas-hub-sync.py invoke the bridge
     for the row they just inserted, and only for that row;
  3. parity: literal anchors that must appear in BOTH the TypeScript bridge and this
     module, so the two implementations cannot drift silently.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

from shared import asset_bridge
from shared.asset_bridge import (
    DEFAULT_SITE_NAME,
    SLUG_MAX_LEN,
    BridgeResult,
    bridge_asset,
    equipment_path,
    hub_slug,
    site_path,
)

REPO = Path(__file__).resolve().parents[2]
TENANT = "11111111-2222-4333-8444-555555555555"


class _Unique(Exception):
    pgcode = "23505"


class FakeCursor:
    """Records every execute(); serves fetchone() from a plan; can fail a statement once."""

    def __init__(self, plan=(), fail_once: dict[str, Exception] | None = None):
        self.executed: list[tuple[str, object]] = []
        self._plan = list(plan)
        self._fail_once = dict(fail_once or {})

    def execute(self, sql, params=None):
        flat = " ".join(sql.split())
        self.executed.append((flat, params))
        for needle, exc in list(self._fail_once.items()):
            if needle in flat:
                del self._fail_once[needle]
                raise exc

    def fetchone(self):
        return self._plan.pop(0) if self._plan else None

    def sql(self) -> list[str]:
        return [s for s, _ in self.executed]

    def find(self, needle: str) -> list[tuple[str, object]]:
        return [(s, p) for s, p in self.executed if needle in s]


# ---------------------------------------------------------------------------
# 1. unit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("CV-207", "cv_207"),
        ("  Main Site ", "main_site"),
        ("PowerFlex 525 / Line 3", "powerflex_525_line_3"),
        ("!!!", None),
        ("", None),
        (None, None),
        ("x" * 80, "x" * SLUG_MAX_LEN),
    ],
)
def test_hub_slug_matches_uns_ts_slugify(raw, expected):
    assert hub_slug(raw) == expected


def test_path_builders_use_the_hub_grammar():
    assert site_path(DEFAULT_SITE_NAME) == "enterprise.main_site"
    assert equipment_path("enterprise.main_site", "CV-207") == "enterprise.main_site.cv_207"
    assert equipment_path("enterprise.main_site", "???") is None
    assert equipment_path(None, "CV-207") is None


def test_fresh_tenant_mints_site_then_node_then_column():
    # plan: parent SELECT → none; existing-node SELECT → none; INSERT RETURNING → node id
    cur = FakeCursor(plan=[None, None, ("node-1",)])
    res = bridge_asset(
        cur,
        TENANT,
        "asset-1",
        "CV-207",
        description="Infeed conveyor",
        manufacturer="Dorner",
        model="2200",
    )

    assert res == BridgeResult(
        ok=True, uns_path="enterprise.main_site.cv_207", node_id="node-1", created=True
    )
    sql = cur.sql()
    assert sql[0] == "SAVEPOINT asset_bridge" and sql[-1] == "RELEASE SAVEPOINT asset_bridge"

    ((site_sql, site_params),) = cur.find("VALUES (%s::uuid, 'site'")
    assert "ON CONFLICT (tenant_id, entity_type, name)" in site_sql
    assert site_params[0:3] == (TENANT, "main_site", DEFAULT_SITE_NAME)
    assert site_params[4] == "enterprise.main_site"

    ((eq_sql, eq_params),) = cur.find("VALUES (%s::uuid, 'equipment'")
    assert "'verified'" in eq_sql and "RETURNING id" in eq_sql
    assert eq_params[0:3] == (TENANT, "asset-1", "Infeed conveyor")
    assert eq_params[4] == "enterprise.main_site.cv_207"
    assert '"source": "asset_create"' in eq_params[3]
    assert '"manufacturer": "Dorner"' in eq_params[3]

    ((up_sql, up_params),) = cur.find("UPDATE cmms_equipment")
    assert "uns_path IS NULL" in up_sql, "the column backfill must never overwrite a placed row"
    assert up_params == ("enterprise.main_site.cv_207", TENANT, "asset-1")


def test_existing_structural_node_is_the_parent_and_no_site_is_minted():
    cur = FakeCursor(plan=[("enterprise.plant_a.line_1",), None, ("node-2",)])
    res = bridge_asset(cur, TENANT, "asset-2", "MX 9")
    assert res.uns_path == "enterprise.plant_a.line_1.mx_9"
    assert not cur.find("VALUES (%s::uuid, 'site'")


def test_existing_equipment_node_is_reused_and_column_still_stamped():
    cur = FakeCursor(plan=[("enterprise.main_site",), ("node-9",)])
    res = bridge_asset(cur, TENANT, "asset-9", "CV-207")
    assert res == BridgeResult(
        ok=True, uns_path="enterprise.main_site.cv_207", node_id="node-9", created=False
    )
    assert not cur.find("VALUES (%s::uuid, 'equipment'")
    assert cur.find("UPDATE cmms_equipment")


def test_unplaceable_tag_reports_no_uns_path_and_writes_no_node():
    cur = FakeCursor(plan=[("enterprise.main_site",)])
    res = bridge_asset(cur, TENANT, "asset-3", "!!!")
    assert res == BridgeResult(ok=False, reason="no_uns_path")
    assert not cur.find("'equipment'") and not cur.find("UPDATE cmms_equipment")
    assert cur.sql()[-1] == "RELEASE SAVEPOINT asset_bridge"


def test_legacy_slug_tenant_is_refused_before_any_sql(caplog):
    """Codex F1: a ::uuid cast on 'mike' would fail inside the savepoint and be swallowed
    as a transient error. The structural case must be explicit, loud, and SQL-free."""
    cur = FakeCursor(plan=[("enterprise.main_site",), None, ("node-x",)])
    with caplog.at_level("WARNING", logger="mira-gsd"):
        res = bridge_asset(cur, "mike", "asset-7", "CV-207")
    assert res == BridgeResult(ok=False, reason="legacy_tenant")
    assert cur.executed == [], "no SAVEPOINT, no SELECT, no INSERT for a slug tenant"
    assert any(
        "legacy tenant 'mike'" in r.getMessage() and "asset-7" in r.getMessage()
        for r in caplog.records
    )


@pytest.mark.parametrize("tenant", ["", None, "78917b56-0000-4000-8000", "MIKE"])
def test_non_uuid_tenants_never_reach_sql(tenant):
    cur = FakeCursor()
    assert bridge_asset(cur, tenant, "a", "CV-1").reason == "legacy_tenant" and cur.executed == []


def test_name_collision_retries_with_the_tag_suffixed_name():
    cur = FakeCursor(
        plan=[None, None, ("node-4",)],
        fail_once={"VALUES (%s::uuid, 'equipment'": _Unique("dup name")},
    )
    res = bridge_asset(cur, TENANT, "asset-4", "CV-207", description="Pump")
    assert res.ok and res.node_id == "node-4"
    attempts = cur.find("VALUES (%s::uuid, 'equipment'")
    assert [p[2] for _, p in attempts] == ["Pump", "Pump (CV-207)"]
    sql = cur.sql()
    i = sql.index("SAVEPOINT sp_uniq")
    assert (
        "ROLLBACK TO SAVEPOINT sp_uniq" in sql[i:] and sql.count("RELEASE SAVEPOINT sp_uniq") == 1
    )


def test_non_unique_failure_inside_the_bridge_is_contained():
    cur = FakeCursor(
        plan=[None, None, ("node-5",)], fail_once={"UPDATE cmms_equipment": RuntimeError("boom")}
    )
    res = bridge_asset(cur, TENANT, "asset-5", "CV-207")  # must not raise
    assert res == BridgeResult(ok=False, reason="error:RuntimeError")
    sql = cur.sql()
    assert "ROLLBACK TO SAVEPOINT asset_bridge" in sql
    assert sql[-1] == "RELEASE SAVEPOINT asset_bridge"


def test_non_unique_insert_error_is_not_retried_as_a_collision():
    cur = FakeCursor(
        plan=[None, None], fail_once={"VALUES (%s::uuid, 'equipment'": RuntimeError("ltree parse")}
    )
    res = bridge_asset(cur, TENANT, "asset-6", "CV-207")
    assert res.ok is False and res.reason == "error:RuntimeError"
    assert len(cur.find("VALUES (%s::uuid, 'equipment'")) == 1


# ---------------------------------------------------------------------------
# 2. call sites
# ---------------------------------------------------------------------------


def _recorder(monkeypatch, module):
    calls: list[dict] = []

    def fake(cur, tenant_id, asset_id, tag, **kw):
        calls.append({"cur": cur, "tenant_id": tenant_id, "asset_id": asset_id, "tag": tag, **kw})
        return BridgeResult(ok=True, uns_path="enterprise.main_site.x", node_id="n", created=True)

    monkeypatch.setattr(module, "bridge_asset", fake)
    return calls


def test_hub_neon_bridges_the_row_it_inserts(monkeypatch):
    from shared.integrations import hub_neon

    calls = _recorder(monkeypatch, hub_neon)
    cur = FakeCursor(plan=[None, ("eq-77",)])  # lookup miss → INSERT RETURNING
    got = hub_neon._get_or_create_equipment_id(cur, "tenant-x", "CV-207")
    assert got == "eq-77"
    assert calls == [
        {
            "cur": cur,
            "tenant_id": "tenant-x",
            "asset_id": "eq-77",
            "tag": "CV-207",
            "manufacturer": "Unknown",
        }
    ]


def test_hub_neon_does_not_bridge_an_existing_row(monkeypatch):
    from shared.integrations import hub_neon

    calls = _recorder(monkeypatch, hub_neon)
    got = hub_neon._get_or_create_equipment_id(FakeCursor(plan=[("eq-1",)]), "tenant-x", "CV-207")
    assert got == "eq-1" and calls == []


def test_pm_scheduler_bridges_on_the_same_dbapi_connection(monkeypatch):
    from shared import pm_scheduler

    calls = _recorder(monkeypatch, pm_scheduler)
    raw_cursor = FakeCursor()

    class _Result:
        def fetchone(self):
            return None

    class _Conn:
        connection = type("DbApi", (), {"cursor": staticmethod(lambda: raw_cursor)})()

        def execute(self, *_a, **_k):
            return _Result()

    class _Engine:
        def begin(self):
            conn = _Conn()

            class _Ctx:
                def __enter__(self_inner):
                    return conn

                def __exit__(self_inner, *exc):
                    return False

            return _Ctx()

        def dispose(self):
            pass

    monkeypatch.setattr(pm_scheduler, "_get_neon_engine", lambda: _Engine())
    new_id = pm_scheduler._resolve_equipment_id("Dorner", "2200", None, "tenant-y")
    assert calls == [
        {
            "cur": raw_cursor,
            "tenant_id": "tenant-y",
            "asset_id": new_id,
            "tag": "DORN-2200",
            "manufacturer": "Dorner",
            "model": "2200",
        }
    ]


def test_pm_scheduler_hint_and_lookup_hit_skip_the_bridge(monkeypatch):
    from shared import pm_scheduler

    calls = _recorder(monkeypatch, pm_scheduler)
    assert pm_scheduler._resolve_equipment_id("D", "M", "hinted-id", "t") == "hinted-id"
    assert calls == []


def _load_atlas_sync():
    spec = importlib.util.spec_from_file_location(
        "atlas_hub_sync", REPO / "tools/atlas-hub-sync.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["atlas_hub_sync"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("returned, expect_bridge", [(("neon-3",), True), (None, False)])
def test_atlas_sync_bridges_only_a_row_it_actually_inserted(monkeypatch, returned, expect_bridge):
    mod = _load_atlas_sync()
    calls = _recorder(monkeypatch, mod)
    cur = FakeCursor(plan=[returned])
    conn = type("Conn", (), {"cursor": staticmethod(lambda: cur)})()
    atlas_row = {
        "id": 42,
        "name": "CV-207",
        "model": "2200",
        "serialNumber": "S1",
        "location": "Line 1",
        "description": "Infeed",
        "updated_at": "2026-01-01",
        "updatedAt": "2026-01-01",
    }
    mod.insert_into_neon(conn, "tenant-z", "CV-207", atlas_row)
    ((ins_sql, _),) = cur.find("INSERT INTO cmms_equipment")
    assert "RETURNING id" in ins_sql
    if expect_bridge:
        assert len(calls) == 1 and calls[0]["asset_id"] == "neon-3" and calls[0]["tag"] == "CV-207"
    else:
        assert calls == []


# ---------------------------------------------------------------------------
# 3. parity with the TypeScript bridge
# ---------------------------------------------------------------------------

_TS_FILES = [
    "mira-hub/src/lib/knowledge-graph/asset-bridge.ts",
    "mira-hub/src/lib/knowledge-graph/cmms-sync.ts",
    "mira-hub/src/lib/uns.ts",
    "mira-hub/src/lib/pg-unique-retry.ts",
]

# Literal anchors that MUST appear in both implementations. Change one side and
# this fails until the other side follows.
_PARITY_ANCHORS = [
    'DEFAULT_SITE_NAME = "Main Site"',
    "ON CONFLICT (tenant_id, entity_type, name) DO UPDATE",
    "SET uns_path = COALESCE(kg_entities.uns_path, EXCLUDED.uns_path)",
    "entity_type IN ('site', 'plant', 'line', 'production_line')",
    "ORDER BY nlevel(uns_path) DESC, updated_at DESC",
    "entity_type = 'equipment' AND entity_id =",
    '"asset_create_default_site"',
    '"asset_create"',
    "'verified'",
    "AND uns_path IS NULL",
    "23505",
]


def _norm(text: str) -> str:
    return " ".join(text.split())


def test_python_bridge_carries_the_typescript_anchors():
    ts = _norm("\n".join((REPO / f).read_text() for f in _TS_FILES))
    py = _norm(Path(asset_bridge.__file__).read_text())
    missing = [a for a in _PARITY_ANCHORS if a not in ts or a not in py]
    assert not missing, f"bridge parity broken — anchor missing on one side: {missing}"


def test_slug_rules_match_uns_ts():
    ts = (REPO / "mira-hub/src/lib/uns.ts").read_text()
    assert re.search(r"\.replace\(/\[\^a-z0-9\]\+/g, \"_\"\)", ts), "uns.ts slug regex moved"
    assert f".slice(0, {SLUG_MAX_LEN})" in ts, "uns.ts slug cap changed — update SLUG_MAX_LEN"
