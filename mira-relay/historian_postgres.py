"""PostgresHistorianAdapter — prod Historian read path over the EXISTING Hub
tables (issue #2339). No new tables, no migrations.

SQLAlchemy NullPool + RLS tenant binding, the SAME pattern as
tag_ingest.NeonTagStore / tag_diff_logger.NeonDiffStore: every read opens a
connection, issues `SET LOCAL app.current_tenant_id = :tid` and the SELECT in the
SAME transaction (commit-as-you-go `engine.connect()`), so the RLS policy on
each table scopes the rows to the caller's tenant.

This adapter is deliberately THIN — parse-free SQL that mirrors
InMemoryHistorianAdapter's aggregation logic. It is NOT unit-tested without a
live NeonDB (see issue notes); the in-memory adapter is the behavioural spec.

Confirmed columns (read against the migration SQL):
  live_signal_cache (020 + 036): tenant_id, plc_tag, last_value_text,
    last_value_numeric, last_value_bool, last_seen_at, last_changed_at,
    uns_path, source_system, latest_quality, freshness_status, simulated
  tag_events (033): tenant_id, tag_path, value, value_type, quality,
    source_system, simulated, event_timestamp
  tag_event_diffs (037): tenant_id, fault_window_id, tag_path, diff_type,
    prev_value, new_value, value_type, threshold, source_system, simulated,
    event_timestamp
  decision_traces (032): tenant_id, trace_id, session_id, platform, uns_path,
    user_question, recommendation, outcome, citations_present, ts
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from historian import (
    EvidenceWindow,
    HistorianAdapter,
    HistoryPoint,
    Sample,
    TimeAggregation,
    TrendBucket,
)

# The numeric guard used in every aggregate cast. Matches historian._NUMERIC_RE.
_NUMERIC_REGEX = r"^-?[0-9]+(\.[0-9]+)?$"


def _display_value(text: Optional[str], numeric: Optional[float], boolean: Optional[bool]) -> Optional[str]:
    if text is not None:
        return text
    if numeric is not None:
        return str(numeric)
    if boolean is not None:
        return "true" if boolean else "false"
    return None


class PostgresHistorianAdapter(HistorianAdapter):
    def __init__(self, neon_url: str) -> None:
        self.neon_url = neon_url

    def _engine(self):
        from sqlalchemy import NullPool, create_engine

        return create_engine(
            self.neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    @staticmethod
    def _bind_tenant(conn, tenant_id: str) -> None:
        from sqlalchemy import text

        conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})

    # ── live ──────────────────────────────────────────────────────────────

    def list_tags(self, tenant_id: str) -> list[Sample]:
        from sqlalchemy import text

        engine = self._engine()
        with engine.connect() as conn:
            self._bind_tenant(conn, tenant_id)
            rows = conn.execute(
                text(
                    """
                    SELECT plc_tag,
                           last_value_text,
                           last_value_numeric,
                           last_value_bool,
                           last_seen_at,
                           last_changed_at,
                           uns_path::text   AS uns_path,
                           source_system,
                           latest_quality,
                           freshness_status,
                           simulated
                      FROM live_signal_cache
                     WHERE tenant_id = :tid
                     ORDER BY plc_tag
                    """
                ),
                {"tid": tenant_id},
            ).mappings().all()

        return [
            Sample(
                tag_path=r["plc_tag"],
                value=_display_value(
                    r["last_value_text"], r["last_value_numeric"], r["last_value_bool"]
                ),
                value_type=None,
                quality=r["latest_quality"],
                uns_path=r["uns_path"],
                source_system=r["source_system"],
                simulated=bool(r["simulated"]),
                freshness_status=r["freshness_status"],
                numeric=r["last_value_numeric"],
                bool_value=r["last_value_bool"],
                last_seen_at=r["last_seen_at"],
                last_changed_at=r["last_changed_at"],
            )
            for r in rows
        ]

    # ── history ───────────────────────────────────────────────────────────

    def get_history(
        self,
        tenant_id: str,
        tag_path: str,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[HistoryPoint]:
        from sqlalchemy import text

        agg = TimeAggregation.parse(interval)
        engine = self._engine()

        if agg is None:
            sql = text(
                """
                SELECT tag_path, value, quality, event_timestamp
                  FROM tag_events
                 WHERE tenant_id = :tid
                   AND tag_path = :tag
                   AND (:start IS NULL OR event_timestamp >= :start)
                   AND (:end   IS NULL OR event_timestamp <= :end)
                 ORDER BY event_timestamp
                """
            )
            with engine.connect() as conn:
                self._bind_tenant(conn, tenant_id)
                rows = conn.execute(
                    sql, {"tid": tenant_id, "tag": tag_path, "start": start, "end": end}
                ).mappings().all()
            return [
                HistoryPoint(
                    tag_path=r["tag_path"],
                    timestamp=r["event_timestamp"],
                    value=r["value"],
                    quality=r["quality"],
                    numeric=_safe_float(r["value"]),
                )
                for r in rows
            ]

        # Bucketed: latest value per bucket + avg of the numeric subset.
        sql = text(
            f"""
            SELECT date_trunc(:unit, event_timestamp) AS bucket,
                   (array_agg(value   ORDER BY event_timestamp DESC))[1] AS latest_value,
                   (array_agg(quality ORDER BY event_timestamp DESC))[1] AS latest_quality,
                   avg(CASE WHEN value ~ '{_NUMERIC_REGEX}'
                            THEN value::double precision END) AS avg_numeric
              FROM tag_events
             WHERE tenant_id = :tid
               AND tag_path = :tag
               AND (:start IS NULL OR event_timestamp >= :start)
               AND (:end   IS NULL OR event_timestamp <= :end)
             GROUP BY bucket
             ORDER BY bucket
            """
        )
        with engine.connect() as conn:
            self._bind_tenant(conn, tenant_id)
            rows = conn.execute(
                sql,
                {"tid": tenant_id, "tag": tag_path, "unit": agg.value, "start": start, "end": end},
            ).mappings().all()
        return [
            HistoryPoint(
                tag_path=tag_path,
                timestamp=r["bucket"],
                value=r["latest_value"],
                quality=r["latest_quality"],
                numeric=r["avg_numeric"],
                bucketed=True,
            )
            for r in rows
        ]

    # ── trends ────────────────────────────────────────────────────────────

    def get_trends(
        self,
        tenant_id: str,
        tag_paths: list[str],
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: Optional[str] = None,
    ) -> list[TrendBucket]:
        from sqlalchemy import text

        if not tag_paths:
            return []
        agg = TimeAggregation.parse(interval) or TimeAggregation.MINUTE

        # Numeric aggregates filter to the numeric subset (guarded cast); count
        # and latest cover ALL rows so non-numeric tags still report.
        sql = text(
            f"""
            SELECT tag_path,
                   date_trunc(:unit, event_timestamp) AS bucket,
                   count(*) AS n,
                   min(CASE WHEN value ~ '{_NUMERIC_REGEX}'
                            THEN value::double precision END) AS min_v,
                   max(CASE WHEN value ~ '{_NUMERIC_REGEX}'
                            THEN value::double precision END) AS max_v,
                   avg(CASE WHEN value ~ '{_NUMERIC_REGEX}'
                            THEN value::double precision END) AS avg_v,
                   (array_agg(value ORDER BY event_timestamp DESC))[1] AS latest_value
              FROM tag_events
             WHERE tenant_id = :tid
               AND tag_path = ANY(:tags)
               AND (:start IS NULL OR event_timestamp >= :start)
               AND (:end   IS NULL OR event_timestamp <= :end)
             GROUP BY tag_path, bucket
             ORDER BY tag_path, bucket
            """
        )
        with self._engine().connect() as conn:
            self._bind_tenant(conn, tenant_id)
            rows = conn.execute(
                sql,
                {"tid": tenant_id, "tags": list(tag_paths), "unit": agg.value,
                 "start": start, "end": end},
            ).mappings().all()
        return [
            TrendBucket(
                tag_path=r["tag_path"],
                bucket_start=r["bucket"],
                count=r["n"],
                min=r["min_v"],
                max=r["max_v"],
                avg=r["avg_v"],
                latest=r["latest_value"],
            )
            for r in rows
        ]

    # ── evidence ──────────────────────────────────────────────────────────

    def get_evidence(self, tenant_id: str, fault_window_id: str) -> EvidenceWindow:
        from sqlalchemy import text

        engine = self._engine()
        with engine.connect() as conn:
            self._bind_tenant(conn, tenant_id)
            diffs = conn.execute(
                text(
                    """
                    SELECT diff_id::text       AS diff_id,
                           tag_path,
                           diff_type,
                           prev_value,
                           new_value,
                           value_type,
                           threshold,
                           uns_path::text      AS uns_path,
                           source_system,
                           simulated,
                           event_timestamp
                      FROM tag_event_diffs
                     WHERE tenant_id = :tid
                       AND fault_window_id = CAST(:fw AS UUID)
                     ORDER BY event_timestamp
                    """
                ),
                {"tid": tenant_id, "fw": fault_window_id},
            ).mappings().all()

            # Related traces: decision_traces whose ts falls inside the window's
            # [min, max] diff time span. decision_traces has no fault_window_id,
            # so time overlap is the join.
            traces = conn.execute(
                text(
                    """
                    WITH win AS (
                        SELECT min(event_timestamp) AS lo, max(event_timestamp) AS hi
                          FROM tag_event_diffs
                         WHERE tenant_id = :tid
                           AND fault_window_id = CAST(:fw AS UUID)
                    )
                    SELECT dt.trace_id::text   AS trace_id,
                           dt.session_id::text AS session_id,
                           dt.platform,
                           dt.uns_path::text   AS uns_path,
                           dt.user_question,
                           dt.recommendation,
                           dt.outcome,
                           dt.citations_present,
                           dt.ts
                      FROM decision_traces dt, win
                     WHERE dt.tenant_id = :tid
                       AND win.lo IS NOT NULL
                       AND dt.ts BETWEEN win.lo AND win.hi
                     ORDER BY dt.ts
                    """
                ),
                {"tid": tenant_id, "fw": fault_window_id},
            ).mappings().all()

        return EvidenceWindow(
            fault_window_id=fault_window_id,
            diffs=[_isoize(dict(r)) for r in diffs],
            traces=[_isoize(dict(r)) for r in traces],
        )


def _safe_float(value: Optional[str]) -> Optional[float]:
    import re

    if value is None or not re.match(_NUMERIC_REGEX, value.strip()):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _isoize(row: dict[str, Any]) -> dict[str, Any]:
    """Render datetimes as ISO8601 so the dict is JSON-serializable."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        out[k] = v.isoformat() if isinstance(v, datetime) else v
    return out
