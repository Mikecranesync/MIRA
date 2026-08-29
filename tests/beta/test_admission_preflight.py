"""PRD §7.3 — tenant-scoped, READ-ONLY historical repair/preflight report.

The tool never mutates anything and never connects to a remote or shared
database: executable access is loopback-only (no override), the session is a
READ ONLY transaction with exactly one SELECT bound to one tenant, and the
report computes the REAL current admission per confirmed source under the
Workstream A rule — globally verified chunks are admissible; confirmed
tenant-private chunks are admissible via confirmation; confirmed shared/OEM
chunks with verified=false are EXCLUDED; zero chunks are excluded — plus
before/after snapshots with zero delta and the §7.3 conclusion.
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


def _load_tool():
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


@pytest.mark.parametrize(
    "url",
    [
        # the documented production Neon pooler host carries no 'prod'/'prd' marker
        "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb",
        # any opaque remote host is unknown → refused
        "postgres://u:p@ep-abc-123.us-east-2.aws.neon.tech/neondb",
        "postgres://u:p@ep-staging-1.neon.tech/neondb",
        "postgres://u:p@db.internal:5432/mira",
    ],
)
def test_remote_hosts_are_always_refused(url, monkeypatch):
    # FAIL-CLOSED and NOT overridable: executable access is loopback-only.
    # There is no environment variable or flag that unlocks a remote host —
    # that would recreate the arbitrary-remote escape hatch.
    monkeypatch.setenv("PREFLIGHT_ALLOWED_HOST", "ep-staging-1.neon.tech")  # must be ignored
    with pytest.raises(pre.PreflightRefused):
        pre.assert_safe_target(url)


def test_loopback_disposable_targets_are_allowed():
    pre.assert_safe_target("postgres://postgres:testpw@127.0.0.1:5602/mira_test")
    pre.assert_safe_target("postgres://postgres:testpw@localhost/mira_test")
    pre.assert_safe_target("postgres://postgres:testpw@[::1]/mira_test")


def test_connect_itself_refuses_remote_hosts_before_any_driver_call(monkeypatch):
    # Defense in depth: even a caller that bypasses main() cannot reach a remote
    # database — the gate is enforced INSIDE the connect path, before psycopg
    # is even imported.
    import builtins

    real_import = builtins.__import__

    def no_psycopg(name, *a, **kw):
        if name == "psycopg":
            raise AssertionError("psycopg imported for a remote host")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_psycopg)
    with pytest.raises(pre.PreflightRefused):
        pre._connect("postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb")
    with pytest.raises(pre.PreflightRefused):
        pre._connect("postgres://u:p@ep-abc-123.us-east-2.aws.neon.tech/neondb")


def test_no_host_override_exists_in_the_tool():
    src = _TOOL.read_text(encoding="utf-8")
    assert "PREFLIGHT_ALLOWED_HOST" not in src
    assert "allow-host" not in src and "allowed_host" not in src


def test_print_sql_emits_the_select_for_db_inspect_without_connecting(monkeypatch, capsys):
    # --print-sql only PREPARES the statement: db-inspect.yml is static and takes
    # no arbitrary SQL, so the output must be added there as a reviewed step.
    # The tool never connects itself.
    monkeypatch.setenv(
        "PREFLIGHT_DATABASE_URL",
        "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb",
    )
    monkeypatch.setattr(
        pre, "_connect", lambda url: (_ for _ in ()).throw(AssertionError("connected!"))
    )
    rc = pre.main(["--tenant-id", TENANT, "--print-sql"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "SELECT" in out and "s.tenant_id = " in out and TENANT in out
    assert "READ ONLY" in out
    assert "PREPARED SQL" in out and "reviewed probe step" in out
    assert not re.search(r"\b(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b", out, re.I)


def test_main_refuses_opaque_remote_host_and_writes_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv(
        "PREFLIGHT_DATABASE_URL",
        "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb",
    )
    out = tmp_path / "r.json"
    rc = pre.main(["--tenant-id", TENANT, "--json-out", str(out)])
    assert rc == 2 and not out.exists()
    assert "REFUSED" in capsys.readouterr().out


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


def _row(doc, *, state="user_confirmed", total, private, verified, admissible, notebook="nb1"):
    # Shape of ONE aggregated SELECT row: relationship state + per-source chunk
    # counts (total / is_private / verified / admissible), computed in SQL.
    return {
        "tenant_id": TENANT,
        "notebook_id": notebook,
        "doc_id": doc,
        "match_state": state,
        "enabled_by_default": True,
        "chunks_total": total,
        "chunks_private": private,
        "chunks_verified": verified,
        "chunks_admissible": admissible,
    }


ROWS = [
    # confirmed tenant-private, verified=false → admitted via confirmation (Workstream A)
    _row("d1", total=12, private=12, verified=0, admissible=12),
    # globally verified chunks → admitted regardless of privacy
    _row("d2", state="verified", total=3, private=0, verified=3, admissible=3),
    # zero chunks → excluded
    _row("d3", total=0, private=0, verified=0, admissible=0, notebook="nb2"),
    # shared/OEM (is_private=false) with verified=false → EXCLUDED even though confirmed
    _row("d4", total=5, private=0, verified=0, admissible=0, notebook="nb2"),
]


def test_query_aggregates_privacy_and_verification_per_source():
    sql, _ = pre.build_query(TENANT)
    low = sql.lower()
    assert "count(k.id)" in low and "count(k.*)" not in low
    assert low.count("count(k.id)") == 4
    assert "is_private" in low and "verified" in low
    # admissible = globally verified OR tenant-private (confirmation admits it)
    assert "filter (where k.verified or k.is_private)" in low.replace("  ", " ")
    assert "enabled_by_default" in low


def test_run_preflight_computes_the_real_current_admission_result():
    conn = FakeConn(ROWS)
    report = pre.run_preflight(TENANT, conn)
    # READ ONLY transaction, one SELECT, then rollback — never commit.
    executed = [s for s, _ in conn.cur.executed]
    assert executed[0].upper().startswith("SET TRANSACTION READ ONLY")
    assert sum(1 for s in executed if s.lstrip().upper().startswith("SELECT")) == 1
    assert conn.rolled_back and not conn.committed
    assert report["tenant_id"] == TENANT and report["read_only"] is True
    by = {r["doc_id"]: r for r in report["sources"]}
    assert by["d1"]["current_admission_result"] == "admitted"
    assert by["d1"]["admission_path"] == "admitted_via_confirmation"
    assert by["d2"]["current_admission_result"] == "admitted"
    assert by["d2"]["admission_path"] == "verified_mark_present"
    assert by["d3"]["current_admission_result"] == "excluded"
    assert by["d3"]["admission_path"] == "no_chunks"
    assert by["d4"]["current_admission_result"] == "excluded"
    assert by["d4"]["admission_path"] == "excluded_shared_unverified"
    for r in report["sources"]:
        assert {
            "match_state",
            "enabled_by_default",
            "chunks_total",
            "chunks_private",
            "chunks_verified",
            "chunks_admissible",
        } <= set(r)
    assert report["summary"] == {
        "confirmed_sources": 4,
        "admitted": 2,
        "excluded": 2,
        "admitted_via_confirmation": 1,
        "verified_mark_present": 1,
        "excluded_shared_unverified": 1,
        "no_chunks": 1,
        "chunks_total": 20,
        "chunks_private": 12,
        "chunks_verified": 3,
        "chunks_admissible": 15,
    }
    assert report["conclusion"] == "no_rewrite_required"
    assert report["mutations_performed"] == 0


def test_before_and_after_snapshots_are_identical_with_zero_delta():
    # PRD §7.3: counts before AND after. This tool performs no rewrite, so the
    # two snapshots must be the same rows and the delta must be exactly zero.
    report = pre.run_preflight(TENANT, FakeConn(ROWS))
    assert report["before"] == report["after"]
    assert report["before"]["summary"] == report["summary"]
    assert report["delta"] == {k: 0 for k in report["summary"]}
    assert report["mutations_performed"] == 0


def _substantive(report):
    return {k: v for k, v in report.items() if k != "generated_at"}


def test_two_runs_over_the_same_rows_are_idempotent_ignoring_generated_at():
    a = pre.run_preflight(TENANT, FakeConn(ROWS))
    b = pre.run_preflight(TENANT, FakeConn(list(reversed(ROWS))))
    assert _substantive(a) == _substantive(b)


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
