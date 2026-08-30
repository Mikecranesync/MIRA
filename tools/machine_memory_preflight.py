"""Pure, redacted machine-memory readiness evaluator.

This module deliberately receives already-inspected facts.  It opens no network
connections, writes no state, and serializes only booleans, counts, reason codes,
and one-way hashes suitable for an operations record.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

GO = "GO"
NO_GO = "NO_GO"
UNKNOWN = "UNKNOWN"

EXPECTED_CV101_UNS_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1"
EXPECTED_CV101_UNS_PATH_HASH = hashlib.sha256(EXPECTED_CV101_UNS_PATH.encode("utf-8")).hexdigest()
EXPECTED_FAULT_TRIGGER_HASH = hashlib.sha256(
    b"default_conveyor_fault_alarm"
).hexdigest()
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
_MAX_AGE_SECONDS = 300.0


@dataclass(frozen=True)
class MachineMemoryPreflightInput:
    expected_environment: str
    observed_environment: str
    expected_heartbeat_config_sha256: str
    observed_heartbeat_config_sha256: str
    expected_deployment_sha: str
    inspected_deployment_sha: str
    expected_database_identity_hash: str
    observed_database_identity_hash: str
    now: str
    latest_ingested_at: str | None
    latest_event_at: str | None
    heartbeat_started_at: str | None
    heartbeat_finished_at: str | None
    heartbeat_status: str | None
    heartbeat_software_version: str | None
    heartbeat_detail: dict[str, Any] | None
    fault_window_identity: str | None
    fault_window_from: str | None
    fault_window_to: str | None
    replay_from: str | None
    replay_to: str | None
    fault_window_row_count: int | None
    fault_window_physical_observation_count: int | None
    fault_window_simulated_observation_count: int | None
    fault_window_bad_quality_observation_count: int | None
    fault_window_unknown_provenance_count: int | None


@dataclass(frozen=True)
class Reason:
    code: str


@dataclass(frozen=True)
class MachineMemoryPreflightVerdict:
    status: str
    reasons: tuple[Reason, ...]
    snapshot_json: str


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _valid_hash(value: object, pattern: re.Pattern[str]) -> bool:
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def _valid_count(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _valid_hash_collection(value: object) -> bool:
    """Heartbeat evidence is an array of hashes, never a membership-friendly string."""
    return isinstance(value, (list, tuple)) and all(_valid_hash(item, _SHA256) for item in value)


def _snapshot(status: str, codes: list[str], data: MachineMemoryPreflightInput) -> str:
    """Serialize a stable, credentials/path/content-free operations record."""
    detail = data.heartbeat_detail if isinstance(data.heartbeat_detail, dict) else {}
    safe = {
        "status": status,
        "reason_codes": codes,
        "heartbeat": {
            "config_hash_present": _valid_hash(detail.get("config_sha256"), _SHA256),
            "run_diff_enabled": detail.get("run_diff_enabled") is True,
            "software_version_present": _valid_hash(data.heartbeat_software_version, _GIT_SHA),
        },
        "fault_window": {
            "row_count": data.fault_window_row_count
            if _valid_count(data.fault_window_row_count)
            else None,
            "physical_observation_count": data.fault_window_physical_observation_count
            if _valid_count(data.fault_window_physical_observation_count)
            else None,
            "simulated_observation_count": data.fault_window_simulated_observation_count
            if _valid_count(data.fault_window_simulated_observation_count)
            else None,
            "bad_quality_observation_count": data.fault_window_bad_quality_observation_count
            if _valid_count(data.fault_window_bad_quality_observation_count)
            else None,
            "unknown_provenance_count": data.fault_window_unknown_provenance_count
            if _valid_count(data.fault_window_unknown_provenance_count)
            else None,
        },
    }
    return json.dumps(safe, sort_keys=True, separators=(",", ":"))


def evaluate(data: MachineMemoryPreflightInput) -> MachineMemoryPreflightVerdict:
    """Evaluate only supplied facts. Unknown/malformed facts never produce GO."""
    codes: list[str] = []
    unknown = False

    def add(code: str) -> None:
        if code not in codes:
            codes.append(code)

    # Syntax/type failures are distinct from a known absent operational observation.
    required_hashes = (
        (data.expected_heartbeat_config_sha256, _SHA256),
        (data.observed_heartbeat_config_sha256, _SHA256),
        (data.expected_database_identity_hash, _SHA256),
        (data.observed_database_identity_hash, _SHA256),
        (data.expected_deployment_sha, _GIT_SHA),
        (data.inspected_deployment_sha, _GIT_SHA),
    )
    invalid = not all(_valid_hash(value, pattern) for value, pattern in required_hashes)
    time_values = (data.now, data.latest_event_at, data.fault_window_from, data.fault_window_to,
                   data.replay_from, data.replay_to)
    invalid = invalid or any(_timestamp(value) is None for value in time_values)
    invalid = invalid or any(
        not _valid_count(value)
        for value in (
            data.fault_window_row_count,
            data.fault_window_physical_observation_count,
            data.fault_window_simulated_observation_count,
            data.fault_window_bad_quality_observation_count,
            data.fault_window_unknown_provenance_count,
        )
    )
    if not isinstance(data.heartbeat_detail, dict):
        invalid = True
    else:
        invalid = invalid or any(
            not _valid_hash_collection(data.heartbeat_detail.get(field))
            for field in (
                "machine_memory_path_hashes",
                "run_trigger_path_hashes",
                "fault_trigger_tag_hashes",
            )
        )
    if invalid:
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")

    if data.latest_ingested_at is None:
        unknown = True
        add("INGEST_UNOBSERVED")
        add("CRITICAL_FACT_UNKNOWN")
    elif _timestamp(data.latest_ingested_at) is None:
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")

    if data.observed_environment != data.expected_environment:
        add("ENVIRONMENT_MISMATCH")
    if data.observed_database_identity_hash != data.expected_database_identity_hash:
        add("DATABASE_IDENTITY_MISMATCH")

    detail = data.heartbeat_detail if isinstance(data.heartbeat_detail, dict) else {}
    if detail.get("run_diff_enabled") is not True:
        add("RUN_DIFF_DISABLED")
    machine_memory_hashes = detail.get("machine_memory_path_hashes")
    fault_trigger_hashes = detail.get("fault_trigger_tag_hashes")
    if _valid_hash_collection(machine_memory_hashes) and EXPECTED_CV101_UNS_PATH_HASH not in machine_memory_hashes:
        add("CV101_UNS_NOT_CONFIGURED")
    if _valid_hash_collection(fault_trigger_hashes) and EXPECTED_FAULT_TRIGGER_HASH not in fault_trigger_hashes:
        add("FAULT_TRIGGER_TAGS_NOT_CONFIGURED")
    if detail.get("config_sha256") != data.observed_heartbeat_config_sha256 or (
        data.observed_heartbeat_config_sha256 != data.expected_heartbeat_config_sha256
    ):
        add("HISTORIAN_CONFIG_MISMATCH")

    if data.heartbeat_software_version is None:
        unknown = True
        add("HISTORIAN_VERSION_UNKNOWN")
    elif not _valid_hash(data.heartbeat_software_version, _GIT_SHA):
        unknown = True
        add("HISTORIAN_VERSION_UNKNOWN")
    elif (
        data.inspected_deployment_sha != data.expected_deployment_sha
        or data.heartbeat_software_version != data.inspected_deployment_sha
    ):
        add("HISTORIAN_CONFIG_MISMATCH")

    if data.heartbeat_started_at is None:
        add("HISTORIAN_EXECUTION_UNOBSERVED")
    elif _timestamp(data.heartbeat_started_at) is None:
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")
    if data.heartbeat_status == "running" and data.heartbeat_finished_at is None:
        add("HISTORIAN_STUCK_RUNNING")
    elif data.heartbeat_finished_at is None:
        add("HISTORIAN_EXECUTION_UNOBSERVED")
    elif _timestamp(data.heartbeat_finished_at) is None:
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")
    elif _timestamp(data.now) and _timestamp(data.now) - _timestamp(data.heartbeat_finished_at) > _seconds(_MAX_AGE_SECONDS):
        add("HISTORIAN_EXECUTION_STALE")
    if data.heartbeat_status is None:
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")
    elif data.heartbeat_status not in {"ok", "running"}:
        add("HISTORIAN_LAST_RUN_FAILED")

    now = _timestamp(data.now)
    ingested = _timestamp(data.latest_ingested_at)
    if now and ingested and now - ingested > _seconds(_MAX_AGE_SECONDS):
        add("INGEST_STALE")

    if data.fault_window_identity is None:
        unknown = True
        add("FAULT_WINDOW_UNOBSERVED")
    elif not _valid_hash(data.fault_window_identity, _SHA256):
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")
    if _timestamp(data.fault_window_from) != _timestamp(data.replay_from) or _timestamp(data.fault_window_to) != _timestamp(data.replay_to):
        add("FAULT_WINDOW_BOUNDS_MISMATCH")
    elif (
        _timestamp(data.replay_from) is not None
        and _timestamp(data.replay_to) is not None
        and _timestamp(data.replay_from) >= _timestamp(data.replay_to)
    ):
        add("FAULT_WINDOW_BOUNDS_MISMATCH")
    if all(
        _valid_count(value)
        for value in (
            data.fault_window_row_count,
            data.fault_window_physical_observation_count,
            data.fault_window_simulated_observation_count,
            data.fault_window_unknown_provenance_count,
        )
    ) and data.fault_window_row_count != (
        data.fault_window_physical_observation_count
        + data.fault_window_simulated_observation_count
        + data.fault_window_unknown_provenance_count
    ):
        unknown = True
        add("CRITICAL_FACT_UNKNOWN")
    if data.fault_window_row_count == 0 or data.fault_window_physical_observation_count == 0:
        add("FAULT_WINDOW_EMPTY")
    if data.fault_window_physical_observation_count == 0 and (data.fault_window_simulated_observation_count or 0) > 0:
        add("SIMULATED_ONLY")
    if (data.fault_window_bad_quality_observation_count or 0) > 0:
        add("GATEWAY_QUALITY_BAD")
    if (data.fault_window_unknown_provenance_count or 0) > 0:
        add("UNKNOWN_PROVENANCE")

    status = UNKNOWN if unknown else (NO_GO if codes else GO)
    return MachineMemoryPreflightVerdict(
        status=status,
        reasons=tuple(Reason(code) for code in codes),
        snapshot_json=_snapshot(status, codes, data),
    )


def _seconds(value: float):
    from datetime import timedelta

    return timedelta(seconds=value)
