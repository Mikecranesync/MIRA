"""Integration tests for Phase 0 schema (migrations 025/026/027).

End-to-end against a real NeonDB branch (typically staging, supplied via
NEON_DATABASE_URL).  Skips entirely if the env var is unset so unit runs
on dev workstations stay green.

Coverage:
  * tag_entities / wiring_connections / ai_suggestions
      — INSERT → SELECT → DELETE round-trip
      — column shape + lifecycle defaults
  * RLS tenant isolation
      — tenant A row is invisible to a session that set tenant B
      — exercised as `factorylm_app`, not the owner, since owner bypasses RLS
  * propose_from_nameplate()
      — happy path: writes an ai_suggestions row + an installed_component_instance
      — early-exit guards never touch the DB
  * insert_photo_ai_suggestion()  (if module importable)

Cleanup is best-effort in a `finally` block so a failing assertion still
leaves the staging branch clean.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest

psycopg2 = pytest.importorskip(
    "psycopg2", reason="psycopg2-binary required for the Phase 0 integration tests"
)

NEON_URL = os.environ.get("NEON_DATABASE_URL", "")
if not NEON_URL:
    pytest.skip(
        "NEON_DATABASE_URL not set — Phase 0 integration tests require a real Neon branch",
        allow_module_level=True,
    )

# The staging Neon branch is forked from prod, so this tenant row already
# exists.  Round-trip rows use this tenant; RLS-isolation rows use fresh
# UUIDs to avoid colliding with prod data.
STAGING_TENANT = os.environ.get(
    "STAGING_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
)

# Repo paths so we can import the worker + ingest helper without an install.
REPO_ROOT = Path(__file__).resolve().parents[2]
for sub in ("mira-bots", "mira-core/mira-ingest"):
    p = str(REPO_ROOT / sub)
    if p not in sys.path:
        sys.path.insert(0, p)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def conn():
    """Module-scoped raw psycopg2 connection. autocommit False — tests own txns."""
    c = psycopg2.connect(NEON_URL)
    try:
        yield c
    finally:
        c.close()


def _with_tenant(cur, tenant_id: str, *, as_app_role: bool = False) -> None:
    """Set the per-transaction tenant id (and optionally drop to factorylm_app).

    `as_app_role=True` exercises RLS — the role neondb_owner bypasses it.
    The caller is responsible for ROLLBACK/COMMIT to reset the role.
    """
    if as_app_role:
        cur.execute("SET LOCAL ROLE factorylm_app")
    cur.execute(
        "SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,)
    )


# ---------------------------------------------------------------------------
# Round-trip — tag_entities (migration 025)
# ---------------------------------------------------------------------------


def test_tag_entities_roundtrip(conn):
    """INSERT a tag, read it back, verify defaults, then DELETE."""
    tag_id = uuid.uuid4()
    uns_path = f"enterprise.test.phase0.{tag_id.hex[:8]}.motor_current"
    inserted = False
    try:
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    """INSERT INTO tag_entities
                          (id, tenant_id, uns_path, symbolic_name, data_type,
                           source_kind, source_address)
                       VALUES (%s, %s, %s::ltree, %s, %s, %s, %s)""",
                    (
                        str(tag_id), STAGING_TENANT, uns_path,
                        "motor_current", "REAL", "modbus_register", "HR:101",
                    ),
                )
                inserted = True

                cur.execute(
                    "SELECT approval_state, created_at, data_type "
                    "FROM tag_entities WHERE id = %s",
                    (str(tag_id),),
                )
                row = cur.fetchone()
                assert row is not None, "tag row not visible after INSERT"
                approval_state, created_at, data_type = row
                assert approval_state == "proposed", \
                    f"expected default approval_state=proposed, got {approval_state}"
                assert data_type == "REAL"
                assert created_at is not None
    finally:
        if inserted:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM tag_entities WHERE id = %s",
                                (str(tag_id),))


# ---------------------------------------------------------------------------
# Round-trip — wiring_connections (migration 026)
# ---------------------------------------------------------------------------


def test_wiring_connections_roundtrip(conn):
    wid = uuid.uuid4()
    src = uuid.uuid4()
    dst = uuid.uuid4()
    inserted = False
    try:
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    """INSERT INTO wiring_connections
                          (id, tenant_id, source_entity_id, source_terminal,
                           dest_entity_id, dest_terminal,
                           wire_number, function_class)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        str(wid), STAGING_TENANT, str(src), "X1:3",
                        str(dst), "TB2-14", "W-1147", "signal",
                    ),
                )
                inserted = True

                cur.execute(
                    "SELECT approval_state, wire_number, function_class "
                    "FROM wiring_connections WHERE id = %s",
                    (str(wid),),
                )
                row = cur.fetchone()
                assert row is not None
                assert row == ("proposed", "W-1147", "signal")
    finally:
        if inserted:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM wiring_connections WHERE id = %s",
                                (str(wid),))


# ---------------------------------------------------------------------------
# Round-trip — ai_suggestions (migration 027)
# ---------------------------------------------------------------------------


def test_ai_suggestions_roundtrip(conn):
    sid = uuid.uuid4()
    inserted = False
    try:
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    """INSERT INTO ai_suggestions
                          (id, tenant_id, suggestion_type,
                           extracted_data, confidence, title, body)
                       VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)""",
                    (
                        str(sid), STAGING_TENANT, "component_profile",
                        '{"manufacturer": "TestCo", "model": "T1"}',
                        0.42,
                        "test phase0 round-trip",
                        "body — verification test row",
                    ),
                )
                inserted = True

                cur.execute(
                    "SELECT status, risk_level, proposed_by, confidence "
                    "FROM ai_suggestions WHERE id = %s",
                    (str(sid),),
                )
                row = cur.fetchone()
                assert row is not None
                status, risk, proposed_by, conf = row
                assert status == "pending"
                assert risk == "low"
                assert proposed_by == "llm:unknown"
                assert abs(conf - 0.42) < 1e-6
    finally:
        if inserted:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM ai_suggestions WHERE id = %s",
                                (str(sid),))


def test_ai_suggestions_needs_review_status(conn):
    """Migration 057: `needs_review` is an accepted ai_suggestions.status value.

    Proves the Phase 5 PR-1 CHECK swap — the FactoryModel writer emits uncertain
    mappings as `needs_review`. Inserted as factorylm_app under the staging tenant.
    """
    sid = uuid.uuid4()
    inserted = False
    try:
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    """INSERT INTO ai_suggestions
                          (id, tenant_id, suggestion_type, extracted_data,
                           confidence, status, risk_level, proposed_by, title, body)
                       VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)""",
                    (
                        str(sid), STAGING_TENANT, "tag_mapping",
                        '{"tag": "Weird.Tag", "uns_path": "enterprise.test.p5.x.weird"}',
                        0.3, "needs_review", "medium", "import:factory_model",
                        "phase5 pr-1 needs_review row",
                        "uncertain signal mapping — needs human review",
                    ),
                )
                inserted = True
                cur.execute(
                    "SELECT status FROM ai_suggestions WHERE id = %s", (str(sid),)
                )
                row = cur.fetchone()
                assert row is not None, "needs_review row not visible after INSERT"
                assert row[0] == "needs_review", \
                    f"expected status=needs_review, got {row[0]}"
    finally:
        if inserted:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM ai_suggestions WHERE id = %s",
                                (str(sid),))


# ---------------------------------------------------------------------------
# RLS — tenant isolation
# ---------------------------------------------------------------------------


def test_rls_tenant_isolation_ai_suggestions(conn):
    """Insert as tenant A, query as tenant B → expect 0 rows.

    Run under SET LOCAL ROLE factorylm_app — neondb_owner has BYPASSRLS.
    """
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    sid = str(uuid.uuid4())
    inserted = False

    # Insert as tenant A under factorylm_app.
    try:
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    """INSERT INTO ai_suggestions
                          (id, tenant_id, suggestion_type, extracted_data,
                           confidence, title, body)
                       VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)""",
                    (
                        sid, tenant_a, "uns_confirmation",
                        '{"candidate_paths": []}', 0.50,
                        "rls test row",
                        "tenant A row, should be invisible to tenant B",
                    ),
                )
                inserted = True

        # New transaction: act as tenant B.
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, tenant_b, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM ai_suggestions WHERE id = %s",
                    (sid,),
                )
                count_b = cur.fetchone()[0]
                assert count_b == 0, (
                    f"RLS leak: tenant B saw tenant A's row "
                    f"({count_b} rows visible)"
                )

        # Sanity: tenant A still sees it.
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, tenant_a, as_app_role=True)
                cur.execute(
                    "SELECT COUNT(*) FROM ai_suggestions WHERE id = %s",
                    (sid,),
                )
                count_a = cur.fetchone()[0]
                assert count_a == 1, "tenant A should see its own row"

    finally:
        if inserted:
            # neondb_owner bypasses RLS, so cleanup always succeeds.
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM ai_suggestions WHERE id = %s", (sid,)
                    )


# ---------------------------------------------------------------------------
# Worker — propose_from_nameplate (end-to-end demo loop)
# ---------------------------------------------------------------------------


def test_propose_from_nameplate_writes_suggestion(conn):
    """Happy path: nameplate fields → ai_suggestions row.

    Lands as suggestion_type='component_profile' when no matching template
    exists.  Cleanup is done in a fresh transaction.
    """
    from shared.workers.photo_ingest_worker import propose_from_nameplate

    # Use a one-shot model string nobody else has, so no template ever matches.
    unique_model = f"PHASE0VERIFY-{uuid.uuid4().hex[:8]}"
    fields = {
        "manufacturer": "PhaseZeroTest",
        "model": unique_model,
        "serial": "SN-001",
        "voltage": "230V",
        "fla": "5A",
        "hp": "1",
        "frequency": "60Hz",
        "rpm": "1750",
    }

    suggestion_id: str | None = None
    instance_id: str | None = None
    try:
        result = propose_from_nameplate(
            tenant_id=STAGING_TENANT,
            fields=fields,
            uns_path=None,
            asset_id=None,
            photo_path=f"verify://phase0/{unique_model}.jpg",
            chat_id="phase0-verify",
        )
        assert result, "worker returned empty dict — refused to write"
        suggestion_id = result["suggestion_id"]
        instance_id = result.get("instance_id")
        assert result["suggestion_type"] in ("component_profile", "kg_entity")
        assert result["confidence"] >= 0.30

        # Re-read the row from a fresh transaction.
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    "SELECT suggestion_type, status, proposed_by, "
                    "       extracted_data->>'model', confidence "
                    "FROM ai_suggestions WHERE id = %s",
                    (suggestion_id,),
                )
                row = cur.fetchone()
                assert row is not None, "worker claimed to write but row absent"
                stype, status, proposed_by, model_field, conf = row
                assert stype == result["suggestion_type"]
                assert status == "pending"
                assert proposed_by == "photo:phase0-verify"
                assert model_field == unique_model
                assert abs(conf - result["confidence"]) < 1e-6

    finally:
        with conn:
            with conn.cursor() as cur:
                if suggestion_id:
                    cur.execute(
                        "DELETE FROM ai_suggestions WHERE id = %s",
                        (suggestion_id,),
                    )
                if instance_id:
                    cur.execute(
                        "DELETE FROM installed_component_instances WHERE id = %s",
                        (instance_id,),
                    )


def test_propose_from_nameplate_template_match_writes_instance(conn):
    """Template-match branch: nameplate matches an existing component_templates
    row → worker writes BOTH an installed_component_instances row AND an
    ai_suggestions row (suggestion_type='kg_entity').

    This exercises the code path that the prior test deliberately avoids
    (it uses a unique model so no template matches). Without this, a typo
    on the installed_component_instances INSERT would never trip in CI.
    """
    from shared.workers.photo_ingest_worker import propose_from_nameplate

    template_id = str(uuid.uuid4())
    template_mfr = "PhaseZeroVendor"
    template_model = f"TPL-{uuid.uuid4().hex[:8]}"

    suggestion_id: str | None = None
    instance_id: str | None = None

    try:
        # Seed a component_templates row so the worker's _find_template
        # branch returns a match. component_templates is global (no
        # tenant_id) — _find_template selects by (manufacturer, model)
        # case-insensitive. Most NOT NULL JSONB fields have '{}' / '[]'
        # defaults; component_category + component_type do not.
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO component_templates
                          (id, manufacturer, model,
                           component_category, component_type)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (
                        template_id,
                        template_mfr, template_model,
                        "drive", "vfd",
                    ),
                )

        result = propose_from_nameplate(
            tenant_id=STAGING_TENANT,
            fields={
                "manufacturer": template_mfr,
                "model": template_model,
                "serial": "TPL-SN-1",
                "voltage": "480V",
                "fla": "3.5A",
                "hp": "2",
                "frequency": "60Hz",
                "rpm": "1750",
            },
            chat_id="phase0-tplmatch",
        )
        assert result, "worker refused to write for template-match nameplate"
        suggestion_id = result["suggestion_id"]
        instance_id = result.get("instance_id")
        assert result["suggestion_type"] == "kg_entity", (
            f"expected kg_entity (template matched), got {result['suggestion_type']}"
        )
        assert instance_id, "kg_entity branch must produce an installed_component_instance"

        # Confirm the installed_component_instances row exists with the
        # template binding the worker claims it wrote.
        with conn:
            with conn.cursor() as cur:
                _with_tenant(cur, STAGING_TENANT)
                cur.execute(
                    "SELECT template_id, human_confirmed, component_name "
                    "FROM installed_component_instances WHERE id = %s",
                    (instance_id,),
                )
                row = cur.fetchone()
                assert row is not None, "instance row missing"
                tid, confirmed, cname = row
                assert str(tid) == template_id
                assert confirmed is False, \
                    "proposed-from-photo instance must not be auto-confirmed"
                assert template_model in cname
    finally:
        with conn:
            with conn.cursor() as cur:
                if suggestion_id:
                    cur.execute(
                        "DELETE FROM ai_suggestions WHERE id = %s",
                        (suggestion_id,),
                    )
                if instance_id:
                    cur.execute(
                        "DELETE FROM installed_component_instances WHERE id = %s",
                        (instance_id,),
                    )
                cur.execute(
                    "DELETE FROM component_templates WHERE id = %s",
                    (template_id,),
                )


def test_propose_from_nameplate_empty_tenant_no_write():
    """Early exit: empty tenant → no NeonDB call at all."""
    from shared.workers.photo_ingest_worker import propose_from_nameplate

    out = propose_from_nameplate(
        tenant_id="",
        fields={"manufacturer": "X", "model": "Y"},
    )
    assert out == {}, f"expected empty result, got {out!r}"
