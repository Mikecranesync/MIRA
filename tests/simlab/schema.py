"""SimLab scenario schema — dataclasses for machine-behavior scenario definitions.

Machine-behavior scenarios extend the VFD fixture format with:
  - machine_context: physical setup (components, UNS paths, tag states at fault time)
  - fault: root cause, red herrings, correct isolation path
  - behavior_checkpoints: cross-component reasoning requirements
  - tier: 1 (full eval), 2 (lightweight), 3 (knowledge-card)

Compatible with existing grader.py ScenarioGrade output format.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Component:
    id: str
    type: str
    description: str = ""
    manufacturer: str = ""
    model: str = ""
    uns_path: str = ""


@dataclass
class MachineContext:
    """Physical machine setup at fault time."""
    site: str
    uns_path: str
    components: list[Component]
    tag_state: dict[str, Any]

    def primary_asset_label(self) -> str:
        """Return a human-readable label for the primary asset (for state pre-seeding)."""
        primary = next((c for c in self.components if c.manufacturer), self.components[0])
        parts = [p for p in [primary.manufacturer, primary.model, primary.description] if p]
        return " ".join(parts[:2]) if parts else primary.id


@dataclass
class FaultSpec:
    root_cause: str
    root_cause_component: str
    red_herrings: list[str]
    correct_isolation_steps: list[str]
    precursors: list[str] = field(default_factory=list)


@dataclass
class BehaviorCheckpoint:
    """Machine-behavior-specific checkpoint (applied across all turns)."""
    name: str
    params: dict[str, Any]
    reason: str = ""


@dataclass
class SimLabScenario:
    """A complete machine-behavior scenario."""
    id: str
    name: str
    tier: int
    machine_type: str
    source: str
    tags: list[str]
    machine_context: MachineContext
    fault: FaultSpec
    behavior_checkpoints: list[BehaviorCheckpoint]
    turns: list[dict]

    # Standard eval fields (compatible with existing grader.py)
    expected_final_state: str = "DIAGNOSIS"
    max_turns: int = 8
    expected_keywords: list[str] = field(default_factory=list)
    forbidden_keywords: list[str] = field(default_factory=list)
    wo_expected: bool = False
    safety_expected: bool = False
    dataset_reference: str = ""
    description: str = ""


def load_scenario(path: str | Path) -> SimLabScenario:
    """Load a SimLab scenario from a YAML file."""
    with open(path) as f:
        data = yaml.safe_load(f)

    ctx = data["machine_context"]
    components = [Component(**c) for c in ctx.get("components", [])]
    machine_context = MachineContext(
        site=ctx.get("site", ""),
        uns_path=ctx.get("uns_path", ""),
        components=components,
        tag_state=ctx.get("tag_state", {}),
    )

    fault_data = data["fault"]
    fault = FaultSpec(
        root_cause=fault_data["root_cause"],
        root_cause_component=fault_data["root_cause_component"],
        red_herrings=fault_data.get("red_herrings", []),
        correct_isolation_steps=fault_data.get("correct_isolation_steps", []),
        precursors=fault_data.get("precursors", []),
    )

    behavior_checkpoints = [
        BehaviorCheckpoint(name=name, params=cp.get("params", cp), reason=cp.get("reason", ""))
        for name, cp in data.get("behavior_checkpoints", {}).items()
    ]

    return SimLabScenario(
        id=data["id"],
        name=data["name"],
        tier=data.get("tier", 1),
        machine_type=data["machine_type"],
        source=data.get("source", "hand_crafted"),
        tags=data.get("tags", []),
        machine_context=machine_context,
        fault=fault,
        behavior_checkpoints=behavior_checkpoints,
        turns=data.get("turns", []),
        expected_final_state=data.get("expected_final_state", "DIAGNOSIS"),
        max_turns=data.get("max_turns", 8),
        expected_keywords=data.get("expected_keywords", []),
        forbidden_keywords=data.get("forbidden_keywords", []),
        wo_expected=data.get("wo_expected", False),
        safety_expected=data.get("safety_expected", False),
        dataset_reference=data.get("dataset_reference", ""),
        description=data.get("description", ""),
    )


def load_all_scenarios(scenarios_dir: str | Path | None = None) -> list[SimLabScenario]:
    """Load all YAML scenarios from the scenarios/ directory."""
    if scenarios_dir is None:
        scenarios_dir = Path(__file__).parent / "scenarios"
    scenarios_dir = Path(scenarios_dir)
    scenarios = []
    for path in sorted(scenarios_dir.glob("*.yaml")):
        try:
            scenarios.append(load_scenario(path))
        except Exception as e:
            print(f"[WARN] Failed to load {path.name}: {e}")
    return scenarios
