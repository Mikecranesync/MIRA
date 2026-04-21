"""Personalized daily briefing engine — role-aware AI summarization per user.

Delivery channels: ntfy push | Resend email | (Telegram/Slack via bot adapters).
LLM: Groq llama-3.1-8b-instant (~500 tokens per briefing, fast + cheap).

Celery beat: every 15 minutes. Each run checks which profiles are due (preferred_time
within the current 15-minute window, UTC-adjusted) and delivers to matching users.

Role filtering:
  technician  — own assigned assets only, no KPIs, no team activity
  supervisor  — all assets in tenant, team activity optional
  manager     — full view: KPIs, open WOs, team summary
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("mira-briefing")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"

NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
NTFY_URL = os.getenv("NTFY_URL", "https://ntfy.sh")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "mira-factorylm-alerts")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "mira@factorylm.com")


# ---------------------------------------------------------------------------
# Profile loader (NeonDB)
# ---------------------------------------------------------------------------


def get_profiles_for_now(window_minutes: int = 15) -> list[dict]:
    """Return briefing profiles whose preferred_time falls within the current window.

    preferred_time is stored as HH:MM. We match if the current UTC hour:minute
    is within [preferred_time, preferred_time + window_minutes).
    Manager role ('all' shift) always matches regardless of shift.
    """
    if not NEON_DATABASE_URL:
        logger.warning("NEON_DATABASE_URL not set — cannot load briefing profiles")
        return []

    now_utc = datetime.now(timezone.utc)
    now_hhmm = now_utc.strftime("%H:%M")
    # Build list of HH:MM strings in the window
    window: list[str] = []
    from datetime import timedelta

    base = datetime.strptime(now_hhmm, "%H:%M")
    for i in range(window_minutes):
        window.append((base + timedelta(minutes=i)).strftime("%H:%M"))

    try:
        from sqlalchemy import NullPool, create_engine, text

        engine = create_engine(
            NEON_DATABASE_URL,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    text("SELECT * FROM briefing_profiles WHERE preferred_time = ANY(:times)"),
                    {"times": window},
                )
                .mappings()
                .all()
            )
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("get_profiles_for_now failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Activity loader (SQLite)
# ---------------------------------------------------------------------------


def get_recent_activity(db_path: str, since_hours: int = 12) -> list[dict]:
    """Return interactions from the last N hours."""
    from datetime import timedelta

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        cur = db.cursor()
        cur.execute(
            """
            SELECT chat_id, platform, user_message, bot_response,
                   fsm_state, intent, confidence, created_at
            FROM interactions
            WHERE created_at >= ?
            ORDER BY created_at ASC
            """,
            (cutoff,),
        )
        rows = [dict(r) for r in cur.fetchall()]
        db.close()
        return rows
    except Exception as exc:
        logger.warning("get_recent_activity DB failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Role-based filtering
# ---------------------------------------------------------------------------


def filter_for_role(rows: list[dict], profile: dict) -> list[dict]:
    """Filter activity rows based on role and assigned_assets."""
    role = profile.get("role", "technician")
    assigned = profile.get("assigned_assets") or []

    if role == "technician" and assigned:
        assigned_lower = [a.lower() for a in assigned]
        return [
            r
            for r in rows
            if any(a in (r.get("user_message") or "").lower() for a in assigned_lower)
        ]
    return rows


# ---------------------------------------------------------------------------
# Context builder
# ---------------------------------------------------------------------------


def build_briefing_context(rows: list[dict], profile: dict) -> str:
    """Build a plain-text context block for the LLM summarizer."""
    role = profile.get("role", "technician")
    digest = profile.get("digest_length", "short")
    lines = [f"Role: {role}", f"Digest: {digest}", ""]

    if not rows:
        return "\n".join(lines) + "No maintenance activity in the last 12 hours."

    # Group by chat session
    sessions: dict[str, list[dict]] = {}
    for r in rows:
        sessions.setdefault(r["chat_id"], []).append(r)

    for session_id, events in sessions.items():
        lines.append(f"Session {session_id[:16]}: {len(events)} events")
        sample = events[-3:] if digest == "short" else events[-8:]
        for ev in sample:
            ts = str(ev.get("created_at", ""))[:16]
            state = ev.get("fsm_state") or "?"
            msg = str(ev.get("user_message", ""))[:120].replace("\n", " ")
            lines.append(f"  [{ts}] [{state}] {msg}")

    if profile.get("include_kpis"):
        lines.append(f"\nKPI summary: {len(rows)} events across {len(sessions)} sessions")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Groq LLM summarizer
# ---------------------------------------------------------------------------


async def summarize_briefing(context: str, profile: dict) -> str:
    """Call Groq llama-3.1-8b-instant to produce a personalized briefing summary."""
    role = profile.get("role", "technician")
    digest = profile.get("digest_length", "short")
    max_tokens = 200 if digest == "short" else 500

    if not GROQ_API_KEY:
        # Fallback: plain text summary without LLM
        lines = context.split("\n")
        activity_lines = [
            l
            for l in lines
            if l.strip() and not l.startswith("Role:") and not l.startswith("Digest:")
        ]
        return "MIRA Daily Briefing\n\n" + "\n".join(activity_lines[:8])

    system_prompt = (
        f"You are MIRA, an industrial maintenance AI. "
        f"Write a concise {digest} briefing for a {role}. "
        "Focus on faults, unresolved issues, and action items. "
        "Use plain text. No markdown. Max 3 bullet points for short, 8 for detailed. "
        "Start with the most critical issue."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Maintenance activity:\n\n{context}"},
    ]

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": 0.3,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Groq briefing summarization failed: %s", exc)
        return context[:500]


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------


def _ascii_safe(text: str) -> str:
    """Replace common Unicode punctuation with ASCII equivalents for ntfy headers."""
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )


async def _deliver_push(summary: str, profile: dict) -> bool:
    title = f"MIRA Briefing {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    safe_summary = _ascii_safe(summary)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{NTFY_URL}/{NTFY_TOPIC}",
                content=safe_summary[:4000].encode("utf-8"),
                headers={
                    "Title": title,
                    "Priority": "default",
                    "Tags": "newspaper,robot",
                },
            )
            resp.raise_for_status()
            logger.info("BRIEFING push sent user=%s", profile.get("user_id"))
            return True
    except Exception as exc:
        logger.warning("BRIEFING push failed: %s", exc)
        return False


async def _deliver_email(summary: str, profile: dict) -> bool:
    email = profile.get("email", "")
    if not email or not RESEND_API_KEY:
        return False
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    subject = f"MIRA Daily Briefing — {date_str}"
    html = f"<pre style='font-family:monospace'>{summary}</pre>"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={"from": RESEND_FROM, "to": [email], "subject": subject, "html": html},
            )
            resp.raise_for_status()
            logger.info("BRIEFING email sent to %s", email)
            return True
    except Exception as exc:
        logger.warning("BRIEFING email failed: %s", exc)
        return False


async def deliver_briefing(summary: str, profile: dict) -> bool:
    """Route briefing to the user's preferred channel."""
    channel = profile.get("preferred_channel", "push")
    if channel == "email":
        return await _deliver_email(summary, profile)
    # Default: push (telegram/slack delivery lives in the respective adapters)
    return await _deliver_push(summary, profile)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def run_daily_briefings(db_path: str, profiles: Optional[list[dict]] = None) -> dict:
    """Fetch due profiles, build + deliver briefings. Returns run stats."""
    if profiles is None:
        profiles = get_profiles_for_now()

    if not profiles:
        logger.info("BRIEFING no profiles due now")
        return {"sent": 0, "profiles_checked": 0}

    rows = get_recent_activity(db_path)
    sent = 0
    failed = 0

    for profile in profiles:
        try:
            filtered = filter_for_role(rows, profile)
            context = build_briefing_context(filtered, profile)
            summary = await summarize_briefing(context, profile)
            ok = await deliver_briefing(summary, profile)
            if ok:
                sent += 1
            else:
                failed += 1
        except Exception as exc:
            logger.error("BRIEFING failed for user=%s: %s", profile.get("user_id"), exc)
            failed += 1

    result = {
        "sent": sent,
        "failed": failed,
        "profiles_checked": len(profiles),
        "activity_rows": len(rows),
    }
    logger.info("BRIEFING run complete: %s", result)
    return result


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------
try:
    from celery import shared_task
    from celery.schedules import crontab  # noqa: F401 — beat schedule reference

    @shared_task(name="mira_briefing.run_daily", bind=True, max_retries=2)
    def run_daily_briefing_task(self, db_path: str = "") -> dict:
        """Celery task: run personalized briefings every 15 minutes.

        Beat schedule (add to celery_app.py):
            beat_schedule['mira-briefing'] = {
                'task': 'mira_briefing.run_daily',
                'schedule': crontab(minute='*/15'),
                'kwargs': {'db_path': '/data/mira.db'},
            }
        """
        if not db_path:
            db_path = os.getenv("MIRA_DB_PATH", "/data/mira.db")

        try:
            return asyncio.run(run_daily_briefings(db_path))
        except Exception as exc:
            logger.error("run_daily_briefing_task failed: %s", exc)
            raise self.retry(exc=exc, countdown=120)

except ImportError:
    pass
