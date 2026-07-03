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
