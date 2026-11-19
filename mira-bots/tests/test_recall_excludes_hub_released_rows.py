"""Python readers never serve a row of a Hub-approved table page, in either switch state (#5646).

The Hub releases an approved page's reviewed rows only while that approval is enabled in
``mira-hub/src/capabilities/table-rule-pins.json``. Python services cannot read that file, so every
Python reader excludes every row of an approved page (``mira-bots/shared/hub_release.py``): a row
the Hub marked, a row identified by its file hash, and a node row stored before either, recognised
by its page. Rows of every other page and document are unaffected.

Layers:
* the approved pages and catalog numbers equal the pin file's recorded approvals, and the ingest
  service and Open WebUI copies equal this package's clauses (source parse, no database);
* every bot recall query sends the exclusion (captured SQL, no database; the ingest service's
  own recall is covered in mira-core/mira-ingest/tests/test_recall_excludes_hub_rows.py);
* against a disposable Postgres, each kind of approved-page row is not returned while its controls
  are (skipped unless TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM=DISPOSABLE).
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")
os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.hub_release import (  # noqa: E402
    HUB_APPROVED_PAGE_MODELS,
    HUB_APPROVED_PAGES,
    HUB_RELEASE_EXCLUSIONS,
    hub_release_exclusions,
)
from shared.neon_recall import _like_search, _product_search, _recall_bm25, recall_knowledge  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
# Built by concatenation so the read-site scanner does not take these assertion strings for reads.
_FROM_KE = "FROM " + "knowledge_entries"
EXCLUSIONS = HUB_RELEASE_EXCLUSIONS
APPROVED_SHA = "090aa1b36250be11e1da33526a4b995492593c6fc35aa82ad18115e411dcc5e4"
APPROVED_DIGEST = "d570e81e1fc665e0fa75879a2624aab107f0765b83d6be1acf013382f70b91d5"


def _recorded_approvals() -> tuple[set[tuple[str, int]], dict[int, set[str]]]:
    """Every (file, page) whose pin records an approval digest, enabled or not, and its models."""
    pins = json.loads((ROOT / "mira-hub/src/capabilities/table-rule-pins.json").read_text())
    pages: set[tuple[str, int]] = set()
    models: dict[int, set[str]] = {}
    for sha, document in pins["documents"].items():
        for page, pin in document["pages"].items():
            if isinstance(pin.get("reviewed"), str) and re.fullmatch(
                r"[0-9a-f]{64}", pin["reviewed"]
            ):
                pages.add((sha, int(page)))
                models.setdefault(int(page), set()).update(pin.get("models", []))
    return pages, models


def test_the_approved_pages_and_models_are_the_pin_files_recorded_approvals():
    pages, models = _recorded_approvals()
    assert pages, "precondition: the pin file records an approval"
    assert set(HUB_APPROVED_PAGES) == pages
    assert {p: set(m) for p, m in HUB_APPROVED_PAGE_MODELS.items()} == models
    assert all(models.values()), "every approved page names the catalog numbers it prints"


def test_the_ingest_service_and_open_webui_copies_equal_these_clauses():
    tree = ast.parse((ROOT / "mira-core/mira-ingest/db/neon.py").read_text())
    copies = [
        ast.literal_eval(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(getattr(t, "id", None) == "_HUB_MARK_EXCLUSIONS" for t in node.targets)
    ]
    assert copies == [HUB_RELEASE_EXCLUSIONS]
    owui = (ROOT / "tools/owui_tools/lookup_part.py").read_text()
    assert [line.strip() for line in owui.splitlines() if line.strip().startswith("AND (")][
        -4:
    ] == [f"AND {c}" for c in HUB_RELEASE_EXCLUSIONS]


def test_the_clauses_withhold_every_kind_of_approved_page_row_and_nothing_else():
    """The shape the database test below proves, for any recorded approval set."""
    none = hub_release_exclusions(pages=())
    assert none == HUB_RELEASE_EXCLUSIONS[:2]  # no approval: the marks only
    clauses = hub_release_exclusions(pages=(("a" * 64, 7),), models={7: ("AB-123",)})
    assert "('" + "a" * 64 + "', '7')" in clauses[2]
    assert "<> 7" in clauses[3] and "strpos(s.content, 'AB-123') > 0" in clauses[3]
    assert "LIKE" not in " ".join(clauses) and "%" not in " ".join(clauses)
    # A page with no recorded catalog numbers withholds every older node row of that page.
    assert hub_release_exclusions(pages=(("a" * 64, 7),), models={})[3].endswith("AND (TRUE)))")


def _excludes(sql: str) -> bool:
    return all(e in sql for e in EXCLUSIONS)


def _conn() -> MagicMock:
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = []
    return conn


def _sql_of(conn: MagicMock) -> list[str]:
    return [str(call.args[0]) for call in conn.execute.call_args_list]


def _captured_queries() -> list[tuple[str, dict]]:
    """Every knowledge_entries read each bot reader sends, with its parameters (no database)."""
    from shared import pm_extractor

    out: list[tuple[str, dict]] = []

    def grab(conn: MagicMock) -> None:
        for call in conn.execute.call_args_list:
            sql = str(call.args[0])
            if _FROM_KE in sql:
                out.append((sql, dict(call.args[1]) if len(call.args) > 1 else {}))

    tenant = "11111111-1111-4111-8111-111111111111"
    for run in (
        lambda c: _like_search(c, str, tenant, ["GS10"], limit=5),
        lambda c: _product_search(c, str, tenant, ["GS10"], embedding=[0.5] * 4, limit=5),
        lambda c: _recall_bm25(c, str, tenant, "gs10 input current", limit=5),
    ):
        conn = _conn()
        run(conn)
        grab(conn)
    import sqlalchemy

    def engine_for(conn: MagicMock) -> MagicMock:
        engine = MagicMock()
        engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
        engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        return engine

    conn = _conn()
    with (
        patch.object(sqlalchemy, "create_engine", return_value=engine_for(conn)),
        patch.object(neon_recall, "_recall_bm25", return_value=[]),
        patch.object(neon_recall, "recall_fault_code", return_value=[]),
    ):
        recall_knowledge([0.5] * 4, tenant, query_text="gs10")
    grab(conn)
    conn = _conn()
    conn.execute.return_value.fetchall.return_value = []
    with patch.object(pm_extractor, "_get_neon_engine", return_value=engine_for(conn)):
        pm_extractor.get_chunks_for_model("AutomationDirect", "GS11N-20P2", tenant_id=tenant)
    grab(conn)
    return out


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
        s for s in _sql_of(conn) if "embedding <=> cast(:emb AS vector)" in s and _FROM_KE in s
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
def test_no_kind_of_approved_page_row_is_recalled_and_every_control_is():
    import sqlalchemy
    from sqlalchemy import text

    engine = sqlalchemy.create_engine(
        os.environ["TEST_DATABASE_URL"].replace("postgres://", "postgresql://", 1)
    )
    tenant = str(uuid.uuid4())
    legacy_doc, other_doc, file_doc = (str(uuid.uuid4()) for _ in range(3))
    marker = "zqxreleasecheck"
    stamp = {"table_reviewed": APPROVED_DIGEST, "table_reviewed_sha": APPROVED_SHA}
    held = {"table_held": APPROVED_DIGEST, "table_held_sha": APPROVED_SHA}
    # (case, source_type, doc, page, metadata, extra text) — "x-" cases must never be recalled.
    rows = [
        ("x-released", "node_attachment", file_doc, 26, {**stamp, "file_sha256": APPROVED_SHA}, ""),
        ("x-held", "node_attachment", file_doc, 25, held, ""),
        ("x-file", "node_attachment", file_doc, 26, {"file_sha256": APPROVED_SHA}, ""),
        (
            "x-legacy-named",
            "node_attachment",
            legacy_doc,
            26,
            {},
            "GS11N-20P2: Rated Input Current 5.1 A",
        ),
        ("x-legacy-sibling", "node_attachment", legacy_doc, 26, {}, "Note: refer to Derate Output"),
        ("ok-file-other-page", "node_attachment", file_doc, 27, {"file_sha256": APPROVED_SHA}, ""),
        (
            "ok-legacy-other-page",
            "node_attachment",
            legacy_doc,
            27,
            {},
            "GS11N-20P2 mentioned on page 27",
        ),
        ("ok-other-doc-page26", "node_attachment", other_doc, 26, {}, "Conveyor motor M-7 5.1 A"),
        ("ok-other-file", "node_attachment", other_doc, 26, {"file_sha256": "b" * 64}, ""),
        (
            "ok-oem-corpus",
            "equipment_manual",
            None,
            26,
            {},
            "GS11N-20P2: Rated Input Current 5.1 A",
        ),
    ]
    with engine.begin() as conn:
        for idx, (case, source_type, doc, page, meta, extra) in enumerate(rows):
            conn.execute(
                text(
                    "INSERT INTO knowledge_entries (id, tenant_id, content, source_type, source_url, source_page, "
                    "page_start, page_end, doc_id, metadata, is_private, verified, ingest_route) VALUES "
                    "(:id, :t, :c, :st, :u, :p, :p, :p, CAST(:d AS uuid), CAST(:m AS jsonb), true, true, 'v2')"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "t": tenant,
                    "c": f"{marker} case{idx} {extra}",
                    "st": source_type,
                    "u": f"node-doc/{doc}/gs10.pdf#{idx}",
                    "p": page,
                    "d": doc,
                    "m": json.dumps(meta),
                },
            )
    expected = sorted(f"case{i}" for i, r in enumerate(rows) if r[0].startswith("ok-"))
    try:
        with engine.connect() as conn:
            stored = conn.execute(
                text("SELECT count(*) FROM knowledge_entries WHERE tenant_id = CAST(:t AS uuid)"),
                {"t": tenant},
            ).scalar()
            assert stored == len(rows)  # precondition: every row is there to be found
            for found in (
                _like_search(conn, text, tenant, [marker], limit=50),
                _recall_bm25(conn, text, tenant, marker, limit=50),
            ):
                assert (
                    sorted(re.search(r"case\d+", r["content"]).group(0) for r in found) == expected
                )
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
    assert src.count(_FROM_KE) == 2  # the query and the exclusion's own same-page lookup
    assert src.count(_FROM_KE + " s ") == 1
    assert _excludes(src)


_NOT_AN_ALIAS = {"WHERE", "ORDER", "LIMIT", "GROUP", "JOIN", "CROSS", "LEFT", "INNER"}


def outer_table_is_unaliased(sql: str) -> bool:
    """The same-page lookup names the outer table ``knowledge_entries``; an alias would hide it."""
    body = sql
    for clause in HUB_RELEASE_EXCLUSIONS:
        body = body.replace(clause, "")
    names = re.findall(r"FROM\s+knowledge_entries\b(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?", body)
    return bool(names) and all(n == "" or n.upper() in _NOT_AN_ALIAS for n in names)


def test_every_bot_query_with_the_exclusion_reads_an_unaliased_table():
    queries = _captured_queries()
    assert len(queries) >= 5, (
        "precondition: like, product, BM25, vector and PM queries were captured"
    )
    assert all(_excludes(sql) for sql, _ in queries)
    assert all(outer_table_is_unaliased(sql) for sql, _ in queries)
    # Control: the check rejects an aliased read.
    assert not outer_table_is_unaliased("SELECT 1 FROM knowledge_entries ke WHERE TRUE")
    assert outer_table_is_unaliased("SELECT 1 FROM knowledge_entries\n WHERE TRUE")


@pytest.mark.skipif(
    not READY,
    reason="needs a disposable Postgres (TEST_DATABASE_URL, MIRA_TEST_DB_CONFIRM=DISPOSABLE)",
)
def test_every_bot_query_without_a_vector_plans_on_postgres():
    """Planned for real (the test database has no pgvector, so vector queries are checked above)."""
    import sqlalchemy
    from sqlalchemy import text

    planned = [
        (sql, p) for sql, p in _captured_queries() if "vector" not in sql and "embedding" not in sql
    ]
    assert len(planned) >= 3, "precondition: like, BM25 and PM queries"
    engine = sqlalchemy.create_engine(
        os.environ["TEST_DATABASE_URL"].replace("postgres://", "postgresql://", 1)
    )
    with engine.connect() as conn:
        for sql, params in planned:
            conn.execute(text("EXPLAIN " + sql), params)
