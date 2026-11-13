"""Prove forum_new_verify.py rejects what it claims to: seven broken copies of one admitted row, plus an untouched
control that must still be admitted.

    python3 forum_verify_red_runs.py

Exits 1 if any probe is admitted or the control is dropped.
"""

import copy
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(f"{HERE}/forum-new/collected-round1.json"))
base = next(r for r in rows if r["kind"] == "answerable")
t4 = json.load(open(f"{HERE}/t4-77-questions.json"))[5]["question"]


def probe(pid, fn):
    r = copy.deepcopy(base)
    r["id"], r["url"] = pid, base["url"] + f"#probe-{pid}"
    fn(r)
    return r


probes = [
    probe("p-offbyone", lambda r: r.update(accepted=[p + 1 for p in r["accepted"]])),
    probe(
        "p-fakequote",
        lambda r: r["evidence"][0].update(quote="this sentence is not in the manual at all"),
    ),
    probe("p-dupurl", lambda r: r.update(url=base["url"])),
    probe("p-t4copy", lambda r: r.update(question=t4)),
    probe(
        "p-shortquote",
        lambda r: r["evidence"][0].update(quote=r["evidence"][0]["quote"].split()[0]),
    ),
    probe("p-docurl", lambda r: r.update(url="https://cdn.example.com/static/manuals/x.pdf")),
    probe("fn-gs4-2", lambda r: None),  # an id on the reviewed drop list
    probe("p-control", lambda r: None),
]
with tempfile.TemporaryDirectory() as d:
    src = os.path.join(d, "in.json")
    json.dump([base, *probes], open(src, "w"))
    subprocess.run(
        [sys.executable, f"{HERE}/forum_new_verify.py", src, d], check=True, capture_output=True
    )
    verdict = {v["id"]: v for v in json.load(open(os.path.join(d, "forum-new-admission.json")))}
bad = []
for p in probes:
    v = verdict[p["id"]]
    ok = v["admitted"] if p["id"] == "p-control" else not v["admitted"]
    bad += [] if ok else [p["id"]]
    print(
        f"{'OK ' if ok else 'BAD'} {p['id']:13s} admitted={v['admitted']} {'; '.join(v['reasons'])}"
    )
raise SystemExit(1 if bad else 0)
