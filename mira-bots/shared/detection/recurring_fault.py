"""Recurring fault detection — fires after RESOLVED state.

After every diagnosis closes (FSM → RESOLVED), check whether the same asset
has experienced the same fault class in the last 30 days. If so:
  • Append a warning note to the diagnostic response
  • Push a manager notification

Usage (call from engine.py after RESOLVED transition):
    from shared.detection.recurring_fault import check_recurring_and_annotate
    reply, pushed = await check_recurring_and_annotate(db_path, state, reply)
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("mira-recurring-fault")

# How far back to look for the same fault
LOOKBACK_DAYS = 30
# How many occurrences in that window to trigger the warning
RECURRENCE_THRESHOLD = 2


def _count_recent(db_path: str, chat_id: str, asset: str, fault_category: str) -> list[dict]:
    """Return prior resolved sessions for this asset+fault in last LOOKBACK_DAYS days."""
    if not asset or not fault_category:
        return []
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        cur = db.cursor()
        cur.execute(
            """
            SELECT created_at, user_message
            FROM interactions
            WHERE chat_id != ?
              AND fsm_state = 'RESOLVED'
              AND created_at >= ?
              AND (user_message LIKE ? OR bot_response LIKE ?)
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (
                chat_id,
                cutoff,
                f"%{asset[:30]}%",
                f"%{asset[:30]}%",
            ),
        )
        rows = [dict(r) for r in cur.fetchall()]
        db.close()
        return rows
    except Exception as exc:
        logger.warning("RECURRING_FAULT query failed: %s", exc)
        return []


def _build_warning_note(prior_rows: list[dict], asset: str, fault_category: str) -> str:
    dates = [str(r.get("created_at", ""))[:10] for r in prior_rows[:3]]
    date_list = ", ".join(dates) if dates else "previously"
    return (
        f"\n\n⚠️ **Recurring fault detected** — {asset} has had a similar "
        f"**{fault_category}** issue on {date_list}. "
        "This may indicate a deeper root cause. Consider scheduling a preventive inspection."
    )


async def check_recurring_and_annotate(
    db_path: str,
    state: dict,
    reply: str,
) -> tuple[str, bool]:
    """Annotate reply with recurring-fault warning if applicable. Returns (reply, pushed)."""
    asset = state.get("asset_identified", "") or ""
    fault_category = state.get("fault_category", "") or ""
    chat_id = state.get("chat_id", "") or ""

    if not asset or not fault_category:
        return reply, False

    prior = _count_recent(db_path, chat_id, asset, fault_category)
    if len(prior) < RECURRENCE_THRESHOLD:
        return reply, False

    note = _build_warning_note(prior, asset, fault_category)
    annotated = reply + note

    pushed = False
    try:
        from shared.notifications.push import send_push

        pushed = await send_push(
            message=(
                f"Recurring fault on {asset}: {fault_category} — "
                f"{len(prior)} times in {LOOKBACK_DAYS} days"
            ),
            title="MIRA: Recurring Fault",
            priority="high",
            tags=["warning", "repeat"],
        )
    except Exception as exc:
        logger.warning("RECURRING_FAULT push failed: %s", exc)

    logger.info(
        "RECURRING_FAULT detected asset=%r category=%r occurrences=%d pushed=%s",
        asset,
        fault_category,
        len(prior),
        pushed,
    )
    return annotated, pushed
