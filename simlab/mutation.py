"""SimLab Scenario Mutation Engine — Phase P4 of the platform-oracle plan.

Measure *how MIRA degrades as scenarios get harder* — a robustness difficulty
curve — rather than a single pass/fail. This module provides **pure, deterministic,
LLM-free** mutators that transform a ``Scenario`` into a harder variant while
**preserving the known ground truth** (the labeled root cause / asset / evidence
tags stay the answer key — mutations make the *signal* harder, never the *truth*).

Design invariants
------------------
- **Pure transforms.** Every mutator takes a ``Scenario`` and returns a NEW
  ``Scenario`` (deep-copied dataclasses). The input is never mutated in place.
- **Ground truth is invariant.** ``expected_root_cause`` / ``expected_asset`` /
  ``expected_evidence_tags`` (and the other ``expected_*`` fields) are carried
  through unchanged. A mutation makes the telemetry harder to read, not the
  answer different.
- **Deterministic + offline.** No LLM, no Supervisor, no network, no DB. Built on
  the same deterministic engine + the P1 evaluation service. The same
  ``(base_scenario, answer_fn, seed)`` always yields the same difficulty curve.

Honesty about scope
-------------------
The offline difficulty curve here uses the P1 *reference answerers*
(``evidence_only_answerer`` / ``ground_truth_answerer``) to validate the
**machinery** — that the mutation engine + scoring are deterministic and that
ground truth is preserved under mutation. It does **not** prove that MIRA itself
degrades gracefully: that is the **staging path** (the real Supervisor answerer
in ``tests/simlab/supervisor_answerer.py`` injected as ``answer_fn``). Offline
proves the curve is sound; staging measures the real degradation.
"""

from __future__ import annotations

import copy
from typing import Optional

from simlab.evaluation import DEFAULT_MANIFEST_TICKS, AnswerFn, run_scenario
from simlab.scenarios import Phase, Scenario

# A red-herring tag injected by ``inject_red_herring`` records itself here on the
# returned scenario so a test (or the curve harness) can assert it is non-causal.
RED_HERRING_ATTR = "_red_herrings"


# ---------------------------------------------------------------------------
# Mutators  (pure: copy in, copy out — never mutate the input)
# ---------------------------------------------------------------------------


def _clone(scenario: Scenario) -> Scenario:
    """Deep-copy a ``Scenario`` so a mutator never touches the caller's object.

    ``deepcopy`` preserves the ground-truth fields verbatim (they are plain
    str / list[str]) and copies the timeline ``Phase`` dataclasses. Drift
    callables are functions — ``deepcopy`` returns them as-is (functions are
    atomic to ``copy``), which is exactly what we want: the trajectory is
    unchanged unless a mutator deliberately rewrites it.
    """
    return copy.deepcopy(scenario)


def shift_onset(scenario: Scenario, delta_ticks: int) -> Scenario:
    """Move every non-normal phase's start tick later (or earlier) by ``delta_ticks``.

    A later onset means the fault manifests later / weaker at a fixed read tick —
    the same labeled fault, harder to catch early. The leading ``normal`` /
    tick-0 phase is pinned at 0 (a scenario must start in a defined state); only
    fault phases shift. Start ticks are clamped at >= 0.

    Ground truth (``expected_*``) is untouched: the fault is the same fault, just
    timed differently.
    """
    out = _clone(scenario)
    new_timeline: list[Phase] = []
    for phase in out.timeline:
        if phase.start_tick == 0:
            # Leading normal phase stays anchored at the start of the timeline.
            new_timeline.append(phase)
            continue
        phase.start_tick = max(0, phase.start_tick + delta_ticks)
        new_timeline.append(phase)
    out.timeline = new_timeline

    # Shift the alarm-expectation ticks in lockstep so the rubric's expectations
    # track the retimed fault (keys are the tick an alarm first fires).
    out.alarms_at_tick = {
        max(0, tick + delta_ticks): codes
        for tick, codes in scenario.alarms_at_tick.items()
    }
    return out


def inject_red_herring(
    scenario: Scenario,
    asset_id: str,
    tag: str,
    value: object,
) -> Scenario:
    """Add a secondary abnormal tag on a DIFFERENT asset that is NOT the root cause.

    The injected tag is written into ``secondary_normal_state[asset_id][tag]`` so
    the engine applies it as an initial override (``load_scenario``) and
    ``assemble_evidence`` surfaces it as an abnormal cross-machine symptom — bait
    for a premature-blame error. It is explicitly recorded on the returned
    scenario (``getattr(out, RED_HERRING_ATTR)``) so a test can assert it is
    non-causal.

    The bait must be on an asset OTHER than the labeled root-cause asset, or it
    would not be a *red herring* (it'd reinforce the truth). This is enforced.

    Ground truth (``expected_*``) is untouched — the red herring is a distractor
    signal, never the answer.
    """
    if asset_id == scenario.expected_asset:
        raise ValueError(
            f"red herring must target an asset OTHER than the root-cause asset "
            f"{scenario.expected_asset!r}; got {asset_id!r}"
        )
    out = _clone(scenario)
    bucket = dict(out.secondary_normal_state)
    asset_overrides = dict(bucket.get(asset_id, {}))
    asset_overrides[tag] = value
    bucket[asset_id] = asset_overrides
    out.secondary_normal_state = bucket

    # Record the injected herring so tests/harness can assert it is non-causal.
    herrings = list(getattr(out, RED_HERRING_ATTR, []))
    herrings.append({"asset_id": asset_id, "tag": tag, "value": value})
    setattr(out, RED_HERRING_ATTR, herrings)
    return out


def add_concurrent_fault(primary: Scenario, secondary: Scenario) -> Scenario:
    """Overlay a second scenario's terminal fault state so two faults are active at once.

    The ``secondary`` scenario's primary-asset fault is flattened to its terminal
    (fault_active) values and laid onto ``primary`` as initial overrides on the
    secondary asset (via ``secondary_normal_state``). The engine's drift only
    runs on the *primary* asset, so a second simultaneous fault is modeled as a
    persistent abnormal state on the secondary asset — ``assemble_evidence``
    surfaces BOTH faults' evidence.

    The labeled root cause stays ``primary``'s. This deliberately raises
    **ambiguity**: a diagnoser now sees two faults and must still name the primary
    as the answer. Ground truth (``primary.expected_*``) is untouched.
    """
    if secondary.asset_id == primary.asset_id:
        raise ValueError(
            "concurrent fault must use a DIFFERENT secondary asset than the "
            f"primary ({primary.asset_id!r})"
        )
    out = _clone(primary)
    terminal = _terminal_drift_values(secondary)

    bucket = dict(out.secondary_normal_state)
    asset_overrides = dict(bucket.get(secondary.asset_id, {}))
    asset_overrides.update(terminal)
    bucket[secondary.asset_id] = asset_overrides
    out.secondary_normal_state = bucket
    return out


def reseed(scenario_run_opts: dict, seed: int) -> dict:
    """Return a copy of the run-opts dict with a new engine seed (noise realization).

    Varying the seed changes only the deterministic ripple *noise realization* —
    the drift trajectory and ground truth are untouched. A run-opts dict is
    ``{"scenario": Scenario, "seed": int, "ticks": int | None}`` as consumed by
    ``run_difficulty_curve``'s per-rung scoring. Pure: the input dict is copied,
    not mutated.
    """
    out = dict(scenario_run_opts)
    out["seed"] = seed
    return out


# ---------------------------------------------------------------------------
# Terminal-drift extraction (for add_concurrent_fault)
# ---------------------------------------------------------------------------


def _terminal_drift_values(scenario: Scenario) -> dict[str, object]:
    """Resolve a scenario's primary-asset tags to their TERMINAL fault values.

    Walks the timeline's last (most-progressed) phase and evaluates each drift
    entry at the scenario's manifest tick. Callables are evaluated at that tick;
    scalars are used as-is. Non-tag bookkeeping keys (e.g. ``fault_code``) are
    skipped — only values that overlay onto an asset tag are returned.
    """
    if not scenario.timeline:
        return {}
    manifest_tick = DEFAULT_MANIFEST_TICKS.get(scenario.id)
    if manifest_tick is None:  # pragma: no cover — every scenario has a manifest tick
        manifest_tick = max(p.start_tick for p in scenario.timeline)

    # The active phase at the manifest tick is the most-progressed phase whose
    # start_tick the manifest tick has reached (mirrors engine._apply_drift).
    active_phase: Optional[Phase] = None
    for phase in reversed(scenario.timeline):
        if manifest_tick >= phase.start_tick:
            active_phase = phase
            break
    if active_phase is None:
        return {}

    resolved: dict[str, object] = {}
    for tag_name, target in active_phase.drift.items():
        if tag_name == "fault_code":
            # Engine writes fault_code to the primary asset only; on a secondary
            # asset it isn't a meaningful overlay — skip it.
            continue
        resolved[tag_name] = target(manifest_tick) if callable(target) else target
    return resolved


# ---------------------------------------------------------------------------
# Difficulty ladder
# ---------------------------------------------------------------------------

# How much later the onset shifts on the onset-shift rung. Large enough that the
# fault is materially weaker at an early read tick, small enough to stay within a
# reasonable manifest window.
_ONSET_SHIFT_TICKS = 30

# The default red-herring used in a generic ladder: a clearly-abnormal labeler
# web-tension drop on labeler01 (baseline 1.2 N → 0.4 N), never the root cause
# unless the base scenario IS the labeler — in which case a different distractor
# asset/tag is chosen below.
_DEFAULT_HERRING = ("labeler01", "label_web_tension", 0.4)
_ALT_HERRING = ("capper01", "cap_torque_inlb", 5.5)

# The default concurrent fault overlaid in a generic ladder. Chosen so it differs
# from the base asset; a capper torque fault on capper01 is a self-contained,
# unambiguous secondary fault. If the base IS the capper, an alternate is used.
_DEFAULT_CONCURRENT = "capper_torque_fault"
_ALT_CONCURRENT = "labeler_registration_drift"


def difficulty_ladder(base_scenario: Scenario) -> list[tuple[str, Scenario]]:
    """Build an ordered ladder of increasingly-mutated variants of ``base_scenario``.

    Rungs (cumulative difficulty):

    0. ``baseline`` — the unmodified scenario.
    1. ``onset_shift`` — fault onset moved later (weaker/later signal).
    2. ``red_herring`` — onset shift + a distractor abnormal on another asset.
    3. ``concurrent_fault`` — the above + a second simultaneous fault.

    Each rung preserves ``base_scenario``'s ground truth. The distractor asset and
    concurrent-fault scenario are auto-selected to differ from the base asset, so
    the ladder is valid for any of the six scenarios.
    """
    from simlab.scenarios import get_scenario

    # Choose a red herring + concurrent fault that are NOT the base asset.
    herring = _DEFAULT_HERRING
    if herring[0] == base_scenario.expected_asset:
        herring = _ALT_HERRING
    concurrent_id = _DEFAULT_CONCURRENT
    if get_scenario(concurrent_id).asset_id == base_scenario.asset_id:
        concurrent_id = _ALT_CONCURRENT
    concurrent = get_scenario(concurrent_id)

    rung1 = shift_onset(base_scenario, _ONSET_SHIFT_TICKS)
    rung2 = inject_red_herring(rung1, herring[0], herring[1], herring[2])
    rung3 = add_concurrent_fault(rung2, concurrent)

    return [
        ("baseline", base_scenario),
        ("onset_shift", rung1),
        ("red_herring", rung2),
        ("concurrent_fault", rung3),
    ]


# ---------------------------------------------------------------------------
# Difficulty-curve harness
# ---------------------------------------------------------------------------


def run_difficulty_curve(
    base_scenario: Scenario,
    answer_fn: AnswerFn,
    *,
    seed: int = 42,
) -> list[dict]:
    """Score each rung of ``base_scenario``'s difficulty ladder via the P1 service.

    Returns one row per ladder rung::

        {
          "level": int,                 # 0..N, ladder position
          "label": str,                 # "baseline" | "onset_shift" | ...
          "passed": bool,
          "overall": float,             # P1 weighted composite, 0..1
          "root_cause": bool,
          "asset": bool,
          "evidence_recall": float,
          "citation_accuracy": float,
          "corrective_action_accuracy": float,
        }

    The mutation engine + scoring are deterministic, so the whole curve is
    byte-identical across runs at a fixed ``seed``. The offline path proves the
    machinery (determinism + ground-truth preservation under mutation); the real
    MIRA degradation curve is the STAGING path — inject the real Supervisor
    answerer as ``answer_fn`` (see ``tests/simlab/supervisor_answerer.py``).
    """
    rows: list[dict] = []
    for level, (label, scenario) in enumerate(difficulty_ladder(base_scenario)):
        score = run_scenario(scenario, answer_fn, seed=seed)
        rows.append(
            {
                "level": level,
                "label": label,
                "passed": score.passed,
                "overall": score.overall,
                "root_cause": score.root_cause_accuracy,
                "asset": score.asset_identification,
                "evidence_recall": score.evidence_recall,
                "citation_accuracy": score.citation_accuracy,
                "corrective_action_accuracy": score.corrective_action_accuracy,
            }
        )
    return rows


def curve_to_markdown(rows: list[dict]) -> str:
    """Render a difficulty curve (``run_difficulty_curve`` output) as stable markdown.

    Columns: level, label, pass, overall + the four sub-dimensions. Stable so the
    P5 dashboard and CI artifacts can diff it.
    """
    lines = [
        "# SimLab Difficulty Curve",
        "",
        "| Level | Mutation | Pass | Overall | RootCause | Asset | EvidRecall | Citation | Action |",
        "|-------|----------|------|---------|-----------|-------|------------|----------|--------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['level']} "
            f"| `{r['label']}` "
            f"| {'✓' if r['passed'] else '✗'} "
            f"| {r['overall']:.2%} "
            f"| {'✓' if r['root_cause'] else '✗'} "
            f"| {'✓' if r['asset'] else '✗'} "
            f"| {r['evidence_recall']:.0%} "
            f"| {r['citation_accuracy']:.0%} "
            f"| {r['corrective_action_accuracy']:.0%} |"
        )
    return "\n".join(lines)
