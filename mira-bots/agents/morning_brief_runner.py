"""
Morning Brief Runner — runs inside mira-bot-telegram container at 05:00 ET daily.
Queries the MIRA SQLite DB for overnight activity, builds a structured brief,
and pushes it to Mike's Telegram.

Crontab (managed by install_crons.sh):
  0 9 * * *  docker exec mira-bot-telegram python3 /app/agents/morning_brief_runner.py
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("morning_brief")

DB_PATH     = Path(os.environ.get("MIRA_DB_PATH", "/data/mira.db"))
BOT_TOKEN   = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID     = os.environ.get("TELEGRAM_CHAT_ID", os.environ.get("TELEGRAM_REPORT_CHAT_ID", ""))


# ── Data queries ──────────────────────────────────────────────────────────────

def _query(db: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.debug("DB query skipped: %s", exc)
        return []


def gather_overnight(db: sqlite3.Connection, since_hours: int = 12) -> dict:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()

    interactions = _query(db,
        "SELECT fsm_state, intent, created_at FROM interactions WHERE created_at >= ? ORDER BY created_at",
        (cutoff,))

    safety_events = [r for r in interactions if r.get("intent") == "safety"]
    wo_events     = [r for r in interactions if r.get("fsm_state") in ("WORK_ORDER_OPEN", "WO_SUBMITTED")]

    return {
        "interactions":    interactions,
        "safety_events":   safety_events,
        "work_orders":     wo_events,
        "total_sessions":  len({r.get("chat_id", "") for r in interactions}),
    }


# ── Format helpers ────────────────────────────────────────────────────────────

def _pm_section() -> str:
    """Stub — will connect to CMMS Atlas API when auth is live."""
    return "_PM data: connect Atlas CMMS for live due-list_"


def _kb_section() -> str:
    """Read the latest KB growth report if available."""
    report_dir = Path("/opt/mira/reports/kb-growth-cron")
    if not report_dir.exists():
        return "_No KB report available_"
    reports = sorted(report_dir.glob("*.md"), reverse=True)
    if not reports:
        return "_No KB report available_"
    try:
        text = reports[0].read_text(encoding="utf-8")
        # Extract first metric line
        for line in text.splitlines():
            if "| Done" in line or "PDFs Ingested" in line:
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) >= 2:
                    return f"• {parts[0]}: *{parts[1]}*"
    except Exception:
        pass
    return f"• Last report: {reports[0].stem}"


def build_brief(data: dict) -> str:
    now_et = datetime.now(timezone.utc) - timedelta(hours=4)  # ET offset
    date_str = now_et.strftime("%a, %b %-d")

    wo_count     = len(data["work_orders"])
    safety_count = len(data["safety_events"])
    safety_note  = "acknowledged ✓" if safety_count > 0 else "none"

    lines = [
        f"Good morning, Mike.",
        "",
        f"*Overnight Summary* ({date_str})",
        f"• {wo_count} work order{'s' if wo_count != 1 else ''} created",
        f"• {safety_count} safety event{'s' if safety_count != 1 else ''} ({safety_note})",
        f"• {data['total_sessions']} active tech session{'s' if data['total_sessions'] != 1 else ''}",
        "",
        "*PMs Due Today*",
        _pm_section(),
        "",
        "*KB Growth* (last 24h)",
        _kb_section(),
    ]

    if safety_count == 0 and wo_count == 0:
        lines += ["", "*No actions needed today.* ✓"]
    elif safety_count > 0:
        lines += ["", f"⚠️ *Review {safety_count} safety event(s) in CMMS.*"]

    return "\n".join(lines)


# ── Telegram push ─────────────────────────────────────────────────────────────

def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping push")
        return False
    try:
        import urllib.request
        now = datetime.now().strftime("%H:%M")
        full = f"☀️ *Dana (Morning Brief)* — {now}\n\n{message}"
        payload = json.dumps({
            "chat_id": CHAT_ID,
            "text": full,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result.get("ok", False)
    except Exception as exc:
        logger.error("Telegram push failed: %s", exc)
        return False


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    logger.info("Morning brief starting")

    if DB_PATH.exists():
        try:
            db = sqlite3.connect(str(DB_PATH))
            data = gather_overnight(db)
            db.close()
        except Exception as exc:
            logger.warning("DB open failed (%s) — using empty data", exc)
            data = {"interactions": [], "safety_events": [], "work_orders": [], "total_sessions": 0}
    else:
        logger.warning("DB not found at %s — using empty data", DB_PATH)
        data = {"interactions": [], "safety_events": [], "work_orders": [], "total_sessions": 0}

    brief = build_brief(data)
    logger.info("Brief built (%d chars)", len(brief))

    ok = send_telegram(brief)
    if ok:
        logger.info("Morning brief sent ✓")
    else:
        logger.warning("Telegram push failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
