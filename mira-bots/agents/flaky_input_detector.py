"""Flaky-input signal detector (master plan D6, Phase 9 / issue #1661).

Reads tag_event_diffs over a rolling 1-hour window, applies four instability
rules (rapid_toggle / brown_out / intermittent_disc / value_spike), and writes:
  - flaky_input_signals row (status='open')   — migration 034
  - ai_suggestions row ('flaky_signal_alert') — migration 027 + 118

Runs every 5 min via Celery beat on the historian queue. Single-tenant per
invocation. Fail-open: errors are logged; a failed tag's alert is skipped, the
cycle continues. The Celery wrapper (mira-crawler/tasks/flaky_input_detector.py)
calls run_detection_cycle().

Design rules
────────────
- Per-tag 7-day baseline required. Tags with < 7 days of event history are
  suppressed (avoid false positives on newly-appearing tags).
- Dedup: a tag with an OPEN alert created < 5 min ago is skipped.
- Rules run from pure flaky_rules.py; this module owns only I/O.
- Alerts go to the /proposals queue (status='pending'); they never push to
  Slack/Telegram until a human validates (master plan Phase 9 doctrine).
- Zero writes on a quiet cycle.

Env
───
  NEON_DATABASE_URL       — NeonDB connection (required)
  MIRA_TENANT_ID          — tenant UUID (required)
  FLAKY_WINDOW            — detection window label, default '1h'
  FLAKY_MIN_BASELINE_DAYS — days of history required, default 7
  FLAKY_BATCH_SIZE        — max tag-diff rows per run, default 500
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("mira.flaky_input_detector")

_WINDOW = os.getenv("FLAKY_WINDOW", "1h")
_MIN_BASELINE_DAYS = int(os.getenv("FLAKY_MIN_BASELINE_DAYS", "7"))
_BATCH_SIZE = int(os.getenv("FLAKY_BATCH_SIZE", "500"))

# ── SQL ───────────────────────────────────────────────────────────────────────

_SQL_RECENT_DIFFS = """
SELECT diff_id::text, tag_path, uns_path::text AS uns_path,
       diff_type, prev_value, new_value, value_type,
       from_event_id::text, to_event_id::text,
       event_timestamp
FROM tag_event_diffs
WHERE tenant_id = :tenant_id::uuid
  AND event_timestamp >= NOW() - :window_days * INTERVAL '1 day'
  AND simulated = false
ORDER BY tag_path, event_timestamp
LIMIT :batch_size
"""

# Tags with at least one event OLDER than min_baseline_days → baseline established.
_SQL_BASELINE_TAGS = """
SELECT DISTINCT tag_path
FROM tag_events
WHERE tenant_id = :tenant_id::uuid
  AND event_timestamp < NOW() - :min_days * INTERVAL '1 day'
  AND simulated = false
"""

# 7-day stats for analog value_spike detection.
_SQL_BASELINE_STATS = """
SELECT tag_path,
       COUNT(*) AS event_count,
       AVG(value::numeric) AS mean_value,
       STDDEV(value::numeric) AS stddev_value
FROM tag_events
WHERE tenant_id = :tenant_id::uuid
  AND event_timestamp >= NOW() - :min_days * INTERVAL '1 day'
  AND simulated = false
  AND value_type IN ('int', 'float')
  AND value ~ '^-?[0-9]+(\\.[0-9]+)?$'
GROUP BY tag_path
"""

# Tags with an OPEN alert in the last 5 min — dedup.
_SQL_RECENT_ALERTS = """
SELECT DISTINCT source_tag_path
FROM flaky_input_signals
WHERE tenant_id = :tenant_id::uuid
  AND status = 'open'
  AND created_at >= NOW() - INTERVAL '5 minutes'
"""

_SQL_INSERT_SIGNAL = """
INSERT INTO flaky_input_signals
    (tenant_id, uns_path, source_tag_path, detection_window,
     transition_count, stable_peer_tags, confidence,
     evidence_event_ids, status, metadata)
VALUES
    (:tenant_id::uuid,
     NULLIF(:uns_path, '')::ltree,
     :source_tag_path,
     :detection_window,
     :transition_count,
     :stable_peer_tags::jsonb,
     :confidence,
     :evidence_event_ids::jsonb,
     'open',
     :metadata::jsonb)
RETURNING alert_id::text
"""

_SQL_INSERT_SUGGESTION = """
INSERT INTO ai_suggestions
    (tenant_id, suggestion_type, source_kind, extracted_data,
     confidence, status, risk_level, proposed_by, title, body)
VALUES
    (:tenant_id::uuid,
     'flaky_signal_alert',
     'live_event',
     :extracted_data::jsonb,
     :confidence_float,
     'pending',
     'low',
     'rule:flaky_input_detector',
     :title,
     :body)
RETURNING id::text
"""

_SQL_LINK_SUGGESTION = """
UPDATE flaky_input_signals
SET ai_suggestion_id = :suggestion_id::uuid,
    updated_at = NOW()
WHERE alert_id = :alert_id::uuid
  AND tenant_id = :tenant_id::uuid
"""

# ── Helpers ───────────────────────────────────────────────────────────────────


def _confidence_float(band: str) -> float:
    return {"low": 0.4, "medium": 0.65, "high": 0.85}.get(band, 0.4)


def _best_confidence(results: list) -> str:
    fired = [r for r in results if r.fired]
    if not fired:
        return "low"
    order = ["low", "medium", "high"]
    return max(
        fired,
        key=lambda r: order.index(r.confidence) if r.confidence in order else 0,
    ).confidence


def _collect_evidence_ids(results: list) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for r in results:
        if r.fired:
            for eid in r.evidence_event_ids:
                if eid and eid not in seen:
                    seen.add(eid)
                    out.append(eid)
    return out[:50]  # cap to avoid oversized JSONB


def _make_title(tag_path: str, fired_names: list[str]) -> str:
    return f"Flaky input: {tag_path} ({', '.join(fired_names)})"


def _make_body(tag_path: str, results: list) -> str:
    lines = [f"Instability detected on tag `{tag_path}`:"]
    for r in results:
        if r.fired:
            lines.append(
                f"  • {r.rule_name}: {r.transition_count} event(s) "
                f"in {r.detection_window} [{r.confidence}]"
            )
    return "\n".join(lines)


# ── Main cycle ────────────────────────────────────────────────────────────────


def run_detection_cycle(db_url: str, tenant_id: str) -> dict[str, Any]:
    """Run one detection pass. Returns stats dict. Never raises.

    Uses separate connections for reads and each tag's writes so a single-tag
    failure does not roll back other tags' alerts.
    """
    # Import lazily so the module is importable even without sqlalchemy installed
    # (the Celery wrapper gracefully skips if the import fails).
    from shared.flaky_rules import (  # type: ignore[import]
        brown_out,
        intermittent_disc,
        rapid_toggle,
        value_spike,
    )

    stats: dict[str, Any] = {
        "tags_scanned": 0,
        "tags_suppressed": 0,
        "alerts_created": 0,
        "errors": 0,
    }

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except ImportError:
        logger.error("sqlalchemy not installed; skipping flaky detector")
        stats["errors"] += 1
        return stats

    def _engine():
        return create_engine(
            db_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    # ── Read phase ────────────────────────────────────────────────────────────
    try:
        with _engine().connect() as conn:
            conn.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": tenant_id})
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})

            # 1h window expressed in fractional days keeps params consistent.
            window_days = 1.0 / 24.0

            diff_rows = (
                conn.execute(
                    text(_SQL_RECENT_DIFFS),
                    {
                        "tenant_id": tenant_id,
                        "window_days": window_days,
                        "batch_size": _BATCH_SIZE,
                    },
                )
                .mappings()
                .all()
            )

            if not diff_rows:
                return stats

            baseline_tag_rows = (
                conn.execute(
                    text(_SQL_BASELINE_TAGS),
                    {"tenant_id": tenant_id, "min_days": _MIN_BASELINE_DAYS},
                )
                .mappings()
                .all()
            )
            baseline_tags: set[str] = {r["tag_path"] for r in baseline_tag_rows}

            baseline_stat_rows = (
                conn.execute(
                    text(_SQL_BASELINE_STATS),
                    {"tenant_id": tenant_id, "min_days": _MIN_BASELINE_DAYS},
                )
                .mappings()
                .all()
            )
            baseline_stats: dict[str, dict[str, Any]] = {
                r["tag_path"]: {
                    "event_count": int(r["event_count"] or 0),
                    "mean": float(r["mean_value"]) if r["mean_value"] is not None else None,
                    "stddev": float(r["stddev_value"]) if r["stddev_value"] is not None else None,
                }
                for r in baseline_stat_rows
            }

            recent_alert_rows = (
                conn.execute(
                    text(_SQL_RECENT_ALERTS),
                    {"tenant_id": tenant_id},
                )
                .mappings()
                .all()
            )
            recently_alerted: set[str] = {r["source_tag_path"] for r in recent_alert_rows}

    except Exception as exc:
        logger.error("flaky detector: read phase failed: %s", exc)
        stats["errors"] += 1
        return stats

    # ── Group diffs by tag ────────────────────────────────────────────────────
    by_tag: dict[str, list[dict[str, Any]]] = {}
    for row in diff_rows:
        tag = row["tag_path"]
        by_tag.setdefault(tag, []).append(dict(row))

    stats["tags_scanned"] = len(by_tag)

    # ── Per-tag detection + write phase ───────────────────────────────────────
    for tag, diffs in by_tag.items():
        if tag not in baseline_tags:
            stats["tags_suppressed"] += 1
            continue
        if tag in recently_alerted:
            stats["tags_suppressed"] += 1
            continue

        bline = baseline_stats.get(tag, {"event_count": 0, "mean": None, "stddev": None})
        results = [
            rapid_toggle(diffs, window=_WINDOW),
            brown_out(diffs, window=_WINDOW),
            intermittent_disc(diffs, window=_WINDOW),
            value_spike(diffs, bline, window=_WINDOW),
        ]
        fired = [r for r in results if r.fired]
        if not fired:
            continue

        uns_path = diffs[0].get("uns_path") or ""
        confidence = _best_confidence(results)
        evidence_ids = _collect_evidence_ids(results)
        fired_names = [r.rule_name for r in fired]
        total_transitions = sum(r.transition_count for r in fired)

        metadata_payload = json.dumps(
            {
                "rules_fired": [
                    {
                        "rule": r.rule_name,
                        "count": r.transition_count,
                        "confidence": r.confidence,
                        "meta": r.metadata,
                    }
                    for r in fired
                ]
            }
        )

        # Each tag's writes are a single committed transaction.
        try:
            with _engine().begin() as conn:
                conn.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": tenant_id})
                conn.execute(
                    text("SET LOCAL app.current_tenant_id = :tid"),
                    {"tid": tenant_id},
                )

                alert_row = (
                    conn.execute(
                        text(_SQL_INSERT_SIGNAL),
                        {
                            "tenant_id": tenant_id,
                            "uns_path": uns_path,
                            "source_tag_path": tag,
                            "detection_window": _WINDOW,
                            "transition_count": total_transitions,
                            "stable_peer_tags": "[]",
                            "confidence": confidence,
                            "evidence_event_ids": json.dumps(evidence_ids),
                            "metadata": metadata_payload,
                        },
                    )
                    .mappings()
                    .first()
                )
                alert_id = str(alert_row["alert_id"])

                sug_row = (
                    conn.execute(
                        text(_SQL_INSERT_SUGGESTION),
                        {
                            "tenant_id": tenant_id,
                            "extracted_data": json.dumps(
                                {
                                    "alert_id": alert_id,
                                    "source_tag_path": tag,
                                    "uns_path": uns_path,
                                    "rules_fired": fired_names,
                                    "transition_count": total_transitions,
                                    "confidence": confidence,
                                }
                            ),
                            "confidence_float": _confidence_float(confidence),
                            "title": _make_title(tag, fired_names),
                            "body": _make_body(tag, results),
                        },
                    )
                    .mappings()
                    .first()
                )
                suggestion_id = str(sug_row["id"])

                conn.execute(
                    text(_SQL_LINK_SUGGESTION),
                    {
                        "suggestion_id": suggestion_id,
                        "alert_id": alert_id,
                        "tenant_id": tenant_id,
                    },
                )

        except Exception as exc:
            logger.error("flaky detector: write failed for tag=%s: %s", tag, exc)
            stats["errors"] += 1
            continue

        stats["alerts_created"] += 1
        logger.info(
            "flaky alert: tag=%s rules=%s confidence=%s alert=%s suggestion=%s",
            tag,
            fired_names,
            confidence,
            alert_id,
            suggestion_id,
        )

    return stats


def main() -> None:
    """CLI entry point for direct invocation.

    Usage:
        doppler run -- python -m mira_bots.agents.flaky_input_detector
    """
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    )
    db_url = os.environ.get("NEON_DATABASE_URL", "")
    tenant_id = os.environ.get("MIRA_TENANT_ID", "")
    if not db_url:
        logger.error("NEON_DATABASE_URL not set")
        sys.exit(1)
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set")
        sys.exit(1)

    result = run_detection_cycle(db_url, tenant_id)
    logger.info("detection cycle complete: %s", result)
    if result.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
