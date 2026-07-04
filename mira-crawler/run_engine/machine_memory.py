"""historize_machine_memory — tag_events -> persisted machine memory (mig 038+040).

Orchestrates, per (tenant, uns_path), over any RunStore:

  1. RUN layer (038, existing engine): reuse ``pipeline.run_historization`` for
     trigger-driven runs/steps/baselines/statistical diffs — skipped when the
     batch's detected run starts are already persisted (re-run idempotency) or
     when no triggers are configured.
  2. STATE WINDOWS (040): ``derive_state_windows`` over the approved-tag
     snapshot mapping; upserted on the (tenant, uns, state, started_at) key.
  3. TYPED ANOMALIES (040): the vendored A0-A12 brain evaluated on each
     window's snapshot; persisted as run_diff rows with
     ``diff_type='anomaly_<RULE_ID>'``, window_id parent, severity mapped
     CRITICAL->'critical' HIGH->'warning' MEDIUM->'info' (raw severity kept in
     metadata.severity_raw), NEXT_CHECK guidance in metadata.next_check, and
     evidence pointers from_event_id/to_event_id.

Pure w.r.t. I/O: talks only to the RunStore Protocol; unit-testable with
``InMemoryRunStore``. Unapproved/unmapped tag paths never enter a snapshot;
they are counted in the summary's ``unmapped_tags``.

CLI (deterministic demo/verify path, no DB, no hardware)::

    python -m run_engine.machine_memory --fixture tests/fixtures/machine_memory/cv101_comm_stale.json
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from .anomaly_rules import evaluate
from .models import MachineAnomaly, Reading, RunTrigger, StateWindow
from .next_check import NEXT_CHECK
from .pipeline import run_historization
from .segmentation import segment_runs
from .snapshot import (
    CV101_TAG_TOPIC_MAP,
    MappedEvent,
    build_snapshot,
    derived_facts,
    map_events,
    parse_event_timestamp,
)
from .state_windows import derive_state_windows, window_events
from .store import RunStore

logger = logging.getLogger("mira-crawler.run_engine.machine_memory")

# run_diff.severity CHECK is (info|warning|critical); the rules emit
# CRITICAL/HIGH/MEDIUM(/LOW/INFO). Raw severity is preserved in metadata.
SEVERITY_MAP = {
    "CRITICAL": "critical",
    "HIGH": "warning",
    "MEDIUM": "info",
    "LOW": "info",
    "INFO": "info",
}


def reading_from_row(row: dict) -> Reading:
    """A tag_events-shaped dict row -> the engine's Reading."""
    raw = row.get("value")
    try:
        numeric: Optional[float] = float(raw) if raw is not None else None
    except (TypeError, ValueError):
        numeric = None
    return Reading(
        tag_path=row.get("tag_path", ""),
        value=numeric,
        event_timestamp=parse_event_timestamp(row.get("event_timestamp", 0.0)),
        uns_path=row.get("uns_path"),
        value_type=row.get("value_type", "string"),
        quality=row.get("quality", "good"),
        event_id=row.get("event_id"),
        raw_value=str(raw) if raw is not None else None,
    )


def _snapshot_through(
    events: list[MappedEvent], to_event_id: Optional[str]
) -> tuple[dict, list[MappedEvent]]:
    """Cumulative snapshot (and event prefix) up to and incl. ``to_event_id``.

    Cumulative from stream start (not window start) because a snapshot is the
    machine's LAST-KNOWN state — a wiring fault set before the window opened
    is still true inside it.
    """
    if to_event_id is None:
        return build_snapshot(events), list(events)
    upto: list[MappedEvent] = []
    for e in events:
        upto.append(e)
        if e.event_id == to_event_id:
            break
    return build_snapshot(upto), upto


def _anomaly_evidence(
    win_events: list[MappedEvent], evidence_topics: list[str], window: StateWindow
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """First/last window event backing the anomaly's evidence topics.

    Falls back to the window's own anchors when the evidence topics carry no
    event in the window (e.g. A0's pseudo-topic ``_stale_s``).
    """
    hits = [e for e in win_events if e.topic in evidence_topics]
    if hits:
        return hits[0].event_id, hits[-1].event_id, hits[0].event_timestamp
    return window.from_event_id, window.to_event_id, window.started_at


def historize_machine_memory(
    store: RunStore,
    tenant_id: str,
    uns_path: str,
    rows: list[dict],
    *,
    now: Optional[float] = None,
    mapping: Optional[dict[str, str]] = None,
    triggers: Optional[dict[str, RunTrigger]] = None,
    cfg: Optional[dict] = None,
    k_sigma: float = 3.0,
    normal_run_count: int = 5,
    min_baseline_runs: int = 2,
    pre_seconds: float = 300.0,
    post_seconds: float = 300.0,
) -> dict:
    """Process one batch of tag_events rows into persisted machine memory.

    ``rows`` are tag_events-shaped dicts (event_id, tenant_id, uns_path,
    tag_path, value, value_type, quality, event_timestamp). Rows for other
    tenants or other uns_paths are ignored (tenant isolation at the seam).
    Idempotent: re-running over the same rows produces zero new rows.
    """
    mapping = mapping if mapping is not None else CV101_TAG_TOPIC_MAP

    scoped = [
        r
        for r in rows
        if r.get("tenant_id") == tenant_id and r.get("uns_path") == uns_path
    ]

    # ── 1. RUN layer (038, existing engine) ────────────────────────────────
    latest_run: Optional[dict] = None
    run_summary: dict = {}
    if triggers:
        readings = [reading_from_row(r) for r in scoped]
        closed, open_runs = segment_runs(readings, triggers, tenant_id=tenant_id)
        detected_starts = {r.started_at for r in closed} | {
            r.started_at for r in open_runs.values()
        }
        existing_starts = store.existing_run_starts(
            tenant_id=tenant_id, uns_path=uns_path
        )
        if detected_starts - existing_starts:
            run_summary = run_historization(
                readings,
                store,
                triggers,
                tenant_id=tenant_id,
                k_sigma=k_sigma,
                normal_run_count=normal_run_count,
                min_baseline_runs=min_baseline_runs,
                pre_seconds=pre_seconds,
                post_seconds=post_seconds,
            )
        all_runs = sorted(
            closed + list(open_runs.values()), key=lambda r: r.started_at
        )
        if all_runs:
            last = all_runs[-1]
            latest_run = {
                "run_id": last.run_id,
                "status": last.status,
                "started_at": last.started_at,
                "stopped_at": last.stopped_at,
            }

    # ── 2. STATE WINDOWS (040) ─────────────────────────────────────────────
    mapped, unmapped = map_events(scoped, mapping)
    windows = derive_state_windows(
        mapped, tenant_id=tenant_id, uns_path=uns_path, cfg=cfg
    )

    # Cross-batch continuity: a continuous state (long idle, persistent
    # comm_down) can outlive the sliding MIRA_RUN_LOOKBACK_SECONDS window. The
    # next batch's first same-state window would otherwise re-derive with a
    # LATER started_at -> a NEW machine_state_window row every batch. If the
    # most-recent stored window is the SAME state as this batch's first window
    # and is contiguous with it (still open, or ended at/after the batch's
    # coverage start), EXTEND it in place: reuse its window_id + started_at +
    # original evidence anchor so the (tenant, uns, state, started_at) upsert
    # key hits the existing row instead of minting a new one.
    reused_ids: set[str] = set()
    if windows:
        first = windows[0]
        latest = store.latest_state_window(tenant_id=tenant_id, uns_path=uns_path)
        if (
            latest is not None
            and latest.window_id is not None
            and latest.state == first.state
            and (latest.ended_at is None or latest.ended_at >= first.started_at)
        ):
            first.window_id = latest.window_id
            first.started_at = latest.started_at
            first.from_event_id = latest.from_event_id
            first.metadata.setdefault("continued", True)
            reused_ids.add(latest.window_id)

    for w in windows:
        store.upsert_state_window(w)

    # ── 3. TYPED ANOMALIES (040) ───────────────────────────────────────────
    window_ids = [w.window_id for w in windows if w.window_id]
    existing_keys = store.existing_anomaly_keys(
        tenant_id=tenant_id, window_ids=window_ids
    )
    # For a REUSED (continued) window, a persistent condition re-detects every
    # batch with a LATER evidence timestamp — dedup on (window_id, diff_type,
    # tag_path) alone (drop event_timestamp) so the same continuing anomaly does
    # not accrete a new run_diff row each lookback. New windows keep the full
    # (window_id, diff_type, tag_path, event_timestamp) key (existing behavior).
    existing_triples = {(wid, dt, tp) for (wid, dt, tp, _ts) in existing_keys}
    anomalies: list[MachineAnomaly] = []
    for w in windows:
        snap, upto = _snapshot_through(mapped, w.to_event_id)
        # The FINAL (batch_end) window's staleness runs against real `now` so
        # max_stale_s grows when the stream stops and A0_OFFLINE (>=30 s) can
        # fire. Closed transition windows keep their own ended_at — their
        # staleness is historical fact, not current condition.
        is_final = w is windows[-1]
        derived_now = now if (is_final and now is not None) else w.ended_at
        derived = derived_facts(upto, now=derived_now, cfg=cfg)
        win_events = window_events(mapped, w)
        is_reused = w.window_id in reused_ids
        for a in evaluate(snap, derived, cfg):
            topics = [e["topic"] for e in a.evidence]
            tag_path = topics[0] if topics else a.rule_id
            from_id, to_id, ev_ts = _anomaly_evidence(win_events, topics, w)
            anomaly = MachineAnomaly(
                rule_id=a.rule_id,
                severity=SEVERITY_MAP.get(a.severity, "info"),
                title=a.title,
                message=a.message,
                tag_path=tag_path,
                tenant_id=tenant_id,
                uns_path=uns_path,
                window_id=w.window_id,
                from_event_id=from_id,
                to_event_id=to_id,
                event_timestamp=ev_ts,
                metadata={
                    "severity_raw": a.severity,
                    "next_check": NEXT_CHECK.get(a.rule_id, ""),
                    "confidence": a.confidence,
                    "components": a.components,
                    "evidence": a.evidence,
                },
            )
            key = (
                anomaly.window_id,
                anomaly.diff_type,
                anomaly.tag_path,
                anomaly.event_timestamp,
            )
            if is_reused:
                triple = (anomaly.window_id, anomaly.diff_type, anomaly.tag_path)
                if triple in existing_triples:
                    continue
                existing_triples.add(triple)
            elif key in existing_keys:
                continue
            existing_keys.add(key)
            anomalies.append(anomaly)
    diffs_written = store.insert_anomaly_diffs(anomalies, tenant_id=tenant_id)

    latest_window = None
    if windows:
        last_w = windows[-1]
        latest_window = {
            "window_id": last_w.window_id,
            "state": last_w.state,
            "started_at": last_w.started_at,
            "ended_at": last_w.ended_at,
        }

    generated_at = (
        datetime.fromtimestamp(now, tz=timezone.utc)
        if now is not None
        else datetime.now(tz=timezone.utc)
    ).isoformat()

    summary = {
        "uns_path": uns_path,
        "latest_run": latest_run,
        "latest_window": latest_window,
        "windows_upserted": len(windows),
        "anomaly_diffs_written": diffs_written,
        "anomalies": [
            {
                "rule_id": a.rule_id,
                "severity": a.severity,
                "title": a.title,
                "next_check": a.metadata.get("next_check", ""),
                "from_event_id": a.from_event_id,
                "to_event_id": a.to_event_id,
                "window_id": a.window_id,
            }
            for a in anomalies
        ],
        "unmapped_tags": unmapped,
        "run_summary": run_summary,
        "generated_at": generated_at,
    }
    logger.info(
        "machine_memory: uns=%s windows=%d anomalies=%d unmapped=%d",
        uns_path,
        len(windows),
        diffs_written,
        sum(unmapped.values()),
    )
    return summary


# ─── CLI — deterministic fixture runner (InMemoryRunStore; no DB/hardware) ──


def _cli() -> int:
    import argparse
    import json

    from .store import InMemoryRunStore

    parser = argparse.ArgumentParser(
        description=(
            "Run the machine-memory worker over a tag_events fixture JSON "
            "against an in-memory store (always non-destructive)."
        )
    )
    parser.add_argument(
        "--fixture", required=True, help="path to a JSON array of tag_events rows"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the summary only (skip the persisted-row detail dump)",
    )
    args = parser.parse_args()

    with open(args.fixture, encoding="utf-8") as f:
        rows = json.load(f)

    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault((r.get("tenant_id", ""), r.get("uns_path", "")), []).append(r)

    store = InMemoryRunStore()
    for (tenant_id, uns_path), _group in sorted(groups.items()):
        summary = historize_machine_memory(store, tenant_id, uns_path, rows)
        print(json.dumps(summary, indent=2, default=str))

    if not args.dry_run:
        print(
            json.dumps(
                {
                    "persisted": {
                        "machine_run": len(store.runs),
                        "run_step": len(store.steps),
                        "run_baseline": len(store.baselines),
                        "run_diff_baseline_deviation": len(store.diffs),
                        "machine_state_window": len(store.state_windows),
                        "run_diff_anomaly": len(store.anomaly_diffs),
                    }
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
