#!/usr/bin/env python3
"""Replay a MIRA decision trace — fetch one row from NeonDB and print a
structured summary of the evidence, recommendation, and outcome.

Usage:
    NEON_DATABASE_URL=<url> python scripts/replay_trace.py <trace_id>

The trace_id is the UUID from decision_traces.trace_id (e.g. the value
returned by process_full as "trace_id", or visible in the Hub
/decision-trace/<id> admin page).
"""

from __future__ import annotations

import json
import os
import sys
import textwrap

_SELECT_SQL = """
SELECT trace_id, tenant_id, platform, uns_path, user_question,
       tag_evidence, manual_evidence, kg_evidence,
       recommendation, citations_present, confidence,
       technician_confirmed, outcome, model_used, latency_ms, ts
  FROM decision_traces
 WHERE trace_id = %(trace_id)s::uuid
 LIMIT 1
"""


def _pg_connect():
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        sys.exit("NEON_DATABASE_URL is not set")
    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 not installed — pip install psycopg2-binary")
    return psycopg2.connect(url, sslmode="require")


def _wrap(text: str, width: int = 88, indent: str = "  ") -> str:
    return textwrap.fill(str(text or ""), width=width, initial_indent=indent, subsequent_indent=indent)


def replay(trace_id: str) -> None:
    conn = _pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL, {"trace_id": trace_id})
            cols = [d[0] for d in cur.description]
            row_tuple = cur.fetchone()
    finally:
        conn.close()

    if row_tuple is None:
        sys.exit(f"No trace found for trace_id={trace_id!r}")

    row: dict = dict(zip(cols, row_tuple))

    # ── Header ────────────────────────────────────────────────────────────────
    print()
    print("━" * 72)
    print(f"  MIRA Decision Trace Replay")
    print(f"  trace_id  : {row['trace_id']}")
    print(f"  tenant_id : {row['tenant_id']}")
    print(f"  ts        : {row['ts']}")
    print("━" * 72)

    # ── Context ───────────────────────────────────────────────────────────────
    print(f"\n[Context]")
    print(f"  platform  : {row['platform'] or '—'}")
    print(f"  uns_path  : {row['uns_path'] or '—'}")
    print(f"  outcome   : {row['outcome'] or '—'}")
    print(f"  model     : {row['model_used'] or '—'}")
    print(f"  latency   : {row['latency_ms']} ms" if row['latency_ms'] is not None else "  latency   : —")
    print(f"  confidence: {row['confidence'] or '—'}")

    # ── Question ──────────────────────────────────────────────────────────────
    print(f"\n[Technician Question]")
    print(_wrap(row['user_question'] or "—"))

    # ── Evidence ──────────────────────────────────────────────────────────────
    tag_ev = row['tag_evidence']
    if isinstance(tag_ev, str):
        tag_ev = json.loads(tag_ev)
    if tag_ev:
        print(f"\n[Tag Evidence] ({len(tag_ev)} items)")
        for item in tag_ev[:5]:
            print(f"  {item}")

    man_ev = row['manual_evidence']
    if isinstance(man_ev, str):
        man_ev = json.loads(man_ev)
    if man_ev:
        print(f"\n[Manual Evidence] ({len(man_ev)} chunks)")
        for item in man_ev[:3]:
            print(f"  {item}")

    kg_ev = row['kg_evidence']
    if isinstance(kg_ev, str):
        kg_ev = json.loads(kg_ev)
    if kg_ev:
        print(f"\n[KG Evidence] ({len(kg_ev)} items)")
        for item in kg_ev[:3]:
            print(f"  {item}")

    # ── Recommendation ────────────────────────────────────────────────────────
    cited = "✓" if row['citations_present'] else "✗"
    confirmed = (
        "✓" if row['technician_confirmed'] is True
        else "✗" if row['technician_confirmed'] is False
        else "—"
    )
    print(f"\n[MIRA Recommendation]  citations={cited}  tech_confirmed={confirmed}")
    print(_wrap(row['recommendation'] or "—"))
    print()
    print("━" * 72)
    print()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(f"Usage: {sys.argv[0]} <trace_id>")
    replay(sys.argv[1])
