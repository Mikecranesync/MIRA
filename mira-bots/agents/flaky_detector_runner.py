"""Flaky-input / sensor-anomaly detector — Phase 9 (issue #1661).

Scans tag_event_diffs for the last 1 hour across all active tenants.
For each (tenant_id, tag_path) pair that has a 7-day baseline established,
applies the four detection rules (rapid_toggle / brown_out /
intermittent_disc / value_spike).  Any hit that has no open alert in the
last 5 minutes produces:
  1. An ai_suggestions row (type='flaky_signal_alert', status='pending')
  2. A flaky_input_signals row linked via ai_suggestion_id

Alerts land in the Hub /proposals queue — NOT pushed to the technician
until an operator validates the finding (issue #1661 requirement).

Crontab (managed by install_crons.sh):
  */5 * * * *  docker exec mira-bot-telegram python3 /app/agents/flaky_detector_runner.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("flaky-detector")

# ── Config ────────────────────────────────────────────────────────────────────

NEON_URL = os.environ.get("NEON_DATABASE_URL", "")
DETECTION_WINDOW = "1h"
BASELINE_DAYS = 7       # suppress alerts until a tag has this much history
DEDUP_WINDOW_MIN = 5    # minutes; skip if an open alert already exists in this window

# ── Queries ───────────────────────────────────────────────────────────────────

_ACTIVE_TAGS_SQL = """
SELECT DISTINCT tenant_id::text, tag_path
FROM tag_event_diffs
WHERE event_timestamp >= NOW() - INTERVAL '1 hour'
  AND diff_type IN (
      'rising_edge', 'falling_edge',
      'threshold_cross_low', 'threshold_cross_high',
      'quality_degraded', 'quality_recovered',
      'value_changed'
  )
ORDER BY tenant_id, tag_path
"""

_BASELINE_CHECK_SQL = """
SELECT MIN(event_timestamp) FROM tag_event_diffs
WHERE tenant_id = %(tenant_id)s::uuid AND tag_path = %(tag_path)s
"""

_WINDOW_DIFFS_SQL = """
SELECT diff_id::text, diff_type, prev_value, new_value, value_type,
       tag_path, uns_path::text AS uns_path, event_timestamp
FROM tag_event_diffs
WHERE tenant_id = %(tenant_id)s::uuid
  AND tag_path = %(tag_path)s
  AND event_timestamp >= NOW() - INTERVAL '1 hour'
ORDER BY event_timestamp ASC
"""

_STABLE_PEERS_SQL = """
SELECT DISTINCT tag_path FROM tag_event_diffs
WHERE tenant_id = %(tenant_id)s::uuid
  AND uns_path::text = %(uns_path)s
  AND tag_path != %(tag_path)s
  AND event_timestamp >= NOW() - INTERVAL '1 hour'
HAVING COUNT(*) <= 2
"""

_DEDUP_CHECK_SQL = """
SELECT COUNT(*) FROM flaky_input_signals
WHERE tenant_id = %(tenant_id)s::uuid
  AND source_tag_path = %(tag_path)s
  AND status = 'open'
  AND created_at >= NOW() - INTERVAL %(window)s
"""

_INSERT_SUGGESTION_SQL = """
INSERT INTO ai_suggestions (
    id, tenant_id, suggestion_type, source_kind,
    extracted_data, confidence, status, risk_level,
    proposed_by, title, body
) VALUES (
    %(id)s::uuid, %(tenant_id)s::uuid, 'flaky_signal_alert', 'live_event',
    %(extracted_data)s::jsonb, %(confidence_float)s, 'pending', 'low',
    'rule:flaky_input_detector', %(title)s, %(body)s
) RETURNING id
"""

_INSERT_SIGNAL_SQL = """
INSERT INTO flaky_input_signals (
    alert_id, tenant_id, uns_path, source_tag_path,
    detection_window, transition_count, stable_peer_tags,
    confidence, evidence_event_ids, ai_suggestion_id,
    status, metadata
) VALUES (
    %(alert_id)s::uuid, %(tenant_id)s::uuid, %(uns_path)s::ltree, %(tag_path)s,
    %(detection_window)s, %(transition_count)s, %(stable_peers)s::jsonb,
    %(confidence)s, %(evidence_ids)s::jsonb, %(ai_suggestion_id)s::uuid,
    'open', %(metadata)s::jsonb
)
"""


# ── DB helpers ────────────────────────────────────────────────────────────────

def _connect():
    import psycopg2
    return psycopg2.connect(NEON_URL)


def _has_baseline(cur, tenant_id: str, tag_path: str) -> bool:
    """Return True if the tag has at least BASELINE_DAYS of history."""
    cur.execute(_BASELINE_CHECK_SQL, {"tenant_id": tenant_id, "tag_path": tag_path})
    row = cur.fetchone()
    if not row or row[0] is None:
        return False
    from datetime import datetime, timedelta, timezone
    earliest = row[0]
    if earliest.tzinfo is None:
        earliest = earliest.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - earliest >= timedelta(days=BASELINE_DAYS)


def _already_alerted(cur, tenant_id: str, tag_path: str) -> bool:
    """Return True if an open alert for this tag was raised in the last DEDUP_WINDOW_MIN."""
    cur.execute(_DEDUP_CHECK_SQL, {
        "tenant_id": tenant_id,
        "tag_path": tag_path,
        "window": f"{DEDUP_WINDOW_MIN} minutes",
    })
    return (cur.fetchone() or [0])[0] > 0


def _stable_peers(cur, tenant_id: str, uns_path: str | None, tag_path: str) -> list[str]:
    if not uns_path:
        return []
    try:
        cur.execute(_STABLE_PEERS_SQL, {
            "tenant_id": tenant_id, "uns_path": uns_path, "tag_path": tag_path,
        })
        return [r[0] for r in cur.fetchall()]
    except Exception:
        return []


def _confidence_float(confidence: str) -> float:
    return {"low": 0.33, "medium": 0.66, "high": 0.90}.get(confidence, 0.5)


def _write_alert(conn, tenant_id: str, tag_path: str, uns_path: str | None, signal) -> str:
    """Write ai_suggestions + flaky_input_signals. Returns the new alert_id."""
    from shared.detection.flaky_input import FlakySignal

    cur = conn.cursor()
    peers = _stable_peers(cur, tenant_id, uns_path, tag_path)

    title = f"Flaky input: {signal.rule.replace('_', ' ')} on {tag_path.split('.')[-1]}"
    body = (
        f"{signal.transition_count} events in {signal.detection_window} window "
        f"({signal.rule}) — {signal.confidence} confidence. "
        "Alert in review queue; not yet pushed to technicians."
    )
    extracted = {
        "rule": signal.rule,
        "tag_path": tag_path,
        "transition_count": signal.transition_count,
        "detection_window": signal.detection_window,
        "confidence": signal.confidence,
        **signal.metadata,
    }

    suggestion_id = str(uuid.uuid4())
    cur.execute(_INSERT_SUGGESTION_SQL, {
        "id": suggestion_id,
        "tenant_id": tenant_id,
        "extracted_data": json.dumps(extracted),
        "confidence_float": _confidence_float(signal.confidence),
        "title": title,
        "body": body,
    })

    alert_id = str(uuid.uuid4())
    cur.execute(_INSERT_SIGNAL_SQL, {
        "alert_id": alert_id,
        "tenant_id": tenant_id,
        "uns_path": uns_path,
        "tag_path": tag_path,
        "detection_window": signal.detection_window,
        "transition_count": signal.transition_count,
        "stable_peers": json.dumps(peers),
        "confidence": signal.confidence,
        "evidence_ids": json.dumps(signal.evidence_diff_ids),
        "ai_suggestion_id": suggestion_id,
        "metadata": json.dumps(signal.metadata),
    })
    conn.commit()
    cur.close()
    return alert_id


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if not NEON_URL:
        logger.warning("NEON_DATABASE_URL not set — skipping")
        return

    try:
        from shared.detection.flaky_input import run_all_rules
    except Exception as exc:
        logger.error("import failed: %s", exc)
        sys.exit(1)

    try:
        conn = _connect()
    except Exception as exc:
        logger.error("NeonDB connect failed: %s", exc)
        sys.exit(1)

    try:
        cur = conn.cursor()
        cur.execute(_ACTIVE_TAGS_SQL)
        active_tags = cur.fetchall()
        cur.close()
    except Exception as exc:
        logger.error("active-tag scan failed: %s", exc)
        conn.close()
        sys.exit(1)

    logger.info("active (tenant, tag) pairs in last 1h: %d", len(active_tags))
    alerts_written = 0

    for tenant_id, tag_path in active_tags:
        try:
            cur = conn.cursor()

            if not _has_baseline(cur, tenant_id, tag_path):
                cur.close()
                continue

            if _already_alerted(cur, tenant_id, tag_path):
                cur.close()
                continue

            cur.execute(_WINDOW_DIFFS_SQL, {"tenant_id": tenant_id, "tag_path": tag_path})
            cols = [d[0] for d in cur.description]
            diffs = [dict(zip(cols, row)) for row in cur.fetchall()]
            cur.close()

            if not diffs:
                continue

            uns_path = diffs[0].get("uns_path")
            signals = run_all_rules(diffs, DETECTION_WINDOW)

            for sig in signals:
                try:
                    alert_id = _write_alert(conn, tenant_id, tag_path, uns_path, sig)
                    logger.info(
                        "ALERT rule=%s tenant=%s tag=%s confidence=%s alert_id=%s",
                        sig.rule, tenant_id, tag_path, sig.confidence, alert_id,
                    )
                    alerts_written += 1
                except Exception as exc:
                    logger.error(
                        "write_alert failed rule=%s tenant=%s tag=%s: %s",
                        sig.rule, tenant_id, tag_path, exc,
                    )
                    conn.rollback()

        except Exception as exc:
            logger.error("scan failed tenant=%s tag=%s: %s", tenant_id, tag_path, exc)

    logger.info("flaky detector done — alerts written: %d", alerts_written)
    conn.close()


if __name__ == "__main__":
    main()
