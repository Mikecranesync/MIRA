"""SimLab Scenario Mutation Engine tests — Phase P4 of the platform-oracle plan.

Asserts the mutation engine (``simlab.mutation``):

1. Every mutator PRESERVES ground truth (``expected_root_cause`` /
   ``expected_asset`` / ``expected_evidence_tags`` unchanged).
2. ``inject_red_herring`` surfaces as an ABNORMAL tag in ``assemble_evidence``
   (it WOULD challenge a diagnoser) but is NOT the labeled root cause, and the
   grader still REQUIRES the true root cause (a reply naming only the herring
   fails).
3. ``shift_onset`` makes the fault weaker/absent at a fixed early read tick and
   present at a later tick (deterministic).
4. ``add_concurrent_fault`` surfaces BOTH faults' evidence; the labeled root
   cause is still the primary.
5. Determinism: the whole difficulty curve is byte-identical across two runs.
6. The ``evidence_only_answerer`` curve degrades or stays bounded as difficulty
   rises; the ``ground_truth_answerer`` oracle stays 100% across the ladder.

Fully offline: no Doppler, no DB, no MQTT broker, no LLM, no Supervisor import.
"""

from __future__ import annotations

from simlab.diagnostic import assemble_evidence, grade
from simlab.engine import SimEngine
from simlab.evaluation import (
    DEFAULT_MANIFEST_TICKS,
    evidence_only_answerer,
    ground_truth_answerer,
)
from simlab.lines.juice_bottling import build_line
from simlab.mutation import (
    RED_HERRING_ATTR,
    add_concurrent_fault,
    curve_to_markdown,
    difficulty_ladder,
    inject_red_herring,
    reseed,
    run_difficulty_curve,
    shift_onset,
)
from simlab.scenarios import SCENARIOS, get_scenario

# The filler scenario is the workhorse: a ramping primary fault on filler01, so a
# distractor on labeler01 and a concurrent capper01 fault are cleanly separable.
_BASE_ID = "filler_underfill_low_bowl_pressure"
_BOWL_PATH = (
    "enterprise.florida_natural_demo.plant1.juice_bottling.line01"
    ".filler01.process.filler_bowl_pressure"
)


def _assert_ground_truth_preserved(mutated, base) -> None:
    """Every labeled answer-key field must survive a mutation unchanged."""
    assert mutated.expected_root_cause == base.expected_root_cause
    assert mutated.expected_asset == base.expected_asset
    assert mutated.expected_evidence_tags == base.expected_evidence_tags
    assert mutated.expected_actions == base.expected_actions
    assert mutated.expected_citations == base.expected_citations


def _bowl_pressure_at(scenario, tick: int) -> float:
    """Read filler01 bowl pressure at a fixed tick (deterministic, seed 42)."""
    engine = SimEngine(build_line(), seed=42)
    engine.load_scenario(scenario)
    engine.advance(tick)
    return engine.snapshot_dict()[_BOWL_PATH]


def _abnormal_assets(scenario, ticks: int) -> set[str]:
    """Return the set of asset ids that show an abnormal tag at ``ticks``."""
    engine = SimEngine(build_line(), seed=42)
    engine.load_scenario(scenario)
    engine.advance(ticks)
    evidence = assemble_evidence(engine, scenario)
    # uns_path = enterprise.site.plant.area.line.<asset>.<category>.<tag>
    return {e["uns_path"].split(".")[5] for e in evidence.abnormal_tags}


def _bowl_abnormal(scenario, tick: int) -> bool:
    """True if filler01 bowl pressure is flagged abnormal at ``tick``."""
    engine = SimEngine(build_line(), seed=42)
    engine.load_scenario(scenario)
    engine.advance(tick)
    evidence = assemble_evidence(engine, scenario)
    return any("filler_bowl_pressure" in e["uns_path"] for e in evidence.abnormal_tags)


# ---------------------------------------------------------------------------
# 1. Ground truth is preserved by every mutator
# ---------------------------------------------------------------------------


def test_every_mutator_preserves_ground_truth() -> None:
    """shift_onset / inject_red_herring / add_concurrent_fault keep the answer key."""
    base = get_scenario(_BASE_ID)
    secondary = get_scenario("capper_torque_fault")

    _assert_ground_truth_preserved(shift_onset(base, 30), base)
    _assert_ground_truth_preserved(
        inject_red_herring(base, "labeler01", "label_web_tension", 0.4), base
    )
    _assert_ground_truth_preserved(add_concurrent_fault(base, secondary), base)


def test_mutators_do_not_mutate_input_in_place() -> None:
    """Mutators are pure: the caller's scenario object is never modified."""
    base = get_scenario(_BASE_ID)
    original_starts = [p.start_tick for p in base.timeline]
    original_secondary = dict(base.secondary_normal_state)

    shift_onset(base, 50)
    inject_red_herring(base, "labeler01", "label_web_tension", 0.4)
    add_concurrent_fault(base, get_scenario("capper_torque_fault"))

    assert [p.start_tick for p in base.timeline] == original_starts
    assert base.secondary_normal_state == original_secondary


def test_difficulty_ladder_preserves_ground_truth_for_every_scenario() -> None:
    """Every rung of every scenario's ladder keeps that scenario's ground truth."""
    for sid, base in SCENARIOS.items():
        ladder = difficulty_ladder(base)
        assert [label for label, _ in ladder] == [
            "baseline",
            "onset_shift",
            "red_herring",
            "concurrent_fault",
        ], sid
        for _label, variant in ladder:
            _assert_ground_truth_preserved(variant, base)


# ---------------------------------------------------------------------------
# 2. Red herring: abnormal but non-causal; grader still requires the true cause
# ---------------------------------------------------------------------------


def test_red_herring_surfaces_as_abnormal_but_is_not_root_cause() -> None:
    """The injected herring shows up as an abnormal tag, on a non-root-cause asset."""
    base = get_scenario(_BASE_ID)
    mutated = inject_red_herring(base, "labeler01", "label_web_tension", 0.4)

    # It is recorded as a non-causal distractor.
    recorded = getattr(mutated, RED_HERRING_ATTR)
    assert recorded == [
        {"asset_id": "labeler01", "tag": "label_web_tension", "value": 0.4}
    ]

    # The herring asset is NOT the root-cause asset.
    assert "labeler01" != mutated.expected_asset == "filler01"

    # It surfaces as an abnormal cross-machine signal at the manifest tick.
    ticks = DEFAULT_MANIFEST_TICKS[_BASE_ID]
    engine = SimEngine(build_line(), seed=42)
    engine.load_scenario(mutated)
    engine.advance(ticks)
    evidence = assemble_evidence(engine, mutated)
    herring_paths = [
        e["uns_path"]
        for e in evidence.abnormal_tags
        if "labeler01" in e["uns_path"] and "label_web_tension" in e["uns_path"]
    ]
    assert herring_paths, "red herring should appear as an abnormal tag"


def test_red_herring_only_reply_fails_grader() -> None:
    """Naming ONLY the red herring (not the true cause) fails the rubric."""
    base = get_scenario(_BASE_ID)
    mutated = inject_red_herring(base, "labeler01", "label_web_tension", 0.4)

    # A reply that blames the distractor asset/tag and never names the true cause.
    premature_blame = (
        "The problem is at labeler01: the label_web_tension reading is abnormal. "
        "Check the labeler web tension rollers."
    )
    rubric = grade(premature_blame, mutated)
    assert not rubric.root_cause_hit, "herring-only reply must miss the true root cause"
    assert not rubric.passed, "herring-only reply must fail the rubric"


def test_red_herring_rejects_root_cause_asset() -> None:
    """A herring on the root-cause asset is rejected (it would not be a distractor)."""
    base = get_scenario(_BASE_ID)
    try:
        inject_red_herring(base, "filler01", "fill_level_oz", 13.0)
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for herring on root-cause asset")


# ---------------------------------------------------------------------------
# 3. shift_onset: weaker/absent early, present late (deterministic)
# ---------------------------------------------------------------------------


def test_shift_onset_weakens_early_signal_and_restores_it_late() -> None:
    """Later onset → fault absent at a fixed early tick, present at a later tick."""
    base = get_scenario(_BASE_ID)
    shifted = shift_onset(base, 60)  # onset 30→90, active 60→120

    # Phase + alarm ticks shift in lockstep.
    assert [p.start_tick for p in shifted.timeline] == [0, 90, 120]
    assert set(shifted.alarms_at_tick) == {
        t + 60 for t in base.alarms_at_tick
    }

    early, late = 50, 160
    # At the early read tick the baseline fault is abnormal but the shifted one
    # is still near-baseline (not yet abnormal).
    assert _bowl_abnormal(base, early), "baseline fault should be abnormal at tick 50"
    assert not _bowl_abnormal(shifted, early), (
        "shifted fault should be weaker/absent at the early tick"
    )
    # The bowl pressure is measurably higher (less degraded) under the shift.
    assert _bowl_pressure_at(shifted, early) > _bowl_pressure_at(base, early)

    # At a later tick the shifted fault has fully manifested.
    assert _bowl_abnormal(shifted, late), "shifted fault should be present later"


def test_shift_onset_is_deterministic() -> None:
    """The shifted reading at a fixed tick is byte-identical across two builds."""
    base = get_scenario(_BASE_ID)
    shifted = shift_onset(base, 60)
    assert _bowl_pressure_at(shifted, 50) == _bowl_pressure_at(shifted, 50)


# ---------------------------------------------------------------------------
# 4. add_concurrent_fault: both faults' evidence; primary stays the root cause
# ---------------------------------------------------------------------------


def test_concurrent_fault_surfaces_both_faults() -> None:
    """Overlaying a second fault surfaces BOTH assets' evidence; primary is the cause."""
    base = get_scenario(_BASE_ID)
    capper = get_scenario("capper_torque_fault")
    mutated = add_concurrent_fault(base, capper)

    # Labeled root cause is still the primary's.
    assert mutated.expected_asset == base.expected_asset == "filler01"
    assert mutated.expected_root_cause == base.expected_root_cause

    abnormal = _abnormal_assets(mutated, DEFAULT_MANIFEST_TICKS[_BASE_ID])
    assert "filler01" in abnormal, "primary fault evidence must be present"
    assert "capper01" in abnormal, "concurrent secondary fault evidence must be present"


def test_concurrent_fault_rejects_same_asset() -> None:
    """A concurrent fault on the same primary asset is rejected."""
    base = get_scenario(_BASE_ID)
    try:
        add_concurrent_fault(base, base)
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for same-asset concurrent fault")


# ---------------------------------------------------------------------------
# 5. Determinism of the whole curve
# ---------------------------------------------------------------------------


def test_difficulty_curve_is_byte_identical_across_runs() -> None:
    """Two curve runs at a fixed seed produce identical rows + markdown."""
    base = get_scenario(_BASE_ID)
    a = run_difficulty_curve(base, evidence_only_answerer, seed=42)
    b = run_difficulty_curve(base, evidence_only_answerer, seed=42)
    assert a == b
    assert curve_to_markdown(a) == curve_to_markdown(b)


def test_reseed_is_pure_and_changes_only_the_seed() -> None:
    """reseed copies run-opts and swaps the seed without touching the rest."""
    opts = {"scenario": get_scenario(_BASE_ID), "seed": 42, "ticks": None}
    out = reseed(opts, 7)
    assert out["seed"] == 7
    assert opts["seed"] == 42  # input untouched
    assert out["scenario"] is opts["scenario"]
    assert out["ticks"] == opts["ticks"]


# ---------------------------------------------------------------------------
# 6. Curve sanity: diagnoser bounded/degrading, oracle stays 100%
# ---------------------------------------------------------------------------


def test_evidence_only_curve_is_bounded_and_non_increasing() -> None:
    """The honest evidence-only answerer never improves as difficulty rises.

    It cannot pass root_cause (the cause phrasing is not in the packet), so it
    never passes; and added distractors must not *raise* its overall — the curve
    is monotonically non-increasing and bounded below the pass bar.
    """
    base = get_scenario(_BASE_ID)
    rows = run_difficulty_curve(base, evidence_only_answerer, seed=42)
    overalls = [r["overall"] for r in rows]

    assert all(not r["passed"] for r in rows), (
        "evidence-only answerer cannot pass any rung (no root cause in packet)"
    )
    assert all(not r["root_cause"] for r in rows)
    # Difficulty must not make the diagnoser look BETTER.
    assert overalls == sorted(overalls, reverse=True), (
        f"evidence-only curve should be non-increasing, got {overalls}"
    )
    assert max(overalls) < 1.0, "diagnoser without the answer key cannot be perfect"


def test_oracle_curve_stays_perfect_across_the_ladder() -> None:
    """The oracle knows the answer key → it passes every rung regardless of difficulty.

    This proves the curve machinery reflects difficulty only for a real
    diagnoser, not for an answerer that already holds the ground truth.
    """
    base = get_scenario(_BASE_ID)
    rows = run_difficulty_curve(base, ground_truth_answerer, seed=42)
    assert all(r["passed"] for r in rows), "oracle must pass every difficulty rung"
    assert all(r["root_cause"] for r in rows)
    assert all(r["asset"] for r in rows)
    assert all(r["overall"] >= 0.75 for r in rows), (
        "oracle composite should stay strong across the ladder"
    )


def test_curve_markdown_renders_every_rung() -> None:
    """curve_to_markdown emits a header + one row per ladder rung."""
    base = get_scenario(_BASE_ID)
    rows = run_difficulty_curve(base, ground_truth_answerer, seed=42)
    md = curve_to_markdown(rows)
    assert "# SimLab Difficulty Curve" in md
    for label in ("baseline", "onset_shift", "red_herring", "concurrent_fault"):
        assert f"`{label}`" in md
