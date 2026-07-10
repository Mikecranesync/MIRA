"""Safety Alert Runner — runs inside mira-bot-telegram container at 10:00 UTC daily.

Scans the local MIRA SQLite DB (`interactions`) for safety-intent turns in the
last window and pushes a digest to the OPS ALERT bot (staging), never the prod
user-facing bot. Grounded in real logged interactions — invents nothing. Sends a
short all-clear when there were none (daily safety visibility + liveness).

Crontab (managed by install_crons.sh):
  0 10 * * *  docker exec mira-bot-telegram python3 /app/agents/safety_alert_runner.py
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("safety_alert")

DB_PATH = Path(os.environ.get("MIRA_DB_PATH", "/data/mira.db"))
# Safety digest goes to the alert bot (staging), never @FactoryLM_Diagnose.
BOT_TOKEN = (
    os.environ.get("TELEGRAM_ALERT_BOT_TOKEN")
    or os.environ.get("TELEGRAM_BOT_TOKEN_STG")
    or os.environ.get("TELEGRAM_BOT_TOKEN", "")
)
CHAT_ID = (
    os.environ.get("TELEGRAM_ALERT_CHAT_ID")
    or os.environ.get("TELEGRAM_CHAT_ID")
    or os.environ.get("TELEGRAM_REPORT_CHAT_ID", "")
)
WINDOW_HOURS = int(os.environ.get("SAFETY_ALERT_WINDOW_HOURS", "24"))
MAX_LIST = int(os.environ.get("SAFETY_ALERT_MAX_LIST", "8"))


def gather_safety_events(db: sqlite3.Connection, since_hours: int) -> list[dict]:
    """Safety-intent / SAFETY_ALERT turns in the window. [] on any query error
    (schema drift must not crash the agent)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT chat_id, intent, fsm_state, created_at FROM interactions "
            "WHERE created_at >= ? AND (intent = 'safety' OR fsm_state = 'SAFETY_ALERT') "
            "ORDER BY created_at DESC",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:  # noqa: BLE001
        logger.warning("safety query skipped: %s", exc)
        return []


def build_message(events: list[dict], window_hours: int, max_list: int = MAX_LIST) -> str:
    if not events:
        return f"✓ No safety events in the last {window_hours}h."
    n = len(events)
    techs = len({e.get("chat_id") for e in events if e.get("chat_id")})
    lines = [
        f"🛑 *{n} safety event{'s' if n != 1 else ''}* in {window_hours}h "
        f"· {techs} tech{'s' if techs != 1 else ''}"
    ]
    for e in events[:max_list]:
        ts = (str(e.get("created_at") or ""))[:16].replace("T", " ")
        who = str(e.get("chat_id") or "?")[-6:]
        lines.append(f"• {ts} — tech …{who}")
    if n > max_list:
        lines.append(f"…and {n - max_list} more")
    lines.append("\n⚠️ Review in CMMS / conversation logs.")
    return "\n".join(lines)


def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("alert bot token/chat not set — skipping push")
        return False
    try:
        now = datetime.now().strftime("%H:%M")
        full = f"🛑 *Linda (Safety)* — {now}\n\n{message}"
        payload = json.dumps(
            {
                "chat_id": CHAT_ID,
                "text": full,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            }
        ).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()).get("ok", False)
    except Exception as exc:  # noqa: BLE001
        logger.error("Telegram push failed: %s", exc)
        return False


def main() -> None:
    logger.info("Safety alert starting")
    events: list[dict] = []
    if DB_PATH.exists():
        try:
            db = sqlite3.connect(str(DB_PATH))
            events = gather_safety_events(db, WINDOW_HOURS)
            db.close()
        except Exception as exc:  # noqa: BLE001
            logger.warning("DB open failed (%s) — treating as no events", exc)
    else:
        logger.warning("DB not found at %s — treating as no events", DB_PATH)

    logger.info("safety events: %d", len(events))
    if not send_telegram(build_message(events, WINDOW_HOURS)):
        logger.warning("push failed")
        sys.exit(1)
    logger.info("Safety alert sent ✓")


if __name__ == "__main__":
    main()
