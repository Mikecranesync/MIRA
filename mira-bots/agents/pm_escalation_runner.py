"""PM Escalation Runner — runs inside mira-bot-telegram container at 12:00 UTC daily.

Queries `pm_schedules` (NeonDB) via shared.pm_scheduler.get_due_pms for due /
overdue PMs and pushes a digest to the OPS ALERT bot (staging), never the prod
user-facing bot. Grounded entirely in real pm_schedules rows — invents nothing.

Crontab (managed by install_crons.sh):
  0 12 * * *  docker exec mira-bot-telegram python3 /app/agents/pm_escalation_runner.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Make `shared` importable both in the container (/app/shared) and in local dev
# (mira-bots/shared) — the parent of this file's dir is /app or mira-bots/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("pm_escalation")

# Ops digest goes to the alert bot (staging), never @FactoryLM_Diagnose. Falls
# back to the old prod vars only if the alert channel is unwired.
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


def fetch_due_pms() -> list[dict]:
    """Real due/overdue PMs from NeonDB via the shared scheduler. [] on any error
    (never invents PM data)."""
    try:
        from shared.pm_scheduler import get_due_pms
    except Exception as exc:  # noqa: BLE001
        logger.warning("pm_scheduler import failed (%s) — no PM data", exc)
        return []
    try:
        return get_due_pms(TENANT_ID)
    except Exception as exc:  # noqa: BLE001
        logger.warning("get_due_pms failed: %s", exc)
        return []


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
    thr, cur = pm.get("meter_threshold"), pm.get("meter_current")
    if (
        pm.get("trigger_type") in ("meter", "calendar_or_meter")
        and thr is not None
        and cur is not None
        and cur >= thr
    ):
        return f"meter {int(cur)}/{int(thr)}"
    return "due now"


def build_message(pms: list[dict], max_list: int = MAX_LIST) -> str:
    if not pms:
        return "✓ No PMs due right now."
    crit = sum(1 for p in pms if (p.get("criticality") or "").lower() == "critical")
    header = f"*{len(pms)} PM{'s' if len(pms) != 1 else ''} due*"
    if crit:
        header += f" · {crit} critical"
    lines = [header]
    for p in pms[:max_list]:
        label = (
            " ".join(x for x in [p.get("manufacturer"), p.get("model_number")] if x)
            or p.get("equipment_id")
            or "unknown asset"
        )
        task = (p.get("task") or "PM task").strip()
        star = "🔴 " if (p.get("criticality") or "").lower() == "critical" else ""
        lines.append(f"{star}• `{label}` — {task} ({_due_label(p)})")
    if len(pms) > max_list:
        lines.append(f"…and {len(pms) - max_list} more")
    return "\n".join(lines)


def send_telegram(message: str) -> bool:
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning("alert bot token/chat not set — skipping push")
        return False
    try:
        now = datetime.now().strftime("%H:%M")
        full = f"🔧 *PM Scheduler* — {now}\n\n{message}"
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
    logger.info("PM escalation starting")
    pms = fetch_due_pms()
    logger.info("due PMs: %d", len(pms))
    if not send_telegram(build_message(pms)):
        logger.warning("push failed")
        sys.exit(1)
    logger.info("PM escalation sent ✓")


if __name__ == "__main__":
    main()
