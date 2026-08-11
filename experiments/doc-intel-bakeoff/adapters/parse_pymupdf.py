"""Parser control lane: pymupdf plain text → Experiment IR.

This is the '#3185-shaped' representation (per-page raw text, no structure) fed
through the SAME held-constant FTS5 retrieval as every other parser lane — so
any win by Docling/table-aware lanes is attributable to the representation, not
the retriever. Also emits a table-aware VARIANT using pymupdf's own find_tables()
so we can measure "cheap table extraction" without any ML parser.

Run (base python): py adapters/parse_pymupdf.py fixtures/x.pdf out/ir/x.pymupdf.json
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import fitz  # pymupdf

from ir import ExpBlock, ExpDoc, ExpPage, sha256_file, table_aware_text


def parse(pdf_path: Path, doc_id: str, with_tables: bool) -> ExpDoc:
    doc = fitz.open(pdf_path)
    exp = ExpDoc(
        doc_id=doc_id,
        source_path=str(pdf_path),
        sha256=sha256_file(pdf_path),
        parser="pymupdf" + ("+tables" if with_tables else ""),
        parser_version=fitz.pymupdf_version,
    )
    for i, page in enumerate(doc):
        p = ExpPage(number=i + 1)
        p.blocks.append(
            ExpBlock(kind="text", text=page.get_text(), method="pymupdf.get_text")
        )
        if with_tables:
            try:
                for t in page.find_tables():
                    cells = [
                        [c if c is not None else "" for c in row] for row in t.extract()
                    ]
                    p.blocks.append(
                        ExpBlock(
                            kind="table",
                            text=table_aware_text(cells),
                            table={"n_rows": len(cells), "n_cols": len(cells[0]) if cells else 0},
                            anchor={"page": i + 1, "bbox": list(t.bbox)},
                            method="pymupdf.find_tables",
                        )
                    )
            except Exception as e:  # noqa: BLE001 — a page's table pass must not kill the doc
                p.blocks.append(ExpBlock(kind="text", text="", method=f"find_tables_error:{e}"))
        exp.pages.append(p)
    return exp


if __name__ == "__main__":
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    with_tables = "--tables" in sys.argv
    doc_id = pdf.stem
    out.parent.mkdir(parents=True, exist_ok=True)
    parse(pdf, doc_id, with_tables).dump(out)
    print(f"wrote {out}")
