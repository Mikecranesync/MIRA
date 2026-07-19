"""PM Escalation Runner - scheduled inside the Telegram bot container.

Queries pm_schedules via shared.pm_scheduler.get_due_pms and pushes a digest to
the ops alert bot. Source failures are reported explicitly; they are never
treated as "no PMs due".
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(AGENT_DIR))
sys.path.insert(0, str(AGENT_DIR.parent))

from runner_ledger import append_event

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("pm_escalation")

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
TENANT_ID = os.environ.get("MIRA_TENANT_ID") or None
MAX_LIST = int(os.environ.get("PM_ESCALATION_MAX_LIST", "10"))


def inspect_due_pms() -> tuple[list[dict], str | None]:
    try:
        from shared.pm_scheduler import get_due_pms
    except Exception as exc:  # noqa: BLE001
        reason = f"pm_scheduler import failed: {exc}"
        logger.warning(reason)
        return [], reason
    try:
        return list(get_due_pms(TENANT_ID) or []), None
    except Exception as exc:  # noqa: BLE001
        reason = f"get_due_pms failed: {exc}"
        logger.warning(reason)
        return [], reason


def fetch_due_pms() -> list[dict]:
    pms, _source_error = inspect_due_pms()
    return pms


def _overdue_days(next_due_at: str | None) -> int | None:
    if not next_due_at:
        return None
    try:
        due = datetime.fromisoformat(next_due_at)
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - due).total_seconds() // 86400))
    except Exception:  # noqa: BLE001
        return None


def _due_label(pm: dict) -> str:
    od = _overdue_days(pm.get("next_due_at"))
    if od is not None and od > 0:
        return f"overdue {od}d"
    threshold = pm.get("meter_threshold")
    current = pm.get("meter_current")
    if (
        pm.get("trigger_type") in ("meter", "calendar_or_meter")
        and threshold is not None
        and current is not None
        and current >= threshold
    ):
        return f"meter {int(current)}/{int(threshold)}"
    return "due now"


def build_message(
    pms: list[dict],
    max_list: int = MAX_LIST,
    source_error: str | None = None,
) -> str:
    if source_error:
        return "\n".join(
            [
                "Unable to inspect PM schedule.",
                "Source: shared.pm_scheduler.get_due_pms",
                f"Reason: {source_error}",
            ]
        )
    if not pms:
        return "OK: No PMs due right now."

    critical_count = sum(1 for p in pms if (p.get("criticality") or "").lower() == "critical")
    header = f"*{len(pms)} PM{'s' if len(pms) != 1 else ''} due*"
    if critical_count:
        header += f" - {critical_count} critical"

    lines = [header]
    for pm in pms[:max_list]:
        label = (
            " ".join(x for x in [pm.get("manufacturer"), pm.get("model_number")] if x)
            or pm.get("equipment_id")
            or "unknown asset"
        )
        task = (pm.get("task") or "PM task").strip()
        prefix = "CRITICAL - " if (pm.get("criticality") or "").lower() == "critical" else "- "
        lines.append(f"{prefix}`{label}`: {task} ({_due_label(pm)})")
    if len(pms) > max_list:
        lines.append(f"...and {len(pms) - max_list} more")
    return "\n".join(lines)


def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("alert bot token/chat not set - skipping push")
        return False
    try:
        now = datetime.now().strftime("%H:%M")
        full = f"*PM Scheduler* - {now}\n\n{message}"
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


def _ledger_status(pms: list[dict], source_error: str | None) -> str:
    if source_error:
        return "infra"
    if any((p.get("criticality") or "").lower() == "critical" for p in pms):
        return "red"
    if pms:
        return "yellow"
    return "green"


def main() -> None:
    logger.info("PM escalation starting")
    pms, source_error = inspect_due_pms()
    logger.info("due PMs: %d source_error=%s", len(pms), bool(source_error))
    try:
        append_event(
            runner="pm_escalation",
            status=_ledger_status(pms, source_error),
            checked=["pm_schedules"],
            evidence_path="shared.pm_scheduler.get_due_pms",
            counts={"due_pms": len(pms)},
            unable_sources=["pm_schedules"] if source_error else [],
            next_action="Restore PM schedule source before trusting PM all-clear" if source_error else "",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ledger append failed: %s", exc)

    if not send_telegram(build_message(pms, source_error=source_error)):
        logger.warning("push failed")
        sys.exit(1)
    logger.info("PM escalation sent")


if __name__ == "__main__":
    main()
