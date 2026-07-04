"""Machine-memory worker acceptance tests (machine-memory buildout PR 2).

Deterministic CV-101 fixtures (tag_events-shaped JSON rows) through
``run_engine.machine_memory.historize_machine_memory`` against the
InMemoryRunStore — NO DB, no hardware, no network. Covers:

  * each fixture -> expected state windows + expected typed anomaly diffs
    (rule ids, mapped severities, next_check present, evidence event ids
    pointing at real fixture rows);
  * a run-trigger fixture still creates a machine run (038 layer untouched);
  * idempotency — re-running over the same store+events adds zero rows;
  * tenant isolation — processing tenant A writes nothing for tenant B;
  * unapproved/unmapped tags are excluded from snapshots, counted, and never
    generate an anomaly.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from run_engine.machine_memory import historize_machine_memory
from run_engine.models import RunTrigger
from run_engine.store import InMemoryRunStore

FIXTURES = Path(__file__).parent / "fixtures" / "machine_memory"
TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"
TENANT_B = "22222222-2222-4222-8222-222222222222"
UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"


def _load(name: str) -> list[dict]:
    with open(FIXTURES / name, encoding="utf-8") as f:
        return json.load(f)


def _run(name: str, **kwargs):
    rows = _load(name)
    store = InMemoryRunStore()
    summary = historize_machine_memory(store, TENANT, UNS, rows, **kwargs)
    return rows, store, summary


def _window_states(store) -> list[str]:
    return [
        w.state
        for w in sorted(store.state_windows.values(), key=lambda w: w.started_at)
    ]


class TestHealthyIdle:
    def test_one_idle_window_zero_anomalies(self):
        rows, store, summary = _run("cv101_healthy_idle.json")
        assert _window_states(store) == ["idle"]
        assert store.anomaly_diffs == []
        assert summary["anomalies"] == []
        assert summary["latest_window"]["state"] == "idle"
        assert summary["unmapped_tags"] == {}

    def test_window_evidence_anchors_real_events(self):
        rows, store, _ = _run("cv101_healthy_idle.json")
        (window,) = store.state_windows.values()
        event_ids = {r["event_id"] for r in rows}
        assert window.from_event_id in event_ids
        assert window.to_event_id in event_ids
        assert window.ended_at is not None  # closed at batch end


class TestRawTagPathNormalization:
    """tag_events stores RAW Ignition source paths ([default]Conveyor/VFD_Hz),
    while CV101_TAG_TOPIC_MAP keys are normalized. map_events must normalize at
    lookup — before this, every prod row counted as unmapped and no state
    window ever derived (2026-07-03 CV-101 live proof)."""

    # normalized fixture path -> the raw Ignition path the relay actually stores
    RAW_BY_NORM = {
        "default_conveyor_dir_fwd": "[default]Conveyor/Dir_Fwd",
        "default_conveyor_dir_rev": "[default]Conveyor/Dir_Rev",
        "default_conveyor_estop_active": "[default]Conveyor/EStop_Active",
        "default_conveyor_estop_wiring_fault": "[default]Conveyor/EStop_Wiring_Fault",
        "default_conveyor_motor_running": "[default]Conveyor/Motor_Running",
        "default_conveyor_vfd_amps": "[default]Conveyor/VFD_Amps",
        "default_conveyor_vfd_cmdword": "[default]Conveyor/VFD_CmdWord",
        "default_conveyor_vfd_comm_ok": "[default]Conveyor/VFD_Comm_OK",
        "default_conveyor_vfd_dcbus_v": "[default]Conveyor/VFD_DCBus_V",
        "default_conveyor_vfd_faultcode": "[default]Conveyor/VFD_FaultCode",
        "default_conveyor_vfd_hz": "[default]Conveyor/VFD_Hz",
    }

    def test_raw_paths_derive_same_idle_window(self):
        rows = _load("cv101_healthy_idle.json")
        for r in rows:
            r["tag_path"] = self.RAW_BY_NORM[r["tag_path"]]
        store = InMemoryRunStore()
        summary = historize_machine_memory(store, TENANT, UNS, rows)
        assert _window_states(store) == ["idle"]
        assert summary["unmapped_tags"] == {}


class TestCommStale:
    def test_comm_down_window_and_a1_diff(self):
        rows, store, summary = _run("cv101_comm_stale.json")
        assert _window_states(store) == ["idle", "comm_down"]

        (a1,) = store.anomaly_diffs
        assert a1.rule_id == "A1_COMM_STALE"
        assert a1.diff_type == "anomaly_A1_COMM_STALE"
        assert a1.severity == "critical"
        assert a1.metadata["severity_raw"] == "CRITICAL"
        assert "RS-485" in a1.metadata["next_check"]

        # Evidence pointers hit the actual comm_ok=false fixture rows.
        comm_rows = [
            r["event_id"]
            for r in rows
            if r["tag_path"] == "default_conveyor_vfd_comm_ok"
            and r["value"] == "false"
        ]
        assert a1.from_event_id == comm_rows[0]
        assert a1.to_event_id == comm_rows[-1]

        # The anomaly is parented to the comm_down window, not a run.
        comm_win = [
            w for w in store.state_windows.values() if w.state == "comm_down"
        ][0]
        assert a1.window_id == comm_win.window_id
        assert summary["anomalies"][0]["rule_id"] == "A1_COMM_STALE"

    def test_healthy_prefix_window_stays_clean(self):
        _, store, _ = _run("cv101_comm_stale.json")
        idle_win = [w for w in store.state_windows.values() if w.state == "idle"][0]
        assert all(a.window_id != idle_win.window_id for a in store.anomaly_diffs)


class TestEstop:
    def test_estopped_window_and_a3_diff(self):
        rows, store, summary = _run("cv101_estop.json")
        assert _window_states(store) == ["idle", "estopped"]

        (a3,) = store.anomaly_diffs
        assert a3.rule_id == "A3_ESTOP_WIRING"
        assert a3.severity == "warning"  # HIGH -> warning
        assert a3.metadata["severity_raw"] == "HIGH"
        assert a3.metadata["next_check"]

        wiring_rows = [
            r["event_id"]
            for r in rows
            if r["tag_path"] == "default_conveyor_estop_wiring_fault"
            and r["value"] == "true"
        ]
        assert a3.from_event_id == wiring_rows[0]
        estop_win = [
            w for w in store.state_windows.values() if w.state == "estopped"
        ][0]
        assert a3.window_id == estop_win.window_id


class TestBothDirections:
    def test_a4_diff_severity_info(self):
        rows, store, summary = _run("cv101_both_directions.json")
        # A4 is MEDIUM — not a fault state, so the machine stays idle.
        assert _window_states(store) == ["idle"]

        (a4,) = store.anomaly_diffs
        assert a4.rule_id == "A4_DIRECTION_FAULT"
        assert a4.severity == "info"  # MEDIUM -> info
        assert a4.metadata["severity_raw"] == "MEDIUM"

        dir_rows = [
            r["event_id"]
            for r in rows
            if r["tag_path"].startswith("default_conveyor_dir_") and r["value"] == "true"
        ]
        assert a4.from_event_id == dir_rows[0]
        assert a4.to_event_id == dir_rows[-1]


class TestRunTrigger:
    TRIGGERS = {UNS: RunTrigger(tag_path="default_conveyor_vfd_hz", threshold=0.1)}

    def test_machine_run_still_created(self):
        rows = _load("cv101_run_trigger.json")
        store = InMemoryRunStore()
        # The store is the tag_events source for the run evidence window.
        from run_engine.machine_memory import reading_from_row

        store.seed_events([reading_from_row(r) for r in rows])
        summary = historize_machine_memory(
            store, TENANT, UNS, rows, triggers=self.TRIGGERS
        )
        assert len(store.runs) == 1
        (run,) = store.runs.values()
        assert run.status == "closed"
        assert run.duration_seconds == 30.0
        assert len(store.steps) == 1
        assert summary["latest_run"]["status"] == "closed"
        # And the state layer saw the same story: idle -> running -> idle.
        assert _window_states(store) == ["idle", "running", "idle"]
        assert store.anomaly_diffs == []

    def test_run_step_created_with_default_phase_and_run_linkage(self):
        """Delta 1a: explicit run_step assertion (not just a count) — v1
        creates exactly one 'default' step per run, and the step is linked
        to its parent run by run_id (not just coincidentally co-present)."""
        rows = _load("cv101_run_trigger.json")
        store = InMemoryRunStore()
        from run_engine.machine_memory import reading_from_row

        store.seed_events([reading_from_row(r) for r in rows])
        historize_machine_memory(store, TENANT, UNS, rows, triggers=self.TRIGGERS)

        assert len(store.runs) >= 1
        (run,) = store.runs.values()

        assert len(store.steps) >= 1
        (step,) = store.steps
        assert step.run_id == run.run_id  # linkage: step belongs to THIS run
        assert step.tenant_id == TENANT
        assert step.phase_name == "default"  # v1: single 'default' step/run
        assert step.phase_index == 0
        assert step.started_at == run.started_at


class TestIdempotency:
    def test_rerun_produces_zero_new_rows(self):
        rows = _load("cv101_comm_stale.json")
        store = InMemoryRunStore()
        historize_machine_memory(store, TENANT, UNS, rows)
        counts = (
            len(store.runs),
            len(store.steps),
            len(store.state_windows),
            len(store.anomaly_diffs),
            len(store.diffs),
        )
        summary2 = historize_machine_memory(store, TENANT, UNS, rows)
        assert (
            len(store.runs),
            len(store.steps),
            len(store.state_windows),
            len(store.anomaly_diffs),
            len(store.diffs),
        ) == counts
        assert summary2["anomaly_diffs_written"] == 0

    def test_rerun_with_run_trigger_produces_zero_new_rows(self):
        from run_engine.machine_memory import reading_from_row

        rows = _load("cv101_run_trigger.json")
        store = InMemoryRunStore()
        store.seed_events([reading_from_row(r) for r in rows])
        triggers = {UNS: RunTrigger(tag_path="default_conveyor_vfd_hz", threshold=0.1)}
        historize_machine_memory(store, TENANT, UNS, rows, triggers=triggers)
        counts = (len(store.runs), len(store.steps), len(store.state_windows))
        historize_machine_memory(store, TENANT, UNS, rows, triggers=triggers)
        assert (len(store.runs), len(store.steps), len(store.state_windows)) == counts


class TestTenantIsolation:
    def _two_tenant_rows(self) -> list[dict]:
        rows = _load("cv101_comm_stale.json")
        other = []
        for i, r in enumerate(rows):
            clone = dict(r)
            clone["tenant_id"] = TENANT_B
            clone["event_id"] = "beef0000-0000-4000-8000-%012d" % (i + 1)
            other.append(clone)
        return rows + other

    def test_processing_tenant_a_writes_nothing_for_tenant_b(self):
        rows = self._two_tenant_rows()
        store = InMemoryRunStore()
        historize_machine_memory(store, TENANT, UNS, rows)
        assert all(w.tenant_id == TENANT for w in store.state_windows.values())
        assert all(a.tenant_id == TENANT for a in store.anomaly_diffs)
        # Tenant A's evidence pointers reference tenant A's events only.
        assert all(
            a.from_event_id.startswith("cff1") for a in store.anomaly_diffs
        )

    def test_each_tenant_gets_its_own_rows(self):
        rows = self._two_tenant_rows()
        store = InMemoryRunStore()
        historize_machine_memory(store, TENANT, UNS, rows)
        historize_machine_memory(store, TENANT_B, UNS, rows)
        by_tenant = {}
        for w in store.state_windows.values():
            by_tenant.setdefault(w.tenant_id, []).append(w)
        assert len(by_tenant[TENANT]) == 2
        assert len(by_tenant[TENANT_B]) == 2
        b_anomalies = [a for a in store.anomaly_diffs if a.tenant_id == TENANT_B]
        assert len(b_anomalies) == 1
        assert b_anomalies[0].from_event_id.startswith("beef")


def _ev(eid: str, tag_path: str, value: str, ts: float, value_type: str = "bool"):
    """A tag_events-shaped dict row for the continuity fixtures."""
    return {
        "event_id": eid,
        "tenant_id": TENANT,
        "uns_path": UNS,
        "tag_path": tag_path,
        "value": value,
        "value_type": value_type,
        "quality": "good",
        "event_timestamp": ts,
    }


def _comm_down_batch(prefix: str, base_ts: float) -> list[dict]:
    """A full CV-101 comm_down snapshot (yields exactly the A1 anomaly), laid
    out comm_down-from-the-first-event so it is a SINGLE window (no idle prefix).
    Timestamps are epoch seconds starting at ``base_ts``.
    """
    n = [0]

    def nxt() -> float:
        n[0] += 1
        return base_ts + n[0] * 5

    return [
        _ev(f"{prefix}01", "default_conveyor_vfd_comm_ok", "false", nxt()),
        _ev(f"{prefix}02", "default_conveyor_motor_running", "false", nxt()),
        _ev(f"{prefix}03", "default_conveyor_estop_active", "false", nxt()),
        _ev(f"{prefix}04", "default_conveyor_estop_wiring_fault", "false", nxt()),
        _ev(f"{prefix}05", "default_conveyor_vfd_hz", "0.0", nxt(), "float"),
        _ev(f"{prefix}06", "default_conveyor_vfd_amps", "0.0", nxt(), "float"),
        _ev(f"{prefix}07", "default_conveyor_vfd_dcbus_v", "321.5", nxt(), "float"),
        _ev(f"{prefix}08", "default_conveyor_vfd_cmdword", "1", nxt(), "int"),
        _ev(f"{prefix}09", "default_conveyor_vfd_faultcode", "0", nxt(), "int"),
        _ev(f"{prefix}10", "default_conveyor_vfd_comm_ok", "false", nxt()),
    ]


class TestCrossBatchContinuity:
    """Finding 1: a state that outlives the sliding lookback must EXTEND its
    window (one row), not accrete a new machine_state_window + run_diff row
    each batch."""

    def test_continuing_state_extends_one_window_no_accretion(self):
        store = InMemoryRunStore()

        # Batch 1: t0..t1, a single long comm_down window.
        batch1 = _comm_down_batch("aaaa0000-0000-4000-8000-0000000000", 1000.0)
        historize_machine_memory(store, TENANT, UNS, batch1)
        assert len(store.state_windows) == 1
        assert len(store.anomaly_diffs) == 1
        (w1,) = store.state_windows.values()
        assert w1.state == "comm_down"
        orig_window_id = w1.window_id
        orig_started_at = w1.started_at
        orig_ended_at = w1.ended_at

        # Batch 2: sliding window t0+delta..t2 — SAME continuing comm_down, but
        # the original start event (aaaa..01) is NO LONGER in the batch. New
        # event_ids, later timestamps, overlapping batch-1 coverage.
        batch2 = _comm_down_batch("bbbb0000-0000-4000-8000-0000000000", 1015.0)
        assert all(r["event_id"] not in {e["event_id"] for e in batch1} for r in batch2)
        historize_machine_memory(store, TENANT, UNS, batch2)

        # ONE physical comm_down period -> ONE window row, extended.
        assert len(store.state_windows) == 1
        (w1b,) = store.state_windows.values()
        assert w1b.window_id == orig_window_id
        assert w1b.started_at == orig_started_at  # kept the original anchor
        assert w1b.ended_at > orig_ended_at  # extended forward
        # ONE anomaly row — the continuing condition did not mint a new run_diff.
        assert len(store.anomaly_diffs) == 1
        assert store.anomaly_diffs[0].window_id == orig_window_id

    def test_state_change_across_batches_creates_new_window(self):
        store = InMemoryRunStore()

        # Batch 1: comm_down.
        batch1 = _comm_down_batch("cccc0000-0000-4000-8000-0000000000", 1000.0)
        historize_machine_memory(store, TENANT, UNS, batch1)
        assert _window_states(store) == ["comm_down"]
        comm_id = next(iter(store.state_windows.values())).window_id

        # Batch 2: comm RESTORED -> idle. A genuine state change: a NEW window.
        batch2 = [
            _ev("dddd0000-0000-4000-8000-000000000001", "default_conveyor_vfd_comm_ok", "true", 1200.0),
            _ev("dddd0000-0000-4000-8000-000000000002", "default_conveyor_motor_running", "false", 1205.0),
            _ev("dddd0000-0000-4000-8000-000000000003", "default_conveyor_estop_active", "false", 1210.0),
            _ev("dddd0000-0000-4000-8000-000000000004", "default_conveyor_estop_wiring_fault", "false", 1215.0),
            _ev("dddd0000-0000-4000-8000-000000000005", "default_conveyor_vfd_hz", "0.0", 1220.0, "float"),
        ]
        historize_machine_memory(store, TENANT, UNS, batch2)

        assert len(store.state_windows) == 2
        states = {w.state for w in store.state_windows.values()}
        assert states == {"comm_down", "idle"}
        idle_win = [w for w in store.state_windows.values() if w.state == "idle"][0]
        assert idle_win.window_id != comm_id  # a genuinely new row


class TestUnmappedTags:
    def test_unknown_tags_excluded_counted_no_anomaly(self):
        rows, store, summary = _run("cv101_unmapped_tag.json")
        assert summary["unmapped_tags"] == {
            "default_conveyor_hacker_injected": 2,
            "default_unapproved_mystery_bool": 1,
        }
        # The rogue tags never became a window state or an anomaly.
        assert _window_states(store) == ["idle"]
        assert store.anomaly_diffs == []
        # And the idle window's evidence stops at the last APPROVED event.
        (window,) = store.state_windows.values()
        mapped_ids = {
            r["event_id"]
            for r in rows
            if not r["tag_path"].startswith(
                ("default_conveyor_hacker", "default_unapproved")
            )
        }
        assert window.to_event_id in mapped_ids


class TestCliDryRun:
    """Delta 1b: exercise dry-run through the CLI layer (subprocess — the CLI
    always builds its own throwaway InMemoryRunStore, never returns it, so the
    only externally-observable evidence of "rows landed" is the persisted-row
    dump the CLI prints after processing). Per ``run_engine/machine_memory.py``
    ``_cli()`` (~line 358), ``--dry-run`` suppresses exactly that dump; it does
    not change what ``historize_machine_memory`` computes. So the CLI-layer
    contract for "zero rows land in the store" is: the persisted-counts block
    never appears in stdout, while the per-batch summary (what WOULD be
    written — windows_upserted, anomaly_diffs_written, anomalies, …) still
    does. A parallel non-dry-run invocation proves the same fixture DOES
    confirm nonzero persisted counts absent the flag, so the suppression is
    real, not a fixture artifact.
    """

    FIXTURE = FIXTURES / "cv101_comm_stale.json"

    def _run_cli(self, *, dry_run: bool) -> str:
        args = [
            sys.executable,
            "-m",
            "run_engine.machine_memory",
            "--fixture",
            str(self.FIXTURE),
        ]
        if dry_run:
            args.append("--dry-run")
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
            check=True,
        )
        return result.stdout

    def test_dry_run_reports_summary_but_confirms_zero_persisted_rows(self):
        dry_stdout = self._run_cli(dry_run=True)
        wet_stdout = self._run_cli(dry_run=False)

        # The per-batch summary (what WOULD be written) is printed either way.
        assert '"windows_upserted": 2' in dry_stdout
        assert '"anomaly_diffs_written": 1' in dry_stdout
        assert '"rule_id": "A1_COMM_STALE"' in dry_stdout

        # --dry-run suppresses the persisted-row-count confirmation block —
        # no evidence of any of the five tables ("machine_run", "run_step",
        # "run_baseline", "run_diff_baseline_deviation",
        # "machine_state_window", "run_diff_anomaly") having rows.
        assert '"persisted"' not in dry_stdout
        assert '"machine_run"' not in dry_stdout
        assert '"machine_state_window"' not in dry_stdout
        assert '"run_diff_anomaly"' not in dry_stdout

        # Without --dry-run the SAME fixture DOES confirm persisted counts —
        # proves the suppression above is the --dry-run flag's doing.
        assert '"persisted"' in wet_stdout
        assert '"machine_run": 0' in wet_stdout
        assert '"machine_state_window": 2' in wet_stdout
        assert '"run_diff_anomaly": 1' in wet_stdout


class TestServerTimeWindowClock:
    """State windows run on the SERVER clock (tag_events.ingested_at), not the
    client event_timestamp — which freezes when values stop changing (Ignition
    report-by-exception). Bench-proven 2026-07-04: windows pinned at 11:06
    while fresh rows landed at 6/s, leaving a stale closed 'faulted' window as
    the card's current state forever."""

    BASE = 1_751_600_000.0  # arbitrary epoch anchor

    def _rows(self, *, frozen_client_ts: bool, n: int = 10) -> list[dict]:
        # comm_ok=true + frequency 0 -> idle snapshot. Client ts optionally
        # frozen at BASE while ingested_ts advances 2 s per row.
        rows = []
        for i in range(n):
            rows.append(
                {
                    "event_id": f"e{i}",
                    "tenant_id": TENANT,
                    "uns_path": UNS,
                    "tag_path": "default_mira_iocheck_vfd_vfd_comm_ok",
                    "value": "true",
                    "value_type": "bool",
                    "quality": "good",
                    "event_timestamp": self.BASE if frozen_client_ts else self.BASE + i * 2.0,
                    "ingested_ts": self.BASE + i * 2.0,
                }
            )
        return rows

    def test_frozen_client_ts_windows_still_advance(self):
        rows = self._rows(frozen_client_ts=True)
        store = InMemoryRunStore()
        historize_machine_memory(store, TENANT, UNS, rows)
        (window,) = store.state_windows.values()
        # ended_at follows the advancing server clock, not the frozen client ts
        assert window.ended_at == self.BASE + 9 * 2.0
        assert window.started_at == self.BASE

    def test_without_ingested_ts_falls_back_to_event_timestamp(self):
        rows = self._rows(frozen_client_ts=False)
        for r in rows:
            del r["ingested_ts"]
        store = InMemoryRunStore()
        historize_machine_memory(store, TENANT, UNS, rows)
        (window,) = store.state_windows.values()
        assert window.ended_at == self.BASE + 9 * 2.0

    def test_stale_stream_fires_a0_offline_on_final_window(self):
        rows = self._rows(frozen_client_ts=True)
        store = InMemoryRunStore()
        # Stream stopped: real now is 120 s past the last sample (>= 30 s A0).
        now = self.BASE + 9 * 2.0 + 120.0
        summary = historize_machine_memory(store, TENANT, UNS, rows, now=now)
        rule_ids = {a["rule_id"] for a in summary["anomalies"]}
        assert "A0_OFFLINE" in rule_ids

    def test_fresh_stream_does_not_fire_a0(self):
        rows = self._rows(frozen_client_ts=True)
        store = InMemoryRunStore()
        now = self.BASE + 9 * 2.0 + 2.0  # 2 s after the last sample
        summary = historize_machine_memory(store, TENANT, UNS, rows, now=now)
        rule_ids = {a["rule_id"] for a in summary["anomalies"]}
        assert "A0_OFFLINE" not in rule_ids

    def test_reader_sql_keys_on_ingested_at(self):
        # Source-level pin: the tag_events reader filters AND orders on
        # ingested_at (server time), and surfaces it as ingested_ts.
        import inspect

        sys.path.insert(0, str(Path(__file__).parent.parent / "tasks"))
        try:
            import historize_runs
        finally:
            sys.path.remove(str(Path(__file__).parent.parent / "tasks"))
        src = inspect.getsource(historize_runs._read_recent_events)
        assert "ingested_at >= NOW()" in src
        assert "ORDER BY ingested_at ASC" in src
        assert "AS ingested_ts" in src
        assert "event_timestamp >= NOW()" not in src
