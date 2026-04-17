"""Standalone vendor KB coverage filler — ship-blocker #3.

Runs outside the containerized ingest service. Uses:
  - Apify API directly (APIFY_API_KEY from env)
  - nomic-embed-text on Bravo LAN (OLLAMA_URL from env, default http://192.168.1.11:11434)
  - NeonDB directly (NEON_DATABASE_URL from env)

Usage:
    doppler run --project factorylm --config prd -- \
        python3 tools/vendor_coverage_ingest.py [--dry-run] [--vendors "Pilz,Mitsubishi"]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("vendor-coverage")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = "nomic-embed-text:latest"
APIFY_API_KEY = os.getenv("APIFY_API_KEY", "")
NEON_DATABASE_URL = os.getenv("NEON_DATABASE_URL", "")
SHARED_TENANT_ID = os.getenv("MIRA_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3")

APIFY_ACTOR = "apify~website-content-crawler"
APIFY_BASE = "https://api.apify.com/v2"

# Minimum content length to be considered substantive (not a listing page)
MIN_CHUNK_CHARS = 400
# Per-page content length threshold — below this = listing/nav page, skip
MIN_PAGE_CHARS = 1200
# Max tokens per chunk (nomic-embed-text context = 8192 tokens)
MAX_CHUNK_CHARS = 6000
# Max pages to ingest per vendor (Apify free tier memory guard)
MAX_PAGES_PER_VENDOR = 30
# Apify poll interval seconds
POLL_INTERVAL = 30
# Apify max wait seconds per job
MAX_WAIT = 360


@dataclass
class VendorTarget:
    name: str
    manufacturer_normalized: str  # value written to NeonDB manufacturer field
    models: list[str]             # representative models to test/ingest
    doc_url: str                  # Apify start URL
    crawl_type: str = "playwright:chrome"
    min_chunks_required: int = 5
    current_chunks: int = 0
    post_chunks: int = 0
    outcome: str = "PENDING"
    notes: str = ""
    apify_run_id: str = ""
    pages_ingested: int = 0


# Priority order: most critical for demo first
VENDORS: list[VendorTarget] = [
    VendorTarget(
        name="Pilz",
        manufacturer_normalized="Pilz",
        models=["PNOZ X3", "PNOZ X4", "PSEN 1.1"],
        doc_url="https://www.pilz.com/en-US/support/downloads",
    ),
    VendorTarget(
        name="Mitsubishi",
        manufacturer_normalized="Mitsubishi Electric",
        models=["FR-E720", "FR-D720", "FR-A720", "FX3U"],
        doc_url="https://www.mitsubishielectric.com/fa/products/drv/inv/",
    ),
    VendorTarget(
        name="Omron",
        manufacturer_normalized="Omron",
        models=["MX2", "CJ1M", "CP1E"],
        doc_url="https://www.fa.omron.com/support/technical-info/",
    ),
    VendorTarget(
        name="Danfoss",
        manufacturer_normalized="Danfoss",
        models=["VLT FC302", "VLT FC301", "VLT Micro FC 51"],
        doc_url="https://www.danfoss.com/en/service-and-support/downloads/dds/vlt-drives/",
    ),
    VendorTarget(
        name="Yaskawa",
        manufacturer_normalized="Yaskawa Electric",
        models=["V1000", "J1000", "A1000", "GA500"],
        doc_url="https://www.yaskawa.com/products/drives/ac-micro-drives/v1000",
        # Existing 16 chunks are Traverse software supplement front-matter only;
        # no fault codes or standard parameters — force crawl for real content.
        min_chunks_required=50,
    ),
    VendorTarget(
        name="ABB",
        manufacturer_normalized="ABB",
        models=["ACS310", "ACS355", "ACS580"],
        doc_url="https://new.abb.com/drives/low-voltage-ac-drives",
        # Existing 24 chunks are generic VFD reference (no model_number set) —
        # crawl for model-specific ACS series content.
        min_chunks_required=50,
    ),
]

# Pre-coverage from NeonDB audit (2026-04-15)
PRE_COVERAGE: dict[str, int] = {
    "AutomationDirect": 1440,
    "Allen-Bradley": 1311,
    "Siemens": 202,
    "Schneider": 246,
    "ABB": 24,
    "Yaskawa": 16,
    "Mitsubishi": 0,
    "Danfoss": 0,
    "Pilz": 0,
    "Omron": 0,
}


# ---------------------------------------------------------------------------
# NeonDB helpers
# ---------------------------------------------------------------------------

def _neon_engine():
    if not NEON_DATABASE_URL:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        NEON_DATABASE_URL,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def count_vendor_chunks(vendor_name: str) -> int:
    """Count substantive chunks (>500 chars) attributed to this vendor."""
    engine = _neon_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT COUNT(*) FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND manufacturer ILIKE :pat
                  AND LENGTH(content) > 500
            """),
            {"tid": SHARED_TENANT_ID, "pat": f"%{vendor_name}%"},
        ).fetchone()
    return row[0] if row else 0


def entry_exists(content_prefix: str) -> bool:
    """Deduplication: check if first 200 chars already in NeonDB."""
    engine = _neon_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT 1 FROM knowledge_entries
                WHERE tenant_id = :tid AND LEFT(content, 200) = :prefix
                LIMIT 1
            """),
            {"tid": SHARED_TENANT_ID, "prefix": content_prefix[:200]},
        ).fetchone()
    return row is not None


def insert_chunk(
    content: str,
    embedding: list[float],
    manufacturer: str,
    model_number: str,
    source_url: str,
    source_type: str = "equipment_manual",
) -> bool:
    """Insert a single knowledge chunk. Returns True on success."""
    if entry_exists(content):
        return False
    engine = _neon_engine()
    with engine.connect() as conn:
        conn.execute(
            text("""
                INSERT INTO knowledge_entries
                  (id, tenant_id, source_type, manufacturer, model_number,
                   content, embedding, is_private, source_url, chunk_type, created_at)
                VALUES
                  (:id, :tid, :src, :mfr, :model,
                   :content, cast(:emb AS vector), false, :url, 'manual_text', NOW())
            """),
            {
                "id": str(uuid.uuid4()),
                "tid": SHARED_TENANT_ID,
                "src": source_type,
                "mfr": manufacturer,
                "model": model_number,
                "content": content,
                "emb": str(embedding),
                "url": source_url,
            },
        )
        conn.commit()
    return True


# ---------------------------------------------------------------------------
# Embedding via Ollama on Bravo
# ---------------------------------------------------------------------------

def embed_text(text_content: str) -> list[float] | None:
    """Embed text via nomic-embed-text on Bravo. Returns None on failure."""
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text_content},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
    except Exception as exc:
        logger.warning("Embed failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Chunker (simplified — respects MAX_CHUNK_CHARS, sentence boundaries)
# ---------------------------------------------------------------------------

_SENTENCE_END_RE = re.compile(r"[.?!]\s")


def _sentence_split(text: str, max_chars: int) -> list[str]:
    """Split text into chunks of up to max_chars, breaking at sentence ends."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + max_chars
        if end >= len(text):
            chunk = text[start:].strip()
            if chunk:
                chunks.append(chunk)
            break
        # Walk back to find sentence boundary
        boundary = None
        for m in reversed(list(_SENTENCE_END_RE.finditer(text[start:end]))):
            candidate = start + m.end()
            if candidate > start + MIN_CHUNK_CHARS:
                boundary = candidate
                break
        if boundary:
            chunk = text[start:boundary].strip()
        else:
            chunk = text[start:end].strip()
            boundary = end
        if chunk:
            chunks.append(chunk)
        start = boundary
    return chunks


def chunk_page_content(raw_text: str, url: str = "") -> list[str]:
    """Split a page's raw text into ingest-ready chunks.

    Filters pages that look like navigation/listing pages (too short).
    Returns list of chunk strings.
    """
    text = raw_text.strip()
    if len(text) < MIN_PAGE_CHARS:
        logger.debug("Skipping short page (%d chars): %s", len(text), url[:60])
        return []
    return [c for c in _sentence_split(text, MAX_CHUNK_CHARS) if len(c) >= MIN_CHUNK_CHARS]


# ---------------------------------------------------------------------------
# Apify helpers
# ---------------------------------------------------------------------------

def apify_run_crawl(start_url: str, job_label: str) -> str | None:
    """Start an Apify website-content-crawler job. Returns run ID or None."""
    payload = {
        "startUrls": [{"url": start_url}],
        "crawlerType": "playwright:chrome",
        "maxCrawlPages": MAX_PAGES_PER_VENDOR,
        "maxCrawlDepth": 2,
        "outputFormats": ["markdown"],
        "removeCookieWarnings": True,
    }
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{APIFY_BASE}/acts/{APIFY_ACTOR}/runs",
                params={"token": APIFY_API_KEY},
                json=payload,
            )
            resp.raise_for_status()
            run_id = resp.json()["data"]["id"]
            logger.info("[%s] Apify run started: %s", job_label, run_id)
            return run_id
    except Exception as exc:
        logger.error("[%s] Apify start failed: %s", job_label, exc)
        return None


def apify_wait_for_run(run_id: str, label: str) -> str:
    """Poll until run finishes. Returns final status string."""
    deadline = time.time() + MAX_WAIT
    with httpx.Client(timeout=30) as client:
        while time.time() < deadline:
            try:
                resp = client.get(
                    f"{APIFY_BASE}/actor-runs/{run_id}",
                    params={"token": APIFY_API_KEY},
                )
                resp.raise_for_status()
                data = resp.json()["data"]
                status = data.get("status", "")
                if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                    logger.info("[%s] Run %s finished: %s", label, run_id, status)
                    return status
                logger.info("[%s] Run %s: %s — waiting %ds...", label, run_id, status, POLL_INTERVAL)
            except Exception as exc:
                logger.warning("[%s] Poll error: %s", label, exc)
            time.sleep(POLL_INTERVAL)
    logger.warning("[%s] Run %s timed out after %ds", label, run_id, MAX_WAIT)
    return "TIMED-OUT"


def apify_get_dataset_items(run_id: str, label: str) -> list[dict]:
    """Fetch dataset items from a completed run."""
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.get(
                f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items",
                params={"token": APIFY_API_KEY, "limit": MAX_PAGES_PER_VENDOR, "format": "json"},
            )
            resp.raise_for_status()
            items = resp.json()
            logger.info("[%s] Dataset has %d items", label, len(items))
            return items
    except Exception as exc:
        logger.error("[%s] Dataset fetch failed: %s", label, exc)
        return []


def classify_run_quality(items: list[dict]) -> tuple[str, float]:
    """Classify crawl quality: SUCCESS / LOW_QUALITY / EMPTY.

    Returns (outcome_code, avg_content_length).
    Per crawl_verifier.py threshold: avg_content_length < 4000 = LOW_QUALITY.
    """
    if not items:
        return "EMPTY", 0.0
    lengths = [len(item.get("markdown", item.get("text", "")) or "") for item in items]
    avg = sum(lengths) / len(lengths)
    if avg < 4000:
        return "LOW_QUALITY", avg
    return "SUCCESS", avg


# ---------------------------------------------------------------------------
# Per-vendor ingest
# ---------------------------------------------------------------------------

def ingest_vendor(vendor: VendorTarget, dry_run: bool = False) -> None:
    """Full pipeline for one vendor: crawl → chunk → embed → NeonDB."""
    label = vendor.name

    # Pre-check
    vendor.current_chunks = count_vendor_chunks(vendor.manufacturer_normalized)
    logger.info(
        "[%s] Pre-coverage: %d substantive chunks. Threshold: %d",
        label, vendor.current_chunks, vendor.min_chunks_required
    )

    if vendor.current_chunks >= vendor.min_chunks_required:
        vendor.outcome = "READY_SKIP"
        vendor.notes = f"Already has {vendor.current_chunks} chunks — skipping crawl"
        logger.info("[%s] Already covered — skipping", label)
        return

    if dry_run:
        vendor.outcome = "DRY_RUN"
        vendor.notes = f"Would crawl {vendor.doc_url}"
        return

    # Trigger Apify
    run_id = apify_run_crawl(vendor.doc_url, label)
    if not run_id:
        vendor.outcome = "APIFY_ERROR"
        vendor.notes = "Failed to start Apify run"
        return
    vendor.apify_run_id = run_id

    # Wait
    final_status = apify_wait_for_run(run_id, label)
    if final_status != "SUCCEEDED":
        vendor.outcome = f"APIFY_{final_status}"
        vendor.notes = f"Apify run {run_id} ended with {final_status}"
        return

    # Fetch pages
    items = apify_get_dataset_items(run_id, label)
    quality, avg_len = classify_run_quality(items)
    logger.info("[%s] Quality: %s (avg_content_len=%.0f)", label, quality, avg_len)

    if quality == "EMPTY":
        vendor.outcome = "EMPTY"
        vendor.notes = "No pages returned by Apify"
        return

    if quality == "LOW_QUALITY":
        vendor.notes = f"LOW_QUALITY crawl (avg_page_len={avg_len:.0f}) — listing pages likely. Ingesting what we got."

    # Chunk + embed + write
    written = 0
    skipped_short = 0
    skipped_dup = 0
    embed_failures = 0

    for item in items:
        raw = item.get("markdown") or item.get("text") or ""
        url = item.get("url", "")
        # Detect model from URL or title if possible
        model_number = ""
        title = item.get("title", "") or ""
        for m in vendor.models:
            if m.lower() in raw.lower() or m.lower() in title.lower() or m.lower() in url.lower():
                model_number = m
                break

        chunks = chunk_page_content(raw, url)
        if not chunks:
            skipped_short += 1
            continue

        for chunk in chunks:
            embedding = embed_text(chunk)
            if embedding is None:
                embed_failures += 1
                continue
            if insert_chunk(
                content=chunk,
                embedding=embedding,
                manufacturer=vendor.manufacturer_normalized,
                model_number=model_number,
                source_url=url,
            ):
                written += 1
            else:
                skipped_dup += 1

    logger.info(
        "[%s] Ingest complete: written=%d, skipped_short=%d, skipped_dup=%d, embed_fail=%d",
        label, written, skipped_short, skipped_dup, embed_failures
    )
    vendor.pages_ingested = written

    # Post-check
    vendor.post_chunks = count_vendor_chunks(vendor.manufacturer_normalized)
    if vendor.post_chunks >= vendor.min_chunks_required:
        vendor.outcome = "READY"
        if not vendor.notes:
            vendor.notes = f"Crawled {len(items)} pages, wrote {written} chunks"
    else:
        vendor.outcome = "INSUFFICIENT"
        vendor.notes = (
            f"Crawled {len(items)} pages, wrote {written} chunks. "
            f"Post-coverage={vendor.post_chunks} < threshold={vendor.min_chunks_required}. "
            f"Quality={quality}, avg_page_len={avg_len:.0f}."
        )


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

REPORT_PATH = "docs/v1/vendor-coverage-2026-04-15.md"

OUTCOME_ICON = {
    "READY": "✓ READY",
    "READY_SKIP": "✓ READY",
    "INSUFFICIENT": "✗ NEEDS WORK",
    "APIFY_ERROR": "✗ NEEDS WORK",
    "APIFY_FAILED": "✗ NEEDS WORK",
    "APIFY_TIMED-OUT": "⚠ APIFY-LIMITED",
    "APIFY_ABORTED": "⚠ APIFY-LIMITED",
    "EMPTY": "✗ NEEDS WORK",
    "LOW_QUALITY_PARTIAL": "⚠ APIFY-LIMITED",
    "DRY_RUN": "? DRY-RUN",
    "PENDING": "? PENDING",
}

ALWAYS_READY = [
    ("AutomationDirect", "GS20, GS10, GS1", 1440, "✓ READY", "3 models indexed; GS20 demo target confirmed"),
    ("Allen-Bradley",    "PowerFlex 753, PF525", 1311, "✓ READY", "PowerFlex 753 model indexed; 1311 substantive chunks"),
    ("Siemens",          "SINAMICS G120, G120C", 202, "✓ READY", "202 chunks; model_number field blank but content attributed"),
    ("Schneider",        "Altivar ATV312, ATV71", 246, "✓ READY", "246 substantive chunks; manufacturer='schneider'"),
]


def write_report(vendors: list[VendorTarget], dry_run: bool) -> None:
    lines = [
        "# Vendor KB Coverage — v1 Demo Ship-Blocker #3",
        "",
        f"**Date:** 2026-04-15  ",
        f"**Tenant:** {SHARED_TENANT_ID}  ",
        f"**Total KB entries (pre-run):** 61,644  ",
        f"**Dry-run:** {'YES' if dry_run else 'NO'}",
        "",
        "## Coverage Matrix",
        "",
        "| Vendor | Models tested | Pre-coverage | Post-coverage | Outcome | Notes |",
        "|--------|--------------|--------------|---------------|---------|-------|",
    ]

    # Always-ready vendors
    for name, models, pre, outcome, notes in ALWAYS_READY:
        lines.append(f"| {name} | {models} | {pre} chunks | {pre} chunks (no crawl) | {outcome} | {notes} |")

    # Crawled vendors
    for v in vendors:
        pre = v.current_chunks
        post = v.post_chunks if v.post_chunks else pre
        icon = OUTCOME_ICON.get(v.outcome, f"? {v.outcome}")
        run_note = f"run={v.apify_run_id}" if v.apify_run_id else ""
        note = f"{v.notes} {run_note}".strip()
        lines.append(f"| {v.name} | {', '.join(v.models[:2])} | {pre} | {post} | {icon} | {note} |")

    lines += [
        "",
        "## Vendor Summary",
        "",
    ]

    all_vendors = [(n, o) for n, _, _, o, _ in ALWAYS_READY]
    for v in vendors:
        icon = OUTCOME_ICON.get(v.outcome, f"? {v.outcome}")
        all_vendors.append((v.name, icon))

    for name, icon in all_vendors:
        lines.append(f"- **{name}**: {icon}")

    lines += [
        "",
        "## Action Items for Mike",
        "",
    ]

    needs_action = [v for v in vendors if v.outcome not in ("READY", "READY_SKIP", "DRY_RUN")]
    if needs_action:
        lines.append("The following vendors need manual intervention:")
        lines.append("")
        for v in needs_action:
            lines.append(f"### {v.name}")
            lines.append(f"- **Status**: {v.outcome}")
            lines.append(f"- **Models needed**: {', '.join(v.models)}")
            lines.append(f"- **Doc URL**: {v.doc_url}")
            lines.append(f"- **Notes**: {v.notes}")
            lines.append("")
            lines.append("**To trigger manually on VPS:**")
            lines.append("```bash")
            lines.append(
                f'curl -X POST http://localhost:8002/ingest/scrape-trigger \\\n'
                f'  -H "Content-Type: application/json" \\\n'
                f'  -d \'{{"equipment_id": "{v.name} {v.models[0]}", "manufacturer": "{v.manufacturer_normalized}", '
                f'"model": "{v.models[0]}", "tenant_id": "{SHARED_TENANT_ID}"}}\''
            )
            lines.append("```")
            lines.append("")
    else:
        lines.append("All vendors have sufficient coverage. No manual action needed.")

    lines += [
        "",
        "## Methodology",
        "",
        "1. Queried NeonDB `knowledge_entries` with `manufacturer ILIKE '%vendor%' AND LENGTH(content) > 500`",
        "2. For vendors with <5 substantive chunks: triggered Apify `website-content-crawler` actor",
        "   with `crawlerType: playwright:chrome`, maxCrawlPages=30, maxCrawlDepth=2",
        "3. Classified crawl quality (avg page content length threshold: 4000 chars)",
        "4. Chunked text (min 400 chars, max 6000 chars), embedded via `nomic-embed-text:latest` on Bravo",
        "5. Inserted to NeonDB with manufacturer and model_number fields set",
        "",
        "**Embedding host:** Bravo LAN (192.168.1.11:11434)  ",
        "**Chunk threshold for 'substantive':** content > 500 chars + manufacturer field set  ",
        "**Minimum required for demo:** 5 substantive chunks per vendor",
        "",
    ]

    content = "\n".join(lines)
    with open(REPORT_PATH, "w") as f:
        f.write(content)
    logger.info("Report written to %s", REPORT_PATH)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Vendor KB coverage filler")
    parser.add_argument("--dry-run", action="store_true", help="Check only, no crawls")
    parser.add_argument(
        "--vendors",
        default="",
        help="Comma-separated vendor names to process (default: all with gaps)",
    )
    args = parser.parse_args()

    selected = {v.strip().lower() for v in args.vendors.split(",")} if args.vendors else set()

    # Verify Ollama is reachable (try localhost first, fall back to Bravo LAN)
    if not args.dry_run:
        global OLLAMA_URL  # noqa: PLW0603
        ollama_candidates = [OLLAMA_URL, "http://192.168.1.11:11434"]
        ollama_ok = False
        for candidate_url in ollama_candidates:
            for attempt in range(2):
                try:
                    with httpx.Client(timeout=20) as c:
                        r = c.get(f"{candidate_url}/api/tags")
                        r.raise_for_status()
                        models = [m["name"] for m in r.json().get("models", [])]
                        if EMBED_MODEL not in models:
                            raise RuntimeError(f"{EMBED_MODEL} not found — available: {models}")
                    OLLAMA_URL = candidate_url
                    logger.info("Ollama OK — %s at %s", EMBED_MODEL, candidate_url)
                    ollama_ok = True
                    break
                except Exception as exc:
                    logger.warning("Ollama check failed (%s attempt %d): %s", candidate_url, attempt + 1, exc)
                    time.sleep(2)
            if ollama_ok:
                break
        if not ollama_ok:
            logger.error("Ollama unreachable on all candidates — aborting")
            raise SystemExit(1)

    targets = [v for v in VENDORS if not selected or v.name.lower() in selected]

    for vendor in targets:
        logger.info("=== Processing %s ===", vendor.name)
        try:
            ingest_vendor(vendor, dry_run=args.dry_run)
        except Exception as exc:
            logger.error("[%s] Unexpected error: %s", vendor.name, exc)
            vendor.outcome = "ERROR"
            vendor.notes = str(exc)

    write_report(targets, dry_run=args.dry_run)

    # Summary
    print("\n=== COVERAGE SUMMARY ===")
    for name, _, pre, outcome, _ in ALWAYS_READY:
        print(f"  {name}: {pre} chunks — {outcome}")
    for v in targets:
        icon = OUTCOME_ICON.get(v.outcome, v.outcome)
        print(f"  {v.name}: {v.current_chunks} → {v.post_chunks} chunks — {icon}  notes={v.notes[:80]}")


if __name__ == "__main__":
    main()
