"""Memory-bounded Docling parsing: split the PDF into page batches, parse each
in a FRESH .venv-docling subprocess (bounds RAM: this 16GB box bad_alloc'd on
whole-manual parses with Docker running), then merge part-IRs with corrected
page numbers into one ExpDoc.

Run (BASE python): py adapters/parse_docling_batched.py fixtures/x.pdf out/ir/x.docling.json [--ocr] [--batch 40]
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import fitz  # pymupdf (base env)

from ir import ExpDoc, ExpPage, sha256_file

ROOT = Path(__file__).parent.parent
VENV_PY = ROOT / ".venv-docling" / "Scripts" / "python.exe"


def main() -> None:
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    ocr = "--ocr" in sys.argv
    batch = int(sys.argv[sys.argv.index("--batch") + 1]) if "--batch" in sys.argv else 40

    src = fitz.open(pdf)
    n = src.page_count
    merged = ExpDoc(
        doc_id=pdf.stem,
        source_path=str(pdf),
        sha256=sha256_file(pdf),
        parser="docling-batched" + ("-ocr" if ocr else ""),
        parser_version="",
    )

    with tempfile.TemporaryDirectory() as td:
        for start in range(0, n, batch):
            end = min(start + batch, n)
            part_pdf = Path(td) / f"part_{start:04d}.pdf"
            part_ir = Path(td) / f"part_{start:04d}.json"
            piece = fitz.open()
            piece.insert_pdf(src, from_page=start, to_page=end - 1)
            piece.save(part_pdf)
            piece.close()

            cmd = [str(VENV_PY), str(ROOT / "adapters" / "parse_docling.py"), str(part_pdf), str(part_ir)]
            if not ocr:
                cmd.append("--no-ocr")
            env = {
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
                "OMP_NUM_THREADS": "4",
                # torch.compile needs a C++ compiler ('cl') absent on this box —
                # docling's models die in dynamo/inductor without this off-switch.
                "TORCHDYNAMO_DISABLE": "1",
                "TORCH_COMPILE_DISABLE": "1",
            }
            proc = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", env=env, timeout=1800
            )
            if proc.returncode != 0:
                print(f"[batch {start}-{end}] FAILED:\n{(proc.stderr or '')[-800:]}", file=sys.stderr)
                raise SystemExit(2)

            part = ExpDoc.load(part_ir)
            merged.parser_version = merged.parser_version or part.parser_version
            for page in part.pages:
                real = page.number + start
                for b in page.blocks:
                    if b.anchor:
                        b.anchor["page"] = real
                merged.pages.append(ExpPage(number=real, blocks=page.blocks))
            print(f"[batch {start}-{end}] ok — {len(part.pages)} pages", flush=True)

    merged.pages.sort(key=lambda p: p.number)
    out.parent.mkdir(parents=True, exist_ok=True)
    merged.dump(out)
    print(f"wrote {out} ({len(merged.pages)} pages)")


if __name__ == "__main__":
    main()
