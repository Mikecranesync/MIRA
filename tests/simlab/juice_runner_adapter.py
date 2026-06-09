"""Thin adapter: SimLab juice-bottling scenario → Supervisor state dict.

``simlab_scenario_to_state`` loads a SimLab Scenario by ID, advances the
deterministic engine ``ticks`` steps, assembles the evidence packet, and
returns a Supervisor-compatible state dict with:

- ``state["uns_context"]["source"] = "direct_connection"`` (skips chat gate)
- ``state["uns_context"]["confidence"] = "certified"``
- ``state["tag_state"]`` — the full degraded snapshot from the engine
- ``state["session_context"]["evidence"]`` — the assembled EvidencePacket dict
- ``state["asset_id"]`` — the primary asset_id from the scenario

This is **pure and deterministic** — no LLM, no MQTT broker, no NeonDB.
Each call with the same (scenario_id, ticks, seed) produces an identical dict.

Typical usage in tests::

    from tests.simlab.juice_runner_adapter import simlab_scenario_to_state
    state = simlab_scenario_to_state("filler_underfill_low_bowl_pressure", ticks=120)
    assert state["uns_context"]["source"] == "direct_connection"
"""

from __future__ import annotations

from typing import Any

from simlab.diagnostic import assemble_evidence
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import get_scenario
from simlab.uns import asset_path


def simlab_scenario_to_state(
    scenario_id: str,
    ticks: int = 60,
    seed: int = 42,
) -> dict[str, Any]:
    """Load scenario, advance engine, assemble evidence, return Supervisor state dict.

    Parameters
    ----------
    scenario_id:
        A SimLab Scenario.id (see ``simlab.scenarios.SCENARIOS``), e.g.
        ``"filler_underfill_low_bowl_pressure"``.
    ticks:
        Number of simulation ticks to advance.  Defaults to 60 (1 minute).
        Use >= 120 for underfill scenario to surface both alarm codes.
    seed:
        RNG seed for the SimEngine.  Defaults to 42.  Change only for
        adversarial / multi-seed tests.

    Returns
    -------
    dict
        Supervisor-compatible state dict keyed as described in the module
        docstring.  The ``uns_context`` is always marked
        ``source="direct_connection"`` because the SimLab connection itself
        certifies which asset is under observation.
    """
    scenario = get_scenario(scenario_id)
    line = build_line()
    engine = SimEngine(line, seed=seed)
    engine.load_scenario(scenario)
    engine.advance(ticks)

    evidence = assemble_evidence(engine, scenario)
    snapshot = engine.snapshot_dict()
    alarms = engine.active_alarms()
    uns = asset_path(scenario.asset_id)

    return {
        # --- Direct-connection UNS certification ---
        "uns_context": {
            "source": "direct_connection",
            "confidence": "certified",
            "certifying_surface": "simlab",
            "uns_path": uns,
            "asset_id": scenario.asset_id,
            "tick": ticks,
            "scenario_id": scenario_id,
        },
        # Primary asset
        "asset_id": scenario.asset_id,
        "asset_uns_path": uns,
        # Full degraded snapshot (uns_path -> value)
        "tag_state": snapshot,
        # Active alarms list
        "active_alarms": alarms,
        # Evidence packet (serialised to plain dict for state transport)
        "session_context": {
            "evidence": {
                "asset_id": evidence.asset_id,
                "abnormal_tags": evidence.abnormal_tags,
                "active_alarms": evidence.active_alarms,
                "candidate_docs": evidence.candidate_docs,
                "uns_subtree": evidence.uns_subtree,
            },
            "scenario_id": scenario_id,
            "simlab_tick": ticks,
            "simlab_seed": seed,
        },
    }
