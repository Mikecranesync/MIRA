"""Dialect registry — the proven vendor parsers as scored plugins.

The existing PowerFlex (``extractor``) and Magnetek (``magnetek_dialect``)
parsers are precise on the layouts they know. This registry keeps them as
OPTIMIZERS, not gates: on a candidate page it runs the dialects first, and only
where a dialect recognizes the page does its (high-precision) output win. Where
no dialect fires — every one of the five previously-0 vendors — the generic
route in ``generic_table_parser`` is the fallback. Dialect gates therefore
control *quality on known layouts*, never *whether a page is discoverable*.

Wraps the existing whole-document ``extractor.parse_faults`` /
``extractor.parse_parameters`` (which already dispatch Magnetek-first then
PowerFlex per page) scoped to candidate pages, and reshapes their dicts into
the canonical record shape. It does NOT modify the existing parsers — so
``test_extract`` / ``test_magnetek_dialect`` stay green by construction.

Pure read-only (delegates to the offline extractor).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import extractor
import schema_inference as si
from records import make_record

# Registry metadata (for the extraction report — which plugins exist).
DIALECTS = [
    {"name": "powerflex", "family": "Rockwell PowerFlex 40/520/525",
     "gate": "Description+Action fault header / grid+labeled param headers"},
    {"name": "magnetek", "family": "Magnetek/Yaskawa IMPULSE G+ Mini",
     "gate": "Name/Description fault header / dotted-param listing header"},
]


def _fault_to_record(f: dict[str, Any]) -> dict[str, Any]:
    code = f.get("code")
    ident = f.get("fault_id") or (str(code) if code is not None else "")
    id_kind = "numeric" if code is not None else "mnemonic"
    route = "dialect:powerflex" if code is not None else "dialect:magnetek"
    fields: dict[str, str] = {}
    if f.get("fault_type") and f["fault_type"] != "—":
        fields[si.FAULT_TYPE] = str(f["fault_type"])
    if f.get("action"):
        fields[si.FAULT_REMEDY] = f["action"]
    return make_record(
        record_type="fault", ident=ident, id_kind=id_kind,
        name=f.get("name", ""), fields=fields, page=f.get("page", 0),
        bbox=None, excerpt=f.get("excerpt", ""), route=route, confidence=0.95,
    )


def _param_to_record(p: dict[str, Any]) -> dict[str, Any]:
    ident = p.get("parameter_id", "")
    id_kind = si.classify_identifier(ident) or "alnum"
    route = "dialect:magnetek" if "manual_page_ref" in p else "dialect:powerflex"
    fields: dict[str, str] = {}
    for src, role in (("default", si.PARAM_DEFAULT), ("range", si.PARAM_RANGE), ("unit", si.PARAM_UNIT)):
        if p.get(src):
            fields[role] = str(p[src])
    return make_record(
        record_type="parameter", ident=ident, id_kind=id_kind,
        name=p.get("name", ""), fields=fields, page=p.get("page", 0),
        bbox=None, excerpt=p.get("excerpt", ""), route=route, confidence=0.95,
    )


def run_dialects(pdf_path: str | Path, pages: list[int]) -> list[dict[str, Any]]:
    """Run the proven dialect parsers over ``pages`` and return canonical
    records. Empty when no dialect recognizes any of those pages (the common
    case for the five generalization-gap vendors)."""
    out: list[dict[str, Any]] = []
    try:
        for f in extractor.parse_faults(pdf_path, pages=pages):
            rec = _fault_to_record(f)
            if rec["id"]:
                out.append(rec)
    except Exception:
        pass
    try:
        for p in extractor.parse_parameters(pdf_path, pages=pages):
            rec = _param_to_record(p)
            if rec["id"]:
                out.append(rec)
    except Exception:
        pass
    return out


def dialect_pages(records: list[dict[str, Any]]) -> set[int]:
    """Pages a dialect claimed — the generic route defers on these."""
    return {r["page"] for r in records if r.get("route", "").startswith("dialect:")}
