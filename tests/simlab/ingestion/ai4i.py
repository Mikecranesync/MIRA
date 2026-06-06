#!/usr/bin/env python3
"""AI4I 2020 Predictive Maintenance dataset ingestion.

Downloads the UCI AI4I 2020 Predictive Maintenance Dataset and generates
SimLab scenario YAML seeds. The dataset has 10k rows with 5 failure modes:
  TWF  — Tool Wear Failure
  HDF  — Heat Dissipation Failure
  PWF  — Power Failure
  OSF  — Overstrain Failure
  RNF  — Random Failure (excluded — no mechanical root cause pattern)

Each failure mode maps to an industrial machine fault scenario template.
The ingestion picks representative rows (p25/p50/p75 of the failure-mode
distribution) to seed realistic tag values.

Usage:
    python3 tests/simlab/ingestion/ai4i.py --out tests/simlab/scenarios/
    python3 tests/simlab/ingestion/ai4i.py --out tests/simlab/scenarios/ --dry-run
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("simlab-ai4i")

_DATASET_URL = "https://archive.ics.uci.edu/static/public/601/ai4i2020.csv"
_CACHE_PATH = Path(__file__).parent / "_ai4i2020_cache.csv"


# ── Data loading ──────────────────────────────────────────────────────────────


def _fetch_dataset(use_cache: bool = True) -> list[dict[str, str]]:
    """Download or load cached AI4I 2020 dataset. Returns rows as dicts."""
    if use_cache and _CACHE_PATH.exists():
        logger.info("Loading cached dataset from %s", _CACHE_PATH)
        with open(_CACHE_PATH, newline="") as f:
            return list(csv.DictReader(f))

    logger.info("Downloading AI4I 2020 dataset from %s", _DATASET_URL)
    try:
        with urllib.request.urlopen(_DATASET_URL, timeout=30) as resp:
            content = resp.read().decode("utf-8")
    except Exception as e:
        raise RuntimeError(f"Failed to download AI4I dataset: {e}") from e

    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(content)
    return list(csv.DictReader(io.StringIO(content)))


def _rows_for_failure(rows: list[dict], failure_col: str) -> list[dict]:
    """Return only rows where the given failure column is 1."""
    return [r for r in rows if r.get(failure_col, "0").strip() == "1"]


def _percentile_row(rows: list[dict], feature: str, pct: float) -> dict | None:
    """Return the row closest to the given percentile of a numeric feature."""
    if not rows:
        return None
    try:
        values = [float(r[feature]) for r in rows]
    except (KeyError, ValueError):
        return None
    target = sorted(values)[int(len(values) * pct)]
    closest = min(rows, key=lambda r: abs(float(r[feature]) - target))
    return closest


# ── Tag-value extraction ──────────────────────────────────────────────────────


def _extract_tags(row: dict) -> dict[str, Any]:
    """Build a realistic tag_state dict from an AI4I dataset row."""
    def fval(col: str, default: float = 0.0) -> float:
        try:
            return round(float(row.get(col, default)), 2)
        except ValueError:
            return default

    air_k = fval("Air temperature [K]")
    proc_k = fval("Process temperature [K]")
    rpm = fval("Rotational speed [rpm]")
    torque = fval("Torque [Nm]")
    wear = fval("Tool wear [min]")

    # Convert Kelvin to Celsius for display
    air_c = round(air_k - 273.15, 1) if air_k > 200 else air_k
    proc_c = round(proc_k - 273.15, 1) if proc_k > 200 else proc_k

    return {
        "motor.air_temp_c": air_c,
        "motor.process_temp_c": proc_c,
        "motor.rpm": int(rpm),
        "motor.torque_nm": torque,
        "motor.tool_wear_min": int(wear),
        "ai4i.dataset_row": row.get("UDI", ""),
        "ai4i.machine_type": row.get("Type", ""),
    }


# ── Scenario templates per failure mode ──────────────────────────────────────


@dataclass
class ScenarioTemplate:
    failure_mode: str
    tier: int
    machine_type: str
    fault_root_cause: str
    fault_component: str
    red_herrings: list[str]
    isolation_steps: list[str]
    behavior_checkpoints: dict[str, Any]
    expected_keywords: list[str]
    forbidden_keywords: list[str]
    turns: list[dict[str, str]]
    description: str
    tags: list[str] = field(default_factory=list)


_TEMPLATES: dict[str, ScenarioTemplate] = {
    "HDF": ScenarioTemplate(
        failure_mode="HDF",
        tier=1,
        machine_type="cnc_machine",
        description=(
            "Heat dissipation failure — process temperature rise exceeds air temp differential. "
            "Root cause is clogged coolant filter reducing heat transfer. "
            "MIRA must cite temperature differential before recommending action."
        ),
        fault_root_cause="clogged_coolant_filter",
        fault_component="coolant_system",
        red_herrings=["spindle_motor", "vfd"],
        isolation_steps=[
            "Process temp minus air temp > 8.6K — heat dissipation is impaired",
            "RPM is at setpoint — motor not overloaded",
            "Check coolant flow rate and filter condition",
        ],
        behavior_checkpoints={
            "cp_isolation_evidence": {
                "params": {
                    "required_measurements": ["temperature", "temp", "differential", "coolant"]
                },
                "reason": "Must cite temp differential before recommending action",
            },
            "cp_no_cross_component_confusion": {
                "params": {"forbidden_blame": ["motor", "vfd", "spindle"]},
                "reason": "Motor and VFD are not at fault in HDF failure mode",
            },
        },
        expected_keywords=["temperature", "coolant", "heat", "differential"],
        forbidden_keywords=[],
        tags=["thermal", "coolant", "cnc", "heat-dissipation"],
        turns=[
            {"role": "user", "content": "Machine stopped on thermal fault. Air temp is 25C, process temp showing 35C on the display."},
            {"role": "user", "content": "RPM was at setpoint before the fault. VFD shows no fault code."},
            {"role": "user", "content": "Coolant filter was completely plugged. Replaced it and machine is running normally."},
        ],
    ),
    "PWF": ScenarioTemplate(
        failure_mode="PWF",
        tier=1,
        machine_type="industrial_motor",
        description=(
            "Power failure — torque times RPM outside operating power range. "
            "Root cause is worn tooling increasing cutting forces. "
            "MIRA must identify that power = torque × RPM is the fault indicator."
        ),
        fault_root_cause="worn_tool_excessive_load",
        fault_component="cutting_tool",
        red_herrings=["power_supply", "vfd", "motor"],
        isolation_steps=[
            "Power = torque × RPM / 9549 — calculate actual power draw",
            "Torque is elevated above normal range for this RPM",
            "Tool wear counter is at or near maximum — inspect/replace tooling",
        ],
        behavior_checkpoints={
            "cp_isolation_evidence": {
                "params": {
                    "required_measurements": ["torque", "rpm", "power", "load", "tool"]
                },
                "reason": "Power fault requires citing torque and RPM measurements",
            },
            "cp_subsystem_identified": {
                "params": {
                    "expected_subsystem": "tool",
                    "aliases": ["tooling", "cutting", "wear", "load"],
                },
                "reason": "Root cause is worn tooling increasing cutting load",
            },
        },
        expected_keywords=["torque", "power", "tool", "load", "wear"],
        forbidden_keywords=[],
        tags=["power", "torque", "tooling", "cnc"],
        turns=[
            {"role": "user", "content": "Machine faulted mid-cycle. Torque reading was high — around 65 Nm. RPM was 1400."},
            {"role": "user", "content": "This is the third time this week. Tool wear counter shows 210 minutes on this insert."},
            {"role": "user", "content": "Replaced the cutting insert. Torque back to normal range (40 Nm)."},
        ],
    ),
    "TWF": ScenarioTemplate(
        failure_mode="TWF",
        tier=2,
        machine_type="cnc_machine",
        description=(
            "Tool wear failure — tool wear counter exceeds threshold (200-240 min). "
            "Root cause is tool life expiration. Lightweight scenario — binary check "
            "on wear counter value. MIRA must cite wear counter before directing action."
        ),
        fault_root_cause="tool_life_expiration",
        fault_component="cutting_tool",
        red_herrings=["motor", "coolant"],
        isolation_steps=[
            "Tool wear counter at or above 200 min threshold",
            "No other fault indicators (temp, torque, power all normal)",
            "Replace cutting insert per PM schedule",
        ],
        behavior_checkpoints={
            "cp_isolation_evidence": {
                "params": {"required_measurements": ["wear", "tool", "counter", "minutes"]},
                "reason": "Tool wear counter value must be cited",
            },
        },
        expected_keywords=["tool", "wear", "replace", "insert"],
        forbidden_keywords=[],
        tags=["tool-wear", "pm", "cnc"],
        turns=[
            {"role": "user", "content": "Machine stopped with a tool wear alarm. Wear counter shows 224 minutes."},
            {"role": "user", "content": "Temperatures and torque all look normal. Just the wear counter."},
            {"role": "user", "content": "Replaced the insert. Counter reset to zero and machine running normally."},
        ],
    ),
    "OSF": ScenarioTemplate(
        failure_mode="OSF",
        tier=1,
        machine_type="cnc_machine",
        description=(
            "Overstrain failure — product of tool wear and torque exceeds safety limit. "
            "Root cause is worn tool combined with heavy cut parameters, causing spindle overload. "
            "MIRA must not blame motor or VFD before identifying the wear+torque interaction."
        ),
        fault_root_cause="worn_tool_heavy_cut_overstrain",
        fault_component="spindle_toolholder",
        red_herrings=["motor", "vfd", "power_supply"],
        isolation_steps=[
            "Overstrain fault = torque × wear product exceeds limit",
            "Check both tool wear counter AND current torque reading",
            "Reduce depth of cut or replace worn tool",
        ],
        behavior_checkpoints={
            "cp_isolation_evidence": {
                "params": {
                    "required_measurements": ["torque", "wear", "overstrain", "strain", "tool"]
                },
                "reason": "Both torque and wear measurements needed to diagnose OSF",
            },
            "cp_no_cross_component_confusion": {
                "params": {"forbidden_blame": ["motor", "vfd"]},
                "reason": "OSF is mechanical overload, not electrical component fault",
            },
            "cp_subsystem_identified": {
                "params": {
                    "expected_subsystem": "tool",
                    "aliases": ["tooling", "wear", "cut", "spindle", "overstrain"],
                },
                "reason": "Root cause is tool wear + heavy cut combination",
            },
        },
        expected_keywords=["overstrain", "torque", "wear", "tool", "cut"],
        forbidden_keywords=[],
        tags=["overstrain", "torque", "tool-wear", "cnc"],
        turns=[
            {"role": "user", "content": "Machine tripped on overstrain fault. Torque was 72 Nm at the time. Tool wear counter at 185 min."},
            {"role": "user", "content": "This is a roughing pass on steel. No motor faults or drive faults, just the overstrain."},
            {"role": "user", "content": "Reduced depth of cut and replaced the tool. No more overstrain trips."},
        ],
    ),
}


# ── YAML scenario generation ──────────────────────────────────────────────────


def _build_scenario_yaml(
    template: ScenarioTemplate,
    row: dict,
    percentile_label: str,
) -> dict:
    """Build a scenario dict ready for yaml.dump from a template + dataset row."""
    tags_from_row = _extract_tags(row)
    uid = row.get("UDI", "0").strip().zfill(5)
    scenario_id = f"ai4i_{template.failure_mode.lower()}_{uid}"

    return {
        "id": scenario_id,
        "name": f"AI4I {template.failure_mode} — {template.fault_root_cause.replace('_', ' ')} ({percentile_label})",
        "tier": template.tier,
        "machine_type": template.machine_type,
        "source": "ai4i_2020",
        "dataset_reference": f"AI4I 2020 UCI row {uid} ({template.failure_mode})",
        "tags": template.tags + ["ai4i", template.failure_mode.lower()],
        "description": template.description,
        "machine_context": {
            "site": "enterprise.simlab.ai4i",
            "uns_path": f"enterprise.simlab.ai4i.{template.machine_type}",
            "components": [
                {
                    "id": "motor_01",
                    "type": "ac_motor",
                    "description": f"AI4I machine type: {row.get('Type', 'M')}",
                }
            ],
            "tag_state": tags_from_row,
        },
        "fault": {
            "root_cause": template.fault_root_cause,
            "root_cause_component": template.fault_component,
            "red_herrings": template.red_herrings,
            "correct_isolation_steps": template.isolation_steps,
        },
        "behavior_checkpoints": template.behavior_checkpoints,
        "expected_final_state": "DIAGNOSIS",
        "max_turns": 5,
        "expected_keywords": template.expected_keywords,
        "forbidden_keywords": template.forbidden_keywords,
        "turns": template.turns,
    }


# ── CLI ───────────────────────────────────────────────────────────────────────


def _main(args: argparse.Namespace) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    rows = _fetch_dataset(use_cache=not args.no_cache)
    print(f"Loaded {len(rows)} rows from AI4I 2020 dataset")

    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)

    generated = 0
    for failure_col, template in _TEMPLATES.items():
        failure_rows = _rows_for_failure(rows, failure_col)
        print(f"  {failure_col}: {len(failure_rows)} failure rows")
        if not failure_rows:
            print(f"  [WARN] No rows found for {failure_col}, skipping")
            continue

        # Produce one scenario per percentile (median by default; p25/p75 for Tier 1)
        percentiles = [(0.50, "median")] if template.tier == 2 else [
            (0.25, "p25"), (0.50, "median"), (0.75, "p75")
        ]

        for pct, label in percentiles:
            pivot_feature = "Torque [Nm]"
            row = _percentile_row(failure_rows, pivot_feature, pct)
            if row is None:
                continue

            scenario = _build_scenario_yaml(template, row, label)
            out_path = output_dir / f"{scenario['id']}.yaml"

            if args.dry_run:
                print(f"  [DRY RUN] Would write {out_path.name}")
                continue

            with open(out_path, "w") as f:
                yaml.dump(scenario, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
            print(f"  Wrote {out_path.name}")
            generated += 1

    if not args.dry_run:
        print(f"\nGenerated {generated} scenario YAML files in {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="AI4I 2020 → SimLab scenario ingestion")
    parser.add_argument("--out", default="tests/simlab/scenarios/", help="Output directory")
    parser.add_argument("--no-cache", action="store_true", help="Force re-download")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be written")
    args = parser.parse_args()
    _main(args)


if __name__ == "__main__":
    main()
