"""
Scout (Lead Discovery) — 10:00 ET daily.
Runs the lead hunter pipeline. Reports ICP-matching facilities to Telegram.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import run_agent  # noqa: E402

_HUNTER = _REPO / "mira-crawler" / "tasks" / "lead_hunter.py"


def _run() -> dict:
    if not _HUNTER.exists():
        return {"found": 0, "icp_matches": 0, "note": "lead_hunter.py not yet implemented"}

    result = subprocess.run(
        [sys.executable, str(_HUNTER), "--output", "json"],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-300:])

    import json
    try:
        data = json.loads(result.stdout)
        return {
            "found": data.get("total", 0),
            "icp_matches": data.get("icp_matches", 0),
            "region": data.get("region", "unknown"),
        }
    except Exception:
        return {"found": 0, "icp_matches": 0, "note": "parse error"}


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    region = result.get("region", "search area")
    return (
        f"Found *{result['found']}* facilities in {region}\n"
        f"*{result['icp_matches']}* match ICP · Added to HubSpot pipeline"
    )


if __name__ == "__main__":
    run_agent("lead_scout", _run, name="Scout (Leads)", emoji="🎯",
              telegram_template=_telegram)
