#!/usr/bin/env python3
"""Sensor REPLAY fixture — re-key the CV-101 e-stop tag_events fixture to a tenant
and push it through the ONE legal ingest door, then derive Machine Memory.

Three sub-commands, all reusing the canonical pipeline (never a second copy):

  rekey      fixture JSON -> canonical ingest batch (``ingest_contract.build_tag_entry``
             / ``build_ingest_batch``). Relative offsets between events are preserved;
             the LAST event lands ``--minutes-ago`` before now. Pure; no I/O beyond files.
  ingest     the same batch through ``tag_ingest.ingest_batch`` + ``NeonTagStore`` —
             exactly what ``POST /api/v1/tags/ingest`` runs (allowlist fail-closed,
             tag_events append + live_signal_cache upsert in one transaction).
             Reads ``NEON_DATABASE_URL`` from the environment (Doppler; never pasted).
  historize  run the historian beat task ``tasks.historize_runs.historize_runs`` in-process
             for one uns_path so ``machine_state_window`` + anomaly ``run_diff`` rows exist.
             Only needed where no mira-historian-worker runs (the staging stack).

Typical staging use (docs/qa/sensor-acceptance-fixture.md)::

    doppler run --project factorylm --config stg -- python tools/qa/sensor_replay_fixture.py \
        ingest --tenant <uuid> --minutes-ago 20
    doppler run --project factorylm --config stg -- python tools/qa/sensor_replay_fixture.py \
        historize --tenant <uuid> --uns-path enterprise.home_garage.conveyor_lab.conveyor_1

The allowlist (``approved_tags``) is a precondition and is seeded by the sanctioned
``apply-approved-tags.yml`` workflow — this tool never writes it. No SQL lives here.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = (
    REPO / "mira-crawler" / "tests" / "fixtures" / "machine_memory" / "cv101_estop.json"
)
DEFAULT_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"
SOURCE_SYSTEM = "ignition"  # the source_system approved_tags_conveyor.sql seeds


def _path(*parts: str) -> None:
    p = str(REPO.joinpath(*parts))
    if p not in sys.path:
        sys.path.insert(0, p)


def rekey(fixture: Path, tenant: str, minutes_ago: float) -> dict:
    """Fixture rows -> canonical batch. The fixture's own tenant/uns_path are dropped:
    tenant comes from the caller and uns_path is resolved by the allowlist at ingest."""
    _path("mira-relay")
    from ingest_contract import build_ingest_batch, build_tag_entry

    rows = json.loads(fixture.read_text(encoding="utf-8"))
    stamps = [datetime.fromisoformat(r["event_timestamp"]) for r in rows]
    last = max(stamps)
    shift = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)) - last
    tags = [
        build_tag_entry(
            r["tag_path"],
            r["value"],
            value_type=r.get("value_type", "string"),
            quality=r.get("quality", "good"),
            ts=(ts + shift).isoformat(),
            metadata={"replay_fixture": fixture.name, "fixture_event_id": r.get("event_id")},
        )
        for r, ts in zip(rows, stamps)
    ]
    return build_ingest_batch(SOURCE_SYSTEM, tags, tenant_id=tenant)


def ingest(payload: dict, tenant: str) -> dict:
    _path("mira-relay")
    from tag_ingest import NeonTagStore, ingest_batch

    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        raise SystemExit("NEON_DATABASE_URL not set (run under doppler for the target env)")
    return ingest_batch(payload, tenant, NeonTagStore(url)).as_dict()


def ingest_stream(payload: dict, tenant: str, speed: float) -> dict:
    """Replay the batch the way relay traffic actually arrives: ONE push per event,
    paced by the fixture's own inter-event gaps (divided by ``speed``).

    The historian clocks state windows on ``ingested_at`` (server receipt), not the
    client ``event_timestamp`` — a one-shot batch gives every row the same receipt
    time and collapses the whole fault story into a single instant. Streaming keeps
    the two clocks honest: ``event_timestamp`` = the re-keyed source time,
    ``ingested_at`` = when this replay actually delivered it.
    """
    import time

    tags = payload["tags"]
    stamps = [datetime.fromisoformat(t["ts"]) for t in tags]
    totals = {"accepted": 0, "events_written": 0, "state_upserts": 0, "rejected": []}
    for i, tag in enumerate(tags):
        if i:
            time.sleep(max(0.0, (stamps[i] - stamps[i - 1]).total_seconds() / speed))
        one = dict(payload, tags=[tag])
        r = ingest(one, tenant)
        totals["accepted"] += r["accepted"]
        totals["events_written"] += r["events_written"]
        totals["state_upserts"] += r["state_upserts"]
        totals["rejected"] += r["rejected"]
        print(
            f"push {i + 1}/{len(tags)} {tag['tag_path']}={tag['value']} -> {r['status']}",
            flush=True,
        )
    return dict(payload_source_system=payload["source_system"], status="ok", **totals)


def historize(tenant: str, uns_path: str, lookback_seconds: int) -> dict:
    _path("mira-crawler")
    os.environ.update(
        {
            "MIRA_RUN_DIFF_ENABLED": "1",
            "MIRA_TENANT_ID": tenant,
            "MIRA_MACHINE_MEMORY_UNS_PATHS": uns_path,
            "MIRA_RUN_LOOKBACK_SECONDS": str(lookback_seconds),
        }
    )
    from tasks.historize_runs import historize_runs

    return historize_runs()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--tenant", required=True, help="tenant UUID that owns the asset + allowlist"
        )
        p.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
        p.add_argument(
            "--minutes-ago",
            type=float,
            default=20.0,
            help="where the LAST event lands relative to now",
        )

    p_rekey = sub.add_parser("rekey")
    common(p_rekey)
    p_rekey.add_argument("--out", type=Path, help="write the batch JSON here (default: stdout)")

    p_ingest = sub.add_parser("ingest")
    common(p_ingest)
    p_ingest.add_argument("--payload", type=Path, help="pre-built batch JSON (skips rekey)")
    p_ingest.add_argument(
        "--stream",
        action="store_true",
        help="one push per event, paced by the fixture gaps (how relay traffic really arrives)",
    )
    p_ingest.add_argument("--speed", type=float, default=1.0, help="pacing divisor for --stream")
    p_ingest.add_argument(
        "--live-clocks",
        action="store_true",
        help="with --stream: re-key so each event's ts equals its (paced) delivery time, "
        "i.e. event_timestamp ~= ingested_at exactly like a live push",
    )

    p_hist = sub.add_parser("historize")
    p_hist.add_argument("--tenant", required=True)
    p_hist.add_argument("--uns-path", default=DEFAULT_UNS)
    p_hist.add_argument("--lookback-seconds", type=int, default=3600)

    a = ap.parse_args(argv)
    if a.cmd == "rekey":
        batch = rekey(a.fixture, a.tenant, a.minutes_ago)
        text = json.dumps(batch, indent=2)
        if a.out:
            a.out.write_text(text, encoding="utf-8")
            print(f"wrote {a.out} ({len(batch['tags'])} tags)")
        else:
            print(text)
        return 0
    if a.cmd == "ingest":
        minutes_ago = a.minutes_ago
        if a.stream and a.live_clocks:
            # The LAST event is delivered `span/speed` seconds from now — anchor it there.
            rows = json.loads(a.fixture.read_text(encoding="utf-8"))
            stamps = [datetime.fromisoformat(r["event_timestamp"]) for r in rows]
            minutes_ago = -((max(stamps) - min(stamps)).total_seconds() / a.speed) / 60.0
        batch = (
            json.loads(a.payload.read_text(encoding="utf-8"))
            if a.payload
            else rekey(a.fixture, a.tenant, minutes_ago)
        )
        result = ingest_stream(batch, a.tenant, a.speed) if a.stream else ingest(batch, a.tenant)
        print(json.dumps(result, indent=2))
        return 0 if result["accepted"] == len(batch["tags"]) and not result["rejected"] else 2
    if a.cmd == "historize":
        result = historize(a.tenant, a.uns_path, a.lookback_seconds)
        print(json.dumps(result, indent=2, default=str))
        return 0 if result.get("status") == "ok" else 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
