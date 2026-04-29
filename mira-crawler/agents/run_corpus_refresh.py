"""
Research (Corpus Refresh) — 20:00 ET daily.
Pulls new maintenance Q&A from Reddit. Full refresh on Sundays.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import run_agent  # noqa: E402

_SCRAPER = _REPO / "mira-bots" / "benchmarks" / "corpus" / "scraper.py"


def _run() -> dict:
    if not _SCRAPER.exists():
        return {"added": 0, "note": "corpus scraper not found"}

    is_sunday = datetime.now(timezone.utc).weekday() == 6
    limit = 500 if is_sunday else 50
    mode = "full refresh" if is_sunday else "daily"

    result = subprocess.run(
        [sys.executable, str(_SCRAPER),
         "--subreddits", "all",
         "--limit", str(limit),
         "--time-filter", "week" if is_sunday else "day",
         "--output", "json"],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-300:])

    import json
    try:
        data = json.loads(result.stdout)
        added = data.get("added", 0)
        return {"added": added, "mode": mode, "subreddits": data.get("subreddits", [])}
    except Exception:
        return {"added": 0, "mode": mode, "note": "parse error"}


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    mode = result.get("mode", "daily")
    subs = ", ".join(result.get("subreddits", ["r/PLC", "r/SCADA"])[:3])
    return (
        f"Corpus {mode}: *{result['added']}* new Q&A added\n"
        f"Sources: {subs}"
    )


if __name__ == "__main__":
    run_agent("corpus_refresh", _run, name="Research", emoji="🔬",
              telegram_template=_telegram)
