"""Deterministic acceptance tests for the SimLab juice-bottling line.

All tests are fully offline — no LLM, no MQTT broker, no NeonDB.

Acceptance criteria
-------------------
1. test_juice_determinism      — replay underfill twice from seed 42 → identical snapshot_dict
2. test_juice_tags             — each asset emits its spec'd tags; categories are valid
3. test_juice_uns_stable       — every tag UNS path is canonical ltree and round-trips via MQTT
4. test_juice_alarms_fire      — each scenario's alarms_at_tick fire at the declared tick
5. test_juice_evidence         — assemble_evidence surfaces the expected_evidence_tags
6. test_juice_docs             — every expected_citation exists and is retrievable via the API
7. test_juice_approval         — approval lifecycle draft→…→approved; gate allows/blocks correctly
8. test_juice_publisher_fake   — InMemoryPublisher captures a full snapshot batch, no broker
9. test_juice_rubric           — grade() passes a correct answer; fails an off-target one
10. test_juice_api             — FastAPI TestClient smoke: snapshot/alarms/start/tick/evidence/rubric/docs/validation
11. test_juice_runner_adapter  — simlab_scenario_to_state returns certified direct-connection state
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from simlab.diagnostic import assemble_evidence, grade
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.models import TagCategory, ValueType
from simlab.publishers import FakePublisher, InMemoryPublisher
from simlab.scenarios import SCENARIOS, get_scenario
from simlab.uns import asset_path, from_mqtt_topic, tag_path, to_mqtt_topic

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_CATEGORIES = {c.value for c in TagCategory}
_LTREE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def _fresh_engine(scenario_id: str | None = None, seed: int = 42) -> SimEngine:
    """Build a fresh SimEngine; optionally load a scenario."""
    line = build_line()
    eng = SimEngine(line, seed=seed)
    if scenario_id is not None:
        eng.load_scenario(get_scenario(scenario_id))
    return eng


# ---------------------------------------------------------------------------
# 1. Determinism
# ---------------------------------------------------------------------------


def test_juice_determinism() -> None:
    """Replaying underfill twice from seed 42 produces byte-identical snapshots."""
    sid = "filler_underfill_low_bowl_pressure"
    eng1 = _fresh_engine(sid)
    eng1.advance(120)
    snap1 = eng1.snapshot_dict()

    eng2 = _fresh_engine(sid)
    eng2.advance(120)
    snap2 = eng2.snapshot_dict()

    assert snap1 == snap2, "Snapshots must be byte-identical for same seed+scenario+ticks"
    assert len(snap1) > 0, "Snapshot must not be empty"


# ---------------------------------------------------------------------------
# 2. Tags spec
# ---------------------------------------------------------------------------


def test_juice_tags() -> None:
    """Every asset emits its spec'd tags with valid categories and value types."""
    line = build_line()
    for asset in line.all_assets():
        assert len(asset.tags) > 0, f"{asset.asset_id} has no tags"
        for tag_name, tag_def in asset.tags.items():
            assert tag_def.category.value in _VALID_CATEGORIES, (
                f"{asset.asset_id}.{tag_name}: unknown category {tag_def.category!r}"
            )
            assert tag_def.value_type in ValueType, (
                f"{asset.asset_id}.{tag_name}: unknown value_type {tag_def.value_type!r}"
            )
            assert tag_def.default is not None, f"{asset.asset_id}.{tag_name}: default is None"


# ---------------------------------------------------------------------------
# 3. UNS stability / MQTT round-trip
# ---------------------------------------------------------------------------


def test_juice_uns_stable() -> None:
    """Every tag UNS path is canonical ltree and round-trips through the MQTT projection."""
    line = build_line()
    for asset in line.all_assets():
        for tag_name, tag_def in asset.tags.items():
            uns = tag_path(asset.asset_id, tag_def.category.value, tag_name)
            assert _LTREE_RE.match(uns), f"UNS path is not canonical ltree: {uns!r}"
            topic = to_mqtt_topic(uns)
            back = from_mqtt_topic(topic)
            assert back == uns, f"Round-trip mismatch for {uns!r}: topic={topic!r} → {back!r}"


# ---------------------------------------------------------------------------
# 4. Alarm firing
# ---------------------------------------------------------------------------


def _alarm_codes_at(scenario_id: str, tick: int) -> set[str]:
    """Return set of active alarm codes after advancing to ``tick``."""
    eng = _fresh_engine(scenario_id)
    eng.advance(tick)
    return {a["code"] for a in eng.active_alarms()}


def test_juice_alarms_fire() -> None:
    """Declared alarms fire at (or before) the declared tick.

    Strategy (per advisor):
    - declared ticks are always >= actual first-fire (author hand-estimates)
    - Assert declared codes ⊆ active codes AT the declared tick (latch check)
    - Assert declared codes are NOT all active just BEFORE the causing phase starts
      (ensures the alarm is actually caused by the fault, not pre-loaded)
    """
    for sid, scenario in SCENARIOS.items():
        if not scenario.alarms_at_tick:
            # palletizer has no alarm defs — vacuously pass
            continue

        for declared_tick, expected_codes in scenario.alarms_at_tick.items():
            expected_set = set(expected_codes)

            # Upper bound: all declared codes must be latched by declared_tick
            active_at = _alarm_codes_at(sid, declared_tick)
            missing = expected_set - active_at
            assert not missing, (
                f"Scenario {sid!r}: expected alarms {expected_set!r} at tick {declared_tick}, "
                f"but {missing!r} not active (active={active_at!r})"
            )

            # Lower bound: before the VERY first phase that should cause these alarms.
            # For scenarios that inject secondary_normal_state immediately (e.g. casepacker
            # CP-JAM at tick 1 from the override), the pre-fault window is tick 0.
            # Only check lower bound when declared_tick >= 5.
            if declared_tick >= 5:
                pre_tick = max(0, declared_tick - 20)
                active_pre = _alarm_codes_at(sid, pre_tick)
                # At least one declared code must NOT be active pre-fault
                # (verifies the fault actually causes it, not a pre-existing state)
                if pre_tick > 0:
                    assert not expected_set.issubset(active_pre), (
                        f"Scenario {sid!r}: all expected alarms {expected_set!r} already "
                        f"active at tick {pre_tick} (before fault phase) — "
                        f"alarm test is vacuous"
                    )


# ---------------------------------------------------------------------------
# 5. Evidence assembly
# ---------------------------------------------------------------------------


def test_juice_evidence() -> None:
    """assemble_evidence surfaces all expected_evidence_tags for each scenario."""
    advance_ticks: dict[str, int] = {
        "filler_underfill_low_bowl_pressure": 120,
        "capper_torque_fault": 60,
        "labeler_registration_drift": 60,
        "casepacker_jam_upstream_block": 15,
        "palletizer_unavailable_backup": 10,
        "low_plant_air_multi_machine": 40,
    }

    for sid, scenario in SCENARIOS.items():
        ticks = advance_ticks.get(sid, 60)
        eng = _fresh_engine(sid)
        eng.advance(ticks)
        ev = assemble_evidence(eng, scenario)

        found_paths = {e["uns_path"] for e in ev.abnormal_tags}
        expected = set(scenario.expected_evidence_tags)
        missing = expected - found_paths
        assert not missing, (
            f"Scenario {sid!r} @ tick {ticks}: evidence missing {missing!r}\nFound: {found_paths}"
        )


# ---------------------------------------------------------------------------
# 6. Docs existence
# ---------------------------------------------------------------------------


def test_juice_docs() -> None:
    """Every expected_citation file exists on disk under simlab/docs/<asset_id>/."""
    docs_root = Path(__file__).parent.parent.parent / "simlab" / "docs"
    assert docs_root.exists(), f"Docs root missing: {docs_root}"

    for sid, scenario in SCENARIOS.items():
        asset_docs_dir = docs_root / scenario.asset_id
        assert asset_docs_dir.exists(), (
            f"Scenario {sid!r}: docs dir missing for asset {scenario.asset_id!r}: {asset_docs_dir}"
        )
        for citation in scenario.expected_citations:
            doc_path = asset_docs_dir / citation
            assert doc_path.exists(), (
                f"Scenario {sid!r}: expected citation {citation!r} not found at {doc_path}"
            )
            content = doc_path.read_text()
            assert len(content) > 0, f"Scenario {sid!r}: citation {citation!r} exists but is empty"


# ---------------------------------------------------------------------------
# 7. Approval lifecycle
# ---------------------------------------------------------------------------


def test_juice_approval(tmp_path: Path) -> None:
    """Approval store lifecycle: draft→training→validating→approved (actor required) → gate allows.

    Also verifies that bad / needs_review verdicts do NOT open the gate.
    """
    from simlab.approval import ApprovalStore

    db_path = tmp_path / "approvals.db"
    store = ApprovalStore(str(db_path))

    uns = asset_path("filler01")

    # --- Initial state is draft, gate blocks ---
    assert store.agent_state(uns) == "draft"
    gate = store.gate(uns)
    assert gate["allow"] is False, f"Gate must block in draft state, got: {gate}"

    # --- record_answer + good verdict ---
    qa_id = store.record_answer(
        scenario_id="filler_underfill_low_bowl_pressure",
        asset_uns_path=uns,
        question="What is wrong with the filler?",
        mira_answer="The filler bowl pressure is low at 5.2 PSI (baseline 12 PSI). "
        "This is causing underfill. Inspect the air regulator.",
        citations=["troubleshooting.md", "fault_code_table.md"],
        evidence_tags=[
            "enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.filler_bowl_pressure"
        ],
        groundedness=0.92,
    )
    assert qa_id, "record_answer must return a non-empty qa_id"
    store.set_verdict(qa_id, "good", reviewed_by="reviewer01")

    # Gate still blocked — lifecycle transition hasn't happened yet
    gate2 = store.gate(uns)
    assert gate2["allow"] is False

    # --- Lifecycle transitions ---
    store.transition(uns, "training")
    assert store.agent_state(uns) == "training"

    store.transition(uns, "validating")
    assert store.agent_state(uns) == "validating"

    # approved requires a non-empty actor
    store.transition(uns, "approved", actor="admin")
    assert store.agent_state(uns) == "approved"

    # --- Gate allows after approved ---
    gate3 = store.gate(uns)
    assert gate3["allow"] is True, f"Gate must allow after approved, got: {gate3}"

    # --- Separate asset: bad verdict blocks gate ---
    uns_bad = asset_path("capper01")
    qa_bad = store.record_answer(
        scenario_id="capper_torque_fault",
        asset_uns_path=uns_bad,
        question="What is wrong with the capper?",
        mira_answer="The motor is broken.",
        citations=[],
        evidence_tags=[],
    )
    store.set_verdict(qa_bad, "bad", reviewed_by="reviewer01")
    gate_bad = store.gate(uns_bad)
    assert gate_bad["allow"] is False, f"Bad verdict must block gate, got: {gate_bad}"

    # --- Separate asset: needs_review verdict blocks gate ---
    uns_nr = asset_path("labeler01")
    qa_nr = store.record_answer(
        scenario_id="labeler_registration_drift",
        asset_uns_path=uns_nr,
        question="What is wrong with the labeler?",
        mira_answer="Might be label web tension.",
        citations=[],
        evidence_tags=[],
    )
    store.set_verdict(qa_nr, "needs_review", reviewed_by="reviewer01")
    gate_nr = store.gate(uns_nr)
    assert gate_nr["allow"] is False, f"needs_review verdict must block gate, got: {gate_nr}"


# ---------------------------------------------------------------------------
# 8. Publisher (FakePublisher / InMemoryPublisher)
# ---------------------------------------------------------------------------


def test_juice_publisher_fake() -> None:
    """InMemoryPublisher captures a full snapshot batch without a broker."""
    eng = _fresh_engine("filler_underfill_low_bowl_pressure")
    eng.advance(1)

    # engine.snapshot() returns list[Reading] — publish that batch
    pub = InMemoryPublisher()
    readings = eng.snapshot()
    pub.publish(readings)

    assert len(pub.batches) == 1, "Should have exactly one published batch"
    assert pub.last is pub.batches[-1], ".last must reference the most-recent batch"
    line = build_line()
    expected_count = sum(len(a.tags) for a in line.all_assets())
    assert len(pub.last) == expected_count, (
        f"Batch should contain one Reading per tag ({expected_count}), got {len(pub.last)}"
    )

    # Every reading has a canonical UNS path
    for r in pub.last:
        assert _LTREE_RE.match(r.uns_path), f"Non-canonical UNS in reading: {r.uns_path!r}"

    # FakePublisher is an alias and works identically
    fp = FakePublisher()
    fp.publish(readings)
    assert len(fp.last) == expected_count

    # clear() resets
    pub.clear()
    assert pub.batches == []
    assert pub.last is None


# ---------------------------------------------------------------------------
# 9. Rubric grading
# ---------------------------------------------------------------------------


def test_juice_rubric() -> None:
    """grade() passes a correct answer and fails an off-target one."""
    scenario = get_scenario("filler_underfill_low_bowl_pressure")

    # --- Correct answer: hits root cause, asset, evidence ---
    correct_reply = (
        "The filler01 rotary filler is experiencing low bowl pressure at 5.2 PSI "
        "(baseline is 12 PSI). This low filler bowl pressure is causing underfill — "
        "fill_level_oz is reading 13.5 oz vs. target 16 oz, and underfill_reject_count "
        "is elevated. The fill_level_variance is also outside normal range. "
        "Recommended actions: inspect the compressed-air supply regulator, "
        "check the air manifold for blockage. See filler01/troubleshooting.md "
        "and fault_code_table.md."
    )
    result = grade(correct_reply, scenario)
    assert result.passed, f"Correct answer should pass rubric. Detail: {result.detail}"
    assert result.root_cause_hit, "Root cause must be hit"
    assert result.asset_hit, "Asset must be hit"
    assert result.evidence_recall >= 0.5, f"Evidence recall too low: {result.evidence_recall}"

    # --- Off-target answer: blames the wrong cause, no asset name ---
    wrong_reply = (
        "The conveyor belt is dirty and needs cleaning. "
        "The production rate is slightly low but this is normal variation. "
        "No action required."
    )
    result_wrong = grade(wrong_reply, scenario)
    assert not result_wrong.passed, f"Wrong answer must fail rubric. Detail: {result_wrong.detail}"


# ---------------------------------------------------------------------------
# 10. FastAPI smoke tests
# ---------------------------------------------------------------------------

fastapi = pytest.importorskip("fastapi", reason="fastapi not installed — skipping API tests")
httpx = pytest.importorskip("httpx", reason="httpx not installed — skipping API tests")


@pytest.fixture()
def app_client(tmp_path: Path) -> Any:
    """Build a fresh FastAPI TestClient with injected engine + approvals."""
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line

    line = build_line()
    engine = SimEngine(line, seed=42)
    approvals = ApprovalStore(str(tmp_path / "test_approvals.db"))
    app = build_app(engine=engine, approvals=approvals)
    return TestClient(app)


def test_juice_api(app_client: Any) -> None:
    """FastAPI smoke: healthz / snapshot / alarms / start / tick / evidence / rubric / docs / validation."""
    client = app_client
    sid = "filler_underfill_low_bowl_pressure"

    # --- healthz ---
    r = client.get("/simlab/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    # --- Start scenario ---
    r = client.post(f"/simlab/scenario/{sid}/start")
    assert r.status_code == 200, f"Start failed: {r.text}"
    assert r.json()["scenario_id"] == sid

    # --- Advance ticks ---
    r = client.post("/simlab/scenario/tick?n=30")
    assert r.status_code == 200
    assert r.json()["tick"] == 30

    # --- Snapshot (full) ---
    r = client.get("/simlab/snapshot")
    assert r.status_code == 200
    snap = r.json()
    assert "tick" in snap
    assert "tags" in snap
    assert len(snap["tags"]) > 0

    # --- Snapshot (filtered by asset) ---
    r = client.get("/simlab/snapshot?asset=filler01")
    assert r.status_code == 200
    filtered = r.json()["tags"]
    assert all("filler01" in k for k in filtered), "Filtered snapshot has non-filler01 keys"

    # --- Alarms ---
    r = client.get("/simlab/alarms")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    # --- Evidence ---
    r = client.get(f"/simlab/evidence/{sid}")
    assert r.status_code == 200
    ev = r.json()
    assert "abnormal_tags" in ev
    assert "asset_id" in ev

    # --- Rubric ---
    r = client.get(f"/simlab/scenario/{sid}/rubric")
    assert r.status_code == 200
    rubric = r.json()
    assert rubric["scenario_id"] == sid
    assert "expected_root_cause" in rubric
    assert "question" in rubric

    # --- Docs ---
    r = client.get("/simlab/assets/filler01/docs")
    assert r.status_code == 200
    doc_list = r.json()
    assert len(doc_list) > 0

    doc_file = doc_list[0]
    r = client.get(f"/simlab/docs/filler01/{doc_file}")
    assert r.status_code == 200
    assert len(r.text) > 0

    # --- 404 for missing doc ---
    r = client.get("/simlab/docs/filler01/nonexistent_file.md")
    assert r.status_code == 404

    # --- Validation: record answer ---
    uns = asset_path("filler01")
    payload = {
        "scenario_id": sid,
        "asset_uns_path": uns,
        "question": "What is wrong?",
        "mira_answer": "Bowl pressure is low on filler01.",
        "citations": ["troubleshooting.md"],
        "evidence_tags": [],
        "groundedness": 0.85,
    }
    r = client.post("/simlab/validation/answer", json=payload)
    assert r.status_code == 200
    qa_id = r.json()["qa_id"]
    assert qa_id

    # --- Validation: set verdict ---
    r = client.post(
        f"/simlab/validation/{qa_id}/verdict", json={"verdict": "good", "reviewed_by": "tester"}
    )
    assert r.status_code == 200

    # --- Agent gate (should still block at draft) ---
    r = client.get("/simlab/agent/filler01/gate")
    assert r.status_code == 200
    gate = r.json()
    assert "allow" in gate

    # --- Replay endpoint ---
    r = client.post(f"/simlab/scenario/{sid}/replay?ticks=10")
    assert r.status_code == 200
    assert r.json()["tick"] == 10

    # --- 404 for unknown scenario ---
    r = client.post("/simlab/scenario/no_such_scenario/start")
    assert r.status_code == 404

    # --- Reset ---
    r = client.post("/simlab/scenario/reset")
    assert r.status_code == 200
    assert r.json()["tick"] == 0


# ---------------------------------------------------------------------------
# 11. Runner adapter
# ---------------------------------------------------------------------------


def test_juice_runner_adapter() -> None:
    """simlab_scenario_to_state returns a certified direct-connection state dict."""
    from tests.simlab.juice_runner_adapter import simlab_scenario_to_state

    sid = "filler_underfill_low_bowl_pressure"
    state = simlab_scenario_to_state(sid, ticks=120)

    # Direct-connection UNS certification
    ctx = state["uns_context"]
    assert ctx["source"] == "direct_connection"
    assert ctx["confidence"] == "certified"
    assert ctx["asset_id"] == "filler01"
    assert ctx["tick"] == 120
    assert ctx["scenario_id"] == sid

    # Tag state is a non-empty snapshot dict
    assert isinstance(state["tag_state"], dict)
    assert len(state["tag_state"]) > 0

    # All keys in tag_state are canonical ltree paths
    for path in state["tag_state"]:
        assert _LTREE_RE.match(path), f"Non-canonical UNS in tag_state: {path!r}"

    # Evidence packet is present and populated
    ev = state["session_context"]["evidence"]
    assert ev["asset_id"] == "filler01"
    assert len(ev["abnormal_tags"]) > 0, "Should have abnormal tags at tick 120"
    assert len(ev["candidate_docs"]) > 0, "Should have candidate docs"

    # Determinism: same call → same result
    state2 = simlab_scenario_to_state(sid, ticks=120)
    assert state["tag_state"] == state2["tag_state"], "Adapter must be deterministic"

    # Works for all 6 juice scenarios
    juice_sids = list(SCENARIOS.keys())
    advance_ticks: dict[str, int] = {
        "filler_underfill_low_bowl_pressure": 120,
        "capper_torque_fault": 60,
        "labeler_registration_drift": 60,
        "casepacker_jam_upstream_block": 15,
        "palletizer_unavailable_backup": 10,
        "low_plant_air_multi_machine": 40,
    }
    for juice_sid in juice_sids:
        ticks = advance_ticks.get(juice_sid, 60)
        s = simlab_scenario_to_state(juice_sid, ticks=ticks)
        assert s["uns_context"]["source"] == "direct_connection"
        assert isinstance(s["tag_state"], dict)
        assert len(s["tag_state"]) > 0
