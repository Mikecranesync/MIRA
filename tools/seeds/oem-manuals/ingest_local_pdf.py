"""Ingest a local OEM-manual PDF into the shared KB corpus.

Extracts text per page (pdfplumber), chunks it (mira-crawler chunker, ≤2000 tok),
embeds each chunk via Ollama nomic-embed-text (768-dim), and inserts into
`knowledge_entries` as SHARED corpus (`is_private = false`, system tenant) so it
is citable by every tenant. Idempotent: dedupes by `metadata.chunk_key`.

Run from a node that can reach the target NeonDB AND an Ollama with
nomic-embed-text (e.g. Charlie: localhost Ollama). NEON_DATABASE_URL injected
from the dev box's Doppler over SSH stdin (doppler isn't on Charlie's PATH):

    doppler secrets get NEON_DATABASE_URL -c stg --plain --project factorylm | \
      ssh charlienode@100.70.49.126 'bash -lc "read -r NEON; cd ~/MIRA && \
        NEON_DATABASE_URL=\"$NEON\" python3 tools/seeds/oem-manuals/ingest_local_pdf.py \
          --pdf <path> --manufacturer <mfr> --model <model> --ollama-url http://127.0.0.1:11434 [--dry-run]"'

Staging first, verify with verify_seed.py-style retrieval, then prod (explicit OK).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import uuid
from pathlib import Path

import httpx
import pdfplumber
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mira-crawler"))
from ingest.chunker import chunk_blocks  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("ingest-local-pdf")

DEFAULT_TENANT = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
DEFAULT_OLLAMA = "http://127.0.0.1:11434"
EMBED_MODEL = "nomic-embed-text"
EMBED_DIM = 768
MAX_PAGES = int(os.getenv("MAX_PDF_PAGES", "1200"))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def neon_engine():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise SystemExit("NEON_DATABASE_URL not set")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def embed_one(client: httpx.Client, base_url: str, body: str) -> list[float]:
    resp = client.post(
        f"{base_url}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": body},
        timeout=60,
    )
    resp.raise_for_status()
    vec = resp.json()["embedding"]
    if len(vec) != EMBED_DIM:
        raise ValueError(f"embedding dim {len(vec)} != {EMBED_DIM}")
    return vec


def extract_blocks(pdf_path: Path) -> list[dict]:
    """pdfplumber extraction (fallback). Noisy on table/TOC-heavy manuals."""
    blocks: list[dict] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        n = min(len(pdf.pages), MAX_PAGES)
        log.info("extracting %d pages from %s (pdfplumber)", n, pdf_path.name)
        for i in range(n):
            try:
                txt = pdf.pages[i].extract_text() or ""
            except Exception as e:  # noqa: BLE001
                log.warning("  page %d extract failed: %s", i + 1, e)
                continue
            txt = txt.strip()
            if len(txt) >= 40:
                blocks.append({"text": txt, "page_num": i + 1, "section": ""})
    log.info("  %d non-empty page-blocks", len(blocks))
    return blocks


def extract_blocks_docling(pdf_path: Path) -> list[dict]:
    """docling extraction (preferred): layout-aware, TableFormer→Markdown, OCR.

    Reuses the sanctioned mira-core DoclingAdapter — same {text,page_num,section}
    schema as the pdfplumber path.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mira-core" / "scripts"))
    from docling_adapter import DoclingAdapter  # noqa: E402

    log.info("extracting %s (docling — first call lazy-loads ~1.2GB models)", pdf_path.name)
    adapter = DoclingAdapter(max_pages=MAX_PAGES)
    blocks = adapter.extract_from_pdf(pdf_path.read_bytes())
    log.info("  %d docling blocks", len(blocks))
    return blocks


# Quality gate — drop extraction-noise chunks (applies to BOTH extractors)
_TRIPLE_CHAR = re.compile(r"([A-Za-z])\1\1")


def _is_noise(body: str) -> str | None:
    """Return a reason string if the chunk is extraction noise, else None."""
    if not body or len(body.strip()) < 80:
        return "too_short"
    total = len(body)
    alnum = sum(c.isalnum() for c in body)
    space = sum(c.isspace() for c in body)
    if total and alnum / total < 0.55:
        return "low_alnum_ratio"  # dot-leaders, � runs, box chars
    # repeated-char OCR artifact (CCChhh…) — count triples
    if len(_TRIPLE_CHAR.findall(body)) >= 5:
        return "repeated_char_artifact"
    words = [w for w in re.split(r"\s+", body) if len(w) >= 3 and any(ch.isalpha() for ch in w)]
    if len(words) < 12:
        return "low_word_density"
    if space and (total - space) / max(space, 1) > 40:
        return "almost_no_spaces"
    return None


def quality_gate(chunks: list[dict]) -> tuple[list[dict], dict]:
    kept, dropped = [], {}
    for ch in chunks:
        reason = _is_noise(ch.get("text", ""))
        if reason:
            dropped[reason] = dropped.get(reason, 0) + 1
        else:
            kept.append(ch)
    return kept, dropped


def chunk_exists(eng, tenant_id: str, chunk_key: str) -> bool:
    with eng.connect() as c:
        row = c.execute(
            text(
                "SELECT 1 FROM knowledge_entries "
                "WHERE tenant_id = :t AND metadata->>'chunk_key' = :k LIMIT 1"
            ),
            {"t": tenant_id, "k": chunk_key},
        ).fetchone()
    return row is not None


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest a local OEM PDF into shared KB corpus")
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--manufacturer", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--source-url", default="", help="optional canonical URL for citation")
    ap.add_argument("--tenant-id", default=os.environ.get("MIRA_TENANT_ID", DEFAULT_TENANT))
    ap.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA))
    ap.add_argument(
        "--use-docling",
        action="store_true",
        help="use docling layout-aware extraction (preferred); falls back to pdfplumber",
    )
    ap.add_argument(
        "--no-quality-gate",
        action="store_true",
        help="disable the extraction-noise filter (debug only)",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise SystemExit(f"pdf not found: {pdf_path}")

    stem = slug(pdf_path.stem)
    mdl = slug(args.model)
    if args.use_docling:
        try:
            blocks = extract_blocks_docling(pdf_path)
        except Exception as e:  # noqa: BLE001
            log.error("docling extraction failed (%s) — falling back to pdfplumber", e)
            blocks = extract_blocks(pdf_path)
    else:
        blocks = extract_blocks(pdf_path)
    chunks = chunk_blocks(
        blocks,
        source_url=args.source_url or pdf_path.name,
        source_file=pdf_path.name,
        source_type="oem_manual",
        equipment_id=args.model,
    )
    log.info("chunked → %d chunks  (mfr=%s model=%s)", len(chunks), args.manufacturer, args.model)
    if not args.no_quality_gate:
        chunks, dropped = quality_gate(chunks)
        log.info("quality gate → %d kept, dropped %s", len(chunks), dropped or "none")
    if not chunks:
        log.error("no chunks produced — is this a scanned/image-only PDF? (needs OCR)")
        return 3

    if not args.dry_run:
        try:
            httpx.get(f"{args.ollama_url}/api/tags", timeout=5).raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.error("Ollama unreachable at %s: %s", args.ollama_url, e)
            return 2

    eng = neon_engine()
    inserted = skipped = 0
    with httpx.Client() as client:
        for ch in chunks:
            body = ch["text"]
            key = f"{mdl}-{stem}-p{ch.get('page_num')}-c{ch['chunk_index']}"
            if chunk_exists(eng, args.tenant_id, key):
                skipped += 1
                continue
            if args.dry_run:
                inserted += 1
                if inserted <= 3:
                    log.info("  [DRY] would insert %s len=%d", key, len(body))
                continue
            try:
                vec = embed_one(client, args.ollama_url, body)
            except Exception as e:  # noqa: BLE001
                log.error("  embed failed %s: %s", key, e)
                skipped += 1
                continue
            meta = {
                "chunk_key": key,
                "source_file": pdf_path.name,
                "chunk_index": ch["chunk_index"],
                "chunk_quality": ch.get("chunk_quality"),
            }
            with eng.connect() as c:
                c.execute(
                    text(
                        """
                        INSERT INTO knowledge_entries
                          (id, tenant_id, source_type, manufacturer, model_number,
                           content, embedding, source_url, source_page, metadata,
                           is_private, verified, chunk_type, created_at)
                        VALUES
                          (:id, :tid, :src, :mfr, :mdl, :content, cast(:emb AS vector),
                           :url, :page, cast(:meta AS jsonb), false, true, :ctype, NOW())
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tid": args.tenant_id,
                        "src": "oem_manual",
                        "mfr": args.manufacturer,
                        "mdl": args.model,
                        "content": body,
                        "emb": str(vec),
                        "url": args.source_url or pdf_path.name,
                        "page": ch.get("page_num"),
                        "meta": json.dumps(meta),
                        "ctype": ch.get("chunk_type", "manual_text"),
                    },
                )
                c.commit()
            inserted += 1
            if inserted % 25 == 0:
                log.info("  …%d inserted", inserted)

    log.info("DONE. inserted=%d skipped=%d total_chunks=%d", inserted, skipped, len(chunks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
