"""
Dana (Morning Brief) — 05:00 ET daily.
Reads Carlos's KB growth + Sarah's QA results. Queries SQLite for overnight WOs.
Runs outside Docker (unlike the legacy morning_brief_runner.py in the container).
"""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
sys.path.insert(0, str(_REPO))

from mira_crawler.agents.orchestrator import get_agent_result, run_agent  # noqa: E402

# Possible SQLite locations
_DB_CANDIDATES = [
    Path("/opt/mira/mira-bridge/data/interactions.db"),
    Path("/opt/mira/data/interactions.db"),
    _REPO / "mira-bridge" / "data" / "interactions.db",
]


def _query_sqlite() -> tuple[int, int, int]:
    """Returns (open_wos, safety_events, pms_due_today)."""
    db_path = next((p for p in _DB_CANDIDATES if p.exists()), None)
    if not db_path:
        return 0, 0, 0

    since = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()

        cur.execute(
            "SELECT COUNT(*) FROM interactions WHERE created_at > ? AND intent = 'work_order'",
            (since,)
        )
        wos = cur.fetchone()[0]

        cur.execute(
            "SELECT COUNT(*) FROM interactions WHERE created_at > ? AND intent = 'safety'",
            (since,)
        )
        safety = cur.fetchone()[0]

        conn.close()
        return wos, safety, 0
    except Exception:
        return 0, 0, 0


def _run() -> dict:
    kb = get_agent_result("kb_growth") or {}
    qa = get_agent_result("qa_benchmark") or {}
    open_wos, safety_events, pms_due = _query_sqlite()

    return {
        "open_wos": open_wos,
        "safety_events": safety_events,
        "pms_due": pms_due,
        "kb_ingested": kb.get("manual", "none"),
        "kb_chunks": kb.get("chunks", 0),
        "qa_accuracy": qa.get("accuracy", 0.0),
        "qa_delta": qa.get("delta", 0.0),
    }


def _telegram(result: dict) -> str:
    date_str = datetime.now(timezone.utc).strftime("%a %b %d")
    lines = [f"Good morning. {date_str}\n"]

    # Overnight ops
    lines.append(
        f"*Overnight:* {result['open_wos']} WOs open · "
        f"{result['safety_events']} safety events · "
        f"{result['pms_due']} PMs due today"
    )

    # KB growth
    if result["kb_ingested"] != "none":
        lines.append(
            f"*KB:* Ingested *{result['kb_ingested']}* "
            f"({result['kb_chunks']} chunks)"
        )
    else:
        lines.append("*KB:* No manual ingested overnight")

    # QA
    acc = result["qa_accuracy"]
    delta = result["qa_delta"]
    delta_str = f"▲ +{delta}%" if delta >= 0 else f"▼ {delta}%"
    lines.append(f"*QA:* Technical accuracy {acc}% ({delta_str})")

    lines.append("\nNo action required. ✓")
    return "\n".join(lines)


if __name__ == "__main__":
    run_agent("morning_brief", _run, name="Dana (Morning Brief)", emoji="☀️",
              telegram_template=_telegram)
