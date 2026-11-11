"""Build the review page from app.html + frozen data.json + the canonical FactoryLM tokens.

    python3 build.py --out dist [--preview] [--pdf-dir <dir with the 19 OEM PDFs>]

- Refuses to build unless data.json matches data.json.sha256 (the frozen order, page shuffle and safety order).
- Inlines docs/design/factorylm-tokens.css (the artifact frame cannot load files).
- With --pdf-dir, renders dist/pages/<manual>-p<N>.jpg with pdftoppm (150 dpi, grey). PDFs are matched by sha256
  against manual-pdfs.sha256, so the images come from the same bytes the benchmark labelled. Page images are not
  committed (about 12 MB).
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--pdf-dir")
    ap.add_argument(
        "--app",
        default=os.path.join(HERE, "app.html"),
        help="page source (mutation tests pass a mutated copy)",
    )
    a = ap.parse_args()
    want = open(os.path.join(HERE, "data.json.sha256")).read().split()[0]
    got = sha(os.path.join(HERE, "data.json"))
    if got != want:
        sys.exit(f"data.json sha256 {got} != frozen {want}; refusing to build")
    raw = open(os.path.join(HERE, "data.json"), encoding="utf-8").read()
    data = json.loads(raw)
    tokens = open(
        os.path.join(REPO, "docs", "design", "factorylm-tokens.css"), encoding="utf-8"
    ).read()
    page = open(a.app, encoding="utf-8").read()
    page = page.replace("__TOKENS__", tokens).replace(
        "__PREVIEW__", "true" if a.preview else "false"
    )
    page = page.replace("__DATA__", raw.strip().replace("<", "\\u003c"))
    os.makedirs(a.out, exist_ok=True)
    name = "mike-review-v2-preview.html" if a.preview else "mike-review-v2.html"
    open(os.path.join(a.out, name), "w", encoding="utf-8").write(page)
    # The artifact host wraps the page in a UTF-8 skeleton at publish time; tests load the same wrapping locally.
    skeleton = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" '
        'content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    )
    open(os.path.join(a.out, name.replace(".html", ".local.html")), "w", encoding="utf-8").write(
        skeleton + page + "</body></html>"
    )
    print(f"{name}: {len(page)} bytes, data sha256 {got}")
    if a.pdf_dir:
        by_sha = {}
        for root, _, files in os.walk(a.pdf_dir):
            for f in files:
                if f.lower().endswith(".pdf"):
                    p = os.path.join(root, f)
                    by_sha[sha(p)] = p
        manual_pdf = {}
        for line in open(os.path.join(HERE, "manual-pdfs.sha256")):
            h, key, _ = line.split(maxsplit=2)
            if h in by_sha:
                manual_pdf[key] = by_sha[h]
        os.makedirs(os.path.join(a.out, "pages"), exist_ok=True)
        n = 0
        for f in data["forum"]:
            if f["manual"] not in manual_pdf:
                sys.exit(f"missing PDF for manual {f['manual']}")
            for p in f["pages"]:
                stem = os.path.join(a.out, "pages", f"{f['manual']}-p{p}")
                if not os.path.exists(stem + ".jpg"):
                    subprocess.run(
                        [
                            "pdftoppm",
                            "-r",
                            "150",
                            "-gray",
                            "-jpeg",
                            "-jpegopt",
                            "quality=60",
                            "-f",
                            str(p),
                            "-l",
                            str(p),
                            "-singlefile",
                            manual_pdf[f["manual"]],
                            stem,
                        ],
                        check=True,
                    )
                n += 1
        print(f"pages: {n} images in {a.out}/pages")


if __name__ == "__main__":
    main()
