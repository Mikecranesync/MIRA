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
    CreatedEquipment,
    LegacyTenantError,
    bridge_asset,
    create_equipment,
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
# 2. create_equipment — the ONE creation path — and the three writers on it
# ---------------------------------------------------------------------------


def test_create_equipment_refuses_a_legacy_tenant_before_any_sql():
    cur = FakeCursor()
    with pytest.raises(LegacyTenantError, match="not a UUID"):
        create_equipment(cur, "mike", "CV-207", columns={"equipment_number": "CV-207"})
    assert cur.executed == [], "refusal happens BEFORE the insert, so nothing is committed unplaced"


def test_create_equipment_inserts_then_bridges_the_returned_id():
    # plan: INSERT RETURNING → ("eq-9",); then the bridge: parent SELECT, node SELECT, node INSERT
    cur = FakeCursor(plan=[("eq-9",), None, None, ("node-1",)])
    got = create_equipment(
        cur,
        TENANT,
        "CV-207",
        columns={"equipment_number": "CV-207", "manufacturer": "Dorner"},
        raw={"created_at": "NOW()"},
        conflict="ON CONFLICT (id) DO NOTHING",
        manufacturer="Dorner",
    )
    (sql, params), *_ = cur.executed
    assert sql == (
        "INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, created_at) "
        "VALUES (%s, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING RETURNING id"
    )
    assert params == (TENANT, "CV-207", "Dorner")
    assert got.id == "eq-9" and got.bridge is not None and got.bridge.ok
    ((up_sql, up_params),) = cur.find("UPDATE cmms_equipment")
    assert up_params == ("enterprise.main_site.cv_207", TENANT, "eq-9")


def test_create_equipment_skipped_by_on_conflict_bridges_nothing():
    cur = FakeCursor(plan=[None])
    got = create_equipment(
        cur, TENANT, "CV-207", columns={"id": "x"}, conflict="ON CONFLICT (id) DO NOTHING"
    )
    assert got == CreatedEquipment(id=None, bridge=None)
    assert len(cur.executed) == 1, "no bridge for a row that was not inserted"


@pytest.mark.parametrize(
    "columns, raw",
    [
        ({"equipment_number; DROP TABLE x": "a"}, None),
        ({"ok": "a"}, {"ok2": "NOW(); DROP"}),
        ({"Bad-Name": "a"}, None),
    ],
)
def test_create_equipment_rejects_unsafe_identifiers_and_expressions(columns, raw):
    cur = FakeCursor()
    with pytest.raises(ValueError, match="refusing"):
        create_equipment(cur, TENANT, "t", columns=columns, raw=raw)
    assert cur.executed == []


def _creator(monkeypatch, module, result=None, raises=None):
    calls = []

    def fake(cur, tenant_id, tag, **kw):
        calls.append({"cur": cur, "tenant_id": tenant_id, "tag": tag, **kw})
        if raises:
            raise raises
        return result or CreatedEquipment(
            id="created-id", bridge=BridgeResult(ok=True, uns_path="p", node_id="n", created=True)
        )

    monkeypatch.setattr(module, "create_equipment", fake)
    return calls


def test_hub_neon_creates_through_the_helper_with_its_columns(monkeypatch):
    from shared.integrations import hub_neon

    calls = _creator(monkeypatch, hub_neon)
    got = hub_neon._get_or_create_equipment_id(FakeCursor(plan=[None]), "tenant-x", "CV-207")
    assert got == "created-id"
    (c,) = calls
    assert (c["tenant_id"], c["tag"], c["conflict"]) == (
        "tenant-x",
        "CV-207",
        "ON CONFLICT (id) DO NOTHING",
    )
    assert (
        c["columns"]["equipment_number"] == "CV-207" and c["columns"]["manufacturer"] == "Unknown"
    )
    assert c["columns"]["id"] == got or c["columns"]["id"]  # a fresh uuid was minted for the insert


def test_hub_neon_does_not_create_for_an_existing_row(monkeypatch):
    from shared.integrations import hub_neon

    calls = _creator(monkeypatch, hub_neon)
    assert (
        hub_neon._get_or_create_equipment_id(FakeCursor(plan=[("eq-1",)]), "tenant-x", "CV-207")
        == "eq-1"
    )
    assert calls == []


def test_hub_neon_work_order_reports_an_error_for_a_legacy_tenant(monkeypatch):
    """The refusal must surface as the {"error": …} contract, not a committed half-machine."""
    from shared.integrations import hub_neon

    _creator(monkeypatch, hub_neon, raises=LegacyTenantError("tenant 'mike' is not a UUID"))
    monkeypatch.setenv("NEON_DATABASE_URL", "postgres://test")

    class _Conn:
        committed = False

        def cursor(self):
            return FakeCursor(plan=[None])

        def commit(self):
            self.committed = True

        def rollback(self):
            pass

        def close(self):
            pass

    conn = _Conn()
    monkeypatch.setattr(hub_neon.psycopg2, "connect", lambda *_a, **_k: conn)
    res = hub_neon.create_hub_work_order(
        tenant_id="mike",
        user_id="u1",
        title="t",
        description="d",
        priority="normal",
        asset_name="CV-207",
    )
    assert "error" in res and "not a UUID" in res["error"]
    assert conn.committed is False


def test_pm_scheduler_creates_through_the_helper_on_the_same_dbapi_connection(monkeypatch):
    from shared import pm_scheduler

    calls = _creator(monkeypatch, pm_scheduler)
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
    (c,) = calls
    assert c["cur"] is raw_cursor and c["tenant_id"] == "tenant-y" and c["tag"] == "DORN-2200"
    assert c["columns"]["id"] == new_id and c["raw"] == {
        "created_at": "NOW()",
        "updated_at": "NOW()",
    }


def test_pm_scheduler_returns_none_for_a_legacy_tenant_and_creates_no_work_order(monkeypatch):
    from shared import pm_scheduler

    _creator(monkeypatch, pm_scheduler, raises=LegacyTenantError("tenant 'mike' is not a UUID"))

    class _Engine:
        def begin(self):
            class _Ctx:
                def __enter__(self_inner):
                    class _Conn:
                        connection = type("DbApi", (), {"cursor": staticmethod(FakeCursor)})()

                        def execute(self, *_a, **_k):
                            return type("R", (), {"fetchone": staticmethod(lambda: None)})()

                    return _Conn()

                def __exit__(self_inner, *exc):
                    return False

            return _Ctx()

        def dispose(self):
            pass

    monkeypatch.setattr(pm_scheduler, "_get_neon_engine", lambda: _Engine())
    assert pm_scheduler._resolve_equipment_id("Dorner", "2200", None, "mike") is None
    # and _insert_work_order stops before touching the DB when there is no equipment
    monkeypatch.setattr(pm_scheduler, "_resolve_equipment_id", lambda *_a, **_k: None)
    engine_touched = []
    monkeypatch.setattr(pm_scheduler, "_get_neon_engine", lambda: engine_touched.append(1))
    assert (
        pm_scheduler._insert_work_order(
            {
                "id": "pm-1",
                "name": "Belt check",
                "task": "Inspect belt",
                "manufacturer": "D",
                "model_number": "M",
                "tenant_id": "mike",
                "criticality": "medium",
                "interval_value": 30,
                "interval_unit": "days",
            }
        )
        is None
    )
    assert engine_touched == []


def test_pm_scheduler_hint_and_lookup_hit_skip_creation(monkeypatch):
    from shared import pm_scheduler

    calls = _creator(monkeypatch, pm_scheduler)
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


def test_atlas_sync_creates_through_the_helper_with_its_columns(monkeypatch):
    mod = _load_atlas_sync()
    calls = _creator(monkeypatch, mod)
    conn = type("Conn", (), {"cursor": staticmethod(FakeCursor)})()
    row = {
        "id": 42,
        "name": "Infeed",
        "manufacturer": "Dorner",
        "model": "2200",
        "serial_number": "S1",
        "area": "Line 1",
        "updated_at": "2026-01-01",
    }
    assert mod.insert_into_neon(conn, "tenant-z", "CV-207", row) is True
    (c,) = calls
    assert c["tag"] == "CV-207"
    # migration 083: per-tenant partial unique index — the conflict target must match it
    assert c["conflict"] == (
        "ON CONFLICT (tenant_id, equipment_number) WHERE equipment_number IS NOT NULL DO NOTHING"
    )
    assert c["columns"]["atlas_id"] == "42" and c["raw"] == {"cmms_synced_at": "NOW()"}


def test_atlas_sync_counts_a_legacy_tenant_as_skipped_not_synced(monkeypatch):
    mod = _load_atlas_sync()
    _creator(monkeypatch, mod, raises=LegacyTenantError("tenant 'mike' is not a UUID"))
    conn = type("Conn", (), {"cursor": staticmethod(FakeCursor)})()
    row = {
        "id": 42,
        "name": "Infeed",
        "manufacturer": "Dorner",
        "model": "2200",
        "updated_at": "2026-01-01",
    }
    assert mod.insert_into_neon(conn, "mike", "CV-207", row) is False
    src = (REPO / "tools/atlas-hub-sync.py").read_text()
    assert 'stats["skipped_legacy_tenant"] += 1' in src and "if insert_into_neon(" in src


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
