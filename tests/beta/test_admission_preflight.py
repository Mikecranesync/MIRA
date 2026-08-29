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
    assert "s.tenant_id = $1::uuid" in sql  # asyncpg positional parameter
    assert "%s" not in sql
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
    # database — the gate is enforced INSIDE the connect path, before asyncpg
    # (Apache-2.0; the only driver this tool may use) is even imported.
    import builtins

    real_import = builtins.__import__

    def no_driver(name, *a, **kw):
        if name in ("asyncpg", "psycopg", "psycopg2"):
            raise AssertionError(f"{name} imported for a remote host")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", no_driver)
    with pytest.raises(pre.PreflightRefused):
        _run(
            pre._connect(
                "postgres://u:p@ep-purple-hall-ahimeyn0-pooler.us-east-2.aws.neon.tech/neondb"
            )
        )
    with pytest.raises(pre.PreflightRefused):
        _run(pre._connect("postgres://u:p@ep-abc-123.us-east-2.aws.neon.tech/neondb"))


def test_only_apache_or_mit_driver_is_referenced():
    src = _TOOL.read_text(encoding="utf-8")
    assert "psycopg" not in src, "LGPL driver must not be referenced (PRD §4: Apache-2.0/MIT only)"
    assert "import asyncpg" in src


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


class FakeTransaction:
    """asyncpg.Transaction shape: explicit start / rollback / commit."""

    def __init__(self, readonly: bool):
        self.readonly, self.started, self.rolled_back, self.committed = (
            readonly,
            False,
            False,
            False,
        )

    async def start(self):
        self.started = True

    async def rollback(self):
        self.rolled_back = True

    async def commit(self):
        self.committed = True


class FakeConn:
    """asyncpg.Connection shape the tool relies on: transaction(readonly=…),
    fetch(sql, *args) → mapping records, close()."""

    def __init__(self, rows):
        self.rows, self.fetches, self.transactions, self.closed = rows, [], [], False

    def transaction(self, *, readonly: bool = False, **_):
        tr = FakeTransaction(readonly)
        self.transactions.append(tr)
        return tr

    async def fetch(self, sql, *args):
        self.fetches.append((sql, args))
        return [dict(r) for r in self.rows]

    async def close(self):
        self.closed = True


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def run_preflight(tenant_id, conn):
    return _run(pre.run_preflight(tenant_id, conn))


def _row(
    doc,
    *,
    state="user_confirmed",
    total,
    v2=None,
    v2_private,
    v2_verified,
    admissible,
    notebook="nb1",
):
    # Shape of ONE aggregated SELECT row. `chunks_total` / `chunks_v2` are the
    # total / eligible split; the DECISION counts (`chunks_v2_private`,
    # `chunks_v2_verified`, `chunks_admissible`) are scoped to ingest_route='v2'
    # — the only route manual-rag.ts reads — so a legacy chunk can never decide.
    return {
        "tenant_id": TENANT,
        "notebook_id": notebook,
        "doc_id": doc,
        "match_state": state,
        "enabled_by_default": True,
        "chunks_total": total,
        "chunks_v2": total if v2 is None else v2,
        "chunks_v2_private": v2_private,
        "chunks_v2_verified": v2_verified,
        "chunks_admissible": admissible,
    }


ROWS = [
    # confirmed tenant-private, verified=false → admitted via confirmation (Workstream A)
    _row("d1", total=12, v2_private=12, v2_verified=0, admissible=12),
    # globally verified chunks → admitted regardless of privacy
    _row("d2", state="verified", total=3, v2_private=0, v2_verified=3, admissible=3),
    # zero chunks → excluded
    _row("d3", total=0, v2_private=0, v2_verified=0, admissible=0, notebook="nb2"),
    # shared/OEM (is_private=false) with verified=false → EXCLUDED even though confirmed
    _row("d4", total=5, v2_private=0, v2_verified=0, admissible=0, notebook="nb2"),
    # LEGACY-ROUTE ONLY: 4 private chunks, none ingest_route='v2' → excluded
    _row("d5", total=4, v2=0, v2_private=0, v2_verified=0, admissible=0, notebook="nb3"),
    # MIXED: 2 legacy + 4 v2 private → admitted on the v2 subset only
    _row("d6", total=6, v2=4, v2_private=4, v2_verified=0, admissible=4, notebook="nb3"),
    # MIXED with a LEGACY VERIFIED chunk + 2 v2 private: the legacy verified mark
    # must NOT decide → admitted_via_confirmation, not verified_mark_present
    _row("d7", total=3, v2=2, v2_private=2, v2_verified=0, admissible=2, notebook="nb3"),
]
# Expected summary, derived from the fixture rows above (not from observed output):
#   admitted d1 d2 d6 d7 | excluded d3 d4 d5
#   totals: 12+3+0+5+4+6+3 = 33 ; v2: 12+3+0+5+0+4+2 = 26
#   v2_private: 12+0+0+0+0+4+2 = 18 ; v2_verified: 3 ; admissible: 12+3+4+2 = 21
EXPECTED_SUMMARY = {
    "confirmed_sources": 7,
    "admitted": 4,
    "excluded": 3,
    "admitted_via_confirmation": 3,
    "verified_mark_present": 1,
    "excluded_shared_unverified": 1,
    "excluded_legacy_route_only": 1,
    "no_chunks": 1,
    "chunks_total": 33,
    "chunks_v2": 26,
    "chunks_v2_private": 18,
    "chunks_v2_verified": 3,
    "chunks_admissible": 21,
}


def test_query_aggregates_privacy_verification_and_route_per_source():
    sql, _ = pre.build_query(TENANT)
    low = " ".join(sql.lower().split())
    assert "count(k.id)" in low and "count(k.*)" not in low
    assert low.count("count(k.id)") == 5
    assert "is_private" in low and "verified" in low
    # v2-eligible count reported separately from total
    assert "filter (where k.ingest_route = 'v2')" in low
    # decision counts are v2-scoped: private / verified / admissible
    assert "filter (where k.ingest_route = 'v2' and k.is_private)" in low
    assert "filter (where k.ingest_route = 'v2' and k.verified)" in low
    assert "filter (where k.ingest_route = 'v2' and (k.verified or k.is_private))" in low
    # no route-agnostic private/verified counts remain
    assert "filter (where k.is_private)" not in low and "filter (where k.verified)" not in low
    assert "enabled_by_default" in low


def test_legacy_only_and_mixed_route_sources():
    by = {r["doc_id"]: r for r in run_preflight(TENANT, FakeConn(ROWS))["sources"]}
    assert by["d5"]["current_admission_result"] == "excluded"
    assert by["d5"]["admission_path"] == "excluded_legacy_route_only"
    assert by["d5"]["chunks_total"] == 4 and by["d5"]["chunks_v2"] == 0
    assert by["d6"]["current_admission_result"] == "admitted"
    assert by["d6"]["admission_path"] == "admitted_via_confirmation"
    assert by["d6"]["chunks_total"] == 6 and by["d6"]["chunks_v2"] == 4
    assert by["d6"]["chunks_admissible"] == 4
    # a legacy verified chunk must not relabel a source whose retrievable chunks are private
    assert by["d7"]["current_admission_result"] == "admitted"
    assert by["d7"]["admission_path"] == "admitted_via_confirmation"
    assert by["d7"]["chunks_v2_verified"] == 0


def test_run_preflight_computes_the_real_current_admission_result():
    conn = FakeConn(ROWS)
    report = run_preflight(TENANT, conn)
    # ONE explicit read-only transaction, ONE fetch, then ROLLBACK — never commit.
    assert len(conn.transactions) == 1
    tr = conn.transactions[0]
    assert tr.readonly is True and tr.started and tr.rolled_back and not tr.committed
    assert len(conn.fetches) == 1
    assert conn.fetches[0][0].lstrip().upper().startswith("SELECT")
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
            "chunks_v2",
            "chunks_v2_private",
            "chunks_v2_verified",
            "chunks_admissible",
        } <= set(r)
    assert report["summary"] == EXPECTED_SUMMARY
    assert report["conclusion"] == "no_rewrite_required"
    assert report["mutations_performed"] == 0


def test_before_and_after_snapshots_are_identical_with_zero_delta():
    # PRD §7.3: counts before AND after. This tool performs no rewrite, so the
    # two snapshots must be the same rows and the delta must be exactly zero.
    report = run_preflight(TENANT, FakeConn(ROWS))
    assert report["before"] == report["after"]
    assert report["before"]["summary"] == report["summary"]
    assert report["delta"] == {k: 0 for k in report["summary"]}
    assert report["mutations_performed"] == 0


def _substantive(report):
    return {k: v for k, v in report.items() if k != "generated_at"}


def test_two_runs_over_the_same_rows_are_idempotent_ignoring_generated_at():
    a = run_preflight(TENANT, FakeConn(ROWS))
    b = run_preflight(TENANT, FakeConn(list(reversed(ROWS))))
    assert _substantive(a) == _substantive(b)


def test_run_preflight_never_widens_beyond_the_tenant():
    conn = FakeConn([])
    run_preflight(TENANT, conn)
    sql, args = conn.fetches[0]
    assert args == (TENANT,) and "$1::uuid" in sql


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

    async def fake_connect(url):
        return conn

    monkeypatch.setattr(pre, "_connect", fake_connect)
    out = tmp_path / "r.json"
    rc = pre.main(["--tenant-id", TENANT, "--json-out", str(out)])
    assert rc == 0 and conn.closed
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["conclusion"] == "no_rewrite_required" and "p@" not in json.dumps(data)
