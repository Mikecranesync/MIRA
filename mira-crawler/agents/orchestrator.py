"""
Master of Puppets — 24-hour sequential agent orchestrator.

Provides shared state (daily_context.json) and a run_agent() wrapper that:
  1. Reads today's context
  2. Runs the agent function
  3. Writes results back
  4. Sends a Telegram notification

Each agent script in the cycle calls run_agent() — they automatically share
context so later agents can read what earlier agents did.

State file: /opt/mira/agent_state/daily_context.json
"""
from __future__ import annotations

import json
import logging
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("orchestrator")

STATE_DIR = Path(os.environ.get("MIRA_STATE_DIR", "/opt/mira/agent_state"))
STATE_FILE = STATE_DIR / "daily_context.json"


# ── State management ──────────────────────────────────────────────────────────

def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_context() -> dict[str, Any]:
    """Load today's shared context, creating a fresh one if it's a new day."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    today = _today()

    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            if data.get("date") == today:
                return data
        except (json.JSONDecodeError, OSError):
            pass

    # New day — fresh context
    fresh: dict[str, Any] = {"date": today, "agents": {}}
    STATE_FILE.write_text(json.dumps(fresh, indent=2))
    return fresh


def save_context(ctx: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(ctx, indent=2))


def get_agent_result(agent_key: str) -> dict[str, Any] | None:
    """Return the result dict a previous agent wrote, or None."""
    ctx = load_context()
    entry = ctx.get("agents", {}).get(agent_key)
    if entry and entry.get("status") == "done":
        return entry.get("result")
    return None


# ── Telegram ──────────────────────────────────────────────────────────────────

def _send_telegram(text: str) -> bool:
    """Send a plain Markdown message. Falls back gracefully if env vars missing."""
    import urllib.request

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "8445149012")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — skipping notification")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status == 200
    except Exception as exc:
        logger.warning("Telegram send failed: %s", exc)
        return False


# ── run_agent wrapper ─────────────────────────────────────────────────────────

def run_agent(
    key: str,
    fn: Callable[[], dict[str, Any]],
    *,
    name: str,
    emoji: str,
    telegram_template: Callable[[dict[str, Any]], str] | None = None,
) -> dict[str, Any]:
    """
    Execute one agent in the daily cycle.

    key              — machine key written to daily_context (e.g. "kb_growth")
    fn               — zero-arg callable; must return a result dict
    name             — human name for Telegram header
    emoji            — single emoji prefix for Telegram header
    telegram_template — optional callable(result) -> str body; default is
                        a JSON dump of the result dict

    Writes to daily_context.json regardless of success/failure.
    Always sends a Telegram message.
    Returns the result dict (or {"error": ...} on failure).
    """
    ctx = load_context()
    now_utc = datetime.now(timezone.utc)
    time_str = now_utc.strftime("%H:%M")

    logger.info("[%s] %s starting", time_str, key)

    try:
        result = fn()
        status = "done"
        error: str | None = None
    except Exception:
        tb = traceback.format_exc()
        logger.error("[%s] agent error:\n%s", key, tb)
        result = {}
        status = "error"
        error = tb.splitlines()[-1]

    # Write to shared context
    ctx.setdefault("agents", {})[key] = {
        "status": status,
        "time": time_str,
        "result": result,
        **({"error": error} if error else {}),
    }
    save_context(ctx)

    # Build and send Telegram message
    if status == "done":
        body = telegram_template(result) if telegram_template else (
            "\n".join(f"  {k}: {v}" for k, v in result.items())
        )
        msg = f"{emoji} *{name}*\n\n{body}"
    else:
        msg = f"{emoji} *{name}* — ❌ Error\n\n`{error}`"

    _send_telegram(msg)

    return result


# ── Daily digest (System agent) ───────────────────────────────────────────────

def run_daily_digest() -> dict[str, Any]:
    """
    System agent — midnight summary of everything that ran today.
    Called directly by its cron entry.
    """
    ctx = load_context()
    agents = ctx.get("agents", {})
    date = ctx.get("date", _today())

    total = len(agents)
    done = sum(1 for v in agents.values() if v.get("status") == "done")
    errors = sum(1 for v in agents.values() if v.get("status") == "error")

    lines = [f"⚙️ *System — Daily Digest* — {date}\n"]
    lines.append(f"*{done}/{total} agents completed* · {errors} error(s)\n")

    for key, entry in sorted(agents.items(), key=lambda x: x[1].get("time", "")):
        status_icon = "✅" if entry["status"] == "done" else "❌"
        t = entry.get("time", "--:--")
        result = entry.get("result", {})

        # One-line summary per agent
        summary = ""
        if key == "kb_growth":
            summary = f"Ingested: {result.get('manual', 'none')} · {result.get('chunks', 0)} chunks"
        elif key == "qa_benchmark":
            summary = f"Accuracy: {result.get('accuracy', '?')}% (Δ {result.get('delta', '?')}%)"
        elif key == "morning_brief":
            summary = f"WOs open: {result.get('open_wos', 0)} · PMs due: {result.get('pms_due', 0)}"
        elif key == "safety_scan":
            summary = f"LOTO procedures: {result.get('loto_found', 0)} · Incidents: {result.get('incidents', 0)}"
        elif key == "inbox_triage":
            summary = f"Emails: {result.get('total', 0)} · Urgent: {result.get('urgent', 0)}"
        elif key == "lead_scout":
            summary = f"Facilities found: {result.get('found', 0)} · ICP matches: {result.get('icp_matches', 0)}"
        elif key == "content_draft":
            summary = f"Draft ready: {result.get('draft_ready', False)}"
        elif key == "billing_health":
            summary = f"MRR: ${result.get('mrr', 0)} · Issues: {result.get('issues', 0)}"
        elif key == "cmms_sync":
            summary = f"WOs synced: {result.get('synced', 0)} · Conflicts: {result.get('conflicts', 0)}"
        elif key == "asset_intel":
            summary = f"Assets enriched: {result.get('enriched', 0)}"
        elif key == "corpus_refresh":
            summary = f"New Q&A added: {result.get('added', 0)}"
        elif key == "pm_escalation":
            summary = f"Overdue: {result.get('overdue', 0)} · Due tomorrow: {result.get('due_tomorrow', 0)}"
        else:
            summary = entry.get("error", "ok") if entry["status"] == "error" else "ok"

        lines.append(f"{status_icon} {t}  `{key}` — {summary}")

    msg = "\n".join(lines)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "8445149012")
    if token:
        import urllib.request
        payload = json.dumps({
            "chat_id": chat_id, "text": msg, "parse_mode": "Markdown",
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
        except Exception as exc:
            logger.warning("Daily digest Telegram send failed: %s", exc)

    return {"date": date, "done": done, "total": total, "errors": errors}


if __name__ == "__main__":
    # When run directly: print today's context
    import sys
    ctx = load_context()
    print(json.dumps(ctx, indent=2))
    sys.exit(0)
