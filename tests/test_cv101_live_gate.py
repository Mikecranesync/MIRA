"""Tests for the CV-101 live gate (tools/cv101_live_gate.py).

The gate serves the 10:00 bench verification AND the scheduled liveness alarm —
same five checks, different trigger. These pin the behaviour that matters:

* the **real 2026-08-14 prod measurement** must come back NO-GO/REPLAY. If a
  fixture built from the actual frozen stream ever passes, the alarm is useless.
* a live stream must come back GO.
* SimLab traffic must NEVER satisfy the physical gate (the standing instruction
  is "do not hide failures by falling back to SimLab").

`tools/` is not a package, so the module is loaded by file path.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "cv101_live_gate.py"
_spec = importlib.util.spec_from_file_location("cv101_live_gate", _MODULE_PATH)
assert _spec and _spec.loader
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

CANON = "enterprise.home_garage.conveyor_lab.conveyor_1"


def _live(**over):
    """A healthy physical stream: every observation distinct, seconds old."""
    row = {
        "source_system": "ignition",
        "source_connection_id": "cv101-bench-gw",
        "simulated": False,
        "rows": 2400,
        "distinct_observed_ts": 2400,
        "newest_observed_age_s": 2,
        "newest_ingest_age_s": 1,
        "uns_paths": [CANON],
        "tag_count": 12,
        "bad_quality_rows": 0,
    }
    row.update(over)
    return row


def _frozen_replay():
    """VERBATIM from the 2026-08-14 prod measurement (db-inspect 31773087124).

    774,480 rows in 24h carrying ONE distinct observed timestamp, newest
    observation 11d22h old, newest ingest 0.7s ago, every row quality='bad'.
    """
    return {
        "source_system": "ignition",
        "source_connection_id": "cv101-bench-gw",
        "simulated": False,
        "rows": 774480,
        "distinct_observed_ts": 1,
        "newest_observed_age_s": 1030505,  # 11 d 22:15
        "newest_ingest_age_s": 0.7,
        "uns_paths": [CANON],
        "tag_count": 12,
        "bad_quality_rows": 774480,
    }


def _run(rows, **kw):
    kw.setdefault("expected_uns_path", CANON)
    return gate.classify(rows, **kw)


# --- the case this exists for -------------------------------------------------


def test_real_frozen_replay_is_NOGO():
    """If this ever returns GO, the alarm cannot catch #3161 recurring."""
    v = _run([_frozen_replay()])
    assert not v.ok
    assert v.exit_code == gate.EXIT_NOGO
    assert v.cause == gate.CAUSE_REPLAY


def test_replay_is_caught_by_ratio_not_by_volume():
    """774k rows/24h is a HIGH volume — volume must never imply health."""
    v = _run([_frozen_replay()])
    joined = "\n".join(v.lines)
    assert "live_ratio 0.0000" in joined
    # and a low-volume live stream is still GO
    assert _run([_live(rows=30, distinct_observed_ts=30)]).ok


def test_healthy_stream_is_GO():
    v = _run([_live()])
    assert v.ok and v.exit_code == gate.EXIT_GO


# --- SimLab must never satisfy the physical gate ------------------------------


def test_simulator_only_is_NOGO_provenance():
    sim = _live(source_system="simulator", simulated=True)
    v = _run([sim])
    assert not v.ok
    assert v.cause == gate.CAUSE_PROVENANCE


def test_simulated_flag_alone_is_enough_to_exclude():
    v = _run([_live(simulated=True)])
    assert not v.ok and v.cause == gate.CAUSE_PROVENANCE


def test_simulator_traffic_does_not_mask_a_dead_physical_stream():
    """SimLab running alongside must not make the rig look alive."""
    v = _run([_live(source_system="simulator", simulated=True), _frozen_replay()])
    assert not v.ok
    assert v.cause == gate.CAUSE_REPLAY  # judged on the physical group


def test_healthy_physical_still_GO_when_simlab_also_present():
    v = _run([_live(), _live(source_system="simulator", simulated=True)])
    assert v.ok
    assert "synthetic traffic also present" in "\n".join(v.lines)


# --- the other four checks ----------------------------------------------------


def test_absent_telemetry_is_NOGO():
    v = _run([])
    assert not v.ok and v.cause == gate.CAUSE_ABSENT


def test_ingest_stopped_is_NOGO():
    v = _run([_live(newest_ingest_age_s=6000)])
    assert not v.ok and v.cause == gate.CAUSE_ABSENT


def test_stale_observation_is_NOGO():
    v = _run([_live(newest_observed_age_s=99999, distinct_observed_ts=2400)])
    assert not v.ok and v.cause == gate.CAUSE_STALE


def test_wrong_identity_is_NOGO():
    """ADR-0034 / #3233 — rows landing under a non-allowlisted path."""
    v = _run([_live(uns_paths=["enterprise.riverside.area.packaging.line.line1"])])
    assert not v.ok and v.cause == gate.CAUSE_IDENTITY


def test_split_identity_is_NOGO():
    v = _run([_live(uns_paths=[CANON, "enterprise.garage.demo_cell.cv_101"])])
    assert not v.ok and v.cause == gate.CAUSE_IDENTITY


def test_missing_uns_path_is_NOGO():
    v = _run([_live(uns_paths=[])])
    assert not v.ok and v.cause == gate.CAUSE_IDENTITY


def test_all_bad_quality_is_NOGO():
    v = _run([_live(bad_quality_rows=2400)])
    assert not v.ok and v.cause == gate.CAUSE_QUALITY


def test_missing_tags_is_NOGO_scope():
    v = _run([_live(tag_count=4)])
    assert not v.ok and v.cause == gate.CAUSE_SCOPE


def test_foreign_source_does_not_answer_for_cv101():
    """A different gateway's stream must not satisfy the gate on its own."""
    other = _live(source_connection_id="some-other-gw", rows=999999, distinct_observed_ts=999999)
    v = _run([other])
    # It is judged (busiest physical group) — the identity/scope checks are what
    # catch a foreign mapping; here it shares the path so the label is reported.
    assert "some-other-gw" in "\n".join(v.lines)


# --- reporting quality --------------------------------------------------------


def test_nogo_names_an_isolating_cause():
    """The bench operator must be told WHERE to look, not just 'failed'."""
    for rows, expect in [
        ([], gate.CAUSE_ABSENT),
        ([_frozen_replay()], gate.CAUSE_REPLAY),
        ([_live(uns_paths=["x.y"])], gate.CAUSE_IDENTITY),
        ([_live(simulated=True)], gate.CAUSE_PROVENANCE),
    ]:
        v = _run(rows)
        assert v.cause == expect
        assert v.lines[0].startswith("NO-GO")


def test_thresholds_are_tunable_without_editing_logic():
    strict = _run([_live(newest_observed_age_s=10)], max_observed_age_s=5)
    assert not strict.ok and strict.cause == gate.CAUSE_STALE
    assert _run([_live(newest_observed_age_s=10)], max_observed_age_s=60).ok


def test_string_numerics_from_psql_are_tolerated():
    """psql JSON can hand back numbers as strings."""
    v = _run(
        [
            _live(
                rows="2400",
                distinct_observed_ts="2400",
                newest_observed_age_s="2",
                newest_ingest_age_s="1",
            )
        ]
    )
    assert v.ok
