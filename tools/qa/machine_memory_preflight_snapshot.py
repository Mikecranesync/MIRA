#!/usr/bin/env python3
"""Manual, read-only snapshotter for the machine-memory preflight workflow.

This program deliberately accepts a database URL only from its process environment
or workflow secret mapping.  It has no SQL input, performs no writes, and emits
only redacted operational facts suitable for the workflow artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import parse_qsl, urlsplit

REPO = Path(__file__).resolve().parents[2]
EXPECTED_UNS_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
_FORBIDDEN_SQL = re.compile(
    r"\b(?:insert|update|delete|merge|copy|create|alter|drop|grant|revoke|call|do|set)\b",
    re.IGNORECASE,
)
_REASON_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
_SAFE_DSN_OPTIONS = {"sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout"}
_SECURE_SSLMODES = {"require", "verify-ca", "verify-full"}


class PreflightInputError(ValueError):
    """A fail-closed input/target validation outcome, safe to report by code only."""


class SqlContractError(ValueError):
    """A shipped query violates the static SELECT-only contract."""


class ObservedFactError(ValueError):
    """Observed database facts are missing, ambiguous, or contradict the target."""


@dataclass(frozen=True)
class PreflightInputs:
    environment: str
    expected_tenant_id: str
    expected_uns_path: str
    expected_deployment_sha: str
    expected_heartbeat_config_sha256: str
    expected_database_identity_hash: str
    target_database_host: str
    database_url: str
    replay_from: str
    replay_to: str
    workflow_run_id: str


# Each query is one CTE/SELECT statement.  Event time bounds deliberately use
# a half-open interval, so the replay counts have exact, reproducible bounds.
SHIPPED_QUERIES = {
    "heartbeat": """
WITH scoped_heartbeats AS (
    SELECT deployment_environment, started_at, finished_at, status, software_version, detail
      FROM historian_task_heartbeat
     WHERE tenant_id = %s::uuid
       AND task_name = 'historize_runs'
       AND started_at >= %s::timestamptz
       AND started_at < %s::timestamptz
     ORDER BY started_at DESC
)
SELECT json_build_object(
    'heartbeat_count', (SELECT count(*) FROM scoped_heartbeats),
    'heartbeat_environment', (SELECT deployment_environment FROM scoped_heartbeats LIMIT 1),
    'heartbeat_started_at', (SELECT started_at FROM scoped_heartbeats LIMIT 1),
    'heartbeat_finished_at', (SELECT finished_at FROM scoped_heartbeats LIMIT 1),
    'heartbeat_status', (SELECT status FROM scoped_heartbeats LIMIT 1),
    'heartbeat_software_version', (SELECT software_version FROM scoped_heartbeats LIMIT 1),
    'heartbeat_detail', (SELECT detail FROM scoped_heartbeats LIMIT 1),
    'now', current_timestamp
)
""".strip(),
    "replay": """
WITH replay_bounds AS (
    SELECT %s::timestamptz AS replay_from, %s::timestamptz AS replay_to
), fault_trigger AS (
    SELECT min(d.fault_window_id::text) AS fault_window_id,
           count(DISTINCT d.fault_window_id) AS fault_window_count
      FROM tag_event_diffs d
      CROSS JOIN replay_bounds
      JOIN tag_events trigger_event
        ON trigger_event.event_id = d.to_event_id
       AND trigger_event.tenant_id = %s::uuid
       AND trigger_event.uns_path = %s::ltree
       AND trigger_event.event_timestamp >= replay_from
       AND trigger_event.event_timestamp < replay_to
     WHERE d.tenant_id = %s::uuid
       AND d.uns_path = %s::ltree
       AND d.event_timestamp >= replay_from
       AND d.event_timestamp < replay_to
       AND d.tag_path = 'default_conveyor_fault_alarm'
       AND d.diff_type = 'rising_edge'
       AND d.fault_window_id IS NOT NULL
       AND trigger_event.source_system = 'ignition'
       AND trigger_event.source_connection_id = 'cv101-bench-gw'
       AND trigger_event.simulated = false
       AND trigger_event.quality = 'good'
       AND lower(trim(coalesce(trigger_event.value, ''))) IN ('true', '1', 'active', 'faulted')
), scoped_events AS (
    SELECT event_id, tag_path, event_timestamp, ingested_at, quality, source_system,
           source_connection_id, simulated
      FROM tag_events
      CROSS JOIN replay_bounds
      CROSS JOIN fault_trigger
     WHERE tenant_id = %s::uuid
       AND uns_path = %s::ltree
       AND fault_window_count = 1
       AND event_timestamp >= replay_from
       AND event_timestamp < replay_to
)
SELECT json_build_object(
    'latest_ingested_at', max(ingested_at),
    'latest_event_at', max(event_timestamp),
    'fault_window_identity', CASE WHEN (SELECT fault_window_count FROM fault_trigger) = 1 THEN encode(digest((SELECT fault_window_id FROM fault_trigger), 'sha256'), 'hex') ELSE NULL END,
    'fault_window_from', (SELECT replay_from FROM replay_bounds),
    'fault_window_to', (SELECT replay_to FROM replay_bounds),
    'fault_window_row_count', count(*),
    'fault_window_physical_observation_count', count(*) FILTER (WHERE source_system = 'ignition' AND source_connection_id = 'cv101-bench-gw' AND simulated = false),
    'fault_window_simulated_observation_count', count(*) FILTER (WHERE simulated = true OR source_system = 'simulator'),
    'fault_window_bad_quality_observation_count', count(*) FILTER (WHERE quality IN ('bad', 'stale', 'uncertain')),
    'fault_window_unknown_provenance_count', count(*) FILTER (WHERE NOT (source_system = 'ignition' AND source_connection_id = 'cv101-bench-gw' AND simulated = false) AND NOT (simulated = true OR source_system = 'simulator'))
    ,'fault_window_distinct_observed_timestamps', count(DISTINCT event_timestamp)
    ,'fault_window_tag_count', count(DISTINCT tag_path)
)
FROM scoped_events
""".strip(),
}

# Reviewed independently from the mutable runtime registry.  A source edit must
# deliberately update this review record *and* satisfy the structural contract.
_REVIEWED_QUERY_SHA256 = {
    "heartbeat": "9e7733dede60c7608091f41870a2aeeb458f6b32d0b000893a6ce5188258c9c6",
    "replay": "7b62590b4e77d4d89e069b83563090fd0e32591624142289155a146ab8dfb80f",
}


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def database_identity_hash(database_url: str) -> str:
    """Hash the supplied target identity without retaining its credentials or URL."""
    try:
        parsed = urlsplit(database_url)
        query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
        query_keys = {key.lower() for key, _value in query_pairs}
        port = parsed.port or 5432
    except ValueError as exc:
        raise PreflightInputError("DATABASE_URL_INVALID") from exc
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname or not parsed.path:
        raise PreflightInputError("DATABASE_URL_INVALID")
    if parsed.fragment or not query_keys.issubset(_SAFE_DSN_OPTIONS):
        raise PreflightInputError("DATABASE_URL_REDIRECT_OPTION")
    sslmodes = [value.lower() for key, value in query_pairs if key.lower() == "sslmode"]
    if len(sslmodes) != 1 or sslmodes[0] not in _SECURE_SSLMODES:
        raise PreflightInputError("DATABASE_TLS_INVALID")
    database = parsed.path.lstrip("/")
    if not database or "/" in database:
        raise PreflightInputError("DATABASE_URL_INVALID")
    identity = f"postgresql://{parsed.hostname.lower()}:{port}/{database}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _target_host(database_url: str) -> str:
    try:
        host = urlsplit(database_url).hostname
    except ValueError as exc:
        raise PreflightInputError("DATABASE_URL_INVALID") from exc
    if not host:
        raise PreflightInputError("DATABASE_URL_INVALID")
    return host.lower()


def _validate_inputs(inputs: PreflightInputs, inspected_sha: str) -> None:
    if inputs.environment not in {"staging", "production"}:
        raise PreflightInputError("ENVIRONMENT_INVALID")
    try:
        uuid.UUID(inputs.expected_tenant_id)
    except (ValueError, AttributeError) as exc:
        raise PreflightInputError("TENANT_INVALID") from exc
    if inputs.expected_uns_path != EXPECTED_UNS_PATH:
        raise PreflightInputError("UNS_TARGET_MISMATCH")
    if not _GIT_SHA.fullmatch(inputs.expected_deployment_sha) or inspected_sha != inputs.expected_deployment_sha:
        raise PreflightInputError("DEPLOYMENT_SHA_MISMATCH")
    if not _SHA256.fullmatch(inputs.expected_heartbeat_config_sha256):
        raise PreflightInputError("HEARTBEAT_CONFIG_HASH_INVALID")
    if not _SHA256.fullmatch(inputs.expected_database_identity_hash):
        raise PreflightInputError("DATABASE_IDENTITY_HASH_INVALID")
    if not inputs.target_database_host or _target_host(inputs.database_url) != inputs.target_database_host.lower():
        raise PreflightInputError("DATABASE_TARGET_MISMATCH")
    if database_identity_hash(inputs.database_url) != inputs.expected_database_identity_hash:
        raise PreflightInputError("DATABASE_IDENTITY_MISMATCH")
    replay_from = _rfc3339_instant(inputs.replay_from)
    replay_to = _rfc3339_instant(inputs.replay_to)
    if replay_from is None or replay_to is None:
        raise PreflightInputError("REPLAY_BOUNDS_INVALID")
    if replay_from >= replay_to:
        raise PreflightInputError("REPLAY_BOUNDS_INVALID")
    if not inputs.workflow_run_id.isdecimal():
        raise PreflightInputError("WORKFLOW_RUN_ID_INVALID")


def assert_safe_select_query(name: str, query: str) -> None:
    """Enforce immutable reviewed SQL plus per-relation tenant/bounds predicates."""
    expected_digest = _REVIEWED_QUERY_SHA256.get(name)
    if expected_digest is None or hashlib.sha256(query.encode("utf-8")).hexdigest() != expected_digest:
        raise SqlContractError(f"{name}: query_not_allowlisted")
    normalized = " ".join(query.split())
    lowered = normalized.lower()
    if (
        not normalized
        or ";" in normalized
        or "--" in normalized
        or "/*" in normalized
        or "*/" in normalized
        or _FORBIDDEN_SQL.search(normalized)
        or re.search(r"\b(?:union|intersect|except)\b", lowered)
        or not lowered.startswith("with ")
    ):
        raise SqlContractError(f"{name}: non_select_statement")
    if name == "heartbeat":
        _require_relation_scopes(
            name,
            normalized,
            "historian_task_heartbeat",
            ("tenant_id = %s::uuid", "started_at >= %s::timestamptz", "started_at < %s::timestamptz"),
        )
    elif name == "replay":
        _require_relation_scopes(
            name,
            normalized,
            "tag_events",
            ("tenant_id = %s::uuid", "uns_path = %s::ltree", "event_timestamp >= replay_from", "event_timestamp < replay_to"),
        )
        _require_relation_scopes(
            name,
            normalized,
            "tag_event_diffs",
            ("tenant_id = %s::uuid", "uns_path = %s::ltree", "event_timestamp >= replay_from", "event_timestamp < replay_to"),
        )


def _require_relation_scopes(
    name: str, query: str, relation: str, required_predicates: tuple[str, ...]
) -> None:
    """Require target predicates in every direct table scope, never a decoy CTE."""
    matches = list(re.finditer(rf"\b(?:from|join)\s+{re.escape(relation)}\b", query, re.IGNORECASE))
    if relation in {"historian_task_heartbeat", "tag_events", "tag_event_diffs"} and not matches:
        raise SqlContractError(f"{name}: {relation}_scope_missing")
    for match in matches:
        following = query[match.end():]
        boundary = re.search(r"\)\s*(?:,\s*[a-z_]+\s+as\s*\(|select\b)", following, re.IGNORECASE)
        scope = following[: boundary.start()] if boundary else following
        lowered_scope = scope.lower()
        if not all(predicate in lowered_scope for predicate in required_predicates):
            raise SqlContractError(f"{name}: {relation}_scope_unbounded")


def _assert_shipped_queries_safe() -> None:
    for name, query in SHIPPED_QUERIES.items():
        assert_safe_select_query(name, query)


def _git_sha() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True, stderr=subprocess.DEVNULL
    ).strip().lower()


def _fetch_json(cursor: Any, statement: str, params: tuple[object, ...]) -> dict[str, object]:
    cursor.execute(statement, params)
    row = cursor.fetchone()
    value = row[0] if row else None
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("DATABASE_RESULT_MALFORMED")
    return value


def collect_snapshot(
    inputs: PreflightInputs,
    *,
    connect: Callable[[str], Any],
    inspected_sha: str | None = None,
) -> dict[str, object]:
    """Validate target first, then read the bounded facts in one transaction."""
    inspected_sha = _git_sha() if inspected_sha is None else inspected_sha
    _validate_inputs(inputs, inspected_sha)
    _assert_shipped_queries_safe()
    connection = connect(inputs.database_url)
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN TRANSACTION READ ONLY")
        cursor.execute("SELECT set_config('app.current_tenant_id', %s, true)", (inputs.expected_tenant_id,))
        heartbeat = _fetch_json(
            cursor,
            SHIPPED_QUERIES["heartbeat"],
            (inputs.expected_tenant_id, inputs.replay_from, inputs.replay_to),
        )
        if heartbeat.get("heartbeat_count") != 1:
            raise ObservedFactError("HEARTBEAT_CARDINALITY_INVALID")
        if heartbeat.get("heartbeat_environment") != inputs.environment:
            raise ObservedFactError("HEARTBEAT_ENVIRONMENT_MISMATCH")
        replay = _fetch_json(
            cursor,
            SHIPPED_QUERIES["replay"],
            (
                inputs.replay_from, inputs.replay_to, inputs.expected_tenant_id,
                inputs.expected_uns_path, inputs.expected_tenant_id, inputs.expected_uns_path,
                inputs.expected_tenant_id, inputs.expected_uns_path,
            ),
        )
        cursor.execute("COMMIT")
    finally:
        connection.close()
    return {
        "expected_environment": inputs.environment,
        "observed_environment": heartbeat.get("heartbeat_environment"),
        "expected_heartbeat_config_sha256": inputs.expected_heartbeat_config_sha256,
        "observed_heartbeat_config_sha256": (heartbeat.get("heartbeat_detail") or {}).get("config_sha256"),
        "expected_deployment_sha": inputs.expected_deployment_sha,
        "inspected_deployment_sha": inspected_sha,
        "expected_database_identity_hash": inputs.expected_database_identity_hash,
        "observed_database_identity_hash": database_identity_hash(inputs.database_url),
        "now": heartbeat.get("now"),
        "latest_ingested_at": replay.get("latest_ingested_at"),
        "latest_event_at": replay.get("latest_event_at"),
        "heartbeat_started_at": heartbeat.get("heartbeat_started_at"),
        "heartbeat_finished_at": heartbeat.get("heartbeat_finished_at"),
        "heartbeat_status": heartbeat.get("heartbeat_status"),
        "heartbeat_software_version": heartbeat.get("heartbeat_software_version"),
        "heartbeat_detail": heartbeat.get("heartbeat_detail"),
        "fault_window_identity": replay.get("fault_window_identity"),
        "fault_window_from": replay.get("fault_window_from"),
        "fault_window_to": replay.get("fault_window_to"),
        "replay_from": inputs.replay_from,
        "replay_to": inputs.replay_to,
        "fault_window_row_count": replay.get("fault_window_row_count"),
        "fault_window_physical_observation_count": replay.get("fault_window_physical_observation_count"),
        "fault_window_simulated_observation_count": replay.get("fault_window_simulated_observation_count"),
        "fault_window_bad_quality_observation_count": replay.get("fault_window_bad_quality_observation_count"),
        "fault_window_unknown_provenance_count": replay.get("fault_window_unknown_provenance_count"),
        "fault_window_distinct_observed_timestamps": replay.get("fault_window_distinct_observed_timestamps"),
        "fault_window_tag_count": replay.get("fault_window_tag_count"),
    }


def _safe_hash(value: object, pattern: re.Pattern[str] = _SHA256) -> str | None:
    return value if isinstance(value, str) and pattern.fullmatch(value) else None


def _safe_time(value: object) -> str | None:
    return value if _rfc3339_instant(value) is not None else None


def _rfc3339_instant(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _safe_count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _safe_hashes(value: object) -> list[str] | None:
    if not isinstance(value, list) or not all(_safe_hash(item) for item in value):
        return None
    return list(value)


def _redact_snapshot(snapshot: Mapping[str, object]) -> dict[str, object]:
    """Construct an artifact snapshot from an explicit typed safe-field allowlist."""
    detail = snapshot.get("heartbeat_detail")
    safe_detail = {
        "config_sha256": _safe_hash(detail.get("config_sha256")) if isinstance(detail, dict) else None,
        "run_diff_enabled": detail.get("run_diff_enabled") if isinstance(detail, dict) and isinstance(detail.get("run_diff_enabled"), bool) else None,
        "machine_memory_path_hashes": _safe_hashes(detail.get("machine_memory_path_hashes")) if isinstance(detail, dict) else None,
        "run_trigger_path_hashes": _safe_hashes(detail.get("run_trigger_path_hashes")) if isinstance(detail, dict) else None,
        "fault_trigger_tag_hashes": _safe_hashes(detail.get("fault_trigger_tag_hashes")) if isinstance(detail, dict) else None,
    }
    environments = {"staging", "production"}
    safe = {
        "expected_environment": snapshot.get("expected_environment") if snapshot.get("expected_environment") in environments else None,
        "observed_environment": snapshot.get("observed_environment") if snapshot.get("observed_environment") in environments else None,
        "expected_heartbeat_config_sha256": _safe_hash(snapshot.get("expected_heartbeat_config_sha256")),
        "observed_heartbeat_config_sha256": _safe_hash(snapshot.get("observed_heartbeat_config_sha256")),
        "expected_deployment_sha": _safe_hash(snapshot.get("expected_deployment_sha"), _GIT_SHA),
        "inspected_deployment_sha": _safe_hash(snapshot.get("inspected_deployment_sha"), _GIT_SHA),
        "expected_database_identity_hash": _safe_hash(snapshot.get("expected_database_identity_hash")),
        "observed_database_identity_hash": _safe_hash(snapshot.get("observed_database_identity_hash")),
        "now": _safe_time(snapshot.get("now")),
        "latest_ingested_at": _safe_time(snapshot.get("latest_ingested_at")),
        "latest_event_at": _safe_time(snapshot.get("latest_event_at")),
        "heartbeat_started_at": _safe_time(snapshot.get("heartbeat_started_at")),
        "heartbeat_finished_at": _safe_time(snapshot.get("heartbeat_finished_at")),
        "heartbeat_status": snapshot.get("heartbeat_status") if snapshot.get("heartbeat_status") in {"running", "ok", "error", "disabled", "no_triggers", "missing_config"} else None,
        "heartbeat_software_version": _safe_hash(snapshot.get("heartbeat_software_version"), _GIT_SHA),
        "heartbeat_detail": safe_detail,
        "fault_window_identity": _safe_hash(snapshot.get("fault_window_identity")),
        "fault_window_from": _safe_time(snapshot.get("fault_window_from")),
        "fault_window_to": _safe_time(snapshot.get("fault_window_to")),
        "replay_from": _safe_time(snapshot.get("replay_from")),
        "replay_to": _safe_time(snapshot.get("replay_to")),
    }
    for key in (
        "fault_window_row_count", "fault_window_physical_observation_count",
        "fault_window_simulated_observation_count", "fault_window_bad_quality_observation_count",
        "fault_window_unknown_provenance_count",
        "fault_window_distinct_observed_timestamps", "fault_window_tag_count",
    ):
        safe[key] = _safe_count(snapshot.get(key))
    return safe


def _sql_hash() -> str:
    return hashlib.sha256(canonical_json(SHIPPED_QUERIES).encode("utf-8")).hexdigest()


def build_artifact(
    *, snapshot: Mapping[str, object], verdict: Mapping[str, object], workflow_run_id: str, commit_sha: str
) -> dict[str, object]:
    reasons = verdict.get("reasons", [])
    codes = [
        item.get("code") for item in reasons
        if isinstance(item, dict) and isinstance(item.get("code"), str) and _REASON_CODE.fullmatch(item["code"])
    ]
    status = verdict.get("status") if verdict.get("status") in {"GO", "NO_GO", "UNKNOWN"} else "UNKNOWN"
    return {
        "snapshot": _redact_snapshot(snapshot),
        "verdict": status,
        "ordered_reason_codes": codes,
        "commit_sha": _safe_hash(commit_sha, _GIT_SHA) or "unknown",
        "workflow_run_id": workflow_run_id if workflow_run_id.isdecimal() else "unknown",
        "sql_sha256": _sql_hash(),
    }


def _load_evaluator():
    spec = importlib.util.spec_from_file_location("machine_memory_preflight", REPO / "tools/machine_memory_preflight.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _connect(database_url: str):
    import psycopg

    return psycopg.connect(database_url)


def _failure_artifact(code: str, inputs: PreflightInputs, commit_sha: str) -> dict[str, object]:
    return build_artifact(
        snapshot={"expected_environment": inputs.environment},
        verdict={"status": "UNKNOWN", "reasons": [{"code": code}]},
        workflow_run_id=inputs.workflow_run_id,
        commit_sha=commit_sha if _GIT_SHA.fullmatch(commit_sha) else "unknown",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only machine-memory preflight snapshot")
    parser.add_argument("--environment", required=True, choices=("staging", "production"))
    parser.add_argument("--expected-tenant-id", required=True)
    parser.add_argument("--expected-uns-path", required=True)
    parser.add_argument("--expected-deployment-sha", required=True)
    parser.add_argument("--expected-heartbeat-config-sha256", required=True)
    parser.add_argument("--expected-database-identity-hash", required=True)
    parser.add_argument("--target-database-host", required=True)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--replay-from", required=True)
    parser.add_argument("--replay-to", required=True)
    parser.add_argument("--workflow-run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    inputs = PreflightInputs(**{key: getattr(args, key) for key in PreflightInputs.__annotations__})
    inspected_sha = _git_sha()
    try:
        snapshot = collect_snapshot(inputs, connect=_connect, inspected_sha=inspected_sha)
        evaluator = _load_evaluator()
        evaluated = evaluator.evaluate(evaluator.MachineMemoryPreflightInput(**snapshot))
        verdict = {"status": evaluated.status, "reasons": [{"code": reason.code} for reason in evaluated.reasons]}
        artifact = build_artifact(snapshot=snapshot, verdict=verdict, workflow_run_id=inputs.workflow_run_id, commit_sha=inspected_sha)
    except PreflightInputError as exc:
        artifact = _failure_artifact(str(exc), inputs, inspected_sha)
    except Exception:
        artifact = _failure_artifact("DATABASE_QUERY_FAILED", inputs, inspected_sha)
    args.output.write_text(canonical_json(artifact) + "\n", encoding="utf-8")
    print(f"machine-memory preflight: {artifact['verdict']}")
    return 0 if artifact["verdict"] == "GO" else 2


if __name__ == "__main__":
    raise SystemExit(main())
