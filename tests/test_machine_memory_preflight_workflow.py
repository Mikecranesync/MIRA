"""Contract tests for the manual, protected machine-memory preflight seam."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location(
        "machine_memory_preflight_snapshot",
        ROOT / "tools/qa/machine_memory_preflight_snapshot.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


snapshotter = _load()

TENANT = "11111111-1111-4111-8111-111111111111"
SHA = "a" * 40
HASH = "b" * 64
URL = "postgresql://operator:password@staging-db.example.test:5432/mira"


def _inputs(**overrides):
    values = {
        "environment": "staging",
        "expected_tenant_id": TENANT,
        "expected_uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
        "expected_deployment_sha": SHA,
        "expected_heartbeat_config_sha256": HASH,
        "expected_database_identity_hash": snapshotter.database_identity_hash(URL),
        "target_database_host": "staging-db.example.test",
        "database_url": URL,
        "replay_from": "2026-08-30T11:58:00Z",
        "replay_to": "2026-08-30T12:00:00Z",
        "workflow_run_id": "123456",
    }
    values.update(overrides)
    return snapshotter.PreflightInputs(**values)


def test_cross_environment_database_target_fails_before_connecting_and_redacts_url():
    """Would catch removing the target-host comparison before database access."""
    called = False

    def connect(_url):
        nonlocal called
        called = True
        raise AssertionError("must not connect")

    with pytest.raises(snapshotter.PreflightInputError) as exc:
        snapshotter.collect_snapshot(
            _inputs(target_database_host="production-db.example.test"), connect=connect, inspected_sha=SHA
        )

    assert not called
    assert URL not in str(exc.value)
    assert "password" not in str(exc.value)


@pytest.mark.parametrize(
    "query",
    [
        "host=production-db.example.test",
        "service=evil",
        "options=-c%20search_path%3Devil",
    ],
)
def test_target_altering_database_url_options_fail_before_connecting(query):
    """Would catch accepting libpq query parameters that override the host target."""
    called = False

    def connect(_url):
        nonlocal called
        called = True
        raise AssertionError("must not connect")

    redirected_url = URL + "?" + query
    with pytest.raises(snapshotter.PreflightInputError):
        snapshotter.collect_snapshot(
            _inputs(database_url=redirected_url), connect=connect, inspected_sha=SHA
        )

    assert not called


def test_snapshot_queries_share_read_only_transaction_and_local_tenant_setting():
    """Would catch executing a query before the transaction-local tenant guard."""
    trace: list[tuple[str, object]] = []
    rows = iter([{"heartbeat_count": 1, "heartbeat_environment": "staging"}, {}])

    class Cursor:
        def execute(self, statement, params=None):
            trace.append((statement, params))

        def fetchone(self):
            return (next(rows),)

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            trace.append(("close", None))

    snapshotter.collect_snapshot(_inputs(), connect=lambda _url: Connection(), inspected_sha=SHA)

    statements = [statement for statement, _params in trace]
    assert statements[0] == "BEGIN TRANSACTION READ ONLY"
    assert statements[1] == "SELECT set_config('app.current_tenant_id', %s, true)"
    assert all(
        statements.index(query) > 1 for query in snapshotter.SHIPPED_QUERIES.values()
    )
    query_params = {statement: params for statement, params in trace if statement in snapshotter.SHIPPED_QUERIES.values()}
    assert len(query_params[snapshotter.SHIPPED_QUERIES["heartbeat"]]) == 3
    assert len(query_params[snapshotter.SHIPPED_QUERIES["replay"]]) == 6


def test_db_observed_environment_mismatch_fails_closed_not_as_the_dispatch_input():
    """Would catch letting a selected environment replace database-observed evidence."""
    rows = iter(
        [
            {
                "heartbeat_environment": "production",
                "heartbeat_count": 1,
                "heartbeat_detail": {},
                "now": "2026-08-30T12:00:00Z",
            },
            {},
        ]
    )

    class Cursor:
        def execute(self, _statement, _params=None):
            return None

        def fetchone(self):
            return (next(rows),)

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            return None

    with pytest.raises(snapshotter.ObservedFactError):
        snapshotter.collect_snapshot(_inputs(), connect=lambda _url: Connection(), inspected_sha=SHA)


def test_heartbeat_query_never_filters_by_selected_environment_and_rejects_multiple_rows():
    """Would catch self-echoing the dispatch environment or silently choosing a row."""
    assert "deployment_environment = %s" not in snapshotter.SHIPPED_QUERIES["heartbeat"]

    rows = iter([{"heartbeat_count": 2, "heartbeat_environment": "staging"}])

    class Cursor:
        def execute(self, _statement, _params=None):
            return None

        def fetchone(self):
            return (next(rows),)

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            return None

    with pytest.raises(snapshotter.ObservedFactError):
        snapshotter.collect_snapshot(_inputs(), connect=lambda _url: Connection(), inspected_sha=SHA)


def test_artifact_records_only_redacted_facts_and_never_upgrades_unknown_to_go():
    """Would catch passing raw inputs to the artifact or treating UNKNOWN as GO."""
    artifact = snapshotter.build_artifact(
        snapshot={
            "observed_environment": "staging",
            "observed_database_identity_hash": HASH,
            "raw_url": URL,
            "tenant": TENANT,
        },
        verdict={"status": "UNKNOWN", "reasons": [{"code": "INGEST_UNOBSERVED"}]},
        workflow_run_id="123456",
        commit_sha=SHA,
    )

    rendered = snapshotter.canonical_json(artifact)
    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["ordered_reason_codes"] == ["INGEST_UNOBSERVED"]
    assert artifact["commit_sha"] == SHA
    assert URL not in rendered
    assert TENANT not in rendered
    assert "password" not in rendered


def test_artifact_allowlist_drops_hostile_observed_content_even_for_unknown():
    """Would catch a future database field escaping the redacted artifact."""
    hostile = "postgresql://operator:password@production-db.example.test/private"
    artifact = snapshotter.build_artifact(
        snapshot={
            "expected_environment": "staging",
            "observed_environment": hostile,
            "heartbeat_detail": {"raw_path": hostile, "config_sha256": hostile},
            "fault_window_row_count": "not-a-count",
            "unexpected": hostile,
        },
        verdict={"status": "UNKNOWN", "reasons": [{"code": "BAD\nCODE"}]},
        workflow_run_id="not-a-run-id",
        commit_sha="not-a-sha",
    )

    rendered = snapshotter.canonical_json(artifact)
    assert hostile not in rendered
    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["ordered_reason_codes"] == []


def test_manual_workflow_is_environment_bound_and_cannot_deploy_or_fetch_doppler():
    """Would catch broadening the operator workflow beyond protected inspection."""
    workflow = (ROOT / ".github/workflows/machine-memory-preflight.yml").read_text(
        encoding="utf-8"
    )
    assert "workflow_dispatch:" in workflow
    assert "environment:" in workflow
    assert "type: choice" in workflow
    assert "staging" in workflow and "production" in workflow
    assert "environment: ${{ inputs.environment }}" in workflow
    for dispatcher_controlled_anchor in ("expected_database_identity_hash:", "target_database_host:"):
        assert dispatcher_controlled_anchor not in workflow.split("jobs:", 1)[0]
    assert "EXPECTED_DATABASE_IDENTITY_HASH: ${{ vars.MACHINE_MEMORY_PREFLIGHT_DATABASE_IDENTITY_HASH }}" in workflow
    assert "TARGET_DATABASE_HOST: ${{ vars.MACHINE_MEMORY_PREFLIGHT_DATABASE_HOST }}" in workflow
    capture_step = workflow.split("- name: Capture protected read-only snapshot", 1)[1]
    capture_script = capture_step.split("run: |", 1)[1].split("- name: Upload redacted", 1)[0]
    assert "${{ inputs." not in capture_script
    for forbidden in ("doppler", "docker.sock", "curl ", "psql ", "sql_input"):
        assert forbidden not in workflow.lower()
