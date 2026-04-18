"""capture_ingest.py — Vision Capture → NeonDB KB Ingest

Watches vision_captures/ for new sidecar JSON files and ingests them
into the NeonDB knowledge_entries table as 'live_capture' source type.

Usage:
    # Daemon: watch for new captures alongside HUD server
    doppler run --project factorylm --config prd -- python capture_ingest.py --watch

    # Backfill: process all existing uningested captures
    doppler run --project factorylm --config prd -- python capture_ingest.py --backfill ../vision_captures/

Dependencies: uv pip install -r ../vim/requirements.txt

Environment (via Doppler):
    NEON_DATABASE_URL  — NeonDB connection string (required)
    MIRA_TENANT_ID     — tenant scoping (required)
    OLLAMA_BASE_URL    — Ollama host (default: http://localhost:11434)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(
    level=logging.INFO,
    format="[ingest] %(levelname)s %(message)s",
)
logger = logging.getLogger("capture-ingest")

# ── Config ────────────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL     = "nomic-embed-text:v1.5"
TENANT_ID       = os.environ.get("MIRA_TENANT_ID", "")
NEON_URL        = os.environ.get("NEON_DATABASE_URL", "")

if not TENANT_ID:
    logger.warning("MIRA_TENANT_ID not set — entries will use empty tenant_id")
if not NEON_URL:
    logger.error("NEON_DATABASE_URL not set — cannot ingest")
    sys.exit(1)


# ── NeonDB ────────────────────────────────────────────────────────────────────

def _engine():
    return create_engine(
        NEON_URL,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def entry_exists(image_path: str) -> bool:
    """Check if this capture has already been ingested (dedup by image_path)."""
    try:
        with _engine().connect() as conn:
            count = conn.execute(text(
                "SELECT COUNT(*) FROM knowledge_entries "
                "WHERE tenant_id = :tid AND source_url = :url AND source_type = 'live_capture'"
            ), {"tid": TENANT_ID, "url": image_path}).scalar()
        return (count or 0) > 0
    except Exception as e:
        logger.warning("Dedup check failed (will proceed): %s", e)
        return False


def insert_entry(sidecar: dict, embedding: list[float]) -> str:
    """Insert one live_capture entry into knowledge_entries. Returns new row id."""
    entry_id = str(uuid.uuid4())
    equipment  = sidecar.get("equipment", "Unknown")
    model_str  = sidecar.get("model", "Unknown")
    image_path = sidecar.get("image_path", "")
    alerts     = sidecar.get("alerts", [])
    verified   = sidecar.get("significance") == "user_confirmed"

    # Manufacturer: first word of model string if meaningful
    manufacturer = None
    if model_str and model_str not in ("Unknown", ""):
        first_word = model_str.split()[0]
        if len(first_word) > 2:
            manufacturer = first_word

    meta = json.dumps({
        "captured_at":  sidecar.get("ts"),
        "equipment":    equipment,
        "alerts":       alerts,
        "significance": sidecar.get("significance"),
        "image_path":   image_path,
        "session_date": sidecar.get("session_date"),
    })

    with _engine().connect() as conn:
        conn.execute(text("""
            INSERT INTO knowledge_entries
                (id, tenant_id, source_type, manufacturer, model_number,
                 content, embedding, source_url, source_page, metadata,
                 is_private, verified)
            VALUES
                (:id, :tenant_id, 'live_capture', :manufacturer, :model_number,
                 :content, cast(:embedding AS vector), :source_url, 0,
                 cast(:metadata AS jsonb), false, :verified)
        """), {
            "id":           entry_id,
            "tenant_id":    TENANT_ID,
            "manufacturer": manufacturer,
            "model_number": model_str,
            "content":      _build_content(sidecar),
            "embedding":    str(embedding),
            "source_url":   image_path,
            "metadata":     meta,
            "verified":     verified,
        })
        conn.commit()
    return entry_id


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_text(text_str: str, max_retries: int = 3) -> list[float] | None:
    """Embed text via Ollama nomic-embed-text:v1.5. Returns vector or None."""
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                f"{OLLAMA_BASE_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text_str},
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                logger.warning("Embed attempt %d/%d failed: %s — retry in %ds",
                               attempt + 1, max_retries, e, wait)
                time.sleep(wait)
            else:
                logger.error("Embed failed after %d attempts: %s", max_retries, e)
                return None
    return None


def _build_content(sidecar: dict) -> str:
    alerts_str = ", ".join(sidecar.get("alerts", [])) or "None"
    return (
        f"Equipment: {sidecar.get('equipment', 'Unknown')}\n"
        f"Model: {sidecar.get('model', 'Unknown')}\n"
        f"Observations: {sidecar.get('observations', '')}\n"
        f"Alerts: {alerts_str}\n"
        f"Session date: {sidecar.get('session_date', '')}\n"
        f"Significance: {sidecar.get('significance', '')}"
    )


# ── Core ingest ───────────────────────────────────────────────────────────────

def ingest_sidecar(json_path: Path) -> bool:
    """Ingest one sidecar JSON file. Returns True on success."""
    sentinel = json_path.with_suffix(".ingested")
    if sentinel.exists():
        return True  # already ingested

    try:
        sidecar = json.loads(json_path.read_text())
    except Exception as e:
        logger.error("Cannot read %s: %s", json_path, e)
        return False

    equipment = sidecar.get("equipment", "Unknown")
    image_path = sidecar.get("image_path", str(json_path))

    if equipment in ("Unknown", "General environment", ""):
        logger.debug("Skipping low-signal capture: %s", json_path.name)
        sentinel.touch()
        return True

    if entry_exists(image_path):
        logger.info("Already ingested: %s", json_path.name)
        sentinel.touch()
        return True

    content = _build_content(sidecar)
    embedding = embed_text(content)
    if embedding is None:
        logger.error("Embedding failed for %s — skipping", json_path.name)
        return False

    try:
        entry_id = insert_entry(sidecar, embedding)
        sentinel.touch()
        sig = sidecar.get("significance", "?")
        logger.info("Ingested %s [%s] → %s", equipment, sig, entry_id[:8])
        return True
    except Exception as e:
        logger.error("NeonDB insert failed for %s: %s", json_path.name, e)
        return False


# ── Backfill mode ─────────────────────────────────────────────────────────────

def backfill(captures_dir: Path) -> None:
    """Walk captures_dir, ingest all unprocessed sidecars."""
    sidecars = sorted(captures_dir.rglob("*.json"))
    total = len(sidecars)
    logger.info("Backfill: found %d sidecar files in %s", total, captures_dir)
    ok = failed = skipped = 0
    for path in sidecars:
        if path.suffix == ".ingested":
            continue
        result = ingest_sidecar(path)
        if result:
            if path.with_suffix(".ingested").exists():
                ok += 1
            else:
                skipped += 1
        else:
            failed += 1
    logger.info("Backfill complete: %d ingested, %d skipped, %d failed", ok, skipped, failed)


# ── Watch mode ────────────────────────────────────────────────────────────────

def watch(captures_dir: Path) -> None:
    """Watch captures_dir for new sidecar JSON files and ingest them."""
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        logger.error("watchdog not installed — run: uv pip install watchdog>=4.0")
        sys.exit(1)

    class Handler(FileSystemEventHandler):
        def on_created(self, event):
            if event.is_directory:
                return
            path = Path(event.src_path)
            if path.suffix == ".json" and not path.stem.endswith(".ingested"):
                time.sleep(0.2)  # brief wait for write to flush
                ingest_sidecar(path)

    captures_dir.mkdir(parents=True, exist_ok=True)
    observer = Observer()
    observer.schedule(Handler(), str(captures_dir), recursive=True)
    observer.start()
    logger.info("Watching %s for new captures... (Ctrl+C to stop)", captures_dir)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
    logger.info("Watcher stopped")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest MIRA vision captures to NeonDB KB")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--watch",    action="store_true",
                       help="Watch vision_captures/ directory for new files")
    group.add_argument("--backfill", metavar="PATH",
                       help="Backfill all existing captures from PATH")
    args = parser.parse_args()

    if args.backfill:
        backfill(Path(args.backfill))
    else:
        default_dir = Path(__file__).parent.parent / "vision_captures"
        watch(default_dir)
