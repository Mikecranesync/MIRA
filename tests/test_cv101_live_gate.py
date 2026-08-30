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
import sys

import pytest

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "cv101_live_gate.py"
sys.path.insert(0, str(_MODULE_PATH.parent))
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
    assert not v.ok
    assert v.cause == gate.CAUSE_PROVENANCE


@pytest.mark.parametrize(
    "row",
    [
        _live(source_system="historian_export"),
        _live(source_connection_id=None),
        _live(source_connection_id="   "),
        _live(source_system="simulator", simulated=False),
    ],
)
def test_positive_provenance_contract_fails_closed(row):
    verdict = _run([row])
    assert not verdict.ok
    assert verdict.cause == gate.CAUSE_PROVENANCE


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


# --- workflow contract -------------------------------------------------------
#
# The classifier was correct from day one; the WORKFLOW threw its verdict away.
# `rc=${PIPESTATUS[1]}` reads `tee` (always 0) instead of python, so run
# 31782370772 printed "NO-GO: REPLAY" and then announced "CV-101 GO" and exited
# 0. An alarm that can never fire is worse than no alarm — it certifies health.


def _workflow_text() -> str:
    return (
        Path(__file__).resolve().parents[1] / ".github" / "workflows" / "cv101-live-gate.yml"
    ).read_text()


def test_workflow_reads_the_gate_exit_code_not_tee():
    wf = _workflow_text()
    assert "rc=${PIPESTATUS[0]}" in wf, (
        "the gate's exit code is PIPESTATUS[0] (python); [1] is tee and is always 0, "
        "which makes the alarm silently un-fireable"
    )
    assert "rc=${PIPESTATUS[1]}" not in wf


def test_workflow_propagates_a_nogo_as_a_failed_run():
    """A NO-GO must FAIL the run — a green run is the only 'all clear'."""
    wf = _workflow_text()
    assert 'exit "$rc"' in wf


def test_workflow_probe_is_read_only():
    wf = _workflow_text()
    for mutating in ("INSERT", "UPDATE ", "DELETE", "DROP", "ALTER", "TRUNCATE"):
        assert mutating not in wf, f"{mutating!r} in a read-only probe"


# --- per-scan ratio (fixed 2026-08-16 against the live bench) ---------------


def _live_bench_2026_08_16(**over):
    """The REAL measurement from the live bench, minutes after the Ignition trial
    reset restored the device connection.

    2520 rows / 167 distinct / 12 tags over a 5-minute window = one fresh observation
    every ~1.8 s. Under the old `distinct / rows` formulation this scored 0.0663 and
    was reported as REPLAY — while sitting at 80% of the theoretical maximum that
    formulation permits (1/12 = 0.083). Pinning it so the false negative cannot return.
    """
    row = {
        "source_system": "ignition",
        "source_connection_id": "cv101-bench-gw",
        "simulated": False,
        "rows": 2520,
        "distinct_observed_ts": 167,
        "newest_observed_age_s": 3,
        "newest_ingest_age_s": 1,
        "uns_paths": [CANON],
        "tag_count": 12,
        "bad_quality_rows": 0,
    }
    row.update(over)
    return row


def test_real_live_bench_measurement_is_GO():
    """The regression this fix exists for: a healthy 12-tag bench must score GO."""
    verdict = _run([_live_bench_2026_08_16()])
    assert verdict.ok, verdict.lines


def test_old_per_row_formulation_could_never_reach_the_threshold():
    """Proof the old denominator made GO unreachable, not merely strict.

    One scan stamps all N tags with a single observation timestamp, so a PERFECT
    stream — every scan carrying a new observation — scores exactly 1/N per row. For
    12 tags that is 0.083, below the 0.50 threshold. No bench could ever pass.
    """
    tags = 12
    scans = 500
    perfect = _live(rows=scans * tags, distinct_observed_ts=scans, tag_count=tags)
    old_ratio = perfect["distinct_observed_ts"] / perfect["rows"]
    assert abs(old_ratio - 1 / tags) < 1e-9
    assert old_ratio < 0.5, "the old formulation's ceiling was below its own threshold"
    # Under the per-scan formulation the same perfect stream is exactly 1.0.
    assert _run([perfect]).ok


def test_physically_consistent_live_stream_is_GO_at_any_tag_count():
    """distinct == scans is what a live multi-tag stream actually looks like.

    The original `_live` fixture claimed distinct == rows == 2400 with 12 tags, which
    is not physically possible (2400 rows over 12 tags is 200 scans, so at most 200
    distinct stamps). That unphysical fixture is why this defect survived its own
    test suite — the suite never modelled a real multi-tag stream.
    """
    for tags in (1, 4, 12, 65):
        scans = 300
        row = _live(rows=scans * tags, distinct_observed_ts=scans, tag_count=tags)
        # expected_tag_count is passed so this isolates the RATIO; otherwise tags<12
        # would fail the separate scope check and mask what is under test.
        verdict = _run([row], expected_tag_count=tags)
        assert verdict.ok, f"live stream with {tags} tags should be GO: {verdict.lines}"


def test_frozen_replay_still_fails_under_the_per_scan_ratio():
    """The whole point of the alarm (#3161). Must not regress with the denominator."""
    verdict = _run([_frozen_replay()])
    assert not verdict.ok
    assert verdict.cause == gate.CAUSE_REPLAY


def test_partially_thawed_stream_still_fails():
    """A stream that has resumed but is mostly repeating must NOT pass. Guards the
    other direction: the fix must not turn the ratio into a rubber stamp."""
    row = _live(rows=2400, distinct_observed_ts=20, tag_count=12)  # 200 scans, 20 new
    assert not _run([row]).ok
