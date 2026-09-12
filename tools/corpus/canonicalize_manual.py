"""Canonicalize a duplicated manual by QUARANTINING duplicates. Reversible.

Rewritten after the P0 incident (`docs/testing/2026-08-10-corpus-p0-incident.md`).
The predecessor did three unsafe things; each is now structurally impossible:

| defect | now |
|---|---|
| guarded by `if "prod" in url` — inert, since Neon URLs contain neither word | `corpus.identity`: the caller DECLARES `host/db`, the connection REPORTS its own, exact match required, plus a separate env lock |
| deduped on content hash scoped by `model_number ILIKE '%525%'` — collapsed the Quick Start into the User Manual | `corpus.dedup_identity`: manufacturer + canonical publication + revision + content, unit-tested |
| DELETE with a manifest that omitted `embedding` — the "reversible" claim was false | rows MOVE to a quarantine table in one transaction, carrying every non-generated column |

## Why quarantine rather than delete-plus-manifest

A JSONL manifest re-derives the row, and it is only ever as complete as the
column list somebody typed. Mine omitted `embedding`, `created_at`, `updated_at`
and the entire hierarchy block, so restoring would have produced NULL-embedding
rows — invisible to vector search, which is precisely the defect class the
corpus is supposed to be audited for.

`DELETE ... RETURNING *` piped into an INSERT leaves the database as the
authority on what a row is. Nothing is transcribed, so nothing can be forgotten.
The generated-column list is read from `information_schema` rather than assumed,
because a generated column cannot be inserted into and hard-coding that
exclusion would rot the moment the schema changes.

Restore is the same move in reverse: `--restore --batch <label>`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))

from corpus import dedup_identity as di  # noqa: E402
from corpus import identity as ident  # noqa: E402

QUARANTINE = "knowledge_entries_quarantine"


def _engine():
    import os

    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise ident.IdentityError("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"}), url


def copyable_columns(conn) -> list[str]:
    """Every writable column. Generated ones come from the catalog, not a guess."""
    from sqlalchemy import text

    rows = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'knowledge_entries' AND is_generated <> 'ALWAYS' "
            "ORDER BY ordinal_position"
        )
    ).fetchall()
    return [r[0] for r in rows]


def ensure_quarantine(conn) -> None:
    """`LIKE` with no constraints: a holding table, not a second corpus."""
    from sqlalchemy import text

    conn.execute(text(f"CREATE TABLE IF NOT EXISTS {QUARANTINE} (LIKE knowledge_entries)"))
    conn.execute(
        text(f"ALTER TABLE {QUARANTINE} ADD COLUMN IF NOT EXISTS quarantined_at timestamptz")
    )
    conn.execute(text(f"ALTER TABLE {QUARANTINE} ADD COLUMN IF NOT EXISTS quarantine_batch text"))


def candidate_rows(conn, manufacturer: str, model: str) -> list[dict]:
    """Rows in scope. Manufacturer is REQUIRED — never model alone."""
    from sqlalchemy import text

    return [
        dict(r)
        for r in conn.execute(
            text(
                "SELECT id, source_url, manufacturer, model_number, content, source_page "
                "FROM knowledge_entries "
                "WHERE is_private = false AND manufacturer ILIKE :mfr AND model_number ILIKE :m"
            ),
            {"mfr": f"%{manufacturer}%", "m": f"%{model}%"},
        )
        .mappings()
        .fetchall()
    ]


def quarantine(conn, ids: list[str], batch: str, cols: list[str]) -> int:
    from sqlalchemy import text

    if not ids:
        return 0
    col_list = ", ".join(f'"{c}"' for c in cols)
    res = conn.execute(
        text(
            f"WITH moved AS ("
            f"  DELETE FROM knowledge_entries WHERE id = ANY(cast(:ids AS uuid[])) "
            f"  RETURNING {col_list}"
            f") INSERT INTO {QUARANTINE} ({col_list}, quarantined_at, quarantine_batch) "
            f"SELECT {col_list}, now(), :batch FROM moved"
        ),
        {"ids": ids, "batch": batch},
    )
    return res.rowcount or 0


def restore(conn, batch: str, cols: list[str]) -> int:
    from sqlalchemy import text

    col_list = ", ".join(f'"{c}"' for c in cols)
    res = conn.execute(
        text(
            f"WITH back AS ("
            f"  DELETE FROM {QUARANTINE} WHERE quarantine_batch = :batch RETURNING {col_list}"
            f") INSERT INTO knowledge_entries ({col_list}) SELECT {col_list} FROM back"
        ),
        {"batch": batch},
    )
    return res.rowcount or 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manufacturer")
    ap.add_argument("--model")
    ap.add_argument("--prefer-url", default=None, help="the citable ingest to keep")
    ap.add_argument(
        "--expect-identity",
        required=True,
        help="host-prefix/dbname this MUST be, e.g. ep-quiet-boat-123456/neondb",
    )
    ap.add_argument("--batch", default=None, help="label; required for --restore")
    ap.add_argument("--restore", action="store_true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    eng, url = _engine()
    with eng.connect() as conn:
        observed = ident.observe(conn, url)
        print(f"connected: {observed.redacted()}")
        if a.apply:
            # Raises unless the declared identity matches exactly AND the env
            # lock is armed. Never reached on a dry run, so inspection is free.
            ident.assert_target(observed, a.expect_identity)
        cols = copyable_columns(conn)
        print(f"copyable columns: {len(cols)} (generated excluded)")

        if a.restore:
            if not a.batch:
                print("--restore requires --batch", file=sys.stderr)
                return 2
            ensure_quarantine(conn)
            if not a.apply:
                from sqlalchemy import text

                n = conn.execute(
                    text(f"SELECT count(*) FROM {QUARANTINE} WHERE quarantine_batch = :b"),
                    {"b": a.batch},
                ).scalar()
                print(f"DRY RUN — would restore {n} row(s) from batch {a.batch!r}")
                return 0
            n = restore(conn, a.batch, cols)
            conn.commit()
            print(f"restored {n} row(s) from batch {a.batch!r}")
            return 0

        if not (a.manufacturer and a.model):
            print("--manufacturer and --model are required", file=sys.stderr)
            return 2

        rows = candidate_rows(conn, a.manufacturer, a.model)
        retire = di.plan_retirements(rows, prefer_url=a.prefer_url)
        print(f"in scope: {len(rows)} rows   duplicates to quarantine: {len(retire)}")
        by_doc: dict[str, int] = {}
        for r in retire:
            d = di.canonical_document(r["source_url"])
            by_doc[d] = by_doc.get(d, 0) + 1
        for d, n in sorted(by_doc.items(), key=lambda kv: -kv[1]):
            print(f"   {n:5}  {d}")

        if not a.apply:
            print("DRY RUN — nothing moved. Re-run with --apply.")
            return 0

        batch = a.batch or f"{a.model.replace(' ', '')}-{observed.host_prefix}"
        ensure_quarantine(conn)
        n = quarantine(conn, [str(r["id"]) for r in retire], batch, cols)
        conn.commit()
        print(f"QUARANTINED {n} row(s) as batch {batch!r}")
        print(f"restore: --restore --batch {batch} --expect-identity {a.expect_identity} --apply")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ident.IdentityError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        raise SystemExit(3) from None
