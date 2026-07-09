"""On-demand drive-pack gap report — the distillation flywheel's Phase 3 worklist.

Reads the knowledge gaps the flywheel captured (Phase 1) and labeled (Phase 2):
unmatched drive-pack turns in ``conversation_eval`` (``meta.surface='drive_pack'``
AND ``meta.matched=false``) — real technician questions the pack could not answer.
Groups them per pack + per parameter/fault token, ranks by how often they're asked
(and recency), and emits ``gap_report.{md,json}``.

This is exactly the report that would have surfaced "what is P01.24?" before we
added it by hand — the on-demand delivery Mike chose (not a Telegram digest).

**Read-only.** It never writes to ``conversation_eval`` and never touches the live
packs. Turning a recurring gap into a ``drive_pack_update`` proposal is a separate,
gated step (Phase 3b) — this file only reports.

Usage::

    NEON_DATABASE_URL=… python tools/drive-pack-extract/gap_report.py [--limit N] [--out DIR]

Design mirrors ``registry/drain_build_requests.py``: pure, injectable aggregation
(unit-tested with seeded rows) + a thin ``main()`` doing the psycopg2 read.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

# Parameter/fault token shape — KEEP IN SYNC with
# ``mira-bots/shared/drive_packs/ask.py::_PARAM_ID_RE`` (the matcher the packs
# use). Copied rather than imported: ``ask`` pulls the whole drive_packs package
# via relative imports, which these standalone tools deliberately avoid.
PARAM_TOKEN_RE = re.compile(r"\b[A-Za-z]\d{2}\.\d{2}\b|\b[A-Za-z]{1,3}\d{2,3}\b")

_NO_TOKEN = "(no parameter id)"
_MAX_SAMPLES = 3


def _utf8_stdout() -> None:
    """Keep the em-dash/arrow in our summaries from choking a Windows cp1252 console."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001 - best-effort; older/odd streams lack reconfigure
        pass


def extract_tokens(question: str) -> list[str]:
    """Uppercased parameter/fault tokens in a question (e.g. ``["P02.00"]``)."""
    return [t.upper() for t in PARAM_TOKEN_RE.findall(question or "")]


def _as_iso(value: Any) -> str:
    """Normalize a created_at (datetime or str) to a comparable ISO string."""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def aggregate_gaps(
    rows: list[dict[str, Any]], generated_at: Optional[str] = None
) -> dict[str, Any]:
    """Aggregate unmatched drive-pack rows into a ranked gap report.

    Each row needs ``pack_id``, ``user_message``, ``created_at``. Groups by pack,
    then by the first parameter/fault token in the question (or a no-token bucket).
    Packs are ranked by gap count; tokens within a pack by count then recency.
    """
    # pack -> token -> {"count", "last_asked", "samples"}
    packs: dict[str, dict[str, dict[str, Any]]] = defaultdict(lambda: defaultdict(_new_bucket))
    total = 0

    for row in rows:
        pack_id = (row.get("pack_id") or "unknown").strip() or "unknown"
        question = row.get("user_message") or ""
        asked = _as_iso(row.get("created_at"))
        tokens = extract_tokens(question)
        key = tokens[0] if tokens else _NO_TOKEN

        bucket = packs[pack_id][key]
        bucket["count"] += 1
        if asked > bucket["last_asked"]:
            bucket["last_asked"] = asked
        if len(bucket["samples"]) < _MAX_SAMPLES and question not in bucket["samples"]:
            bucket["samples"].append(question)
        total += 1

    pack_list = []
    for pack_id, tokens in packs.items():
        token_list = [
            {
                "token": tok,
                "count": b["count"],
                "last_asked": b["last_asked"],
                "samples": b["samples"],
            }
            for tok, b in tokens.items()
        ]
        # Rank: most-asked first, ties broken by most-recent.
        token_list.sort(key=lambda t: (t["count"], t["last_asked"]), reverse=True)
        pack_list.append(
            {
                "pack_id": pack_id,
                "gap_count": sum(t["count"] for t in token_list),
                "tokens": token_list,
            }
        )

    pack_list.sort(key=lambda p: p["gap_count"], reverse=True)
    return {"generated_at": generated_at, "total_gaps": total, "packs": pack_list}


def _new_bucket() -> dict[str, Any]:
    return {"count": 0, "last_asked": "", "samples": []}


def render_json(report: dict[str, Any]) -> str:
    return json.dumps(report, indent=2, default=str)


def render_md(report: dict[str, Any]) -> str:
    """Human-readable worklist: per-pack tables ranked by most-asked gap."""
    lines: list[str] = ["# Drive-pack gap report", ""]
    gen = report.get("generated_at")
    lines.append(
        f"Generated: {gen or 'n/a'} · "
        f"Total unmatched drive-pack questions: {report.get('total_gaps', 0)}"
    )
    lines.append("")

    packs = report.get("packs", [])
    if not packs:
        lines.append("_No unmatched drive-pack questions captured yet._")
        return "\n".join(lines) + "\n"

    for pack in packs:
        lines.append(f"## {pack['pack_id']} — {pack['gap_count']} gaps")
        lines.append("")
        lines.append("| token | asks | last asked | example |")
        lines.append("|---|---|---|---|")
        for t in pack["tokens"]:
            example = (t["samples"][0] if t["samples"] else "").replace("|", "\\|")
            if len(example) > 80:
                example = example[:77] + "…"
            last = (t["last_asked"] or "")[:10]  # YYYY-MM-DD
            lines.append(f"| {t['token']} | {t['count']} | {last} | {example} |")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# DB glue — read-only SELECT of the unmatched drive-pack queue
# ---------------------------------------------------------------------------

_SELECT_SQL = """
    SELECT meta->>'pack_id' AS pack_id, user_message, created_at
    FROM conversation_eval
    WHERE meta->>'surface' = 'drive_pack'
      AND (meta->>'matched')::boolean = false
    ORDER BY created_at DESC
    LIMIT %s
"""

# The flywheel reads the mig-013 `meta` column on `conversation_eval`. On a
# database where capture (Phase 1) hasn't been provisioned, that column (or the
# whole table) is absent — fail with an actionable message, not a raw traceback.
META_MISSING_MSG = (
    "conversation_eval.meta is missing on this database — the distillation "
    "flywheel can't read captured turns here. Apply migration 013 "
    "(mira-core/mira-ingest/db/migrations/013_conversation_eval_meta.sql) to this "
    "environment first."
)


def capture_schema_ready(cur) -> bool:
    """True iff ``conversation_eval.meta`` exists (Phase-1 capture provisioned)."""
    cur.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'conversation_eval' AND column_name = 'meta'"
    )
    return cur.fetchone() is not None


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(description="Drive-pack gap report (read-only).")
    parser.add_argument("--limit", type=int, default=5000, help="max rows to scan")
    parser.add_argument("--out", default=".", help="output directory for gap_report.{md,json}")
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    _utf8_stdout()
    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            if not capture_schema_ready(cur):
                print(f"ERROR: {META_MISSING_MSG}", file=sys.stderr)
                return 3
            cur.execute(_SELECT_SQL, (args.limit,))
            rows = [
                {"pack_id": r[0], "user_message": r[1], "created_at": r[2]} for r in cur.fetchall()
            ]
    finally:
        conn.close()

    report = aggregate_gaps(rows, generated_at=datetime.now().astimezone().isoformat())

    os.makedirs(args.out, exist_ok=True)
    md_path = os.path.join(args.out, "gap_report.md")
    json_path = os.path.join(args.out, "gap_report.json")
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(render_md(report))
    with open(json_path, "w", encoding="utf-8") as fh:
        fh.write(render_json(report))

    print(
        f"Wrote {md_path} and {json_path} — {report['total_gaps']} gaps across {len(report['packs'])} pack(s)."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
