"""
Deterministic, offline tests for the weekend CV-200 interlock demo
(tools/flywheel/cv200_interlock_demo.py). No DB, no PLC, no cloud.

Proves the consume-side flywheel behaviour the weekend demo depends on:
flag off => no context; flag on => approved context; unapproved edges ignored;
citations present; seeder idempotent; runs in local/replay mode; no PLC write path.
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "tools" / "flywheel"))
sys.path.insert(0, str(_REPO / "mira-bots" / "shared"))

import cv200_interlock_demo as demo  # noqa: E402


def test_flag_off_means_no_interlock_context():
    # even with a live block AND approved edges available, flag off => nothing surfaced
    r = demo.run_demo(enabled=False, photoeye_blocked=True)
    assert r["enabled"] is False
    assert r["included"] is False
    assert r["recalled_edges"] == []
    assert r["answer"] is None


def test_flag_on_includes_approved_interlock_context():
    r = demo.run_demo(enabled=True, photoeye_blocked=True)
    assert r["included"] is True
    a = r["answer"]
    assert a is not None
    assert a["affected_signal"] == "motor_running"
    assert a["permissive"] == "vfd_run_permit"
    assert a["blocking_tag"] == "pe_latched"
    assert a["blocking_value"] is True
    assert r["asset"] in a["why"]


def test_unapproved_interlocks_are_ignored():
    # verified-only recall (the demo default) must NOT surface the proposed edges
    r = demo.run_demo(enabled=True, photoeye_blocked=True)
    sources = {e["source"] for e in r["recalled_edges"]}
    assert "dust_collector_ok" not in sources
    assert "upstream_jam" not in sources
    # contrast: only include_unapproved (dev/test) surfaces them -> the approval gate is the filter
    r2 = demo.run_demo(enabled=True, photoeye_blocked=True, include_unapproved=True)
    sources2 = {e["source"] for e in r2["recalled_edges"]}
    assert "dust_collector_ok" in sources2 and "upstream_jam" in sources2


def test_citations_and_evidence_present():
    r = demo.run_demo(enabled=True, photoeye_blocked=True)
    a = r["answer"]
    assert a["grounded"] is True
    kinds = {e["kind"] for e in a["evidence"]}
    assert "plc_rung" in kinds
    locs = {e.get("location") for e in a["evidence"]}
    assert any("Prog_init_ConvSimple" in (loc or "") for loc in locs)
    assert a["next_checks"] and any("pe_latched" in c for c in a["next_checks"])


def test_seeder_is_idempotent():
    fx = demo.load_fixture()
    store = demo.InMemoryInterlockStore()
    n1 = store.seed(fx)
    n2 = store.seed(fx)  # seeding again must not duplicate
    assert n1 == n2 == len(fx["edges"])
    # and recall still returns exactly the verified chain (4 edges), de-duplicated
    with store.cursor() as cur:
        from interlock_context import recall_interlocks  # noqa: PLC0415
        recalled = recall_interlocks(cur, fx["tenant_id"], fx["uns_subtree"])
    assert len({(e.source, e.target, e.relationship_type) for e in recalled}) == 4


def test_runs_in_local_replay_mode_without_a_db(monkeypatch):
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    r1 = demo.run_demo(enabled=True, photoeye_blocked=True)
    r2 = demo.run_demo(enabled=True, photoeye_blocked=True)
    assert r1["answer"]["why"] == r2["answer"]["why"]  # deterministic
    assert r1["source"].startswith("local replay")
    # clear beam -> conveyor runs -> nothing blocked
    r3 = demo.run_demo(enabled=True, photoeye_blocked=False)
    assert r3["live_state"]["motor_running"] is True
    assert r3["answer"] is None


def test_no_plc_write_path_introduced():
    src = (Path(demo.__file__).read_text(encoding="utf-8"))
    for marker in ("write_register", "write_coil", "pymodbus", "0x2000/502", "/dev/tcp"):
        assert marker not in src, "demo must introduce no PLC write path (%s)" % marker
    # the demo must NOT hit the DB wrapper either -- it drives the in-memory store only
    assert "fetch_interlocks(" not in src
    # evaluate_permissive is pure/read-only: calling it needs no PLC and returns a dict
    from interlock_context import evaluate_permissive  # noqa: PLC0415
    assert isinstance(evaluate_permissive(photoeye_blocked=True), dict)


def test_flag_defaults_off_in_the_runner(monkeypatch):
    # run_demo(enabled=None) mirrors the engine gate: off unless env explicitly set to 1
    monkeypatch.setenv("MIRA_INTERLOCK_CONTEXT_ENABLED", "0")
    import importlib
    importlib.reload(demo)
    r = demo.run_demo(enabled=None, photoeye_blocked=True)
    assert r["enabled"] is False and r["included"] is False
    importlib.reload(demo)  # restore
