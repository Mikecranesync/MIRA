"""B2: run one Docling variant over the frozen benchmark pages; write markdown + timing.

  venv-docling/bin/python extract_docling.py {v1|v2|off} <out_dir>
v1 = default TableFormer (CDLA-pinned weights), v2 = TableFormerV2 (Apache-2.0), off = no table structure.
One variant per process so peak RSS is attributable.
"""

from __future__ import annotations

import json
import resource
import sys
import time
from pathlib import Path

DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench")
SEL = Path(__file__).resolve().parents[1] / "data/bench_pages.json"


def main(variant: str, out: Path) -> None:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableStructureV2Options
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    if variant == "off":
        opts.do_table_structure = False
    elif variant == "v2":
        opts.table_structure_options = TableStructureV2Options()
    conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    pdfs = {c["manual"]: c["pdf"] for c in json.loads((DATA / "candidates.json").read_text())}
    out.mkdir(parents=True, exist_ok=True)
    timing = {}
    for manual, pages in json.loads(SEL.read_text())["pages"].items():
        for p in pages:
            t0 = time.perf_counter()
            res = conv.convert(pdfs[manual], page_range=(p, p))
            md = res.document.export_to_markdown()
            timing[f"{manual}:{p}"] = round(time.perf_counter() - t0, 2)
            (out / f"{manual}_p{p}.md").write_text(md)
            print(variant, manual, p, timing[f"{manual}:{p}"], flush=True)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20
    (out / "timing.json").write_text(json.dumps({"variant": variant, "seconds": timing, "max_rss_mb": round(rss)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
