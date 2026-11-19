"""Bot and ingest recall never serve a Hub row released under a reviewed table approval (#5646).

The Hub stamps a row its model-scope gate released with ``metadata.table_reviewed`` and admits it
only while that approval is enabled in ``mira-hub/src/capabilities/table-rule-pins.json``. Python
services cannot read that file, so they exclude every stamped row: an approval switched off can
never reach a bot answer through recall. Rows without the stamp are unaffected.

Two layers:
* every recall query sends the exclusion (captured SQL, no database);
* against a disposable Postgres, a stamped row is not returned while an otherwise identical
  unstamped row is (skipped unless TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM=DISPOSABLE).
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")
os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import _like_search, _product_search, _recall_bm25, recall_knowledge  # noqa: E402

EXCLUSION = "(metadata->>'table_reviewed') IS NULL"
REPO = Path(__file__).resolve().parents[2]


def _conn() -> MagicMock:
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = []
    return conn


def _sql_of(conn: MagicMock) -> list[str]:
    return [str(call.args[0]) for call in conn.execute.call_args_list]


@pytest.mark.parametrize("tenant", ["11111111-1111-4111-8111-111111111111", None])
def test_every_bot_recall_query_excludes_released_rows(tenant):
    for run in (
        lambda c: _like_search(c, str, tenant, ["GS10"], limit=5),
        lambda c: _product_search(c, str, tenant, ["GS10"], embedding=[0.5] * 4, limit=5),
        lambda c: _recall_bm25(c, str, tenant, "gs10 input current", limit=5),
    ):
        conn = _conn()
        run(conn)
        sqls = [s for s in _sql_of(conn) if "knowledge_entries" in s]
        assert sqls, "precondition: the query ran"
        assert all(EXCLUSION in s for s in sqls)


def test_vector_recall_excludes_released_rows():
    conn = _conn()
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    import sqlalchemy

    with (
        patch.object(sqlalchemy, "create_engine", return_value=engine),
        patch.object(neon_recall, "_recall_bm25", return_value=[]),
        patch.object(neon_recall, "recall_fault_code", return_value=[]),
    ):
        recall_knowledge([0.5] * 4, "11111111-1111-4111-8111-111111111111", query_text="gs10")
    vector = [
        s
        for s in _sql_of(conn)
        if "embedding <=> cast(:emb AS vector)" in s and "FROM knowledge_entries" in s
    ]
    assert vector, "precondition: the vector stream ran"
    assert all(EXCLUSION in s for s in vector)


def _ingest_neon():
    sys.path.insert(0, str(REPO / "mira-core" / "mira-ingest"))
    try:
        from db import neon  # the ingest service's own package, as its tests import it
    finally:
        sys.path.pop(0)
    return neon


def test_ingest_visual_recall_excludes_released_rows():
    neon = _ingest_neon()
    conn = _conn()
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    with patch.object(neon, "_engine", return_value=engine):
        neon.recall_knowledge([0.5] * 4, "tenant")
        neon.recall_by_image([0.5] * 4, "tenant")
    sqls = _sql_of(conn)
    assert len(sqls) == 2
    assert all(EXCLUSION in s for s in sqls)


READY = (
    bool(os.environ.get("TEST_DATABASE_URL"))
    and os.environ.get("MIRA_TEST_DB_CONFIRM") == "DISPOSABLE"
)


@pytest.mark.skipif(
    not READY,
    reason="needs a disposable Postgres (TEST_DATABASE_URL, MIRA_TEST_DB_CONFIRM=DISPOSABLE)",
)
def test_released_row_is_not_recalled_and_an_unstamped_twin_is():
    import sqlalchemy
    from sqlalchemy import text

    engine = sqlalchemy.create_engine(
        os.environ["TEST_DATABASE_URL"].replace("postgres://", "postgresql://", 1)
    )
    tenant = str(uuid.uuid4())
    body = "GS11N-20P2: Input Rating / CT / Rated Input Current 5.1 A zqxreleasecheck"
    stamp = {
        "table_reviewed": "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5",
        "table_reviewed_sha": "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4",
    }
    with engine.begin() as conn:
        for meta, page in ((stamp, 26), ({}, 27)):
            conn.execute(
                text(
                    "INSERT INTO knowledge_entries (id, tenant_id, content, source_type, source_page, metadata, "
                    "is_private, verified, ingest_route) VALUES (:id, :t, :c, 'node_attachment', :p, "
                    "CAST(:m AS jsonb), true, true, 'v2')"
                ),
                {"id": str(uuid.uuid4()), "t": tenant, "c": body, "p": page, "m": json.dumps(meta)},
            )
    try:
        with engine.connect() as conn:
            stored = conn.execute(
                text("SELECT count(*) FROM knowledge_entries WHERE tenant_id = CAST(:t AS uuid)"),
                {"t": tenant},
            ).scalar()
            assert stored == 2  # precondition: both rows are there to be found
            for found in (
                _like_search(conn, text, tenant, ["zqxreleasecheck"], limit=10),
                _recall_bm25(conn, text, tenant, "zqxreleasecheck", limit=10),
            ):
                assert [r["source_page"] for r in found] == [27]
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM knowledge_entries WHERE tenant_id = CAST(:t AS uuid)"),
                {"t": tenant},
            )
