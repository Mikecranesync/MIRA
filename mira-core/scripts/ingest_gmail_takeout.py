#!/usr/bin/env python3
"""Ingest Gmail mbox from Google Takeout into NeonDB knowledge_entries.

Parses a Gmail .mbox file (from Google Takeout), chunks email bodies,
embeds via Ollama, and inserts into NeonDB. Reuses proven patterns from
ingest_gdrive_docs.py.

Usage:
    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/ingest_gmail_takeout.py \
        --mbox-path C:/takeout_staging/extracted/Takeout/Mail/All\\ mail.mbox \
        --dry-run

    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/ingest_gmail_takeout.py \
        --mbox-path C:/takeout_staging/extracted/Takeout/Mail/All\\ mail.mbox \
        --tenant-id 78917b56-f85f-43bb-9a08-1bb98a6cd6c3
"""

from __future__ import annotations

import argparse
import logging
import mailbox
import os
import re
import sys
import time
from email.header import decode_header as _decode_header
from typing import Generator

import httpx

# ---------------------------------------------------------------------------
# Config (matches ingest_gdrive_docs.py)
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
EMBED_TIMEOUT = 30
MIN_CHUNK_CHARS = 80

# Labels to include and exclude
INCLUDE_LABELS = {"Inbox", "Sent", "Important"}
EXCLUDE_LABELS = {"Spam", "Trash"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ingest_gmail_takeout")

# ---------------------------------------------------------------------------
# sys.path: make db.neon importable
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_INGEST_DIR = os.path.join(os.path.dirname(_SCRIPT_DIR), "mira-ingest")
if _INGEST_DIR not in sys.path:
    sys.path.insert(0, _INGEST_DIR)

from db.neon import (  # noqa: E402
    health_check,
    insert_knowledge_entry,
    knowledge_entry_exists,
)

# ---------------------------------------------------------------------------
# Email parsing helpers
# ---------------------------------------------------------------------------


def _decode_mime_header(raw: str | None) -> str:
    """Decode a MIME-encoded email header to plain text."""
    if not raw:
        return ""
    parts = []
    for data, charset in _decode_header(raw):
        if isinstance(data, bytes):
            parts.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(data)
    return " ".join(parts)


def _extract_body(msg) -> str:
    """Extract plain text body from an email message."""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        # Fallback: try text/html and strip tags
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    html = payload.decode(charset, errors="replace")
                    return _strip_html(html)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                return _strip_html(text)
            return text
    return ""


def _strip_html(html: str) -> str:
    """Minimal HTML tag stripping without external dependencies."""
    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_labels(msg) -> set[str]:
    """Parse X-Gmail-Labels header into a set of label names."""
    raw = msg.get("X-Gmail-Labels", "")
    if not raw:
        return set()
    return {label.strip() for label in raw.split(",") if label.strip()}


def _should_process(labels: set[str]) -> bool:
    """Check if email should be processed based on label filters."""
    # Exclude if any exclude label is present
    if labels & EXCLUDE_LABELS:
        return False
    # Include if any include label is present
    if labels & INCLUDE_LABELS:
        return True
    return False


# ---------------------------------------------------------------------------
# Chunking (reused from ingest_gdrive_docs.py)
# ---------------------------------------------------------------------------


def _chunk_text(text: str) -> Generator[str, None, None]:
    """Yield chunks of text with overlap."""
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if len(chunk) >= MIN_CHUNK_CHARS:
            yield chunk
        start += CHUNK_SIZE - CHUNK_OVERLAP


# ---------------------------------------------------------------------------
# Embedding (reused from ingest_gdrive_docs.py)
# ---------------------------------------------------------------------------


def _embed(text: str) -> list[float] | None:
    """Embed text via Ollama."""
    try:
        resp = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=EMBED_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as exc:
        log.warning("Embed failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest Gmail mbox from Google Takeout into NeonDB",
    )
    parser.add_argument(
        "--mbox-path",
        type=str,
        required=True,
        help="Path to the .mbox file from Google Takeout",
    )
    parser.add_argument(
        "--tenant-id",
        type=str,
        default=os.getenv("MIRA_TENANT_ID"),
        help="NeonDB tenant ID (default: MIRA_TENANT_ID env var)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and chunk but don't embed or write to NeonDB",
    )
    args = parser.parse_args()

    if not os.path.exists(args.mbox_path):
        log.error("mbox file not found: %s", args.mbox_path)
        sys.exit(1)

    if not args.dry_run and not args.tenant_id:
        log.error("--tenant-id or MIRA_TENANT_ID env var required (or use --dry-run)")
        sys.exit(1)

    # NeonDB count before
    count_before = 0
    if not args.dry_run:
        try:
            hc = health_check()
            count_before = hc.get("knowledge_entries", 0)
            log.info("NeonDB knowledge_entries before: %d", count_before)
        except Exception:
            log.warning("Could not get NeonDB health check")

    log.info("Opening mbox: %s", args.mbox_path)
    mbox = mailbox.mbox(args.mbox_path)

    total_emails = 0
    processed_emails = 0
    skipped_labels = 0
    skipped_empty = 0
    total_chunks = 0
    total_inserted = 0

    for msg in mbox:
        total_emails += 1

        # Progress logging every 100 emails
        if total_emails % 100 == 0:
            log.info(
                "Progress: %d emails scanned, %d processed, %d chunks, %d inserted",
                total_emails,
                processed_emails,
                total_chunks,
                total_inserted,
            )

        # Label filtering
        labels = _parse_labels(msg)
        if not _should_process(labels):
            skipped_labels += 1
            continue

        # Extract fields
        subject = _decode_mime_header(msg.get("subject"))
        sender = _decode_mime_header(msg.get("from"))
        date = msg.get("date", "")
        message_id = msg.get("message-id", "")
        body = _extract_body(msg)

        # Clean body
        body = re.sub(r"\n{3,}", "\n\n", body).strip()

        if len(body) < MIN_CHUNK_CHARS:
            skipped_empty += 1
            continue

        processed_emails += 1

        # Build source URL for dedup
        source_url = f"gmail://{message_id}" if message_id else f"gmail://msg-{total_emails}"

        # Prepend header context to body for richer chunks
        header_prefix = f"Subject: {subject}\nFrom: {sender}\nDate: {date}\n\n"

        # Chunk the body
        chunks = list(_chunk_text(body))
        if not chunks:
            skipped_empty += 1
            continue

        total_chunks += len(chunks)

        if args.dry_run:
            continue

        # Build metadata for JSONB column
        metadata = {  # noqa: F841
            "subject": subject[:200],
            "from": sender[:200],
            "date": date,
            "labels": sorted(labels),
            "message_id": message_id[:200],
        }

        for chunk_idx, chunk_text in enumerate(chunks):
            if knowledge_entry_exists(args.tenant_id, source_url, chunk_idx):
                continue

            # Prepend header to first chunk only
            embed_text = (header_prefix + chunk_text) if chunk_idx == 0 else chunk_text

            embedding = _embed(embed_text)
            if embedding is None:
                continue

            try:
                insert_knowledge_entry(
                    tenant_id=args.tenant_id,
                    content=embed_text if chunk_idx == 0 else chunk_text,
                    embedding=embedding,
                    manufacturer=None,
                    model_number=None,
                    source_url=source_url,
                    chunk_index=chunk_idx,
                    page_num=None,
                    section=subject[:100] if subject else None,
                    source_type="gmail",
                )
                total_inserted += 1
            except Exception as exc:
                log.warning("Insert failed for %s chunk %d: %s", source_url, chunk_idx, exc)

        # Light rate limiting for Ollama
        time.sleep(0.05)

    # Summary
    print()
    print("=" * 50)
    print(f"Gmail Takeout Ingest{' — DRY RUN' if args.dry_run else ''}")
    print("=" * 50)
    print(f"mbox file:           {args.mbox_path}")
    print(f"Total emails:        {total_emails:>6}")
    print(f"Processed (matched): {processed_emails:>6}")
    print(f"Skipped (labels):    {skipped_labels:>6}")
    print(f"Skipped (empty):     {skipped_empty:>6}")
    print(f"Total chunks:        {total_chunks:>6}")
    if not args.dry_run:
        print(f"Chunks inserted:     {total_inserted:>6}")
        try:
            hc = health_check()
            count_after = hc.get("knowledge_entries", 0)
            print(f"KB entries before:    {count_before:>6}")
            print(f"KB entries after:     {count_after:>6}")
            print(f"Net new entries:      {count_after - count_before:>6}")
        except Exception:
            pass
    print("=" * 50)


if __name__ == "__main__":
    main()
