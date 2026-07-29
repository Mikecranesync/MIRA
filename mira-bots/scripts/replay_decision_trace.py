"""Replay a decision_traces row — Phase 8 (#1660).

Reads one decision_traces row by UUID and prints a structured reconstruction
of the turn: question, evidence, recommendation, citations, confidence, and
outcome. Useful for incident review and grounding audits without a running bot.

Usage:
    python mira-bots/scripts/replay_decision_trace.py <trace-id>
    python mira-bots/scripts/replay_decision_trace.py <trace-id> --json

Run via Doppler so NEON_DATABASE_URL is set:
    doppler run --project factorylm --config stg -- \\
        python mira-bots/scripts/replay_decision_trace.py <uuid>
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")


_SELECT_SQL = """
SELECT trace_id::text,
       session_id::text,
       platform,
       uns_path::text       AS uns_path,
       user_question,
       tag_evidence,
       manual_evidence,
       kg_evidence,
       recommendation,
       citations_present,
       technician_confirmed,
       confidence,
       outcome,
       model_used,
       latency_ms,
       ts
  FROM decision_traces
 WHERE trace_id = %(trace_id)s
"""


def _fetch(trace_id: str) -> dict | None:
    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        print("ERROR: NEON_DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    from sqlalchemy import create_engine, text as sql_text  # noqa: PLC0415
    from sqlalchemy.pool import NullPool  # noqa: PLC0415

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"}, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            row = conn.execute(sql_text(_SELECT_SQL.replace("%(trace_id)s", ":trace_id")), {"trace_id": trace_id}).fetchone()
            if row is None:
                return None
            return dict(row._mapping)
    finally:
        engine.dispose()


def _print_human(row: dict) -> None:
    sep = "─" * 70
    print(sep)
    print(f"  TRACE  {row['trace_id']}")
    print(sep)
    print(f"  Time     : {row['ts']}")
    print(f"  Platform : {row['platform'] or '—'}")
    print(f"  UNS path : {row['uns_path'] or '—'}")
    if row.get("session_id"):
        print(f"  Session  : {row['session_id']}")
    print()
    print("QUESTION")
    print("  " + (row["user_question"] or "").replace("\n", "\n  "))
    print()

    tag_ev = row.get("tag_evidence") or []
    if tag_ev:
        print(f"TAG EVIDENCE  ({len(tag_ev)} tags)")
        for t in tag_ev:
            path = t.get("tag_path") or t.get("uns_path") or "?"
            val = t.get("value", "?")
            print(f"  {path} = {val}")
        print()

    manual_ev = row.get("manual_evidence") or []
    if manual_ev:
        print(f"MANUAL EVIDENCE  ({len(manual_ev)} chunks)")
        for m in manual_ev:
            doc = m.get("doc") or m.get("source") or "?"
            page = m.get("page")
            score = m.get("score")
            parts = [doc]
            if page is not None:
                parts.append(f"p.{page}")
            if score is not None:
                parts.append(f"score={score:.3f}")
            print(f"  {' · '.join(parts)}")
        print()

    kg_ev = row.get("kg_evidence") or []
    if kg_ev:
        print(f"KG EVIDENCE  ({len(kg_ev)} edges)")
        for k in kg_ev:
            print(f"  {k.get('entity_id','?')} —[{k.get('rel','?')}]→ {k.get('target','?')}")
        print()

    print("RECOMMENDATION")
    print("  " + (row.get("recommendation") or "").replace("\n", "\n  "))
    print()

    cited = row.get("citations_present")
    conf = row.get("confidence") or "none"
    outcome = row.get("outcome") or "—"
    model = row.get("model_used") or "—"
    latency = row.get("latency_ms")
    tech_confirmed = row.get("technician_confirmed")

    print("OUTCOME")
    print(f"  Citations present : {'YES' if cited else 'NO'}")
    print(f"  Confidence        : {conf}")
    print(f"  Outcome           : {outcome}")
    if tech_confirmed is not None:
        print(f"  Tech confirmed    : {'yes' if tech_confirmed else 'no'}")
    print(f"  Model             : {model}")
    if latency is not None:
        print(f"  Latency           : {latency} ms")
    print(sep)


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay a decision_traces row.")
    parser.add_argument("trace_id", help="UUID of the decision_traces row")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    try:
        uuid.UUID(args.trace_id)
    except ValueError:
        print(f"ERROR: '{args.trace_id}' is not a valid UUID", file=sys.stderr)
        return 1

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    row = _fetch(args.trace_id)
    if row is None:
        print(f"ERROR: trace {args.trace_id} not found", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(row, default=str, indent=2))
    else:
        _print_human(row)

    return 0


if __name__ == "__main__":
    sys.exit(main())
