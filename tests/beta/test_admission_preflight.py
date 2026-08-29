"""PRD §7.3 — tenant-scoped, READ-ONLY historical repair/preflight report.

The tool never mutates anything and never runs against production from a
session: it refuses production-looking targets, opens a READ ONLY transaction,
issues exactly one SELECT bound to one tenant, and reports per-source
admission paths plus the §7.3 conclusion (`no_rewrite_required` when every
confirmed source is admitted through server-derived confirmation — the
Workstream A design — regardless of `knowledge_entries.verified`).
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import re

import pytest

_TOOL = (
    pathlib.Path(__file__).resolve().parents[2]
    / "tools"
    / "qa"
    / "notebook_source_admission_preflight.py"
)


class _Missing:
    """Placeholder namespace so a not-yet-written tool fails each test as an
    assertion for its own reason, never as a collection error."""

    def __getattr__(self, name):
        raise AssertionError(f"missing behaviour: {_TOOL.name}.{name} is not implemented")


def _load_tool():
    if not _TOOL.exists():
        return _Missing()
    spec = importlib.util.spec_from_file_location("notebook_source_admission_preflight", _TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pre = _load_tool()

TENANT = "a7000000-0000-4000-8000-000000000001"


def test_query_is_one_tenant_scoped_select_with_no_write_verbs():
    sql, params = pre.build_query(TENANT)
    assert params == (TENANT,)
    assert sql.lstrip().upper().startswith("SELECT")
    assert sql.count(";") == 0
    assert not re.search(r"\b(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT)\b", sql, re.I)
    assert "s.tenant_id = %s::uuid" in sql
    assert "k.tenant_id = s.tenant_id" in sql


def test_tenant_id_must_be_a_uuid():
    with pytest.raises(pre.PreflightRefused):
        pre.build_query("mike")
    with pytest.raises(pre.PreflightRefused):
        pre.build_query("'; DROP TABLE x; --")


@pytest.mark.parametrize(
    "url",
    [
        "postgres://u:p@ep-prod-123.neon.tech/neondb",
        "postgres://u:p@host/factorylm_prd",
        "postgres://u:p@prod.internal/db",
        "postgres://u:p@165.245.138.91/db",
    ],
)
def test_production_looking_targets_are_refused(url):
    with pytest.raises(pre.PreflightRefused):
        pre.assert_safe_target(url)


def test_staging_and_disposable_targets_are_allowed():
    pre.assert_safe_target("postgres://u:p@ep-staging-1.neon.tech/neondb")
    pre.assert_safe_target("postgres://postgres:testpw@127.0.0.1:5602/mira_test")


class FakeCursor:
    def __init__(self, rows):
        self.rows, self.executed = rows, []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, rows):
        self.cur, self.rolled_back, self.committed, self.closed = (
            FakeCursor(rows),
            False,
            False,
            False,
        )

    def cursor(self, row_factory=None):
        return self.cur

    def rollback(self):
        self.rolled_back = True

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


ROWS = [
    {
        "tenant_id": TENANT,
        "notebook_id": "nb1",
        "doc_id": "d1",
        "match_state": "user_confirmed",
        "chunks": 12,
        "any_verified": False,
    },
    {
        "tenant_id": TENANT,
        "notebook_id": "nb1",
        "doc_id": "d2",
        "match_state": "verified",
        "chunks": 3,
        "any_verified": True,
    },
    {
        "tenant_id": TENANT,
        "notebook_id": "nb2",
        "doc_id": "d3",
        "match_state": "user_confirmed",
        "chunks": 0,
        "any_verified": False,
    },
]


def test_run_preflight_is_read_only_and_reports_admission_paths():
    conn = FakeConn(ROWS)
    report = pre.run_preflight(TENANT, conn)
    # READ ONLY transaction, one SELECT, then rollback — never commit.
    executed = [s for s, _ in conn.cur.executed]
    assert executed[0].upper().startswith("SET TRANSACTION READ ONLY")
    assert sum(1 for s in executed if s.lstrip().upper().startswith("SELECT")) == 1
    assert conn.rolled_back and not conn.committed
    assert report["tenant_id"] == TENANT
    assert report["read_only"] is True
    paths = {r["doc_id"]: r["admission_path"] for r in report["sources"]}
    assert paths == {
        "d1": "admitted_via_confirmation",
        "d2": "verified_mark_present",
        "d3": "no_chunks",
    }
    assert report["summary"] == {
        "confirmed_sources": 3,
        "admitted_via_confirmation": 1,
        "verified_mark_present": 1,
        "no_chunks": 1,
    }
    assert report["conclusion"] == "no_rewrite_required"
    assert report["mutations_performed"] == 0


def test_run_preflight_never_widens_beyond_the_tenant():
    conn = FakeConn([])
    pre.run_preflight(TENANT, conn)
    select = next((s, p) for s, p in conn.cur.executed if s.lstrip().upper().startswith("SELECT"))
    assert select[1] == (TENANT,)


def test_main_refuses_prod_url_and_writes_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("PREFLIGHT_DATABASE_URL", "postgres://u:p@ep-prod-1.neon.tech/neondb")
    out = tmp_path / "r.json"
    rc = pre.main(["--tenant-id", TENANT, "--json-out", str(out)])
    assert rc == 2 and not out.exists()
    assert "REFUSED" in capsys.readouterr().out


def test_main_writes_report_via_injected_connection(monkeypatch, tmp_path):
    monkeypatch.setenv(
        "PREFLIGHT_DATABASE_URL", "postgres://postgres:testpw@127.0.0.1:5602/mira_test"
    )
    conn = FakeConn(ROWS)
    monkeypatch.setattr(pre, "_connect", lambda url: conn)
    out = tmp_path / "r.json"
    rc = pre.main(["--tenant-id", TENANT, "--json-out", str(out)])
    assert rc == 0 and conn.closed
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["conclusion"] == "no_rewrite_required" and "p@" not in json.dumps(data)
