"""Parser track (P0 vs P1): Docling vs the text layer on the table pages behind real runoff failures.

Offline benchmark only — Docling's TableFormer weights carry an unresolved licence (RUNOFF_PLAN §1).
For each (manual, page): convert just that page with Docling (default pipeline: layout + TableFormer +
RapidOCR where needed), export Markdown, time it, and check whether named cell associations survive.

  venv-docling/bin/python run_docling.py <out_dir>
"""

from __future__ import annotations

import hashlib
import json
import resource
import sys
import time
from pathlib import Path

ROOT = Path("/Users/charlienode/MIRA/.planning/retrieval-phase0")
# (case id, pdf path, 1-based page, checks): each check = tokens that must sit in ONE table row (or one
# line of text) for the page to have kept the association a correct answer depends on.
CASES = [
    (
        "micro820-relay-VA",
        "manuals",
        "6dfc2d211eb1",
        19,
        [["120 V AC", "15 A", "1.5 A"], ["1800", "180"], ["Volt-Amperes"]],
    ),
    (
        "micro810-supply-columns",
        "manuals-real/oem-manual-micro810.pdf",
        None,
        57,
        [
            ["Supply voltage range", "85…263V", "20.4…26.4V DC"],
            ["2080-LC10-12QWB", "2080-LC10-12DWD"],
        ],
    ),
    ("e3-trip-class", "manuals", "aca6a4e5e285", 113, [["Trip Class", "5", "30"]]),
    (
        "e3-trip-summary",
        "manuals",
        "aca6a4e5e285",
        89,
        [["Phase Loss", "1.0 s"], ["Trip Class", "5...30"]],
    ),
    (
        "se-canopen-m12-pinout",
        "manuals-real/se-canopen-hw-setup.pdf",
        None,
        47,
        [["4", "CAN_H"], ["5", "CAN_L"], ["3", "CAN_GND"]],
    ),
    (
        "se-m171-addr-can",
        "manuals-real/se-m171-performance-hardware-guide-EIO0000002030.pdf",
        None,
        102,
        [["Addr_CAN_OB"]],
    ),
    (
        "se-tsx-ter",
        "manuals-real/se-premium-async-serial-35006178.pdf",
        None,
        55,
        [["TER"], ["mini-DIN"]],
    ),
    ("plc5-p238-garbled", "manuals-real/1785-rm001_-en-p.pdf", None, 238, [[".DLEN"], ["bit 12"]]),
]


def resolve(where: str, sha_prefix: str | None) -> Path:
    if sha_prefix is None:
        return ROOT / where
    for p in (ROOT / where).glob("*.pdf"):
        if hashlib.sha256(p.read_bytes()).hexdigest().startswith(sha_prefix):
            return p
    raise SystemExit(f"no pdf {sha_prefix}")


def rows_of(md: str) -> list[str]:
    return [ln for ln in md.splitlines() if ln.strip()]


def kept(rows: list[str], toks: list[str]) -> bool:
    norm = lambda s: " ".join(s.replace("...", "…").split()).lower()  # noqa: E731
    return any(all(norm(t) in norm(r) for t in toks) for r in rows)


def main() -> int:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    from docling.document_converter import DocumentConverter

    conv = DocumentConverter()
    report = []
    for cid, where, sha, page, checks in CASES:
        pdf = resolve(where, sha)
        t0 = time.perf_counter()
        res = conv.convert(str(pdf), page_range=(page, page))
        md = res.document.export_to_markdown()
        dt = time.perf_counter() - t0
        (out / f"{cid}.docling.md").write_text(md)
        import subprocess

        txt = subprocess.run(
            ["pdftotext", "-q", "-layout", "-f", str(page), "-l", str(page), str(pdf), "-"],
            capture_output=True,
            text=True,
        ).stdout
        raw = subprocess.run(
            ["pdftotext", "-q", "-f", str(page), "-l", str(page), str(pdf), "-"],
            capture_output=True,
            text=True,
        ).stdout
        (out / f"{cid}.pdftotext.txt").write_text(raw)
        report.append(
            {
                "case": cid,
                "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                "page": page,
                "docling_s": round(dt, 2),
                "tables": len(res.document.tables),
                "checks": [
                    {
                        "tokens": c,
                        "docling": kept(rows_of(md), c),
                        "text_plain": kept(rows_of(raw), c),
                        "text_layout": kept(rows_of(txt), c),
                    }
                    for c in checks
                ],
            }
        )
        print(json.dumps(report[-1]))
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20
    (out / "report.json").write_text(
        json.dumps({"cases": report, "max_rss_mb": round(rss)}, indent=1)
    )
    print("max_rss_mb", round(rss))
    return 0


if __name__ == "__main__":
    sys.exit(main())
