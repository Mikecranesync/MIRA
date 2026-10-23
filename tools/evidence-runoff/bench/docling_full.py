"""T4: Docling over whole manuals, OCR off, one markdown file per page. One variant per process.

  venv-docling/bin/python docling_full.py {v1|off} <out_root>
"""

from __future__ import annotations

import json
import resource
import sys
import time
from pathlib import Path

ROOT = Path("/Users/charlienode/MIRA/.planning/retrieval-phase0")
DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
HERE = Path(__file__).resolve().parent


def manuals() -> dict[str, Path]:
    out = {k: ROOT / v for k, v in json.loads((HERE / "manuals_t4.json").read_text())["real"].items()}
    for m in json.loads((DATA / "public-50.json").read_text())["manuals"]:
        out[m["id"]] = ROOT / "manuals" / f"{m['sha256']}.pdf"
    return out


def main(variant: str, root: Path) -> None:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.do_ocr = False
    opts.do_table_structure = variant != "off"
    conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    timing = {}
    for mid, pdf in manuals().items():
        out = root / variant / mid
        if (out / "_done").exists():
            continue
        out.mkdir(parents=True, exist_ok=True)
        t0 = time.perf_counter()
        doc = conv.convert(str(pdf)).document
        n = doc.num_pages()
        for p in range(1, n + 1):
            (out / f"p{p}.md").write_text(doc.export_to_markdown(page_no=p))
        timing[mid] = {"pages": n, "seconds": round(time.perf_counter() - t0, 1)}
        (out / "_done").write_text(json.dumps(timing[mid]))
        print(variant, mid, timing[mid], flush=True)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20
    (root / f"{variant}_timing.json").write_text(json.dumps({"manuals": timing, "max_rss_mb": round(rss)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
