#!/usr/bin/env python3
"""PRD §7.3 — tenant-scoped, READ-ONLY historical repair/preflight report.

For ONE tenant, computes the REAL current admission result of every confirmed,
enabled, visible notebook source under the Workstream A rule
(`manual-rag.ts` under MIRA_ENFORCE_APPROVED_RETRIEVAL=true):

    a chunk is admissible when  verified = true
                            OR  (is_private = true AND its doc is in the
                                 server-derived confirmed set)

so, per source (all of whose rows are already confirmed by the WHERE clause):
    admitted   ⇐ chunks_admissible > 0   (globally verified, or tenant-private)
    excluded   ⇐ chunks_admissible = 0   (shared/OEM verified=false, or no chunks)

Because this tool performs NO rewrite, the §7.3 "counts before and after" are
two identical snapshots of the same rows with a zero delta and
`mutations_performed: 0`; the report is evidence for the no-rewrite decision,
never a repair action.

Guarantees (pinned by tests/beta/test_admission_preflight.py):
  * exactly one SELECT, bound to one uuid tenant, no write verb anywhere;
  * the session is `SET TRANSACTION READ ONLY` and ends with ROLLBACK;
  * EXECUTABLE ACCESS IS LOOPBACK-ONLY (localhost / 127.0.0.1 / ::1) — there
    is no host override of any kind, and the connect path itself re-checks
    the gate; the tool never connects to a remote or shared database;
  * `--print-sql` only PREPARES the tenant-bound READ ONLY statement. It is
    not an execution path: `.github/workflows/db-inspect.yml` is a static
    workflow that accepts no arbitrary SQL, so running this against staging
    requires ADDING the statement to that workflow as a reviewed probe step
    (PR + approval) — nothing here submits it anywhere;
  * the report never contains the connection string.

Usage:
  # disposable local Postgres
  PREFLIGHT_DATABASE_URL=postgres://…@127.0.0.1:5602/mira_test \
      python tools/qa/notebook_source_admission_preflight.py --tenant-id <uuid> --json-out report.json
  # prepare the statement for a reviewed db-inspect.yml probe step (no connection is made)
  python tools/qa/notebook_source_admission_preflight.py --tenant-id <uuid> --print-sql
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
# Substrings that identify the production NeonDB / VPS. Refused outright (belt).
PROD_MARKERS = ("prod", "prd", "165.245.138.91")
# The ONLY hosts the tool will ever connect to (braces). No override exists.
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class PreflightRefused(RuntimeError):
    """Unsafe target or malformed input — nothing was executed."""


SQL = """
SELECT s.tenant_id::text            AS tenant_id,
       s.notebook_id::text          AS notebook_id,
       s.doc_id::text               AS doc_id,
       s.match_state                AS match_state,
       s.enabled_by_default         AS enabled_by_default,
       count(k.id)::int             AS chunks_total,
       count(k.id) FILTER (WHERE k.is_private)::int              AS chunks_private,
       count(k.id) FILTER (WHERE k.verified)::int                AS chunks_verified,
       count(k.id) FILTER (WHERE k.verified OR k.is_private)::int AS chunks_admissible
  FROM equipment_notebook_sources s
  LEFT JOIN knowledge_entries k
         ON k.doc_id = s.doc_id
        AND k.tenant_id = s.tenant_id
 WHERE s.tenant_id = %s::uuid
   AND s.match_state IN ('user_confirmed', 'verified')
   AND s.enabled_by_default = true
   AND s.superseded_at IS NULL
 GROUP BY 1, 2, 3, 4, 5
 ORDER BY 2, 3
""".strip()


def build_query(tenant_id: str) -> tuple[str, tuple[str]]:
    if not UUID_RE.match(tenant_id or ""):
        raise PreflightRefused(
            "tenant id must be a uuid (this report is tenant-scoped by construction)"
        )
    return SQL, (tenant_id,)


def assert_safe_target(url: str) -> None:
    """FAIL-CLOSED, NOT overridable: loopback hosts only.

    A denylist cannot recognise production (the documented prod Neon pooler
    host carries no 'prod'/'prd' marker), and an allow variable would be an
    arbitrary-remote escape hatch. So the executable path connects ONLY to a
    loopback host; every remote/shared database is refused before any
    connection is attempted. For staging, `--print-sql` prepares the statement
    for a reviewed db-inspect.yml probe step; it does not execute it.
    """
    if not url:
        raise PreflightRefused("no database url")
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    haystack = f"{host} {parsed.path or ''}".lower()
    if any(m in haystack for m in PROD_MARKERS):
        raise PreflightRefused(
            "REFUSED: production-looking database target — this tool never connects to it; "
            "--print-sql prepares the statement for a reviewed db-inspect.yml probe step"
        )
    if host not in LOOPBACK_HOSTS:
        raise PreflightRefused(
            f"REFUSED: host {host!r} is not loopback — this tool never connects to a remote or "
            "shared database; --print-sql prepares the statement for a reviewed db-inspect.yml step"
        )


def _classify(row: dict[str, Any]) -> tuple[str, str]:
    """(current_admission_result, admission_path) from the aggregated counts."""
    total = int(row.get("chunks_total") or 0)
    verified = int(row.get("chunks_verified") or 0)
    admissible = int(row.get("chunks_admissible") or 0)
    if total == 0:
        return "excluded", "no_chunks"
    if verified > 0:
        return "admitted", "verified_mark_present"
    if admissible > 0:
        return "admitted", "admitted_via_confirmation"
    return "excluded", "excluded_shared_unverified"


def _snapshot(rows: list[dict[str, Any]]) -> dict[str, Any]:
    sources = []
    for r in sorted(rows, key=lambda r: (str(r.get("notebook_id")), str(r.get("doc_id")))):
        result, path = _classify(r)
        sources.append(
            {
                "notebook_id": str(r.get("notebook_id")),
                "doc_id": str(r.get("doc_id")),
                "match_state": r.get("match_state"),
                "enabled_by_default": bool(r.get("enabled_by_default")),
                "chunks_total": int(r.get("chunks_total") or 0),
                "chunks_private": int(r.get("chunks_private") or 0),
                "chunks_verified": int(r.get("chunks_verified") or 0),
                "chunks_admissible": int(r.get("chunks_admissible") or 0),
                "current_admission_result": result,
                "admission_path": path,
            }
        )
    paths = [s["admission_path"] for s in sources]
    summary = {
        "confirmed_sources": len(sources),
        "admitted": sum(1 for s in sources if s["current_admission_result"] == "admitted"),
        "excluded": sum(1 for s in sources if s["current_admission_result"] == "excluded"),
        "admitted_via_confirmation": paths.count("admitted_via_confirmation"),
        "verified_mark_present": paths.count("verified_mark_present"),
        "excluded_shared_unverified": paths.count("excluded_shared_unverified"),
        "no_chunks": paths.count("no_chunks"),
        "chunks_total": sum(s["chunks_total"] for s in sources),
        "chunks_private": sum(s["chunks_private"] for s in sources),
        "chunks_verified": sum(s["chunks_verified"] for s in sources),
        "chunks_admissible": sum(s["chunks_admissible"] for s in sources),
    }
    return {"sources": sources, "summary": summary}


def run_preflight(tenant_id: str, conn: Any) -> dict[str, Any]:
    """Execute the one read-only query on an open LOOPBACK connection and shape
    the report. `conn` is DB-API-ish (psycopg 3 in real use; a fake in tests).
    """
    sql, params = build_query(tenant_id)
    with conn.cursor(row_factory=_dict_row_factory()) as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    conn.rollback()
    before = _snapshot(rows)
    # No rewrite is performed, so "after" is the same rows: an identical
    # snapshot, by construction — the §7.3 before/after with zero delta.
    after = copy.deepcopy(before)
    delta = {k: after["summary"][k] - before["summary"][k] for k in before["summary"]}
    return {
        "report": "notebook_source_admission_preflight",
        "prd": "docs/prd/2026-08-29-technician-beta-recovery-prd.md §7.3",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tenant_id": tenant_id,
        "read_only": True,
        "mutations_performed": 0,
        "admission_rule": "verified = true OR (is_private = true AND doc in server-derived confirmed set)",
        "sources": after["sources"],
        "summary": after["summary"],
        "before": before,
        "after": after,
        "delta": delta,
        # Every confirmed tenant-private source is admitted by the rule itself;
        # shared verified=false rows are correctly excluded (they are not this
        # tenant's to promote); nothing needs rewriting.
        "conclusion": "no_rewrite_required",
    }


def _dict_row_factory():
    try:
        from psycopg.rows import dict_row  # type: ignore

        return dict_row
    except Exception:  # noqa: BLE001 — tests inject a fake connection
        return None


def _connect(url: str) -> Any:
    """The ONLY connect path — gated here too (defense in depth), so no caller
    that bypasses main() can reach a remote/shared database: the loopback
    check runs before the driver is even imported."""
    assert_safe_target(url)
    import psycopg  # type: ignore

    return psycopg.connect(url, autocommit=False)


def render_sql_for_db_inspect(tenant_id: str) -> str:
    """PREPARED statement with the tenant literal bound in and the READ ONLY
    guard stated. Not executed by anything here: db-inspect.yml is static and
    accepts no arbitrary SQL, so this must be added to it as a reviewed probe
    step (PR + approval) before it can run against staging."""
    sql, (tid,) = build_query(tenant_id)
    bound = sql.replace("%s::uuid", f"'{tid}'::uuid")
    return (
        "-- notebook_source_admission_preflight (PRD §7.3) — PREPARED SQL, READ ONLY.\n"
        "-- Not runnable as-is on staging: db-inspect.yml accepts no arbitrary SQL; add this\n"
        "-- as a reviewed probe step in that workflow (PR + approval). Never run from a session.\n"
        "BEGIN; SET TRANSACTION READ ONLY;\n" + bound + ";\nROLLBACK;\n"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tenant-id", required=True)
    ap.add_argument("--database-url-env", default="PREFLIGHT_DATABASE_URL")
    ap.add_argument("--json-out", default=None)
    ap.add_argument(
        "--print-sql",
        action="store_true",
        help="print the PREPARED tenant-bound READ ONLY statement (to be added to db-inspect.yml as a reviewed step); never connects",
    )
    args = ap.parse_args(argv)
    try:
        build_query(args.tenant_id)
        if args.print_sql:
            print(render_sql_for_db_inspect(args.tenant_id))
            return 0
        assert_safe_target(os.getenv(args.database_url_env, ""))
    except PreflightRefused as exc:
        print(f"REFUSED: {exc}")
        return 2
    conn = _connect(os.getenv(args.database_url_env, ""))
    try:
        report = run_preflight(args.tenant_id, conn)
    finally:
        conn.close()
    text = json.dumps(report, indent=2, default=str)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
