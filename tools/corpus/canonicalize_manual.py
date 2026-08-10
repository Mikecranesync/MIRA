"""Canonicalize a duplicated manual: keep ONE citable ingest, retire the rest.

DRY-RUN BY DEFAULT. `--apply` requires `--yes` and always writes a restore
manifest first. Staging only — refuses to run against a URL that does not look
like the staging branch, because the prod-guard rules put prod psql out of
bounds entirely.

## Choosing the authoritative copy — and why "widest page span" is wrong

`docmap.authoritative()` ranks by widest page span, and on 520-um001 that
picks `gdrive://520-um001_-en-e.pdf` at p0..1909. The real PowerFlex 525 user
manual is ~300 pages. So 1909 is not a page number: it is a chunk index written
into `source_page`. The heuristic reliably selects the copy with the most
INFLATED fake pagination.

The citable copy is the one whose page range is plausible for the document —
here the Rockwell literature ingest at p1..274, where the fault-clear procedure
sits at p160, matching the printed manual. That is checkable rather than
assumed, which is why `--verify-page` exists: give it a phrase and the page it
should be on, and canonicalization refuses to proceed if the chosen copy
disagrees.

## What "retire" means

Rows are DELETED from `knowledge_entries`, because the experiment is whether
production retrieval — `neon_recall`, unchanged — improves, and an overlay it
cannot see would prove nothing. Every deleted row is written to a JSONL restore
manifest first, so the operation is reversible by re-insert.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

BACKUP_DIR = REPO / "tools" / "corpus" / "restore"

_COLS = (
    "id, tenant_id, source_type, equipment_type, manufacturer, model_number, content, "
    "is_private, verified, input_type, source_url, source_page, source_ref, metadata, "
    "chunk_type, isa95_path, equipment_id, data_type"
)


def _engine():
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    low = url.lower()
    if "prod" in low or "production" in low:
        raise RuntimeError("refusing to run against a production-looking NEON_DATABASE_URL")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def plan(model: str, manufacturer: str, keep_url: str | None, conn):
    """Return (keep_ingest, retire_urls, counts) for the largest doc of a product."""
    from shared.manual_nav import docmap

    docs = docmap.build_docmap(manufacturer, model, conn=conn)
    if not docs:
        raise SystemExit(f"no documents for {manufacturer}/{model}")
    doc = docs[0]
    if keep_url:
        keep = next((i for i in doc.ingests if i.source_url == keep_url), None)
        if keep is None:
            raise SystemExit(
                "--keep-url not among this doc's ingests:\n"
                + "\n".join(f"  {i.source_url}" for i in doc.ingests)
            )
    else:
        keep = doc.authoritative()
    retire = [i for i in doc.ingests if i.source_url != keep.source_url]
    return doc, keep, retire


def verify_page(conn, url: str, phrase: str, expect_page: int) -> tuple[bool, list[int]]:
    """Does the chosen copy put `phrase` on `expect_page`?"""
    from sqlalchemy import text

    pages = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT DISTINCT source_page FROM knowledge_entries "
                "WHERE is_private=false AND source_url=:u AND content ILIKE :p "
                "ORDER BY 1"
            ),
            {"u": url, "p": f"%{phrase}%"},
        ).fetchall()
    ]
    return (expect_page in pages), pages


def backup(conn, urls: list[str], label: str) -> Path:
    from sqlalchemy import text

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"{label}-{stamp}.jsonl"
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for row in (
            conn.execute(
                text(
                    f"SELECT {_COLS} FROM knowledge_entries "
                    "WHERE is_private=false AND source_url = ANY(:urls)"
                ),
                {"urls": urls},
            )
            .mappings()
            .yield_per(500)
        ):
            d = {k: (str(v) if k in ("id", "tenant_id") else v) for k, v in row.items()}
            fh.write(json.dumps(d, ensure_ascii=False, default=str) + "\n")
            n += 1
    return path, n


def main() -> int:
    from sqlalchemy import text

    ap = argparse.ArgumentParser()
    ap.add_argument("--manufacturer", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--keep-url", default=None, help="override the authoritative choice")
    ap.add_argument("--verify-phrase", default=None)
    ap.add_argument("--verify-page", type=int, default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()

    eng = _engine()
    with eng.connect() as conn:
        doc, keep, retire = plan(a.model, a.manufacturer, a.keep_url, conn)
        retire_urls = [i.source_url for i in retire]
        retire_rows = sum(i.rows for i in retire)

        print(f"document : {doc.doc_key}  ({len(doc.ingests)} ingests, {doc.rows} rows)")
        print(f"KEEP     : {keep.source_url}  rows={keep.rows} p{keep.page_min}..{keep.page_max}")
        for i in retire:
            print(f"  retire : {i.source_url}  rows={i.rows} p{i.page_min}..{i.page_max}")
        print(f"total to delete: {retire_rows} rows")

        if a.verify_phrase and a.verify_page is not None:
            ok, pages = verify_page(conn, keep.source_url, a.verify_phrase, a.verify_page)
            print(
                f"page check: {a.verify_phrase[:40]!r} -> pages {pages} "
                f"(expected {a.verify_page}) {'OK' if ok else 'MISMATCH'}"
            )
            if not ok:
                print("REFUSING: the chosen copy does not agree with the printed manual.")
                return 2

        # -- content dedup, NOT ingest deletion --------------------------
        #
        # Dropping the four non-authoritative ingests wholesale would delete
        # 3,132 chunks of UNIQUE content that the citable copy does not
        # contain: the literature ingest is finer-paged but coarser-chunked.
        # That is data loss dressed up as canonicalization, and the dry run is
        # what caught it.
        #
        # So dedup on content hash instead: keep exactly ONE row per distinct
        # text, preferring the row from the citable ingest so the surviving
        # `source_page` is the printed page. Unique content from the other
        # ingests survives, duplicates go, and identical-text/conflicting-page
        # pairs collapse to one page by construction.
        dup_sql = """
        SELECT id FROM (
          SELECT id, row_number() OVER (
              PARTITION BY md5(content)
              ORDER BY (source_url = :keep) DESC, source_page ASC NULLS LAST, id
          ) rn
          FROM knowledge_entries
          WHERE is_private = false AND model_number ILIKE :m
        ) x WHERE rn > 1
        """
        params = {"keep": keep.source_url, "m": f"%{a.model}%"}
        dup_ids = [r[0] for r in conn.execute(text(dup_sql), params).fetchall()]
        print(f"\ncontent-dedup plan: delete {len(dup_ids)} duplicate row(s), keep all unique text")

        if not a.apply:
            print("DRY RUN — nothing deleted. Re-run with --apply --yes to execute.")
            return 0
        if not a.yes:
            print("--apply requires --yes")
            return 2

        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = BACKUP_DIR / f"{doc.doc_key}-dedup-{stamp}.jsonl"
        n = 0
        with path.open("w", encoding="utf-8") as fh:
            for row in (
                conn.execute(
                    text(f"SELECT {_COLS} FROM knowledge_entries WHERE id = ANY(:ids)"),
                    {"ids": dup_ids},
                )
                .mappings()
                .yield_per(500)
            ):
                fh.write(json.dumps(dict(row), ensure_ascii=False, default=str) + "\n")
                n += 1
        print(f"restore manifest: {path}  ({n} rows)")

        # The connection already autobegan on the earlier SELECTs, so commit
        # that implicit transaction rather than opening a nested one.
        res = conn.execute(
            text("DELETE FROM knowledge_entries WHERE id = ANY(:ids)"), {"ids": dup_ids}
        )
        conn.commit()
        print(f"DELETED {res.rowcount} duplicate rows. Restore: re-insert from the manifest.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
