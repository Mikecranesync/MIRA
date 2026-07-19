"""
Deterministic replay test for the Factory Difference Engine Prove-It demo.
=================================================================
Proves the full Connect->Pick->Prove->Explain->Learn arc runs offline,
deterministically, with no LLM / broker / DB. This is the replay harness that
lets the whole scenario be exercised repeatedly in one sitting.

Run: pytest tests/simlab/test_proveit_demo.py -v
"""
from demo.factory_difference_engine.pipeline import run_pipeline


def test_full_arc_runs_offline():
    r = run_pipeline("A", seed=42)
    assert set(r["stages"]) == {"connect", "pick", "prove", "explain", "learn"}
    assert r["deterministic"] is True
    assert r["backing_asset"] == "filler01"


def test_connect_is_read_only():
    c = run_pipeline("A")["stages"]["connect"]
    assert c["discovered_signals"] > 0
    assert c["asset_signals"] == 14
    assert c["writes_attempted"] == 0


def test_pick_approves_tags_and_docs():
    p = run_pipeline("A")["stages"]["pick"]
    assert p["approved_count"] == 14
    assert p["doc_count"] == 7
    assert all(t["enabled"] for t in p["approved_tags"])
    assert all(d["is_private"] for d in p["uploaded_docs"])   # per-tenant uploads


def test_prove_groups_into_one_event():
    pr = run_pipeline("A")["stages"]["prove"]
    assert pr["event_count"] == 1
    assert pr["observation_count"] > 0
    assert pr["event_signal_count"] >= 2   # multi-signal incident, one event


def test_explain_is_grounded_and_passes_rubric():
    e = run_pipeline("A")["stages"]["explain"]
    assert e["mode"] == "deterministic"
    r = e["rubric"]
    assert r["passed"] is True
    assert r["root_cause_hit"] and r["asset_hit"]
    assert r["evidence_recall"] >= 0.5
    assert len(r["citations_hit"]) >= 1          # cites the asset manuals
    # the answer names the abnormal PLC signal + a manual (grounded, not generic)
    assert "filler_bowl_pressure" in e["answer"]
    assert "troubleshooting.md" in e["answer"]


def test_learn_applies_adr0017_transitions():
    ln = run_pipeline("A")["stages"]["learn"]
    assert ln["accepted"] == 2 and ln["rejected"] == 1
    accepts = [d for d in ln["proposals"] if d["trigger"] == "accept"]
    rejects = [d for d in ln["proposals"] if d["trigger"] == "reject"]
    assert all(d["kg_approval_state"] == "proposed -> verified" for d in accepts)
    assert all(d["kg_approval_state"] == "proposed -> rejected" for d in rejects)


def test_replay_is_deterministic():
    a = run_pipeline("A", seed=42)
    b = run_pipeline("A", seed=42)
    assert a["stages"]["prove"]["observations"] == b["stages"]["prove"]["observations"]
    assert a["stages"]["explain"]["answer"] == b["stages"]["explain"]["answer"]
    assert a["stages"]["explain"]["rubric"] == b["stages"]["explain"]["rubric"]
