#!/usr/bin/env python3
"""Ingest local PDF/TXT files into NeonDB knowledge_entries.

Scans a directory for documents, extracts text, chunks, embeds via Ollama,
and inserts into NeonDB. Reuses the proven pipeline from ingest_manuals.py.

Usage:
    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/ingest_gdrive_docs.py --dry-run

    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/ingest_gdrive_docs.py

    doppler run --project factorylm --config prd -- \
      python mira-core/scripts/ingest_gdrive_docs.py \
        --path mira-core/data/gdrive_ingest/industrial/notes/
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Generator

import httpx

# ---------------------------------------------------------------------------
# Config (matches ingest_manuals.py)
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID")
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
EMBED_TIMEOUT = 30
MAX_PDF_PAGES = 310
MIN_CHUNK_CHARS = 80

# RULE: Docling is the ONLY PDF extractor for this script. pdfplumber is not used.
# Do not add pdfplumber as a fallback — if Docling is unavailable, the script must fail fast.
import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent))
try:
    from docling_adapter import DoclingAdapter as _DoclingAdapter
    _docling = _DoclingAdapter(max_pages=MAX_PDF_PAGES)
    logging.getLogger(__name__).info("Docling extraction active (OCR + semantic chunking)")
except Exception as _e:
    logging.getLogger(__name__).error(
        "Docling unavailable: %s — install docling_adapter before running this script", _e
    )
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_INGEST_DIR = REPO_ROOT / "mira-core" / "data" / "manuals"
SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".html", ".htm", ".md"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ingest_gdrive_docs")

# ---------------------------------------------------------------------------
# sys.path: make db.neon importable
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_INGEST_DIR = os.path.join(os.path.dirname(_SCRIPT_DIR), "mira-ingest")
if _INGEST_DIR not in sys.path:
    sys.path.insert(0, _INGEST_DIR)

from db.neon import (  # noqa: E402
    insert_knowledge_entry,
    knowledge_entry_exists,
    health_check,
)


# ---------------------------------------------------------------------------
# Text extraction (reused from ingest_manuals.py)
# ---------------------------------------------------------------------------

BOILERPLATE_RE = re.compile(
    r"(?:^\d{1,4}$)"
    r"|(?:www\.\S+\.com)",
    re.MULTILINE,
)


def _clean_text(text: str) -> str:
    text = BOILERPLATE_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _detect_sections(page_text: str) -> list[tuple[str, str]]:
    lines = page_text.split("\n")
    sections: list[tuple[str, str]] = []
    current_heading = ""
    current_body: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            current_body.append("")
            continue
        is_heading = (
            len(stripped) < 80
            and not stripped.endswith(".")
            and not stripped.endswith(",")
            and (stripped.istitle() or stripped.isupper() or re.match(r"^\d+\.\d+", stripped))
            and len(stripped.split()) <= 12
        )
        if is_heading and current_body:
            body = "\n".join(current_body).strip()
            if body and len(body) > 50:
                sections.append((current_heading, body))
            current_heading = stripped
            current_body = []
        elif is_heading and not current_body:
            current_heading = stripped
        else:
            current_body.append(stripped)

    body = "\n".join(current_body).strip()
    if body and len(body) > 50:
        sections.append((current_heading, body))

    return sections



def _extract_from_text(data: bytes) -> list[dict]:
    """Extract text blocks from a plain text file."""
    text = data.decode("utf-8", errors="replace")
    text = _clean_text(text)
    if len(text) < MIN_CHUNK_CHARS:
        return []
    sections = _detect_sections(text)
    if not sections:
        sections = [("", text)]
    blocks = []
    for heading, body in sections:
        if len(body) >= MIN_CHUNK_CHARS:
            blocks.append({"text": body, "page_num": None, "section": heading})
    return blocks


# ---------------------------------------------------------------------------
# Chunking (reused from ingest_manuals.py)
# ---------------------------------------------------------------------------

def _chunk_text(text: str) -> Generator[str, None, None]:
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if len(chunk) >= MIN_CHUNK_CHARS:
            yield chunk
        start += CHUNK_SIZE - CHUNK_OVERLAP


def _blocks_to_chunks(blocks: list[dict]) -> list[dict]:
    chunks: list[dict] = []
    for block in blocks:
        text = block["text"]
        if len(text) <= CHUNK_SIZE:
            chunks.append(block)
        else:
            for piece in _chunk_text(text):
                chunks.append({"text": piece, "page_num": block["page_num"], "section": block["section"]})
    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def _embed(text: str) -> list[float] | None:
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
# Manufacturer / model extraction from filename
# ---------------------------------------------------------------------------

_MFR_HINTS: dict[str, str] = {
    "automationdirect": "AutomationDirect",
    "gs": "AutomationDirect",
    "drives-g": "AutomationDirect",
    "siemens": "Siemens",
    "rockwell": "Rockwell Automation",
    "allen-bradley": "Allen-Bradley",
    "abb": "ABB",
    "schneider": "Schneider Electric",
    "mitsubishi": "Mitsubishi Electric",
    "eaton": "Eaton",
    "omron": "Omron",
    "fanuc": "Fanuc",
    "yaskawa": "Yaskawa",
    "danfoss": "Danfoss",
    "powerflex": "Allen-Bradley",
    "micro820": "Allen-Bradley",
    "compactlogix": "Allen-Bradley",
}

_EQUIP_HINTS: dict[str, str] = {
    "vfd": "vfd",
    "drive": "vfd",
    "inverter": "vfd",
    "motor": "motor",
    "plc": "plc",
    "starter": "starter",
    "contactor": "contactor",
    "breaker": "breaker",
    "transformer": "transformer",
    "compressor": "compressor",
    "pump": "pump",
}


def _extract_mfr(filename: str, parent_dir: str) -> str | None:
    combined = f"{parent_dir}/{filename}".lower()
    for key, name in _MFR_HINTS.items():
        if key in combined:
            return name
    return None


def _extract_equipment_type(filename: str, parent_dir: str) -> str:
    combined = f"{parent_dir}/{filename}".lower()
    for key, etype in _EQUIP_HINTS.items():
        if key in combined:
            return etype
    return "other"


def _extract_model(filename: str) -> str | None:
    name = re.sub(r"\.(pdf|txt|html?|md)$", "", filename, flags=re.IGNORECASE)
    name = re.sub(r"[-_]", " ", name).strip()
    if 3 <= len(name) <= 60:
        return name
    return None


# ---------------------------------------------------------------------------
# File processor
# ---------------------------------------------------------------------------

def process_file(file_path: Path, dry_run: bool = False) -> tuple[int, int]:
    """Process a single file. Returns (chunks_found, chunks_inserted)."""
    data = file_path.read_bytes()
    file_hash = hashlib.sha256(data).hexdigest()[:16]
    source_url = f"gdrive://{file_path.name}"

    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        blocks = _docling.extract_from_pdf(data)
    elif suffix in (".txt", ".md"):
        blocks = _extract_from_text(data)
    elif suffix in (".html", ".htm"):
        blocks = _extract_from_text(data)  # simple text extraction
    else:
        log.warning("Unsupported file type: %s", file_path.name)
        return 0, 0

    if not blocks:
        log.warning("  No extractable text from %s", file_path.name)
        return 0, 0

    chunks = _blocks_to_chunks(blocks)
    parent_dir = file_path.parent.name
    manufacturer = _extract_mfr(file_path.name, parent_dir)
    equipment_type = _extract_equipment_type(file_path.name, parent_dir)
    model = _extract_model(file_path.name)

    if dry_run:
        return len(chunks), 0

    inserted = 0
    for chunk_idx, chunk in enumerate(chunks):
        text = chunk["text"]
        if len(text) < MIN_CHUNK_CHARS:
            continue

        if knowledge_entry_exists(MIRA_TENANT_ID, source_url, chunk_idx):
            continue

        embedding = _embed(text)
        if embedding is None:
            continue

        try:
            insert_knowledge_entry(
                tenant_id=MIRA_TENANT_ID,
                content=text,
                embedding=embedding,
                manufacturer=manufacturer,
                model_number=model,
                source_url=source_url,
                chunk_index=chunk_idx,
                page_num=chunk["page_num"],
                section=chunk["section"],
                source_type="gdrive",
            )
            inserted += 1
        except Exception as exc:
            log.warning("  Insert failed chunk %d: %s", chunk_idx, exc)

    return len(chunks), inserted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest local PDF/TXT files into NeonDB knowledge_entries",
    )
    parser.add_argument(
        "--path",
        type=str,
        default=str(DEFAULT_INGEST_DIR),
        help=f"Directory to scan for documents (default: {DEFAULT_INGEST_DIR})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract and chunk but don't embed or write to NeonDB",
    )
    args = parser.parse_args()

    scan_path = Path(args.path)
    if not scan_path.exists():
        log.error("Path does not exist: %s", scan_path)
        sys.exit(1)

    if not args.dry_run and not MIRA_TENANT_ID:
        log.error("MIRA_TENANT_ID env var not set — run with Doppler")
        sys.exit(1)

    # Get NeonDB count before (skip in dry-run)
    count_before = 0
    if not args.dry_run:
        try:
            hc = health_check()
            count_before = hc.get("knowledge_entries", 0)
            log.info("NeonDB knowledge_entries before: %d", count_before)
        except Exception:
            log.warning("Could not get NeonDB health check")

    # Find all supported files
    files = [
        f for f in scan_path.rglob("*")
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
    ]

    if not files:
        log.info("No supported documents found in %s", scan_path)
        sys.exit(0)

    log.info("Found %d documents to process in %s", len(files), scan_path)

    total_chunks = 0
    total_inserted = 0
    ok_files = 0
    skip_files = 0

    for i, file_path in enumerate(files, 1):
        rel = file_path.relative_to(scan_path)
        log.info("[%d/%d] %s", i, len(files), rel)

        chunks_found, chunks_inserted = process_file(file_path, dry_run=args.dry_run)

        if chunks_found > 0:
            total_chunks += chunks_found
            total_inserted += chunks_inserted
            ok_files += 1
            if args.dry_run:
                log.info("  %d chunks (dry run)", chunks_found)
            else:
                log.info("  %d chunks extracted, %d inserted", chunks_found, chunks_inserted)
        else:
            skip_files += 1

        if not args.dry_run:
            time.sleep(0.1)

    # Summary banner
    print()
    print("=" * 50)
    print(f"MIRA Document Ingest{' — DRY RUN' if args.dry_run else ''}")
    print("=" * 50)
    print(f"Source:              {scan_path}")
    print(f"Documents scanned:   {len(files):>4}")
    print(f"Documents with text: {ok_files:>4}")
    print(f"Documents skipped:   {skip_files:>4}")
    print(f"Total chunks:        {total_chunks:>4}")
    if not args.dry_run:
        print(f"Chunks inserted:     {total_inserted:>4}")
        # Get count after
        try:
            hc = health_check()
            count_after = hc.get("knowledge_entries", 0)
            print(f"KB entries before:    {count_before:>4}")
            print(f"KB entries after:     {count_after:>4}")
            print(f"Net new entries:      {count_after - count_before:>4}")
        except Exception:
            pass
    print("=" * 50)


if __name__ == "__main__":
    main()
