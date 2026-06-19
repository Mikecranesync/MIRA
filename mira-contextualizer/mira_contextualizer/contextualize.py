"""Deterministic contextualization — turn a Document IR into reviewable candidates. NO LLM.

Pure rules (regex + small curated vocab + table awareness) extract factory-relevant entities from
extracted document text — fault codes, drive parameters, model/catalog numbers, manufacturers — plus
cross-references between the document and the project's known PLC tags. Every candidate carries its
provenance (file + page + snippet) and a confidence band, and is shaped exactly like a PLC extraction
row so it lands in the same accept/reject/promote review surface.

Design stance: strong on tables/codes/params/catalog-numbers; deliberately silent on free prose it
can't ground (no guessing). Auditable and reproducible — the honest tradeoff of the no-LLM choice.
"""
from __future__ import annotations

import re

from . import manuals

_BAND_TO_NUM = {"high": 0.9, "medium": 0.6, "low": 0.3}

# Depth keys the manual miner adds; merged into a matching spotting candidate (never overwritten).
_DEPTH_KEYS = ("cause", "next_check", "description", "units", "range", "setpoint",
               "subject", "parameter", "match")

# Fault codes: E/F/A + 2–4 digits are distinctive (PowerFlex F004, GS10 E.x, etc.).
_RE_FAULT = re.compile(r"\b([EFA]\d{2,4})\b")
# Short VFD codes (oC, oL, LU, GF, SC, OH) — ambiguous, only trust them near a fault keyword.
_RE_FAULT_SHORT = re.compile(r"\b(oC|oL|oH|LU|GF|SC|OU|OV|CE\d?)\b")
_RE_FAULT_KW = re.compile(r"(?i)\b(fault|alarm|trip|error|fail|overload)\b")
# Drive parameters: P09.03 / Pr.05 / P031.
_RE_PARAM = re.compile(r"\b([Pp]\d{1,2}\.\d{1,2}|[Pp][rR]\.?\d{1,3}|[Pp]\d{3,4})\b")
# Allen-Bradley-style catalog numbers: 2080-LC50-24QWB, 1769-L33ER.
_RE_CATALOG = re.compile(r"\b(\d{4}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)?)\b")
# Known product families (case-insensitive).
_RE_FAMILY = re.compile(
    r"(?i)\b(PowerFlex\s?\d{2,3}|SINAMICS\s?\w+|Micro8\d0|MicroLogix|CompactLogix|ControlLogix"
    r"|GS\d{1,2}|ATV\d{2,3}|ACS\d{2,3}|VLT)\b")
_MANUFACTURERS = [
    "rockwell", "allen-bradley", "allen bradley", "siemens", "abb", "schneider electric",
    "schneider", "yaskawa", "danfoss", "automationdirect", "mitsubishi", "omron", "fanuc",
    "lenze", "eaton", "weg", "delta electronics", "parker", "festo", "sick",
]


def band_to_num(band: str) -> float:
    return _BAND_TO_NUM.get(band, 0.3)


def _snippet(line: str, limit: int = 160) -> str:
    s = " ".join(line.split())
    return s[:limit]


def _iter_lines(blocks: list[dict]):
    """Yield (line_text, page) for every non-empty line across the Document IR blocks."""
    for b in blocks:
        page = b.get("page")
        for line in (b.get("text") or "").splitlines():
            if line.strip():
                yield line, page


def contextualize_blocks(blocks: list[dict], file_name: str,
                         plc_tags: list[str] | None = None) -> list[dict]:
    """Run every rule over the Document IR. Returns deduped candidate rows (store.add_extractions
    shape): tag_name, roles, uns_path_proposed, i3x_element_id, evidence_json, confidence."""
    plc_tags = [t for t in (plc_tags or []) if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{2,}", t)]
    tag_res = {t: re.compile(r"\b%s\b" % re.escape(t)) for t in plc_tags}

    # key (role, value-lower) -> aggregated candidate
    found: dict[tuple[str, str], dict] = {}

    def add(value: str, role: str, band: str, line: str, page):
        key = (role, value.lower())
        ev = {"file": file_name, "page": page, "snippet": _snippet(line), "rule": role}
        if key in found:
            c = found[key]
            c["evidence_json"]["mentions"].append(ev)
            if band_to_num(band) > band_to_num(c["_band"]):
                c["_band"], c["confidence"] = band, band_to_num(band)
        else:
            found[key] = {
                "tag_name": value, "roles": [role], "uns_path_proposed": None,
                "i3x_element_id": None, "confidence": band_to_num(band), "_band": band,
                "evidence_json": {"source": "document", "entity_type": role,
                                  "mentions": [ev]},
            }

    for line, page in _iter_lines(blocks):
        for m in _RE_FAULT.finditer(line):
            add(m.group(1), "fault_code", "medium", line, page)
        if _RE_FAULT_KW.search(line):
            for m in _RE_FAULT_SHORT.finditer(line):
                add(m.group(1), "fault_code", "medium", line, page)
        for m in _RE_PARAM.finditer(line):
            add(m.group(1), "parameter", "medium", line, page)
        for m in _RE_CATALOG.finditer(line):
            add(m.group(1), "catalog_number", "high", line, page)
        for m in _RE_FAMILY.finditer(line):
            add(" ".join(m.group(0).split()), "model_family", "high", line, page)
        low = line.lower()
        for mfr in _MANUFACTURERS:
            if mfr in low:
                add(mfr.title(), "manufacturer", "medium", line, page)
        for tag, rex in tag_res.items():
            if rex.search(line):
                add(tag, "tag_reference", "high", line, page)

    # Depth pass: mine fault tables (cause/next-check) + spec/param tables (units/range/setpoint),
    # tied to the project's tags. Merge each enriched row into the matching spotting candidate so
    # the review surface + scorecard see one diagnosable signal, not a duplicate.
    for mr in manuals.mine(blocks, file_name, plc_tags):
        key = (mr["roles"][0], mr["tag_name"].lower())
        mev = mr["evidence_json"]
        if key in found:
            c = found[key]
            cev = c["evidence_json"]
            for k in _DEPTH_KEYS:
                if mev.get(k) and not cev.get(k):
                    cev[k] = mev[k]
            cev.setdefault("mentions", []).extend(mev.get("mentions", []))
            c["confidence"] = max(c["confidence"], mr["confidence"])
        else:
            found[key] = mr

    # finalize: drop the internal band marker
    out = []
    for c in found.values():
        c.pop("_band", None)
        out.append(c)
    return out
