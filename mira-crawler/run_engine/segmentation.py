"""Run segmentation — detect runs from a config-driven trigger tag.

Stateless: the caller carries ``prior_open`` (the currently-open runs, keyed by
uns_path) across batches so a long stream can be processed batch-by-batch.

A run is OPEN on the rising edge of ``trigger.tag_path`` (numeric value crosses
ABOVE ``trigger.threshold``) and CLOSED on the falling edge (value at/below the
threshold). One trigger per uns_path (v1).
"""

from __future__ import annotations

import uuid
from typing import Callable, Optional

from .models import Reading, Run, RunTrigger


def _default_run_id() -> str:
    return str(uuid.uuid4())


def segment_runs(
    readings: list[Reading],
    triggers: dict[str, RunTrigger],
    *,
    tenant_id: str,
    prior_open: Optional[dict[str, Run]] = None,
    run_id_factory: Optional[Callable[[], str]] = None,
) -> tuple[list[Run], dict[str, Run]]:
    """Segment ``readings`` into runs per the trigger config.

    Returns ``(closed_runs, open_runs)``:
      - ``closed_runs``: runs that started and stopped (status='closed').
      - ``open_runs``: ``{uns_path: Run}`` still running at the end of the batch
        (status='open'); pass this as ``prior_open`` into the next batch.
    """
    mint = run_id_factory or _default_run_id
    open_runs: dict[str, Run] = dict(prior_open or {})
    closed: list[Run] = []

    for uns_path, trig in triggers.items():
        series = sorted(
            (
                r
                for r in readings
                if r.uns_path == uns_path
                and r.tag_path == trig.tag_path
                and r.value is not None
            ),
            key=lambda r: r.event_timestamp,
        )
        for r in series:
            running = r.value > trig.threshold  # type: ignore[operator]
            current = open_runs.get(uns_path)
            if running and current is None:
                open_runs[uns_path] = Run(
                    run_id=mint(),
                    tenant_id=tenant_id,
                    uns_path=uns_path,
                    run_trigger_tag=trig.tag_path,
                    run_trigger_threshold=trig.threshold,
                    started_at=r.event_timestamp,
                    status="open",
                )
            elif not running and current is not None:
                current.stopped_at = r.event_timestamp
                current.duration_seconds = r.event_timestamp - current.started_at
                current.status = "closed"
                closed.append(current)
                del open_runs[uns_path]

    return closed, open_runs
