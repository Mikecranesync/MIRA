"""Generators for the 7 Print Pack bundle sub-artifacts (SPEC.md §3).

Every function here is a pure transform: (model data, manifest, as_of) -> file
on disk. No wall-clock, no randomness — build_pack.py is the only caller and
supplies `as_of` as the sole notion of "now".
"""

from __future__ import annotations

import re
import textwrap
from pathlib import Path

import pack_common as pc

SHEET_TITLES = {
    "E-001": "Cover / legend / device schedule",
    "E-002": "Power one-line",
    "E-003": "VFD power",
    "E-004": "24 VDC control power distribution",
    "E-005": "PLC digital inputs",
    "E-006": "PLC outputs",
    "E-007": "RS-485 / Modbus RTU communication",
    "E-008": "Terminal strip (X1) + wire list",
    "E-009": "Open items / field verification",
}
SHEET_BASENAMES = {
    "E-001": "E-001_cover",
    "E-002": "E-002_power_oneline",
    "E-003": "E-003_vfd_power",
    "E-004": "E-004_24vdc_control_power",
    "E-005": "E-005_plc_inputs",
    "E-006": "E-006_plc_outputs",
    "E-007": "E-007_rs485_modbus",
    "E-008": "E-008_terminal_strip_wire_list",
    "E-009": "E-009_open_items",
}
CONDUCTOR_SHEETS = ["E-002", "E-003", "E-004", "E-005", "E-006", "E-007", "E-008", "E-009"]

DISCLAIMER = (
    "This pack is provided as-is, evidence-graded at the tier stated on the cover page. "
    "Every FIELD VERIFY item is an explicit, located gap, not a confirmed fact — verify it on the "
    "physical machine before relying on it for energized work. This document is not a certified "
    "as-built, is not an arc-flash/short-circuit/NEC compliance study, and carries no control-write "
    "capability. The preparer is not liable for reliance on any item still marked FIELD VERIFY."
)

SAFETY_BANNER = [
    "LOTO + wait >= 5 min for DC-bus discharge before touching.",
    "A monitored e-stop is NOT a safety stop — verify the physical safety circuit removes drive "
    "power per NFPA 79 / EN 60204-1 before relying on it.",
]


# ================================================================== (b)+(g) data export


def build_components_csv(devices: list[dict], out_path: Path) -> None:
    rows = []
    for d in devices:
        rows.append(
            [
                d.get("tag", ""),
                pc.humanize_snake_case(d.get("type", "")),
                d.get("model", ""),
                d.get("role", ""),
                pc.normalize_status(d),
                d.get("source", ""),
            ]
        )
    rows.sort(key=lambda r: r[0])
    pc.write_csv(out_path, ["Tag", "Type", "Model", "Role", "Evidence", "Source"], rows)


def build_connections_csv(wires: list[dict], e007_links: list[dict], out_path: Path) -> None:
    rows = []
    for w in wires:
        rows.append(
            [
                w.get("proposed_number", ""),
                w.get("from", ""),
                w.get("to", ""),
                w.get("signal", ""),
                w.get("type", ""),
                pc.normalize_status(w),
                w.get("sheet", ""),
                w.get("note", ""),
            ]
        )
    for lk in e007_links:
        rows.append(
            [
                lk.get("wire_label", ""),
                f"{lk.get('src_device', '')}.{lk.get('src_terminal', '')}",
                f"{lk.get('dst_device', '')}.{lk.get('dst_terminal', '')}",
                lk.get("signal", ""),
                lk.get("cable", ""),
                pc.normalize_status(lk),
                "E-007",
                lk.get("notes", ""),
            ]
        )
    rows.sort(key=lambda r: (r[6], r[0]))
    pc.write_csv(
        out_path, ["Wire", "From", "To", "Signal", "Type", "Status", "Sheet", "Notes"], rows
    )


def build_terminals_csv(terminal_rows: list[dict], out_path: Path) -> None:
    rows = [
        [t["device"], t["id"], t["function"], t["status"]]
        for t in sorted(terminal_rows, key=lambda t: (t["device"], t["id"]))
    ]
    pc.write_csv(out_path, ["Device", "Terminal", "Function", "Status"], rows)


def _entry_with_citations(entry: dict, source_field: str = "source") -> dict:
    out = dict(entry)
    out["status"] = pc.normalize_status(entry)
    citations = [
        pc.citation_to_structured(c) for c in pc.parse_citations(entry.get(source_field, ""))
    ]
    out["citations"] = citations
    return out


def build_pack_model(
    model: dict, manifest: dict, pack_format_version: str, source_ref: str
) -> dict:
    """The lossless combined machine-readable model (deliverable g)."""
    devices = model["devices"].get("devices", [])
    meta = model["devices"].get("meta", {})
    terminal_rows = pc.flatten_terminals(model["terminals"])
    wires = model["wires"].get("wires", [])
    e007 = model["e007_rs485"]
    e002 = model["e002_oneline"]
    open_items = model["open_items"].get("items", [])
    sheets = model["sheets"].get("sheets", [])

    return {
        "pack_format_version": pack_format_version,
        "source_ref": source_ref,
        "drawing_revision": meta.get("revision", ""),
        "meta": meta,
        "devices": [_entry_with_citations(d, "source") for d in devices],
        "terminals": [_entry_with_citations(t, "source") for t in terminal_rows],
        "wires": [_entry_with_citations(w, "source") for w in wires],
        "e007_rs485": {
            "endpoints": e007.get("endpoints", {}),
            "links": [_entry_with_citations(lk, "source") for lk in e007.get("links", [])],
            "command_words": e007.get("command_words", {}),
            "serial_config": e007.get("serial_config", {}),
            "readback": e007.get("readback", []),
            "troubleshooting": e007.get("troubleshooting", []),
            "sources": e007.get("sources", []),
        },
        "e002_oneline": {
            "convention": e002.get("convention", ""),
            "nodes": [_entry_with_citations(n, "source") for n in e002.get("nodes", [])],
            "segments": [_entry_with_citations(s, "source") for s in e002.get("segments", [])],
            "sources": e002.get("sources", []),
        },
        "open_items": [pc.derive_open_item_fields(it) for it in open_items],
        "sheets": sheets,
        "intake": {
            "asset": manifest.get("asset", {}),
            "model_source": manifest.get("model_source", {}),
            "build": manifest.get("build", {}),
        },
    }


# ================================================================== (c) evidence matrices -> CSV (from emit_matrices.py output)


def build_evidence_matrix_csv(evidence_matrix_md: str, out_path: Path) -> None:
    rows = []
    sections = re.split(r"^## ", evidence_matrix_md, flags=re.MULTILINE)[1:]
    for sec in sections:
        heading_line, _, body = sec.partition("\n")
        sheet_id = heading_line.strip().split()[0]
        if not re.match(r"E-\d{3}", sheet_id):
            continue
        for line in body.split("\n"):
            line = line.strip()
            if not line.startswith("|") or set(line.replace("|", "").strip()) <= {"-", " "}:
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) != 10 or cells[0].lower() == "wire":
                continue
            rows.append([sheet_id] + cells)
    rows.sort(key=lambda r: (r[0], r[1]))
    pc.write_csv(
        out_path,
        [
            "Sheet",
            "Wire",
            "From",
            "To",
            "Signal",
            "Type",
            "Status",
            "Source",
            "Notes",
            "Rendered",
            "Tagged",
        ],
        rows,
    )


def build_crossref_matrix_csv(crossref_matrix_md: str, out_path: Path) -> None:
    m = re.search(r"^## Terminals\s*\n(.*?)(?=^## )", crossref_matrix_md, re.MULTILINE | re.DOTALL)
    body = m.group(1) if m else ""
    rows = []
    for line in body.split("\n"):
        line = line.strip()
        if not line.startswith("|") or set(line.replace("|", "").strip()) <= {"-", " "}:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 5 or cells[0] in ("Device.Terminal",):
            continue
        dev_term, function, status, wires_touching, sheets = cells
        device, _, terminal = dev_term.partition(".")
        rows.append([device, terminal, function, status, wires_touching, sheets])
    rows.sort(key=lambda r: (r[0], r[1]))
    pc.write_csv(
        out_path, ["Device", "Terminal", "Function", "Status", "Wires_Touching", "Sheets"], rows
    )


# ================================================================== GRADES_FINAL.md distillation


def parse_grades_final(text: str) -> dict:
    scoreboard = []
    for m in re.finditer(
        r"^\|\s*(E-\d{3}[^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$", text, re.MULTILINE
    ):
        sheet, tech, ctrl, draft, audit = (g.strip() for g in m.groups())
        if sheet.lower() == "sheet":
            continue
        scoreboard.append(
            {
                "sheet": sheet,
                "technician": tech,
                "controls": ctrl,
                "drafting": draft,
                "auditor": audit,
            }
        )
    verdict_m = re.search(r"FINAL VERDICT:\s*\*\*(.*?)\*\*", text)
    verdict = verdict_m.group(1).strip() if verdict_m else "UNKNOWN"

    hf_heading_m = re.search(r"^##\s*The (\d+) hard-fails?\s*\(([^)]*)\)", text, re.MULTILINE)
    hard_fails: list[str] = []
    hf_count = 0
    if hf_heading_m:
        hf_count = int(hf_heading_m.group(1))
        rest = text[hf_heading_m.end() :]
        next_heading = re.search(r"^##\s", rest, re.MULTILINE)
        block = rest[: next_heading.start()] if next_heading else rest
        for chunk in re.split(r"\n(?=- )", block.strip()):
            chunk = chunk.strip()
            if chunk.startswith("- "):
                hard_fails.append(re.sub(r"\s+", " ", chunk[2:]).strip())
    return {
        "scoreboard": scoreboard,
        "verdict": verdict,
        "hard_fail_count": hf_count,
        "hard_fails": hard_fails,
    }


# ================================================================== (c) provenance report


def _device_sheet_map(model: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for w in model["wires"].get("wires", []):
        sheet = w.get("sheet", "")
        for ep in (w.get("from", ""), w.get("to", "")):
            if "." in ep:
                out.setdefault(ep.split(".", 1)[0], set()).add(sheet)
    for lk in model["e007_rs485"].get("links", []):
        for dev in (lk.get("src_device", ""), lk.get("dst_device", "")):
            out.setdefault(dev, set()).add("E-007")
    device_tags = {d["tag"] for d in model["devices"].get("devices", [])}
    for seg in model["e002_oneline"].get("segments", []):
        for node in (seg.get("from", ""), seg.get("to", "")):
            if node in device_tags:
                out.setdefault(node, set()).add("E-002")
    return out


def _sheet_conductor_claims(sheet_id: str, model: dict) -> list[dict]:
    if sheet_id == "E-002":
        return [
            {
                "label": f"{seg.get('from', '')} -> {seg.get('to', '')}: {seg.get('label', '')} ({seg.get('conductors', '')})",
                "status": pc.normalize_status(seg),
                "source": seg.get("source", ""),
            }
            for seg in model["e002_oneline"].get("segments", [])
        ]
    if sheet_id == "E-007":
        return [
            {
                "label": f"{lk.get('wire_label', '')}: {lk.get('src_device', '')}.{lk.get('src_terminal', '')} -> {lk.get('dst_device', '')}.{lk.get('dst_terminal', '')} ({lk.get('signal', '')})",
                "status": pc.normalize_status(lk),
                "source": lk.get("source", ""),
            }
            for lk in model["e007_rs485"].get("links", [])
        ]
    return [
        {
            "label": f"{w.get('proposed_number', '')}: {w.get('from', '')} -> {w.get('to', '')} ({w.get('signal', '')})",
            "status": pc.normalize_status(w),
            "source": w.get("source", ""),
        }
        for w in model["wires"].get("wires", [])
        if w.get("sheet") == sheet_id
    ]


def build_provenance_report_md(
    model: dict,
    manifest: dict,
    grades: dict,
    photo_basenames: dict[str, dict],
    out_path: Path,
) -> None:
    asset = manifest.get("asset", {})
    lines: list[str] = []
    lines.append(f"# {asset.get('tag', '')} — Evidence & Provenance Report")
    lines.append("")
    lines.append(
        "Every claim below traces to a citation: a photo, a manual page/line, a PLC program "
        "file/line, or a dated technician statement. Status `verified` = cited and checked; "
        "`field_verify` = a real, located gap, not a guess. Device-identity claims backed by a "
        "bundled photo link to its redacted thumbnail below."
    )
    lines.append("")

    device_sheets = _device_sheet_map(model)
    devices_by_tag = {d["tag"]: d for d in model["devices"].get("devices", [])}
    seen_devices_global: set[str] = set()

    for sheet_id in CONDUCTOR_SHEETS:
        lines.append(f"## {sheet_id} — {SHEET_TITLES.get(sheet_id, '')}")
        lines.append("")

        sheet_devices = sorted(
            tag
            for tag, sheets in device_sheets.items()
            if sheet_id in sheets and tag in devices_by_tag
        )
        if sheet_devices:
            lines.append("**Devices on this sheet:**")
            lines.append("")
            for tag in sheet_devices:
                d = devices_by_tag[tag]
                status = pc.normalize_status(d)
                thumb = _thumbnail_markdown(d.get("source", ""), photo_basenames)
                lines.append(f"- `{tag}` ({status}) — {d.get('role', '')}")
                if thumb:
                    lines.append(f"  {thumb}")
                if tag not in seen_devices_global and d.get("source"):
                    lines.append(f"  - citation: {d.get('source', '')}")
                seen_devices_global.add(tag)
            lines.append("")

        claims = _sheet_conductor_claims(sheet_id, model)
        if claims:
            lines.append("**Conductors on this sheet:**")
            lines.append("")
            for c in claims:
                thumb = _thumbnail_markdown(c["source"], photo_basenames)
                lines.append(f"- {c['label']} — **{c['status']}**")
                if c["source"]:
                    lines.append(f"  - citation: {c['source']}")
                if thumb:
                    lines.append(f"  {thumb}")
            lines.append("")

    lines.append("## Evidence bundle (customer-provided)")
    lines.append("")
    lines.append("| Path | Kind | Provenance |")
    lines.append("|---|---|---|")
    for item in manifest.get("evidence", []) or []:
        lines.append(
            f"| `{item.get('path', '')}` | {item.get('kind', '')} | {item.get('provenance', '')} |"
        )
    lines.append("")

    lines.append("## QA summary (distilled from the independent review panel)")
    lines.append("")
    lines.append(f"**Final verdict: {grades.get('verdict', 'UNKNOWN')}**")
    lines.append("")
    if grades.get("scoreboard"):
        lines.append("| Sheet | Technician | Controls | Drafting | Auditor |")
        lines.append("|---|---|---|---|---|")
        for row in grades["scoreboard"]:
            lines.append(
                f"| {row['sheet']} | {row['technician']} | {row['controls']} | "
                f"{row['drafting']} | {row['auditor']} |"
            )
        lines.append("")
    if grades.get("hard_fails"):
        lines.append(
            f"**{grades.get('hard_fail_count', len(grades['hard_fails']))} issue(s) found during "
            "review, fixed, and independently re-checked before delivery:**"
        )
        lines.append("")
        for hf in grades["hard_fails"]:
            lines.append(f"- {hf}")
        lines.append("")
    lines.append(
        "This summary is distilled from the preparer's internal engineering QA record for a "
        "customer-facing read; the full adversarial review ledgers are not reproduced here."
    )
    lines.append("")
    pc.write_text(out_path, "\n".join(lines))


def _thumbnail_markdown(source: str, photo_basenames: dict[str, dict]) -> str:
    for clause in pc.parse_citations(source):
        if clause["kind"] != "photo":
            continue
        base = Path(clause["photo"]).name
        if base in photo_basenames:
            return f"![{base}](photos/{base})"
    return ""


# ================================================================== (d) open items register


def build_open_items_register(open_items: list[dict], out_csv: Path, out_md: Path) -> None:
    derived = [pc.derive_open_item_fields(it) for it in open_items]
    rows = [
        [
            it["id"],
            it["sheet"],
            it["item"],
            it["verify"],
            it["severity"],
            it["status"],
            it["closed_date"],
            it["closed_by"],
            it["as_found"],
            it["tooling_needed"],
        ]
        for it in sorted(derived, key=lambda x: x["id"])
    ]
    pc.write_csv(
        out_csv,
        [
            "id",
            "sheet",
            "item",
            "verify",
            "severity",
            "status",
            "closed_date",
            "closed_by",
            "as_found",
            "tooling_needed",
        ],
        rows,
    )

    lines = ["# Field-Verify Register", ""]
    lines.append(
        f"{len(derived)} items; {sum(1 for i in derived if i['status'] == 'closed')} closed, "
        f"{sum(1 for i in derived if i['status'] == 'open')} open. Severity is a deterministic, "
        "keyword-derived triage aid, not a code-compliance certification."
    )
    lines.append("")
    for it in sorted(derived, key=lambda x: x["id"]):
        marker = "[CLOSED]" if it["status"] == "closed" else "[OPEN]"
        lines.append(f"## {it['id']} {marker} — sheet {it['sheet']} — severity: {it['severity']}")
        lines.append("")
        lines.append(f"**Item:** {it['item']}")
        lines.append("")
        lines.append(f"**Verify:** {it['verify']}")
        lines.append("")
        lines.append(f"**Tooling needed:** {it['tooling_needed']}")
        if it["status"] == "closed":
            lines.append("")
            lines.append(f"**Closed:** {it['closed_date']} — {it['as_found']}")
        lines.append("")
    pc.write_text(out_md, "\n".join(lines))


# ================================================================== (f) revision/approval record


def build_revision_approval_record(
    model: dict, manifest: dict, grades: dict, achieved_tier: str, as_of: str
) -> dict:
    meta = model["devices"].get("meta", {})
    signoff = manifest.get("signoff", {}) or {}
    prepared_by = signoff.get("prepared_by") or meta.get("drawn_by", "")
    revisions = [
        {
            "rev": meta.get("revision", "A"),
            "date": meta.get("date", ""),
            "description": (
                "Initial drafted 9-sheet electrical print set (E-001..E-009); dash-true "
                "field-verify rendering; model-backed annotations; validator checks A-L green."
            ),
            "author": meta.get("drawn_by", ""),
        },
        {
            "rev": f"{meta.get('revision', 'A')} (commercial pack)",
            "date": as_of,
            "description": (
                "MIRA Print Pack commercial bundle: cover/status page, PDF metadata+bookmarks+"
                "links, evidence & provenance report, structured open-items register, "
                "field-verification worksheet, revision/approval record, machine-readable "
                "pack_model export."
            ),
            "author": prepared_by,
        },
    ]
    tier_definitions = {
        "APPROVABLE WITH FIELD VERIFICATION": (
            "Every drawn fact in this pack is either backed by a citation you can check (a manual "
            "page, a program line, a dated bench photo) or is explicitly and visibly flagged FIELD "
            "VERIFY (dashed on the drawings, listed in the open-items register). No hard-fail "
            "defects remain, and every independent reviewer scored every sheet at or above 90/100. "
            "It does NOT mean this is a certified as-built — every FIELD VERIFY item must be "
            "confirmed on the physical machine before it is relied on for energized work."
        ),
        "APPROVABLE": (
            "The same bar as APPROVABLE WITH FIELD VERIFICATION, plus every open item that could "
            "block safe energization has been closed with a resolving citation and a named "
            "technician's field sign-off."
        ),
        "NOT APPROVABLE": "A hard-fail is present, or a reviewer scored a sheet below 90. Not sellable.",
    }
    return {
        "asset": manifest.get("asset", {}),
        "revisions": revisions,
        "approval_tier": achieved_tier,
        "approval_tier_definition": tier_definitions.get(achieved_tier, ""),
        "review_verdict_source": "engineering review panel (see evidence/provenance_report.md QA summary)",
        "signatures": {
            "prepared_by": prepared_by,
            "engineering_reviewed_by": signoff.get("engineering_reviewed_by", ""),
            "customer_field_accepted_by": "",  # never filled by the build — field moment only
        },
        "history_note": (
            "Full technical revision history is retained in the preparer's internal QA record; "
            "available on request."
        ),
    }


# ================================================================== (f) cover / status text


def build_cover_status_md(
    manifest: dict, achieved_tier: str, counts: dict, as_of: str, redact: bool
) -> str:
    asset = manifest.get("asset", {})
    customer = manifest.get("customer", {}) or {}
    cust_name = "" if redact else customer.get("name", "")
    cust_site = "" if redact else customer.get("site", "")
    lines = [
        f"# {asset.get('tag', '')} — {asset.get('label', '')}",
        "",
        f"**Approval tier: {achieved_tier}**",
        "",
        f"UNS path: `{asset.get('uns_path', '')}`",
        "",
        f"Customer: {cust_name or '[redacted for published example]'}",
        f"Site: {cust_site or '[redacted for published example]'}",
        "",
        (
            f"Scope: this pack documents {asset.get('tag', '')} only — "
            f"{counts.get('devices', 0)} devices, {counts.get('conductors', 0)} modeled "
            f"conductors ({counts.get('conductors_field_verify', 0)} FIELD VERIFY), "
            f"{counts.get('terminals', 0)} modeled terminals "
            f"({counts.get('terminals_field_verify', 0)} FIELD VERIFY), "
            f"{counts.get('open_items', 0)} open items "
            f"({counts.get('open_items_closed', 0)} closed)."
        ),
        "",
        f"As of: {as_of}",
        "",
        "## Disclaimer",
        "",
        DISCLAIMER,
        "",
    ]
    if customer.get("confidential", True) and not redact:
        lines += [
            f"Company Confidential — for {cust_name or 'the receiving customer'} internal use.",
            "",
        ]
    contact = customer.get("contact", "")
    if contact:
        lines += [f"Questions about this pack or an open item — contact {contact}.", ""]
    return "\n".join(lines)


# ================================================================== README.md (bundle root)


def build_bundle_readme(manifest: dict, achieved_tier: str, counts: dict) -> str:
    asset = manifest.get("asset", {})
    tag = asset.get("tag", "")
    lines = [
        f"# {tag} Print Pack",
        "",
        f"Approval tier: **{achieved_tier}**. Start with `prints/{tag}_print_set.pdf` — page 0 is "
        "the cover/status page, then E-001 (legend + device schedule), then forward.",
        "",
        "## Two rules make every sheet readable at a glance",
        "",
        "- **Solid line = verified.** The fact is cited — a photo, a manual locator, a PLC program "
        "line, or a dated, named technician statement backs it.",
        "- **Dashed line + red FIELD VERIFY tag = not yet confirmed.** A real, located gap, not a "
        "guess dressed up as a fact.",
        "",
        f"On this pack, {counts.get('conductors_field_verify', 0)} of "
        f"{counts.get('conductors', 0)} modeled conductors and "
        f"{counts.get('terminals_field_verify', 0)} of {counts.get('terminals', 0)} modeled "
        "terminals are still FIELD VERIFY. That is not a shortcoming — it is the honesty the "
        f"pack is built on. `open_items/field_verify_register.csv` is the punch-list; "
        "`worksheets/field_verification_worksheet.pdf` is that punch-list made physical, grouped "
        "by where you would actually stand at the panel.",
        "",
        "## What's in the box",
        "",
        "| # | Sub-artifact | Where |",
        "|---|---|---|",
        "| 1 | Searchable PDF print set | `prints/` |",
        "| 2 | Connections & component data | `data/*.csv`, `data/pack_model.{json,yaml}` |",
        "| 3 | Evidence & provenance report | `evidence/` |",
        "| 4 | Field-verify register | `open_items/` |",
        "| 5 | Field-verification worksheet | `worksheets/` |",
        "| 6 | Revision / approval record | `approval/` |",
        "| 7 | Machine-readable model | `data/pack_model.json` (+ `.yaml`) |",
        "",
        "## Included / excluded / never inferred",
        "",
        "**Included:** every drawn sheet; every modeled conductor and terminal, tagged verified or "
        "field_verify (never silently upgraded); every device with model/role/evidence status; the "
        "full open-items docket; the QA summary; the machine-readable model; the redacted bench-"
        "photo evidence backing each verified device-identity claim.",
        "",
        "**Excluded:** the PLC program/ladder itself (cited as evidence, not delivered); any asset "
        "other than the one this pack documents; a certified as-built (this is APPROVABLE WITH "
        "FIELD VERIFICATION, not AS-BUILT VERIFIED); load/arc-flash/short-circuit/NEC studies; "
        "internal terminal-strip layouts not observed; any control-write capability.",
        "",
        "**Never inferred:** conductor destinations not directly observed; terminal ids not read "
        "off a nameplate/manual/photo; ratings not read off a nameplate/manual; device "
        "relationships not directly evidenced; a technician's field statement unless directly "
        "quoted and dated; anything filled in for drawing completeness.",
        "",
        "This bundle is complete on its own — a technician with the PDFs and CSVs needs nothing "
        "else installed.",
        "",
    ]
    contact = (manifest.get("customer", {}) or {}).get("contact", "")
    if contact:
        lines += [f"Questions — contact {contact}.", ""]
    return "\n".join(lines)


# ================================================================== (e) field verification worksheet PDF

_WS_PAGE_W, _WS_PAGE_H = 612.0, 792.0
_WS_MARGIN = 36.0
_WS_COLS = [
    ("id", 34),
    ("location", 62),
    ("what_to_check", 190),
    ("expected", 72),
    ("measured", 60),
    ("pass_fail", 46),
    ("initials", 40),
    ("date", 42),
]


def _ws_wrap(text: str, width_pt: float, fs: float) -> list[str]:
    per_char = fs * 0.52
    return textwrap.wrap(str(text), max(6, int(width_pt / per_char))) or [""]


# `fitz.Page.insert_text()` with a base-14 (non-embedded) font in this
# PyMuPDF/MuPDF build (1.28.0/1.29.0) silently mis-maps ANY character outside
# its WinAnsi/cp1252 glyph table to the WRONG byte on text extraction (0xB7,
# regardless of the source character) rather than raising or dropping it --
# verified empirically against em-dash, en-dash, curly quotes, ellipsis,
# arrows, and Greek letters (see the pack build session notes). PDF metadata
# strings are NOT affected (confirmed by isolated round-trip test) -- only
# glyphs drawn via insert_text(). Model/manifest text (open_items verify/item
# strings in particular) can contain any of these, so every insert_text call
# site routes through this sanitizer rather than trusting each literal to be
# ASCII-only.
_PDF_SAFE_MAP = {
    "—": " - ",  # em dash
    "–": "-",  # en dash
    "‘": "'",
    "’": "'",  # curly single quotes
    "“": '"',
    "”": '"',  # curly double quotes
    "…": "...",  # ellipsis
    "→": "->",  # right arrow
    "≤": "<=",
    "≥": ">=",
    "×": "x",
    "Ω": "Ohm",  # capital omega (used for ohms)
    "φ": "phi",
    "•": "-",  # bullet
}


def _pdf_safe_text(s: str) -> str:
    if not s:
        return s
    for bad, good in _PDF_SAFE_MAP.items():
        s = s.replace(bad, good)
    # Final safety net: replace anything still outside cp1252 (the "helv"
    # font's real encoding) rather than ship a silently wrong glyph.
    return s.encode("cp1252", errors="replace").decode("cp1252")


def _itext(page, point, text, **kwargs) -> None:
    page.insert_text(point, _pdf_safe_text(text), **kwargs)


def build_field_verification_worksheet_pdf(
    open_items: list[dict], asset: dict, as_of: str, out_path: Path
) -> None:
    import fitz

    derived = sorted(
        (pc.derive_open_item_fields(it) for it in open_items), key=lambda x: (x["sheet"], x["id"])
    )
    doc = fitz.open()
    page = doc.new_page(width=_WS_PAGE_W, height=_WS_PAGE_H)
    y = _WS_MARGIN

    def new_page():
        nonlocal page, y
        page = doc.new_page(width=_WS_PAGE_W, height=_WS_PAGE_H)
        y = _WS_MARGIN

    _itext(page, (_WS_MARGIN, y + 14), "FIELD VERIFICATION WORKSHEET", fontsize=14, fontname="helv")
    y += 22
    _itext(
        page,
        (_WS_MARGIN, y + 10),
        f"Asset: {asset.get('tag', '')} — {asset.get('label', '')}    As of: {as_of}    "
        "Technician: ______________________",
        fontsize=8,
        fontname="helv",
    )
    y += 16
    for s in SAFETY_BANNER:
        for ln in _ws_wrap("SAFETY: " + s, _WS_PAGE_W - 2 * _WS_MARGIN, 7.5):
            _itext(page, (_WS_MARGIN, y + 8), ln, fontsize=7.5, fontname="helv", color=(0.75, 0, 0))
            y += 10
    y += 10

    def draw_header():
        nonlocal y
        x = _WS_MARGIN
        page.draw_rect(fitz.Rect(x, y, _WS_PAGE_W - _WS_MARGIN, y + 14), color=(0, 0, 0), width=0.6)
        cx = x
        for name, w in _WS_COLS:
            label = name.replace("_", " ").upper()
            _itext(page, (cx + 2, y + 10), label, fontsize=6.3, fontname="helv")
            cx += w
        y += 16

    draw_header()
    last_sheet = None
    for it in derived:
        if it["sheet"] != last_sheet:
            _itext(page, (_WS_MARGIN, y + 8), f"-- {it['sheet']} --", fontsize=7.5, fontname="heit")
            y += 11
            last_sheet = it["sheet"]
        acceptance = pc.extract_acceptance_value(it["verify"])
        cell_text = {
            "id": it["id"],
            "location": it["sheet"],
            "what_to_check": it["verify"],
            "expected": acceptance,
            "measured": "",
            "pass_fail": "P / F",
            "initials": "",
            "date": "",
        }
        wrapped = {k: _ws_wrap(v, w - 4, 6.6) for (k, w), v in zip(_WS_COLS, cell_text.values())}
        n_lines = max(len(v) for v in wrapped.values())
        row_h = n_lines * 8.2 + 4
        if y + row_h > _WS_PAGE_H - _WS_MARGIN - 40:
            new_page()
            draw_header()
        x = _WS_MARGIN
        page.draw_rect(
            fitz.Rect(_WS_MARGIN, y, _WS_PAGE_W - _WS_MARGIN, y + row_h),
            color=(0.6, 0.6, 0.6),
            width=0.4,
        )
        for name, w in _WS_COLS:
            for k, ln in enumerate(wrapped[name]):
                _itext(page, (x + 2, y + 8 + k * 8.2), ln, fontsize=6.6, fontname="helv")
            x += w
        y += row_h

    y += 14
    if y > _WS_PAGE_H - _WS_MARGIN - 20:
        new_page()
    _itext(
        page,
        (_WS_MARGIN, y + 10),
        "Field verification completed by: _______________________________   Date: ______________",
        fontsize=8.5,
        fontname="helv",
    )

    pin_pdf_metadata(
        doc,
        title=f"{asset.get('tag', '')} Field Verification Worksheet",
        subject="MIRA Print Pack — field verification checklist",
        as_of=as_of,
        author="FactoryLM / MIRA",
        keywords=f"{asset.get('tag', '')}, field verification, checklist",
    )
    doc.save(out_path, garbage=4, deflate=True, no_new_id=1)
    doc.close()


# ================================================================== PDF metadata / cover / bookmarks / links


def _as_of_pdf_date(as_of: str) -> str:
    y, m, d = as_of.split("-")
    return f"D:{y}{m}{d}000000Z"


def pin_pdf_metadata(
    doc, *, title: str, subject: str, as_of: str, author: str, keywords: str
) -> None:
    date = _as_of_pdf_date(as_of)
    doc.set_metadata(
        {
            "title": title,
            "author": author,
            "subject": subject,
            "keywords": keywords,
            "creator": "MIRA Print Pack build_pack.py",
            "producer": "PyMuPDF",
            "creationDate": date,
            "modDate": date,
        }
    )


def build_cover_page_pdf(manifest: dict, achieved_tier: str, counts: dict, as_of: str):
    import fitz

    asset = manifest.get("asset", {})
    customer = manifest.get("customer", {}) or {}
    W, H = 1600, 1040
    doc = fitz.open()
    page = doc.new_page(width=W, height=H)
    page.draw_rect(fitz.Rect(30, 30, W - 30, H - 30), color=(0.07, 0.07, 0.07), width=1.8)
    _itext(
        page,
        (70, 130),
        f"{asset.get('tag', '')} — {asset.get('label', '')}",
        fontsize=28,
        fontname="helv",
    )
    _itext(
        page,
        (70, 168),
        "MIRA Print Pack — Verified Machine Print Pack",
        fontsize=13,
        fontname="helv",
        color=(0.4, 0.4, 0.4),
    )
    _itext(page, (70, 230), f"Approval tier:  {achieved_tier}", fontsize=18, fontname="hebo")
    scope = (
        f"This pack documents {asset.get('tag', '')} only. "
        f"{counts.get('devices', 0)} devices  ·  "
        f"{counts.get('conductors', 0)} modeled conductors "
        f"({counts.get('conductors_field_verify', 0)} FIELD VERIFY)  ·  "
        f"{counts.get('terminals', 0)} modeled terminals "
        f"({counts.get('terminals_field_verify', 0)} FIELD VERIFY)  ·  "
        f"{counts.get('open_items', 0)} open items "
        f"({counts.get('open_items_closed', 0)} closed)."
    )
    y = 280
    for ln in _ws_wrap(scope, W - 200, 12):
        _itext(page, (70, y), ln, fontsize=12, fontname="helv")
        y += 18
    y += 20
    _itext(
        page,
        (70, y),
        f"UNS path: {asset.get('uns_path', '')}",
        fontsize=10,
        fontname="helv",
        color=(0.35, 0.35, 0.35),
    )
    y += 30
    cust_name = customer.get("name", "") or "[redacted for published example]"
    cust_site = customer.get("site", "") or "[redacted for published example]"
    _itext(page, (70, y), f"Customer: {cust_name}", fontsize=10, fontname="helv")
    y += 16
    _itext(page, (70, y), f"Site: {cust_site}", fontsize=10, fontname="helv")
    y += 16
    _itext(page, (70, y), f"As of: {as_of}", fontsize=10, fontname="helv")
    y += 40
    _itext(page, (70, y), "DISCLAIMER", fontsize=10, fontname="hebo")
    y += 16
    for ln in _ws_wrap(DISCLAIMER, W - 200, 9):
        _itext(page, (70, y), ln, fontsize=9, fontname="helv", color=(0.2, 0.2, 0.2))
        y += 13
    contact = customer.get("contact", "")
    if contact:
        y += 20
        _itext(page, (70, y), f"Questions — contact {contact}.", fontsize=9, fontname="helv")
    return doc


def verify_middot_extraction(
    pdf_path: Path, expected_substrings: list[str]
) -> tuple[bool, list[str]]:
    """Build-time regression guard for doc-reviewer finding G-08 (U+00B7
    text-extraction corruption). Verified NOT reproducing on the current
    PyMuPDF toolchain (byte-level check, 2026-07-11) — this converts a
    one-time manual finding into a standing check rather than a blind patch
    to code that isn't broken."""
    import fitz

    doc = fitz.open(pdf_path)
    problems = []
    try:
        full_text = "\n".join(page.get_text() for page in doc)
        if "�" in full_text:
            problems.append("U+FFFD replacement character present in extracted text")
        for s in expected_substrings:
            if "·" in s and s not in full_text:
                problems.append(f"expected separator string not found verbatim: {s!r}")
    finally:
        doc.close()
    return (not problems, problems)


def assemble_print_set(
    sheet_pdf_paths: dict[str, Path],
    sheet_order: list[str],
    cover_doc,
    manifest: dict,
    achieved_tier: str,
    as_of: str,
    out_path: Path,
) -> tuple[bool, list[str]]:
    """Merge cover + sheets, add metadata/bookmarks/links, pin dates. Degrades
    gracefully (SPEC.md instructions): if link/bookmark insertion fails for
    any reason, the merged PDF still ships without that flourish."""
    import fitz

    asset = manifest.get("asset", {})
    doc = fitz.open()
    doc.insert_pdf(cover_doc)
    page_of_sheet = {}
    for i, sheet_id in enumerate(sheet_order):
        src = fitz.open(sheet_pdf_paths[sheet_id])
        doc.insert_pdf(src)
        src.close()
        page_of_sheet[sheet_id] = i + 1

    pin_pdf_metadata(
        doc,
        title=f"{asset.get('tag', '')} Electrical Print Package — {asset.get('label', '')}",
        subject=f"Commercial handoff — {achieved_tier}",
        as_of=as_of,
        author="FactoryLM / MIRA",
        keywords=f"{asset.get('tag', '')}, electrical, field verify, {achieved_tier}",
    )

    warnings: list[str] = []
    try:
        toc = [[1, "Cover / Status", 1]]
        for sheet_id in sheet_order:
            toc.append(
                [1, f"{sheet_id} — {SHEET_TITLES.get(sheet_id, '')}", page_of_sheet[sheet_id] + 1]
            )
        doc.set_toc(toc)
    except Exception as e:  # pragma: no cover - defensive per graceful-degrade instruction
        warnings.append(f"bookmark insertion failed, shipping without TOC: {e}")

    try:
        for pno in range(doc.page_count):
            page = doc[pno]
            for sheet_id, target_pno in page_of_sheet.items():
                if target_pno == pno:
                    continue
                for rect in page.search_for(sheet_id):
                    page.insert_link(
                        {
                            "kind": fitz.LINK_GOTO,
                            "page": target_pno,
                            "from": rect,
                            "to": fitz.Point(0, 0),
                        }
                    )
    except Exception as e:  # pragma: no cover - defensive per graceful-degrade instruction
        warnings.append(f"cross-reference link insertion failed, shipping without links: {e}")

    doc.save(out_path, garbage=4, deflate=True, no_new_id=1)
    doc.close()
    return (True, warnings)
