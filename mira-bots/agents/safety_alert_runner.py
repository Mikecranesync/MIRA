"""Safety Alert Runner - scheduled inside the Telegram bot container.

Scans the MIRA SQLite interactions table for safety activity and pushes a digest
to the ops alert bot. DB/source failures are reported explicitly; they are never
treated as "no safety events".
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

AGENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(AGENT_DIR))

from runner_ledger import append_event, parse_utc_timestamp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("safety_alert")

DB_PATH = Path(os.environ.get("MIRA_DB_PATH", "/data/mira.db"))
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


def _utc_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def inspect_safety_events(
    db: sqlite3.Connection,
    since_hours: int,
    now: datetime | None = None,
) -> tuple[list[dict], str | None]:
    cutoff = _utc_now(now) - timedelta(hours=since_hours)
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT chat_id, intent, fsm_state, created_at FROM interactions "
            "ORDER BY created_at DESC"
        ).fetchall()
    except Exception as exc:  # noqa: BLE001
        reason = f"safety query failed: {exc}"
        logger.warning(reason)
        return [], reason

    events: list[dict] = []
    for raw_row in rows:
        row = dict(raw_row)
        created_at = parse_utc_timestamp(row.get("created_at"))
        if created_at is None or created_at < cutoff:
            continue
        if row.get("intent") == "safety" or row.get("fsm_state") == "SAFETY_ALERT":
            events.append(row)

    events.sort(
        key=lambda event: parse_utc_timestamp(event.get("created_at"))
        or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return events, None


def gather_safety_events(db: sqlite3.Connection, since_hours: int) -> list[dict]:
    events, _source_error = inspect_safety_events(db, since_hours)
    return events


def build_message(
    events: list[dict],
    window_hours: int,
    max_list: int = MAX_LIST,
    source_error: str | None = None,
) -> str:
    if source_error:
        return "\n".join(
            [
                "Unable to inspect safety events.",
                f"Source: interactions at {DB_PATH}",
                f"Reason: {source_error}",
            ]
        )
    if not events:
        return f"OK: Checked interactions; no safety events in the last {window_hours}h."

    count = len(events)
    techs = len({event.get("chat_id") for event in events if event.get("chat_id")})
    lines = [
        f"*{count} safety event{'s' if count != 1 else ''}* in {window_hours}h "
        f"- {techs} tech{'s' if techs != 1 else ''}"
    ]
    for event in events[:max_list]:
        timestamp = str(event.get("created_at") or "")[:16].replace("T", " ")
        who = str(event.get("chat_id") or "?")[-6:]
        lines.append(f"- {timestamp} - tech ...{who}")
    if count > max_list:
        lines.append(f"...and {count - max_list} more")
    lines.append("")
    lines.append("Review in CMMS / conversation logs.")
    return "\n".join(lines)


def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("alert bot token/chat not set - skipping push")
        return False
    try:
        now = datetime.now().strftime("%H:%M")
        full = f"*Linda (Safety)* - {now}\n\n{message}"
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
    source_error: str | None = None
    if DB_PATH.exists():
        try:
            db = sqlite3.connect(str(DB_PATH))
            events, source_error = inspect_safety_events(db, WINDOW_HOURS)
            db.close()
        except Exception as exc:  # noqa: BLE001
            source_error = f"DB open failed: {exc}"
            logger.warning(source_error)
    else:
        source_error = f"DB not found at {DB_PATH}"
        logger.warning(source_error)

    logger.info("safety events: %d source_error=%s", len(events), bool(source_error))
    try:
        append_event(
            runner="safety_alert",
            status="infra" if source_error else ("red" if events else "green"),
            checked=["interactions"],
            evidence_path=str(DB_PATH),
            counts={"events": len(events)},
            unable_sources=[str(DB_PATH)] if source_error else [],
            next_action="Restore interactions DB before trusting safety all-clear"
            if source_error
            else "",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ledger append failed: %s", exc)

    if not send_telegram(build_message(events, WINDOW_HOURS, source_error=source_error)):
        logger.warning("push failed")
        sys.exit(1)
    logger.info("Safety alert sent")


if __name__ == "__main__":
    main()
