"""Military Technical Manual PDF parser.

Extracts structured content from TM PDFs:
- Text chunks (pdfplumber) with section detection and overlapping chunking
- Embedded images (PyMuPDF/fitz) at configurable DPI
- Safety blocks (WARNING / CAUTION / NOTE) per MIL-STD-38784
- Tables: PMCS tables, callout/parts tables, generic tables (pdfplumber)
- TM identifier extraction from title pages

Outputs per-PDF JSON manifests and extracted images. Does NOT touch any database.

Usage:
    # Parse a single PDF
    python -m vim.tm_parser --pdf data/tm_pdfs/TM-55-1520-240-23.pdf

    # Parse all PDFs in a directory
    python -m vim.tm_parser --dir data/tm_pdfs/

    # Parse all PDFs in default tm_pdfs_dir
    python -m vim.tm_parser --batch

    # Show manifest summary
    python -m vim.tm_parser --summary data/tm_manifests/TM-55-1520-240-23.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

import httpx

from .config import ParserConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("vim-tm-parser")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class TMChunk:
    """A single extracted chunk from a TM PDF."""

    chunk_id: str
    page_num: int
    chunk_type: str  # text | image | warning | caution | note | table
    content: str = ""
    section: str = ""
    char_count: int = 0
    # Image fields
    image_path: str = ""
    adjacent_text: str = ""
    width: int = 0
    height: int = 0
    # Safety fields
    severity: str = ""  # WARNING | CAUTION | NOTE
    # Table fields
    table_type: str = ""  # pmcs | callout | generic
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    # Abstraction metadata
    metadata: dict = field(default_factory=dict)


@dataclass
class TMManifest:
    """Complete parse result for a single TM PDF."""

    tm_number: str
    source_pdf: str
    parsed_at: str
    total_pages: int
    distribution_statement: str
    chunks: list[TMChunk] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Text extraction helpers (adapted from ingest_manuals.py)
# ---------------------------------------------------------------------------

_BOILERPLATE_RE = re.compile(
    r"(?:^\d{1,4}$)"  # bare page numbers
    r"|(?:www\.\S+\.com)",
    re.MULTILINE,
)


def _clean_text(text: str) -> str:
    """Strip boilerplate noise from page text."""
    text = _BOILERPLATE_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _detect_sections(page_text: str) -> list[tuple[str, str]]:
    """Split page text into (heading, body) sections.

    Adapted from ingest_manuals.py — detects headings by length, case,
    and numbering patterns common in military TMs.
    """
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
            and (stripped.istitle() or stripped.isupper() or re.match(r"^\d+[\.\-]\d+", stripped))
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


def _chunk_text(
    text: str, chunk_size: int, overlap: int, min_chars: int = 80
) -> Generator[str, None, None]:
    """Yield overlapping chunks of approximately chunk_size characters."""
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if len(chunk) >= min_chars:
            yield chunk
        start += chunk_size - overlap


# ---------------------------------------------------------------------------
# TM identifier extraction
# ---------------------------------------------------------------------------

_TM_NUMBER_PATTERNS = [
    re.compile(r"(TM\s+\d{1,2}[\-\s]\d{3,5}[\-\s]\d{2,4}[\-\s]\d{1,3})", re.IGNORECASE),
    re.compile(r"(TM\s+\d{1,2}[\-\s]\d{3,5}[\-\s]\d{2,4})", re.IGNORECASE),
    re.compile(r"(TM\s+\d{1,2}[\-\s]\d{3,5})", re.IGNORECASE),
    re.compile(r"(NAVAIR\s+\d{2}[\-\s]\w+[\-\s]\w+)", re.IGNORECASE),
    re.compile(r"(TO\s+\d{1,2}[\-\s]\d{1,2}\w[\-\s]\d+)", re.IGNORECASE),
]


def _extract_tm_number(pages_text: list[str], max_pages: int = 3) -> str:
    """Extract TM/NAVAIR/TO number from the first few pages."""
    for page_text in pages_text[:max_pages]:
        for pattern in _TM_NUMBER_PATTERNS:
            match = pattern.search(page_text)
            if match:
                # Normalize whitespace/dashes
                tm_num = re.sub(r"\s+", " ", match.group(1).strip())
                return tm_num
    return "UNKNOWN"


# ---------------------------------------------------------------------------
# Distribution statement detection
# ---------------------------------------------------------------------------

_DIST_STATEMENT_RE = re.compile(r"DISTRIBUTION\s+STATEMENT\s+([A-F])", re.IGNORECASE)


def _check_distribution(pages_text: list[str], allowed: str, max_pages: int = 5) -> str:
    """Check distribution statement from first pages.

    Returns the letter found (e.g., "A") or "UNKNOWN".
    """
    for page_text in pages_text[:max_pages]:
        match = _DIST_STATEMENT_RE.search(page_text)
        if match:
            return match.group(1).upper()
    return "UNKNOWN"


# ---------------------------------------------------------------------------
# Safety block extraction
# ---------------------------------------------------------------------------

_SAFETY_BLOCK_RE = re.compile(
    r"^(WARNING|CAUTION|NOTE)\s*\n"
    r"(.+?)(?=\n(?:WARNING|CAUTION|NOTE)\s*\n|\Z)",
    re.MULTILINE | re.DOTALL,
)


def _extract_safety_blocks(
    page_text: str, page_num: int, tm_stem: str, counter: dict[str, int]
) -> list[TMChunk]:
    """Extract WARNING/CAUTION/NOTE blocks from page text."""
    chunks: list[TMChunk] = []

    for match in _SAFETY_BLOCK_RE.finditer(page_text):
        severity = match.group(1).upper()
        content = match.group(2).strip()
        if len(content) < 10:
            continue

        key = severity.lower()
        idx = counter.get(key, 0)
        counter[key] = idx + 1

        chunks.append(
            TMChunk(
                chunk_id=f"{tm_stem}_p{page_num}_{key}{idx}",
                page_num=page_num,
                chunk_type=severity.lower(),
                content=content,
                char_count=len(content),
                severity=severity,
            )
        )

    return chunks


# ---------------------------------------------------------------------------
# Section heading → chunk_type classifier (MIL-STD-38784 conventions)
# ---------------------------------------------------------------------------

_SECTION_TYPE_MAP: list[tuple[re.Pattern, str]] = [
    (re.compile(r"THEORY|PRINCIPLES?\s+OF\s+OPERATION", re.IGNORECASE), "theory"),
    (
        re.compile(
            r"GENERAL\s+(?:INFORMATION|DESCRIPTION)|DESCRIPTION\s+AND\s+DATA|^GENERAL$",
            re.IGNORECASE,
        ),
        "general_principle",
    ),
    (
        re.compile(
            r"MAINTENANCE|TROUBLESHOOTING|REMOVAL|INSTALLATION|REPAIR"
            r"|INSPECTION|ASSEMBLY|DISASSEMBLY|ADJUSTMENT|ALIGNMENT",
            re.IGNORECASE,
        ),
        "procedure",
    ),
    (re.compile(r"PMCS|PREVENTIVE\s+MAINTENANCE", re.IGNORECASE), "pmcs"),
    (re.compile(r"PARTS?\s+LIST|COMPONENTS?\s+OF\s+END\s+ITEM", re.IGNORECASE), "parts"),
]


def _classify_section_type(heading: str) -> str:
    """Classify a section heading into a chunk_type.

    Returns one of: theory, general_principle, procedure, pmcs, parts, text.
    """
    if not heading:
        return "text"
    for pattern, chunk_type in _SECTION_TYPE_MAP:
        if pattern.search(heading):
            return chunk_type
    return "text"


# ---------------------------------------------------------------------------
# Knowledge abstraction (Ollama rewrite for theory/general_principle chunks)
# ---------------------------------------------------------------------------

_ABSTRACTION_PROMPT = (
    "You are a technical knowledge abstraction system. "
    "Rewrite the following text from a military technical manual to express "
    "the general engineering principle it describes. Remove all specific part "
    "numbers, NSN references, equipment model numbers, and military designations. "
    "Preserve all technical accuracy, physical laws, measurements, tolerances, "
    "and causal relationships. The result must apply to any similar system, "
    "not just this specific equipment. Return only the rewritten text, "
    "no explanation.\n\nOriginal text:\n"
)

_ABSTRACTABLE_TYPES = frozenset({"theory", "general_principle"})


def _call_ollama_abstraction(text: str, config: ParserConfig) -> str | None:
    """Send text to Ollama for knowledge abstraction.

    Returns the abstracted text on success, None on any error.
    Uses sync httpx.post matching the pattern in db_adapter.py and
    tools/ollama_triage_takeout.py.
    """
    try:
        resp = httpx.post(
            f"{config.ollama_base_url}/api/generate",
            json={
                "model": config.abstraction_model,
                "prompt": _ABSTRACTION_PROMPT + text,
                "stream": False,
                "options": {"temperature": 0.1},
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        result = resp.json().get("response", "").strip()
        if result:
            return result
        logger.warning("Ollama returned empty response for abstraction")
        return None
    except Exception as e:
        logger.warning("Knowledge abstraction failed (Ollama unreachable): %s", e)
        return None


def _run_knowledge_abstraction(
    chunks: list[TMChunk], config: ParserConfig
) -> list[TMChunk]:
    """Apply knowledge abstraction to theory/general_principle chunks.

    Chunks of other types pass through unchanged.
    If config.enable_knowledge_abstraction is False, returns chunks as-is.
    """
    if not config.enable_knowledge_abstraction:
        return chunks

    abstracted_count = 0
    for chunk in chunks:
        if chunk.chunk_type not in _ABSTRACTABLE_TYPES:
            continue

        original_text = chunk.content
        result = _call_ollama_abstraction(original_text, config)

        if result is not None:
            chunk.content = result
            chunk.metadata["original_text"] = original_text
            chunk.metadata["source_anonymized"] = True
            chunk.char_count = len(result)
            abstracted_count += 1
        else:
            # Ollama failed — keep original text, log already emitted
            pass

    if abstracted_count:
        logger.info("  Abstracted %d theory/general_principle chunks", abstracted_count)

    return chunks


# ---------------------------------------------------------------------------
# Table extraction and classification
# ---------------------------------------------------------------------------

_PMCS_KEYWORDS = {"interval", "procedure", "not fully mission capable", "item no", "item"}
_CALLOUT_KEYWORDS = {"nomenclature", "part number", "nsn", "national stock number", "item"}


def _classify_table(headers: list[str]) -> str:
    """Classify a table as pmcs, callout, or generic based on column headers."""
    if not headers:
        return "generic"

    header_lower = {h.lower().strip() for h in headers if h}

    pmcs_score = len(header_lower & _PMCS_KEYWORDS)
    callout_score = len(header_lower & _CALLOUT_KEYWORDS)

    if pmcs_score >= 2:
        return "pmcs"
    if callout_score >= 2:
        return "callout"
    return "generic"


def _extract_tables(pdf_path: Path, tm_stem: str) -> list[TMChunk]:
    """Extract tables from PDF using pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        logger.error("pdfplumber not installed. Run: uv pip install pdfplumber")
        return []

    chunks: list[TMChunk] = []
    table_counter = 0

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # First row is headers
                    raw_headers = [str(cell or "").strip() for cell in table[0]]
                    if not any(raw_headers):
                        continue

                    rows = []
                    for row in table[1:]:
                        cleaned = [str(cell or "").strip() for cell in row]
                        if any(cleaned):
                            rows.append(cleaned)

                    if not rows:
                        continue

                    table_type = _classify_table(raw_headers)

                    # Build text representation for content field
                    content_lines = [" | ".join(raw_headers)]
                    for row in rows:
                        content_lines.append(" | ".join(row))
                    content = "\n".join(content_lines)

                    chunks.append(
                        TMChunk(
                            chunk_id=f"{tm_stem}_p{page_idx + 1}_tbl{table_counter}",
                            page_num=page_idx + 1,
                            chunk_type="table",
                            content=content,
                            char_count=len(content),
                            table_type=table_type,
                            headers=raw_headers,
                            rows=rows,
                        )
                    )
                    table_counter += 1
    except Exception as e:
        logger.error("Table extraction failed for %s: %s", pdf_path.name, e)

    return chunks


# ---------------------------------------------------------------------------
# Image extraction (PyMuPDF)
# ---------------------------------------------------------------------------


def _extract_images(
    pdf_path: Path, config: ParserConfig, images_dir: Path, tm_stem: str
) -> list[TMChunk]:
    """Extract embedded images from PDF using PyMuPDF (fitz)."""
    try:
        import fitz
    except ImportError:
        logger.error("PyMuPDF not installed. Run: uv pip install PyMuPDF")
        return []

    chunks: list[TMChunk] = []
    images_dir.mkdir(parents=True, exist_ok=True)
    img_counter = 0

    try:
        doc = fitz.open(pdf_path)
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            images = page.get_images(full=True)

            for img_info in images:
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                except Exception:
                    continue

                if not base_image:
                    continue

                img_bytes = base_image["image"]
                img_ext = base_image.get("ext", "png")
                width = base_image.get("width", 0)
                height = base_image.get("height", 0)

                # Filter by minimum dimensions
                if width < config.min_image_width or height < config.min_image_height:
                    continue

                # Save image
                img_filename = f"page{page_idx + 1}_img{img_counter}.{img_ext}"
                img_path = images_dir / img_filename
                img_path.write_bytes(img_bytes)

                # Try to find adjacent text (figure caption)
                adjacent_text = _find_adjacent_text(page, img_info)

                # Relative path from data/ root for portability
                relative_path = f"tm_images/{tm_stem}/{img_filename}"

                chunks.append(
                    TMChunk(
                        chunk_id=f"{tm_stem}_p{page_idx + 1}_img{img_counter}",
                        page_num=page_idx + 1,
                        chunk_type="image",
                        image_path=relative_path,
                        adjacent_text=adjacent_text,
                        width=width,
                        height=height,
                    )
                )
                img_counter += 1

        doc.close()
    except Exception as e:
        logger.error("Image extraction failed for %s: %s", pdf_path.name, e)

    return chunks


_FIGURE_RE = re.compile(r"(?:Figure|Fig\.?)\s+\d+[\-\.]\d+[^.\n]*", re.IGNORECASE)


def _find_adjacent_text(page, img_info) -> str:
    """Try to find figure caption text near an image on the page."""
    try:
        page_text = page.get_text("text") or ""
        # Look for "Figure X-Y" patterns
        match = _FIGURE_RE.search(page_text)
        if match:
            return match.group(0).strip()
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# Text chunk extraction
# ---------------------------------------------------------------------------


def _extract_text_chunks(pdf_path: Path, config: ParserConfig, tm_stem: str) -> list[TMChunk]:
    """Extract text chunks from PDF using pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        logger.error("pdfplumber not installed")
        return []

    chunks: list[TMChunk] = []
    chunk_counter = 0
    safety_counter: dict[str, int] = {}

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                raw_text = page.extract_text()
                if not raw_text or len(raw_text.strip()) < 50:
                    continue

                text = _clean_text(raw_text)

                # Extract safety blocks first
                safety_chunks = _extract_safety_blocks(text, page_idx + 1, tm_stem, safety_counter)
                chunks.extend(safety_chunks)

                # Section-aware text extraction
                sections = _detect_sections(text)
                if not sections:
                    sections = [("", text)]

                for heading, body in sections:
                    # Skip if this section is just a safety block we already extracted
                    if heading.upper() in ("WARNING", "CAUTION", "NOTE"):
                        continue

                    section_type = _classify_section_type(heading)

                    if len(body) <= config.chunk_size:
                        if len(body) >= 80:
                            chunks.append(
                                TMChunk(
                                    chunk_id=f"{tm_stem}_p{page_idx + 1}_c{chunk_counter}",
                                    page_num=page_idx + 1,
                                    chunk_type=section_type,
                                    content=body,
                                    section=heading,
                                    char_count=len(body),
                                )
                            )
                            chunk_counter += 1
                    else:
                        for piece in _chunk_text(body, config.chunk_size, config.chunk_overlap):
                            chunks.append(
                                TMChunk(
                                    chunk_id=f"{tm_stem}_p{page_idx + 1}_c{chunk_counter}",
                                    page_num=page_idx + 1,
                                    chunk_type=section_type,
                                    content=piece,
                                    section=heading,
                                    char_count=len(piece),
                                )
                            )
                            chunk_counter += 1
    except Exception as e:
        logger.error("Text extraction failed for %s: %s", pdf_path.name, e)

    return chunks


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def _get_page_texts(pdf_path: Path) -> tuple[list[str], int]:
    """Get text from all pages for metadata extraction. Returns (texts, page_count)."""
    try:
        import pdfplumber
    except ImportError:
        return [], 0

    texts = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            total = len(pdf.pages)
            for page in pdf.pages:
                raw = page.extract_text() or ""
                texts.append(raw)
    except Exception as e:
        logger.error("Failed to read PDF %s: %s", pdf_path.name, e)
        return [], 0

    return texts, total


def parse_tm_pdf(pdf_path: Path, config: ParserConfig | None = None) -> TMManifest | None:
    """Parse a single TM PDF into a structured manifest.

    Returns TMManifest on success, None on failure.
    """
    if config is None:
        config = ParserConfig()

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        logger.error("PDF not found: %s", pdf_path)
        return None

    tm_stem = pdf_path.stem
    logger.info("Parsing: %s", pdf_path.name)

    # Step 1: Read page texts for metadata
    pages_text, total_pages = _get_page_texts(pdf_path)
    if not pages_text:
        logger.warning("No readable text in %s", pdf_path.name)
        return None

    # Step 2: Extract TM number
    tm_number = _extract_tm_number(pages_text)
    logger.info("  TM number: %s", tm_number)

    # Step 3: Check distribution statement
    dist = _check_distribution(pages_text, config.allowed_distribution)
    if dist != "UNKNOWN" and dist != config.allowed_distribution:
        logger.warning(
            "  Distribution Statement %s — skipping (only %s allowed)",
            dist,
            config.allowed_distribution,
        )
        return None
    if dist == "UNKNOWN":
        logger.info("  Distribution statement not found — proceeding with caution")

    # Step 4: Extract all chunk types
    text_chunks = _extract_text_chunks(pdf_path, config, tm_stem)

    images_dir = config.tm_images_dir / tm_stem
    image_chunks = _extract_images(pdf_path, config, images_dir, tm_stem)

    table_chunks = _extract_tables(pdf_path, tm_stem)

    # Combine all chunks
    all_chunks = text_chunks + image_chunks + table_chunks

    # Knowledge abstraction pass (theory/general_principle chunks only)
    all_chunks = _run_knowledge_abstraction(all_chunks, config)

    # Build summary
    summary = {
        "text_chunks": sum(1 for c in all_chunks if c.chunk_type == "text"),
        "images": sum(1 for c in all_chunks if c.chunk_type == "image"),
        "warnings": sum(1 for c in all_chunks if c.chunk_type == "warning"),
        "cautions": sum(1 for c in all_chunks if c.chunk_type == "caution"),
        "notes": sum(1 for c in all_chunks if c.chunk_type == "note"),
        "tables": sum(1 for c in all_chunks if c.chunk_type == "table"),
        "pmcs_tables": sum(
            1 for c in all_chunks if c.chunk_type == "table" and c.table_type == "pmcs"
        ),
        "callout_tables": sum(
            1 for c in all_chunks if c.chunk_type == "table" and c.table_type == "callout"
        ),
    }

    manifest = TMManifest(
        tm_number=tm_number,
        source_pdf=pdf_path.name,
        parsed_at=datetime.now(timezone.utc).isoformat(),
        total_pages=total_pages,
        distribution_statement=dist,
        chunks=all_chunks,
        summary=summary,
    )

    logger.info(
        "  Extracted: %d text, %d images, %d warnings, %d cautions, %d tables",
        summary["text_chunks"],
        summary["images"],
        summary["warnings"],
        summary["cautions"],
        summary["tables"],
    )

    return manifest


# ---------------------------------------------------------------------------
# Manifest I/O
# ---------------------------------------------------------------------------


def _manifest_to_dict(manifest: TMManifest) -> dict:
    """Convert manifest to JSON-serializable dict."""
    d = asdict(manifest)
    # Clean up empty fields from chunks for readability
    for chunk in d["chunks"]:
        keys_to_remove = []
        for k, v in chunk.items():
            if v in ("", 0, [], {}) or (k == "char_count" and v == 0):
                if k not in ("chunk_id", "page_num", "chunk_type", "content"):
                    keys_to_remove.append(k)
        for k in keys_to_remove:
            del chunk[k]
    return d


def write_manifest(manifest: TMManifest, output_dir: Path) -> Path:
    """Write manifest JSON to output directory. Returns path to manifest file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(manifest.source_pdf).stem
    manifest_path = output_dir / f"{stem}.json"

    data = _manifest_to_dict(manifest)
    manifest_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info("  Manifest written: %s", manifest_path)
    return manifest_path


def read_manifest(manifest_path: Path) -> dict:
    """Read a manifest JSON file."""
    return json.loads(manifest_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------


def parse_directory(pdf_dir: Path, config: ParserConfig | None = None) -> list[TMManifest]:
    """Parse all PDFs in a directory."""
    if config is None:
        config = ParserConfig()

    pdf_files = sorted(pdf_dir.glob("*.pdf"))
    if not pdf_files:
        logger.warning("No PDF files found in %s", pdf_dir)
        return []

    logger.info("Found %d PDFs in %s", len(pdf_files), pdf_dir)
    manifests = []

    for pdf_path in pdf_files:
        manifest = parse_tm_pdf(pdf_path, config)
        if manifest:
            write_manifest(manifest, config.tm_manifests_dir)
            manifests.append(manifest)

    logger.info("Parsed %d / %d PDFs successfully", len(manifests), len(pdf_files))
    return manifests


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_cli_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vim.tm_parser",
        description="Military Technical Manual PDF parser",
    )
    p.add_argument("--pdf", type=str, help="Parse a single PDF file")
    p.add_argument("--dir", type=str, help="Parse all PDFs in a directory")
    p.add_argument("--batch", action="store_true", help="Parse all PDFs in default tm_pdfs_dir")
    p.add_argument("--summary", type=str, help="Show summary of an existing manifest JSON")
    return p


def main() -> None:
    args = _build_cli_parser().parse_args()
    config = ParserConfig()

    if args.summary:
        manifest_path = Path(args.summary)
        if not manifest_path.exists():
            logger.error("Manifest not found: %s", manifest_path)
            return
        data = read_manifest(manifest_path)
        print(f"\n=== {data.get('tm_number', 'UNKNOWN')} ===")
        print(f"  Source:       {data.get('source_pdf')}")
        print(f"  Parsed:       {data.get('parsed_at')}")
        print(f"  Pages:        {data.get('total_pages')}")
        print(f"  Distribution: {data.get('distribution_statement')}")
        summary = data.get("summary", {})
        print(f"  Text chunks:  {summary.get('text_chunks', 0)}")
        print(f"  Images:       {summary.get('images', 0)}")
        print(f"  Warnings:     {summary.get('warnings', 0)}")
        print(f"  Cautions:     {summary.get('cautions', 0)}")
        print(f"  Notes:        {summary.get('notes', 0)}")
        print(f"  Tables:       {summary.get('tables', 0)}")
        print(f"    PMCS:       {summary.get('pmcs_tables', 0)}")
        print(f"    Callout:    {summary.get('callout_tables', 0)}")
        print(f"  Total chunks: {len(data.get('chunks', []))}")
        return

    if args.pdf:
        pdf_path = Path(args.pdf)
        manifest = parse_tm_pdf(pdf_path, config)
        if manifest:
            out = write_manifest(manifest, config.tm_manifests_dir)
            print(f"\nManifest: {out}")
            print(f"Chunks:   {len(manifest.chunks)}")
        else:
            print(f"\nFailed to parse: {pdf_path}")
        return

    if args.dir:
        parse_directory(Path(args.dir), config)
        return

    if args.batch:
        parse_directory(config.tm_pdfs_dir, config)
        return

    _build_cli_parser().print_help()


if __name__ == "__main__":
    main()
