"""FlakyInputDetector — Phase 9 rolling-window unstable-input worker.

Reads the `tag_events` stream, applies flaky detection rules, and writes:
  • A row in `flaky_input_signals` per detected episode.
  • A bridged row in `ai_suggestions(suggestion_type='flaky_signal_alert', status='pending')`
    for the Hub /proposals reviewer queue.

Suppresses alerts until per-tag 7-day baseline is established.
Does NOT push to Slack — alarm-fatigue guard (Phase 9 risk note).

Run schedule:
  docker exec mira-bot-telegram python3 /app/agents/flaky_input_detector.py
  Or:  cd mira-bots && python3 -m agents.flaky_input_detector

Spec: docs/plans/2026-06-01-mira-master-architecture-plan.md Phase 9 / §D6
"""

from __future__ import annotations

import logging
import os
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("mira-flaky-detector")

# ── Configuration ─────────────────────────────────────────────────────────────

# Rolling window for event queries
WINDOW_HOURS: int = int(os.getenv("FLAKY_WINDOW_HOURS", "1"))

# Calibration period before alerts fire (matches approved_tags.baseline_period_days default)
BASELINE_PERIOD_DAYS: int = 7

# Dedup window — skip insert if an open alert already exists for this
# (tenant_id, tag_id, rule_id) in the last DEDUP_HOURS hours.
DEDUP_HOURS: int = int(os.getenv("FLAKY_DEDUP_HOURS", "6"))

# Proposed-by tag written to ai_suggestions (matches the 027 vocabulary)
PROPOSED_BY = "rule:flaky_input_detector"

# source_kind written to ai_suggestions ('live_event' matches 027 CHECK)
SOURCE_KIND = "live_event"


# ── UUIDv7 helper ─────────────────────────────────────────────────────────────
# Python 3.12 stdlib has no uuid.uuid7(); stdlib uuid4 is fine for uniqueness
# but UUIDv7 provides time-ordered primary keys for tag_events / flaky_input_signals.
# We mint a minimal v7 per the spec (ms timestamp in top 48 bits, version=7, random tail).

def _uuid7() -> str:
    """Mint a UUIDv7 (time-ordered UUID per RFC 9562 draft)."""
    ts_ms = int(time.time() * 1000)
    rand_a = struct.unpack(">H", os.urandom(2))[0] & 0x0FFF  # 12-bit random_a
    rand_b = struct.unpack(">Q", os.urandom(8))[0] & 0x3FFFFFFFFFFFFFFF  # 62-bit random_b

    # Layout (128 bits):
    # [0:47]  unix_ts_ms
    # [48:51] version = 0b0111 (7)
    # [52:63] random_a (12 bits)
    # [64:65] variant = 0b10
    # [66:127] random_b (62 bits)
    high = (ts_ms << 16) | (0x7 << 12) | rand_a
    low = (0b10 << 62) | rand_b

    # Format as standard UUID string
    b = high.to_bytes(8, "big") + low.to_bytes(8, "big")
    return str(uuid.UUID(bytes=b))


# ── NeonDB engine (lazily initialised) ───────────────────────────────────────

_engine = None


def _get_engine():
    """Return a SQLAlchemy engine with NullPool (NeonDB / pgBouncer).

    Raises RuntimeError if NEON_DATABASE_URL is unset — the caller handles.
    """
    global _engine
    if _engine is not None:
        return _engine

    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set — NeonDB unavailable")

    from sqlalchemy import create_engine  # noqa: PLC0415
    from sqlalchemy.pool import NullPool   # noqa: PLC0415

    _engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _engine


# ── DB queries ────────────────────────────────────────────────────────────────

def _fetch_approved_tags(engine, tenant_id: str) -> list[dict]:
    """Return all approved tags for a tenant."""
    from sqlalchemy import text  # noqa: PLC0415

    sql = text(
        """
        SELECT tag_id, uns_path::text AS uns_path, data_type,
               threshold, baseline_period_days, created_at
          FROM approved_tags
         WHERE tenant_id = :tenant_id
        """
    )
    try:
        with engine.connect() as conn:
            rows = conn.execute(sql, {"tenant_id": tenant_id}).mappings().fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("approved_tags fetch failed tenant=%s: %s", tenant_id, exc)
        return []


def _fetch_tag_events(
    engine,
    tenant_id: str,
    tag_id: str,
    window_start: datetime,
    window_end: datetime,
) -> list[dict]:
    """Return tag_events rows for a specific tag in the window."""
    from sqlalchemy import text  # noqa: PLC0415

    sql = text(
        """
        SELECT event_type, ts, delta, raw_quality, prev_value, new_value
          FROM tag_events
         WHERE tenant_id = :tenant_id
           AND tag_id    = :tag_id
           AND ts >= :window_start
           AND ts <  :window_end
         ORDER BY ts ASC
        """
    )
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                sql,
                {
                    "tenant_id": tenant_id,
                    "tag_id": tag_id,
                    "window_start": window_start,
                    "window_end": window_end,
                },
            ).mappings().fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning(
            "tag_events fetch failed tenant=%s tag=%s: %s", tenant_id, tag_id, exc
        )
        return []


def _compute_baseline(
    engine,
    tenant_id: str,
    tag_id: str,
    tag_created_at: datetime,
    baseline_period_days: int,
    now: datetime,
) -> tuple[bool, Optional[float]]:
    """Return (baseline_established, transitions_per_hour).

    Baseline is established when the tag has existed for >= baseline_period_days.
    transitions_per_hour is computed over the baseline window.
    """
    age_days = (now - tag_created_at).total_seconds() / 86400.0
    if age_days < baseline_period_days:
        return False, None

    # Compute historical rising-edge rate over the baseline window
    from sqlalchemy import text  # noqa: PLC0415

    baseline_start = now - timedelta(days=baseline_period_days)
    sql = text(
        """
        SELECT COUNT(*) AS cnt
          FROM tag_events
         WHERE tenant_id = :tenant_id
           AND tag_id    = :tag_id
           AND event_type = 'rising_edge'
           AND ts >= :baseline_start
           AND ts <  :now
        """
    )
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sql,
                {
                    "tenant_id": tenant_id,
                    "tag_id": tag_id,
                    "baseline_start": baseline_start,
                    "now": now,
                },
            ).mappings().fetchone()
        total = int(row["cnt"]) if row else 0
        hours = baseline_period_days * 24.0
        rate = total / hours if hours > 0 else 0.0
        return True, rate
    except Exception as exc:
        logger.warning(
            "baseline compute failed tenant=%s tag=%s: %s", tenant_id, tag_id, exc
        )
        # Fail-open: treat baseline as established but rate as 0 so floor applies
        return True, 0.0


def _alert_exists(
    engine,
    tenant_id: str,
    tag_id: str,
    rule_id: str,
    since: datetime,
) -> bool:
    """Return True if an open/acknowledged alert already exists for this tag+rule."""
    from sqlalchemy import text  # noqa: PLC0415

    sql = text(
        """
        SELECT 1
          FROM flaky_input_signals
         WHERE tenant_id = :tenant_id
           AND tag_id    = :tag_id
           AND rule_id   = :rule_id
           AND status    IN ('open', 'acknowledged')
           AND detected_at >= :since
         LIMIT 1
        """
    )
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sql,
                {
                    "tenant_id": tenant_id,
                    "tag_id": tag_id,
                    "rule_id": rule_id,
                    "since": since,
                },
            ).fetchone()
        return row is not None
    except Exception as exc:
        logger.warning("dedup check failed: %s", exc)
        return False  # fail-open: allow insert rather than suppress valid alert


def _insert_alert(
    engine,
    tenant_id: str,
    tag_id: str,
    uns_path: str,
    rule_id: str,
    window_start: datetime,
    window_end: datetime,
    transitions_count: int,
    expected_max: int,
    severity: str,
    extra: dict,
) -> Optional[str]:
    """Insert ai_suggestions + flaky_input_signals in one transaction.

    Returns the flaky_input_signals alert_id UUID string, or None on failure.
    """
    from sqlalchemy import text  # noqa: PLC0415

    alert_id = _uuid7()
    suggestion_id = str(uuid.uuid4())
    detected_at = datetime.now(timezone.utc)

    title = f"Flaky input detected: {tag_id} ({rule_id})"
    body = (
        f"Tag {tag_id} triggered rule '{rule_id}' "
        f"with {transitions_count} transitions "
        f"(threshold: {expected_max}) "
        f"over window {window_start.isoformat()} – {window_end.isoformat()}. "
        f"UNS path: {uns_path}."
    )

    # Map severity to risk_level and confidence
    risk_map = {"alert": "high", "warning": "medium"}
    conf_map = {"alert": 0.75, "warning": 0.55}
    risk_level = risk_map.get(severity, "medium")
    confidence = conf_map.get(severity, 0.55)

    # metadata JSONB: everything extra including severity
    import json  # noqa: PLC0415
    metadata = json.dumps({"severity": severity, **extra})

    sql_suggestion = text(
        """
        INSERT INTO ai_suggestions
          (id, tenant_id, suggestion_type, source_kind,
           extracted_data, confidence, status, risk_level,
           proposed_by, title, body, created_at, updated_at)
        VALUES
          (:id, :tenant_id, 'flaky_signal_alert', :source_kind,
           :extracted_data::jsonb, :confidence, 'pending', :risk_level,
           :proposed_by, :title, :body, :created_at, :created_at)
        """
    )

    sql_signal = text(
        """
        INSERT INTO flaky_input_signals
          (alert_id, tenant_id, detected_at,
           uns_path, tag_id,
           rule_id,
           window_start, window_end,
           transitions_count, expected_max,
           ai_suggestion_id, status, metadata)
        VALUES
          (:alert_id, :tenant_id, :detected_at,
           :uns_path::ltree, :tag_id,
           :rule_id,
           :window_start, :window_end,
           :transitions_count, :expected_max,
           :ai_suggestion_id, 'open', :metadata::jsonb)
        """
    )

    try:
        with engine.begin() as conn:
            conn.execute(
                sql_suggestion,
                {
                    "id": suggestion_id,
                    "tenant_id": tenant_id,
                    "source_kind": SOURCE_KIND,
                    "extracted_data": json.dumps(
                        {
                            "tag_id": tag_id,
                            "uns_path": uns_path,
                            "rule_id": rule_id,
                            "transitions_count": transitions_count,
                            "expected_max": expected_max,
                            "severity": severity,
                            "window_start": window_start.isoformat(),
                            "window_end": window_end.isoformat(),
                        }
                    ),
                    "confidence": confidence,
                    "risk_level": risk_level,
                    "proposed_by": PROPOSED_BY,
                    "title": title,
                    "body": body,
                    "created_at": detected_at,
                },
            )
            conn.execute(
                sql_signal,
                {
                    "alert_id": alert_id,
                    "tenant_id": tenant_id,
                    "detected_at": detected_at,
                    "uns_path": uns_path,
                    "tag_id": tag_id,
                    "rule_id": rule_id,
                    "window_start": window_start,
                    "window_end": window_end,
                    "transitions_count": transitions_count,
                    "expected_max": expected_max,
                    "ai_suggestion_id": suggestion_id,
                    "metadata": metadata,
                },
            )
        logger.info(
            "ALERT_INSERTED alert_id=%s tag=%s rule=%s transitions=%d expected_max=%d",
            alert_id, tag_id, rule_id, transitions_count, expected_max,
        )
        return alert_id
    except Exception as exc:
        logger.error(
            "ALERT_INSERT_FAILED tag=%s rule=%s: %s", tag_id, rule_id, exc
        )
        return None


# ── Core detection loop ───────────────────────────────────────────────────────

def _run_detection(tenant_id: str, window_hours: int = WINDOW_HOURS) -> dict:
    """Run the full detection pass for one tenant.

    Returns a summary dict: {"tags_scanned", "hits", "inserts", "skipped"}.
    """
    from shared.flaky_rules import TagConfig, TagEvent, check_flaky  # noqa: PLC0415

    try:
        engine = _get_engine()
    except RuntimeError as exc:
        logger.error("DB unavailable: %s", exc)
        return {"tags_scanned": 0, "hits": 0, "inserts": 0, "skipped": 0}

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=window_hours)
    dedup_since = now - timedelta(hours=DEDUP_HOURS)

    approved = _fetch_approved_tags(engine, tenant_id)
    if not approved:
        logger.info("No approved tags for tenant=%s — skipping", tenant_id)
        return {"tags_scanned": 0, "hits": 0, "inserts": 0, "skipped": 0}

    summary = {"tags_scanned": 0, "hits": 0, "inserts": 0, "skipped": 0}

    for row in approved:
        tag_id: str = row["tag_id"]
        data_type: str = row["data_type"]
        uns_path: str = row["uns_path"]

        # Parse created_at — may come back as datetime or ISO string
        tag_created_raw = row.get("created_at")
        if isinstance(tag_created_raw, datetime):
            tag_created_at = tag_created_raw.replace(tzinfo=timezone.utc) \
                if tag_created_raw.tzinfo is None else tag_created_raw
        else:
            try:
                tag_created_at = datetime.fromisoformat(str(tag_created_raw))
                if tag_created_at.tzinfo is None:
                    tag_created_at = tag_created_at.replace(tzinfo=timezone.utc)
            except Exception:
                tag_created_at = now  # conservative: treat as brand-new

        baseline_period = int(row.get("baseline_period_days") or BASELINE_PERIOD_DAYS)
        threshold = float(row.get("threshold") or 0.0)

        # Compute baseline — may be a DB query (cached within this loop pass)
        baseline_established, baseline_rate = _compute_baseline(
            engine, tenant_id, tag_id, tag_created_at, baseline_period, now
        )

        cfg = TagConfig(
            tag_id=tag_id,
            tenant_id=tenant_id,
            data_type=data_type,
            baseline_established=baseline_established,
            baseline_transitions_per_hour=baseline_rate,
            threshold=threshold,
            # brown_out_low: approved_tags has no column for this yet;
            # default 0.0 means the brown_out rule is off unless a future
            # approved_tags column or env var provides a value.
            brown_out_low=float(os.getenv(f"BROWN_OUT_LOW_{tag_id.upper()}", "0.0")),
        )

        # Fetch events for window
        event_rows = _fetch_tag_events(
            engine, tenant_id, tag_id, window_start, now
        )
        events = [
            TagEvent(
                event_type=r["event_type"],
                ts=r["ts"],
                delta=r.get("delta"),
                raw_quality=r.get("raw_quality"),
                prev_value=r.get("prev_value"),
                new_value=r.get("new_value"),
            )
            for r in event_rows
        ]

        summary["tags_scanned"] += 1

        hits = check_flaky(events, cfg)
        if not hits:
            continue

        summary["hits"] += len(hits)

        for hit in hits:
            # Dedup — skip if an open alert already exists in the dedup window
            if _alert_exists(engine, tenant_id, tag_id, hit.rule_id, dedup_since):
                logger.debug(
                    "DEDUP_SKIP tag=%s rule=%s — open alert exists",
                    tag_id, hit.rule_id,
                )
                summary["skipped"] += 1
                continue

            inserted = _insert_alert(
                engine=engine,
                tenant_id=tenant_id,
                tag_id=tag_id,
                uns_path=uns_path,
                rule_id=hit.rule_id,
                window_start=window_start,
                window_end=now,
                transitions_count=hit.transitions,
                expected_max=hit.expected_max,
                severity=hit.severity,
                extra=hit.extra,
            )
            if inserted:
                summary["inserts"] += 1

    logger.info(
        "DETECTION_PASS tenant=%s scanned=%d hits=%d inserts=%d skipped=%d",
        tenant_id,
        summary["tags_scanned"],
        summary["hits"],
        summary["inserts"],
        summary["skipped"],
    )
    return summary


def _fetch_tenant_ids(engine) -> list[str]:
    """Return all distinct tenant_ids from approved_tags."""
    from sqlalchemy import text  # noqa: PLC0415

    sql = text("SELECT DISTINCT tenant_id FROM approved_tags")
    try:
        with engine.connect() as conn:
            rows = conn.execute(sql).fetchall()
        return [str(r[0]) for r in rows]
    except Exception as exc:
        logger.error("tenant_ids fetch failed: %s", exc)
        return []


def run_all_tenants(window_hours: int = WINDOW_HOURS) -> list[dict]:
    """Run detection for every tenant that has approved tags.

    Returns list of per-tenant summary dicts.
    """
    try:
        engine = _get_engine()
    except RuntimeError as exc:
        logger.error("DB unavailable — skipping all tenants: %s", exc)
        return []

    tenant_ids = _fetch_tenant_ids(engine)
    if not tenant_ids:
        logger.info("No tenants with approved tags — nothing to do")
        return []

    results = []
    for tenant_id in tenant_ids:
        summary = _run_detection(tenant_id, window_hours=window_hours)
        summary["tenant_id"] = tenant_id
        results.append(summary)

    return results


# ── Entry point ───────────────────────────────────────────────────────────────
# Invocation:
#   cd mira-bots && python3 -m agents.flaky_input_detector
# Or from container:
#   docker exec <container> python3 /app/agents/flaky_input_detector.py
# Note: 'python -m mira-bots.agents.flaky_input_detector' is NOT valid
# (hyphen in package name); use the cd form above.

def main() -> None:
    logger.info(
        "FlakyInputDetector starting window=%dh dedup=%dh baseline=%dd",
        WINDOW_HOURS, DEDUP_HOURS, BASELINE_PERIOD_DAYS,
    )
    results = run_all_tenants()
    total_inserts = sum(r.get("inserts", 0) for r in results)
    logger.info(
        "FlakyInputDetector done tenants=%d total_inserts=%d",
        len(results), total_inserts,
    )


if __name__ == "__main__":
    main()
