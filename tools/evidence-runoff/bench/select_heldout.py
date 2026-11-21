"""T2 held-out pages: continue each round-1 candidate list past every page round 1 examined; new manuals
get the round-1 rule (+ Amendment 1). Writes bench/heldout_candidates.json."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
ROOT = Path("/Users/charlienode/MIRA/.planning/retrieval-phase0")
NEW = {"gs4-ch2": "manuals-real/ch2.pdf", "gs4-ch6": "manuals-real/ch6.pdf", "se-canopen-hw": "manuals-real/se-canopen-hw-setup.pdf"}
CAPTION = re.compile(r"\bTable\s+\d")


def used_pages() -> set[tuple[str, int]]:
    used = set()
    for line in (DATA / "corpus.jsonl").read_text().splitlines():
        it = json.loads(line)
        for e in it["evidence"]:
            used.add((it["manual"], e["page"]))
    return used


def main() -> None:
    sel = json.loads((HERE / "data/bench_pages.json").read_text())
    r1 = json.loads((DATA / "bench/candidates.json").read_text())
    out = []
    for c in r1:
        m = c["manual"]
        examined = set(sel["pages"].get(m, [])) | {int(p) for p in sel["screen_skips"].get(m, {})}
        last = max(c["candidates"].index(p) for p in examined)
        out.append({"manual": m, "pdf": c["pdf"], "candidates": c["candidates"][last + 1 :]})
    used = used_pages()
    for m, rel in NEW.items():
        pdf = ROOT / rel
        h = hashlib.sha256(pdf.read_bytes()).hexdigest()
        pages = subprocess.run(["pdftotext", "-q", str(pdf), "-"], capture_output=True, text=True).stdout.split("\f")
        if pages and not pages[-1].strip():
            pages = pages[:-1]
        cands = [i + 1 for i, t in enumerate(pages) if CAPTION.search(t) and (m, i + 1) not in used]
        if len(cands) < 2:
            cands = [p for p in range(1, len(pages) + 1) if (m, p) not in used]
        cands.sort(key=lambda p: hashlib.sha256(f"{h}:{p}".encode()).hexdigest())
        out.append({"manual": m, "pdf": str(pdf), "candidates": cands})
    (DATA / "bench/heldout_candidates.json").write_text(json.dumps(out, indent=1))
    for o in out:
        print(o["manual"], len(o["candidates"]), o["candidates"][:5])


if __name__ == "__main__":
    main()
