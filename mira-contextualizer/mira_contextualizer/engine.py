"""Engine adapter — turns an uploaded source into extraction rows, deterministically.

P0 handles PLC program exports via the stdlib ``mira_plc_parser`` pipeline (the same call the Hub
worker makes). Document formats (PDF/Word/Excel/images) arrive in P1 behind this same interface, so
the server and store never learn what kind of file they hold.
"""
from __future__ import annotations

import os

# Resolved via sys.path (tests/conftest.py, app.py) or the PyInstaller bundle — see pyproject note.
from mira_plc_parser import pipeline  # type: ignore

_CONFIDENCE_MAP = {"high": 0.9, "medium": 0.6, "med": 0.6, "low": 0.3}

# file extension -> source_type label (advisory; the parser detects format from content too)
_EXT_TYPE = {
    ".l5x": "l5x", ".st": "st", ".xml": "plcopen", ".csv": "csv",
    ".pdf": "manual", ".txt": "manual", ".md": "manual", ".docx": "manual", ".xlsx": "manual",
}

# Formats P0 can actually parse today (text-based PLC exports). Everything else is accepted as a
# source row but yields zero extractions until the P1 document layer lands.
_PLC_TEXT_EXTS = {".l5x", ".csv", ".st", ".xml"}


def source_type_for(file_name: str) -> str:
    return _EXT_TYPE.get(os.path.splitext(file_name)[1].lower(), "other")


def is_plc_text(file_name: str) -> bool:
    return os.path.splitext(file_name)[1].lower() in _PLC_TEXT_EXTS


def _confidence(band: str | None) -> float | None:
    if not band:
        return None
    return _CONFIDENCE_MAP.get(str(band).lower(), 0.3)


def extract_plc(file_name: str, text: str) -> tuple[list[dict], dict]:
    """Run the deterministic PLC pipeline. Returns (extraction_rows, raw_report).

    Each row matches store.add_extractions: tag_name, roles, uns_path_proposed, i3x_element_id,
    evidence_json, confidence. Mirrors mira-hub/workers/ctx_parse_worker.py against report@1.
    """
    result = pipeline.run(file_name, text)
    report = pipeline.render_json(result)

    uns_by_tag = {u.get("tag"): u for u in report.get("uns_candidates", [])}
    fmt = report.get("detection", {}).get("fmt")

    rows: list[dict] = []
    for tag in report.get("tag_dictionary", []):
        name = tag.get("name")
        if not name:
            continue
        uns = uns_by_tag.get(name, {})
        uns_path = uns.get("path") or None
        band = uns.get("confidence") or tag.get("confidence") or "low"
        rows.append({
            "tag_name": name,
            "roles": tag.get("roles") or [],
            "uns_path_proposed": uns_path,
            "i3x_element_id": uns_path,  # UNS leaf doubles as the i3X element id
            "evidence_json": {
                "source_format": fmt,
                "data_type": tag.get("data_type"),
                "confidence_source": band,
                "uns_segments": uns.get("segments"),
            },
            "confidence": _confidence(band),
        })
    return rows, report
