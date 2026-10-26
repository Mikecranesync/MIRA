"""forum-resolved: real threads where the asker confirmed a fix. The fix's identifiers are mapped to manual pages BY CODE.

    python3 v02/resolved_truth.py <resolved-threads.json>        (writes forum-resolved/)

The collecting agent supplied evidence only: verbatim question, fix and confirmation, plus the identifiers the fix
names. Here, each identifier is matched as a whole word in the product's local manual. An identifier is kept only
if it lands on 1..MAX_PAGES pages (one that is everywhere cannot pin the answer down). A thread with no kept
identifier is dropped. Accepted pages = the union over kept identifiers. Rows whose confirming author was inferred
rather than read off the page carry attribution "inferred", and the analysis reports them separately.
"""

from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from oem_truth import pages_of  # noqa: E402

MAX_PAGES = 3
MANUALS = {
    "PowerFlex 40": ["pf40"],
    "PowerFlex 4M": ["pf4m"],
    "Micro820": ["micro820-um", "micro820-in"],
    "Micro810": ["micro810"],
    "MicroLogix 1100": ["ml1100"],
}
INFERRED = {
    "rt-05",
    "rt-07",
}  # the collector could not read the confirming author off the page (rendering gap)


def main() -> None:
    src = json.load(open(sys.argv[1]))
    pdf = {
        line.split()[1]: line.split(maxsplit=2)[2].strip()
        for line in open(os.path.join(BENCH, "manual-pdfs.sha256"))
    }
    excluded = set()
    for f in ("forum-new/collected-round1.json", "forum-new/collected-round2.json"):
        excluded |= {r["url"].rstrip("/") for r in json.load(open(os.path.join(BENCH, f)))}
    rows, prov, dropped, seen = [], [], [], set()
    cache: dict[str, list[str]] = {}
    for t in src:
        url = t["url"].rstrip("/")
        why = []
        if url in seen or url in excluded:
            why.append("duplicate or excluded url")
        if not all((t.get(k) or "").strip() for k in ("question", "solution", "confirmation")):
            why.append("missing verbatim question/solution/confirmation")
        keys = MANUALS.get(t["product"], [])
        if not keys:
            why.append(f"no local manual for {t['product']}")
        best = None
        for key in keys:
            pages = cache.setdefault(key, pages_of(pdf[key]))
            kept = {}
            for ident in t["identifiers"]:
                token = re.sub(r"(?i)^(parameter|pins?|terminal)\s+", "", ident).strip()
                if len(token) < 2:
                    continue
                rx = re.compile(r"(?<![A-Za-z0-9])" + re.escape(token) + r"(?![A-Za-z0-9])")
                hits = [i + 1 for i, p in enumerate(pages) if rx.search(p)]
                if 1 <= len(hits) <= MAX_PAGES:
                    kept[ident] = hits
            if kept and (best is None or len(kept) > len(best[1])):
                best = (key, kept)
        if not best:
            why.append("no identifier pins down 1-3 manual pages")
        if why:
            dropped.append({"id": t["id"], "url": t["url"], "reasons": why})
            continue
        seen.add(url)
        key, kept = best
        accepted = sorted({p for v in kept.values() for p in v})
        rows.append(
            {
                "id": t["id"],
                "set": "forum-resolved",
                "manual": key,
                "pdf": pdf[key],
                "question": t["question"],
                "accepted": accepted,
            }
        )
        prov.append(
            {
                "id": t["id"],
                "url": t["url"],
                "forum": t["forum"],
                "kept_identifiers": kept,
                "attribution": "inferred" if t["id"] in INFERRED else "visible",
                "solution": t["solution"],
                "confirmation": t["confirmation"],
            }
        )
    d = os.path.join(BENCH, "forum-resolved")
    os.makedirs(d, exist_ok=True)
    json.dump(rows, open(os.path.join(d, "forum-resolved-questions.json"), "w"), indent=1)
    json.dump(prov, open(os.path.join(d, "forum-resolved-provenance.json"), "w"), indent=1)
    json.dump(dropped, open(os.path.join(d, "forum-resolved-dropped.json"), "w"), indent=1)
    print(f"forum-resolved: {len(rows)} kept, {len(dropped)} dropped")
    for x in dropped:
        print("  DROP", x["id"], "; ".join(x["reasons"]))


if __name__ == "__main__":
    main()
