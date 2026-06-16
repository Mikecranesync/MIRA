"""Side-by-side PDF extraction evaluation: pdfplumber vs. Docling.

Runs both pipelines on the same PDFs and reports:
  - Chunk count and average chunk length
  - Table detection count (Docling only)
  - BM25 hit rate on 5 standard industrial test queries
  - First 3 chunks side-by-side (truncated)

Decision gate: if Docling hit_rate >= pdfplumber AND tables_found > 0
→ recommend enabling USE_DOCLING=true in Doppler prd.

Usage:
    # Install in isolated venv first:
    #   python -m venv bravo/venv_test
    #   source bravo/venv_test/bin/activate
    #   pip install 'docling[ocr]' pdfplumber

    python bravo/evaluate_pipelines.py path/to/manual.pdf [more.pdf ...]
        --output bravo/research/02_benchmark_results.json
        --report bravo/research/02_docling_capability_map.md
"""
from __future__ import annotations

import argparse
import datetime
import io
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("evaluate_pipelines")

# Point at ingest scripts so pdfplumber helpers are importable
_SCRIPTS = Path(__file__).resolve().parent.parent / "mira-core" / "scripts"
sys.path.insert(0, str(_SCRIPTS))

TEST_QUERIES = [
    "motor speed control settings",
    "maintenance schedule hours",
    "fault diagnosis troubleshooting",
    "wiring diagram pinout connections",
    "thermal protection specifications",
]


# --------------- pdfplumber baseline ----------------------------------------

def _extract_with_pdfplumber(data: bytes, max_pages: int = 300) -> list[dict]:
    """pdfplumber + fixed 800-char chunking (mirrors ingest_manuals.py)."""
    import re

    try:
        import pdfplumber
    except ImportError:
        log.error("pdfplumber not installed — pip install pdfplumber")
        return []

    CHUNK_SIZE = 800
    CHUNK_OVERLAP = 100
    MIN_CHUNK_CHARS = 80
    _BOILERPLATE = re.compile(r"(?:^\d{1,4}$)|(?:www\.\S+\.com)", re.MULTILINE)

    def _clean(text: str) -> str:
        text = _BOILERPLATE.sub("", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    def _detect_sections(text: str) -> list[tuple[str, str]]:
        lines = text.splitlines()
        sections: list[tuple[str, str]] = []
        current_heading = ""
        body_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if (
                stripped
                and len(stripped) < 80
                and not stripped.endswith((".", ",", ";", ":"))
                and stripped.istitle()
                and len(stripped.split()) <= 12
            ):
                if body_lines:
                    sections.append((current_heading, "\n".join(body_lines)))
                    body_lines = []
                current_heading = stripped
            else:
                body_lines.append(line)
        if body_lines:
            sections.append((current_heading, "\n".join(body_lines)))
        return sections or [("", text)]

    def _chunk(text: str):
        start = 0
        while start < len(text):
            piece = text[start : start + CHUNK_SIZE].strip()
            if len(piece) >= MIN_CHUNK_CHARS:
                yield piece
            start += CHUNK_SIZE - CHUNK_OVERLAP

    blocks: list[dict] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as doc:
            pages = min(len(doc.pages), max_pages)
            for idx in range(pages):
                raw = doc.pages[idx].extract_text()
                if not raw or len(raw.strip()) < 50:
                    continue
                for heading, body in _detect_sections(_clean(raw)):
                    if len(body) <= CHUNK_SIZE:
                        if len(body) >= MIN_CHUNK_CHARS:
                            blocks.append({"text": body, "page_num": idx + 1, "section": heading})
                    else:
                        for piece in _chunk(body):
                            blocks.append({"text": piece, "page_num": idx + 1, "section": heading})
    except Exception as exc:
        log.warning("pdfplumber extraction failed: %s", exc)
    return blocks


# --------------- Docling extraction -----------------------------------------

def _extract_with_docling(data: bytes, max_pages: int = 300) -> list[dict]:
    """Docling + HybridChunker semantic extraction."""
    try:
        from docling_adapter import DoclingAdapter
    except ImportError:
        log.error("docling_adapter not found — check sys.path (%s)", _SCRIPTS)
        return []
    adapter = DoclingAdapter(max_pages=max_pages, enable_ocr=True)
    return adapter.extract_from_pdf(data)


# --------------- Scoring helpers --------------------------------------------

def _bm25_hit(query: str, chunks: list[dict], top_k: int = 5) -> bool:
    """Return True if any top-k BM25-scored chunk contains a query term."""
    if not chunks:
        return False
    q_terms = set(query.lower().split())

    def score(text: str) -> float:
        words = text.lower().split()
        return sum(
            words.count(t) / (words.count(t) + 1.5 * (1 - 0.75 + 0.75 * len(words) / 500))
            for t in q_terms
            if t in words
        )

    ranked = sorted(chunks, key=lambda c: score(c["text"]), reverse=True)[:top_k]
    return any(term in c["text"].lower() for c in ranked for term in q_terms)


def _retrieval_hit_rate(chunks: list[dict], queries: list[str]) -> float:
    hits = sum(1 for q in queries if _bm25_hit(q, chunks))
    return hits / len(queries) if queries else 0.0


def _avg_len(chunks: list[dict]) -> float:
    if not chunks:
        return 0.0
    return sum(len(c["text"]) for c in chunks) / len(chunks)


# --------------- Per-PDF evaluation -----------------------------------------

def evaluate_pdf(pdf_path: Path) -> dict:
    with open(pdf_path, "rb") as fh:
        data = fh.read()
    size_mb = len(data) / 1_048_576
    log.info("Evaluating %s (%.1f MB)", pdf_path.name, size_mb)

    pp_chunks = _extract_with_pdfplumber(data)
    dl_chunks = _extract_with_docling(data)

    pp_hit = _retrieval_hit_rate(pp_chunks, TEST_QUERIES)
    dl_hit = _retrieval_hit_rate(dl_chunks, TEST_QUERIES)

    # Table count: Docling logs it; we count chunks that contain Markdown tables
    dl_tables = sum(1 for c in dl_chunks if "|" in c["text"] and "---" in c["text"])

    verdict = "DOCLING_BETTER" if (dl_hit >= pp_hit and dl_tables > 0) else (
        "NEUTRAL" if dl_hit >= pp_hit else "PDFPLUMBER_BETTER"
    )

    return {
        "pdf": pdf_path.name,
        "size_mb": round(size_mb, 2),
        "pdfplumber": {
            "chunks": len(pp_chunks),
            "avg_len": round(_avg_len(pp_chunks)),
            "hit_rate": round(pp_hit, 3),
            "sample": [{"page": c["page_num"], "text": c["text"][:200]} for c in pp_chunks[:3]],
        },
        "docling": {
            "chunks": len(dl_chunks),
            "avg_len": round(_avg_len(dl_chunks)),
            "hit_rate": round(dl_hit, 3),
            "tables_detected": dl_tables,
            "sample": [{"page": c["page_num"], "text": c["text"][:200]} for c in dl_chunks[:3]],
        },
        "verdict": verdict,
    }


# --------------- Markdown report writer -------------------------------------

def _write_report(results: dict, report_path: Path) -> None:
    lines = [
        "# PDF Extraction Evaluation Report",
        "",
        f"**Generated:** {results['meta']['timestamp']}",
        f"**PDFs tested:** {results['meta']['pdf_count']}",
        "",
        "## Decision gate",
        "Enable `USE_DOCLING=true` when: Docling hit_rate ≥ pdfplumber AND tables_detected > 0",
        "",
        "## Results",
        "",
    ]
    for r in results["pdfs"]:
        if "error" in r:
            lines += [f"### {r['pdf']} — ERROR", f"```\n{r['error']}\n```", ""]
            continue
        lines += [
            f"### {r['pdf']} ({r['size_mb']} MB)  →  **{r['verdict']}**",
            "",
            "| Metric | pdfplumber | Docling |",
            "|--------|-----------|---------|",
            f"| Chunks | {r['pdfplumber']['chunks']} | {r['docling']['chunks']} |",
            f"| Avg chunk len | {r['pdfplumber']['avg_len']} chars | {r['docling']['avg_len']} chars |",
            f"| BM25 hit rate | {r['pdfplumber']['hit_rate']:.1%} | {r['docling']['hit_rate']:.1%} |",
            f"| Tables detected | — | {r['docling']['tables_detected']} |",
            "",
            "**pdfplumber sample (first chunk):**",
            f"> {r['pdfplumber']['sample'][0]['text'] if r['pdfplumber']['sample'] else '(empty)'}",
            "",
            "**Docling sample (first chunk):**",
            f"> {r['docling']['sample'][0]['text'] if r['docling']['sample'] else '(empty)'}",
            "",
        ]

    recommend = sum(1 for r in results["pdfs"] if r.get("verdict") == "DOCLING_BETTER")
    total = len([r for r in results["pdfs"] if "error" not in r])
    lines += [
        "## Recommendation",
        "",
        f"Docling improved or matched pdfplumber on **{recommend}/{total}** PDFs.",
        "",
        "```bash" if recommend >= total // 2 + 1 else "",
        "# Enable Docling in Doppler:" if recommend >= total // 2 + 1 else "",
        "doppler secrets set USE_DOCLING true --project factorylm --config prd" if recommend >= total // 2 + 1 else "",
        "```" if recommend >= total // 2 + 1 else "",
        "" if recommend < total // 2 + 1 else "",
        "⚠️  Docling did NOT show consistent improvement — keep USE_DOCLING=false" if recommend < total // 2 + 1 else "",
    ]
    report_path.write_text("\n".join(lines))
    log.info("Report written to %s", report_path)


# --------------- Entry point ------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="pdfplumber vs. Docling PDF evaluation")
    parser.add_argument("pdfs", nargs="+", help="PDF file paths")
    parser.add_argument("--output", default="bravo/research/02_benchmark_results.json")
    parser.add_argument("--report", default=None, help="Markdown report path (optional)")
    args = parser.parse_args()

    pdf_paths = [Path(p).resolve() for p in args.pdfs if Path(p).exists()]
    if not pdf_paths:
        log.error("No valid PDF paths found in: %s", args.pdfs)
        sys.exit(1)

    results: dict = {
        "meta": {
            "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
            "pdf_count": len(pdf_paths),
        },
        "pdfs": [],
    }

    for path in pdf_paths:
        try:
            results["pdfs"].append(evaluate_pdf(path))
        except Exception as exc:
            log.error("Failed to evaluate %s: %s", path.name, exc)
            results["pdfs"].append({"pdf": path.name, "error": str(exc)})

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2))
    log.info("JSON results saved to %s", out)

    if args.report:
        _write_report(results, Path(args.report))


if __name__ == "__main__":
    main()
