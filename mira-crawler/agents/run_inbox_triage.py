"""
Alex (Inbox Triage) — 08:00 ET daily.
Scans Gmail via MCP (Cowork only) or summarizes from available data.
In standalone VPS mode: reports email count from any cached triage data.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import run_agent  # noqa: E402

# Cache written by the Cowork-mode inbox_triage.py (if run there)
_CACHE = Path("/opt/mira/agent_state/inbox_cache.json")


def _run() -> dict:
    # Try reading from cache written by a Cowork-mode run
    if _CACHE.exists():
        try:
            data = json.loads(_CACHE.read_text())
            if data.get("date") == str(date.today()):
                return {k: data[k] for k in ("total", "urgent", "leads", "fyi") if k in data}
        except Exception:
            pass

    # Fallback: no Gmail access in this environment
    return {"total": 0, "urgent": 0, "leads": 0, "fyi": 0, "note": "Gmail not accessible from VPS"}


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_ — configure Cowork Gmail MCP to enable."
    return (
        f"Inbox: *{result['total']}* emails\n"
        f"{result['urgent']} urgent · {result['leads']} lead alert(s) · {result['fyi']} FYI"
    )


if __name__ == "__main__":
    run_agent("inbox_triage", _run, name="Alex (Inbox)", emoji="📧",
              telegram_template=_telegram)
