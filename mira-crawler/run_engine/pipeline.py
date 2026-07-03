"""run_historization — orchestrate segment -> persist -> baseline -> diff.

Pure: depends only on a RunStore (any impl). The Celery wrapper
(``tasks/historize_runs.py``) supplies a NeonRunStore + reads recent
tag_events; tests supply an InMemoryRunStore. No DB/Redis/Celery imported here.

Evidence window: a run's observed readings (and each normal run's readings used
for the baseline) are taken from ``[started_at - pre, stopped_at + post]`` with
matching uns_path — the IMPLICIT run<->tag_events link.

Baseline ordering note: the current run is inserted as status='open' BEFORE the
baseline is computed, so ``recent_normal_runs`` (which selects status='closed')
never includes the run being scored. The run is then closed with its final
status ('closed' or 'anomalous').
"""

from __future__ import annotations

from typing import Callable, Optional

from .baseline import compute_baseline
from .diff import compute_run_diff, run_status_from_diffs
from .models import Run, RunStep, RunTrigger
from .segmentation import segment_runs
from .store import RunStore


def _window(run: Run, pre: float, post: float) -> tuple[float, float]:
    start = run.started_at - pre
    end = (run.stopped_at if run.stopped_at is not None else run.started_at) + post
    return start, end


def run_historization(
    readings: list,
    store: RunStore,
    triggers: dict[str, RunTrigger],
    *,
    tenant_id: str,
    k_sigma: float = 3.0,
    normal_run_count: int = 5,
    min_baseline_runs: int = 2,
    pre_seconds: float = 300.0,
    post_seconds: float = 300.0,
    run_id_factory: Optional[Callable[[], str]] = None,
) -> dict:
    """Run the full pipeline for one batch of readings. Returns a summary dict."""
    prior_open = store.load_open_runs(tenant_id)
    persisted_ids = {r.run_id for r in prior_open.values()}

    closed, open_runs = segment_runs(
        readings,
        triggers,
        tenant_id=tenant_id,
        prior_open=prior_open,
        run_id_factory=run_id_factory,
    )

    runs_opened = 0
    runs_closed = 0
    diffs_written = 0
    anomalous_runs = 0

    # Persist newly-opened runs that remain open at the end of the batch.
    for uns_path, run in open_runs.items():
        if run.run_id in persisted_ids:
            continue
        run.status = "open"
        store.insert_run(run)
        store.insert_step(
            RunStep(
                run_id=run.run_id,
                tenant_id=tenant_id,
                phase_name="default",
                phase_index=0,
                started_at=run.started_at,
            )
        )
        runs_opened += 1

    # Process runs that closed in this batch.
    for run in closed:
        if run.run_id not in persisted_ids:
            # Insert as OPEN first so the baseline query excludes this run.
            run.status = "open"
            store.insert_run(run)
            store.insert_step(
                RunStep(
                    run_id=run.run_id,
                    tenant_id=tenant_id,
                    phase_name="default",
                    phase_index=0,
                    started_at=run.started_at,
                )
            )
            runs_opened += 1

        # Observed readings for this run's evidence window.
        start, end = _window(run, pre_seconds, post_seconds)
        observed = store.readings_for_window(
            tenant_id=tenant_id, uns_path=run.uns_path, start=start, end=end
        )

        # Baseline from prior NORMAL (closed) runs.
        normal_runs = store.recent_normal_runs(
            tenant_id=tenant_id, uns_path=run.uns_path, limit=normal_run_count
        )
        # A baseline needs >= min_baseline_runs samples to have meaningful
        # variance — diffing against a single prior run (stddev == 0) would flag
        # every deviation as critical. We still build/refresh the living
        # aggregate from whatever normal runs exist, but only SCORE a run once
        # the baseline has enough samples.
        baseline: dict = {}
        if normal_runs:
            normal_readings = []
            for nr in normal_runs:
                ns, ne = _window(nr, pre_seconds, post_seconds)
                normal_readings.append(
                    store.readings_for_window(
                        tenant_id=tenant_id, uns_path=nr.uns_path, start=ns, end=ne
                    )
                )
            baseline = compute_baseline(normal_readings, k_sigma=k_sigma)
            for stats in baseline.values():
                store.upsert_baseline(stats, tenant_id=tenant_id, uns_path=run.uns_path)

        diffs = []
        if baseline and len(normal_runs) >= min_baseline_runs:
            diffs = compute_run_diff(
                observed,
                baseline,
                k_sigma=k_sigma,
                uns_path=run.uns_path,
                event_timestamp=run.stopped_at,
            )

        status = run_status_from_diffs(diffs) if diffs else "closed"
        store.close_run(
            run.run_id,
            stopped_at=run.stopped_at,
            duration_seconds=run.duration_seconds,
            status=status,
            tenant_id=tenant_id,
        )
        if diffs:
            diffs_written += store.insert_diffs(
                diffs, run_id=run.run_id, tenant_id=tenant_id
            )
        if status == "anomalous":
            anomalous_runs += 1
        runs_closed += 1

    return {
        "status": "ok",
        "runs_opened": runs_opened,
        "runs_closed": runs_closed,
        "runs_still_open": len(open_runs),
        "diffs_written": diffs_written,
        "anomalous_runs": anomalous_runs,
    }
