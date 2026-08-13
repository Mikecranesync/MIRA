"""Docling adapter: PDF → DoclingDocument → Experiment IR.

Runs inside .venv-docling (py 3.11). Emits the same IR as the other parser
lanes; tables carry both the row-context serialization (table_aware_text) and
their bbox provenance from Docling's ProvenanceItem — the anchor quality the
native-provider lane structurally cannot give us.

Run: .venv-docling/Scripts/python adapters/parse_docling.py fixtures/x.pdf out/ir/x.docling.json [--no-ocr]
"""

from __future__ import annotations

import sys
from importlib.metadata import version as pkg_version
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from ir import ExpBlock, ExpDoc, ExpPage, sha256_file, table_aware_text


def parse(pdf_path: Path, doc_id: str, ocr: bool) -> ExpDoc:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.do_ocr = ocr
    opts.do_table_structure = True
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )
    dl = converter.convert(str(pdf_path)).document

    exp = ExpDoc(
        doc_id=doc_id,
        source_path=str(pdf_path),
        sha256=sha256_file(pdf_path),
        parser="docling" + ("" if ocr else "-noocr"),
        parser_version=pkg_version("docling"),
    )
    pages: dict[int, ExpPage] = {}

    def page_for(n: int) -> ExpPage:
        if n not in pages:
            pages[n] = ExpPage(number=n)
        return pages[n]

    def anchor_of(item) -> dict | None:
        prov = getattr(item, "prov", None) or []
        if not prov:
            return None
        p = prov[0]
        bbox = getattr(p, "bbox", None)
        return {
            "page": p.page_no,
            "bbox": [bbox.l, bbox.t, bbox.r, bbox.b] if bbox is not None else None,
        }

    for item in getattr(dl, "texts", []):
        a = anchor_of(item)
        if a is None:
            continue
        label = str(getattr(item, "label", "text"))
        kind = "heading" if "header" in label or "title" in label else "text"
        page_for(a["page"]).blocks.append(
            ExpBlock(kind=kind, text=item.text or "", anchor=a, method=f"docling.{label}")
        )

    for item in getattr(dl, "tables", []):
        a = anchor_of(item)
        if a is None:
            continue
        try:
            grid = item.data.grid
            cells = [[(c.text or "") for c in row] for row in grid]
        except Exception:  # noqa: BLE001
            cells = []
        page_for(a["page"]).blocks.append(
            ExpBlock(
                kind="table",
                text=table_aware_text(cells),
                table={"n_rows": len(cells), "n_cols": len(cells[0]) if cells else 0},
                anchor=a,
                method="docling.table",
            )
        )

    exp.pages = [pages[n] for n in sorted(pages)]
    return exp


if __name__ == "__main__":
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    ocr = "--no-ocr" not in sys.argv
    out.parent.mkdir(parents=True, exist_ok=True)
    parse(pdf, pdf.stem, ocr).dump(out)
    print(f"wrote {out}")
