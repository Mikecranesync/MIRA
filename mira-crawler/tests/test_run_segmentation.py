"""Tests for run_engine.segmentation — run detection from a trigger tag.

All tests run offline — no DB, no Redis, no Celery. The segmenter is a pure,
stateless function: the caller carries the prior-open runs across batches.
"""

from __future__ import annotations

from run_engine.models import Reading, RunTrigger
from run_engine.segmentation import segment_runs

TENANT = "11111111-1111-1111-1111-111111111111"
UNS = "demo.cell1.conveyor.cv101"


def _r(value, ts, tag="vfd_freq", uns=UNS):
    return Reading(tag_path=tag, value=value, event_timestamp=float(ts), uns_path=uns)


def _counter_factory():
    """Deterministic run-id factory so tests can assert without UUID noise."""
    seq = {"n": 0}

    def _next():
        seq["n"] += 1
        return f"run-{seq['n']}"

    return _next


class TestSingleRun:
    def test_rise_then_fall_yields_one_closed_run(self):
        """vfd_freq 0 -> 0.2 -> 0.5 -> 0.1 -> 0 (threshold 0.1) = one run."""
        triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}
        readings = [
            _r(0.0, 1),
            _r(0.2, 2),  # rising edge -> open
            _r(0.5, 3),
            _r(0.1, 4),  # 0.1 is NOT > 0.1 -> falling edge -> close
            _r(0.0, 5),
        ]
        closed, open_runs = segment_runs(
            readings, triggers, tenant_id=TENANT, run_id_factory=_counter_factory()
        )
        assert len(closed) == 1
        assert open_runs == {}
        run = closed[0]
        assert run.started_at == 2.0
        assert run.stopped_at == 4.0
        assert run.duration_seconds == 2.0
        assert run.status == "closed"
        assert run.uns_path == UNS
        assert run.run_trigger_tag == "vfd_freq"
        assert run.tenant_id == TENANT

    def test_no_trigger_crossing_yields_no_runs(self):
        triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}
        readings = [_r(0.0, 1), _r(0.05, 2), _r(0.0, 3)]
        closed, open_runs = segment_runs(readings, triggers, tenant_id=TENANT)
        assert closed == []
        assert open_runs == {}


class TestOpenRunCarry:
    def test_run_left_open_is_returned_as_open(self):
        triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}
        readings = [_r(0.0, 1), _r(0.5, 2), _r(0.5, 3)]  # never falls
        closed, open_runs = segment_runs(
            readings, triggers, tenant_id=TENANT, run_id_factory=_counter_factory()
        )
        assert closed == []
        assert UNS in open_runs
        assert open_runs[UNS].started_at == 2.0
        assert open_runs[UNS].status == "open"

    def test_prior_open_closes_in_next_batch(self):
        triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}
        f = _counter_factory()
        _, open_runs = segment_runs(
            [_r(0.0, 1), _r(0.5, 2)], triggers, tenant_id=TENANT, run_id_factory=f
        )
        assert UNS in open_runs
        run_id = open_runs[UNS].run_id

        closed, open2 = segment_runs(
            [_r(0.5, 3), _r(0.0, 4)],
            triggers,
            tenant_id=TENANT,
            prior_open=open_runs,
            run_id_factory=f,
        )
        assert len(closed) == 1
        assert open2 == {}
        assert closed[0].run_id == run_id  # same run, closed across batches
        assert closed[0].started_at == 2.0
        assert closed[0].stopped_at == 4.0


class TestMultipleRuns:
    def test_two_separate_runs(self):
        triggers = {UNS: RunTrigger(tag_path="vfd_freq", threshold=0.1)}
        readings = [
            _r(0.0, 1), _r(0.5, 2), _r(0.0, 3),   # run A: 2->3
            _r(0.0, 10), _r(0.5, 11), _r(0.0, 12),  # run B: 11->12
        ]
        closed, open_runs = segment_runs(
            readings, triggers, tenant_id=TENANT, run_id_factory=_counter_factory()
        )
        assert len(closed) == 2
        starts = sorted(r.started_at for r in closed)
        assert starts == [2.0, 11.0]
        assert open_runs == {}
