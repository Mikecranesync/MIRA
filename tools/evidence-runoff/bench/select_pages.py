"""B1/B2 page candidates per BENCHMARK_PLAN.md: `Table N` caption pages, minus runoff-used pages, sha-ordered."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
P0 = Path("/Users/charlienode/MIRA/.planning/retrieval-phase0")
EXTRA = [
    "upload-oem-manual-micro810.pdf",
    "upload-se-m171-performance-hardware-guide-EIO0000002030.pdf",
    "upload-se-m172-hardware-guide-EIO0000002015.pdf",
    "upload-se-x80-analog-io-35011978.pdf",
    "upload-se-lxm32a-canopen-0198441113779.pdf",
    "upload-se-premium-async-serial-35006178.pdf",
]
DOCLING_REPORT_PAGES = {  # (pdf sha256, page) of the eight runoff parser cases
    (c["pdf_sha256"], c["page"])
    for c in json.loads(Path(__file__).resolve().parents[1].joinpath("results/docling_report.json").read_text())["cases"]
}
CAPTION = re.compile(r"\bTable\s+\d")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    pub = json.loads((DATA / "public-50.json").read_text())
    manuals = [(m["id"], P0 / "manuals" / f"{m['sha256']}.pdf") for m in pub["manuals"]]
    manuals += [(n.removeprefix("upload-").removesuffix(".pdf"), P0 / "manuals" / n) for n in EXTRA]
    used: set[tuple[str, int]] = set()
    for line in (DATA / "corpus.jsonl").read_text().splitlines():
        it = json.loads(line)
        for e in it["evidence"]:
            used.add((it["manual"], e["page"]))
    out = []
    for mid, pdf in manuals:
        h = sha(pdf)
        pages = subprocess.run(["pdftotext", "-q", str(pdf), "-"], capture_output=True, text=True).stdout.split("\f")
        if pages and not pages[-1].strip():
            pages = pages[:-1]  # pdftotext ends every page, the last included, with a form feed
        cands = [
            i + 1
            for i, t in enumerate(pages)
            if CAPTION.search(t) and (mid, i + 1) not in used and (h, i + 1) not in DOCLING_REPORT_PAGES
        ]
        if len(cands) < 2:  # Amendment 1: uncaptioned manual -> every non-excluded page
            cands = [p for p in range(1, len(pages) + 1) if (mid, p) not in used and (h, p) not in DOCLING_REPORT_PAGES]
        cands.sort(key=lambda p: hashlib.sha256(f"{h}:{p}".encode()).hexdigest())
        out.append({"manual": mid, "pdf": str(pdf), "sha256": h, "n_pages": len(pages), "candidates": cands})
    Path(DATA / "bench").mkdir(exist_ok=True)
    (DATA / "bench/candidates.json").write_text(json.dumps(out, indent=1))
    for o in out:
        print(o["manual"], len(o["candidates"]), o["candidates"][:6])


if __name__ == "__main__":
    main()
