"""Docling-backed PDF extraction adapter.

Drop-in replacement for _extract_from_pdf() in ingest_manuals.py and
ingest_gdrive_docs.py. Returns identical schema: list[dict] with keys
{text, page_num, section}. All exceptions caught; returns [] on failure.

Activated via USE_DOCLING=true env var — never call directly.

    adapter = DoclingAdapter()
    blocks = adapter.extract_from_pdf(pdf_bytes)
"""
from __future__ import annotations

import logging

logger = logging.getLogger("docling_adapter")

DEFAULT_MAX_PAGES = 300
DEFAULT_MIN_CHUNK_CHARS = 80


class DoclingAdapter:
    """Wraps DocumentConverter + HybridChunker. Stateless after init.

    Handles digital PDFs, scanned PDFs (OCR via EasyOCR), and tables
    (TableFormer → Markdown). Models are lazy-loaded on first call.
    Air-gap safe after initial ~1.2 GB model download.
    """

    def __init__(
        self,
        max_pages: int = DEFAULT_MAX_PAGES,
        min_chunk_chars: int = DEFAULT_MIN_CHUNK_CHARS,
        enable_ocr: bool = True,
    ) -> None:
        self.max_pages = max_pages
        self.min_chunk_chars = min_chunk_chars
        self.enable_ocr = enable_ocr
        self._converter = None
        self._chunker = None

    def _load(self) -> None:
        """Lazy-load Docling models on first invocation."""
        if self._converter is not None:
            return
        try:
            from docling.datamodel.pipeline_options import PdfPipelineOptions
            from docling.document_converter import DocumentConverter, PdfFormatOption
            from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
        except ImportError as e:
            raise RuntimeError(
                "docling not installed — run: uv pip install 'docling[ocr]'"
            ) from e

        opts = PdfPipelineOptions(do_ocr=self.enable_ocr, do_table_structure=True)
        self._converter = DocumentConverter(
            format_options={"pdf": PdfFormatOption(pipeline_options=opts)}
        )
        self._chunker = HybridChunker(max_tokens=512)
        logger.info("docling models loaded (ocr=%s, table_structure=true)", self.enable_ocr)

    def extract_from_pdf(self, data: bytes) -> list[dict]:
        """Extract {text, page_num, section} blocks from PDF bytes.

        Returns [] on any error — pipeline continues with zero blocks logged.
        Tables are rendered as Markdown and included in text chunks.
        Semantic chunking (HybridChunker) replaces fixed 800-char windows.
        """
        import tempfile
        from pathlib import Path

        if not data:
            return []
        try:
            self._load()
        except RuntimeError as e:
            logger.warning("DoclingAdapter unavailable: %s", e)
            return []
        try:
            # Docling requires a file path, not BytesIO
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            result = self._converter.convert(Path(tmp_path))
            doc = result.document
            if len(doc.pages) > self.max_pages:
                logger.warning(
                    "PDF exceeds max_pages (%d > %d) — skipping",
                    len(doc.pages),
                    self.max_pages,
                )
                return []
            table_count = len(doc.tables) if hasattr(doc, "tables") and doc.tables else 0
            if table_count:
                logger.info("PDF contains %d tables (rendered as Markdown in chunks)", table_count)
            blocks: list[dict] = []
            for chunk in self._chunker.chunk(doc):
                text = (chunk.text if hasattr(chunk, "text") else str(chunk)).strip()
                if len(text) < self.min_chunk_chars:
                    continue
                page_num: int = getattr(chunk, "page_num", None) or 1
                section: str | None = None
                meta = getattr(chunk, "metadata", None)
                if meta:
                    section = meta.get("heading") or meta.get("section")
                blocks.append({"text": text, "page_num": page_num, "section": section})
            logger.info(
                "docling: extracted %d blocks from %d pages (tables=%d)",
                len(blocks),
                len(doc.pages),
                table_count,
            )
            return blocks
        except Exception as e:
            logger.warning("docling extraction failed: %s (%s)", e, type(e).__name__)
            return []
        finally:
            import os
            try:
                os.unlink(tmp_path)
            except (OSError, UnboundLocalError):
                pass
