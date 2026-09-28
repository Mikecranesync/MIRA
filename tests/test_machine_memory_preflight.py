"""Workstream C (PRD §9.3) — the read-only Machine Memory preflight.

Offline: the DB is a fake `query(sql, params)` callable; no network, no
secrets. Pins: every reason code, the physical/simulated/stale/unknown
classification, the GO/NO-GO verdict, the prod-URL refusal, that only SELECT
statements are ever issued, and that no secret can reach the output.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import machine_memory_preflight as pf  # noqa: E402

NOW = datetime(2026, 8, 30, 12, 0, 0, tzinfo=timezone.utc)
CV101 = "enterprise.home_garage.conveyor_lab.conveyor_1"


class FakeDB:
    """Answers the preflight's SELECTs from canned rows; records every SQL."""

    def __init__(self, rows: dict[str, list[dict]] | None = None, missing: set[str] | None = None):
        self.rows = rows or {}
        self.missing = missing or set()
        self.sql: list[str] = []

    def __call__(self, sql: str, params: tuple = ()) -> list[dict]:
        self.sql.append(sql)
        low = sql.lower()
        for table in self.missing:
            if f"from {table}" in low:
                raise pf.RelationMissing(table)
        for key, rows in self.rows.items():
            if key in low:
                return rows
        return []


def _env(**over):
    env = {
        "MIRA_RUN_DIFF_ENABLED": "1",
        "MIRA_MACHINE_MEMORY_UNS_PATHS": CV101,
        "MIRA_RUN_TRIGGERS": f"{CV101}=Conveyor/fault_alarm:0.5",
        "MIRA_TENANT_ID": "78917b56-0000-4000-8000-000000000001",
    }
    env.update(over)
    return env


def _healthy_db(**over) -> FakeDB:
    rows = {
        "max(ingested_at)": [{"latest": NOW - timedelta(seconds=20)}],
        "from machine_state_window": [
            {
                "window_id": "w-1",
                "state": "faulted",
                "started_at": NOW - timedelta(hours=2),
                "ended_at": NOW - timedelta(hours=2, minutes=-1),
                "derived_at": NOW - timedelta(minutes=3),
            }
        ],
        "count(*)": [{"n": 41, "simulated": 0, "bad_quality": 0, "sources": ["ignition"]}],
    }
    rows.update(over)
    return FakeDB(rows)


def test_go_when_everything_is_healthy_and_physical():
    db = _healthy_db()
    report = pf.run_preflight(_env(), db, now=NOW, cv101_uns_path=CV101)
    assert report["verdict"] == "GO", report
    assert report["reasons"] == []
    facts = report["facts"]
    assert facts["run_diff_enabled"] is True
    assert facts["cv101_configured"] is True
    assert facts["fault_triggers_configured"] is True
    assert facts["ingest"]["age_s"] == 20
    assert facts["historian"]["age_s"] == 180
    assert facts["fault_window"]["row_count"] == 41
    assert facts["fault_window"]["classification"] == "physical"
    # SELECT-only, always
    assert all(s.lstrip().lower().startswith("select") for s in db.sql)
    assert not any(
        re.search(r"\b(insert|update|delete|drop|alter|truncate)\b", s, re.I) for s in db.sql
    )


def test_run_diff_disabled_is_no_go_with_stable_code():
    report = pf.run_preflight(
        _env(MIRA_RUN_DIFF_ENABLED="0"), _healthy_db(), now=NOW, cv101_uns_path=CV101
    )
    assert report["verdict"] == "NO-GO"
    assert "RUN_DIFF_DISABLED" in report["reasons"]


def test_cv101_missing_from_configured_paths_and_no_triggers():
    report = pf.run_preflight(
        _env(MIRA_MACHINE_MEMORY_UNS_PATHS="enterprise.other.line", MIRA_RUN_TRIGGERS=""),
        _healthy_db(),
        now=NOW,
        cv101_uns_path=CV101,
    )
    assert {"CV101_NOT_CONFIGURED", "NO_FAULT_TRIGGERS"} <= set(report["reasons"])


def test_stale_ingest_and_stale_historian_are_separate_codes():
    db = _healthy_db(**{"max(ingested_at)": [{"latest": NOW - timedelta(minutes=30)}]})
    db.rows["from machine_state_window"][0]["derived_at"] = NOW - timedelta(hours=3)
    report = pf.run_preflight(_env(), db, now=NOW, cv101_uns_path=CV101)
    assert "INGEST_STALE" in report["reasons"]
    assert "HISTORIAN_STALE" in report["reasons"]
    assert report["facts"]["ingest"]["age_s"] == 1800


def test_no_ingest_ever_is_ingest_none_not_stale():
    report = pf.run_preflight(
        _env(),
        _healthy_db(**{"max(ingested_at)": [{"latest": None}]}),
        now=NOW,
        cv101_uns_path=CV101,
    )
    assert "INGEST_NONE" in report["reasons"]
    assert "INGEST_STALE" not in report["reasons"]


def test_missing_tables_are_reported_as_unavailable_never_as_empty():
    db = FakeDB(missing={"tag_events", "machine_state_window"})
    report = pf.run_preflight(_env(), db, now=NOW, cv101_uns_path=CV101)
    assert "TABLES_UNAVAILABLE" in report["reasons"]
    assert "FAULT_WINDOW_EMPTY" not in report["reasons"]
    assert report["facts"]["fault_window"]["classification"] == "unknown"
    assert report["verdict"] == "NO-GO"


def test_no_fault_window_vs_empty_fault_window():
    none = pf.run_preflight(
        _env(), _healthy_db(**{"from machine_state_window": []}), now=NOW, cv101_uns_path=CV101
    )
    assert "NO_FAULT_WINDOW" in none["reasons"]
    empty = pf.run_preflight(
        _env(),
        _healthy_db(**{"count(*)": [{"n": 0, "simulated": 0, "bad_quality": 0, "sources": []}]}),
        now=NOW,
        cv101_uns_path=CV101,
    )
    assert "FAULT_WINDOW_EMPTY" in empty["reasons"]
    assert "NO_FAULT_WINDOW" not in empty["reasons"]


def test_simulated_and_stale_quality_classification():
    sim = pf.run_preflight(
        _env(),
        _healthy_db(
            **{"count(*)": [{"n": 9, "simulated": 9, "bad_quality": 0, "sources": ["simulator"]}]}
        ),
        now=NOW,
        cv101_uns_path=CV101,
    )
    assert sim["facts"]["fault_window"]["classification"] == "simulated"
    assert "ROWS_SIMULATED" in sim["reasons"]
    stale = pf.run_preflight(
        _env(),
        _healthy_db(
            **{"count(*)": [{"n": 9, "simulated": 0, "bad_quality": 9, "sources": ["plc_bridge"]}]}
        ),
        now=NOW,
        cv101_uns_path=CV101,
    )
    assert stale["facts"]["fault_window"]["classification"] == "stale"
    assert "ROWS_STALE_QUALITY" in stale["reasons"]


def test_reason_codes_are_stable_and_documented():
    assert set(pf.REASON_CODES) >= {
        "RUN_DIFF_DISABLED",
        "CV101_NOT_CONFIGURED",
        "NO_FAULT_TRIGGERS",
        "INGEST_NONE",
        "INGEST_STALE",
        "HISTORIAN_NONE",
        "HISTORIAN_STALE",
        "TABLES_UNAVAILABLE",
        "NO_FAULT_WINDOW",
        "FAULT_WINDOW_EMPTY",
        "ROWS_SIMULATED",
        "ROWS_STALE_QUALITY",
        "DB_NOT_CONFIGURED",
        "DB_CONNECT_FAILED",
        "TENANT_REQUIRED",
    }


def test_production_refusal_is_an_allowlist_not_a_hostname_denylist():
    # Real Neon hosts carry no "prod" marker — the review found a substring
    # denylist refused only fabricated names. The gate is fail-CLOSED: only
    # loopback or an operator-named dev/staging host may be read.
    prod_shape = "postgres://u:p@ep-lively-bread-a1b2c3d4-pooler.us-east-2.aws.neon.tech/neondb"
    staging_shape = "postgres://u:p@ep-polished-hall-ahcqtcxe-pooler.us-east-2.aws.neon.tech/neondb"
    with pytest.raises(pf.ProductionRefused):
        pf.assert_not_production(prod_shape, {})
    with pytest.raises(pf.ProductionRefused):
        pf.assert_not_production(staging_shape, {})  # not named → refused
    pf.assert_not_production(
        staging_shape,
        {
            "MACHINE_MEMORY_PREFLIGHT_ALLOWED_HOSTS": "ep-polished-hall-ahcqtcxe-pooler.us-east-2.aws.neon.tech"
        },
    )
    pf.assert_not_production(
        staging_shape, {}, ["ep-polished-hall-ahcqtcxe-pooler.us-east-2.aws.neon.tech"]
    )
    pf.assert_not_production("postgres://postgres:testpw@127.0.0.1:5602/mira_test", {})
    pf.assert_not_production("postgres://postgres:testpw@localhost/mira_test", {})


def test_a_production_doppler_shell_is_refused_even_for_an_allowlisted_host():
    url = "postgres://postgres:testpw@127.0.0.1:5602/mira_test"
    for key in ("DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT", "MIRA_ENV"):
        for value in ("prd", "prod", "production"):
            with pytest.raises(pf.ProductionRefused):
                pf.assert_not_production(url, {key: value})
    pf.assert_not_production(url, {"DOPPLER_CONFIG": "stg"})


def test_main_refuses_before_connecting(capsys):
    rc = pf.main(
        ["--db-url", "postgres://u:p@ep-lively-bread-a1b2c3d4.us-east-2.aws.neon.tech/neondb"],
        env=_env(),
        db=None,
    )
    err = capsys.readouterr().err
    assert rc == 2 and "REFUSED" in err and "ep-lively-bread" not in err


def test_tenant_is_required_for_any_db_read():
    db = _healthy_db()
    report = pf.run_preflight(_env(MIRA_TENANT_ID=""), db, now=NOW, cv101_uns_path=CV101)
    assert report["verdict"] == "NO-GO"
    assert report["reasons"][0] == "TENANT_REQUIRED"
    assert db.sql == []  # no query was issued without a tenant


def test_connect_failure_is_a_reason_code_without_host_or_user(monkeypatch, capsys):
    def boom(_url):
        raise RuntimeError('connection to server at "ep-secret-host" user "alice" failed')

    monkeypatch.setattr(pf, "_psycopg_query", boom)
    rc = pf.main(
        [
            "--json",
            "--db-url",
            "postgres://alice:pw@127.0.0.1:5602/mira_test",
            "--now",
            NOW.isoformat(),
        ],
        env=_env(),
    )
    out, err = capsys.readouterr()
    assert rc == 1
    assert json.loads(out)["reasons"][0] == "DB_CONNECT_FAILED"
    assert "ep-secret-host" not in out + err and "alice" not in out + err


def test_output_never_contains_the_database_url_or_password(capsys):
    url = "postgres://user:hunter2@ep-staging-1.neon.tech/neondb"
    rc = pf.main(
        ["--json", "--now", NOW.isoformat()], env=_env(NEON_DATABASE_URL=url), db=_healthy_db()
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "hunter2" not in out and url not in out
    assert json.loads(out)["verdict"] == "GO"


def test_no_db_is_a_no_go_not_a_crash():
    report = pf.run_preflight(_env(), None, now=NOW, cv101_uns_path=CV101)
    assert report["verdict"] == "NO-GO"
    assert "DB_NOT_CONFIGURED" in report["reasons"]


def test_print_command_prepares_the_production_invocation_without_running_it(capsys):
    rc = pf.main(["--print-command"], env={}, db=None)
    out = capsys.readouterr().out
    assert rc == 0
    assert "doppler run" in out and "factorylm" in out and "prd" in out
    assert "machine_memory_preflight.py" in out
    assert "Mike" in out
