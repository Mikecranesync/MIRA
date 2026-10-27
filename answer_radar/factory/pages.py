"""Build the evidence page corpus from locally held OEM manuals (spec section 4B).

Each PDF becomes one `ManualPage` per page, keyed by the file's own sha256. Manufacturer and
model come from the same deterministic extractor the questions use, read off the first
pages; unknown stays empty (never guessed). Manual text is not redistributable, so the
corpus is written only to a private path outside git.
"""

from __future__ import annotations

import hashlib
import subprocess
from collections import Counter
from pathlib import Path

from answer_radar.factory.discovery import normalize


def pdf_pages(pdf: Path) -> list[str]:
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, check=True)  # noqa: S603,S607
    return out.stdout.decode("utf-8", "replace").split("\f")


def identify(pages: list[str]) -> tuple[str, str]:
    """Most frequent manufacturer and model named on the first five pages."""
    makers, models = Counter(), Counter()
    for text in pages[:5]:
        n = normalize(text)
        if n["manufacturer"]:
            makers[n["manufacturer"]] += 1
        if n["model"]:
            models[n["model"]] += 1
    return (
        makers.most_common(1)[0][0] if makers else "",
        models.most_common(1)[0][0] if models else "",
    )


def build_pages(manual_dir: Path, source_id: str = "oem_manuals") -> list[dict]:
    corpus = []
    for pdf in sorted(manual_dir.glob("*.pdf")):
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        pages = pdf_pages(pdf)
        maker, model = identify(pages)
        for i, text in enumerate(pages, start=1):
            if text.strip():
                corpus.append(
                    {
                        "source_id": source_id,
                        "doc_sha256": sha,
                        "page": i,
                        "text": text,
                        "manufacturer": maker,
                        "model": model,
                    }
                )
    return corpus
