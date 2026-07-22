"""Durable job queue for the synthetic flywheel (addendum §12/§23).

A restart-safe SQLite (WAL) queue. Provides the reliability contract the
addendum requires: idempotent enqueue, atomic worker leases (single job claimed
by exactly one worker), lease expiry + recovery, per-stage bounded retries,
dead-letter routing, atomic state transitions recorded in an audit table, and
resume-after-interruption. Concurrency is serialized by ``BEGIN IMMEDIATE`` —
the standard SQLite single-writer claim — so no manual lock is needed.

No network, no agents. A ``clock`` callable (epoch seconds) is injectable so
lease-expiry behavior is deterministic in tests.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import state_machine as sm
from .contracts import JOB_FIELDS, JobRecord

_PENDING = "pending"
_IN_PROGRESS = "in_progress"
_DONE = "done"

_TIME_COLS = ("created_at", "started_at", "finished_at", "lease_expires_at")
_INT_COLS = ("attempt_count", "reconciliation_count")
_COLS = (*JOB_FIELDS, "worker_id", "labels")

# Only one AUTOMATIC reconciliation pass is permitted (§8.5 / review fix 5);
# further rework must be a new linked case revision.
RECONCILIATION_LIMIT = 1


class ReconciliationLimitExceeded(RuntimeError):
    """Raised when a job would enter reconciliation more than once — the case must
    be re-created as a new linked revision instead (review fix 5)."""


class SynthQueue:
    def __init__(self, db_path: str | Path, *, clock: Callable[[], float] | None = None):
        self.db_path = str(db_path)
        self._clock = clock or time.time
        self._conn = sqlite3.connect(self.db_path, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._init_schema()

    def _init_schema(self) -> None:
        cols = ", ".join(
            f"{c} REAL"
            if c in _TIME_COLS
            else f"{c} INTEGER"
            if c in _INT_COLS
            else f"{c} TEXT PRIMARY KEY"
            if c == "job_id"
            else f"{c} TEXT UNIQUE"
            if c == "execution_key"
            else f"{c} TEXT"
            for c in _COLS
        )
        self._conn.execute(f"CREATE TABLE IF NOT EXISTS jobs ({cols})")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS transitions ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, src TEXT, dst TEXT, "
            "worker_id TEXT, at REAL, note TEXT)"
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS ix_jobs_stage_status ON jobs(stage, status)")

    # ── enqueue (idempotent) ────────────────────────────────────────────────
    def enqueue(self, job: JobRecord) -> bool:
        """Insert a new job. Idempotent by ``idempotency_key`` — a duplicate is a
        no-op returning False (§12 idempotent reruns, duplicate suppression)."""
        now = self._clock()
        job.created_at = job.created_at or now
        job.status = _PENDING
        vals = {c: getattr(job, c, None) for c in JOB_FIELDS}
        vals["worker_id"] = None
        vals["labels"] = json.dumps(job.labels or {})
        placeholders = ", ".join("?" for _ in _COLS)
        cur = self._conn.execute(
            f"INSERT OR IGNORE INTO jobs ({', '.join(_COLS)}) VALUES ({placeholders})",
            tuple(vals[c] for c in _COLS),
        )
        if cur.rowcount:
            self._record(job.job_id, None, job.stage, None, "enqueued", now)
            return True
        return False

    # ── atomic lease claim ──────────────────────────────────────────────────
    def claim(
        self, stage: str, worker_id: str, *, lease_seconds: float = 300.0
    ) -> JobRecord | None:
        """Atomically claim one pending job at ``stage`` whose lease is free or
        expired. Exactly one worker wins (BEGIN IMMEDIATE serializes writers).
        Increments the per-stage attempt count and sets the lease."""
        now = self._clock()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            row = self._conn.execute(
                "SELECT job_id FROM jobs WHERE stage=? AND "
                "(status=? OR (status=? AND (lease_expires_at IS NULL OR lease_expires_at < ?))) "
                "ORDER BY created_at LIMIT 1",
                (stage, _PENDING, _IN_PROGRESS, now),
            ).fetchone()
            if row is None:
                self._conn.execute("COMMIT")
                return None
            jid = row["job_id"]
            self._conn.execute(
                "UPDATE jobs SET status=?, worker_id=?, lease_expires_at=?, "
                "started_at=COALESCE(started_at, ?), attempt_count=attempt_count+1 WHERE job_id=?",
                (_IN_PROGRESS, worker_id, now + lease_seconds, now, jid),
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        return self.get(jid)

    # ── validated, recorded transition ──────────────────────────────────────
    def transition(
        self, job_id: str, dst: str, worker_id: str, *, note: str = "", **updates
    ) -> None:
        """Advance a job to ``dst`` (validated against the FSM), reset its
        per-stage attempt count, release the lease, and record the transition.
        Fail-closed on an illegal transition or a lost lease."""
        now = self._clock()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            job = self._get_locked(job_id)
            if job is None:
                raise KeyError(job_id)
            if job["worker_id"] != worker_id:
                raise PermissionError(f"worker {worker_id} does not hold the lease on {job_id}")
            sm.validate_transition(job["stage"], dst)
            terminal = sm.is_terminal(dst)
            recon = job["reconciliation_count"] or 0
            if dst == sm.RECONCILIATION_PENDING:
                # only one automatic reconciliation; a second must be a new
                # linked case revision, not a re-loop (review fix 5).
                if recon >= RECONCILIATION_LIMIT:
                    raise ReconciliationLimitExceeded(
                        f"{job_id} already reconciled {recon} time(s); create a new linked case revision"
                    )
                recon += 1
            fields = {
                "stage": dst,
                "status": _DONE if terminal else _PENDING,
                "attempt_count": 0,
                "reconciliation_count": recon,
                "worker_id": None,
                "lease_expires_at": None,
                "finished_at": now if terminal else job["finished_at"],
                **{k: v for k, v in updates.items() if k in JOB_FIELDS},
            }
            self._apply(job_id, fields)
            self._record(job_id, job["stage"], dst, worker_id, note, now)
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    # ── failure → bounded retry or dead-letter ──────────────────────────────
    def fail(
        self,
        job_id: str,
        worker_id: str,
        *,
        error_code: str,
        error_detail: str = "",
        max_attempts: int = 2,
    ) -> str:
        """Record a stage failure. If the per-stage attempt count has reached
        ``max_attempts`` → DEAD_LETTER; otherwise release the lease for one
        bounded retry (§10.2 'no more than one retry per stage' → max_attempts=2).
        Returns the resulting stage."""
        now = self._clock()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            job = self._get_locked(job_id)
            if job is None:
                raise KeyError(job_id)
            if job["worker_id"] != worker_id:
                raise PermissionError(f"worker {worker_id} does not hold the lease on {job_id}")
            if job["attempt_count"] >= max_attempts:
                sm.validate_transition(job["stage"], sm.DEAD_LETTER)
                self._apply(
                    job_id,
                    {
                        "stage": sm.DEAD_LETTER,
                        "status": _DONE,
                        "worker_id": None,
                        "lease_expires_at": None,
                        "finished_at": now,
                        "error_code": error_code,
                        "error_detail": error_detail,
                    },
                )
                self._record(
                    job_id,
                    job["stage"],
                    sm.DEAD_LETTER,
                    worker_id,
                    f"dead_letter:{error_code}",
                    now,
                )
                result = sm.DEAD_LETTER
            else:
                self._apply(
                    job_id,
                    {
                        "status": _PENDING,
                        "worker_id": None,
                        "lease_expires_at": None,
                        "error_code": error_code,
                        "error_detail": error_detail,
                    },
                )
                self._record(
                    job_id, job["stage"], job["stage"], worker_id, f"retry:{error_code}", now
                )
                result = job["stage"]
            self._conn.execute("COMMIT")
            return result
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    # ── reads / metrics ─────────────────────────────────────────────────────
    def get(self, job_id: str) -> JobRecord | None:
        row = self._conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        return _hydrate(row) if row else None

    def transitions_of(self, job_id: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT src, dst, worker_id, at, note FROM transitions WHERE job_id=? ORDER BY id",
            (job_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def counts(self) -> dict[str, int]:
        rows = self._conn.execute("SELECT stage, COUNT(*) c FROM jobs GROUP BY stage").fetchall()
        out = {r["stage"]: r["c"] for r in rows}
        out["_total"] = sum(out.values())
        out["_dead_letter"] = out.get(sm.DEAD_LETTER, 0)
        return out

    def close(self) -> None:
        self._conn.close()

    # ── internals ───────────────────────────────────────────────────────────
    def _get_locked(self, job_id: str):
        return self._conn.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()

    def _apply(self, job_id: str, fields: dict) -> None:
        sets = ", ".join(f"{k}=?" for k in fields)
        self._conn.execute(f"UPDATE jobs SET {sets} WHERE job_id=?", (*fields.values(), job_id))

    def _record(self, job_id, src, dst, worker_id, note, at) -> None:
        self._conn.execute(
            "INSERT INTO transitions (job_id, src, dst, worker_id, at, note) VALUES (?,?,?,?,?,?)",
            (job_id, src, dst, worker_id, at, note),
        )


def _hydrate(row: sqlite3.Row) -> JobRecord:
    d: dict[str, Any] = dict(row)
    labels = json.loads(d.get("labels") or "{}")
    # index (not .get) so the required-str fields type as Any, not Any | None
    kwargs: dict[str, Any] = {k: d[k] for k in JOB_FIELDS}
    job = JobRecord(**kwargs)
    job.labels = labels
    return job


def new_job_id() -> str:
    return uuid.uuid4().hex
