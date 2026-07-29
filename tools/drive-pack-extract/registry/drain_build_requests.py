"""Drain accepted `drive_pack_update` build requests → staged candidate + grading report.

The Hub accept path (`mira-hub/src/lib/suggestion-accept.ts`) does NOT extract or grade
inline — a synchronous Python shell-out inside a Next.js HTTP request is the wrong shape. It
only writes a durable "build requested" marker onto the `ai_suggestions` row's own
`extracted_data` (`build_requested=true`, `build_status='requested'`). The row IS the queue.

This worker is the drain half: it reads those markers and, for each, invokes the EXISTING
trust-preserving coordinator ``update_candidate.py`` (which runs the family generator + grader
as subprocesses and assembles a candidate review report). The coordinator writes ONLY into the
staged ``candidates/<family>/`` tree — guarded by ``update_candidate.assert_not_live_packs`` —
so this worker can never promote into the live served ``mira-bots/shared/drive_packs/packs/``
tree. Promotion to a trusted pack is a separate, human-gated step (ADR-0025,
``.claude/rules/train-before-deploy.md``, ``runbook-drive-manual-update-acceptance.md``).

After each request the worker flips ``build_status`` off ``'requested'`` (→ ``'built'`` /
``'failed'``) so a marker is drained at most once.

The DB I/O is injected (``drain(load_requests, save_result, runner=...)``) so the policy core is
fully unit-testable offline without a database or a real subprocess. ``main()`` wires the
injected functions to psycopg2 against ``NEON_DATABASE_URL`` / ``DATABASE_URL``.

Usage (ops / cron / bench):
    NEON_DATABASE_URL=… python tools/drive-pack-extract/registry/drain_build_requests.py [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Callable

import update_candidate

# What the Hub enqueue writes and what this worker drains.
_REQUESTED = "requested"
_BUILT = "built"
_FAILED = "failed"


# --- policy core (unit-tested; no DB, no real subprocess) -------------------


def process_build_request(
    request: dict[str, Any],
    *,
    runner: Callable[[list[str]], int] = update_candidate.main,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Run the extractor+grader for ONE build request via ``update_candidate.main``.

    ``update_candidate`` never targets the live packs tree (``assert_not_live_packs``) and never
    promotes, so this worker cannot either — it only stages a ``candidates/<family>/`` +
    grading report. Returns a result dict merged back onto the suggestion row.

    Return-code mapping (``update_candidate.main``):
      0        -> candidate generated + graded (trust_status not rejected)  -> built
      1        -> candidate generated; grader flagged rejected trust_status -> built (review)
      other    -> refused (unknown/manual-only manual) or generator/tooling error -> failed
    """
    manual_id = str(request.get("registry_manual_id") or "")
    local_pdf = str(request.get("local_pdf_path") or "")
    if not manual_id:
        return {"build_status": _FAILED, "build_reason": "missing registry_manual_id"}
    if not local_pdf:
        return {
            "build_status": _FAILED,
            "build_reason": "missing local_pdf_path — the manual PDF is not cached for extraction",
        }

    argv = ["--manual", local_pdf, "--id", manual_id]
    if generated_at:
        argv += ["--generated-at", generated_at]

    try:
        rc = runner(argv)
    except Exception as exc:  # noqa: BLE001 — one bad request must not stop the drain
        return {"build_status": _FAILED, "build_reason": f"{type(exc).__name__}: {exc}"}

    if rc == 0:
        return {"build_status": _BUILT, "build_reason": "candidate generated + graded (not promoted)", "rc": rc}
    if rc == 1:
        return {
            "build_status": _BUILT,
            "build_reason": "candidate generated; grader flagged rejected trust_status — review required",
            "rc": rc,
        }
    return {
        "build_status": _FAILED,
        "build_reason": f"update_candidate exited {rc} (refused or tooling error — see worker log)",
        "rc": rc,
    }


def drain(
    load_requests: Callable[[], list[dict[str, Any]]],
    save_result: Callable[[str, dict[str, Any]], None],
    *,
    runner: Callable[[list[str]], int] = update_candidate.main,
) -> list[tuple[str, dict[str, Any]]]:
    """Process every pending build request. ``load_requests`` returns rows with an ``id`` +
    ``registry_manual_id`` + ``local_pdf_path``; ``save_result`` persists the outcome (which flips
    ``build_status`` off ``requested`` so the row is not drained again)."""
    outcomes: list[tuple[str, dict[str, Any]]] = []
    for req in load_requests():
        result = process_build_request(req, runner=runner)
        result["build_completed_at"] = datetime.now(timezone.utc).isoformat()
        save_result(str(req["id"]), result)
        outcomes.append((str(req["id"]), result))
    return outcomes


# --- DB wiring (psycopg2; only exercised by main(), not by the unit tests) --

_SELECT_SQL = """
    SELECT id, extracted_data
      FROM ai_suggestions
     WHERE suggestion_type = 'drive_pack_update'
       AND status = 'accepted'
       AND extracted_data->>'build_requested' = 'true'
       AND COALESCE(extracted_data->>'build_status', '') = %s
     LIMIT %s
"""

_UPDATE_SQL = """
    UPDATE ai_suggestions
       SET extracted_data = COALESCE(extracted_data, '{}'::jsonb) || %s::jsonb
     WHERE id = %s
"""


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=25, help="max requests to drain this run")
    parser.add_argument(
        "--database-url", default=None, help="override NEON_DATABASE_URL / DATABASE_URL"
    )
    args = parser.parse_args(argv)

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr)
        return 2

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        def load_requests() -> list[dict[str, Any]]:
            with conn.cursor() as cur:
                cur.execute(_SELECT_SQL, (_REQUESTED, args.limit))
                rows = cur.fetchall()
            out = []
            for row_id, extracted in rows:
                ed = extracted if isinstance(extracted, dict) else json.loads(extracted or "{}")
                out.append(
                    {
                        "id": row_id,
                        "registry_manual_id": ed.get("registry_manual_id"),
                        "local_pdf_path": ed.get("local_pdf_path"),
                    }
                )
            return out

        def save_result(row_id: str, result: dict[str, Any]) -> None:
            with conn.cursor() as cur:
                cur.execute(_UPDATE_SQL, (json.dumps(result), row_id))
            conn.commit()

        outcomes = drain(load_requests, save_result)
    finally:
        conn.close()

    for row_id, result in outcomes:
        print(f"{row_id}: {result['build_status']} — {result.get('build_reason', '')}")
    print(f"drained {len(outcomes)} build request(s)")
    return 0


if __name__ == "__main__":  # pragma: no cover - manual/ops entry
    raise SystemExit(main())
