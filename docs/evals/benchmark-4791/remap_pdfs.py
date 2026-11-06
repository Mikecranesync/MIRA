"""Point the question files at YOUR copies of the manuals, matched by sha256, without editing the committed files.

    python3 remap_pdfs.py <dir-with-pdfs> <questions.json> <out.json>

The committed question files carry CHARLIE's absolute paths. manual-pdfs.sha256 lists each manual's sha256 and key.
Every PDF under <dir> is hashed; each question's `pdf` is rewritten to the file with the expected hash. Exits 1 if any
manual is missing. The public OEM PDFs are obtainable from the vendors; their sha256 proves you have the same bytes.
"""

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
want = {}
for line in open(os.path.join(HERE, "manual-pdfs.sha256")):
    h, key, path = line.split(maxsplit=2)
    want[path.strip()] = h
have = {}
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        if f.lower().endswith(".pdf"):
            p = os.path.join(root, f)
            have[hashlib.sha256(open(p, "rb").read()).hexdigest()] = p
qs = json.load(open(sys.argv[2]))
missing = set()
for q in qs:
    h = want.get(q["pdf"])
    if h in have:
        q["pdf"] = have[h]
    else:
        missing.add(q["manual"])
json.dump(qs, open(sys.argv[3], "w"), indent=1)
print(f"{len(qs)} questions remapped; missing manuals: {sorted(missing) or 'none'}")
raise SystemExit(1 if missing else 0)
