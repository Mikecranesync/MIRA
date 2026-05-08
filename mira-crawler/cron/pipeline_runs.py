"""pipeline_runs — DB helper for KB ingest observability.

Each cron invocation opens a row before any work, updates it on completion.
No silent runs. See docs/specs/kb-ingest-hardening-spec.md §4.2.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

try:
    import psycopg2
    _HAVE_PG = True
except ImportError:
    _HAVE_PG = False


def _git_sha() -> str:
    """Return short git SHA of the current pipeline. 'unknown' if not in a repo."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
        return out or "unknown"
    except Exception:
        return os.getenv("PIPELINE_VERSION", "unknown")


_PIPELINE_VERSION = _git_sha()


@dataclass
class PipelineRun:
    """One row in pipeline_runs. Mutable until close()."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str = "mike"
    pdf_url: str = ""
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    doc_type: Optional[str] = None
    status: str = "pending"
    step_failed: Optional[str] = None
    chunks_created: int = 0
    bytes_downloaded: Optional[int] = None
    error: Optional[str] = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    pipeline_version: str = _PIPELINE_VERSION
    metadata: dict[str, Any] = field(default_factory=dict)


def _conn_string() -> Optional[str]:
    return os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")


def _connect():
    if not _HAVE_PG:
        return None
    url = _conn_string()
    if not url:
        return None
    try:
        return psycopg2.connect(url, connect_timeout=10, sslmode="require")
    except Exception:
        return None


def open_run(
    pdf_url: str,
    manufacturer: Optional[str] = None,
    model: Optional[str] = None,
    doc_type: Optional[str] = None,
    tenant_id: str = "mike",
) -> PipelineRun:
    """Insert a row in `running` state. Always returns a PipelineRun (DB-down safe)."""
    run = PipelineRun(
        tenant_id=tenant_id,
        pdf_url=pdf_url,
        manufacturer=manufacturer,
        model=model,
        doc_type=doc_type,
        status="running",
    )
    conn = _connect()
    if conn is None:
        return run
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_runs
                    (id, tenant_id, pdf_url, manufacturer, model, doc_type,
                     status, started_at, pipeline_version, metadata)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run.id, run.tenant_id, run.pdf_url, run.manufacturer,
                    run.model, run.doc_type, run.status, run.started_at,
                    run.pipeline_version, json.dumps(run.metadata),
                ),
            )
    except Exception:
        # DB unreachable — caller still gets a local run object so logs are coherent.
        pass
    finally:
        conn.close()
    return run


def close_run(
    run: PipelineRun,
    status: str,
    chunks_created: int = 0,
    step_failed: Optional[str] = None,
    error: Optional[str] = None,
    bytes_downloaded: Optional[int] = None,
    metadata_extra: Optional[dict[str, Any]] = None,
) -> None:
    """Finalize a run row. Truncates error to 500 chars per the spec."""
    run.status = status
    run.chunks_created = chunks_created
    run.step_failed = step_failed
    run.error = (error or "")[:500] if error else None
    run.bytes_downloaded = bytes_downloaded
    run.completed_at = datetime.now(timezone.utc)
    run.duration_ms = int(
        (run.completed_at - run.started_at).total_seconds() * 1000
    )
    if metadata_extra:
        run.metadata.update(metadata_extra)

    conn = _connect()
    if conn is None:
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE pipeline_runs
                SET status = %s,
                    step_failed = %s,
                    chunks_created = %s,
                    bytes_downloaded = %s,
                    error = %s,
                    completed_at = %s,
                    duration_ms = %s,
                    metadata = %s
                WHERE id = %s
                """,
                (
                    run.status, run.step_failed, run.chunks_created,
                    run.bytes_downloaded, run.error, run.completed_at,
                    run.duration_ms, json.dumps(run.metadata), run.id,
                ),
            )
    except Exception:
        pass
    finally:
        conn.close()


def reap_stuck_runs(max_age_minutes: int = 30) -> int:
    """Mark runs stuck in `running` for >max_age_minutes as `failed`.
    Called from preflight on cron startup. Returns count reaped.
    """
    conn = _connect()
    if conn is None:
        return 0
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE pipeline_runs
                SET status = 'failed',
                    step_failed = COALESCE(step_failed, 'reaped'),
                    error = COALESCE(error, 'reaped: stuck in running >' || %s::text || ' min'),
                    completed_at = now(),
                    duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000
                WHERE status = 'running'
                  AND started_at < now() - (%s || ' minutes')::interval
                RETURNING id
                """,
                (max_age_minutes, max_age_minutes),
            )
            return cur.rowcount
    except Exception:
        return 0
    finally:
        conn.close()


@contextmanager
def tracked_run(
    pdf_url: str,
    manufacturer: Optional[str] = None,
    model: Optional[str] = None,
    doc_type: Optional[str] = None,
    tenant_id: str = "mike",
) -> Generator[PipelineRun, None, None]:
    """Context manager: opens a run, marks it failed on exception, ok on clean exit.

    Caller is expected to set run.chunks_created / run.bytes_downloaded /
    run.step_failed before yielding back — see kb_growth_cron.py for usage.
    """
    run = open_run(pdf_url, manufacturer, model, doc_type, tenant_id)
    try:
        yield run
    except Exception as exc:
        close_run(
            run,
            status="failed",
            step_failed=run.step_failed or "unknown",
            error=str(exc),
        )
        raise
    else:
        # Caller sets status via run.status before exiting normally.
        if run.status in ("running", "pending"):
            run.status = "ok"
        close_run(
            run,
            status=run.status,
            chunks_created=run.chunks_created,
            step_failed=run.step_failed,
            error=run.error,
            bytes_downloaded=run.bytes_downloaded,
            metadata_extra=run.metadata,
        )
