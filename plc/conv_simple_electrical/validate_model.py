"""Validate the electrical print model (YAML + SVG).

Checks:
 A. Orphan endpoints (every wire endpoint exists as device.terminal)
 B. No duplicate terminal ids within a device
 C. No duplicate wire numbers
 D. verified status ⇒ non-empty source
 E. e007_rs485.yaml links validation
 F. Every drafted sheet has ≥1 wire or dedicated model file
 G. SVG audit: data-wire lines match wires.yaml; status→dash correspondence
 H. Print PASS table
"""

from __future__ import annotations

import pathlib
import re
import sys

import yaml

HERE = pathlib.Path(__file__).parent
MODEL = HERE / "model"
SHEETS = HERE / "sheets"


def _load(name):
    return yaml.safe_load((MODEL / f"{name}.yaml").read_text(encoding="utf-8"))


def flatten_terminals(terms_dict):
    """Flatten nested terminal structures (PLC1 has inputs/outputs/output_commons/common; VFD1 has power_input/power_output/dc_bus/ground; others are flat lists).

    Returns dict[device_tag] = set(terminal_ids).
    """
    result = {}
    for device_tag, device_terms in terms_dict.items():
        if isinstance(device_terms, list):
            # Flat list (S0, SS1, S2, B1, PS1, PL1, PL2, M1, Q1, CB1)
            result[device_tag] = set(t["id"] for t in device_terms)
        elif isinstance(device_terms, dict):
            # Nested dict (PLC1, VFD1)
            terminal_ids = set()
            for key, val in device_terms.items():
                if isinstance(val, list):
                    terminal_ids.update(t["id"] for t in val)
            result[device_tag] = terminal_ids
    return result


def check_orphan_endpoints(wires, terminals, nodes_allowlist):
    """Check A: every wire endpoint exists as device.terminal or is in nodes_allowlist."""
    flat_terms = flatten_terminals(terminals)
    orphans = []
    for wire in wires["wires"]:
        for endpoint in [wire["from"], wire["to"]]:
            # Check if it's a node alias
            if endpoint in nodes_allowlist:
                continue
            # Check if it's a device.terminal reference
            if "." in endpoint:
                device, terminal = endpoint.rsplit(".", 1)
                if device not in flat_terms or terminal not in flat_terms[device]:
                    orphans.append(
                        f"{endpoint} (device={device} not found or terminal {terminal} not in {device})"
                    )
            else:
                orphans.append(f"{endpoint} (not a device.terminal reference)")
    return orphans


def check_dup_terminals(terminals):
    """Check B: no duplicate terminal ids within a device."""
    flat_terms = flatten_terminals(terminals)
    dups = []
    for device_tag, term_ids in flat_terms.items():
        # Re-traverse to find the actual duplicates
        seen = {}
        for key, val in (
            terminals.get(device_tag, {}).items()
            if isinstance(terminals.get(device_tag), dict)
            else []
        ):
            if isinstance(val, list):
                for t in val:
                    tid = t["id"]
                    if tid in seen:
                        dups.append(f"{device_tag}.{tid} (duplicate in {key})")
                    seen[tid] = key
        # Also check flat lists
        if isinstance(terminals.get(device_tag), list):
            seen = {}
            for t in terminals[device_tag]:
                tid = t["id"]
                if tid in seen:
                    dups.append(f"{device_tag}.{tid} (duplicate)")
                seen[tid] = True
    return dups


def check_dup_wires(wires):
    """Check C: no duplicate wire numbers."""
    seen = {}
    dups = []
    for wire in wires["wires"]:
        num = wire["proposed_number"]
        if num in seen:
            dups.append(f"{num} (seen at {seen[num]})")
        seen[num] = f"sheet={wire.get('sheet', '?')}"
    return dups


def check_verified_has_source(wires):
    """Check D: status==verified ⇒ non-empty source."""
    missing = []
    for wire in wires["wires"]:
        if wire.get("status") == "verified" and not wire.get("source"):
            missing.append(
                f"{wire['proposed_number']} ({wire['from']}->{wire['to']}) status=verified but no source"
            )
    return missing


def check_e007_links(e007_data):
    """Check E: e007_rs485.yaml links have source when verified."""
    missing = []
    for link in e007_data.get("links", []):
        if link.get("evidence") == "verified" and not link.get("source"):
            missing.append(f"E-007 link {link['wire_label']} evidence=verified but no source")
    return missing


def check_drafted_coverage(sheets, wires, e007_exists=True):
    """Check F: every drafted sheet has ≥1 wire or a dedicated model file."""
    uncovered = []
    for sheet in sheets["sheets"]:
        if sheet.get("status") == "drafted":
            sheet_id = sheet["id"]
            # Check for dedicated model file (e.g., E-007 → e007_rs485.yaml)
            model_file_variants = [
                MODEL
                / f"{sheet_id.lower().replace('-', '')}_rs485.yaml",  # e-007 → e007_rs485.yaml
                MODEL / f"{sheet_id.lower()}_rs485.yaml",
            ]
            has_model_file = any(f.exists() for f in model_file_variants)
            if has_model_file:
                continue
            # Check for wires
            sheet_wires = [w for w in wires["wires"] if w.get("sheet") == sheet_id]
            if not sheet_wires:
                uncovered.append(f"{sheet_id} (no wires; no dedicated model file)")
    return uncovered


def check_svg_audit(svg_path, wires, sheet_id):
    """Check G: SVG data-wire lines match wires.yaml; status→dash correspondence.

    Parses each <line> tag individually so the check is robust to attribute
    order (SVG.line emits stroke-dasharray BEFORE the data-* attributes).
    """
    if not svg_path.exists():
        return [f"SVG not found: {svg_path}"], 0

    svg_text = svg_path.read_text(encoding="utf-8")

    # Build wires dict for this sheet
    sheet_wires = {w["proposed_number"]: w for w in wires["wires"] if w.get("sheet") == sheet_id}

    errors = []
    seen = set()
    for tag in re.findall(r"<line[^>]*>", svg_text):
        m = re.search(r'data-wire="([^"]+)"', tag)
        if not m:
            continue
        wire_id = m.group(1)
        seen.add(wire_id)
        is_dashed = "stroke-dasharray" in tag

        if wire_id not in sheet_wires:
            errors.append(f"data-wire='{wire_id}' in SVG but not in wires.yaml for {sheet_id}")
            continue

        actual_status = sheet_wires[wire_id].get("status", "?")
        # Verified ⇔ solid; non-verified ⇔ dashed — checked per SEGMENT
        if actual_status == "verified" and is_dashed:
            errors.append(f"{wire_id}: status=verified but SVG line is dashed (should be solid)")
        elif actual_status != "verified" and not is_dashed:
            errors.append(
                f"{wire_id}: status={actual_status} but SVG line is solid (should be dashed)"
            )

    # Count distinct data-wire ids
    distinct_wires = len(seen)
    expected_wires = len(sheet_wires)

    if distinct_wires < expected_wires:
        missing = ", ".join(sorted(set(sheet_wires) - seen))
        errors.append(
            f"Only {distinct_wires} distinct data-wire tags in SVG but {expected_wires} wires defined for {sheet_id} (missing: {missing})"
        )

    return errors, distinct_wires


def main():
    try:
        terminals = _load("terminals")
        wires = _load("wires")
        sheets = _load("sheets")
        e007 = _load("e007_rs485")
    except Exception as e:
        print(f"ERROR loading YAML: {e}")
        return 1

    results = {}

    # Check A
    nodes_allowlist = wires.get("nodes", [])
    orphans = check_orphan_endpoints(wires, terminals, nodes_allowlist)
    results["A. Orphan endpoints"] = ("PASS" if not orphans else "FAIL", orphans)

    # Check B
    dups = check_dup_terminals(terminals)
    results["B. Duplicate terminal ids"] = ("PASS" if not dups else "FAIL", dups)

    # Check C
    dup_wires = check_dup_wires(wires)
    results["C. Duplicate wire numbers"] = ("PASS" if not dup_wires else "FAIL", dup_wires)

    # Check D
    missing_src = check_verified_has_source(wires)
    results["D. Verified status has source"] = ("PASS" if not missing_src else "FAIL", missing_src)

    # Check E
    e007_missing = check_e007_links(e007)
    results["E. E-007 links"] = ("PASS" if not e007_missing else "FAIL", e007_missing)

    # Check F
    uncovered = check_drafted_coverage(sheets, wires)
    results["F. Drafted sheet coverage"] = ("PASS" if not uncovered else "FAIL", uncovered)

    # Check G - SVG audit
    svg_errors = {}
    for svg_name in ["E-003_vfd_power", "E-006_plc_outputs"]:
        sheet_id = svg_name.split("_")[0]
        svg_path = SHEETS / f"{svg_name}.svg"
        errs, count = check_svg_audit(svg_path, wires, sheet_id)
        svg_errors[sheet_id] = (errs, count)

    all_svg_errs = []
    for sheet_id, (errs, count) in svg_errors.items():
        all_svg_errs.extend(errs)
    results["G. SVG audit (data-wire)"] = ("PASS" if not all_svg_errs else "FAIL", all_svg_errs)

    # Check H - Print PASS table
    print("\n" + "=" * 80)
    print("VALIDATION RESULTS")
    print("=" * 80)

    all_pass = True
    for check_name, (status, issues) in sorted(results.items()):
        status_sym = "[PASS]" if status == "PASS" else "[FAIL]"
        print(f"{status_sym:10} {check_name}")
        if issues:
            all_pass = False
            for issue in issues[:3]:  # Show first 3
                print(f"           - {issue}")
            if len(issues) > 3:
                print(f"           - ... and {len(issues) - 3} more")

    print("\n" + "=" * 80)
    if all_pass:
        print("ALL CHECKS PASSED")
        print("=" * 80)
        return 0
    else:
        print("SOME CHECKS FAILED")
        print("=" * 80)
        return 1


if __name__ == "__main__":
    sys.exit(main())
