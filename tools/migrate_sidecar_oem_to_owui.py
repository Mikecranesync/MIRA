#!/usr/bin/env python3
"""
Migrate OEM library from mira-sidecar ChromaDB → Open WebUI knowledge collection.

ADR-0008 Phase 3: export the 398-chunk Brain1 (shared_oem) collection from the
sidecar's ChromaDB and upload each chunk into a dedicated Open WebUI knowledge
collection ("OEM Library — MIRA Shared").

MUST be reviewed and run by a human during a quiet window — this is a production
data migration. The sidecar container must be running when this script executes
(it reads from its live ChromaDB volume).

Usage (from VPS):
    # Dry-run: show what would be migrated without touching Open WebUI
    doppler run -p factorylm -c prd -- python3 tools/migrate_sidecar_oem_to_owui.py --dry-run

    # Live run: migrate all chunks to Open WebUI KB
    doppler run -p factorylm -c prd -- python3 tools/migrate_sidecar_oem_to_owui.py

    # Resume interrupted run (idempotent — skips already-uploaded chunks):
    doppler run -p factorylm -c prd -- python3 tools/migrate_sidecar_oem_to_owui.py --resume

Prerequisites on the host running this script:
    pip install chromadb httpx

Environment variables (injected by Doppler):
    OPENWEBUI_API_KEY       Bearer token for Open WebUI admin API
    OPENWEBUI_BASE_URL      e.g. http://localhost:3010 (internal) or https://app.factorylm.com

Constants (edit before running if needed):
    CHROMA_PATH             Path to sidecar ChromaDB data directory
    SOURCE_COLLECTION       Brain1 collection name in ChromaDB
    TARGET_COLLECTION_NAME  Display name for the new Open WebUI KB collection
    BATCH_SIZE              Chunks per Open WebUI API call
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

logger = logging.getLogger("sidecar-migration")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

# ── Constants (adjust if paths differ on VPS) ────────────────────────────────

CHROMA_PATH = os.getenv("CHROMA_PATH", "/var/lib/docker/volumes/mira_mira-chroma/_data")
SOURCE_COLLECTION = "shared_oem"          # Brain1 — OEM docs only (NOT mira_docs / Brain2)
TARGET_COLLECTION_NAME = "OEM Library — MIRA Shared"
TARGET_COLLECTION_DESC = (
    "Shared OEM equipment manuals migrated from mira-sidecar ChromaDB (ADR-0008). "
    "Source: Brain1 shared_oem collection, 398 chunks from pdfplumber extraction."
)
BATCH_SIZE = 50                           # Documents per Open WebUI /add call
PROGRESS_FILE = "/tmp/mira_migration_progress.json"

OWUI_BASE = os.getenv("OPENWEBUI_BASE_URL", "http://localhost:3010").rstrip("/")
OWUI_KEY = os.getenv("OPENWEBUI_API_KEY", "")


# ── Helpers ──────────────────────────────────────────────────────────────────

def owui_headers() -> dict[str, str]:
    if not OWUI_KEY:
        logger.error("OPENWEBUI_API_KEY not set — aborting")
        sys.exit(1)
    return {"Authorization": f"Bearer {OWUI_KEY}", "Content-Type": "application/json"}


def get_or_create_collection(client: httpx.Client) -> str:
    """Return the collection ID for TARGET_COLLECTION_NAME, creating it if absent."""
    resp = client.get(f"{OWUI_BASE}/api/v1/knowledge/", headers=owui_headers())
    resp.raise_for_status()
    collections = resp.json()
    for c in collections:
        if c.get("name") == TARGET_COLLECTION_NAME:
            cid = c["id"]
            logger.info("Found existing collection '%s' id=%s", TARGET_COLLECTION_NAME, cid)
            return cid

    # Create new collection
    payload = {"name": TARGET_COLLECTION_NAME, "description": TARGET_COLLECTION_DESC}
    resp = client.post(
        f"{OWUI_BASE}/api/v1/knowledge/create",
        headers=owui_headers(),
        json=payload,
    )
    resp.raise_for_status()
    cid = resp.json()["id"]
    logger.info("Created collection '%s' id=%s", TARGET_COLLECTION_NAME, cid)
    return cid


def add_texts_to_collection(
    client: httpx.Client, collection_id: str, texts: list[str], metadatas: list[dict]
) -> None:
    """POST a batch of text chunks to an Open WebUI knowledge collection."""
    payload = {
        "collection_id": collection_id,
        "items": [
            {"text": t, "metadata": m}
            for t, m in zip(texts, metadatas, strict=True)
        ],
    }
    resp = client.post(
        f"{OWUI_BASE}/api/v1/knowledge/{collection_id}/texts/add",
        headers=owui_headers(),
        json=payload,
        timeout=120,
    )
    if resp.status_code not in (200, 201):
        logger.error("Add texts failed HTTP %s: %s", resp.status_code, resp.text[:300])
        resp.raise_for_status()


def load_progress() -> set[str]:
    """Load set of already-migrated chunk IDs from progress file."""
    if Path(PROGRESS_FILE).exists():
        with open(PROGRESS_FILE) as f:
            return set(json.load(f).get("migrated_ids", []))
    return set()


def save_progress(migrated_ids: set[str]) -> None:
    with open(PROGRESS_FILE, "w") as f:
        json.dump({"migrated_ids": sorted(migrated_ids)}, f)


# ── Main migration logic ─────────────────────────────────────────────────────

def run(dry_run: bool = False, resume: bool = False) -> None:
    try:
        import chromadb  # type: ignore[import]
    except ImportError:
        logger.error("chromadb not installed — run: pip install chromadb")
        sys.exit(1)

    # ── 1. Connect to sidecar ChromaDB ──────────────────────────────────────
    chroma_path = Path(CHROMA_PATH)
    if not chroma_path.exists():
        logger.error("ChromaDB path not found: %s", chroma_path)
        logger.error(
            "Try: docker inspect mira-sidecar --format '{{json .Mounts}}' "
            "to find the actual volume mount path."
        )
        sys.exit(1)

    logger.info("Opening ChromaDB at %s", chroma_path)
    chroma = chromadb.PersistentClient(path=str(chroma_path))

    try:
        collection = chroma.get_collection(SOURCE_COLLECTION)
    except Exception as e:
        logger.error("Collection '%s' not found in ChromaDB: %s", SOURCE_COLLECTION, e)
        sys.exit(1)

    total = collection.count()
    logger.info("Source collection '%s': %d chunks", SOURCE_COLLECTION, total)

    if total == 0:
        logger.warning("Collection is empty — nothing to migrate.")
        return

    # ── 2. Fetch all chunks ─────────────────────────────────────────────────
    logger.info("Fetching all %d chunks from ChromaDB…", total)
    result = collection.get(
        include=["documents", "metadatas"],
        limit=total,
    )
    ids: list[str] = result["ids"]
    docs: list[str] = result["documents"]
    metas: list[dict] = result["metadatas"]

    # ── 3. Embedding model check ─────────────────────────────────────────────
    # The sidecar uses nomic-embed-text via Ollama (768-dim).
    # Open WebUI must also be configured with nomic-embed-text for embedding parity.
    # VERIFY before running: Settings > Documents > Embedding Model in Open WebUI UI.
    # If Open WebUI uses a different model, vectors will not be comparable (new
    # embeddings will be generated by Open WebUI on ingest — this is ACCEPTABLE
    # because Open WebUI stores the text and re-embeds it using its own model).
    logger.info(
        "NOTE: Open WebUI will re-embed chunks using its configured embedding model. "
        "Verify Settings > Documents > Embedding Engine matches nomic-embed-text "
        "for best retrieval parity."
    )

    # ── 4. Dry-run report ───────────────────────────────────────────────────
    if dry_run:
        logger.info("DRY RUN — no data will be written to Open WebUI")
        unique_files = {m.get("source_file", "unknown") for m in metas}
        logger.info("Unique source files: %d", len(unique_files))
        for f in sorted(unique_files):
            count = sum(1 for m in metas if m.get("source_file") == f)
            logger.info("  %s: %d chunks", f, count)
        logger.info("Would create collection: '%s'", TARGET_COLLECTION_NAME)
        logger.info("Would upload %d chunks in batches of %d", total, BATCH_SIZE)
        return

    # ── 5. Resume: skip already-migrated IDs ────────────────────────────────
    migrated_ids: set[str] = set()
    if resume:
        migrated_ids = load_progress()
        logger.info("Resume mode: %d chunks already migrated, skipping", len(migrated_ids))

    pending = [
        (cid, doc, meta)
        for cid, doc, meta in zip(ids, docs, metas, strict=True)
        if cid not in migrated_ids
    ]
    logger.info("%d chunks to upload", len(pending))

    if not pending:
        logger.info("Nothing left to migrate.")
        return

    # ── 6. Get/create Open WebUI collection ─────────────────────────────────
    with httpx.Client(timeout=30) as client:
        # Health check first
        try:
            health = client.get(f"{OWUI_BASE}/health")
            health.raise_for_status()
        except Exception as e:
            logger.error("Open WebUI unreachable at %s: %s", OWUI_BASE, e)
            sys.exit(1)

        collection_id = get_or_create_collection(client)

        # ── 7. Upload in batches ─────────────────────────────────────────────
        batch_texts: list[str] = []
        batch_metas: list[dict] = []
        batch_ids: list[str] = []

        uploaded = 0
        failed = 0

        for i, (cid, doc, meta) in enumerate(pending):
            # Enrich metadata for traceability
            enriched_meta = {
                **meta,
                "migration_source": "mira-sidecar:shared_oem",
                "original_chunk_id": cid,
            }
            batch_texts.append(doc)
            batch_metas.append(enriched_meta)
            batch_ids.append(cid)

            if len(batch_texts) >= BATCH_SIZE or i == len(pending) - 1:
                try:
                    add_texts_to_collection(client, collection_id, batch_texts, batch_metas)
                    for bid in batch_ids:
                        migrated_ids.add(bid)
                    uploaded += len(batch_texts)
                    save_progress(migrated_ids)
                    logger.info(
                        "Progress: %d/%d uploaded (%.0f%%)",
                        uploaded,
                        len(pending),
                        100 * uploaded / len(pending),
                    )
                except Exception as e:
                    logger.error("Batch upload failed: %s — will retry on next run", e)
                    failed += len(batch_texts)
                finally:
                    batch_texts.clear()
                    batch_metas.clear()
                    batch_ids.clear()

                time.sleep(0.2)  # light rate limiting

    # ── 8. Summary ──────────────────────────────────────────────────────────
    logger.info("Migration complete: %d uploaded, %d failed", uploaded, failed)
    if failed:
        logger.warning("Some chunks failed — re-run with --resume to retry")
        sys.exit(1)
    else:
        logger.info(
            "All chunks uploaded to Open WebUI collection '%s' (id=%s)",
            TARGET_COLLECTION_NAME,
            collection_id,
        )
        logger.info(
            "Next steps:\n"
            "  1. Open Open WebUI > Knowledge > '%s'\n"
            "  2. Verify a sample query returns expected OEM content\n"
            "  3. If satisfied, notify Mike — sidecar container can be stopped\n"
            "  4. Run: docker compose -f /opt/mira/docker-compose.saas.yml stop mira-sidecar\n"
            "  5. DO NOT docker volume rm mira_mira-chroma until Brain2 tenant docs are\n"
            "     also confirmed migrated or backed up.",
            TARGET_COLLECTION_NAME,
        )
        if Path(PROGRESS_FILE).exists():
            Path(PROGRESS_FILE).unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate sidecar OEM docs to Open WebUI KB")
    parser.add_argument("--dry-run", action="store_true", help="Report what would happen, no writes")
    parser.add_argument("--resume", action="store_true", help="Skip already-migrated chunks")
    args = parser.parse_args()
    run(dry_run=args.dry_run, resume=args.resume)
