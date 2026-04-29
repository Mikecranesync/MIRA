"""
Asset Intelligence — 18:00 ET daily.
Enriches any new assets created today using the 6-source enrichment pipeline.
Reads CMMS sync result to know which assets need enrichment.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import get_agent_result, run_agent  # noqa: E402

_ENRICH = _REPO / "mira-crawler" / "tasks" / "enrich_assets.py"


def _run() -> dict:
    cmms = get_agent_result("cmms_sync") or {}
    new_wos = cmms.get("new_wos", 0)

    if not _ENRICH.exists():
        return {"enriched": 0, "note": "enrich_assets.py not yet implemented"}

    if new_wos == 0:
        return {"enriched": 0, "note": "No new assets from today's CMMS sync"}

    result = subprocess.run(
        [sys.executable, str(_ENRICH), "--mode", "daily", "--limit", "10"],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-300:])

    import json
    try:
        data = json.loads(result.stdout)
        enriched = data.get("enriched", 0)
        asset_name = data.get("last_asset", "unknown")
        manuals = data.get("manuals_found", 0)
        return {"enriched": enriched, "last_asset": asset_name, "manuals_found": manuals}
    except Exception:
        return {"enriched": 0, "note": "parse error"}


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    return (
        f"Enriched *{result['enriched']}* asset(s)\n"
        f"Last: *{result.get('last_asset', 'unknown')}* — "
        f"{result.get('manuals_found', 0)} related manual(s) found"
    )


if __name__ == "__main__":
    run_agent("asset_intel", _run, name="Asset Intelligence", emoji="🧠",
              telegram_template=_telegram)
