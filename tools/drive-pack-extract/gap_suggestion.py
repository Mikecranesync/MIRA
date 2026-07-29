"""Turn a recurring drive-pack coverage gap into a Hub review item — flywheel Phase 3b.

Phase 3a (``gap_report.py``) reads unmatched drive-pack turns from
``conversation_eval`` and ranks, per pack, the parameter/fault tokens technicians
keep asking about that the pack can't answer. This module takes that same ranked
report and, for each *registered* pack whose gap volume crosses a threshold,
writes a **review-only** ``drive_pack_update`` ``ai_suggestions`` row so the gap
surfaces in the Command Center review queue.

**It reuses the existing ``drive_pack_update`` gate end-to-end — nothing new.**
The row carries the pack's ``registry_manual_id`` (resolved from the source
registry), so when a human ACCEPTS it the existing Hub path
(``suggestion-accept.ts`` → ``registry/drain_build_requests.py`` →
``update_candidate.py``) re-extracts + grades that manual into a *staged
candidate* — guarded by ``update_candidate.assert_not_live_packs``. If the manual
PDF isn't cached, the drain records ``build_status='failed'`` with a "supply the
manual" reason and a human runs ``update_candidate.py`` by hand. **Nothing is ever
auto-promoted into the live served packs** (ADR-0025,
``.claude/rules/train-before-deploy.md``).

Distinct from the kb-growth bridge (``drive_pack_bridge.py`` /
``src/lib/drive-pack-suggestion.ts``), which raises a ``drive_pack_update`` when a
manual's *hash changes*. This raises one when *questions* reveal a coverage gap —
so the rows are deduped independently by ``extracted_data->>'source'='gap_report'``.

Read-mostly: aggregation is pure; the only write is the gated ``ai_suggestions``
INSERT (``status='pending'``), and ``--dry-run`` prints without writing. It never
touches ``conversation_eval`` and never touches the live packs.

Usage::

    NEON_DATABASE_URL=… python tools/drive-pack-extract/gap_suggestion.py \
        --tenant-id <uuid> [--min-gap-count 3] [--limit 5000] [--dry-run]

Design mirrors ``gap_report.py`` / ``registry/drain_build_requests.py``: pure,
injectable core (unit-tested with seeded data) + a thin psycopg2 ``main()``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import gap_report

# The suggestion type + review gate we reuse (mig 062). Deduped independently
# from the kb-growth bridge via the ``source`` discriminator below.
_SUGGESTION_TYPE = "drive_pack_update"
_SOURCE = "gap_report"
# mig-027 ``import:<format>`` proposed_by convention (bridge uses
# ``import:kb_growth_bridge``; this path is a sibling producer).
_PROPOSED_BY = "import:gap_report"
_REVIEW_CONFIDENCE = 0.5  # a review item, not a graded claim (matches the bridge)
_MAX_TOKENS_IN_ROW = 10  # cap the worklist carried on the row
_MAX_TOKENS_IN_BODY = 8

# Registry that maps a served ``pack_id`` → its source ``manual_id`` (+ identity).
_DEFAULT_REGISTRY = Path(__file__).resolve().parent / "registry" / "sources.json"


# ---------------------------------------------------------------------------
# Pure core — no DB, no filesystem side effects (unit-tested)
# ---------------------------------------------------------------------------


def load_pack_manual_index(registry: dict[str, Any]) -> dict[str, dict[str, str]]:
    """``pack_id`` → ``{manual_id, product_family, vendor}`` from a parsed registry.

    Only entries with both a ``pack_id`` and a ``manual_id`` are indexed — those
    are the packs whose gaps can be routed to the accept→drain re-extraction.
    """
    index: dict[str, dict[str, str]] = {}
    for entry in registry.get("manuals", []) or []:
        if not isinstance(entry, dict):
            continue
        pack_id = entry.get("pack_id")
        manual_id = entry.get("manual_id")
        if not pack_id or not manual_id:
            continue
        index[str(pack_id)] = {
            "manual_id": str(manual_id),
            "product_family": str(entry.get("product_family") or pack_id),
            "vendor": str(entry.get("vendor") or ""),
        }
    return index


def build_gap_suggestions(
    report: dict[str, Any],
    pack_index: dict[str, dict[str, str]],
    *,
    min_gap_count: int = 3,
) -> list[dict[str, Any]]:
    """Ranked gap report → ``ai_suggestions`` row payloads (one per registered pack).

    A pack is turned into a suggestion only when it is **registered** (so the row
    can carry a ``registry_manual_id`` that drives the accept→drain re-extraction)
    AND its total ``gap_count >= min_gap_count`` (don't flag a one-off ask). Rows
    are returned ranked by gap volume; the caller inserts them ``status='pending'``.

    Pure: no DB, no I/O. ``extracted_data`` is the review-gate contract (below).
    """
    suggestions: list[dict[str, Any]] = []
    for pack in report.get("packs", []):
        pack_id = str(pack.get("pack_id") or "").strip()
        gap_count = int(pack.get("gap_count") or 0)
        ident = pack_index.get(pack_id)
        if ident is None or gap_count < min_gap_count:
            # Unknown pack → can't tie to a manual (skip); below threshold → noise.
            continue

        tokens = list(pack.get("tokens") or [])[:_MAX_TOKENS_IN_ROW]
        family = ident["product_family"]
        vendor = ident["vendor"]

        suggestions.append(
            {
                "suggestion_type": _SUGGESTION_TYPE,
                "title": _title(family, gap_count, tokens),
                "body": _body(vendor, family, gap_count, tokens, ident["manual_id"]),
                "confidence": _REVIEW_CONFIDENCE,
                "risk_level": "low",  # review-only; accept only stages a candidate
                "extracted_data": {
                    "source": _SOURCE,  # dedup + drain-provenance discriminator
                    "kind": "coverage_gap",
                    "pack_id": pack_id,
                    "gap_count": gap_count,
                    "top_tokens": tokens,
                    "registry_manual_id": ident["manual_id"],  # drives accept→drain
                    "product_family": family,
                    "vendor": vendor,
                    "review_only": True,
                },
            }
        )
    return suggestions


def _distinct_token_labels(tokens: list[dict[str, Any]]) -> list[str]:
    return [str(t.get("token")) for t in tokens if t.get("token")]


def _title(family: str, gap_count: int, tokens: list[dict[str, Any]]) -> str:
    n = len(_distinct_token_labels(tokens))
    return (
        f"Coverage gap: {family} pack missing {n} parameter(s) "
        f"technicians asked about ({gap_count} unmatched question(s))"
    )


def _body(
    vendor: str,
    family: str,
    gap_count: int,
    tokens: list[dict[str, Any]],
    manual_id: str,
) -> str:
    who = f"{vendor} {family}".strip()
    lines = [
        f"Technicians asked {gap_count} question(s) the **{who}** drive pack could "
        f"not answer. Most-asked parameter/fault tokens (from the Phase-3a gap report):",
        "",
    ]
    for t in tokens[:_MAX_TOKENS_IN_BODY]:
        tok = t.get("token")
        count = t.get("count")
        sample = (t.get("samples") or [""])[0]
        last = str(t.get("last_asked") or "")[:10]
        line = f"- `{tok}` — asked {count}×"
        if last:
            line += f", last {last}"
        if sample:
            line += f' (e.g. "{sample}")'
        lines.append(line)
    lines += [
        "",
        "This is a **REVIEW-ONLY** coverage signal — it does NOT change any trusted "
        "drive pack. Accepting it enqueues a re-extraction + grading of the source "
        "manual into a *staged candidate* for review (never auto-promoted). If the "
        "manual PDF isn't cached, ground the gap by hand:",
        "",
        f"    python tools/drive-pack-extract/registry/update_candidate.py "
        f"--manual <path-to-manual.pdf> --id {manual_id}",
        "",
        "Trust requires extraction + grading + cite-integrity + human approval "
        "(docs/drive-commander/runbook-drive-manual-update-acceptance.md).",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DB glue — read the gap queue, write gated pending suggestions (dedup by pack)
# ---------------------------------------------------------------------------

_DEDUP_SQL = """
    SELECT id FROM ai_suggestions
     WHERE tenant_id = %s::uuid
       AND suggestion_type = %s
       AND status IN ('pending', 'deferred')
       AND extracted_data->>'source' = %s
       AND extracted_data->>'pack_id' = %s
     LIMIT 1
"""

_INSERT_SQL = """
    INSERT INTO ai_suggestions
        (tenant_id, suggestion_type, extracted_data, confidence,
         status, risk_level, proposed_by, title, body)
    VALUES
        (%s::uuid, %s, %s::jsonb, %s, 'pending', %s, %s, %s, %s)
    RETURNING id
"""


def _load_registry(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _fetch_gap_report(cur, limit: int) -> dict[str, Any]:
    """Read unmatched drive-pack turns and aggregate them (reuses Phase 3a)."""
    cur.execute(gap_report._SELECT_SQL, (limit,))
    rows = [{"pack_id": r[0], "user_message": r[1], "created_at": r[2]} for r in cur.fetchall()]
    return gap_report.aggregate_gaps(rows, generated_at=datetime.now().astimezone().isoformat())


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(description="Drive-pack gap → review suggestion (gated).")
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("MIRA_TENANT_ID"),
        help="tenant that owns the review items (defaults to MIRA_TENANT_ID)",
    )
    parser.add_argument(
        "--min-gap-count", type=int, default=3, help="min unmatched asks before a pack is flagged"
    )
    parser.add_argument(
        "--limit", type=int, default=5000, help="max conversation_eval rows to scan"
    )
    parser.add_argument(
        "--registry", default=str(_DEFAULT_REGISTRY), help="path to the manual source registry JSON"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print what would be proposed; write nothing"
    )
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    if not args.tenant_id:
        print("ERROR: set --tenant-id or MIRA_TENANT_ID", file=sys.stderr)
        return 2

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    gap_report._utf8_stdout()
    pack_index = load_pack_manual_index(_load_registry(Path(args.registry)))

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            if not gap_report.capture_schema_ready(cur):
                print(f"ERROR: {gap_report.META_MISSING_MSG}", file=sys.stderr)
                return 3
            report = _fetch_gap_report(cur, args.limit)
        suggestions = build_gap_suggestions(report, pack_index, min_gap_count=args.min_gap_count)

        created, skipped = 0, 0
        for s in suggestions:
            pack_id = s["extracted_data"]["pack_id"]
            if args.dry_run:
                print(f"[dry-run] would propose: {s['title']}")
                continue
            with conn.cursor() as cur:
                # RLS: scope the write to this tenant (mirrors proposal_writer.py).
                cur.execute(
                    "SELECT set_config('app.current_tenant_id', %s, true)", (args.tenant_id,)
                )
                cur.execute(_DEDUP_SQL, (args.tenant_id, _SUGGESTION_TYPE, _SOURCE, pack_id))
                if cur.fetchone():
                    skipped += 1
                    continue
                cur.execute(
                    _INSERT_SQL,
                    (
                        args.tenant_id,
                        _SUGGESTION_TYPE,
                        json.dumps(s["extracted_data"]),
                        s["confidence"],
                        s["risk_level"],
                        _PROPOSED_BY,
                        s["title"],
                        s["body"],
                    ),
                )
                created += 1
            conn.commit()
    finally:
        conn.close()

    if args.dry_run:
        print(f"[dry-run] {len(suggestions)} pack(s) over the gap threshold.")
    else:
        print(f"Proposed {created} new gap suggestion(s), skipped {skipped} already-pending.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
