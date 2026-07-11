"""Validate the electrical print model (YAML + SVG + rendered PDF).

Checks:
 A. Orphan endpoints (every wire endpoint exists as device.terminal or allowlisted node)
 B. No duplicate terminal ids within a device
 C. No duplicate wire numbers
 D. verified status => non-empty source
 E. e007_rs485.yaml links validation
 F. Every drafted sheet has >=1 wire or a dedicated model (E-001 cover exempt)
 G. SVG audit: solid <line data-wire> XOR dashed <g data-wire data-dashed>; dashed <=> not verified
 H. Dash construction: every dashed group holds >=3 real child segments (converter-proof)
 I. Raster parity: PDF vector line count >= 0.9 x SVG conductor segment count
 J. E-001 schedule parity: one schedule row per device, one index row per sheet
 K. No render-only engineering text: blocklist markers must not appear in render_sheet.py literals
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys

import yaml

HERE = pathlib.Path(__file__).parent
MODEL = HERE / "model"
SHEETS = HERE / "sheets"

SHEET_SVGS = {
    "E-003": "E-003_vfd_power",
    "E-005": "E-005_plc_inputs",
    "E-006": "E-006_plc_outputs",
    "E-007": "E-007_rs485_modbus",
}
ALL_SVGS = dict(SHEET_SVGS, **{"E-001": "E-001_cover"})

# Engineering-content markers that must never appear in render_sheet.py string
# literals (the strings live in the model YAML now). Comments/docstrings exempt.
K_BLOCKLIST = [
    "NFPA",
    "0x20",
    "P00.",
    "P09.",
    "L17",
    "L19",
    "kbps",
    "8N1",
    "8N2",
    "REV+RUN",
    "DC-bus",
    "LOTO",
]


def _load(name):
    return yaml.safe_load((MODEL / f"{name}.yaml").read_text(encoding="utf-8"))


def flatten_terminals(terms_dict):
    """Flatten nested terminal structures into dict[device_tag] -> set(terminal ids).

    PLC1 has inputs/outputs/output_commons/common lists; VFD1 has
    power_input/power_output/dc_bus/ground; other devices are flat lists.
    """
    result = {}
    for device_tag, device_terms in terms_dict.items():
        if isinstance(device_terms, list):
            result[device_tag] = set(t["id"] for t in device_terms)
        elif isinstance(device_terms, dict):
            terminal_ids = set()
            for val in device_terms.values():
                if isinstance(val, list):
                    terminal_ids.update(t["id"] for t in val)
            result[device_tag] = terminal_ids
    return result


def sheet_wire_statuses(wires, e007, sheet_id):
    """{wire label: status} for one sheet (E-007 keys on wire_label/evidence)."""
    if sheet_id == "E-007":
        return {ln["wire_label"]: ln.get("evidence", "?") for ln in e007.get("links", [])}
    return {
        w["proposed_number"]: w.get("status", "?")
        for w in wires["wires"]
        if w.get("sheet") == sheet_id
    }


def check_orphan_endpoints(wires, terminals, nodes_allowlist):
    """Check A: every wire endpoint exists as device.terminal or is in nodes allowlist."""
    flat_terms = flatten_terminals(terminals)
    orphans = []
    for wire in wires["wires"]:
        for endpoint in [wire["from"], wire["to"]]:
            if endpoint in nodes_allowlist:
                continue
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
    dups = []
    for device_tag, device_terms in terminals.items():
        seen = set()
        groups = device_terms.values() if isinstance(device_terms, dict) else [device_terms]
        for group in groups:
            if not isinstance(group, list):
                continue
            for t in group:
                tid = t["id"]
                if tid in seen:
                    dups.append(f"{device_tag}.{tid} (duplicate)")
                seen.add(tid)
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
    """Check D: status==verified => non-empty source."""
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


def check_drafted_coverage(sheets, wires):
    """Check F: every drafted sheet has >=1 wire or a dedicated model file.

    E-001 (cover/legend) is exempt: its model IS devices.yaml + sheets.yaml +
    the wires.yaml convention — it carries no conductors by design.
    """
    uncovered = []
    for sheet in sheets["sheets"]:
        if sheet.get("status") != "drafted":
            continue
        sheet_id = sheet["id"]
        if sheet_id == "E-001":
            continue
        model_file_variants = [
            MODEL / f"{sheet_id.lower().replace('-', '')}_rs485.yaml",
            MODEL / f"{sheet_id.lower()}_rs485.yaml",
        ]
        if any(f.exists() for f in model_file_variants):
            continue
        sheet_wires = [w for w in wires["wires"] if w.get("sheet") == sheet_id]
        if not sheet_wires:
            uncovered.append(f"{sheet_id} (no wires; no dedicated model file)")
    return uncovered


def _conductor_elements(svg_text):
    """Yield (wire_id, is_dashed, open_tag, body) for every conductor element.

    Conductors are either a solid <line data-wire=...> (body None) or a dashed
    <g data-dashed="true" data-wire=...> whose body holds the real segments.
    """
    for tag in re.findall(r"<line[^>]*/>", svg_text):
        m = re.search(r'data-wire="([^"]+)"', tag)
        if m:
            yield m.group(1), False, tag, None
    for m in re.finditer(r'(<g[^>]*data-dashed="true"[^>]*>)(.*?)</g>', svg_text, re.DOTALL):
        open_tag, body = m.group(1), m.group(2)
        wm = re.search(r'data-wire="([^"]+)"', open_tag)
        if wm:
            yield wm.group(1), True, open_tag, body


def check_svg_audit(svg_path, sheet_wires, sheet_id):
    """Check G: every conductor's data-wire exists in the model; dashed <=> not verified."""
    if not svg_path.exists():
        return [f"SVG not found: {svg_path}"], 0

    svg_text = svg_path.read_text(encoding="utf-8")
    errors = []
    seen = set()
    for wire_id, is_dashed, _tag, _body in _conductor_elements(svg_text):
        seen.add(wire_id)
        if wire_id not in sheet_wires:
            errors.append(f"data-wire='{wire_id}' in SVG but not in the model for {sheet_id}")
            continue
        status = sheet_wires[wire_id]
        if status == "verified" and is_dashed:
            errors.append(f"{wire_id}: status=verified but rendered dashed (should be solid)")
        elif status != "verified" and not is_dashed:
            errors.append(f"{wire_id}: status={status} but rendered solid (should be dashed)")

    if len(seen) < len(sheet_wires):
        missing = ", ".join(sorted(set(sheet_wires) - seen))
        errors.append(
            f"Only {len(seen)} distinct data-wire tags in SVG but {len(sheet_wires)} wires defined for {sheet_id} (missing: {missing})"
        )
    return errors, len(seen)


def check_dash_construction(svg_path, sheet_id):
    """Check H: every dashed group contains >=3 real child <line> segments."""
    if not svg_path.exists():
        return [f"SVG not found: {svg_path}"]
    svg_text = svg_path.read_text(encoding="utf-8")
    errors = []
    for i, m in enumerate(
        re.finditer(r'(<g[^>]*data-dashed="true"[^>]*>)(.*?)</g>', svg_text, re.DOTALL)
    ):
        n_segs = len(re.findall(r"<line[^>]*/>", m.group(2)))
        if n_segs < 3:
            wm = re.search(r'data-wire="([^"]+)"', m.group(1))
            who = wm.group(1) if wm else f"group #{i}"
            errors.append(f"{sheet_id}: dashed group {who} has only {n_segs} segments (<3)")
    # stroke-dasharray must not be relied on anywhere
    if "stroke-dasharray" in svg_text:
        errors.append(f"{sheet_id}: stroke-dasharray present (converter drops it — forbidden)")
    return errors


def _svg_conductor_segment_count(svg_text):
    """Count conductor segments: solid data-wire lines + children of data-wire dashed groups."""
    count = 0
    for _wire_id, is_dashed, _tag, body in _conductor_elements(svg_text):
        count += len(re.findall(r"<line[^>]*/>", body)) if is_dashed else 1
    return count


def check_raster_parity(sheet_id, basename):
    """Check I: the PDF a human receives holds >= 0.9x the SVG's conductor segments."""
    svg_path = SHEETS / f"{basename}.svg"
    pdf_path = SHEETS / f"{basename}.pdf"
    if not svg_path.exists() or not pdf_path.exists():
        return [f"{sheet_id}: missing {svg_path.name} or {pdf_path.name}"]
    svg_count = _svg_conductor_segment_count(svg_path.read_text(encoding="utf-8"))
    import fitz

    doc = fitz.open(pdf_path)
    try:
        pdf_lines = 0
        for page in doc:
            for drawing in page.get_drawings():
                for item in drawing["items"]:
                    if item[0] == "l":
                        pdf_lines += 1
    finally:
        doc.close()
    if pdf_lines < 0.9 * svg_count:
        return [
            f"{sheet_id}: PDF has {pdf_lines} vector lines < 0.9 x {svg_count} SVG conductor segments"
        ]
    return []


def check_schedule_parity(devices, sheets):
    """Check J: E-001 has exactly one schedule row per device + one index row per sheet."""
    svg_path = SHEETS / "E-001_cover.svg"
    if not svg_path.exists():
        return [f"SVG not found: {svg_path}"]
    svg_text = svg_path.read_text(encoding="utf-8")
    errors = []

    sched = re.findall(r'<text[^>]*class="schedule-tag"[^>]*>([^<]*)</text>', svg_text)
    want_tags = [d["tag"] for d in devices["devices"]]
    if sorted(sched) != sorted(want_tags):
        errors.append(f"schedule rows {sorted(sched)} != devices.yaml tags {sorted(want_tags)}")

    idx = re.findall(r'<text[^>]*class="index-id"[^>]*>([^<]*)</text>', svg_text)
    want_ids = [sh["id"] for sh in sheets["sheets"]]
    if sorted(idx) != sorted(want_ids):
        errors.append(f"index rows {sorted(idx)} != sheets.yaml ids {sorted(want_ids)}")
    return errors


def check_no_render_engineering_text():
    """Check K: blocklist markers must not appear in render_sheet.py string literals.

    Docstrings (first statement of module/class/function bodies) and comments
    (absent from the AST) are exempt. f-string constant fragments ARE checked.
    """
    src_path = HERE / "render_sheet.py"
    src = src_path.read_text(encoding="utf-8")
    tree = ast.parse(src)

    docstring_nodes = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    docstring_nodes.add(id(body[0].value))

    errors = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) in docstring_nodes:
                continue
            for marker in K_BLOCKLIST:
                if marker in node.value:
                    errors.append(
                        f"render_sheet.py:{node.lineno}: literal contains '{marker}': {node.value[:60]!r}"
                    )
    return errors


def main():
    try:
        devices = _load("devices")
        terminals = _load("terminals")
        wires = _load("wires")
        sheets = _load("sheets")
        e007 = _load("e007_rs485")
    except Exception as e:
        print(f"ERROR loading YAML: {e}")
        return 1

    results = {}

    nodes_allowlist = wires.get("nodes", [])
    orphans = check_orphan_endpoints(wires, terminals, nodes_allowlist)
    results["A. Orphan endpoints"] = ("PASS" if not orphans else "FAIL", orphans)

    dups = check_dup_terminals(terminals)
    results["B. Duplicate terminal ids"] = ("PASS" if not dups else "FAIL", dups)

    dup_wires = check_dup_wires(wires)
    results["C. Duplicate wire numbers"] = ("PASS" if not dup_wires else "FAIL", dup_wires)

    missing_src = check_verified_has_source(wires)
    results["D. Verified status has source"] = ("PASS" if not missing_src else "FAIL", missing_src)

    e007_missing = check_e007_links(e007)
    results["E. E-007 links"] = ("PASS" if not e007_missing else "FAIL", e007_missing)

    uncovered = check_drafted_coverage(sheets, wires)
    results["F. Drafted sheet coverage"] = ("PASS" if not uncovered else "FAIL", uncovered)

    # G: SVG conductor audit on all four wired sheets
    g_errors = []
    g_counts = []
    for sheet_id, basename in SHEET_SVGS.items():
        sw = sheet_wire_statuses(wires, e007, sheet_id)
        errs, count = check_svg_audit(SHEETS / f"{basename}.svg", sw, sheet_id)
        g_errors.extend(errs)
        g_counts.append(f"{sheet_id}:{count}/{len(sw)}")
    results[f"G. SVG audit ({' '.join(g_counts)})"] = ("PASS" if not g_errors else "FAIL", g_errors)

    # H: dash construction on all five sheets
    h_errors = []
    for sheet_id, basename in ALL_SVGS.items():
        h_errors.extend(check_dash_construction(SHEETS / f"{basename}.svg", sheet_id))
    results["H. Dash construction (>=3 segments)"] = ("PASS" if not h_errors else "FAIL", h_errors)

    # I: raster parity on all five sheet PDFs
    i_errors = []
    for sheet_id, basename in ALL_SVGS.items():
        i_errors.extend(check_raster_parity(sheet_id, basename))
    results["I. Raster parity (PDF vs SVG)"] = ("PASS" if not i_errors else "FAIL", i_errors)

    # J: E-001 schedule/index parity
    j_errors = check_schedule_parity(devices, sheets)
    results["J. E-001 schedule parity"] = ("PASS" if not j_errors else "FAIL", j_errors)

    # K: no render-only engineering text
    k_errors = check_no_render_engineering_text()
    results["K. No render-only engineering text"] = ("PASS" if not k_errors else "FAIL", k_errors)

    print("\n" + "=" * 80)
    print("VALIDATION RESULTS")
    print("=" * 80)

    all_pass = True
    for check_name, (status, issues) in sorted(results.items()):
        status_sym = "[PASS]" if status == "PASS" else "[FAIL]"
        print(f"{status_sym:10} {check_name}")
        if issues:
            all_pass = False
            for issue in issues[:4]:
                print(f"           - {issue}")
            if len(issues) > 4:
                print(f"           - ... and {len(issues) - 4} more")

    print("\n" + "=" * 80)
    if all_pass:
        print("ALL CHECKS PASSED")
        print("=" * 80)
        return 0
    print("SOME CHECKS FAILED")
    print("=" * 80)
    return 1


if __name__ == "__main__":
    sys.exit(main())
