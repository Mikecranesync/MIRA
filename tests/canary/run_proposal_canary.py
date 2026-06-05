#!/usr/bin/env python3.12
"""ADR-0017 proposal-state-drift canary runner (#1723).

Runs every `-- @check:` query in proposal_state_drift.sql against
NEON_DATABASE_URL and fails (exit 1) if any returns rows. A healthy database
returns zero rows for every check.

Run against STAGING (never prod — the queries are read-only, but keep prod
out of canary loops):

    doppler run --project factorylm --config stg -- \
        python3.12 tests/canary/run_proposal_canary.py

Pairs with the static guard (scripts/kg_write_guard.py, #1722): the guard stops
new unguarded WRITES at CI time; this canary catches state DRIFT in the data at
runtime. The positive "fresh ingest proposes, zero new verified edges"
assertion lives in mira-crawler/tools/smoke_proposal_writer.py (run alongside
this in the nightly workflow).
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import psycopg2

SQL_PATH = Path(__file__).resolve().parent / "proposal_state_drift.sql"
_CHECK_RE = re.compile(r"--\s*@check:\s*(\S+)\s*\n(.*?)(?=\n--\s*@check:|\Z)", re.DOTALL)


def parse_checks(sql_text: str) -> list[tuple[str, str]]:
    """Return [(name, query)] for each `-- @check:` block."""
    out: list[tuple[str, str]] = []
    for m in _CHECK_RE.finditer(sql_text):
        name = m.group(1)
        # strip remaining comment lines + trailing semicolon/whitespace
        body = "\n".join(
            ln for ln in m.group(2).splitlines() if not ln.strip().startswith("--")
        ).strip().rstrip(";").strip()
        if body:
            out.append((name, body))
    return out


def main() -> int:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        print("NEON_DATABASE_URL not set", file=sys.stderr)
        return 2

    checks = parse_checks(SQL_PATH.read_text())
    if not checks:
        print(f"no @check blocks found in {SQL_PATH}", file=sys.stderr)
        return 2

    conn = psycopg2.connect(url)
    drift = 0
    try:
        with conn.cursor() as cur:
            for name, query in checks:
                cur.execute(query)
                rows = cur.fetchall()
                if rows:
                    drift += 1
                    print(f"❌ DRIFT [{name}]: {len(rows)} offending row(s)")
                    for r in rows[:10]:
                        print(f"     {r}")
                else:
                    print(f"✅ ok    [{name}]")
    finally:
        conn.close()

    if drift:
        print(
            f"\nproposal-state canary FAILED: {drift} check(s) drifted. "
            "A proposal/suggestion/edge status triple is inconsistent (ADR-0017).",
            file=sys.stderr,
        )
        return 1
    print(f"\nproposal-state canary PASSED: {len(checks)} checks, no drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
