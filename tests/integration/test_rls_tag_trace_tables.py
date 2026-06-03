"""RLS integration tests for migrations 032–036 (tag/trace family).

Proves that all five tables added by the Phase 1 schema (decision_traces,
tag_events, flaky_input_signals, approved_tags, live_signal_cache) enforce
tenant isolation when accessed via the factorylm_app role — i.e. the non-
superuser path that the production relay and engine actually use.

Issue: https://github.com/Mikecranesync/MIRA/issues/1664
Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 1

Why this matters: the Phase 1 migrations (PR #1657) applied and verified
correctly against ephemeral postgres, but those runs were as the postgres
superuser which bypasses RLS. This suite re-runs the critical paths under
factorylm_app so that the app-role → SET LOCAL → policy chain is actually
exercised, not bypassed.

Skips when NEON_DATABASE_URL is not set (dev workstations and offline CI stay
green). Runs as part of migration-verify.yml against the staging Neon branch.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

psycopg2 = pytest.importorskip(
    "psycopg2",
    reason="psycopg2-binary required for the Phase 1 RLS integration tests",
)
# Access psycopg2.errors via the module returned by importorskip.
_pg_errors = psycopg2.errors

NEON_URL = os.environ.get("NEON_DATABASE_URL", "")
if not NEON_URL:
    pytest.skip(
        "NEON_DATABASE_URL not set — Phase 1 RLS tests require a real Neon branch",
        allow_module_level=True,
    )


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def conn():
    """Module-scoped psycopg2 connection. autocommit=False — tests own txns."""
    c = psycopg2.connect(NEON_URL)
    try:
        yield c
    finally:
        c.close()


def _bind_tenant(cur, tenant_id: str, *, as_app_role: bool = False) -> None:
    """Set the session-local tenant binding, optionally dropping to factorylm_app.

    as_app_role=True exercises the RLS path — neondb_owner has BYPASSRLS and
    would silently pass even if the policy is missing or wrong.
    """
    if as_app_role:
        cur.execute("SET LOCAL ROLE factorylm_app")
    cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,))


def _owner_delete(conn, table: str, where_sql: str, *args) -> None:
    """Delete rows as the session owner (bypasses RLS) for test cleanup."""
    with conn:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table} WHERE {where_sql}", args)  # noqa: S608


# ---------------------------------------------------------------------------
# 1. decision_traces (migration 032)
# ---------------------------------------------------------------------------


def test_decision_traces_rls_cross_tenant(conn):
    """Tenant A's decision_trace row is invisible to tenant B under factorylm_app."""
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    trace_id = str(uuid.uuid4())
    inserted = False

    try:
        # INSERT as tenant A.
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question)
                       VALUES (%s, %s::uuid, %s)""",
                    (trace_id, tenant_a, "rls-test: VFD F002 fault on CV-101"),
                )
                inserted = True

        # tenant B sees 0 rows.
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM decision_traces WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak on decision_traces: tenant B saw tenant A's row"
                )

        # tenant A sees their own row.
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM decision_traces WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == 1, (
                    "tenant A must see its own decision_traces row"
                )

    finally:
        if inserted:
            _owner_delete(conn, "decision_traces", "trace_id = %s", trace_id)


# ---------------------------------------------------------------------------
# 2. tag_events (migration 033)
# ---------------------------------------------------------------------------


def test_tag_events_rls_cross_tenant(conn):
    """Tenant A's tag_event is invisible to tenant B under factorylm_app."""
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    inserted = False

    try:
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO tag_events
                       (event_id, tenant_id, tag_path, source_system, event_timestamp)
                       VALUES (%s, %s::uuid, %s, %s, %s)""",
                    (
                        event_id,
                        tenant_a,
                        "Mira_Monitored/Conveyor/Motor_Current",
                        "ignition",
                        datetime.now(timezone.utc),
                    ),
                )
                inserted = True

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM tag_events WHERE event_id = %s", (event_id,)
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak on tag_events: tenant B saw tenant A's row"
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM tag_events WHERE event_id = %s", (event_id,)
                )
                assert cur.fetchone()[0] == 1, (
                    "tenant A must see its own tag_events row"
                )

    finally:
        if inserted:
            _owner_delete(conn, "tag_events", "event_id = %s", event_id)


# ---------------------------------------------------------------------------
# 3. flaky_input_signals (migration 034)
# ---------------------------------------------------------------------------


def test_flaky_input_signals_rls_cross_tenant(conn):
    """Tenant A's flaky_input_signal is invisible to tenant B under factorylm_app."""
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    alert_id = str(uuid.uuid4())
    inserted = False

    try:
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO flaky_input_signals
                       (alert_id, tenant_id, source_tag_path, detection_window)
                       VALUES (%s, %s::uuid, %s, %s)""",
                    (alert_id, tenant_a, "Conveyor/Photoeye_1", "1h"),
                )
                inserted = True

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM flaky_input_signals WHERE alert_id = %s",
                    (alert_id,),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak on flaky_input_signals: tenant B saw tenant A's row"
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM flaky_input_signals WHERE alert_id = %s",
                    (alert_id,),
                )
                assert cur.fetchone()[0] == 1, (
                    "tenant A must see its own flaky_input_signals row"
                )

    finally:
        if inserted:
            _owner_delete(conn, "flaky_input_signals", "alert_id = %s", alert_id)


# ---------------------------------------------------------------------------
# 4. approved_tags (migration 035)
# ---------------------------------------------------------------------------


def test_approved_tags_rls_cross_tenant(conn):
    """Tenant A's approved_tags row is invisible to tenant B under factorylm_app."""
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    # Use a unique tag path so the composite PK never collides.
    tag_path = f"rls_test/{uuid.uuid4().hex[:12]}"
    inserted = False

    try:
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO approved_tags
                       (tenant_id, source_system, source_tag_path)
                       VALUES (%s::uuid, %s, %s)""",
                    (tenant_a, "ignition", tag_path),
                )
                inserted = True

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM approved_tags"
                    " WHERE tenant_id = %s::uuid AND source_tag_path = %s",
                    (tenant_a, tag_path),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak on approved_tags: tenant B saw tenant A's row"
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM approved_tags"
                    " WHERE tenant_id = %s::uuid AND source_tag_path = %s",
                    (tenant_a, tag_path),
                )
                assert cur.fetchone()[0] == 1, (
                    "tenant A must see its own approved_tags row"
                )

    finally:
        if inserted:
            _owner_delete(
                conn,
                "approved_tags",
                "tenant_id = %s::uuid AND source_tag_path = %s",
                tenant_a,
                tag_path,
            )


# ---------------------------------------------------------------------------
# 5. live_signal_cache (migration 020, extended by 036)
# ---------------------------------------------------------------------------


def test_live_signal_cache_rls_cross_tenant(conn):
    """Tenant A's live_signal_cache row is invisible to tenant B under factorylm_app.

    live_signal_cache already had RLS from migration 020. Migration 036 adds
    freshness columns (uns_path, source_system, latest_quality, freshness_status).
    This test proves the policy holds for the extended table under factorylm_app.
    """
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    plc_tag = f"rls_test/{uuid.uuid4().hex[:12]}"
    inserted = False

    try:
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                # live_signal_cache requires at least one value column non-null
                # (cache_value_present CHECK constraint).
                cur.execute(
                    """INSERT INTO live_signal_cache
                       (tenant_id, plc_tag, last_value_text)
                       VALUES (%s::uuid, %s, %s)""",
                    (tenant_a, plc_tag, "42.0"),
                )
                inserted = True

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM live_signal_cache"
                    " WHERE tenant_id = %s::uuid AND plc_tag = %s",
                    (tenant_a, plc_tag),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak on live_signal_cache: tenant B saw tenant A's row"
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM live_signal_cache"
                    " WHERE tenant_id = %s::uuid AND plc_tag = %s",
                    (tenant_a, plc_tag),
                )
                assert cur.fetchone()[0] == 1, (
                    "tenant A must see its own live_signal_cache row"
                )

    finally:
        if inserted:
            _owner_delete(
                conn,
                "live_signal_cache",
                "tenant_id = %s::uuid AND plc_tag = %s",
                tenant_a,
                plc_tag,
            )


# ---------------------------------------------------------------------------
# 6. WITH CHECK enforcement — wrong tenant_id on INSERT is rejected
# ---------------------------------------------------------------------------


def test_tag_events_with_check_rejects_wrong_tenant(conn):
    """INSERT a tag_event row whose tenant_id differs from the session binding.

    The WITH CHECK clause in the tag_events_tenant policy means:
      new row's tenant_id must equal app.current_tenant_id or app.tenant_id.
    Violating this must raise InsufficientPrivilege (SQLSTATE 42501).

    This is the critical defence-in-depth invariant: even if the application
    code sends the wrong tenant_id, the database rejects it at the row level.
    """
    tenant_bound = str(uuid.uuid4())  # what we tell postgres we are
    tenant_wrong = str(uuid.uuid4())  # what we try to write (different)
    event_id = str(uuid.uuid4())

    with conn:
        with conn.cursor() as cur:
            _bind_tenant(cur, tenant_bound, as_app_role=True)
            with pytest.raises(psycopg2.Error) as exc_info:
                cur.execute(
                    """INSERT INTO tag_events
                       (event_id, tenant_id, tag_path, source_system, event_timestamp)
                       VALUES (%s, %s::uuid, %s, %s, %s)""",
                    (
                        event_id,
                        tenant_wrong,  # ← wrong tenant; should be rejected
                        "Conveyor/Motor_Current",
                        "ignition",
                        datetime.now(timezone.utc),
                    ),
                )
        # Roll back the failed transaction so the connection stays usable.
        conn.rollback()

    # Accept either InsufficientPrivilege (42501 — RLS WITH CHECK) or
    # CheckViolation (23514) depending on PG version. Both prove enforcement.
    pgcode = exc_info.value.pgcode
    assert pgcode in ("42501", "23514"), (
        f"Expected RLS or check violation (42501/23514), got SQLSTATE {pgcode}: "
        f"{exc_info.value}"
    )
