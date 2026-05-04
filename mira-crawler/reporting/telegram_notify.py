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

AGENTS: dict[str, dict[str, str]] = {
    "morning_brief":    {"name": "Dana (Morning Brief)",  "emoji": "☀️"},
    "safety_alert":     {"name": "Linda (Safety)",        "emoji": "🛑"},
    "pm_escalation":    {"name": "PM Scheduler",          "emoji": "🔧"},
    "kb_growth":        {"name": "KB Growth Engine",      "emoji": "📚"},
    "social_publisher": {"name": "Content Team",          "emoji": "📱"},
    "benchmark":        {"name": "QA Engineer",           "emoji": "📊"},
    "lead_hunter":      {"name": "Sales Scout",           "emoji": "🎯"},
    "churn_monitor":    {"name": "Customer Success",      "emoji": "⚠️"},
    "billing_health":   {"name": "Finance",               "emoji": "💰"},
    "asset_intel":      {"name": "Asset Intelligence",    "emoji": "🧠"},
    "cmms_sync":        {"name": "CMMS Sync",             "emoji": "🔄"},
    "training_loop":    {"name": "Training Engineer",     "emoji": "🎓"},
    "corpus_refresh":   {"name": "Research Analyst",      "emoji": "🔬"},
    "inbox_manager":    {"name": "Admin Assistant",       "emoji": "📧"},
    "system":           {"name": "System",                "emoji": "⚙️"},
}


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
    _token = token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    _chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID", os.environ.get("TELEGRAM_REPORT_CHAT_ID", ""))

    if not _token or not _chat_id:
        logger.debug("telegram_notify: no token/chat_id — skipping")
        return False

    agent = AGENTS.get(agent_key, {"name": agent_key, "emoji": "🤖"})
    timestamp = datetime.now().strftime("%H:%M")
    header = f"{agent['emoji']} *{agent['name']}* — {timestamp}"
    full_message = f"{header}\n\n{message}"

    try:
        import httpx
        resp = httpx.post(
            f"https://api.telegram.org/bot{_token}/sendMessage",
            json={
                "chat_id": _chat_id,
                "text": full_message,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        if resp.status_code == 200:
            logger.info("telegram_notify: sent as %s", agent["name"])
            return True
        logger.warning("telegram_notify: HTTP %d — %s", resp.status_code, resp.text[:200])
        return False
    except Exception as exc:
        logger.warning("telegram_notify: failed: %s", exc)
        return False


def notify_raw(text: str, parse_mode: str = "Markdown") -> bool:
    """Send a raw message with no agent header — for roll calls and system messages."""
    _token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    _chat_id = os.environ.get("TELEGRAM_CHAT_ID", os.environ.get("TELEGRAM_REPORT_CHAT_ID", ""))
    if not _token or not _chat_id:
        return False
    try:
        import httpx
        resp = httpx.post(
            f"https://api.telegram.org/bot{_token}/sendMessage",
            json={
                "chat_id": _chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        return resp.status_code == 200
    except Exception as exc:
        logger.warning("telegram_notify raw: %s", exc)
        return False
