"""Migration 065 (evidence_item content BYTEA) — ephemeral-postgres proof.

Reuses the 063 harness from test_visual_session_migration (module fixtures
import across files because mira-bots/tests has no __init__.py — same pattern
as test_visual_equipment_migration.py). Applies 063 then 065 to a real
postgres:16 container and proves, connected AS factorylm_app (never the
superuser, which would bypass RLS):

  1. The new columns exist and round-trip bytes + sniffed MIME for the owning
     tenant (positive control FIRST, so the isolation assertions can't pass
     vacuously).
  2. Tenant B cannot see tenant A's evidence content (RLS isolation).
  3. DELETE on evidence_item stays revoked (append-only ledger discipline).
  4. Migration 065 is idempotent (re-run applies cleanly).

Skips cleanly without Docker; runs for real in CI's test-unit job.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from test_visual_session_migration import (  # noqa: E402,F401 - shared harness fixtures
    _SKIP_REASON,
    _docker_available,
    app_role_url,
    pg_container,
)

pytestmark = pytest.mark.skipif(not _docker_available(), reason=_SKIP_REASON)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION_065 = _REPO_ROOT / "mira-hub" / "db" / "migrations" / "065_evidence_item_content.sql"

TENANT_A = str(uuid.uuid4())
TENANT_B = str(uuid.uuid4())

PNG_BYTES = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"unit-test-payload"


@pytest.fixture(scope="module")
def content_url(
    pg_container: dict,  # noqa: F811 -- pytest fixture param; ruff doesn't know it isn't the import
    app_role_url: str,  # noqa: F811 -- pytest fixture param; ruff doesn't know it isn't the import
) -> str:
    """Apply migration 065 on top of 063; return the factorylm_app DSN."""
    import psycopg2

    conn = psycopg2.connect(pg_container["admin_url"])
    conn.autocommit = True
    try:
        conn.cursor().execute(_MIGRATION_065.read_text(encoding="utf-8"))
    finally:
        conn.close()
    return app_role_url


def _app_conn(url: str, tenant_id: str):
    """factorylm_app connection with the RLS tenant setting applied."""
    import psycopg2

    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute("SET app.current_tenant_id = %s", (tenant_id,))
    return conn, cur


def test_content_roundtrip_and_rls_isolation(content_url: str) -> None:
    conn_a, cur_a = _app_conn(content_url, TENANT_A)
    try:
        cur_a.execute(
            "INSERT INTO visual_session (tenant_id, title) VALUES (%s, %s) RETURNING session_id",
            (TENANT_A, "content migration test"),
        )
        session_id = cur_a.fetchone()[0]
        cur_a.execute(
            """
            INSERT INTO evidence_item
                (session_id, tenant_id, source_type, original_hash, content, content_mime, capture_meta)
            VALUES (%s, %s, 'print', %s, %s, %s, %s)
            RETURNING evidence_id
            """,
            (
                session_id,
                TENANT_A,
                "deadbeef",
                psycopg2_binary(PNG_BYTES),
                "image/png",
                '{"width": 1600, "height": 900, "uploaded_via": "hub"}',
            ),
        )
        evidence_id = cur_a.fetchone()[0]
        conn_a.commit()

        # Positive control: the owner reads its own bytes back verbatim.
        cur_a.execute(
            "SELECT content, content_mime FROM evidence_item WHERE evidence_id = %s AND tenant_id = %s",
            (evidence_id, TENANT_A),
        )
        row = cur_a.fetchone()
        assert row is not None
        assert bytes(row[0]) == PNG_BYTES
        assert row[1] == "image/png"
    finally:
        conn_a.close()

    # RLS hard gate: tenant B sees nothing — not the row, not via bare id.
    conn_b, cur_b = _app_conn(content_url, TENANT_B)
    try:
        cur_b.execute("SELECT content FROM evidence_item WHERE evidence_id = %s", (evidence_id,))
        assert cur_b.fetchone() is None
        cur_b.execute("SELECT count(*) FROM evidence_item")
        assert cur_b.fetchone()[0] == 0
    finally:
        conn_b.close()


def test_delete_stays_revoked(content_url: str) -> None:
    """063's REVOKE DELETE survives 065 — the evidence ledger stays append-only."""
    import psycopg2

    conn, cur = _app_conn(content_url, TENANT_A)
    try:
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute("DELETE FROM evidence_item WHERE tenant_id = %s", (TENANT_A,))
    finally:
        conn.close()


def test_migration_065_is_idempotent(
    pg_container: dict,  # noqa: F811 -- pytest fixture param; ruff doesn't know it isn't the import
    content_url: str,
) -> None:
    import psycopg2

    conn = psycopg2.connect(pg_container["admin_url"])
    conn.autocommit = True
    try:
        # Re-running the whole file (ADD COLUMN IF NOT EXISTS) must not error.
        conn.cursor().execute(_MIGRATION_065.read_text(encoding="utf-8"))
    finally:
        conn.close()


def psycopg2_binary(data: bytes):
    import psycopg2

    return psycopg2.Binary(data)
