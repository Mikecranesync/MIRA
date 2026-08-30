"""Celery-beat task — run-centric fault detection (issue #2341).

Thin wrapper around ``run_engine.pipeline.run_historization``:
  - NO-OP unless ``MIRA_RUN_DIFF_ENABLED == "1"`` (default disabled).
  - reads recent tag_events (own minimal reader — does NOT import the
    unmerged tag_diff_historizer), segments runs, persists runs/steps,
    updates the baseline, computes + persists diffs.

Beat cadence is every 30s (see celeryconfig.beat_schedule), but the disabled
fast-path keeps that cheap until the feature is switched on per deployment.

Config (env):
  MIRA_RUN_DIFF_ENABLED            "1" to enable (default off)
  MIRA_TENANT_ID                   tenant UUID
  NEON_DATABASE_URL                Hub DB
  MIRA_RUN_TRIGGERS                "uns_path=tag_path:threshold,..."
  MIRA_MACHINE_MEMORY_UNS_PATHS    extra uns_paths (comma-separated) to derive
                                   state windows + A0-A12 anomaly diffs for,
                                   even without a run trigger (migration 040)
  MIRA_RUN_K_SIGMA                 sigma multiplier for 'critical' (default 3.0)
  MIRA_BASELINE_NORMAL_RUN_COUNT   max normal runs in the baseline (default 5)
  MIRA_BASELINE_MIN_RUNS           min normal runs before scoring (default 2)
  MIRA_SNAPSHOT_PRE_SECONDS        evidence window pre-roll (default 300)
  MIRA_SNAPSHOT_POST_SECONDS       evidence window post-roll (default 300)
  MIRA_RUN_LOOKBACK_SECONDS        tag_events read horizon per beat (default 3600)
  MIRA_ANOMALY_COOLDOWN_SECONDS    cross-window suppression for info-severity
                                   anomalies (#2431; default 1800, 0 disables)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

try:
    from mira_crawler.run_engine.machine_memory import historize_machine_memory
    from mira_crawler.run_engine.models import Reading, parse_run_triggers
    from mira_crawler.run_engine.pipeline import run_historization
    from mira_crawler.run_engine.store import NeonRunStore
except ImportError:
    from run_engine.machine_memory import historize_machine_memory
    from run_engine.models import Reading, parse_run_triggers
    from run_engine.pipeline import run_historization
    from run_engine.store import NeonRunStore

logger = logging.getLogger("mira-crawler.tasks.historize_runs")

_DEPLOYMENT_ENVIRONMENTS = {"development", "staging", "production"}
_GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_REQUIRED_FAULT_TRIGGER = "default_conveyor_fault_alarm"


@dataclass(frozen=True)
class HeartbeatContext:
    """The identity and redacted evidence attached to one task execution."""

    tenant_id: str
    deployment_environment: str
    software_version: str
    detail: dict[str, object]


def _normalize_uns_path(path: str) -> str:
    """Canonical dotted UNS form used only for deterministic hashing."""
    normalized = ".".join(part.strip() for part in path.strip().replace("/", ".").split(".") if part.strip())
    if not normalized:
        raise ValueError("heartbeat_config_invalid")
    return normalized.lower()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_heartbeat_context(env: dict[str, str] | None = None) -> HeartbeatContext:
    """Validate deployment identity and derive a redacted canonical fingerprint.

    This is intentionally pure: it neither opens a DB connection nor retains
    the connection URL. The resulting detail contains only booleans, counts,
    and SHA-256 fingerprints, never configured paths or tag values.
    """
    values = os.environ if env is None else env
    deployment_environment = (values.get("MIRA_DEPLOYMENT_ENVIRONMENT") or "").strip().lower()
    software_version = (values.get("MIRA_GIT_SHA") or "").strip().lower()
    if deployment_environment not in _DEPLOYMENT_ENVIRONMENTS or not _GIT_SHA_RE.fullmatch(software_version):
        raise ValueError("heartbeat_identity_invalid")

    tenant_id = (values.get("MIRA_TENANT_ID") or "").strip()
    run_diff_enabled = (values.get("MIRA_RUN_DIFF_ENABLED") or "") == "1"
    triggers = parse_run_triggers(values.get("MIRA_RUN_TRIGGERS"))
    trigger_paths = sorted({_normalize_uns_path(path) for path in triggers})
    machine_memory_paths = sorted(
        {
            _normalize_uns_path(path)
            for path in (values.get("MIRA_MACHINE_MEMORY_UNS_PATHS") or "").split(",")
            if path.strip()
        }
    )

    raw_diff_config = (values.get("TAG_DIFF_CONFIG_JSON") or "").strip()
    try:
        diff_config = json.loads(raw_diff_config) if raw_diff_config else {}
        fault_trigger_tags = diff_config.get("fault_trigger_tags", [])
        if not isinstance(diff_config, dict) or not isinstance(fault_trigger_tags, list):
            raise TypeError
        normalized_fault_tags = sorted({str(tag).strip().lower() for tag in fault_trigger_tags if str(tag).strip()})
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("fault_trigger_tags_invalid") from exc
    if _REQUIRED_FAULT_TRIGGER not in normalized_fault_tags:
        raise ValueError("fault_trigger_tags_invalid")

    # Include every task-effective knob in the canonical evidence, while only
    # persisting its one-way digest. Defaults mirror historize_runs below.
    effective_settings = {
        "k_sigma": (values.get("MIRA_RUN_K_SIGMA", "3.0") or "").strip(),
        "normal_run_count": (values.get("MIRA_BASELINE_NORMAL_RUN_COUNT", "5") or "").strip(),
        "min_baseline_runs": (values.get("MIRA_BASELINE_MIN_RUNS", "2") or "").strip(),
        "snapshot_pre_seconds": (values.get("MIRA_SNAPSHOT_PRE_SECONDS", "300") or "").strip(),
        "snapshot_post_seconds": (values.get("MIRA_SNAPSHOT_POST_SECONDS", "300") or "").strip(),
        "lookback_seconds": (values.get("MIRA_RUN_LOOKBACK_SECONDS", "3600") or "").strip(),
        "anomaly_cooldown_seconds": (values.get("MIRA_ANOMALY_COOLDOWN_SECONDS", "1800") or "").strip(),
    }
    canonical_config = {
        "effective_settings": effective_settings,
        "fault_trigger_tags": normalized_fault_tags,
        "machine_memory_uns_paths": machine_memory_paths,
        "run_diff_enabled": run_diff_enabled,
        "run_triggers": [
            {
                "threshold": trigger.threshold,
                "tag_path": trigger.tag_path.strip(),
                "uns_path": _normalize_uns_path(uns_path),
            }
            for uns_path, trigger in sorted(triggers.items())
        ],
    }
    detail: dict[str, object] = {
        "config_sha256": _sha256(json.dumps(canonical_config, sort_keys=True, separators=(",", ":"))),
        "counts": {
            "machine_memory_paths": len(machine_memory_paths),
            "run_trigger_paths": len(trigger_paths),
            "fault_trigger_tags": len(normalized_fault_tags),
        },
        "fault_trigger_tag_hashes": [_sha256(path) for path in normalized_fault_tags],
        "machine_memory_path_hashes": [_sha256(path) for path in machine_memory_paths],
        "run_diff_enabled": run_diff_enabled,
        "run_trigger_path_hashes": [_sha256(path) for path in trigger_paths],
    }
    return HeartbeatContext(
        tenant_id=tenant_id,
        deployment_environment=deployment_environment,
        software_version=software_version,
        detail=detail,
    )


class HistorianHeartbeatStore:
    """The deliberately narrow write seam for historian execution evidence."""

    def __init__(self, *, engine, tenant_id: str) -> None:
        self._engine = engine
        self._tenant_id = tenant_id

    def start(self, context: HeartbeatContext) -> None:
        """Commit the running evidence before any historian work begins."""
        from sqlalchemy import text

        params = {
            "tenant_id": self._tenant_id,
            "deployment_environment": context.deployment_environment,
            "task_name": "historize_runs",
            "software_version": context.software_version,
            "detail": json.dumps(context.detail, sort_keys=True, separators=(",", ":")),
        }
        with self._engine.begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tenant_id"),
                {"tenant_id": self._tenant_id},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO historian_task_heartbeat
                        (tenant_id, deployment_environment, task_name, started_at,
                         finished_at, status, software_version, run_count, detail)
                    VALUES
                        (CAST(:tenant_id AS UUID), :deployment_environment, :task_name, NOW(),
                         NULL, 'running', :software_version, 1, CAST(:detail AS JSONB))
                    ON CONFLICT (tenant_id, deployment_environment, task_name)
                    DO UPDATE SET
                        started_at = NOW(),
                        finished_at = NULL,
                        status = 'running',
                        software_version = EXCLUDED.software_version,
                        run_count = historian_task_heartbeat.run_count + 1,
                        detail = EXCLUDED.detail,
                        updated_at = NOW()
                    """
                ),
                params,
            )

    def finish(self, context: HeartbeatContext, *, status: str) -> None:
        """Commit a terminal status without changing the start run count."""
        from sqlalchemy import text

        params = {
            "tenant_id": self._tenant_id,
            "deployment_environment": context.deployment_environment,
            "task_name": "historize_runs",
            "status": status,
            "detail": json.dumps(context.detail, sort_keys=True, separators=(",", ":")),
        }
        with self._engine.begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tenant_id"),
                {"tenant_id": self._tenant_id},
            )
            conn.execute(
                text(
                    """
                    UPDATE historian_task_heartbeat
                       SET finished_at = NOW(), status = :status,
                           detail = CAST(:detail AS JSONB), updated_at = NOW()
                     WHERE tenant_id = CAST(:tenant_id AS UUID)
                       AND deployment_environment = :deployment_environment
                       AND task_name = :task_name
                    """
                ),
                params,
            )


def _enabled() -> bool:
    return os.getenv("MIRA_RUN_DIFF_ENABLED") == "1"


def _engine(neon_url: str):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    return create_engine(
        neon_url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _read_recent_events(
    neon_url: str,
    tenant_id: str,
    *,
    uns_paths: list[str],
    lookback_seconds: float,
) -> list[Reading]:
    """Read recent tag_events for the trigger equipment (own minimal reader).

    Deliberately self-contained — we do NOT import the (unmerged)
    tag_diff_historizer. tag_events is never modified.
    """
    if not uns_paths:
        return []
    from sqlalchemy import text

    engine = _engine(neon_url)
    with engine.connect() as conn:
        conn.execute(
            text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
        )
        # Horizon + ordering run on ingested_at (SERVER receipt time), NOT the
        # client event_timestamp: Ignition report-by-exception freezes the
        # client ts when values stop changing, which (a) pinned the window
        # clock and (b) aged perfectly-fresh rows out of this horizon
        # (bench-proven 2026-07-04: windows frozen at 11:06 while rows landed
        # at 6/s). event_timestamp is still read as source-observed metadata.
        rows = (
            conn.execute(
                text(
                    """
                    SELECT tag_path, value, value_type, quality,
                           uns_path::text AS uns_path,
                           event_id::text AS event_id, simulated, source_system,
                           extract(epoch FROM event_timestamp) AS ts,
                           extract(epoch FROM ingested_at) AS ingested_ts
                      FROM tag_events
                     WHERE tenant_id = :tid
                       AND uns_path::text = ANY(:uns_paths)
                       AND ingested_at >= NOW() - (:lookback || ' seconds')::interval
                     ORDER BY ingested_at ASC
                    """
                ),
                {
                    "tid": tenant_id,
                    "uns_paths": uns_paths,
                    "lookback": str(int(lookback_seconds)),
                },
            )
            .mappings()
            .all()
        )

    out: list[Reading] = []
    for r in rows:
        raw = r["value"]
        try:
            numeric = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            numeric = None
        out.append(
            Reading(
                tag_path=r["tag_path"],
                value=numeric,
                event_timestamp=float(r["ts"]),
                uns_path=r["uns_path"],
                value_type=r["value_type"],
                quality=r["quality"],
                event_id=r["event_id"],
                simulated=bool(r["simulated"]),
                source_system=r["source_system"],
                raw_value=raw,
                ingested_ts=float(r["ingested_ts"]),
            )
        )
    return out


def _finish_heartbeat(
    store: HistorianHeartbeatStore | None,
    context: HeartbeatContext | None,
    *,
    status: str,
    error_code: str | None = None,
) -> None:
    """Fail open: heartbeat trouble never suppresses historization."""
    if store is None or context is None:
        return
    terminal_context = context
    if error_code is not None:
        terminal_context = HeartbeatContext(
            tenant_id=context.tenant_id,
            deployment_environment=context.deployment_environment,
            software_version=context.software_version,
            detail={**context.detail, "error_code": error_code},
        )
    try:
        store.finish(terminal_context, status=status)
    except Exception:  # noqa: BLE001 - explicitly fail-open evidence writer
        logger.error("HISTORIAN_HEARTBEAT_FINISH_FAILED")


@app.task(name="tasks.historize_runs.historize_runs")
def historize_runs() -> dict:
    """Detect runs, baseline them, and diff each closed run for anomalies."""
    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    neon_url = os.getenv("NEON_DATABASE_URL", "")
    heartbeat_store: HistorianHeartbeatStore | None = None
    heartbeat_context: HeartbeatContext | None = None
    if tenant_id and neon_url:
        try:
            heartbeat_context = build_heartbeat_context()
            heartbeat_store = HistorianHeartbeatStore(
                engine=_engine(neon_url), tenant_id=tenant_id
            )
            heartbeat_store.start(heartbeat_context)
        except ValueError:
            # Invalid deployment identity/configuration cannot fabricate a row.
            logger.error("HISTORIAN_HEARTBEAT_IDENTITY_INVALID")
            heartbeat_context = None
            heartbeat_store = None
        except Exception:  # noqa: BLE001 - heartbeat is fail-open by contract
            logger.error("HISTORIAN_HEARTBEAT_START_FAILED")
            heartbeat_context = None
            heartbeat_store = None

    if not _enabled():
        _finish_heartbeat(heartbeat_store, heartbeat_context, status="disabled")
        return {"status": "disabled"}

    if not tenant_id or not neon_url:
        logger.error("HISTORIAN_MISSING_DB_OR_TENANT")
        return {"status": "error", "error": "missing_config"}

    if heartbeat_context is None:
        return {"status": "error", "error": "missing_config"}

    triggers = parse_run_triggers(os.getenv("MIRA_RUN_TRIGGERS"))
    # Machine memory (state windows + typed A0-A12 anomalies, migration 040)
    # also runs for uns_paths WITHOUT a run trigger: idle/fault windows exist
    # even when no run ever starts. Extra paths via MIRA_MACHINE_MEMORY_UNS_PATHS
    # (comma-separated); same MIRA_RUN_DIFF_ENABLED gate, no new flag (D8).
    extra_uns = [
        p.strip()
        for p in os.getenv("MIRA_MACHINE_MEMORY_UNS_PATHS", "").split(",")
        if p.strip()
    ]
    uns_paths = list(dict.fromkeys(list(triggers.keys()) + extra_uns))
    if not uns_paths:
        _finish_heartbeat(heartbeat_store, heartbeat_context, status="no_triggers")
        return {"status": "no_triggers"}

    try:
        k_sigma = float(os.getenv("MIRA_RUN_K_SIGMA", "3.0"))
        normal_run_count = int(os.getenv("MIRA_BASELINE_NORMAL_RUN_COUNT", "5"))
        min_baseline_runs = int(os.getenv("MIRA_BASELINE_MIN_RUNS", "2"))
        pre_seconds = float(os.getenv("MIRA_SNAPSHOT_PRE_SECONDS", "300"))
        post_seconds = float(os.getenv("MIRA_SNAPSHOT_POST_SECONDS", "300"))
        lookback = float(os.getenv("MIRA_RUN_LOOKBACK_SECONDS", "3600"))
    except ValueError:
        logger.error("HISTORIAN_MISSING_CONFIG")
        _finish_heartbeat(heartbeat_store, heartbeat_context, status="missing_config")
        return {"status": "error", "error": "missing_config"}

    try:
        readings = _read_recent_events(
            neon_url,
            tenant_id,
            uns_paths=uns_paths,
            lookback_seconds=lookback,
        )
        store = NeonRunStore(neon_url)
        summary = {"status": "ok"}
        if triggers:
            summary = run_historization(
                readings,
                store,
                triggers,
                tenant_id=tenant_id,
                k_sigma=k_sigma,
                normal_run_count=normal_run_count,
                min_baseline_runs=min_baseline_runs,
                pre_seconds=pre_seconds,
                post_seconds=post_seconds,
            )

        # Machine memory: state windows + typed anomalies per uns_path.
        # triggers=None — the run layer was already handled above; this pass
        # only derives windows and A0-A12 anomaly diffs (migration 040).
        rows = [
            {
                "event_id": r.event_id,
                "tenant_id": tenant_id,
                "uns_path": r.uns_path,
                "tag_path": r.tag_path,
                "value": r.raw_value if r.raw_value is not None else r.value,
                "value_type": r.value_type,
                "quality": r.quality,
                "event_timestamp": r.event_timestamp,
                "ingested_ts": r.ingested_ts,
            }
            for r in readings
        ]
        # Real wall-clock `now` so the final window's staleness (max_stale_s)
        # grows when the stream stops — A0_OFFLINE can fire instead of the
        # last state being pinned forever.
        batch_now = time.time()
        anomaly_cooldown = float(os.getenv("MIRA_ANOMALY_COOLDOWN_SECONDS", "1800"))
        machine_memory: dict[str, dict] = {}
        for uns_path in uns_paths:
            mm = historize_machine_memory(
                store,
                tenant_id,
                uns_path,
                rows,
                now=batch_now,
                anomaly_cooldown_seconds=anomaly_cooldown,
            )
            machine_memory[uns_path] = {
                "windows_upserted": mm["windows_upserted"],
                "anomaly_diffs_written": mm["anomaly_diffs_written"],
                "anomalies_cooldown_suppressed": mm["anomalies_cooldown_suppressed"],
                "latest_window": mm["latest_window"],
                "unmapped_tags": mm["unmapped_tags"],
            }
        summary["machine_memory"] = machine_memory
    except Exception as exc:  # noqa: BLE001
        logger.error("HISTORIAN_PIPELINE_ERROR")
        _finish_heartbeat(
            heartbeat_store,
            heartbeat_context,
            status="error",
            error_code="HISTORIAN_PIPELINE_ERROR",
        )
        # Existing callers receive their established error shape; evidence and
        # logs remain redacted to the stable code above.
        return {"status": "error", "error": str(exc)}

    logger.info(
        "historize_runs: opened=%d closed=%d anomalous=%d diffs=%d mm_paths=%d",
        summary.get("runs_opened", 0),
        summary.get("runs_closed", 0),
        summary.get("anomalous_runs", 0),
        summary.get("diffs_written", 0),
        len(machine_memory),
    )
    _finish_heartbeat(heartbeat_store, heartbeat_context, status="ok")
    return summary
