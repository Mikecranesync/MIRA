"""Deterministic interrogator for an Ignition tag export (the ProveIt Discovery Recorder tool).

This is the "interrogate by code first, LLM second" tool: given an Ignition tag-export JSON, it
parses the tree into MIRA's vendor-neutral IR (via the in-repo `mira_plc_parser` Ignition parser),
classifies every signal leaf into a reusable archetype, and emits a structural report -- topology
counts, the area->line->asset hierarchy, an archetype histogram, and a per-asset family verdict
(discrete-MES vs continuous-process).

It exists because a real Ignition/Sepasoft MES-OEE export is a *UDT metadata model*, not a list of
live tags: a single Filler's ~74 nodes are ~8 live values wrapped in static UDT metadata. A
deterministic pass that separates the live values from the metadata makes the export legible BEFORE
any LLM is asked a question about it -- and never depends on the licensed corpus (it defaults to the
committed synthetic mini fixture).

Read-only, stdlib-only (+ the in-repo parser). No network. Pure, importable, testable functions.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The parser package lives at <worktree>/mira-plc-parser. This file is at
# <worktree>/discovery_corpus/scripts/interrogate_ignition_export.py, so parents[2] is the worktree
# root. Insert that parser dir on sys.path so we can import the in-repo parser without installing it.
_PARSER_DIR = Path(__file__).resolve().parents[2] / "mira-plc-parser"
if str(_PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(_PARSER_DIR))

from mira_plc_parser.parsers import ignition_json  # noqa: E402  (path-dependent import)

# Default target: the committed SYNTHETIC factory fixture (discovery_corpus/fixtures/). It mirrors the
# STRUCTURAL SHAPE of the licensed Cappy evidence without any licensed names/values. The licensed
# Cappy Hour corpus is never committed and is never the default -- pass its path explicitly on a
# machine that has it.
DEFAULT_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic_factory_export.json"

# ---- archetype taxonomy ------------------------------------------------------------------------
# Each signal leaf (a dotted name from the asset, e.g. "Counts.Outfeed.Value.Value") plus its
# engineering unit is classified into exactly one of these. The order of checks below encodes the
# precedence: static metadata first (a NumberFormat leaf is metadata even if its parent is a count),
# then the live live_* families, then unit-driven analog, then unknown.

ARCHETYPES = (
    "static_metadata",
    "live_bool",
    "live_counter",
    "live_state",
    "live_analog",
    "unknown",
)

# Leaf-name tokens (the final dotted segment, case-insensitive) that are STATIC UDT metadata. These
# are the Sepasoft/Ignition MES-OEE model's descriptive scaffolding, never a live value.
_STATIC_LEAVES = {
    "numberformat",
    "unitsofmeasure",
    "string",
    "stringvaluehigh",
    "stringvaluelow",
    "typeid",
    "typename",
    "id",
    "name",  # NOTE: "State.Name" is handled as live_state BEFORE this set is consulted.
    "description",
    "minimum",
    "maximum",
    "min",
    "max",
    "span",
    "range",
    "tolerance",
    "idealcycletime",
    "familyid",
    "familyname",
    "parentid",
    "path",
    "logid",
    "logtrigger",
    "fromid",
    "fromname",  # NOTE: "State.FromName" is live_state, handled before this set.
    "last changed on",
    "percentclipped",
    "stringpercent",
}

# Dotted-name prefixes that are entirely static metadata subtrees, regardless of leaf.
_STATIC_PREFIXES = ("definition.", "material.item.")

# Engineering units that mark a CONTINUOUS-PROCESS analog (tanks / vats). Used both for archetype
# classification (live_analog) and for the per-asset family verdict.
_PROCESS_UNITS = {
    "l/min",
    "m³",  # m³
    "kg/l",
    "°c",  # °C
    "mpa·s",  # mPa·s
    "kg/m³",  # kg/m³
    "bar",
    "l",
    "gal",
    "ft",
    "kg",
}

# The full set of units that classify a leaf as live_analog when not otherwise classified. Superset
# of the process units plus the discrete-line analogs (%, s, m, mA).
_ANALOG_UNITS = _PROCESS_UNITS | {"%", "s", "m", "ma"}


def _leaf(name: str) -> str:
    """Final dotted segment, lowercased."""
    return name.rsplit(".", 1)[-1].strip().lower()


def classify_signal(name: str, unit: str) -> str:
    """Classify one signal leaf by its dotted name + engineering unit into an archetype.

    Precedence (first match wins):
      1. static metadata subtree prefix (Definition.*, Material.Item.*)
      2. live_state  (State.Name / State.FromName / a *Duration* with *Seconds*/*Value*)
      3. static metadata leaf name (NumberFormat, TypeId, Min, ...)
      4. live_bool   (*.Running, Blocked/Starved *.Value.Value)
      5. live_counter(Counts.*.Value.Value, or a *.Value.Value carrying unit "Units")
      6. live_analog (carries a recognised engineering unit)
      7. unknown
    """
    lname = (name or "").strip().lower()
    leaf = _leaf(name or "")
    u = (unit or "").strip().lower()

    # 1. whole-subtree static metadata
    if any(lname.startswith(p) for p in _STATIC_PREFIXES):
        return "static_metadata"

    # 2. live_state -- check before the static-leaf set so State.Name / State.FromName win over the
    # generic "name"/"fromname" metadata tokens, and durations win over a bare "value".
    if lname.startswith("state."):
        if leaf in ("name", "fromname"):
            return "live_state"
        if "duration" in lname and ("seconds" in lname or "value" in lname):
            return "live_state"
    if "duration" in lname and ("seconds" in lname or leaf == "value"):
        return "live_state"

    # 3. static metadata leaf
    if leaf in _STATIC_LEAVES:
        return "static_metadata"

    # 4. live_bool
    if leaf == "running":
        return "live_bool"
    if lname.endswith(".value.value") or leaf == "value":
        parent = lname.rsplit(".value.value", 1)[0] if lname.endswith(".value.value") else lname
        # ...Blocked.Value.Value / ...Starved.Value.Value
        if parent.endswith("blocked") or parent.endswith("starved"):
            return "live_bool"

    # 5. live_counter -- Counts.<x>.Value.Value, or any *.Value.Value carrying the "Units" unit.
    if "counts." in lname and lname.endswith(".value.value"):
        return "live_counter"
    if u == "units" and (lname.endswith(".value.value") or leaf == "value"):
        return "live_counter"

    # 6. live_analog -- any recognised engineering unit not already classified.
    if u in _ANALOG_UNITS:
        return "live_analog"

    # 7. fallback
    return "unknown"


def load(path: str | Path) -> "ignition_json.PLCProject":  # type: ignore[name-defined]
    """Parse an Ignition tag export file into a PLCProject (read-only, stdlib JSON via the parser)."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    return ignition_json.parse(text, source_file=str(p))


def _is_process_unit(unit: str) -> bool:
    return (unit or "").strip().lower() in _PROCESS_UNITS


def interrogate(project) -> dict:
    """Produce the structural interrogation report for a parsed PLCProject."""
    counts = {lvl: 0 for lvl in ("enterprise", "site", "area", "line", "asset", "signal")}
    hierarchy: dict[str, dict[str, list[str]]] = {}
    archetypes = {a: 0 for a in ARCHETYPES}
    signals_with_units = 0
    asset_family: dict[str, str] = {}
    asset_is_process: dict[str, bool] = {}

    # current containment context as we stream the (depth-first ordered) namespace list
    cur_area = None
    cur_line = None
    cur_asset = None

    for node in project.namespace:
        level = node.level
        if level in counts:
            counts[level] += 1

        if level == "area":
            cur_area = node.name
            cur_line = None
            cur_asset = None
            hierarchy.setdefault(cur_area, {})
        elif level == "line":
            cur_line = node.name
            cur_asset = None
            if cur_area is not None:
                hierarchy.setdefault(cur_area, {}).setdefault(cur_line, [])
        elif level == "asset":
            cur_asset = node.name
            asset_family.setdefault(cur_asset, "discrete_mes")
            asset_is_process.setdefault(cur_asset, False)
            if cur_area is not None and cur_line is not None:
                hierarchy.setdefault(cur_area, {}).setdefault(cur_line, [])
                if cur_asset not in hierarchy[cur_area][cur_line]:
                    hierarchy[cur_area][cur_line].append(cur_asset)
        elif level == "signal":
            arch = classify_signal(node.name, node.unit)
            archetypes[arch] = archetypes.get(arch, 0) + 1
            if (node.unit or "").strip():
                signals_with_units += 1
            if cur_asset is not None and _is_process_unit(node.unit):
                asset_is_process[cur_asset] = True

    # resolve family from the process-unit flag
    for asset, is_proc in asset_is_process.items():
        asset_family[asset] = "continuous_process" if is_proc else "discrete_mes"

    return {
        "counts": counts,
        "hierarchy": hierarchy,
        "archetypes": archetypes,
        "signals_with_units": signals_with_units,
        "asset_family": asset_family,
    }


def assess_claims(project, report: dict) -> list[dict]:
    """Turn the structural interrogation into a list of REPRODUCIBLE claim verdicts.

    Each claim is a falsifiable statement about the dataset, a boolean ``verdict`` computed from the
    parsed IR (never from prose), and the ``evidence`` that produced it. This is what makes Phase 0
    "interrogate by code first": every important conclusion is backed by an executable check that a
    test re-runs against the synthetic fixture.
    """
    ns = project.namespace
    sigs = [n for n in ns if n.level == "signal"]
    assets = [n for n in ns if n.level == "asset"]
    arch = report["archetypes"]
    counts = report["counts"]
    names = [(n.name or "").lower() for n in sigs]

    # --- evidence primitives (all derived from the IR) ---
    controllers = list(getattr(project, "controllers", []) or [])
    routines = list(project.all_routines()) if hasattr(project, "all_routines") else []
    has_control_logic = bool(controllers) or bool(routines)
    all_dtype_empty = bool(sigs) and all(not (getattr(n, "data_type", "") or "").strip() for n in sigs)
    mes_marker_assets = [
        a for a in assets
        if (getattr(a, "mes_path", "") or "").strip()
        or "models/equipment" in (getattr(a, "udt_type", "") or "").lower()
    ]
    has_counts = arch.get("live_counter", 0) > 0 or any("counts." in n for n in names)
    has_state = arch.get("live_state", 0) > 0 or any(n.startswith("state.") for n in names)
    has_blocked = any("blocked" in n for n in names)
    has_starved = any("starved" in n for n in names)
    has_production_run = any(n.startswith("productionrun.") for n in names)
    has_hierarchy = counts["asset"] > 0 and counts["line"] > 0 and counts["area"] > 0

    def claim(cid, statement, verdict, evidence):
        return {"id": cid, "statement": statement, "verdict": bool(verdict), "evidence": evidence}

    return [
        claim(
            "C1", "This data is MES/OEE-shaped, not PLC-control-shaped",
            (len(ns) > 0) and (not has_control_logic) and bool(mes_marker_assets)
            and (has_counts or has_state or has_production_run),
            {
                "namespace_nodes": len(ns),
                "has_control_logic": has_control_logic,
                "assets_with_mes_markers": len(mes_marker_assets),
                "has_production_run": has_production_run,
                "all_signal_data_types_empty": all_dtype_empty,
            },
        ),
        claim(
            "C2", "This contains production counts and state fields",
            has_counts and has_state,
            {
                "live_counter_signals": arch.get("live_counter", 0),
                "live_state_signals": arch.get("live_state", 0),
                "has_counts_names": any("counts." in n for n in names),
                "has_state_names": any(n.startswith("state.") for n in names),
            },
        ),
        claim(
            "C3", "This implies an asset/line/cell hierarchy",
            has_hierarchy,
            {k: counts[k] for k in ("enterprise", "site", "area", "line", "asset")},
        ),
        claim(
            "C4", "This does NOT contain ladder/ST/control logic",
            not has_control_logic,
            {"controllers": len(controllers), "routines": len(routines)},
        ),
        claim(
            "C5", "This can be used as upstream evidence to infer hidden maintenance/component causes",
            (has_blocked or has_starved) and (has_counts or has_state),
            {
                "exposes_blocked": has_blocked,
                "exposes_starved": has_starved,
                "exposes_counts": has_counts,
                "exposes_state": has_state,
                "note": "blocked/starved/counts/state are the SYMPTOM layer onto which hidden causes "
                        "(failed sensor, jammed conveyor, VFD fault, motor overload, air, comms, "
                        "interlock) are inferred in Phase 2/3.",
            },
        ),
    ]


def _format_claims(claims: list[dict]) -> str:
    lines = ["reproducible claims (each backed by an executable check):"]
    for c in claims:
        mark = "PASS" if c["verdict"] else "FAIL"
        lines.append("  [%s] %s: %s" % (mark, c["id"], c["statement"]))
        ev = ", ".join("%s=%s" % (k, v) for k, v in c["evidence"].items() if k != "note")
        lines.append("        evidence: %s" % ev)
    return "\n".join(lines)


def _format_report(report: dict, source: str) -> str:
    c = report["counts"]
    lines = []
    lines.append("=" * 68)
    lines.append("IGNITION EXPORT INTERROGATION")
    lines.append("source: %s" % source)
    lines.append("=" * 68)
    lines.append(
        "topology: %d enterprise / %d site / %d area / %d line / %d asset / %d signal"
        % (c["enterprise"], c["site"], c["area"], c["line"], c["asset"], c["signal"])
    )
    lines.append("signals carrying an engineering unit: %d" % report["signals_with_units"])
    lines.append("")
    lines.append("hierarchy (area -> line -> assets):")
    for area, lines_map in report["hierarchy"].items():
        lines.append("  %s" % area)
        for line_name, assets in lines_map.items():
            lines.append("    %s: %s" % (line_name, ", ".join(assets) if assets else "(no assets)"))
    lines.append("")
    lines.append("signal archetype histogram:")
    total = sum(report["archetypes"].values()) or 1
    for arch in ARCHETYPES:
        n = report["archetypes"].get(arch, 0)
        bar = "#" * int(40 * n / total)
        lines.append("  %-16s %5d  %s" % (arch, n, bar))
    lines.append("")
    lines.append("asset family verdict:")
    for asset, fam in report["asset_family"].items():
        lines.append("  %-24s %s" % (asset, fam))
    lines.append("=" * 68)
    return "\n".join(lines)


def render(report: dict, claims: list[dict], source: str) -> str:
    """Full human-readable report = topology/hierarchy/archetypes + the reproducible claim verdicts."""
    return _format_report(report, source) + "\n\n" + _format_claims(claims)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Deterministically interrogate an Ignition tag export (read-only)."
    )
    ap.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_FIXTURE),
        help="Path to an Ignition tag-export JSON (default: the committed synthetic factory fixture).",
    )
    ap.add_argument("--json", action="store_true", help="Emit the report + claims as machine-readable JSON.")
    args = ap.parse_args(argv)

    project = load(args.path)
    report = interrogate(project)
    claims = assess_claims(project, report)

    if args.json:
        print(json.dumps({"report": report, "claims": claims}, indent=2, ensure_ascii=False))
    else:
        print(render(report, claims, args.path))
        if project.warnings:
            print("\nparser warnings:")
            for w in project.warnings:
                print("  - %s" % w)
    # nonzero exit if any claim fails -- makes the CLI itself a gate.
    return 0 if all(c["verdict"] for c in claims) else 1


if __name__ == "__main__":
    raise SystemExit(main())
