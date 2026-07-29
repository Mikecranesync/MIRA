"""Live-Postgres integration test — proves the run-store RLS + historizer cursor
fixes (#2341 / #2343).

SKIPPED unless ``MIRA_TEST_DATABASE_URL`` is set. When a DB is available this
test stands up a DISPOSABLE schema, ensures the ``factorylm_app`` role exists,
applies the real migration SQL (033 tag_events, 037 tag_event_diffs, 038
machine_runs, 057 historian_cursor), and then drives the REAL production code
paths against that schema as the RLS-bound ``factorylm_app`` role:

  * the historizer task (``tasks.tag_diff_historizer.historize_tag_diffs``), to
    prove the explicit ``historian_cursor`` watermark advances even on a
    zero-diff batch (the old diffs-derived cursor would replay forever); and
  * ``NeonRunStore.close_run`` / ``insert_diffs``, to prove the new
    ``SET LOCAL app.current_tenant_id`` makes the UPDATE / INSERT actually match
    rows under RLS (without it they silently match zero), and that the rows are
    invisible to a different tenant.

Requirements for the target DB (e.g. a staging Neon branch):
  * ``MIRA_TEST_DATABASE_URL`` must be a superuser-capable URL — we ``SET ROLE
    factorylm_app`` to exercise RLS (superusers bypass RLS, so the app code is
    run *as* a non-bypass role), and we create a disposable schema/role.
  * The production store/historizer hard-code ``sslmode=require`` on their own
    engines, so the DB must accept SSL (Neon/staging does).

This file is intentionally NOT runnable on the dev laptop (no Postgres); it is
written correct-and-skipped and is meant to run on staging.
"""

from __future__ import annotations

import os
import pathlib
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("MIRA_TEST_DATABASE_URL"),
    reason="no test Postgres (set MIRA_TEST_DATABASE_URL to run)",
)

# These imports are only reached when the DB is available (collection still
# imports the module, so keep them import-safe — sqlalchemy is a crawler dep).
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

_MIGRATIONS = (
    pathlib.Path(__file__).resolve().parents[2] / "mira-hub" / "db" / "migrations"
)
_MIGRATION_FILES = [
    "033_tag_events.sql",
    "037_tag_event_diffs.sql",
    "038_machine_runs.sql",
    "057_historian_cursor.sql",
]


def _admin_engine():
    """Admin engine on the raw test URL (no forced ssl — let the URL decide)."""
    return create_engine(os.environ["MIRA_TEST_DATABASE_URL"], future=True)


def _store_url(schema: str) -> str:
    """A connection URL that lands every store/historizer connection in the
    disposable schema AS the RLS-bound ``factorylm_app`` role (via libpq
    ``options``)."""
    base = make_url(os.environ["MIRA_TEST_DATABASE_URL"])
    opts = f"-c search_path={schema},public -c role=factorylm_app"
    query = dict(base.query)
    query["options"] = opts
    return base.set(query=query).render_as_string(hide_password=False)


def _exec_script(sql: str, search_path: str | None = None) -> None:
    """Run a (possibly multi-statement, BEGIN/COMMIT-wrapped) SQL script."""
    eng = _admin_engine()
    with eng.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        if search_path:
            conn.exec_driver_sql(f"SET search_path TO {search_path}, public")
        conn.exec_driver_sql(sql)
    eng.dispose()


@pytest.fixture()
def pg_schema():
    """Create a disposable schema + factorylm_app role, apply migrations, yield
    a context, then drop the schema."""
    schema = f"hist_it_{uuid.uuid4().hex[:12]}"
    eng = _admin_engine()
    with eng.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.exec_driver_sql(f"CREATE SCHEMA {schema}")
        # Ensure the app role exists (NOLOGIN — we reach it via SET ROLE) and
        # that the admin can SET ROLE to it.
        conn.exec_driver_sql(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
                    CREATE ROLE factorylm_app NOLOGIN;
                END IF;
            END $$;
            """
        )
        conn.exec_driver_sql(f"GRANT USAGE ON SCHEMA {schema} TO factorylm_app")
        # Grant membership so a non-superuser admin can also SET ROLE (no-op for
        # superusers / the role creator).
        conn.exec_driver_sql(
            """
            DO $$
            BEGIN
                BEGIN
                    GRANT factorylm_app TO CURRENT_USER;
                EXCEPTION WHEN OTHERS THEN
                    NULL;  -- already a member, or insufficient privilege (superuser)
                END;
            END $$;
            """
        )
    eng.dispose()

    for fname in _MIGRATION_FILES:
        _exec_script((_MIGRATIONS / fname).read_text(encoding="utf-8"), search_path=schema)

    try:
        yield {"schema": schema, "store_url": _store_url(schema)}
    finally:
        eng = _admin_engine()
        with eng.connect() as conn:
            conn = conn.execution_options(isolation_level="AUTOCOMMIT")
            conn.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        eng.dispose()


def _seed_tag_event(schema, tenant, tag, value, ts, *, vt="bool"):
    """Insert one tag_events row (as admin; superuser bypasses RLS for seeding)."""
    eng = _admin_engine()
    with eng.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.exec_driver_sql(f"SET search_path TO {schema}, public")
        conn.execute(
            text(
                """
                INSERT INTO tag_events
                    (tenant_id, tag_path, value, value_type, quality,
                     source_system, simulated, event_timestamp)
                VALUES
                    (CAST(:tid AS UUID), :tag, :val, :vt, 'good',
                     'plc_bridge', false, to_timestamp(:ts))
                """
            ),
            {"tid": tenant, "tag": tag, "val": value, "vt": vt, "ts": ts},
        )
    eng.dispose()


def _scalar_as_app(schema, tenant, sql, params=None):
    """Run a SELECT as factorylm_app under RLS for ``tenant``; return the scalar."""
    eng = _admin_engine()
    try:
        with eng.begin() as conn:
            conn.exec_driver_sql("SET ROLE factorylm_app")
            conn.exec_driver_sql(f"SET search_path TO {schema}, public")
            conn.execute(
                text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                {"tid": tenant},
            )
            return conn.execute(text(sql), params or {}).scalar()
    finally:
        eng.dispose()


# ---------------------------------------------------------------------------
# BUG 2 — explicit historian cursor advances even with zero diffs
# ---------------------------------------------------------------------------


def test_historizer_cursor_advances_on_zero_diff_batch(pg_schema, monkeypatch):
    from celery_app import app as celery_app

    schema = pg_schema["schema"]
    store_url = pg_schema["store_url"]
    tenant = str(uuid.uuid4())

    # Three DISTINCT tags, each seen exactly once -> all first observations ->
    # tag_diff_logger emits NO diffs.
    _seed_tag_event(schema, tenant, "PE-1", "false", 100.0)
    _seed_tag_event(schema, tenant, "PE-2", "true", 200.0)
    _seed_tag_event(schema, tenant, "PE-3", "false", 300.0)

    monkeypatch.setenv("NEON_DATABASE_URL", store_url)
    monkeypatch.setenv("MIRA_TENANT_ID", tenant)
    celery_app.conf.task_always_eager = True

    from tasks.tag_diff_historizer import historize_tag_diffs

    summary = historize_tag_diffs.apply(kwargs={"tenant_id": tenant}).get()
    assert summary["status"] == "ok"
    assert summary["tag_events_read"] == 3
    assert summary["diffs_written"] == 0  # all first observations

    # No diffs were written...
    diff_count = _scalar_as_app(
        schema, tenant, "SELECT count(*) FROM tag_event_diffs WHERE tenant_id = CAST(:t AS UUID)",
        {"t": tenant},
    )
    assert diff_count == 0
    # ...but the EXPLICIT cursor still advanced to the batch max (no replay).
    cur = _scalar_as_app(
        schema, tenant,
        "SELECT EXTRACT(EPOCH FROM last_event_ts) FROM historian_cursor "
        "WHERE tenant_id = CAST(:t AS UUID) AND source = 'tag_diff'",
        {"t": tenant},
    )
    assert cur is not None and float(cur) == 300.0

    # A genuine change on an existing tag now yields exactly one diff, and the
    # cursor advances past it.
    _seed_tag_event(schema, tenant, "PE-1", "true", 400.0)  # false -> true = rising
    summary2 = historize_tag_diffs.apply(kwargs={"tenant_id": tenant}).get()
    assert summary2["tag_events_read"] == 1  # only the new event past the cursor
    assert summary2["diffs_written"] == 1

    diff_count2 = _scalar_as_app(
        schema, tenant, "SELECT count(*) FROM tag_event_diffs WHERE tenant_id = CAST(:t AS UUID)",
        {"t": tenant},
    )
    assert diff_count2 == 1
    cur2 = _scalar_as_app(
        schema, tenant,
        "SELECT EXTRACT(EPOCH FROM last_event_ts) FROM historian_cursor "
        "WHERE tenant_id = CAST(:t AS UUID) AND source = 'tag_diff'",
        {"t": tenant},
    )
    assert float(cur2) == 400.0


# ---------------------------------------------------------------------------
# BUG 1 — run-store RLS tenant scoping (close_run / insert_diffs SET LOCAL)
# ---------------------------------------------------------------------------


def test_run_store_close_run_and_insert_diffs_under_rls(pg_schema):
    from run_engine.models import Run, RunAnomalyDiff
    from run_engine.store import NeonRunStore

    schema = pg_schema["schema"]
    store = NeonRunStore(pg_schema["store_url"])

    tenant = str(uuid.uuid4())
    other_tenant = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    uns = "demo.cell1.conveyor.cv101"

    store.insert_run(
        Run(
            run_id=run_id,
            tenant_id=tenant,
            uns_path=uns,
            run_trigger_tag="vfd_freq",
            run_trigger_threshold=0.1,
            started_at=1000.0,
        )
    )

    # close_run must SET LOCAL the tenant or the UPDATE matches 0 rows under RLS.
    store.close_run(
        run_id,
        stopped_at=1100.0,
        duration_seconds=100.0,
        status="closed",
        tenant_id=tenant,
    )

    status = _scalar_as_app(
        schema, tenant,
        "SELECT status FROM machine_run WHERE run_id = CAST(:r AS UUID)",
        {"r": run_id},
    )
    stopped = _scalar_as_app(
        schema, tenant,
        "SELECT stopped_at FROM machine_run WHERE run_id = CAST(:r AS UUID)",
        {"r": run_id},
    )
    assert status == "closed"  # proves the UPDATE actually matched the row
    assert stopped is not None

    # insert_diffs must SET LOCAL the tenant (WITH CHECK) and stamp tenant_id.
    written = store.insert_diffs(
        [
            RunAnomalyDiff(
                tag_path="motor_current",
                phase_name="default",
                observed=80.0,
                baseline=10.0,
                delta=70.0,
                delta_percent=700.0,
                severity="critical",
                sample_count=2,
                uns_path=uns,
                event_timestamp=1100.0,
            )
        ],
        run_id=run_id,
        tenant_id=tenant,
    )
    assert written == 1

    # Visible to the owning tenant...
    owner_rows = _scalar_as_app(
        schema, tenant,
        "SELECT count(*) FROM run_diff WHERE run_id = CAST(:r AS UUID)",
        {"r": run_id},
    )
    assert owner_rows == 1
    # ...invisible to a different tenant (RLS isolation holds).
    other_rows = _scalar_as_app(
        schema, other_tenant,
        "SELECT count(*) FROM run_diff WHERE run_id = CAST(:r AS UUID)",
        {"r": run_id},
    )
    assert other_rows == 0
