"""Every page's text for every manual in the runoff (local, gitignored): pages.jsonl {manual, page, text}.

Public-50 manuals: pdftotext per physical page of the hashed PDF. Real-36 / Schneider / PLC-5: the stored
staging chunks of that document, joined per page. Used by grade.py to find EVERY page that states a typed
gold value, so an answer citing a second page that also states it (a summary table) is not "wrong page".
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path("/Users/charlienode/MIRA/.planning")
DATA = ROOT / "evidence-runoff-data"
REAL_DOC = {  # real-36 manual id -> Lane A notebook group (docId from tq_replay_state.json)
    "micro810": "QA Micro810 upload",
    "gs4-ch2": "adc-gs4-manual-ch2",
    "gs4-ch6": "adc-gs4-manual-ch6",
    "plc5-rm001": "ra-plc5-instruction-set-1785-rm001",
    "se-canopen-hw": "se-canopen-hw-setup",
    "se-lxm32a-canopen": "se-lxm32a-canopen-0198441113779",
    "se-m171": "se-m171-performance-hardware-guide-EIO0000002030",
    "se-m172": "se-m172-hardware-guide-EIO0000002015",
    "se-premium-serial": "se-premium-async-serial-35006178",
    "se-x80-analog": "se-x80-analog-io-35011978",
}


def main() -> None:
    out = []
    pub = json.loads((DATA / "public-50.json").read_text())
    by_sha = {
        hashlib.sha256(p.read_bytes()).hexdigest(): p
        for p in (ROOT / "retrieval-phase0/manuals").glob("*.pdf")
    }
    for m in pub["manuals"]:
        pdf = by_sha[m["sha256"]]
        for p in range(1, m["pages"] + 1):
            t = subprocess.run(
                ["pdftotext", "-q", "-f", str(p), "-l", str(p), str(pdf), "-"],
                capture_output=True,
                text=True,
            ).stdout
            out.append({"manual": m["id"], "page": p, "text": t})
    st = json.loads((DATA / "tq_replay_state.json").read_text())
    chunks = json.loads((DATA / "stg_chunks.json").read_text())
    for mid, group in REAL_DOC.items():
        doc = st["notebooks"][group]["docId"]
        pages: dict[int, list[str]] = {}
        for c in chunks:
            if c["doc_id"] == doc:
                for p in range(c["page_start"], (c["page_end"] or c["page_start"]) + 1):
                    pages.setdefault(p, []).append(c["content"])
        for p, ts in sorted(pages.items()):
            out.append({"manual": mid, "page": p, "text": "\n".join(ts)})
    (DATA / "pages.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out)
    )
    print(len(out), "pages")


if __name__ == "__main__":
    main()
