"""B2-H: score the held-out table gold with the FROZEN scorer, unmodified.

score_tables.py hardcodes the round-1 output dir and gold path. Rather than edit the pinned file
(sha256 0e2a0cc9…), this wrapper imports it and redirects only its two inputs and its output dir:
  st.OUT  -> bench/out_h
  st.HERE -> a staging dir holding data/bench_gold.jsonl = heldout_gold.jsonl, and results/
Scoring logic is untouched; the scorer's sha256 is checked before running.

Headline Docling-off / Docling-v1 held-out pages are converted one page at a time, as in round 1
(extract_docling.py, BENCH_OCR_OFF=1). `link` adds a SECONDARY copy taken from the whole-manual
conversion (docling_full.py, t4/), only after the source PDFs are proved byte-identical (sha256).

  python3 heldout_b2.py link      # link t4 pages into out_h/docling-{off,v1}-whole (secondary); refuses on any mismatch
  python3 heldout_b2.py score     # run the frozen scorer on held-out
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
ROOT = Path("/Users/charlienode/MIRA/.planning/retrieval-phase0")
OUT_H = DATA / "bench/out_h"
FROZEN_SHA = "0e2a0cc9442535fb7323c6d1ad7d6f86aa6b20b050f7366ae82fe01906f4fe3e"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def t4_manuals() -> dict[str, Path]:
    out = {
        k: ROOT / v for k, v in json.loads((HERE / "manuals_t4.json").read_text())["real"].items()
    }
    for m in json.loads((DATA / "public-50.json").read_text())["manuals"]:
        out[m["id"]] = ROOT / "manuals" / f"{m['sha256']}.pdf"
    return out


def mapping() -> dict[str, str]:
    """held-out manual id -> t4 manual id, matched by PDF sha256."""
    by_sha = {sha(p): mid for mid, p in t4_manuals().items()}
    m = {}
    for c in json.loads((DATA / "bench/heldout_candidates.json").read_text()):
        h = sha(Path(c["pdf"]))
        if h not in by_sha:
            raise SystemExit(f"no T4 manual with the same bytes as {c['manual']} ({c['pdf']})")
        m[c["manual"]] = by_sha[h]
    return m


def link() -> None:
    m = mapping()
    pages = json.loads((DATA / "bench/heldout_sel.json").read_text())["pages"]
    for variant in ("off", "v1"):
        dst = OUT_H / f"docling-{variant}-whole"
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        for manual, ps in pages.items():
            src_dir = DATA / "t4" / variant / m[manual]
            if not (src_dir / "_done").exists():
                raise SystemExit(f"{variant}/{m[manual]} not finished; refusing a partial link")
            for p in ps:
                src = src_dir / f"p{p}.md"
                if not src.exists():
                    raise SystemExit(f"missing {src}")
                shutil.copyfile(src, dst / f"{manual}_p{p}.md")
                n += 1
        print(variant, "pages linked:", n)
    print(json.dumps(m, indent=1))


def score() -> None:
    src = HERE / "score_tables.py"
    if sha(src) != FROZEN_SHA:
        raise SystemExit("score_tables.py is not the frozen scorer")
    spec = importlib.util.spec_from_file_location("score_tables", src)
    st = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(st)
    stage = DATA / "bench/b2h_stage"
    (stage / "data").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(HERE.parent / "data/heldout_gold.jsonl", stage / "data/bench_gold.jsonl")
    st.OUT, st.HERE = OUT_H, stage
    st.main()
    res = HERE.parent / "results"
    res.mkdir(exist_ok=True)
    shutil.copyfile(stage / "results/bench_tables.json", res / "heldout_tables.json")


if __name__ == "__main__":
    {"link": link, "score": score}[sys.argv[1]]()
