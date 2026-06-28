"""Acceptance test (issue #2341): full run-diff pipeline via the in-memory store.

NO DB / Redis / Celery. A fixture event stream with 2 normal runs + 1 anomalous
run must yield: 3 runs persisted, one run_step per run, a baseline, and an
anomalous run carrying a critical run_diff.
"""

from __future__ import annotations

from run_engine.models import Reading, RunTrigger
from run_engine.pipeline import run_historization
from run_engine.store import InMemoryRunStore

TENANT = "11111111-1111-1111-1111-111111111111"
UNS = "demo.cell1.conveyor.cv101"


def _run_readings(base_ts, motor_current):
    """One run: vfd_freq rises (trigger) and falls; motor_current during run.

    vfd_freq shape is identical across runs (so its mean is constant -> info);
    motor_current is the anomaly signal.
    """
    return [
        Reading("vfd_freq", 0.0, float(base_ts + 0), uns_path=UNS),
        Reading("vfd_freq", 50.0, float(base_ts + 1), uns_path=UNS),   # rising -> open
        Reading("motor_current", motor_current, float(base_ts + 1), uns_path=UNS),
        Reading("vfd_freq", 50.0, float(base_ts + 2), uns_path=UNS),
        Reading("motor_current", motor_current, float(base_ts + 2), uns_path=UNS),
        Reading("vfd_freq", 0.0, float(base_ts + 3), uns_path=UNS),    # falling -> close
    ]


def _build_stream():
    readings = []
    readings += _run_readings(1000, motor_current=10.0)   # normal
    readings += _run_readings(20000, motor_current=12.0)  # normal
    readings += _run_readings(40000, motor_current=80.0)  # ANOMALOUS
    return readings


def test_full_pipeline_detects_anomalous_run():
    readings = _build_stream()
    store = InMemoryRunStore()
    store.seed_events(readings)
    triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}

    summary = run_historization(
        readings,
        store,
        triggers,
        tenant_id=TENANT,
        k_sigma=3.0,
        normal_run_count=5,
        pre_seconds=300.0,
        post_seconds=300.0,
    )

    # 3 runs detected + persisted, one run_step each.
    assert len(store.runs) == 3
    assert len(store.steps) == 3
    assert summary["runs_closed"] == 3

    runs_by_start = sorted(store.runs.values(), key=lambda r: r.started_at)
    normal_a, normal_b, anomalous = runs_by_start

    assert normal_a.status == "closed"
    assert normal_b.status == "closed"
    assert anomalous.status == "anomalous"
    assert summary["anomalous_runs"] == 1

    # A baseline exists for the monitored tags.
    baseline = store.get_baseline(tenant_id=TENANT, uns_path=UNS)
    assert ("motor_current", "default") in baseline

    # The anomalous run produced a critical run_diff for motor_current.
    assert summary["diffs_written"] >= 1
    anomalous_diffs = [d for (rid, d) in store.diffs if rid == anomalous.run_id]
    assert any(
        d.tag_path == "motor_current" and d.severity == "critical"
        for d in anomalous_diffs
    )


def test_disabled_path_is_noop_via_no_triggers():
    """Empty trigger set => no runs, no diffs (defensive: pipeline does nothing)."""
    store = InMemoryRunStore()
    summary = run_historization(
        [], store, {}, tenant_id=TENANT, k_sigma=3.0
    )
    assert summary["runs_closed"] == 0
    assert len(store.runs) == 0
