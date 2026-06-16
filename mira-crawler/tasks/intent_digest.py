"""Daily intent-signal digest — Telegram summary at 06:00 ET.

Aggregates the last 24 hours of ``intent_signals`` into one message for Mike.
Includes top signal, per-source counts, and a simple week-over-week trend on
the most-mentioned keyword in titles + content.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app  # type: ignore[no-redef]

logger = logging.getLogger("mira-crawler.tasks.intent_digest")

_HUB_URL = os.getenv("INTENT_DASHBOARD_URL", "app.factorylm.com/hub/intent-signals")

_TREND_KEYWORDS: list[str] = [
    "digital transformation",
    "CMMS",
    "MaintainX",
    "UpKeep",
    "Limble",
    "Fiix",
    "paper work orders",
    "predictive maintenance",
    "PLC",
    "Allen Bradley",
]


def _engine():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _fetch_recent_signals(hours: int = 24) -> list[dict]:
    sql = text(
        """
        SELECT source, title, content, intent_score, intent_category,
               suggested_reply, url, author
        FROM intent_signals
        WHERE created_at >= now() - (:hours || ' hours')::interval
        ORDER BY intent_score DESC, created_at DESC
        """
    )
    with _engine().connect() as conn:
        rows = conn.execute(sql, {"hours": str(hours)}).mappings().all()
    return [dict(r) for r in rows]


def _trend_for_keyword(kw: str) -> tuple[int, int]:
    """Return ``(this_week, prior_week)`` mention counts in title+content."""
    sql = text(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE created_at >= now() - interval '7 days'
            ) AS this_week,
            COUNT(*) FILTER (
                WHERE created_at >= now() - interval '14 days'
                  AND created_at <  now() - interval '7 days'
            ) AS prior_week
        FROM intent_signals
        WHERE (title ILIKE :pat OR content ILIKE :pat)
        """
    )
    with _engine().connect() as conn:
        row = conn.execute(sql, {"pat": f"%{kw}%"}).mappings().fetchone()
    if not row:
        return (0, 0)
    return (int(row["this_week"] or 0), int(row["prior_week"] or 0))


def _top_trend() -> tuple[str, int, int]:
    """Return ``(keyword, this_week, prior_week)`` for the biggest mover."""
    best = ("", 0, 0)
    best_delta = -1
    for kw in _TREND_KEYWORDS:
        this_wk, prior = _trend_for_keyword(kw)
        if this_wk == 0:
            continue
        delta = this_wk - prior
        if delta > best_delta:
            best_delta = delta
            best = (kw, this_wk, prior)
    return best


def _format_digest(signals: list[dict]) -> str:
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    by_source: dict[str, list[dict]] = {}
    for s in signals:
        by_source.setdefault(s["source"], []).append(s)

    lines = [f"📊 *Daily Intent Digest* — {today}", ""]
    if not signals:
        lines.append("_No new signals in the last 24h._")
        lines.append("")
        lines.append(f"Dashboard: {_HUB_URL}")
        return "\n".join(lines)

    for src in ("reddit", "youtube", "linkedin"):
        rows = by_source.get(src, [])
        if not rows:
            continue
        high = sum(1 for r in rows if (r.get("intent_score") or 0) >= 75)
        lines.append(f"*{src.capitalize()}:* {len(rows)} signals ({high} high-intent)")

    top = signals[0]
    title_snip = (top.get("title") or top.get("content") or "")[:160]
    title_snip = re.sub(r"\s+", " ", title_snip).strip()
    lines.append("")
    lines.append("🔥 *Top Signal:*")
    lines.append(f"{top['source']} — _{title_snip}_")
    lines.append(
        f"Score: *{top['intent_score']}* | Category: {top.get('intent_category') or '—'}"
    )
    reply = (top.get("suggested_reply") or "").strip()
    if reply:
        lines.append(f"Suggested reply: \"{reply}\"")
    lines.append(f"→ {top['url']}")

    kw, this_wk, prior = _top_trend()
    if kw:
        arrow = "up" if this_wk > prior else ("down" if this_wk < prior else "flat")
        lines.append("")
        lines.append(
            f"📈 *Trending:* \"{kw}\" mentioned {this_wk}x this week ({arrow} from {prior})"
        )

    lines.append("")
    lines.append(f"Dashboard: {_HUB_URL}")
    return "\n".join(lines)


def _send(message: str) -> bool:
    try:
        from mira_crawler.reporting.telegram_notify import notify
    except ImportError:
        try:
            from reporting.telegram_notify import notify  # type: ignore[no-redef]
        except ImportError:
            logger.warning("telegram_notify unavailable")
            return False
    return notify("intent_scout", message)


@app.task(name="tasks.intent_digest.send_daily_digest", bind=True, max_retries=1)
def send_daily_digest(self) -> dict:  # noqa: ARG001
    try:
        signals = _fetch_recent_signals(hours=24)
    except Exception as exc:
        logger.error("digest fetch failed: %s", exc)
        return {"error": str(exc)}

    message = _format_digest(signals)
    delivered = _send(message)
    summary = {"signals": len(signals), "delivered": delivered}
    logger.info("intent_digest done: %s", summary)
    return summary
