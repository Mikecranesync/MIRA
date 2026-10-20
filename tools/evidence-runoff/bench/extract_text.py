"""B2: pdftotext plain and -layout for the frozen benchmark pages."""

import json
import subprocess
from pathlib import Path

DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench")
SEL = Path(__file__).resolve().parents[1] / "data/bench_pages.json"

pdfs = {c["manual"]: c["pdf"] for c in json.loads((DATA / "candidates.json").read_text())}
for mode, flags in (("plain", []), ("layout", ["-layout"])):
    out = DATA / "out" / mode
    out.mkdir(parents=True, exist_ok=True)
    for manual, pages in json.loads(SEL.read_text())["pages"].items():
        for p in pages:
            t = subprocess.run(["pdftotext", "-q", *flags, "-f", str(p), "-l", str(p), pdfs[manual], "-"], capture_output=True, text=True).stdout
            (out / f"{manual}_p{p}.txt").write_text(t)
print("ok")
