#!/usr/bin/env python3
"""PRD §7.3 — tenant-scoped, READ-ONLY historical repair/preflight report.

Question it answers, for ONE tenant: "which confirmed notebook sources are
admitted through server-derived confirmation (Workstream A) although their
chunks are all `knowledge_entries.verified = false`?" — i.e. the rows the
#3437/#3468 defect used to hide. After Workstream A every such row is admitted
WITHOUT mutation, so the report's conclusion is `no_rewrite_required`; it is
evidence for that decision, never a repair action.

Guarantees (each pinned by tests/beta/test_admission_preflight.py):
  * exactly one SELECT, bound to one uuid tenant, no write verb anywhere;
  * the session is `SET TRANSACTION READ ONLY` and ends with ROLLBACK;
  * production-looking targets are refused before a connection is opened
    (docs/environments.md rule 1: never psql/SQL against prod from a session);
  * the report never contains the connection string.

Usage (staging or a disposable DB only):
  PREFLIGHT_DATABASE_URL=postgres://… python tools/qa/notebook_source_admission_preflight.py \
      --tenant-id <uuid> --json-out report.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
# Substrings that identify the production NeonDB / VPS. Refused outright.
PROD_MARKERS = ("prod", "prd", "165.245.138.91")


class PreflightRefused(RuntimeError):
    """Unsafe target or malformed input — nothing was executed."""


SQL = """
SELECT s.tenant_id::text            AS tenant_id,
       s.notebook_id::text          AS notebook_id,
       s.doc_id::text               AS doc_id,
       s.match_state                AS match_state,
       count(k.*)::int              AS chunks,
       bool_or(coalesce(k.verified, false)) AS any_verified
  FROM equipment_notebook_sources s
  LEFT JOIN knowledge_entries k
         ON k.doc_id = s.doc_id
        AND k.tenant_id = s.tenant_id
 WHERE s.tenant_id = %s::uuid
   AND s.match_state IN ('user_confirmed', 'verified')
   AND s.enabled_by_default = true
   AND s.superseded_at IS NULL
 GROUP BY 1, 2, 3, 4
 ORDER BY 2, 3
""".strip()


def build_query(tenant_id: str) -> tuple[str, tuple[str]]:
    if not UUID_RE.match(tenant_id or ""):
        raise PreflightRefused(
            "tenant id must be a uuid (this report is tenant-scoped by construction)"
        )
    return SQL, (tenant_id,)


def assert_safe_target(url: str) -> None:
    """Refuse anything that looks like production. Allow-list is not needed:
    staging Neon branches and disposable DBs never carry these markers."""
    if not url:
        raise PreflightRefused("no database url")
    parsed = urlparse(url)
    haystack = f"{parsed.hostname or ''} {parsed.path or ''}".lower()
    if any(m in haystack for m in PROD_MARKERS):
        raise PreflightRefused(
            "REFUSED: production-looking database target — run via db-inspect.yml on staging instead"
        )


def _admission_path(row: dict[str, Any]) -> str:
    if int(row.get("chunks") or 0) == 0:
        return "no_chunks"
    if bool(row.get("any_verified")):
        return "verified_mark_present"
    return "admitted_via_confirmation"


def run_preflight(tenant_id: str, conn: Any) -> dict[str, Any]:
    """Execute the one read-only query on an open connection and shape the report.

    `conn` is a DB-API-ish connection (psycopg 3 in real use; a fake in tests):
    cursor(row_factory=...) → execute/fetchall, plus rollback(). The
    transaction is forced READ ONLY before the SELECT and rolled back after.
    """
    sql, params = build_query(tenant_id)
    with conn.cursor(row_factory=_dict_row_factory()) as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
    conn.rollback()
    sources = [{**r, "admission_path": _admission_path(r)} for r in rows]
    summary = {
        "confirmed_sources": len(sources),
        "admitted_via_confirmation": sum(
            1 for s in sources if s["admission_path"] == "admitted_via_confirmation"
        ),
        "verified_mark_present": sum(
            1 for s in sources if s["admission_path"] == "verified_mark_present"
        ),
        "no_chunks": sum(1 for s in sources if s["admission_path"] == "no_chunks"),
    }
    return {
        "report": "notebook_source_admission_preflight",
        "prd": "docs/prd/2026-08-29-technician-beta-recovery-prd.md §7.3",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tenant_id": tenant_id,
        "read_only": True,
        "mutations_performed": 0,
        "sources": sources,
        "summary": summary,
        # Workstream A admits confirmed tenant-private sources through the
        # server-derived set regardless of knowledge_entries.verified, so no
        # historical rewrite is required for ANY of these rows.
        "conclusion": "no_rewrite_required",
    }


def _dict_row_factory():
    try:
        from psycopg.rows import dict_row  # type: ignore

        return dict_row
    except Exception:  # noqa: BLE001 — tests inject a fake connection
        return None


def _connect(url: str) -> Any:
    import psycopg  # type: ignore

    return psycopg.connect(url, autocommit=False)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tenant-id", required=True)
    ap.add_argument("--database-url-env", default="PREFLIGHT_DATABASE_URL")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args(argv)
    url = os.getenv(args.database_url_env, "")
    try:
        build_query(args.tenant_id)
        assert_safe_target(url)
    except PreflightRefused as exc:
        print(f"REFUSED: {exc}")
        return 2
    conn = _connect(url)
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
