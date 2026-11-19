"""Bot and ingest recall never serve a Hub row released under a reviewed table approval (#5646).

The Hub stamps a row its model-scope gate released with ``metadata.table_reviewed`` and admits it
only while that approval is enabled in ``mira-hub/src/capabilities/table-rule-pins.json``. Python
services cannot read that file, so they exclude every stamped row: an approval switched off can
never reach a bot answer through recall. Rows without the stamp are unaffected.

Two layers:
* every bot recall query sends the exclusion (captured SQL, no database; the ingest service's
  own recall is covered in mira-core/mira-ingest/tests/test_recall_excludes_hub_rows.py);
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

EXCLUSIONS = ("(metadata->>'table_reviewed') IS NULL", "(metadata->>'table_held') IS NULL")


def _excludes(sql: str) -> bool:
    return all(e in sql for e in EXCLUSIONS)


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
        assert all(_excludes(s) for s in sqls)


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
    assert all(_excludes(s) for s in vector)


READY = (
    bool(os.environ.get("TEST_DATABASE_URL"))
    and os.environ.get("MIRA_TEST_DB_CONFIRM") == "DISPOSABLE"
)


@pytest.mark.skipif(
    not READY,
    reason="needs a disposable Postgres (TEST_DATABASE_URL, MIRA_TEST_DB_CONFIRM=DISPOSABLE)",
)
def test_released_and_held_rows_are_not_recalled_and_an_unmarked_twin_is():
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
        held = {
            "table_held": stamp["table_reviewed"],
            "table_held_sha": stamp["table_reviewed_sha"],
        }
        for meta, page in ((stamp, 26), (held, 25), ({}, 27)):
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
            assert stored == 3  # precondition: all three rows are there to be found
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


def test_pm_extraction_and_owui_part_lookup_exclude_marked_rows():
    """Two more content readers that feed a model: PM extraction and the Open WebUI part lookup."""
    from shared import pm_extractor

    conn = _conn()
    conn.execute.return_value.fetchall.return_value = []
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    with patch.object(pm_extractor, "_get_neon_engine", return_value=engine):
        pm_extractor.get_chunks_for_model("AutomationDirect", "GS11N-20P2", tenant_id=None)
    sqls = _sql_of(conn)
    assert sqls, "precondition: the query ran"
    assert all(_excludes(s) for s in sqls)
    # The Open WebUI tool runs outside this package; its one SQL string is checked in source.
    src = (
        Path(__file__).resolve().parents[2] / "tools" / "owui_tools" / "lookup_part.py"
    ).read_text()
    assert src.count("FROM knowledge_entries") == 1
    assert _excludes(src)
