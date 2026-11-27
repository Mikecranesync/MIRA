#!/usr/bin/env python3
"""Replay / inspect a single decision_traces row from NeonDB.

Reconstructs the turn MIRA answered — question, evidence used, recommendation,
citation status, model — so groundedness can be audited offline.

Usage::

    # Requires NEON_DATABASE_URL (and optionally MIRA_TENANT_ID for the RLS binding)
    python tools/replay_decision_trace.py <trace-id>
    python tools/replay_decision_trace.py --trace-id 11111111-2222-...
    doppler run -- python tools/replay_decision_trace.py <trace-id>

The script reads from the Hub NeonDB; it never writes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from typing import Any

_QUERY = """
SELECT
    trace_id,
    platform,
    uns_path::text,
    user_question,
    tag_evidence,
    manual_evidence,
    kg_evidence,
    recommendation,
    citations_present,
    confidence,
    technician_confirmed,
    outcome,
    model_used,
    latency_ms,
    ts
FROM decision_traces
WHERE trace_id = %(trace_id)s
  AND tenant_id = %(tenant_id)s
LIMIT 1
"""

_QUERY_NO_TENANT = """
SELECT
    trace_id,
    platform,
    uns_path::text,
    user_question,
    tag_evidence,
    manual_evidence,
    kg_evidence,
    recommendation,
    citations_present,
    confidence,
    technician_confirmed,
    outcome,
    model_used,
    latency_ms,
    ts
FROM decision_traces
WHERE trace_id = %(trace_id)s
LIMIT 1
"""


def _banner(label: str, width: int = 72) -> str:
    side = (width - len(label) - 2) // 2
    return f"{'─' * side} {label} {'─' * (width - side - len(label) - 2)}"


def _pp_json(value: Any, indent: int = 2) -> str:
    if not value:
        return "  (none)"
    items = value if isinstance(value, list) else [value]
    lines = json.dumps(items, indent=indent, default=str).splitlines()
    return "\n".join("  " + ln for ln in lines)


def replay(trace_id: str) -> int:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        print("ERROR: NEON_DATABASE_URL is not set.", file=sys.stderr)
        print(
            "       Run via: doppler run -- python tools/replay_decision_trace.py <id>",
            file=sys.stderr,
        )
        return 1

    tenant_id = os.environ.get("MIRA_TENANT_ID", "")

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except ImportError:
        print(
            "ERROR: sqlalchemy is not installed. Run: pip install sqlalchemy psycopg2-binary",
            file=sys.stderr,
        )
        return 1

    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )

    with engine.connect() as conn:
        if tenant_id:
            conn.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": tenant_id})
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            row = (
                conn.execute(text(_QUERY), {"trace_id": trace_id, "tenant_id": tenant_id})
                .mappings()
                .first()
            )
        else:
            # No tenant binding — only works on superuser connections or when RLS is off.
            row = conn.execute(text(_QUERY_NO_TENANT), {"trace_id": trace_id}).mappings().first()

    if row is None:
        print(
            f"ERROR: trace {trace_id!r} not found (or belongs to a different tenant).",
            file=sys.stderr,
        )
        if not tenant_id:
            print("       Hint: set MIRA_TENANT_ID to narrow the search.", file=sys.stderr)
        return 1

    # ── Print the reconstructed turn ─────────────────────────────────────────
    print()
    print(_banner("DECISION TRACE REPLAY"))
    print(f"  trace_id  : {row['trace_id']}")
    print(f"  ts        : {row['ts']}")
    print(f"  platform  : {row['platform'] or '(not set)'}")
    print(f"  uns_path  : {row['uns_path'] or '(not set)'}")
    print(f"  outcome   : {row['outcome'] or '(not set)'}")
    print(f"  model     : {row['model_used'] or '(not set)'}")
    print(
        f"  latency   : {row['latency_ms']} ms"
        if row["latency_ms"]
        else "  latency   : (not measured)"
    )
    print(f"  confidence: {row['confidence'] or '(none)'}")
    print(f"  cited     : {'YES ✓' if row['citations_present'] else 'NO — grounding gap'}")
    print(f"  confirmed : {row['technician_confirmed']}")
    print()

    print(_banner("QUESTION (sanitized)"))
    print(
        textwrap.fill(
            row["user_question"] or "(empty)", width=72, initial_indent="  ", subsequent_indent="  "
        )
    )
    print()

    print(_banner("RECOMMENDATION (sanitized)"))
    rec = row["recommendation"] or "(no recommendation recorded)"
    for line in rec.splitlines():
        print(textwrap.fill(line, width=72, initial_indent="  ", subsequent_indent="    ") or "")
    print()

    tag_ev = row["tag_evidence"] or []
    man_ev = row["manual_evidence"] or []
    kg_ev = row["kg_evidence"] or []

    print(_banner(f"TAG EVIDENCE ({len(tag_ev)} items)"))
    print(_pp_json(tag_ev))
    print()

    print(_banner(f"MANUAL EVIDENCE ({len(man_ev)} items)"))
    print(_pp_json(man_ev))
    print()

    print(_banner(f"KG EVIDENCE ({len(kg_ev)} items)"))
    print(_pp_json(kg_ev))
    print()

    if not row["citations_present"]:
        print("⚠  GROUNDING GAP: this turn produced a recommendation with no citation.")
        print("   The technician received an answer MIRA could not back with a source.")
        print()

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replay a single decision_traces turn from NeonDB (read-only).",
    )
    parser.add_argument(
        "trace_id",
        nargs="?",
        help="UUID of the trace row to inspect.",
    )
    parser.add_argument(
        "--trace-id",
        dest="trace_id_flag",
        help="UUID of the trace row to inspect (alternative form).",
    )
    args = parser.parse_args()

    trace_id = args.trace_id or args.trace_id_flag
    if not trace_id:
        parser.print_help(sys.stderr)
        sys.exit(1)

    sys.exit(replay(trace_id))


if __name__ == "__main__":
    main()
