"""
Integration proof: the MIRA signal difference engine on a SimLab scenario.
=================================================================
The fastest end-to-end proof of the reposition, fully offline + deterministic:

  SimLab replay  ->  learn baseline (healthy window)  ->  detect differences
  ->  group into ONE machine event  ->  render the Supervisor prompt block
  ->  assert it surfaces the scenario's ground-truth evidence tags.

No LLM, no broker, no DB. Proves Layers 2-3-5-seam of
docs/product/mira_signal_difference_engine_prd.md against SimLab scenario A
(filler underfill / low bowl pressure).

Run: pytest tests/simlab/test_difference_engine.py -v
"""
import os
import sys

# The difference-engine modules live under plc/conv_simple_anomaly (pure, dual-runtime).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "plc", "conv_simple_anomaly"))

from simlab.engine import SimEngine, BASE_EPOCH          # noqa: E402
from simlab.lines.juice_bottling import build_line       # noqa: E402
from simlab.scenarios import get_scenario                # noqa: E402

from difference_detectors import (                        # noqa: E402
    detect_out_of_baseline, detect_drift, group_observations,
    OUT_OF_BASELINE, DRIFT,
)
from baseline_learner import learn_signal_baseline        # noqa: E402
from event_context import build_event_context             # noqa: E402

SC = "filler_underfill_low_bowl_pressure"
BOWL = "enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.filler_bowl_pressure"
FILL = "enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz"


def _fresh():
    eng = SimEngine(build_line(), seed=42)
    eng.load_scenario(get_scenario(SC))
    return eng


def _series(tag, upto):
    """[(ts, value), ...] for tag over ticks 0..upto (deterministic, seed 42)."""
    eng = _fresh()
    out = []
    for _ in range(upto + 1):
        out.append((BASE_EPOCH + eng.tick, eng.snapshot_dict()[tag]))
        eng.advance(1)
    return out


def _snapshot_at(tick):
    eng = _fresh()
    eng.advance(tick)
    return eng.snapshot_dict(), BASE_EPOCH + eng.tick


def _learn(tag, healthy_upto=20):
    samples = [(ts, v, "good") for ts, v in _series(tag, healthy_upto)]
    return learn_signal_baseline(tag, samples, "steady-run", min_sample_count=5)


# --- baseline learning ---------------------------------------------------------
def test_baseline_learned_from_healthy_window():
    b = _learn(BOWL)
    assert b.sufficient
    # bowl idles ~12 psi with sim noise; learned range brackets it and is tight
    assert 11.0 < b.lo < 12.0 and 12.0 < b.hi < 13.0
    assert abs(b.mean - 12.0) < 0.5


# --- detection on the fault ----------------------------------------------------
def test_out_of_baseline_fires_on_fault():
    b_bowl, b_fill = _learn(BOWL), _learn(FILL)
    snap, ts = _snapshot_at(90)
    o1 = detect_out_of_baseline(BOWL, snap[BOWL], b_bowl.lo, b_bowl.hi, ts=ts)
    o2 = detect_out_of_baseline(FILL, snap[FILL], b_fill.lo, b_fill.hi, ts=ts)
    assert o1 is not None and o1.kind == OUT_OF_BASELINE and snap[BOWL] < b_bowl.lo
    assert o2 is not None and o2.kind == OUT_OF_BASELINE and snap[FILL] < b_fill.lo


def test_silent_when_healthy():
    b = _learn(BOWL)
    snap, ts = _snapshot_at(10)
    assert detect_out_of_baseline(BOWL, snap[BOWL], b.lo, b.hi, ts=ts) is None


def test_drift_detected_on_bowl_pressure():
    b = _learn(BOWL)
    recent = _series(BOWL, 90)[-10:]        # last 10 ticks, deep in the fault
    o = detect_drift(BOWL, recent, b.mean, b.stddev, window_s=10.0)
    assert o is not None and o.kind == DRIFT and o.value < b.mean


# --- grouping (anti-spam) ------------------------------------------------------
def _fault_event():
    b_bowl, b_fill = _learn(BOWL), _learn(FILL)
    snap, ts = _snapshot_at(90)
    obs = [detect_out_of_baseline(BOWL, snap[BOWL], b_bowl.lo, b_bowl.hi, ts=ts),
           detect_out_of_baseline(FILL, snap[FILL], b_fill.lo, b_fill.hi, ts=ts)]
    return group_observations([o for o in obs if o], window_s=2.0)


def test_observations_group_into_one_event():
    events = _fault_event()
    assert len(events) == 1
    assert len(events[0].observations) == 2
    assert set(events[0].signals) == {BOWL, FILL}


# --- the payoff: engine surfaces the scenario's ground-truth evidence ----------
def test_event_surfaces_scenario_evidence_tags():
    sc = get_scenario(SC)
    event = _fault_event()[0]
    surfaced = set(event.signals) & set(sc.expected_evidence_tags)
    assert len(surfaced) >= 2, "difference engine should surface the scenario's evidence tags"


# --- Supervisor seam: the prompt block is factual + grounded -------------------
def test_event_context_block_is_grounded():
    event = _fault_event()[0]
    block = build_event_context(event, resolved={"asset": "filler01",
                                                 "component": "filler bowl / fill valve"})
    assert "[MACHINE EVENT]" in block
    assert "filler01" in block and "filler_bowl_pressure" in block
    assert "normally stays" in block     # factual observation, not an explanation


# --- determinism ---------------------------------------------------------------
def test_replay_is_deterministic():
    assert _snapshot_at(90)[0][BOWL] == _snapshot_at(90)[0][BOWL]
