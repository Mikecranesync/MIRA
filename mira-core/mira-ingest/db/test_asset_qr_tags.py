"""Contract test for asset_qr_tags + qr_scan_events schema."""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool


def _engine():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        pytest.skip("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def test_asset_qr_tags_has_required_columns():
    with _engine().connect() as conn:
        cols = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = 'asset_qr_tags' ORDER BY ordinal_position"
            )
        ).fetchall()
    names = {c[0] for c in cols}
    assert names >= {
        "tenant_id",
        "asset_tag",
        "atlas_asset_id",
        "printed_at",
        "print_count",
        "first_scan",
        "last_scan",
        "scan_count",
        "created_at",
    }


def test_qr_scan_events_has_required_columns():
    with _engine().connect() as conn:
        cols = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'qr_scan_events'"
            )
        ).fetchall()
    names = {c[0] for c in cols}
    assert names >= {
        "id",
        "tenant_id",
        "asset_tag",
        "atlas_user_id",
        "scanned_at",
        "user_agent",
        "scan_id",
        "chat_id",
    }


def test_case_insensitive_unique_on_asset_qr_tags():
    """VFD-07 and vfd-07 must not both be insertable for the same tenant."""
    tid = "00000000-0000-0000-0000-000000000001"
    engine = _engine()
    # Clean any prior state, then seed the first row in its own transaction.
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM asset_qr_tags WHERE tenant_id = :tid"), {"tid": tid})
        conn.execute(
            text(
                "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) "
                "VALUES (:tid, 'VFD-07', 1)"
            ),
            {"tid": tid},
        )
    # Second INSERT must fail on the case-insensitive unique index. Use a nested
    # SAVEPOINT so the outer transaction survives the integrity error and we can
    # still run the cleanup DELETE.
    try:
        with engine.begin() as conn:
            with pytest.raises(Exception):
                with conn.begin_nested():
                    conn.execute(
                        text(
                            "INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) "
                            "VALUES (:tid, 'vfd-07', 2)"
                        ),
                        {"tid": tid},
                    )
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM asset_qr_tags WHERE tenant_id = :tid"), {"tid": tid})
