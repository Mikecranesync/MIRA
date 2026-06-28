#!/usr/bin/env python3
"""Seed SimLab juice-bottling maintenance docs into ``knowledge_entries``.

Reads the 77 synthetic markdown fixtures under ``simlab/docs/<asset_id>/``,
chunks them for BM25 retrieval, and inserts UNS-tagged rows into
``knowledge_entries`` so the diagnostic engine can *cite* them during SimLab
juice-bottling scenarios. Closes #1835.

The docs are fully synthetic (Florida Natural Demo) — no proprietary customer
data. Every row is tagged ``source_system="simulator"`` / ``simulated=true`` in
``metadata`` (knowledge_entries has no dedicated columns for these), and carries
the canonical lowercase ltree UNS path in ``isa95_path``
(e.g. ``enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01``)
built by :func:`simlab.uns.asset_path` — never hand-formatted
(see ``.claude/rules/uns-compliance.md``).

Tenant
------
The SimLab demo is seeded under a fixed, well-known tenant UUID
:data:`SIMLAB_TENANT_ID`. ``knowledge_entries.tenant_id`` is **UUID** (verified
against dev Neon — the old ``-- Tenant: TEXT`` headers in sibling .sql seeds and
the apply-seeds.yml comment are stale).

Scope honesty: ingestion alone does NOT make scenarios cite at *runtime*. The
SimLab runner (``tests/simlab/runner.py``) currently binds no tenant, so it does
not yet query KB recall with this tenant_id. Wiring the runner to recall under
``SIMLAB_TENANT_ID`` is the documented next step (#1816 follow-up), one line at
the call site. This script only closes the ingestion half.

Usage — ALWAYS dev for local testing; NEVER prd from a code shell:
  doppler run --project factorylm --config dev -- \
    .venv/bin/python tools/seeds/seed-simlab-docs.py --dry-run
  doppler run --project factorylm --config dev -- \
    .venv/bin/python tools/seeds/seed-simlab-docs.py --commit
  doppler run --project factorylm --config dev -- \
    .venv/bin/python tools/seeds/seed-simlab-docs.py --verify

Idempotency
-----------
Every chunk carries a stable ``source_url`` + ``metadata.chunk_index``; the
INSERT uses ``ON CONFLICT`` against the partial unique index
``idx_ke_chunk_dedup`` ``(tenant_id, source_url, (metadata->>'chunk_index')::int)
WHERE metadata->>'chunk_index' IS NOT NULL`` → re-running is a no-op. Chunking is
deterministic, so chunk_index is stable on unchanged input. ``DO NOTHING`` means
a re-seed will NOT pick up *edits* to a doc (no duplicates, but no content
re-sync either) — bump the doc or clear the tenant to re-ingest changed text.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = REPO_ROOT / "simlab" / "docs"

# Make the top-level ``simlab`` package importable so we reuse the canonical
# UNS path builder + asset model instead of re-deriving either.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from simlab import SIMLAB_TENANT_ID  # noqa: E402 — single source of truth
from simlab.lines.juice_bottling import build_line  # noqa: E402
from simlab.uns import LINE, SITE, asset_path  # noqa: E402

# SIMLAB_TENANT_ID (the fixed Florida-Natural demo tenant) is defined once in
# simlab/__init__.py and imported here so the seed and the scenario runner can
# never drift to different tenants.

# filename stem (under simlab/docs/<asset>/) -> source_type label. Mirrors the
# existing source_type convention in sibling seeds (e.g. 'fault_code_table').
DOC_SOURCE_TYPE: dict[str, str] = {
    "operator_quick_guide": "operator_guide",
    "troubleshooting": "troubleshooting_guide",
    "fault_code_table": "fault_code_table",
    "pm_checklist": "pm_checklist",
    "plc_tag_description_sheet": "plc_tag_sheet",
    "spare_parts_notes": "spare_parts",
    "electrical_io_notes": "electrical_io",
}

MAX_CHUNK_CHARS = 1800  # soft cap; oversize H2 sections split on blank lines

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("simlab-seed")


def get_database_url() -> str:
    url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        log.error(
            "DATABASE_URL/NEON_DATABASE_URL not set. Run under doppler: "
            "`doppler run --project factorylm --config dev -- ...`"
        )
        sys.exit(2)
    return url


_H1_RE = re.compile(r"^#\s+(.*)$", re.MULTILINE)
_H2_SPLIT_RE = re.compile(r"^(##\s+.*)$", re.MULTILINE)
_H2_TITLE_RE = re.compile(r"^##\s+(.*)$")


def _soft_split(body: str, limit: int) -> list[str]:
    """Split an oversize section into <=limit-ish pieces on blank lines."""
    if len(body) <= limit:
        return [body]
    pieces: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for para in body.split("\n\n"):
        plen = len(para) + 2
        if cur and cur_len + plen > limit:
            pieces.append("\n\n".join(cur))
            cur, cur_len = [], 0
        cur.append(para)
        cur_len += plen
    if cur:
        pieces.append("\n\n".join(cur))
    return pieces


def chunk_markdown(text: str) -> list[tuple[str, str]]:
    """Chunk a markdown doc into (section_label, chunk_text) pairs.

    Splits on level-2 (``##``) headings; the H1 doc title is prepended to every
    chunk so each is self-describing for BM25 + citation. Oversize sections are
    soft-split on blank lines. Deterministic for a fixed input.
    """
    m = _H1_RE.search(text)
    title = m.group(1).strip() if m else ""
    title_prefix = f"# {title}\n\n" if title else ""

    parts = _H2_SPLIT_RE.split(text)
    # parts[0] = preamble (intro before first ##); then alternating header, body.
    chunks: list[tuple[str, str]] = []

    def _emit(label: str, raw: str) -> None:
        raw = raw.strip()
        if not raw:
            return
        for piece in _soft_split(raw, MAX_CHUNK_CHARS):
            chunks.append((label, f"{title_prefix}{piece}".strip()))

    preamble = parts[0]
    # Drop the bare H1 line from the preamble — it is re-added via title_prefix.
    if m:
        preamble = preamble.replace(m.group(0), "", 1)
    _emit("intro", preamble)

    for i in range(1, len(parts), 2):
        header = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        hm = _H2_TITLE_RE.match(header.strip())
        label = hm.group(1).strip() if hm else "section"
        _emit(label, f"{header}\n{body}")

    return chunks


def collect_rows() -> list[dict]:
    """Read every fixture, build one row dict per chunk. Pure (no DB)."""
    line = build_line()
    assets = {a.asset_id: a for a in line.all_assets()}

    rows: list[dict] = []
    missing_dirs: list[str] = []
    for asset_id, asset in assets.items():
        asset_dir = DOCS_ROOT / asset_id
        if not asset_dir.is_dir():
            missing_dirs.append(asset_id)
            continue
        uns_path = asset_path(asset_id)
        for md in sorted(asset_dir.glob("*.md")):
            stem = md.stem
            source_type = DOC_SOURCE_TYPE.get(stem, stem)
            doc_text = md.read_text(encoding="utf-8")
            chunks = chunk_markdown(doc_text)
            # Stable, simulator-provenance URL ending in the filename so the
            # citation surface (and the SimLab rubric, which string-matches doc
            # filenames) sees it.
            source_url = f"simlab://{SITE}/{LINE}/{asset_id}/{md.name}"
            for idx, (section, content) in enumerate(chunks):
                rows.append(
                    {
                        "tenant_id": SIMLAB_TENANT_ID,
                        "source_type": source_type,
                        "equipment_type": asset.asset_type,
                        "content": content,
                        "source_url": source_url,
                        "source_page": idx,
                        "source_ref": f"{asset.display_name} — {stem.replace('_', ' ')}",
                        "isa95_path": uns_path,
                        "equipment_id": asset_id,
                        "chunk_type": source_type,
                        "metadata": {
                            "source_system": "simulator",
                            "simulated": True,
                            "simlab": True,
                            "site_id": SITE,
                            "line_id": LINE,
                            "asset_id": asset_id,
                            "asset_type": asset.asset_type,
                            "asset_display_name": asset.display_name,
                            "doc_type": source_type,
                            "doc_title": stem,
                            "source_file": md.name,
                            "uns_path": uns_path,
                            "section": section,
                            "chunk_index": idx,
                            "chunk_count": len(chunks),
                        },
                    }
                )
        log.info(
            "  %-16s %2d chunks across %d docs",
            asset_id,
            sum(1 for r in rows if r["equipment_id"] == asset_id),
            len(list(asset_dir.glob("*.md"))),
        )
    if missing_dirs:
        log.warning("No docs dir for assets: %s", ", ".join(missing_dirs))
    return rows


_INSERT_SQL = """
INSERT INTO knowledge_entries (
    tenant_id, source_type, equipment_type, content,
    source_url, source_page, source_ref, isa95_path, equipment_id,
    chunk_type, data_type, input_type, is_private, verified, metadata
) VALUES (
    %(tenant_id)s, %(source_type)s, %(equipment_type)s, %(content)s,
    %(source_url)s, %(source_page)s, %(source_ref)s, %(isa95_path)s, %(equipment_id)s,
    %(chunk_type)s, 'manual', 'text', true, true, %(metadata)s
)
ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
    WHERE (metadata->>'chunk_index') IS NOT NULL
DO NOTHING
"""


_ENSURE_TENANT_SQL = """
INSERT INTO tenants (id, name, contact_email, subscription_tier, subscription_status)
VALUES (%s, %s, %s, 'internal', 'active')
ON CONFLICT (id) DO NOTHING
"""


def ensure_tenant(cur) -> None:
    """knowledge_entries.tenant_id FKs to tenants(id) — the SimLab demo tenant
    must exist first. Idempotent."""
    cur.execute(
        _ENSURE_TENANT_SQL,
        (
            SIMLAB_TENANT_ID,
            "SimLab — Florida Natural Juice Bottling Demo",
            "simlab@factorylm.local",
        ),
    )


def _count(cur) -> int:
    cur.execute(
        "SELECT count(*) FROM knowledge_entries WHERE tenant_id = %s "
        "AND metadata->>'source_system' = 'simulator'",
        (SIMLAB_TENANT_ID,),
    )
    return cur.fetchone()[0]


def run_seed(commit: bool) -> None:
    rows = collect_rows()
    log.info("Built %d chunk rows from %s", len(rows), DOCS_ROOT)
    params = [{**r, "metadata": Jsonb(r["metadata"])} for r in rows]

    with psycopg.connect(get_database_url(), autocommit=False) as conn:
        with conn.cursor() as cur:
            ensure_tenant(cur)
            before = _count(cur)
            cur.executemany(_INSERT_SQL, params)
            after = _count(cur)
            inserted = after - before
            log.info(
                "rows before=%d  after=%d  inserted=%d  skipped(existing)=%d",
                before,
                after,
                inserted,
                len(rows) - inserted,
            )
        if commit:
            conn.commit()
            log.info("✔ Committed %d new chunk(s) under tenant %s.", inserted, SIMLAB_TENANT_ID)
        else:
            conn.rollback()
            log.info("✔ Validated (dry-run, rolled back). Would insert %d new chunk(s).", inserted)


# Canned retrievability probes. Each: (free-text query, expected asset).
#
# These prove the seed is *citable* via the same OR-fanout BM25 semantics the
# engine uses (mira-bots/shared/neon_recall.py::_recall_bm25) — not just present.
# The PASS bar is "expected asset is in the top-K candidate set", NOT "ranks #1":
# _recall_bm25 is tenant-WIDE (no isa95_path/asset scoping), so for a generic
# question the densest-vocabulary sibling can outrank the target (filler & rinser
# both say "nozzle/pressure"; depalletizer & casepacker both "jam/pick"). At
# runtime the engine disambiguates via the SimLab direct-connection asset_id +
# RRF fusion over vector/BM25/like — wiring that asset scope into the runner is
# the #1816 follow-up, not this ingestion PR. Top-K membership is the right,
# honest bar here: the doc IS in the set the engine cites from.
_PROBE_TOPK = 5
_PROBES: list[tuple[str, str]] = [
    ("filler underfill low bowl pressure nozzle clogged", "filler01"),
    ("capper missing cap low torque application", "capper01"),
    ("rinser bottle spray water rinse nozzle pressure", "rinser01"),
    ("depalletizer layer pick vacuum cup jam", "depalletizer01"),
    ("CIP skid caustic concentration wash cycle temperature", "cipskid01"),
    ("labeler label placement glue applicator", "labeler01"),
    ("palletizer pallet layer pattern infeed", "palletizer01"),
]


def _bm25(cur, query_text: str, limit: int = 5) -> list[tuple[str, str, float]]:
    """Replicate _recall_bm25's OR-fanout query (tenant-scoped) — thin, no engine
    import. tokens -> 't1 | t2 | ...' -> to_tsquery('english', ...)."""
    tokens = re.findall(r"\w+", query_text)
    tsq = " | ".join(tokens)
    cur.execute(
        "SELECT source_url, metadata->>'asset_id' AS asset, "
        "       ts_rank_cd(content_tsv, to_tsquery('english', %s)) AS sim "
        "FROM knowledge_entries "
        "WHERE tenant_id = %s "
        "  AND content_tsv @@ to_tsquery('english', %s) "
        "ORDER BY sim DESC LIMIT %s",
        (tsq, SIMLAB_TENANT_ID, tsq, limit),
    )
    return [(r[0], r[1], float(r[2])) for r in cur.fetchall()]


def verify() -> int:
    """Read-only: row counts + a real BM25 retrievability proof per probe."""
    failures = 0
    with psycopg.connect(get_database_url(), autocommit=True) as conn, conn.cursor() as cur:
        total = _count(cur)
        log.info("knowledge_entries simulator rows for tenant %s: %d", SIMLAB_TENANT_ID, total)
        if total == 0:
            log.error("✗ No SimLab rows present — run --commit first.")
            return 1

        # Completeness: every source .md file on disk must have produced >=1 row.
        # The per-asset chunk log counts globbed files, not files-that-yielded-
        # rows, so a silently-empty fixture would otherwise go unnoticed.
        disk_files = sorted(p for p in DOCS_ROOT.glob("*/*.md"))
        cur.execute(
            "SELECT count(DISTINCT source_url) FROM knowledge_entries WHERE tenant_id = %s",
            (SIMLAB_TENANT_ID,),
        )
        distinct_urls = cur.fetchone()[0]
        complete = distinct_urls == len(disk_files)
        log.info(
            "  %s completeness: %d distinct source_url rows vs %d .md files on disk",
            "✔" if complete else "✗",
            distinct_urls,
            len(disk_files),
        )
        if not complete:
            failures += 1

        cur.execute(
            "SELECT metadata->>'asset_id' AS asset, count(*) "
            "FROM knowledge_entries WHERE tenant_id = %s "
            "AND metadata->>'source_system' = 'simulator' "
            "GROUP BY 1 ORDER BY 1",
            (SIMLAB_TENANT_ID,),
        )
        for asset, n in cur.fetchall():
            log.info("  %-16s %3d chunks", asset, n)

        log.info("BM25 retrievability probes (engine-path semantics, top-%d):", _PROBE_TOPK)
        for query, expected in _PROBES:
            hits = _bm25(cur, query, limit=_PROBE_TOPK)
            assets = [h[1] for h in hits]
            in_topk = expected in assets
            failures += 0 if in_topk else 1
            mark = "✔" if in_topk else "✗"
            rank = assets.index(expected) + 1 if in_topk else None
            log.info(
                "  %s '%s' -> %s in top-%d (rank %s, top1=%s) [%d hits]",
                mark,
                query,
                expected,
                _PROBE_TOPK,
                rank,
                assets[0] if assets else None,
                len(hits),
            )
    if failures:
        log.error(
            "✗ %d/%d probes did not surface the expected asset in top-%d — docs may not be citable.",
            failures,
            len(_PROBES),
            _PROBE_TOPK,
        )
        return 1
    log.info(
        "✔ All %d retrievability probes surfaced the expected asset — docs are citable.",
        len(_PROBES),
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="Apply in a transaction, then rollback.")
    g.add_argument("--commit", action="store_true", help="Apply and commit.")
    g.add_argument(
        "--verify", action="store_true", help="Read-only: counts + BM25 retrievability proof."
    )
    args = ap.parse_args()

    if not DOCS_ROOT.is_dir():
        log.error(
            "SimLab docs dir missing: %s (run on a branch with PR #1816's simlab/docs/)", DOCS_ROOT
        )
        return 2

    if args.verify:
        return verify()
    run_seed(commit=args.commit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
