"""Shared helpers for the MIRA Print Pack build/validate/redact tooling.

Deterministic by construction: no datetime.now(), no random, no unpinned
timestamps. Every function here is pure given its inputs.

Used by build_pack.py, validate_pack.py, and redact.py. Do not duplicate this
logic in those scripts — import it.
"""

from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------- model loading

MODEL_FILES = (
    "devices",
    "terminals",
    "wires",
    "sheets",
    "open_items",
    "e007_rs485",
    "e002_oneline",
)


def _deep_strip(obj: Any) -> Any:
    """Strip leading/trailing whitespace off every leaf string, recursively.

    YAML `>` folded scalars keep exactly one trailing newline by default
    ("clip" chomping) -- e.g. devices.yaml's DB1/Q1 `role: >` blocks. That
    artifact must never leak into a generated CSV/JSON/PDF cell. Only
    leading/trailing whitespace is touched; internal content (including any
    genuine internal newline) is left exactly as authored.
    """
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, list):
        return [_deep_strip(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _deep_strip(v) for k, v in obj.items()}
    return obj


def load_model(package_dir: Path) -> dict[str, Any]:
    """Load every model/*.yaml file under package_dir. Missing files -> {}."""
    model_dir = package_dir / "model"
    out = {}
    for name in MODEL_FILES:
        p = model_dir / f"{name}.yaml"
        if p.exists():
            out[name] = _deep_strip(yaml.safe_load(p.read_text(encoding="utf-8")) or {})
        else:
            out[name] = {}
    return out


def flatten_terminals(terminals_data: dict) -> list[dict]:
    """Flatten terminals.yaml into one row per terminal: {device, id, function,
    status, opc, healthy_state, note, source}. Mirrors validate_model.py's
    flatten_terminals()/emit_matrices.py's flatten_terminals() nested-vs-flat
    handling, but keeps full terminal dicts (not just ids) in device order.

    YAML duplicate top-level keys (e.g. S2 appears twice in terminals.yaml)
    resolve via normal yaml.safe_load semantics: the LAST occurrence wins.
    That is already baked into `terminals_data` by the time it reaches here.
    """
    rows: list[dict] = []
    for device_tag, device_terms in terminals_data.items():
        if isinstance(device_terms, list):
            for t in device_terms:
                rows.append(_terminal_row(device_tag, t))
        elif isinstance(device_terms, dict):
            for section_terms in device_terms.values():
                if isinstance(section_terms, list):
                    for t in section_terms:
                        rows.append(_terminal_row(device_tag, t))
    return rows


def _terminal_row(device_tag: str, t: dict) -> dict:
    return {
        "device": device_tag,
        "id": t.get("id", "?"),
        "function": t.get("function", ""),
        "status": normalize_status(t),
        "opc": t.get("opc", ""),
        "healthy_state": t.get("healthy_state", ""),
        "note": t.get("note", ""),
        "source": t.get("source", ""),
    }


def normalize_status(entry: dict) -> str:
    """The one status key, normalized. Source files split status:/evidence: —
    normalize on export, never edit the sources (SPEC.md §3g)."""
    if "status" in entry:
        return entry.get("status") or "?"
    if "evidence" in entry:
        return entry.get("evidence") or "?"
    return "?"


# ---------------------------------------------------------------- citation parsing (check M + pack_model citations)

_KNOWN_EXT = r"(?:txt|md|st|csv|json|pdf|xlsx|jpg|jpeg|png|yaml|yml)"
_FILE_L_RE = re.compile(
    rf"([A-Za-z0-9_./\\-]+\.{_KNOWN_EXT})\s+L(\d+)(?:[-/]L?(\d+))?", re.IGNORECASE
)
_FILE_COLON_RE = re.compile(rf"([A-Za-z0-9_./\\-]+\.{_KNOWN_EXT}):(\d+)(?:-(\d+))?", re.IGNORECASE)
_FILE_BARE_RE = re.compile(rf"([A-Za-z0-9_./\\-]+\.{_KNOWN_EXT})", re.IGNORECASE)
_PHOTO_RE = re.compile(r"photo\s+(\S+)", re.IGNORECASE)
_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


_PLUS_JOINED_FILE_RE = re.compile(rf"\s\+\s(?=\S+\.{_KNOWN_EXT}\b)", re.IGNORECASE)


def split_citation_clauses(source: str) -> list[str]:
    """Split a raw source/citation string into individual clauses.

    Primary split is ';'. Within a clause, also split on ' + ' when it joins
    two file-like references (e.g. "gs10_full.jpg + gs10_control_terminals.jpg
    (2026-07-11 ...)") so check M resolves EVERY named file, not just the
    first -- narrow enough not to split unrelated "+" usage (e.g. "13-14 &
    43-44", "+24V") since it only fires directly before a `<name>.<ext>` token.
    """
    if not source:
        return []
    clauses = []
    for c in source.split(";"):
        c = c.strip()
        if not c:
            continue
        clauses.extend(part.strip() for part in _PLUS_JOINED_FILE_RE.split(c) if part.strip())
    return clauses


def parse_citation_clause(clause: str) -> dict:
    """Parse one citation clause into a structured record.

    Returns one of:
      {"kind": "photo", "photo": <path>, "date": <YYYY-MM-DD or None>, "raw": clause}
      {"kind": "file_locator", "doc": <path>, "locator": "L<n>[-<m>]", "raw": clause}
      {"kind": "file_bare", "doc": <path>, "locator": None, "raw": clause}
      {"kind": "prose", "text": clause, "raw": clause}
    """
    m = _PHOTO_RE.search(clause)
    if m:
        dm = _DATE_RE.search(clause)
        return {
            "kind": "photo",
            "photo": m.group(1),
            "date": dm.group(1) if dm else None,
            "raw": clause,
        }
    m = _FILE_L_RE.search(clause)
    if m:
        doc, n, mm = m.group(1), m.group(2), m.group(3)
        locator = f"L{n}" if not mm else f"L{n}-{mm}"
        return {"kind": "file_locator", "doc": doc, "locator": locator, "raw": clause}
    m = _FILE_COLON_RE.search(clause)
    if m:
        doc, n, mm = m.group(1), m.group(2), m.group(3)
        locator = f"L{n}" if not mm else f"L{n}-{mm}"
        return {"kind": "file_locator", "doc": doc, "locator": locator, "raw": clause}
    m = _FILE_BARE_RE.search(clause)
    if m:
        return {"kind": "file_bare", "doc": m.group(1), "locator": None, "raw": clause}
    return {"kind": "prose", "text": clause, "raw": clause}


def parse_citations(source: str) -> list[dict]:
    return [parse_citation_clause(c) for c in split_citation_clauses(source)]


def citation_to_structured(parsed: dict) -> dict:
    """The lossless, structured citation shape for pack_model.json (SPEC §3g):
    {doc, locator} for file citations, {photo, date} for photo citations,
    {text} for prose-only citations."""
    if parsed["kind"] == "photo":
        return {"photo": parsed["photo"], "date": parsed["date"]}
    if parsed["kind"] in ("file_locator", "file_bare"):
        return {"doc": parsed["doc"], "locator": parsed["locator"]}
    return {"text": parsed["text"]}


class CitationResolver:
    """Resolves citation clauses against real files under a search path.

    search_roots: ordered list of directories to try each relative path
    against. The first root under which the path exists wins. A citation
    whose file cannot be found under ANY root is an "external reference"
    (e.g. an OEM manual PDF/txt kept local and never committed to git, per
    this repo's own .gitignore convention) — not a failure. See
    validate_pack.py check M for the full policy rationale.
    """

    def __init__(self, search_roots: list[Path]):
        self.search_roots = [r for r in search_roots if r is not None]

    def resolve(self, rel_path: str) -> Path | None:
        rel_path = rel_path.strip()
        for root in self.search_roots:
            candidate = root / rel_path
            if candidate.exists():
                return candidate
        return None

    def check_clause(self, parsed: dict) -> dict:
        """Returns {"status": "resolved"|"external"|"broken"|"n/a", "detail": str}."""
        if parsed["kind"] == "photo":
            p = self.resolve(parsed["photo"])
            if p is not None:
                return {"status": "resolved", "detail": f"photo exists: {parsed['photo']}"}
            return {"status": "broken", "detail": f"photo NOT FOUND: {parsed['photo']}"}
        if parsed["kind"] == "file_locator":
            p = self.resolve(parsed["doc"])
            if p is None:
                return {
                    "status": "external",
                    "detail": f"external reference (not in reach of this build): {parsed['doc']}",
                }
            need = _max_locator_line(parsed["locator"])
            try:
                n_lines = sum(1 for _ in p.open("r", encoding="utf-8", errors="replace"))
            except OSError as e:
                return {"status": "broken", "detail": f"cannot read {parsed['doc']}: {e}"}
            if n_lines < need:
                return {
                    "status": "broken",
                    "detail": (
                        f"{parsed['doc']} has {n_lines} lines, "
                        f"citation {parsed['locator']} needs >= {need}"
                    ),
                }
            return {
                "status": "resolved",
                "detail": f"{parsed['doc']} {parsed['locator']} resolves ({n_lines} lines)",
            }
        if parsed["kind"] == "file_bare":
            p = self.resolve(parsed["doc"])
            if p is None:
                return {
                    "status": "external",
                    "detail": f"external reference (not in reach of this build): {parsed['doc']}",
                }
            return {"status": "resolved", "detail": f"{parsed['doc']} exists"}
        return {"status": "n/a", "detail": "prose citation, no file to resolve"}


def _max_locator_line(locator: str) -> int:
    nums = [int(x) for x in re.findall(r"\d+", locator)]
    return max(nums) if nums else 0


# ---------------------------------------------------------------- deterministic serialization


def dump_json_str(obj: Any) -> str:
    return (
        json.dumps(obj, sort_keys=True, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n"
    )


def write_json(path: Path, obj: Any) -> None:
    path.write_text(dump_json_str(obj), encoding="utf-8", newline="\n")


def dump_yaml_str(obj: Any) -> str:
    return yaml.safe_dump(
        obj,
        sort_keys=True,
        default_flow_style=False,
        allow_unicode=True,
        width=100,
    )


def write_yaml(path: Path, obj: Any) -> None:
    text = dump_yaml_str(obj)
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def write_csv(path: Path, header: list[str], rows: list[list[Any]]) -> None:
    """Deterministic CSV: caller-sorted rows, '\\n' line endings, no BOM."""
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    path.write_text(buf.getvalue(), encoding="utf-8", newline="\n")


def write_text(path: Path, text: str) -> None:
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------- small text helpers (mirrors render_sheet.py conventions)


def humanize_snake_case(s: str) -> str:
    if not s:
        return s
    if s.endswith("_no"):
        return s[:-3].replace("_", " ") + " (NO)"
    if s.endswith("_nc"):
        return s[:-3].replace("_", " ") + " (NC)"
    return s.replace("_", " ")


# ---------------------------------------------------------------- open-items derived structure (deliverable d)

_RESOLVED_RE = re.compile(r"^RESOLVED\s*\((\d{4}-\d{2}-\d{2})\)\s*:\s*(.*)$", re.DOTALL)

_SAFETY_KEYWORDS = (
    "safety relay",
    "safety stop",
    "e-stop architecture",
    "ground resistance",
    "pe resistance",
    "≤ 0.1",
    "≤0.1",
    "rfi jumper",
    "grounding",
    "bonding",
    "breaker",
    "branch protection",
    "required per",
    "loto",
)
_INFORMATIONAL_SHEETS = ("panel",)
_INFORMATIONAL_KEYWORDS = ("confirmed unused", "confirm no field wires", "role vs cv-101 unknown")


def classify_severity(item: dict) -> str:
    """Deterministic keyword classifier -> safety_code | functional | informational.

    This is a best-effort triage aid, not a code-compliance certification —
    documented as such everywhere it is printed.
    """
    sheet = str(item.get("sheet", "")).strip().lower()
    text = f"{item.get('item', '')} {item.get('verify', '')}".lower()
    if sheet in _INFORMATIONAL_SHEETS:
        return "informational"
    if any(k in text for k in _INFORMATIONAL_KEYWORDS):
        return "informational"
    if any(k in text for k in _SAFETY_KEYWORDS):
        return "safety_code"
    return "functional"


_TOOLING_RULES = (
    (("meter", "multimeter"), "multimeter"),
    (("ccw project", "ccw laptop", "live conv_simple"), "CCW laptop (live project)"),
    (("photograph", "photo "), "camera"),
    (("keypad", "readback"), "GS10 keypad"),
    (("trace", "continuity"), "multimeter (continuity)"),
)


def classify_tooling(item: dict) -> str:
    text = f"{item.get('verify', '')}".lower()
    for keywords, tool in _TOOLING_RULES:
        if any(k in text for k in keywords):
            return tool
    return "visual inspection"


_ACCEPTANCE_RE = re.compile(r"(\d+(?:\.\d+)?\s*(?:VDC|VAC|V|Hz|A|ms|%|ohm|Ω))", re.IGNORECASE)


def extract_acceptance_value(verify_text: str) -> str:
    m = _ACCEPTANCE_RE.search(verify_text or "")
    if m:
        return m.group(1)
    return "record as found"


def derive_open_item_fields(item: dict) -> dict:
    """Adds severity/status/closed_date/closed_by/as_found/tooling_needed as
    real fields (SPEC §3d) — derived from the model, never hand-maintained,
    never invented. closed_by stays blank where no named individual is present
    in the source text (unknowns stay explicit, never invented)."""
    item_text = str(item.get("item", ""))
    m = _RESOLVED_RE.match(item_text.strip())
    if m:
        closed_date, as_found = m.group(1), m.group(2).strip()
        status = "closed"
    else:
        closed_date, as_found = "", ""
        status = "open"
    return {
        "id": item.get("id", ""),
        "sheet": item.get("sheet", ""),
        "item": item_text,
        "verify": item.get("verify", ""),
        "severity": classify_severity(item),
        "status": status,
        "closed_date": closed_date,
        "closed_by": "",  # never invented — no named individual in the source text
        "as_found": as_found,
        "tooling_needed": classify_tooling(item),
    }


# ---------------------------------------------------------------- approval tier computation (single source of truth for build_pack.py + validate_pack.py check R)


def compute_achieved_tier(open_items: list[dict], base_verdict: str) -> str:
    """base_verdict is the sheet-grading verdict already earned (e.g. from
    GRADES_FINAL.md, "APPROVABLE WITH FIELD VERIFICATION"). This function only
    ever narrows/holds that verdict — it never upgrades past what grading
    already certified, and separately enforces the open-items closure gate
    for a plain "APPROVABLE" label (SPEC §0 tier table, check R(i))."""
    if base_verdict != "APPROVABLE WITH FIELD VERIFICATION":
        return base_verdict
    all_closed = all(derive_open_item_fields(it)["status"] == "closed" for it in open_items)
    if all_closed and open_items:
        return "APPROVABLE"
    return "APPROVABLE WITH FIELD VERIFICATION"


# ---------------------------------------------------------------- misc


def sha256_file(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def find_repo_root(start: Path) -> Path | None:
    """Walk upward from `start` looking for a .git entry (dir OR file — a
    worktree's .git is a file containing 'gitdir: ...'). Returns None if not
    found (bundle has been relocated outside any git checkout)."""
    cur = start.resolve()
    for _ in range(20):
        if (cur / ".git").exists():
            return cur
        if cur.parent == cur:
            return None
        cur = cur.parent
    return None
