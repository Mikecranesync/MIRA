"""
PM Escalation — 22:00 ET daily.
Checks Atlas for overdue PMs and PMs due tomorrow. Sends reminders.
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import run_agent  # noqa: E402

ATLAS_URL = os.environ.get("ATLAS_API_URL", "http://localhost:8088")


def _run() -> dict:
    try:
        import httpx  # type: ignore[import]
    except ImportError:
        return {"overdue": 0, "due_tomorrow": 0, "note": "httpx not available"}

    admin_user = os.environ.get("PLG_ATLAS_ADMIN_USER", "")
    admin_pass = os.environ.get("PLG_ATLAS_ADMIN_PASSWORD", "")
    if not admin_user:
        return {"overdue": 0, "due_tomorrow": 0, "note": "Atlas credentials not set"}

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    today = date.today().isoformat()

    try:
        with httpx.Client(timeout=30) as client:
            # Overdue PMs
            resp = client.get(
                f"{ATLAS_URL}/api/preventive-maintenance",
                auth=(admin_user, admin_pass),
                params={"status": "overdue"},
            )
            resp.raise_for_status()
            overdue_data = resp.json()
            overdue = len(overdue_data) if isinstance(overdue_data, list) else 0

            # Due tomorrow
            resp2 = client.get(
                f"{ATLAS_URL}/api/preventive-maintenance",
                auth=(admin_user, admin_pass),
                params={"due_date": tomorrow, "status": "pending"},
            )
            resp2.raise_for_status()
            due_data = resp2.json()
            due_tomorrow = len(due_data) if isinstance(due_data, list) else 0

        return {"overdue": overdue, "due_tomorrow": due_tomorrow, "checked_date": today}
    except Exception as exc:
        raise RuntimeError(f"Atlas PM check failed: {exc}") from exc


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    overdue_line = (
        f"⚠️ *{result['overdue']}* overdue PM(s)" if result["overdue"]
        else "0 overdue PMs ✓"
    )
    return f"{overdue_line}\n{result['due_tomorrow']} scheduled for tomorrow"


if __name__ == "__main__":
    run_agent("pm_escalation", _run, name="PM Scheduler", emoji="🔧",
              telegram_template=_telegram)
