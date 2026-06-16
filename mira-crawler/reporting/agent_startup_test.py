"""
Roll call — sends a startup check-in from every FactoryLM agent.
Run this to verify the notification system is wired and Mike is receiving messages.

Usage:
  cd /opt/mira && doppler run -- python3 mira-crawler/reporting/agent_startup_test.py
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Path setup so we can import telegram_notify regardless of CWD
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from mira_crawler.reporting.telegram_notify import AGENTS, notify_raw
except ImportError:
    # Direct file import fallback
    import importlib.util, types

    _pkg = types.ModuleType("mira_crawler")
    _pkg.reporting = types.ModuleType("mira_crawler.reporting")  # type: ignore[attr-defined]
    sys.modules.setdefault("mira_crawler", _pkg)
    sys.modules.setdefault("mira_crawler.reporting", _pkg.reporting)  # type: ignore[attr-defined]

    _spec = importlib.util.spec_from_file_location(
        "mira_crawler.reporting.telegram_notify",
        Path(__file__).parent / "telegram_notify.py",
    )
    _mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
    _mod.__package__ = "mira_crawler.reporting"
    sys.modules["mira_crawler.reporting.telegram_notify"] = _mod
    _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
    AGENTS = _mod.AGENTS
    notify_raw = _mod.notify_raw


# Agents that are truly live vs pending setup
LIVE = {
    "morning_brief", "safety_alert", "pm_escalation",
    "kb_growth", "benchmark", "asset_intel",
}
DRY_RUN = {
    "social_publisher",   # awaiting API key
}
PENDING = {
    "lead_hunter", "churn_monitor", "billing_health",
    "cmms_sync", "training_loop", "corpus_refresh", "inbox_manager",
}


def build_roll_call() -> str:
    now = datetime.now(timezone.utc)
    ts = now.strftime("%H:%M")

    lines = [
        f"⚙️ *System* — {ts}",
        "",
        "🟢 *FactoryLM Digital Workforce — Roll Call*",
        "",
    ]

    for key in ("morning_brief", "safety_alert", "pm_escalation", "kb_growth",
                "social_publisher", "benchmark", "asset_intel",
                "cmms_sync", "training_loop", "corpus_refresh",
                "billing_health", "lead_hunter", "inbox_manager"):
        agent = AGENTS.get(key, {"name": key, "emoji": "🤖"})
        name = agent["name"]
        emoji = agent["emoji"]
        if key in LIVE:
            lines.append(f"{emoji} {name} — Online ✓")
        elif key in DRY_RUN:
            lines.append(f"{emoji} {name} — Online _(dry-run, awaiting API key)_")
        else:
            lines.append(f"{emoji} {name} — Pending setup")

    live_count = len(LIVE)
    dry_count  = len(DRY_RUN)
    total      = live_count + dry_count

    lines += [
        "",
        f"*{total}/{total + len(PENDING)} agents operational.*",
        f"Next run: ☀️ Morning Brief at 05:00 ET.",
    ]
    return "\n".join(lines)


def main() -> None:
    msg = build_roll_call()
    print(msg)
    print()
    ok = notify_raw(msg)
    if ok:
        print("✔  Roll call sent to Telegram.")
    else:
        print("✗  Telegram send failed — check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.")
        sys.exit(1)


if __name__ == "__main__":
    main()
