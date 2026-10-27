"""Build the evidence page corpus from locally held OEM manuals (spec section 4B).

Each PDF becomes one `ManualPage` per page, keyed by the file's own sha256. Manufacturer and
model come from the same deterministic extractor the questions use, read off the first
pages; unknown stays empty (never guessed). Manual text is not redistributable, so the
corpus is written only to a private path outside git.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from collections import Counter
from pathlib import Path

from answer_radar.factory.discovery import _MODEL, normalize

_SERIES = re.compile(r"\b[\w-]*\d+\w*[- ]series\b|\bfamily\b", re.I)


def pdf_pages(pdf: Path) -> list[str]:
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, check=True)  # noqa: S603,S607
    return out.stdout.decode("utf-8", "replace").split("\f")


def identify(pages: list[str]) -> tuple[str, str]:
    """Manufacturer and model from the first five pages.

    The model is set only when the opening pages name exactly ONE model and do not present
    the document as a series. A family manual ("PowerFlex 520-Series ... 523 and 525") stays
    model-less, so it is eligible for every model of that manufacturer: the evidence filter
    excludes pages naming a different model, and a wrong single-model tag would hide the
    right manual.
    """
    makers: Counter = Counter()
    found: dict[str, str] = {}
    family = False
    for text in pages[:5]:
        n = normalize(text)
        if n["manufacturer"]:
            makers[n["manufacturer"]] += 1
        for m in _MODEL.findall(text):
            found.setdefault(re.sub(r"[\s-]+", "", m).lower(), re.sub(r"\s+", " ", m))
        family = family or bool(_SERIES.search(text))
    model = next(iter(found.values())) if len(found) == 1 and not family else ""
    return (makers.most_common(1)[0][0] if makers else "", model)


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
