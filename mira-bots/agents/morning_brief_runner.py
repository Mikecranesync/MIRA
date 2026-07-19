"""Morning Brief Runner - scheduled inside the Telegram bot container.

Builds Dana's overnight ops brief from real interactions data. If the source is
missing or unreadable, the brief says that explicitly instead of sending a false
"no actions needed" message.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
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
logger = logging.getLogger("morning_brief")

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


def _utc_now(now: datetime | None = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def empty_overnight_data(source_error: str | None = None) -> dict:
    return {
        "interactions": [],
        "safety_events": [],
        "work_orders": [],
        "total_sessions": 0,
        "source_error": source_error,
    }


def inspect_overnight(
    db: sqlite3.Connection,
    since_hours: int = 12,
    now: datetime | None = None,
) -> tuple[dict, str | None]:
    cutoff = _utc_now(now) - timedelta(hours=since_hours)
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT chat_id, fsm_state, intent, created_at FROM interactions "
            "ORDER BY created_at"
        ).fetchall()
    except Exception as exc:  # noqa: BLE001
        reason = f"overnight query failed: {exc}"
        logger.warning(reason)
        return empty_overnight_data(source_error=reason), reason

    interactions: list[dict] = []
    for raw_row in rows:
        row = dict(raw_row)
        created_at = parse_utc_timestamp(row.get("created_at"))
        if created_at is None or created_at < cutoff:
            continue
        interactions.append(row)

    safety_events = [row for row in interactions if row.get("intent") == "safety"]
    work_orders = [
        row for row in interactions if row.get("fsm_state") in ("WORK_ORDER_OPEN", "WO_SUBMITTED")
    ]
    return {
        "interactions": interactions,
        "safety_events": safety_events,
        "work_orders": work_orders,
        "total_sessions": len({row.get("chat_id") for row in interactions if row.get("chat_id")}),
        "source_error": None,
    }, None


def gather_overnight(db: sqlite3.Connection, since_hours: int = 12) -> dict:
    data, _source_error = inspect_overnight(db, since_hours=since_hours)
    return data


def _pm_section() -> str:
    return "_PM data: connect Atlas CMMS for live due-list_"


def _kb_section() -> str:
    report_dir = Path("/opt/mira/reports/kb-growth-cron")
    if not report_dir.exists():
        return "_No KB report available_"
    reports = sorted(report_dir.glob("*.md"), reverse=True)
    if not reports:
        return "_No KB report available_"
    try:
        text = reports[0].read_text(encoding="utf-8")
        for line in text.splitlines():
            if "| Done" in line or "PDFs Ingested" in line:
                parts = [part.strip() for part in line.split("|") if part.strip()]
                if len(parts) >= 2:
                    return f"- {parts[0]}: *{parts[1]}*"
    except Exception:  # noqa: BLE001
        pass
    return f"- Last report: {reports[0].stem}"


def build_brief(data: dict) -> str:
    now_et = datetime.now(timezone.utc) - timedelta(hours=4)
    date_str = f"{now_et:%a, %b} {now_et.day}"
    source_error = data.get("source_error")

    if source_error:
        return "\n".join(
            [
                "Good morning, Mike.",
                "",
                f"*Overnight Summary* ({date_str})",
                "Unable to inspect overnight activity.",
                f"Source: interactions at {DB_PATH}",
                f"Reason: {source_error}",
                "",
                "*PMs Due Today*",
                _pm_section(),
                "",
                "*KB Growth* (last 24h)",
                _kb_section(),
            ]
        )

    work_order_count = len(data["work_orders"])
    safety_count = len(data["safety_events"])
    safety_note = "needs review" if safety_count > 0 else "none"

    lines = [
        "Good morning, Mike.",
        "",
        f"*Overnight Summary* ({date_str})",
        f"- {work_order_count} work order{'s' if work_order_count != 1 else ''} created",
        f"- {safety_count} safety event{'s' if safety_count != 1 else ''} ({safety_note})",
        f"- {data['total_sessions']} active tech session{'s' if data['total_sessions'] != 1 else ''}",
        "",
        "*PMs Due Today*",
        _pm_section(),
        "",
        "*KB Growth* (last 24h)",
        _kb_section(),
    ]

    if safety_count == 0 and work_order_count == 0:
        lines += ["", "*No overnight interaction actions found.*"]
    elif safety_count > 0:
        lines += ["", f"*Review {safety_count} safety event(s) in CMMS.*"]

    return "\n".join(lines)


def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set - skipping push")
        return False
    try:
        import urllib.request

        now = datetime.now().strftime("%H:%M")
        full = f"*Dana (Morning Brief)* - {now}\n\n{message}"
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
            result = json.loads(resp.read())
            return result.get("ok", False)
    except Exception as exc:  # noqa: BLE001
        logger.error("Telegram push failed: %s", exc)
        return False


def main() -> None:
    logger.info("Morning brief starting")

    source_error: str | None = None
    if DB_PATH.exists():
        try:
            db = sqlite3.connect(str(DB_PATH))
            data, source_error = inspect_overnight(db)
            db.close()
        except Exception as exc:  # noqa: BLE001
            source_error = f"DB open failed: {exc}"
            logger.warning(source_error)
            data = empty_overnight_data(source_error=source_error)
    else:
        source_error = f"DB not found at {DB_PATH}"
        logger.warning(source_error)
        data = empty_overnight_data(source_error=source_error)

    try:
        append_event(
            runner="morning_brief",
            status="infra"
            if source_error
            else ("red" if data["safety_events"] else ("yellow" if data["work_orders"] else "green")),
            checked=["interactions", "kb-growth-cron"],
            evidence_path=str(DB_PATH),
            counts={
                "interactions": len(data["interactions"]),
                "safety_events": len(data["safety_events"]),
                "work_orders": len(data["work_orders"]),
                "sessions": data["total_sessions"],
            },
            unable_sources=[str(DB_PATH)] if source_error else [],
            next_action="Restore interactions DB before trusting morning brief" if source_error else "",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ledger append failed: %s", exc)

    brief = build_brief(data)
    logger.info("Brief built (%d chars)", len(brief))

    if send_telegram(brief):
        logger.info("Morning brief sent")
    else:
        logger.warning("Telegram push failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
