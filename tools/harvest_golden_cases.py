"""Harvest human-corrected turns into regression golden cases — flywheel Phase 4a.

Closes the production→test loop from ``docs/specs/bot-eval-loop-spec.md``
(§ "Golden-case harvester"): every bot reply Mike confirmed **bad** and told
what it *should* have said (``conversation_eval.human_verdict='bad'`` +
``correction``) becomes a permanent regression case in ``tests/bot_regression.py``
so the same mistake can never ship again.

**Print-only, human-gated.** This tool NEVER edits ``tests/bot_regression.py`` and
NEVER auto-promotes anything. It prints proposed ``GOLDEN_CASES`` dict entries to
stdout for Mike to paste-review-commit — "golden cases are forever, a human
eyeball is the right gate" (spec § 191–210). Its *only* write is the gated
``--mark-applied`` pass that flips ``golden_case_added=true`` for rows whose case
Mike has already committed (so a row is harvested at most once).

Reconciliation with the spec: the spec sketched an ``expected_substring_in_response``
field, but the shipped ``tests/bot_regression.py`` suite is **offline / no-LLM** —
it checks intent classification + the clarification path, not response text. So a
harvested case carries the runnable ``name``/``input``/``intent`` (which the
existing intent tier checks) plus the correction, the bad response, and the
source-row UUID as **review comments** — the reviewer turns those into the right
assertion (``clarification_must_be_none`` / ``intent`` / a new tier) by hand.

Usage::

    # 1. propose cases from the review queue (prints, writes nothing)
    NEON_DATABASE_URL=… python tools/harvest_golden_cases.py [--limit N]

    # 2. after committing the pasted cases, mark those rows harvested
    NEON_DATABASE_URL=… python tools/harvest_golden_cases.py \
        --mark-applied --ids <uuid> [<uuid> …]

Design mirrors ``tools/drive-pack-extract/gap_report.py``: a pure, injectable core
(unit-tested with seeded rows) + a thin psycopg2 ``main()``.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Optional

_MAX_SLUG_WORDS = 6
_MAX_SLUG_LEN = 40
_BAD_RESPONSE_PREVIEW = 140
_CORRECTION_PREVIEW = 240
_DEFAULT_INTENT = "industrial"  # the classifier's default for unrecognized queries


# ---------------------------------------------------------------------------
# Pure core — no DB, no I/O (unit-tested)
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    """A short, stable, identifier-safe slug from a question (for the case name)."""
    words = re.findall(r"[a-z0-9]+", (text or "").lower())[:_MAX_SLUG_WORDS]
    slug = "_".join(words)[:_MAX_SLUG_LEN].strip("_")
    return slug or "case"


def row_to_proposal(row: dict[str, Any]) -> dict[str, Any]:
    """A ``conversation_eval`` row → the structured golden-case proposal.

    Pure: no DB, no I/O. ``name``/``input``/``intent`` are the runnable case; the
    remaining fields are review context the renderer emits as comments.
    """
    question = row.get("user_message") or ""
    return {
        "name": f"harvested_{slugify(question)}",
        "input": question,
        "intent": (row.get("intent") or _DEFAULT_INTENT),
        "source_id": str(row.get("id") or ""),
        "correction": row.get("correction") or "",
        "bad_response": row.get("bot_response") or "",
        "auto_score": row.get("auto_score"),
        "human_score": row.get("human_score"),
    }


def _truncate(text: str, n: int) -> str:
    text = " ".join((text or "").split())  # collapse newlines/whitespace
    return text if len(text) <= n else text[: n - 1] + "…"


def render_proposal(p: dict[str, Any]) -> str:
    """A single proposal → a paste-ready commented ``GOLDEN_CASES`` dict block."""
    scores = f"auto_score={p.get('auto_score')} human_score={p.get('human_score')}"
    lines = [
        f"    # harvested from conversation_eval row {p['source_id']}  ({scores}, verdict=bad)",
        f'    #   bad response : "{_truncate(p["bad_response"], _BAD_RESPONSE_PREVIEW)}"',
        f'    #   correction   : "{_truncate(p["correction"], _CORRECTION_PREVIEW)}"',
        "    #   -> review: keep `intent`, and/or add clarification_must_be_* per the correction",
        "    {",
        f'        "name": {_py(p["name"])},',
        f'        "input": {_py(p["input"])},',
        f'        "intent": {_py(p["intent"])},',
        "    },",
    ]
    return "\n".join(lines)


def _py(value: str) -> str:
    """Render a string as a Python literal (safe quoting/escaping for paste)."""
    return repr(value)


def render_batch(proposals: list[dict[str, Any]]) -> str:
    """All proposals → the full stdout block, with a paste header + mark-applied footer."""
    if not proposals:
        return (
            "# No un-harvested corrections in the review queue.\n"
            "# (conversation_eval: human_verdict='bad' AND correction IS NOT NULL "
            "AND golden_case_added=false)\n"
        )

    out = [
        f"# {len(proposals)} correction(s) ready to harvest into tests/bot_regression.py GOLDEN_CASES.",
        "# Paste the reviewed dict(s) into GOLDEN_CASES, commit, then run --mark-applied with the ids below.",
        "",
    ]
    out += [render_proposal(p) for p in proposals]

    ids = " ".join(p["source_id"] for p in proposals if p["source_id"])
    out += [
        "",
        "# After committing the case(s) above, flip these rows to golden_case_added=true:",
        f"#   python tools/harvest_golden_cases.py --mark-applied --ids {ids}",
    ]
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# DB glue — read the harvest queue; the only write is the gated mark-applied
# ---------------------------------------------------------------------------

_SELECT_SQL = """
    SELECT id, user_message, bot_response, intent, correction, auto_score, human_score
      FROM conversation_eval
     WHERE human_verdict = 'bad'
       AND correction IS NOT NULL
       AND golden_case_added = false
     ORDER BY reviewed_at DESC NULLS LAST
     LIMIT %s
"""

_MARK_SQL = """
    UPDATE conversation_eval
       SET golden_case_added = true
     WHERE id = ANY(%s::uuid[])
       AND human_verdict = 'bad'
     RETURNING id
"""


def _fetch_queue(cur, limit: int) -> list[dict[str, Any]]:
    cur.execute(_SELECT_SQL, (limit,))
    cols = [
        "id",
        "user_message",
        "bot_response",
        "intent",
        "correction",
        "auto_score",
        "human_score",
    ]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _utf8_stdout() -> None:
    """Corrections may carry non-ASCII — keep a Windows cp1252 console from choking."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001 - best-effort
        pass


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    _utf8_stdout()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200, help="max queue rows to propose")
    parser.add_argument(
        "--mark-applied",
        action="store_true",
        help="flip golden_case_added=true for --ids (run AFTER committing the cases)",
    )
    parser.add_argument("--ids", nargs="+", default=[], help="conversation_eval row UUIDs to mark")
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    if args.mark_applied and not args.ids:
        print("ERROR: --mark-applied requires --ids <uuid> [<uuid> …]", file=sys.stderr)
        return 2

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        if args.mark_applied:
            with conn.cursor() as cur:
                cur.execute(_MARK_SQL, (list(args.ids),))
                marked = [r[0] for r in cur.fetchall()]
            conn.commit()
            print(f"Marked {len(marked)} row(s) golden_case_added=true.")
            return 0

        with conn.cursor() as cur:
            queue = _fetch_queue(cur, args.limit)
        proposals = [row_to_proposal(r) for r in queue]
        print(render_batch(proposals), end="")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
