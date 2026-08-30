"""Historian execution heartbeat contract (issue #3485)."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tasks"))
import historize_runs  # noqa: E402


TENANT = "11111111-1111-1111-1111-111111111111"
SHA = "a" * 40


def _env(**overrides: str) -> dict[str, str]:
    env = {
        "MIRA_TENANT_ID": TENANT,
        "NEON_DATABASE_URL": "postgresql://not-used-in-this-test",
        "MIRA_DEPLOYMENT_ENVIRONMENT": "staging",
        "MIRA_GIT_SHA": SHA,
        "MIRA_RUN_DIFF_ENABLED": "1",
        "MIRA_RUN_TRIGGERS": "demo/cell1/conveyor/cv101=vfd_freq:0.1",
        "MIRA_MACHINE_MEMORY_UNS_PATHS": "demo/cell1/conveyor/cv101",
        "TAG_DIFF_CONFIG_JSON": json.dumps(
            {"fault_trigger_tags": ["default_conveyor_fault_alarm"]}
        ),
    }
    env.update(overrides)
    return env


def test_heartbeat_context_canonicalizes_only_permitted_evidence():
    """Whitespace/order cannot alter the stored configuration fingerprint."""
    first = historize_runs.build_heartbeat_context(_env())
    second = historize_runs.build_heartbeat_context(
        _env(
            MIRA_RUN_TRIGGERS=" demo/cell1/conveyor/cv101 = vfd_freq : 0.1 ",
            MIRA_MACHINE_MEMORY_UNS_PATHS=" demo/cell1/conveyor/cv101 ",
            TAG_DIFF_CONFIG_JSON=' { "fault_trigger_tags" : [ "default_conveyor_fault_alarm" ] } ',
        )
    )

    assert first.detail == second.detail
    assert first.detail["run_diff_enabled"] is True
    assert first.detail["machine_memory_path_hashes"] == [
        hashlib.sha256(b"demo.cell1.conveyor.cv101").hexdigest()
    ]
    assert first.detail["fault_trigger_tag_hashes"] == [
        hashlib.sha256(b"default_conveyor_fault_alarm").hexdigest()
    ]
    assert "demo/cell1/conveyor/cv101" not in json.dumps(first.detail)
    assert "default_conveyor_fault_alarm" not in json.dumps(first.detail)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("MIRA_DEPLOYMENT_ENVIRONMENT", "qa"),
        ("MIRA_DEPLOYMENT_ENVIRONMENT", ""),
        ("MIRA_GIT_SHA", "unknown"),
        ("MIRA_GIT_SHA", "a" * 39),
    ],
)
def test_heartbeat_context_rejects_invalid_deployment_identity(name, value):
    with pytest.raises(ValueError, match="heartbeat_identity_invalid"):
        historize_runs.build_heartbeat_context(_env(**{name: value}))


def test_heartbeat_context_requires_normalized_fault_trigger_tag():
    with pytest.raises(ValueError, match="fault_trigger_tags_invalid"):
        historize_runs.build_heartbeat_context(
            _env(TAG_DIFF_CONFIG_JSON='{"fault_trigger_tags":["other_alarm"]}')
        )


class _RecordingConnection:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))


class _Transaction:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *_):
        return False


class _RecordingEngine:
    def __init__(self):
        self.conn = _RecordingConnection()

    def begin(self):
        return _Transaction(self.conn)


def test_heartbeat_store_commits_start_and_terminal_updates_separately():
    engine = _RecordingEngine()
    context = historize_runs.build_heartbeat_context(_env())
    store = historize_runs.HistorianHeartbeatStore(engine=engine, tenant_id=TENANT)

    store.start(context)
    store.finish(context, status="ok")

    statements = [statement for statement, _ in engine.conn.calls]
    assert sum("SET LOCAL app.current_tenant_id" in statement for statement in statements) == 2
    assert "INSERT INTO historian_task_heartbeat" in statements[1]
    assert "run_count = historian_task_heartbeat.run_count + 1" in statements[1]
    assert "UPDATE historian_task_heartbeat" in statements[3]
    assert "run_count" not in statements[3]
    all_params = [params for _, params in engine.conn.calls]
    assert all("exception" not in params and "url" not in params for params in all_params)


def test_heartbeat_migration_locks_identity_rls_and_no_delete_privilege():
    migration = (
        Path(__file__).resolve().parents[2]
        / "mira-hub"
        / "db"
        / "migrations"
        / "086_historian_task_heartbeat.sql"
    ).read_text(encoding="utf-8")

    assert "-- Issue: #3485" in migration
    assert "PRIMARY KEY (tenant_id, deployment_environment, task_name)" in migration
    assert "CHECK (deployment_environment IN ('development', 'staging', 'production'))" in migration
    assert "CHECK (status IN ('running', 'ok', 'error', 'disabled', 'no_triggers', 'missing_config'))" in migration
    assert "NULLIF(current_setting('app.tenant_id', true), '')::UUID" in migration
    assert "NULLIF(current_setting('app.current_tenant_id', true), '')::UUID" in migration
    assert "GRANT SELECT, INSERT, UPDATE ON historian_task_heartbeat TO factorylm_app" in migration
    assert "REVOKE DELETE ON historian_task_heartbeat FROM factorylm_app" in migration


def test_migration_order_checker_rejects_heartbeat_before_historian_foundation(tmp_path):
    """The dependency rule remains testable without touching real migrations."""
    (tmp_path / "086_historian_task_heartbeat.sql").write_text("-- Issue: #3485\n")
    (tmp_path / "999_historian_cursor.sql").write_text("-- foundation\n")
    checker = Path(__file__).resolve().parents[2] / "mira-hub" / "db" / "check-migration-order.mjs"
    env = {**os.environ, "MIRA_MIGRATIONS_DIR": str(tmp_path)}

    result = subprocess.run(
        ["node", str(checker)], env=env, text=True, capture_output=True, check=False
    )

    assert result.returncode == 1
    assert "Order violation" in result.stderr


class _TaskHeartbeatStore:
    def __init__(self, *_args, **_kwargs):
        self.events = []

    def start(self, context):
        self.events.append(("start", context))

    def finish(self, context, *, status):
        self.events.append((status, context))


def _configure_task_env(monkeypatch, **overrides):
    for key in _env():
        monkeypatch.delenv(key, raising=False)
    for key, value in _env(**overrides).items():
        monkeypatch.setenv(key, value)


@pytest.mark.parametrize(
    ("overrides", "expected_status"),
    [
        ({"MIRA_RUN_DIFF_ENABLED": "0"}, "disabled"),
        ({"MIRA_RUN_TRIGGERS": "", "MIRA_MACHINE_MEMORY_UNS_PATHS": ""}, "no_triggers"),
    ],
)
def test_task_records_short_circuit_terminal_statuses(monkeypatch, overrides, expected_status):
    _configure_task_env(monkeypatch, **overrides)
    heartbeat = _TaskHeartbeatStore()
    monkeypatch.setattr(historize_runs, "_engine", lambda _url: object())
    monkeypatch.setattr(historize_runs, "HistorianHeartbeatStore", lambda **_kwargs: heartbeat)

    result = historize_runs.historize_runs()

    assert result["status"] == expected_status
    assert [event[0] for event in heartbeat.events] == ["start", expected_status]


def test_task_records_stable_error_code_without_exception_text(monkeypatch):
    _configure_task_env(monkeypatch)
    heartbeat = _TaskHeartbeatStore()
    monkeypatch.setattr(historize_runs, "_engine", lambda _url: object())
    monkeypatch.setattr(historize_runs, "HistorianHeartbeatStore", lambda **_kwargs: heartbeat)
    monkeypatch.setattr(historize_runs, "_read_recent_events", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secret-url")))

    result = historize_runs.historize_runs()

    assert result["status"] == "error"
    assert [event[0] for event in heartbeat.events] == ["start", "error"]
    detail = heartbeat.events[-1][1].detail
    assert detail["error_code"] == "HISTORIAN_PIPELINE_ERROR"
    assert "secret-url" not in json.dumps(detail)
