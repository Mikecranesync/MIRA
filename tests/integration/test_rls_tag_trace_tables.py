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


def _phase1_schema_ready() -> bool:
    """Return True if migrations 032-036 have been applied to this Neon branch.

    Checks for decision_traces.user_question (added by migration 032) as the
    sentinel. If absent, the Phase 1 migrations haven't landed on staging yet
    and all tests in this module would fail with UndefinedColumn — skip instead.
    """
    try:
        _c = psycopg2.connect(NEON_URL)
        try:
            with _c.cursor() as _cur:
                _cur.execute(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'decision_traces' AND column_name = 'user_question'"
                )
                return _cur.fetchone() is not None
        finally:
            _c.close()
    except Exception:
        return False


if not _phase1_schema_ready():
    pytest.skip(
        "Phase 1 schema not yet applied to this Neon branch "
        "(decision_traces.user_question absent — migrations 032-036 must land first, see PR #1657)",
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
                assert cur.fetchone()[0] == 1, "tenant A must see its own decision_traces row"

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
                cur.execute("SELECT COUNT(*) FROM tag_events WHERE event_id = %s", (event_id,))
                assert cur.fetchone()[0] == 0, "RLS leak on tag_events: tenant B saw tenant A's row"

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute("SELECT COUNT(*) FROM tag_events WHERE event_id = %s", (event_id,))
                assert cur.fetchone()[0] == 1, "tenant A must see its own tag_events row"

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
                assert cur.fetchone()[0] == 1, "tenant A must see its own flaky_input_signals row"

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
                assert cur.fetchone()[0] == 1, "tenant A must see its own approved_tags row"

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
                assert cur.fetchone()[0] == 1, "tenant A must see its own live_signal_cache row"

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
        f"Expected RLS or check violation (42501/23514), got SQLSTATE {pgcode}: {exc_info.value}"
    )


# ---------------------------------------------------------------------------
# 6. SLUG-tenant regression for #3003 / migration 070
#
# The tests above bind UUID tenants and cast with `%s::uuid`. After migration
# 070 changed decision_traces.tenant_id (and decision_trace_feedback.tenant_id)
# from UUID to TEXT they still pass — TEXT accepts uuid-strings — so they prove
# NOTHING about the bug that was actually reported.
#
# The real failure is a BOT SLUG tenant ('staging', 'default', a chat_tenant
# slug): pre-070 the column was UUID and the writer cast to UUID, so the insert
# died with InvalidTextRepresentation and, because write_trace is append-only
# fire-and-forget, it failed SILENTLY — staging recorded zero traces.
#
# These tests exercise the REPAIRED path end to end under factorylm_app:
# write as a slug tenant using the production writer's SQL shape (no tenant
# cast), read it back, and prove a SECOND slug tenant cannot see it. The
# negative control below proves this suite would have caught the original bug.
# ---------------------------------------------------------------------------


def _slug_tenant(prefix: str) -> str:
    """A bot-shaped tenant slug: unique per run, and NOT a parseable UUID.

    Unique so parallel runs on the shared staging branch cannot collide
    (issue #2986); non-UUID so the test cannot silently degrade into another
    UUID-tenant test if someone 'tidies' it later — that degradation is exactly
    what left #3003 uncovered.
    """
    slug = f"{prefix}-{uuid.uuid4().hex[:8]}"
    with pytest.raises(ValueError):
        uuid.UUID(slug)  # guard: this MUST NOT be UUID-shaped
    return slug


def test_decision_traces_slug_tenant_write_read_and_isolation(conn):
    """A bot slug tenant can write + read its own trace; another slug cannot see it."""
    tenant_a = _slug_tenant("slugtest-a")
    tenant_b = _slug_tenant("slugtest-b")
    trace_id = str(uuid.uuid4())
    inserted = False

    try:
        # WRITE as slug tenant A, using the production writer's shape:
        # tenant_id bound as a plain parameter — no CAST(... AS UUID).
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question)
                       VALUES (%s, %s, %s)""",
                    (trace_id, tenant_a, "rls-test: slug tenant trace (#3003)"),
                )
                inserted = True

        # READ BACK as slug tenant A — the half that silently failed before 070.
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT tenant_id FROM decision_traces WHERE trace_id = %s",
                    (trace_id,),
                )
                row = cur.fetchone()
                assert row is not None, (
                    "slug tenant could not read back its own decision_traces row "
                    "— the #3003 write path is broken again"
                )
                assert row[0] == tenant_a

        # ISOLATION: a DIFFERENT slug tenant sees nothing.
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM decision_traces WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak: slug tenant B saw slug tenant A's decision_traces row"
                )
    finally:
        if inserted:
            _owner_delete(conn, "decision_traces", "trace_id = %s", trace_id)


def test_decision_traces_slug_tenant_with_check_rejects_foreign_write(conn):
    """WITH CHECK still enforces on the TEXT policy — A cannot write as B."""
    tenant_bound = _slug_tenant("slugtest-bound")
    tenant_wrong = _slug_tenant("slugtest-wrong")
    trace_id = str(uuid.uuid4())

    with conn:
        with conn.cursor() as cur:
            _bind_tenant(cur, tenant_bound, as_app_role=True)
            with pytest.raises(psycopg2.Error) as exc_info:
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question)
                       VALUES (%s, %s, %s)""",
                    (trace_id, tenant_wrong, "rls-test: foreign slug write"),
                )
        conn.rollback()

    pgcode = exc_info.value.pgcode
    assert pgcode in ("42501", "23514"), (
        f"Expected RLS/check violation (42501/23514) on a foreign slug write, "
        f"got SQLSTATE {pgcode}: {exc_info.value}"
    )


def test_old_writer_cast_still_fails_on_slug_tenant(conn):
    """NEGATIVE CONTROL: the pre-#3003 writer shape must still reject a slug.

    This is what makes the tests above meaningful. The old writer emitted
    CAST(:tenant_id AS UUID); against a slug that is an InvalidTextRepresentation
    (SQLSTATE 22P02) regardless of the column type. If this ever stops raising,
    the suite is no longer reproducing the original defect.
    """
    tenant = _slug_tenant("slugtest-neg")
    trace_id = str(uuid.uuid4())

    with conn:
        with conn.cursor() as cur:
            _bind_tenant(cur, tenant, as_app_role=True)
            with pytest.raises(psycopg2.Error) as exc_info:
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question)
                       VALUES (%s, CAST(%s AS UUID), %s)""",
                    (trace_id, tenant, "rls-test: old cast shape"),
                )
        conn.rollback()

    assert exc_info.value.pgcode == "22P02", (
        "the old CAST(... AS UUID) writer shape no longer fails on a slug tenant — "
        f"got SQLSTATE {exc_info.value.pgcode}; this suite is no longer reproducing #3003"
    )


def test_decision_trace_feedback_slug_tenant_write_read_and_isolation(conn):
    """The second table migration 070 converted enforces the same slug contract."""
    tenant_a = _slug_tenant("slugfb-a")
    tenant_b = _slug_tenant("slugfb-b")
    trace_id = str(uuid.uuid4())
    inserted = False

    try:
        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO decision_traces
                       (trace_id, tenant_id, user_question)
                       VALUES (%s, %s, %s)""",
                    (trace_id, tenant_a, "rls-test: slug feedback parent"),
                )
                inserted = True
                cur.execute(
                    """INSERT INTO decision_trace_feedback
                       (trace_id, tenant_id, verdict)
                       VALUES (%s, %s, %s)""",
                    (trace_id, tenant_a, "good"),
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM decision_trace_feedback WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == 1, (
                    "slug tenant could not read back its own decision_trace_feedback row"
                )

        with conn:
            with conn.cursor() as cur:
                _bind_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM decision_trace_feedback WHERE trace_id = %s",
                    (trace_id,),
                )
                assert cur.fetchone()[0] == 0, (
                    "RLS leak: slug tenant B saw slug tenant A's feedback row"
                )
    finally:
        if inserted:
            # feedback cascades on the FK.
            _owner_delete(conn, "decision_traces", "trace_id = %s", trace_id)
