"""Live-Postgres tests — BM25 exact catalog-identifier pre-pass in shared/neon_recall.py.

The question these answer cannot be answered by a mock: does Postgres's own
'english' parser + GIN @@ find the row that holds a complete catalog identifier
when the identifier sits inside a wordy technician question, while keeping a
sibling number (GS13N-23P0) or a longer suffix (755-EENET-CM-S1) distinct, and
while the tenant / privacy / approval filters still apply? Real to_tsvector,
real plainto_tsquery, real ts_rank_cd.

Builds its own `knowledge_entries` with the staging column definition
(`content_tsv` GENERATED from to_tsvector('english', coalesce(content, '')) +
GIN). Gated like the other disposable-DB suites:
    TEST_DATABASE_URL          a disposable Postgres connection string
    MIRA_TEST_DB_CONFIRM=DISPOSABLE

    docker run -d --rm --name mira-bm25-pg -p 55437:5432 \\
        -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test postgres:16
    cd mira-bots && TEST_DATABASE_URL=postgresql://postgres:testpw@localhost:55437/mira_test \\
        MIRA_TEST_DB_CONFIRM=DISPOSABLE python -m pytest tests/test_recall_bm25_identifiers_pg.py -v -p no:xdist
"""

from __future__ import annotations

import os
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or os.getenv("MIRA_TEST_DB_CONFIRM") != "DISPOSABLE",
    reason="needs TEST_DATABASE_URL (disposable Postgres) + MIRA_TEST_DB_CONFIRM=DISPOSABLE",
)

sqlalchemy = pytest.importorskip("sqlalchemy")
pytest.importorskip("psycopg2")

from shared import neon_recall  # noqa: E402

T1 = "11111111-1111-1111-1111-111111111111"
T2 = "22222222-2222-2222-2222-222222222222"

GS10_B = (
    "B, GS10 DURApUlse Drive Models by Frame Size. Drive = GS11N-21P0, GS13N-22P0, GS13N-42P0. "
    "Mounting kit frame B."
)
GS10_C = (
    "C, GS10 DURApUlse Drive Models by Frame Size. Drive = GS11N-22P0, GS13N-23P0, GS13N-43P0. "
    "Mounting kit frame C."
)
SUFFIX_X = (
    "Spare part GS13N-22P0X is a remote keypad bezel, not a drive. Order through the parts catalog."
)
EENET_S1 = (
    "Use the 755-EENET-CM-S1 adapter in port 6 when the drive has the Safe Speed Monitor option."
)
EENET = "The 755-EENET-CM adapter installs in port 4 for Integrated Motion on EtherNet/IP without safety."
PRIVATE = (
    "Private shop note: our GS13N-22P0 drive frame size and mounting kit were ordered from catalog."
)
UNVERIFIED = "Unapproved draft: GS13N-22P0 frame size mounting kit catalog number order."
# Generic prose that shares every common word of the question but no identifier.
DISTRACTORS = [
    f"Frame size and drive catalog number {i}: before you order a mounting kit, find the frame size "
    f"from the drive catalog number. What frame size, which mounting kit, which catalog number to order. "
    f"Need to know the drive frame size before ordering the mounting kit."
    for i in range(12)
]
ORDINARY = "Set the acceleration time parameter to change how fast the drive ramps to frequency."
RATINGS = "Input rating: 3-phase 480V/60Hz, 24-volt control supply, 6-pulse rectifier, 50/60Hz."
# Wrong-model control: another model's catalog table, same wording, a different catalog number.
WRONG_MODEL = (
    "PowerFlex 40 Drive Models by Frame Size. Drive = 22B-D2P3N104, 22B-D4P0N104. "
    "Frame size B mounting kit catalog number."
)


def _rows():
    pub = dict(is_private=False, tenant_id=None, verified=True)
    out = [
        dict(content=GS10_B, manufacturer="AutomationDirect", model_number="GS10", **pub),
        dict(content=GS10_C, manufacturer="AutomationDirect", model_number="GS10", **pub),
        dict(content=SUFFIX_X, manufacturer="AutomationDirect", model_number="GS10", **pub),
        dict(content=EENET_S1, manufacturer="Allen-Bradley", model_number="PowerFlex 755", **pub),
        dict(content=EENET, manufacturer="Allen-Bradley", model_number="PowerFlex 755", **pub),
        dict(
            content=PRIVATE,
            manufacturer="AutomationDirect",
            model_number="GS10",
            is_private=True,
            tenant_id=T1,
            verified=True,
        ),
        dict(
            content=UNVERIFIED,
            manufacturer="AutomationDirect",
            model_number="GS10",
            is_private=False,
            tenant_id=None,
            verified=False,
        ),
        dict(content=ORDINARY, manufacturer="Yaskawa", model_number="GA500", **pub),
        dict(content=RATINGS, manufacturer="Yaskawa", model_number="GA800", **pub),
        dict(
            content=WRONG_MODEL,
            manufacturer="Rockwell Automation",
            model_number="PowerFlex 40",
            **pub,
        ),
    ]
    out += [
        dict(content=d, manufacturer="Rockwell Automation", model_number="PowerFlex 40", **pub)
        for d in DISTRACTORS
    ]
    return out


@pytest.fixture(scope="module")
def engine():
    eng = sqlalchemy.create_engine(TEST_DATABASE_URL, poolclass=sqlalchemy.pool.NullPool)
    with eng.begin() as c:
        c.execute(sqlalchemy.text("DROP TABLE IF EXISTS knowledge_entries"))
        c.execute(
            sqlalchemy.text("""
            CREATE TABLE knowledge_entries (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid, content text, manufacturer text, model_number text,
              equipment_type text, source_type text DEFAULT 'equipment_manual', source_url text,
              source_page integer, metadata jsonb DEFAULT '{}'::jsonb,
              verified boolean DEFAULT false, is_private boolean DEFAULT true,
              content_tsv tsvector GENERATED ALWAYS AS
                (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED)""")
        )
        c.execute(
            sqlalchemy.text(
                "CREATE INDEX idx_knowledge_entries_content_tsv ON knowledge_entries USING gin (content_tsv)"
            )
        )
        for r in _rows():
            c.execute(
                sqlalchemy.text(
                    "INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, verified, "
                    "is_private, source_url) VALUES (:tenant_id, :content, :manufacturer, :model_number, "
                    ":verified, :is_private, 'test.pdf')"
                ),
                r,
            )
    yield eng
    with eng.begin() as c:
        c.execute(sqlalchemy.text("DROP TABLE IF EXISTS knowledge_entries"))
    eng.dispose()


class _Recorder:
    """Pass-through connection that records every statement + its bind params."""

    def __init__(self, conn):
        self.conn, self.calls = conn, []

    def execute(self, stmt, params=None):
        self.calls.append((str(stmt), dict(params or {})))
        return self.conn.execute(stmt, params)


def _bm25(engine, query, tenant=None, limit=6, gate="false", monkeypatch=None):
    monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", gate)
    with engine.connect() as conn:
        rec = _Recorder(conn)
        rows = neon_recall._recall_bm25(rec, sqlalchemy.text, tenant, query, limit)
    return [r["content"] for r in rows], rec.calls


def _rank(contents, needle):
    return next((i for i, c in enumerate(contents, 1) if c == needle), None)


QUESTION = (
    "What frame size is the GS10 drive with catalog number GS13N-22P0? "
    "I need to know before I order a mounting kit."
)


# --- identifier alone and inside realistic questions -------------------------------------


def test_precondition_generic_prose_outranks_the_identifier_row_without_the_prepass(
    engine, monkeypatch
):
    """Proves the fixture reproduces the defect: the old OR-fanout alone buries GS10_B."""
    monkeypatch.setattr(neon_recall, "_catalog_identifiers", lambda q: [])
    contents, _ = _bm25(engine, QUESTION, monkeypatch=monkeypatch)
    assert _rank(contents, GS10_B) is None or _rank(contents, GS10_B) > 3


def test_identifier_alone_ranks_its_row_first(engine, monkeypatch):
    contents, _ = _bm25(engine, "GS13N-22P0", monkeypatch=monkeypatch)
    assert contents[0] == GS10_B


@pytest.mark.parametrize(
    "question",
    [
        QUESTION,
        "Our nameplate reads GS13N-22P0. What frame is it?",
        "frame size for catalog number gs13n-22p0 drive, need mounting kit before ordering",
    ],
)
def test_identifier_inside_a_wordy_question_ranks_its_row_first(engine, monkeypatch, question):
    contents, _ = _bm25(engine, question, monkeypatch=monkeypatch)
    assert contents[0] == GS10_B


def test_full_recall_knowledge_top3_contains_the_identifier_row(engine, monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false")
    real_create = sqlalchemy.create_engine

    def no_ssl(url, **kw):  # disposable Postgres has no TLS; recall_knowledge pins sslmode=require
        kw.pop("connect_args", None)
        return real_create(url, **kw)

    monkeypatch.setattr(sqlalchemy, "create_engine", no_ssl)
    rows = neon_recall.recall_knowledge(None, None, 3, QUESTION)
    assert GS10_B in [r["content"] for r in rows]


# --- siblings and suffixes stay distinct ---------------------------------------------------


def test_sibling_number_selects_its_own_row_not_the_neighbour(engine, monkeypatch):
    contents, calls = _bm25(engine, "What frame is a GS13N-23P0?", monkeypatch=monkeypatch)
    assert contents[0] == GS10_C
    assert _rank(contents, GS10_B) is None or _rank(contents, GS10_B) > _rank(contents, GS10_C)


def test_longer_suffix_does_not_satisfy_the_shorter_identifier(engine, monkeypatch):
    contents, _ = _bm25(
        engine, "Which port does the 755-EENET-CM adapter use?", monkeypatch=monkeypatch
    )
    assert contents[0] == EENET
    contents, _ = _bm25(
        engine, "Which port does the 755-EENET-CM-S1 adapter use?", monkeypatch=monkeypatch
    )
    assert contents[0] == EENET_S1


def test_identifier_does_not_match_a_suffixed_part_number(engine, monkeypatch):
    with engine.connect() as conn:
        n = conn.execute(
            sqlalchemy.text(
                "SELECT count(*) FROM knowledge_entries WHERE content_tsv @@ plainto_tsquery('english', :q)"
            ),
            {"q": "GS13N-22P0"},
        ).scalar()
        hits = (
            conn.execute(
                sqlalchemy.text(
                    "SELECT content FROM knowledge_entries WHERE content_tsv @@ plainto_tsquery('english', :q)"
                ),
                {"q": "GS13N-22P0"},
            )
            .scalars()
            .all()
        )
    assert n == 3  # GS10_B, PRIVATE, UNVERIFIED — never SUFFIX_X (GS13N-22P0X)
    assert SUFFIX_X not in hits


# --- queries without identifiers are untouched ---------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "how do I change the acceleration time on the drive",
        "ACH580 fault 2310 overcurrent",
        "Micro820 analog input wiring",
        "PowerFlex 525 F0004 undervoltage",
        "V1000 T1-07 base speed and H3-09 gain",
        # ratings and wiring phrasing that has separators, letters and digits but is no part number
        "is this a 3-phase 480V/60Hz drive or 24-volt",
        "6-pulse rectifier on a 50/60Hz supply",
        "12-24VDC sensor on a 15000rpm spindle",
    ],
)
def test_query_without_identifier_runs_exactly_one_unchanged_statement(engine, monkeypatch, query):
    assert neon_recall._catalog_identifiers(query) == []
    _, calls = _bm25(engine, query, monkeypatch=monkeypatch)
    assert len(calls) == 1
    sql, params = calls[0]
    assert "plainto_tsquery" not in sql and not any(k.startswith("cid") for k in params)


def test_ordinary_query_still_returns_its_row(engine, monkeypatch):
    contents, _ = _bm25(engine, "acceleration time ramps frequency", monkeypatch=monkeypatch)
    assert contents and contents[0] == ORDINARY


def test_ratings_question_still_returns_its_row(engine, monkeypatch):
    contents, _ = _bm25(
        engine, "3-phase 480V/60Hz 24-volt 6-pulse rectifier", monkeypatch=monkeypatch
    )
    assert contents and contents[0] == RATINGS


# --- wrong-model control ---------------------------------------------------------------------


def test_wrong_model_table_with_same_wording_does_not_outrank_the_identifier_row(
    engine, monkeypatch
):
    """Another model's frame table shares every word of the question but not the catalog number."""
    contents, _ = _bm25(engine, QUESTION, monkeypatch=monkeypatch)
    assert contents[0] == GS10_B
    assert _rank(contents, WRONG_MODEL) is None or _rank(contents, WRONG_MODEL) > 1


def test_prepass_rows_all_hold_the_identifier(engine, monkeypatch):
    """Rows the pre-pass leads with must contain the complete identifier — never a lookalike."""
    with engine.connect() as conn:
        rec = _Recorder(conn)
        monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false")
        neon_recall._recall_bm25(rec, sqlalchemy.text, None, QUESTION, 6)
        sql, params = next(c for c in rec.calls if "plainto_tsquery" in c[0])
        pre = [r["content"] for r in conn.execute(sqlalchemy.text(sql), params).mappings()]
    assert pre and all("GS13N-22P0" in c and "GS13N-22P0X" not in c for c in pre)
    assert WRONG_MODEL not in pre and GS10_C not in pre


# --- privacy, tenancy and approval stay enforced on the pre-pass ----------------------------


def test_anonymous_and_other_tenant_never_see_a_private_identifier_row(engine, monkeypatch):
    for tenant in (None, T2):
        contents, _ = _bm25(engine, QUESTION, tenant=tenant, monkeypatch=monkeypatch)
        assert PRIVATE not in contents


def test_owning_tenant_sees_its_private_identifier_row(engine, monkeypatch):
    contents, _ = _bm25(engine, QUESTION, tenant=T1, monkeypatch=monkeypatch)
    assert PRIVATE in contents


def test_approval_gate_excludes_unverified_identifier_rows(engine, monkeypatch):
    on, _ = _bm25(engine, QUESTION, gate="true", monkeypatch=monkeypatch)
    off, _ = _bm25(engine, QUESTION, gate="false", monkeypatch=monkeypatch)
    assert UNVERIFIED not in on
    assert UNVERIFIED in off


# --- bounds and parameterisation ------------------------------------------------------------


def test_identifiers_are_bound_parameters_and_capped(engine, monkeypatch):
    q = "Compare GS13N-22P0 GS13N-23P0 GS11N-21P0 GS11N-22P0 GS13N-42P0 GS13N-43P0 ratings"
    _, calls = _bm25(engine, q, monkeypatch=monkeypatch)
    pre = [c for c in calls if "plainto_tsquery" in c[0]]
    assert len(pre) == 1
    sql, params = pre[0]
    cids = sorted(k for k in params if k.startswith("cid"))
    assert cids == ["cid0", "cid1", "cid2", "cid3"]
    assert "GS13N" not in sql and "gs13n" not in sql  # identifiers never interpolated into SQL


def test_result_count_never_exceeds_limit(engine, monkeypatch):
    contents, _ = _bm25(engine, QUESTION, limit=2, monkeypatch=monkeypatch)
    assert len(contents) <= 2
