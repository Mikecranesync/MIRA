"""RunStore boundary: a Protocol + an in-memory impl (tests) + NeonRunStore.

The pure pipeline (``pipeline.run_historization``) talks only to the Protocol,
so the engine is unit-testable with ``InMemoryRunStore`` and no DB.

``NeonRunStore`` mirrors ``mira-relay/tag_diff_logger.py:NeonDiffStore``:
SQLAlchemy with ``NullPool`` and RLS bound via
``SET LOCAL app.current_tenant_id`` inside the SAME transaction as the
statement. The run<->tag_events link is IMPLICIT: a run owns the tag_events
rows in its window with a matching ``uns_path`` (we never alter tag_events).

NOTE — NeonRunStore SQL is NOT exercised against a live Postgres in CI; it is
reviewed structurally and shares the verified NeonDiffStore pattern.
"""

from __future__ import annotations

from typing import Optional, Protocol

from .models import PhaseStats, Reading, Run, RunAnomalyDiff, RunStep


class RunStore(Protocol):
    """Persistence boundary for the run engine."""

    def load_open_runs(self, tenant_id: str) -> dict[str, Run]:
        """Currently-open runs for the tenant, keyed by uns_path."""
        ...

    def insert_run(self, run: Run) -> None:
        """Append a new run (persisted as status='open')."""
        ...

    def insert_step(self, step: RunStep) -> None:
        """Append a run_step."""
        ...

    def close_run(
        self,
        run_id: str,
        *,
        stopped_at: Optional[float],
        duration_seconds: Optional[float],
        status: str,
        tenant_id: str,
    ) -> None:
        """Narrow update: set stopped_at/duration_seconds/status (open->closed)."""
        ...

    def recent_normal_runs(
        self, *, tenant_id: str, uns_path: str, limit: int
    ) -> list[Run]:
        """Most-recent CLOSED (non-anomalous) runs for the equipment."""
        ...

    def readings_for_window(
        self, *, tenant_id: str, uns_path: str, start: float, end: float
    ) -> list[Reading]:
        """tag_events for the equipment within [start, end] (implicit run link)."""
        ...

    def upsert_baseline(
        self, stats: PhaseStats, *, tenant_id: str, uns_path: str
    ) -> None:
        """Insert/update the living baseline aggregate for (tenant, uns, tag, phase)."""
        ...

    def get_baseline(
        self, *, tenant_id: str, uns_path: str
    ) -> dict[tuple[str, str], PhaseStats]:
        """Current baseline for the equipment, keyed by (tag, phase)."""
        ...

    def insert_diffs(
        self, diffs: list[RunAnomalyDiff], *, run_id: str, tenant_id: str
    ) -> int:
        """Append run_diff rows for a run. Returns rows written."""
        ...


# ──────────────────────────────────────────────────────────────────────────
# In-memory store — for tests / pure-core pipeline verification.
# ──────────────────────────────────────────────────────────────────────────


class InMemoryRunStore:
    """A dict-backed RunStore. ``seed_events`` loads the tag_events stand-in."""

    def __init__(self) -> None:
        self.runs: dict[str, Run] = {}
        self.steps: list[RunStep] = []
        self.baselines: dict[tuple[str, str, str, str], PhaseStats] = {}
        self.diffs: list[tuple[str, RunAnomalyDiff]] = []
        self._events: list[Reading] = []

    # test helper — emulates the tag_events the run window owns
    def seed_events(self, readings: list[Reading]) -> None:
        self._events.extend(readings)

    def load_open_runs(self, tenant_id: str) -> dict[str, Run]:
        return {
            r.uns_path: r
            for r in self.runs.values()
            if r.tenant_id == tenant_id and r.status == "open"
        }

    def insert_run(self, run: Run) -> None:
        self.runs[run.run_id] = run

    def insert_step(self, step: RunStep) -> None:
        self.steps.append(step)

    def close_run(
        self,
        run_id: str,
        *,
        stopped_at: Optional[float],
        duration_seconds: Optional[float],
        status: str,
        tenant_id: str,
    ) -> None:
        run = self.runs[run_id]
        # tenant_id is accepted to match NeonRunStore's RLS-scoped signature; the
        # in-memory store is single-tenant per test, so we only sanity-check it.
        assert run.tenant_id == tenant_id
        run.stopped_at = stopped_at
        run.duration_seconds = duration_seconds
        run.status = status

    def recent_normal_runs(
        self, *, tenant_id: str, uns_path: str, limit: int
    ) -> list[Run]:
        runs = [
            r
            for r in self.runs.values()
            if r.tenant_id == tenant_id
            and r.uns_path == uns_path
            and r.status == "closed"
        ]
        runs.sort(key=lambda r: r.started_at, reverse=True)
        return runs[:limit]

    def readings_for_window(
        self, *, tenant_id: str, uns_path: str, start: float, end: float
    ) -> list[Reading]:
        return [
            r
            for r in self._events
            if r.uns_path == uns_path and start <= r.event_timestamp <= end
        ]

    def upsert_baseline(
        self, stats: PhaseStats, *, tenant_id: str, uns_path: str
    ) -> None:
        key = (tenant_id, uns_path, stats.tag_path, stats.phase_name)
        self.baselines[key] = stats

    def get_baseline(
        self, *, tenant_id: str, uns_path: str
    ) -> dict[tuple[str, str], PhaseStats]:
        return {
            (tag, phase): stats
            for (t, u, tag, phase), stats in self.baselines.items()
            if t == tenant_id and u == uns_path
        }

    def insert_diffs(
        self, diffs: list[RunAnomalyDiff], *, run_id: str, tenant_id: str
    ) -> int:
        # tenant_id mirrors NeonRunStore's RLS-scoped signature; ignored here.
        for d in diffs:
            self.diffs.append((run_id, d))
        return len(diffs)


# ──────────────────────────────────────────────────────────────────────────
# NeonRunStore — prod persistence (SQLAlchemy NullPool + RLS). NOT DB-verified
# in CI. Mirrors NeonDiffStore's connection + SET LOCAL pattern.
# ──────────────────────────────────────────────────────────────────────────


class NeonRunStore:
    """Writes machine_run / run_step / run_baseline / run_diff to NeonDB (Hub
    schema) and reads run windows from tag_events by uns_path + time."""

    def __init__(self, neon_url: str) -> None:
        self.neon_url = neon_url

    def _engine(self):
        from sqlalchemy import NullPool, create_engine

        return create_engine(
            self.neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    def load_open_runs(self, tenant_id: str) -> dict[str, Run]:
        from sqlalchemy import text

        with self._engine().connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            rows = (
                conn.execute(
                    text(
                        """
                        SELECT run_id::text, uns_path::text, run_trigger_tag,
                               run_trigger_threshold,
                               extract(epoch FROM started_at) AS started_at,
                               status
                          FROM machine_run
                         WHERE tenant_id = :tid AND status = 'open'
                        """
                    ),
                    {"tid": tenant_id},
                )
                .mappings()
                .all()
            )
        return {
            r["uns_path"]: Run(
                run_id=r["run_id"],
                tenant_id=tenant_id,
                uns_path=r["uns_path"],
                run_trigger_tag=r["run_trigger_tag"],
                run_trigger_threshold=float(r["run_trigger_threshold"] or 0.0),
                started_at=float(r["started_at"]),
                status="open",
            )
            for r in rows
        }

    def insert_run(self, run: Run) -> None:
        import json

        from sqlalchemy import text

        with self._engine().begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": run.tenant_id},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO machine_run
                        (run_id, tenant_id, equipment_id, uns_path,
                         started_at, status, run_trigger_tag,
                         run_trigger_threshold, metadata)
                    VALUES
                        (CAST(:run_id AS UUID), :tenant_id,
                         CAST(:equipment_id AS UUID), CAST(:uns_path AS LTREE),
                         to_timestamp(:started_at), 'open', :run_trigger_tag,
                         :run_trigger_threshold, CAST(:metadata AS JSONB))
                    """
                ),
                {
                    "run_id": run.run_id,
                    "tenant_id": run.tenant_id,
                    "equipment_id": run.equipment_id,
                    "uns_path": run.uns_path,
                    "started_at": run.started_at,
                    "run_trigger_tag": run.run_trigger_tag,
                    "run_trigger_threshold": run.run_trigger_threshold,
                    "metadata": json.dumps(run.metadata),
                },
            )

    def insert_step(self, step: RunStep) -> None:
        import json

        from sqlalchemy import text

        with self._engine().begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"),
                {"tid": step.tenant_id},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO run_step
                        (run_id, tenant_id, phase_name, phase_index,
                         started_at, metadata)
                    VALUES
                        (CAST(:run_id AS UUID), :tenant_id, :phase_name,
                         :phase_index, to_timestamp(:started_at),
                         CAST(:metadata AS JSONB))
                    """
                ),
                {
                    "run_id": step.run_id,
                    "tenant_id": step.tenant_id,
                    "phase_name": step.phase_name,
                    "phase_index": step.phase_index,
                    "started_at": step.started_at,
                    "metadata": json.dumps(step.metadata),
                },
            )

    def close_run(
        self,
        run_id: str,
        *,
        stopped_at: Optional[float],
        duration_seconds: Optional[float],
        status: str,
        tenant_id: str,
    ) -> None:
        from sqlalchemy import text

        with self._engine().begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            conn.execute(
                text(
                    """
                    UPDATE machine_run
                       SET stopped_at = to_timestamp(:stopped_at),
                           duration_seconds = :duration_seconds,
                           status = :status
                     WHERE run_id = CAST(:run_id AS UUID)
                    """
                ),
                {
                    "run_id": run_id,
                    "stopped_at": stopped_at,
                    "duration_seconds": duration_seconds,
                    "status": status,
                },
            )
            # Close the matching default step (narrow update).
            conn.execute(
                text(
                    """
                    UPDATE run_step
                       SET ended_at = to_timestamp(:stopped_at),
                           duration_seconds = :duration_seconds
                     WHERE run_id = CAST(:run_id AS UUID)
                    """
                ),
                {
                    "run_id": run_id,
                    "stopped_at": stopped_at,
                    "duration_seconds": duration_seconds,
                },
            )

    def recent_normal_runs(
        self, *, tenant_id: str, uns_path: str, limit: int
    ) -> list[Run]:
        from sqlalchemy import text

        with self._engine().connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            rows = (
                conn.execute(
                    text(
                        """
                        SELECT run_id::text, uns_path::text, run_trigger_tag,
                               run_trigger_threshold,
                               extract(epoch FROM started_at) AS started_at,
                               extract(epoch FROM stopped_at) AS stopped_at
                          FROM machine_run
                         WHERE tenant_id = :tid AND uns_path = CAST(:uns AS LTREE)
                           AND status = 'closed'
                         ORDER BY started_at DESC
                         LIMIT :lim
                        """
                    ),
                    {"tid": tenant_id, "uns": uns_path, "lim": limit},
                )
                .mappings()
                .all()
            )
        return [
            Run(
                run_id=r["run_id"],
                tenant_id=tenant_id,
                uns_path=r["uns_path"],
                run_trigger_tag=r["run_trigger_tag"],
                run_trigger_threshold=float(r["run_trigger_threshold"] or 0.0),
                started_at=float(r["started_at"]),
                stopped_at=float(r["stopped_at"]) if r["stopped_at"] else None,
                status="closed",
            )
            for r in rows
        ]

    def readings_for_window(
        self, *, tenant_id: str, uns_path: str, start: float, end: float
    ) -> list[Reading]:
        from sqlalchemy import text

        with self._engine().connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            rows = (
                conn.execute(
                    text(
                        """
                        SELECT tag_path, value, value_type, quality,
                               uns_path::text AS uns_path,
                               event_id::text AS event_id, simulated,
                               source_system,
                               extract(epoch FROM event_timestamp) AS ts
                          FROM tag_events
                         WHERE tenant_id = :tid
                           AND uns_path = CAST(:uns AS LTREE)
                           AND event_timestamp >= to_timestamp(:start)
                           AND event_timestamp <= to_timestamp(:end)
                         ORDER BY event_timestamp ASC
                        """
                    ),
                    {"tid": tenant_id, "uns": uns_path, "start": start, "end": end},
                )
                .mappings()
                .all()
            )

        out: list[Reading] = []
        for r in rows:
            raw = r["value"]
            try:
                numeric: Optional[float] = float(raw) if raw is not None else None
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
                )
            )
        return out

    def upsert_baseline(
        self, stats: PhaseStats, *, tenant_id: str, uns_path: str
    ) -> None:
        from sqlalchemy import text

        with self._engine().begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            conn.execute(
                text(
                    """
                    INSERT INTO run_baseline
                        (tenant_id, uns_path, tag_path, phase_name,
                         min, max, avg, stddev, sample_count, k_sigma)
                    VALUES
                        (:tenant_id, CAST(:uns_path AS LTREE), :tag_path,
                         :phase_name, :min, :max, :avg, :stddev,
                         :sample_count, :k_sigma)
                    ON CONFLICT (tenant_id, uns_path, tag_path, phase_name)
                    DO UPDATE SET
                        min = EXCLUDED.min,
                        max = EXCLUDED.max,
                        avg = EXCLUDED.avg,
                        stddev = EXCLUDED.stddev,
                        sample_count = EXCLUDED.sample_count,
                        k_sigma = EXCLUDED.k_sigma,
                        updated_at = NOW()
                    """
                ),
                {
                    "tenant_id": tenant_id,
                    "uns_path": uns_path,
                    "tag_path": stats.tag_path,
                    "phase_name": stats.phase_name,
                    "min": stats.min,
                    "max": stats.max,
                    "avg": stats.avg,
                    "stddev": stats.stddev,
                    "sample_count": stats.sample_count,
                    "k_sigma": stats.k_sigma,
                },
            )

    def get_baseline(
        self, *, tenant_id: str, uns_path: str
    ) -> dict[tuple[str, str], PhaseStats]:
        from sqlalchemy import text

        with self._engine().connect() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            rows = (
                conn.execute(
                    text(
                        """
                        SELECT tag_path, phase_name, min, max, avg, stddev,
                               sample_count, k_sigma
                          FROM run_baseline
                         WHERE tenant_id = :tid AND uns_path = CAST(:uns AS LTREE)
                        """
                    ),
                    {"tid": tenant_id, "uns": uns_path},
                )
                .mappings()
                .all()
            )
        return {
            (r["tag_path"], r["phase_name"]): PhaseStats(
                tag_path=r["tag_path"],
                phase_name=r["phase_name"],
                min=float(r["min"]),
                max=float(r["max"]),
                avg=float(r["avg"]),
                stddev=float(r["stddev"]),
                sample_count=int(r["sample_count"]),
                k_sigma=float(r["k_sigma"]),
            )
            for r in rows
        }

    def insert_diffs(
        self, diffs: list[RunAnomalyDiff], *, run_id: str, tenant_id: str
    ) -> int:
        if not diffs:
            return 0
        import json

        from sqlalchemy import text

        params = [
            {
                "run_id": run_id,
                "tid": tenant_id,
                "tag_path": d.tag_path,
                "phase_name": d.phase_name,
                "uns_path": d.uns_path,
                "observed": d.observed,
                "baseline": d.baseline,
                "delta": d.delta,
                "delta_percent": d.delta_percent,
                "severity": d.severity,
                "event_timestamp": d.event_timestamp,
                "metadata": json.dumps(d.metadata),
            }
            for d in diffs
        ]
        with self._engine().begin() as conn:
            conn.execute(
                text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id}
            )
            conn.execute(
                text(
                    """
                    INSERT INTO run_diff
                        (run_id, tenant_id, tag_path, phase_name, uns_path,
                         observed, baseline, delta, delta_percent, severity,
                         event_timestamp, metadata)
                    VALUES
                        (CAST(:run_id AS UUID), CAST(:tid AS UUID), :tag_path,
                         :phase_name, CAST(:uns_path AS LTREE),
                         :observed, :baseline, :delta, :delta_percent,
                         :severity, to_timestamp(:event_timestamp),
                         CAST(:metadata AS JSONB))
                    """
                ),
                params,
            )
        return len(diffs)
