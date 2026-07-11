"""
Telegram notification module for all FactoryLM agents.
Each agent has a name, emoji, and sends formatted updates to Mike.

Usage:
    from mira_crawler.reporting.telegram_notify import notify
    notify("kb_growth", "✅ Ingested *AB 700-Relay*\n16 chunks created\nQueue: 33 remaining")
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

logger = logging.getLogger("telegram_notify")


def alert_token(explicit: str | None = None) -> str:
    """Resolve the OPS-ALERT bot token.

    Ops/monitoring/report traffic must NOT land on the prod user-facing bot
    (@FactoryLM_Diagnose = TELEGRAM_BOT_TOKEN). Prefer a dedicated alert bot
    (TELEGRAM_ALERT_BOT_TOKEN, set to the staging bot in prod), then the staging
    token, and only fall back to the prod token if neither is configured (so this
    stays inert until the alert vars are set).
    """
    return (
        explicit
        or os.environ.get("TELEGRAM_ALERT_BOT_TOKEN")
        or os.environ.get("TELEGRAM_BOT_TOKEN_STG")
        or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    )


def alert_chat_id(explicit: str | None = None) -> str:
    """Resolve the OPS-ALERT destination chat (staging DM by default)."""
    return (
        explicit
        or os.environ.get("TELEGRAM_ALERT_CHAT_ID")
        or os.environ.get("TELEGRAM_CHAT_ID")
        or os.environ.get("TELEGRAM_REPORT_CHAT_ID", "")
    )


AGENTS: dict[str, dict[str, str]] = {
    "morning_brief": {"name": "Dana (Morning Brief)", "emoji": "☀️"},
    "safety_alert": {"name": "Linda (Safety)", "emoji": "🛑"},
    "pm_escalation": {"name": "PM Scheduler", "emoji": "🔧"},
    "kb_growth": {"name": "KB Growth Engine", "emoji": "📚"},
    "social_publisher": {"name": "Content Team", "emoji": "📱"},
    "benchmark": {"name": "QA Engineer", "emoji": "📊"},
    "lead_hunter": {"name": "Sales Scout", "emoji": "🎯"},
    "churn_monitor": {"name": "Customer Success", "emoji": "⚠️"},
    "billing_health": {"name": "Finance", "emoji": "💰"},
    "asset_intel": {"name": "Asset Intelligence", "emoji": "🧠"},
    "cmms_sync": {"name": "CMMS Sync", "emoji": "🔄"},
    "training_loop": {"name": "Training Engineer", "emoji": "🎓"},
    "corpus_refresh": {"name": "Research Analyst", "emoji": "🔬"},
    "inbox_manager": {"name": "Admin Assistant", "emoji": "📧"},
    "system": {"name": "System", "emoji": "⚙️"},
}


def _send(token: str, chat_id: str, text: str, parse_mode: str, label: str = "raw") -> bool:
    """POST to Telegram, falling back to plain text if the formatted send is
    rejected with a parse error.

    Machine-generated summaries (container statuses, error strings, log
    snippets) routinely contain unbalanced ``*`` / ``_`` / backticks that
    legacy Markdown can't parse — Telegram then returns HTTP 400
    "can't parse entities" and the alert is silently lost. An outage alert
    that never arrives is worse than an unformatted one, so on that specific
    failure we retry once with no parse_mode. Never raises.
    """
    import httpx

    def _post(pm: str | None) -> tuple[int, str]:
        body = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
        if pm:
            body["parse_mode"] = pm
        resp = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json=body, timeout=10)
        return resp.status_code, resp.text

    try:
        status, resp_text = _post(parse_mode)
        if status == 200:
            logger.info("telegram_notify: sent as %s", label)
            return True
        # 400 with a parse error → the formatting is the problem, not the
        # content. Retry once as plain text so the alert still lands.
        if status == 400 and "parse" in resp_text.lower():
            logger.warning("telegram_notify: %s parse error — retrying as plain text", parse_mode)
            status, resp_text = _post(None)
            if status == 200:
                logger.info("telegram_notify: sent as %s (plain-text fallback)", label)
                return True
        logger.warning("telegram_notify: HTTP %d — %s", status, resp_text[:200])
        return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("telegram_notify: failed: %s", exc)
        return False


def notify(
    agent_key: str,
    message: str,
    parse_mode: str = "Markdown",
    token: str | None = None,
    chat_id: str | None = None,
) -> bool:
    """Send a Telegram notification as a specific agent.

    Returns True on success. Never raises — callers don't need to try/except.
    """
    _token = alert_token(token)
    _chat_id = alert_chat_id(chat_id)

    if not _token or not _chat_id:
        logger.debug("telegram_notify: no token/chat_id — skipping")
        return False

    agent = AGENTS.get(agent_key, {"name": agent_key, "emoji": "🤖"})
    timestamp = datetime.now().strftime("%H:%M")
    header = f"{agent['emoji']} *{agent['name']}* — {timestamp}"
    full_message = f"{header}\n\n{message}"

    return _send(_token, _chat_id, full_message, parse_mode, label=agent["name"])


def notify_raw(text: str, parse_mode: str = "Markdown") -> bool:
    """Send a raw message with no agent header — for roll calls and system messages."""
    _token = alert_token()
    _chat_id = alert_chat_id()
    if not _token or not _chat_id:
        return False
    return _send(_token, _chat_id, text, parse_mode, label="raw")
