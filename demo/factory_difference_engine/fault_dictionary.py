"""
fault_dictionary.py — deterministic Fault Dictionary Extractor (Fault Intelligence, Phase 2 brick).
=================================================================================
Parses the existing SimLab manual fault tables (simlab/docs/<asset>/fault_code_table.md)
into a deterministic, queryable fault dictionary: cryptic code -> plain-English meaning
+ likely cause + first checks + the tags it references + the cited source document.

This is ONLY the dictionary brick. It builds no fault report, Hub UI, DB schema, live
adapter, LangGraph/Langfuse, or learning loop — those are later phases. The
`referenced_tags` are the future join points into the Factory Difference Bundle; the
`missing_evidence` field honestly flags VFD/electrical/condition diagnostics the sim lacks.

Pure/deterministic/offline/read-only: no DB, no network, no cloud, no live LLM, no clock.
See docs/discovery/fault_intelligence_from_flight_recorder_plan.md.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Optional

# Header label (normalized) -> record field. Robust to minor header wording.
_COLMAP = {
    "code": "code", "label": "label", "severity": "severity",
    "description": "description", "likely cause": "likely_cause",
    "recommended action": "recommended_action",
}
_CORE_FIELDS = ("label", "severity", "description", "likely_cause", "recommended_action")

# A backticked token that looks like a tag identifier (snake_case). Filters out
# `ABORTED`, `> 0`, `15 %`, `PackML`, etc. — only real tag names survive.
_TAG_RE = re.compile(r"^[a-z][a-z0-9_]+$")
_BACKTICK_RE = re.compile(r"`([^`]+)`")

# Diagnostic categories the ProveIt/Northwind sim LACKS as signals (see the
# data-richness audit). If a fault's text references one AND no referenced tag
# already covers it, we flag it as missing evidence (honest tag-depth gap).
# (keyword found in fault text, suggested signal that would corroborate it)
_MISSING_DIAGNOSTICS = [
    ("torque", "vfd_torque_pct"),
    ("dc bus", "dc_bus_voltage_v"),
    ("dc-bus", "dc_bus_voltage_v"),
    ("bus voltage", "dc_bus_voltage_v"),
    ("output voltage", "output_voltage_v"),
    ("drive temp", "drive_temp_c"),
    ("igbt", "drive_temp_c"),
    ("overload", "overload_count"),
    ("runtime hours", "runtime_hours"),
    ("operating hours", "runtime_hours"),
    ("run hours", "runtime_hours"),
    ("vibration", "vibration_mm_s"),
    ("bearing", "bearing_temp_c"),
    ("kilowatt", "power_kw"),
    (" kw", "power_kw"),
]


def _split_row(line: str) -> list:
    """Split a Markdown table row on unescaped pipes, trimming the outer borders."""
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def _is_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\|?[:\-\s|]+\|?", line.strip())) and "-" in line


def _referenced_tags(*texts: str) -> list:
    tags = set()
    for t in texts:
        for tok in _BACKTICK_RE.findall(t or ""):
            tok = tok.strip()
            if _TAG_RE.match(tok):
                tags.add(tok)
    return sorted(tags)


def _missing_evidence(referenced_tags: list, *texts: str) -> list:
    blob = " ".join(t or "" for t in texts).lower()
    ref_blob = " ".join(referenced_tags).lower()
    out, seen = [], set()
    for kw, sig in _MISSING_DIAGNOSTICS:
        k = kw.strip()
        if kw in blob and k not in ref_blob and sig not in seen:
            seen.add(sig)
            out.append({
                "category": k,
                "suggested_signal": sig,
                "note": "fault text references '%s' but the sim exposes no such signal to corroborate it" % k,
            })
    return sorted(out, key=lambda d: d["suggested_signal"])


def _parse_table(md_text: str) -> list:
    """Parse the first pipe-table in `md_text` into a list of column->cell dicts."""
    lines = [ln for ln in md_text.splitlines() if ln.strip().startswith("|")]
    if not lines:
        return []
    header = _split_row(lines[0])
    # column index -> field name (via normalized header)
    idx_field = {}
    for i, h in enumerate(header):
        idx_field[i] = _COLMAP.get(h.strip().lower())
    rows = []
    for ln in lines[1:]:
        if _is_separator(ln):
            continue
        cells = _split_row(ln)
        rec = {"code": "", "label": "", "severity": "", "description": "",
               "likely_cause": "", "recommended_action": ""}
        for i, cell in enumerate(cells):
            field = idx_field.get(i)
            if field:
                rec[field] = cell
        if rec["code"]:
            rows.append(rec)
    return rows


def extract_fault_dictionary(docs_dir: str = "simlab/docs") -> list:
    """Parse every simlab/docs/<asset>/fault_code_table.md into fault records.

    Deterministic: files and records are sorted; output is JSON-serializable.
    Returns [] if no fault tables are found. Each record:
      asset, code, label, severity, description, likely_cause, recommended_action,
      referenced_tags, source_doc, source_path, missing_evidence, confidence, parse_status
    """
    base = Path(docs_dir)
    records = []
    for path in sorted(base.glob("*/fault_code_table.md")):
        asset = path.parent.name
        text = path.read_text(encoding="utf-8")
        source_path = path.as_posix()
        for rec in _parse_table(text):
            refs = _referenced_tags(rec["description"], rec["likely_cause"], rec["recommended_action"])
            missing = _missing_evidence(refs, rec["description"], rec["likely_cause"], rec["recommended_action"])
            filled = sum(1 for f in _CORE_FIELDS if rec.get(f))
            records.append({
                "asset": asset,
                "code": rec["code"],
                "label": rec["label"],
                "severity": rec["severity"],
                "description": rec["description"],
                "likely_cause": rec["likely_cause"],
                "recommended_action": rec["recommended_action"],
                "referenced_tags": refs,
                "source_doc": path.name,
                "source_path": source_path,
                "missing_evidence": missing,
                "confidence": round(filled / len(_CORE_FIELDS), 2),
                "parse_status": "ok" if filled else "empty",
            })
    records.sort(key=lambda r: (r["asset"], r["code"]))
    return records


def lookup_fault(code: str, asset: Optional[str] = None, docs_dir: str = "simlab/docs"):
    """Look up a fault by code (case-insensitive), optionally scoped to an asset.

    - asset given  -> the single matching record, or {} if not found.
    - asset omitted -> a list of matching records across assets ([] if none).
    Fails safe: unknown code returns an empty result, never raises.
    """
    code_l = (code or "").strip().lower()
    matches = [r for r in extract_fault_dictionary(docs_dir)
               if r["code"].lower() == code_l and (asset is None or r["asset"] == asset)]
    if asset is not None:
        return matches[0] if matches else {}
    return matches


def write_artifacts(records: list, out_dir: str = "demo/factory_difference_engine/out/fault_dictionary") -> list:
    """Write fault_dictionary.json + fault_dictionary.csv (deterministic). Returns paths."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    jp = out / "fault_dictionary.json"
    cp = out / "fault_dictionary.csv"
    jp.write_text(json.dumps(records, indent=2), encoding="utf-8")
    with cp.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["asset", "code", "label", "severity", "referenced_tags",
                    "missing_evidence", "source_path", "confidence", "parse_status"])
        for r in records:
            w.writerow([r["asset"], r["code"], r["label"], r["severity"],
                        ";".join(r["referenced_tags"]),
                        ";".join(m["suggested_signal"] for m in r["missing_evidence"]),
                        r["source_path"], r["confidence"], r["parse_status"]])
    return [jp.as_posix(), cp.as_posix()]


def _main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Fault Dictionary Extractor (deterministic, offline)")
    ap.add_argument("--docs-dir", default="simlab/docs")
    ap.add_argument("--write", action="store_true", help="also write JSON+CSV artifacts under out/fault_dictionary/")
    args = ap.parse_args(argv)
    records = extract_fault_dictionary(args.docs_dir)
    print(json.dumps(records, indent=2))
    if args.write:
        for p in write_artifacts(records):
            print("wrote:", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
