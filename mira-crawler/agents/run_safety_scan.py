"""
Linda (Safety) — 06:00 ET daily.
Scans any newly ingested KB content for LOTO / safety procedures.
Reads Carlos's KB growth result to know what was added.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import get_agent_result, run_agent  # noqa: E402

SAFETY_KEYWORDS = [
    "LOTO", "lockout", "tagout", "arc flash", "confined space",
    "voltage above", "do not energize", "de-energize", "hazardous energy",
    "PPE required", "NFPA 70E", "OSHA 1910",
]

# Chunk output directories where full_ingest_pipeline writes markdown chunks
_CHUNK_DIRS = [
    Path("/opt/mira/mira-crawler/output/chunks"),
    Path("/opt/mira/output/chunks"),
    _REPO / "mira-crawler" / "output" / "chunks",
]


def _scan_recent_chunks(manual_name: str) -> int:
    """Count safety keyword hits in chunks written for this manual."""
    chunk_dir = next((d for d in _CHUNK_DIRS if d.exists()), None)
    if not chunk_dir or not manual_name or manual_name == "none":
        return 0

    # Find chunk files that likely belong to this manual
    slug = manual_name.lower().replace(" ", "_")[:20]
    hits = 0
    for f in chunk_dir.glob(f"*{slug}*.md"):
        try:
            text = f.read_text(errors="ignore")
            for kw in SAFETY_KEYWORDS:
                if kw.lower() in text.lower():
                    hits += 1
                    break
        except OSError:
            pass
    return hits


def _run() -> dict:
    kb = get_agent_result("kb_growth") or {}
    manual = kb.get("manual", "none")
    loto_found = _scan_recent_chunks(manual)
    # overnight safety events come from morning brief's DB query — reuse if available
    from agents.orchestrator import get_agent_result as _get
    brief = _get("morning_brief") or {}
    incidents = brief.get("safety_events", 0)

    return {
        "manual_scanned": manual,
        "loto_found": loto_found,
        "incidents": incidents,
    }


def _telegram(result: dict) -> str:
    manual = result["manual_scanned"]
    loto = result["loto_found"]
    incidents = result["incidents"]

    if manual and manual != "none":
        scan_line = f"Scanned *{manual}*: {loto} safety procedure(s) found"
    else:
        scan_line = "No new manual to scan"

    incident_line = (
        "Zero overnight incidents ✓" if incidents == 0
        else f"⚠️ {incidents} safety event(s) flagged overnight"
    )
    return f"{scan_line}\n{incident_line}"


if __name__ == "__main__":
    run_agent("safety_scan", _run, name="Linda (Safety)", emoji="🛑",
              telegram_template=_telegram)
