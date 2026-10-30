"""Admission audit for forum-sealed4 — adapted from
/Users/charlienode/MIRA/.planning/2026-10-29-t1-fix/rewrite/audit_fresh3.py
(same structure, same manual->PDF map). Admission rules = PREREG-fresh-set.md
rules 1-5, applied exactly as audit_fresh3.py applies them, extended with the
sealed4-specific prior-set list (adds forum-fresh3, its raw/audit snapshots,
and the imib-auto-truth forum-resolved set) per the sealed4 task spec.

Writes forum-sealed4-questions.json (admitted, harness shape) + sealed4-audit.json
(admitted + dropped with reasons). Counts-only script — never prints question
text/urls/quotes (sealed set)."""

import json
import re
import subprocess
import sys
from collections import Counter

from pypdf import PdfReader

FORUM = "/Users/charlienode/MIRA/.planning/2026-10-30-investigator-harness/sealed/forum"
B = "/Users/charlienode/MIRA-worktrees/t1-rewrite/tools/bench4589"
P = "/Users/charlienode/MIRA/.planning"
MIRA_REPO = "/Users/charlienode/MIRA"

raw = json.load(open(f"{FORUM}/candidates-checked.json"))

# manual -> pdf, from the collection workflow's args (19 IMIB manuals) — identical
# map to audit_fresh3.py.
M = "/Users/charlienode/MIRA/.planning/retrieval-phase0"
PDF = {
    "pf40": f"{M}/manuals/15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9.pdf",
    "pf4m": f"{M}/manuals/f4a93fc51536422c2282a2a213721ba62820a04e4fe88cfbb97f2d09d253fba5.pdf",
    "acs355": f"{M}/manuals/49aab44098854107ee26a9b702bd23afc004fbb98d7a76d137ba12455699eeac.pdf",
    "micro820-um": f"{M}/manuals/977304703567acd7319ead7bbbf1403e349de3015041c1e720ab79907da87675.pdf",
    "micro820-in": f"{M}/manuals/6dfc2d211eb1aaa1a03505f061d911da729c2251a65051fdfb968b22f77a7bd4.pdf",
    "ml1100": f"{M}/manuals/7df1c906a14dc2b9603ea9c3f56936172ec432fd09a3f19508d20001d982d5c9.pdf",
    "smcflex": f"{M}/manuals/a81650d0bd31773979ffb93b3cb601c5bca0422fd69a2206df52eea451912cbd.pdf",
    "e3plus": f"{M}/manuals/aca6a4e5e28544658c2b385318927be3f95acf291cf3b811bd8baff080c7fd80.pdf",
    "smc50": f"{M}/manuals/7b8a6689a550060688a44d625cd522a41a0c983941e16dfbea9dadf7b174e069.pdf",
    "micro810": f"{M}/manuals-real/oem-manual-micro810.pdf",
    "gs4-ch2": f"{M}/manuals-real/ch2.pdf",
    "gs4-ch6": f"{M}/manuals-real/ch6.pdf",
    "gs10-ch6": f"{M}/manuals/df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669.pdf",
    "se-canopen-hw": f"{M}/manuals-real/se-canopen-hw-setup.pdf",
    "se-lxm32a-canopen": f"{M}/manuals-real/se-lxm32a-canopen-0198441113779.pdf",
    "se-m171": f"{M}/manuals-real/se-m171-performance-hardware-guide-EIO0000002030.pdf",
    "se-m172": f"{M}/manuals-real/se-m172-hardware-guide-EIO0000002015.pdf",
    "se-premium-serial": f"{M}/manuals-real/se-premium-async-serial-35006178.pdf",
    "se-x80-analog": f"{M}/manuals-real/se-x80-analog-io-35011978.pdf",
}

# Rule 2 — every prior set (URL or first 60 chars, case-insensitive). sealed4 extends
# audit_fresh3.py's own prior_files list with: forum-fresh3-questions.json itself (fresh3
# is now a prior set to sealed4), the fresh3-raw/fresh-audit/fresh2-audit snapshots under
# t1-scratch-snapshot, 2026-10-29-t1-fix/hybrid/fresh3-audit.json, and every JSON file under
# origin/eval/imib-auto-truth:docs/evals/benchmark-4791/forum-resolved/.
prior_files = [
    f"{B}/forum-new-questions.json",
    f"{B}/forum-fresh-questions.json",
    f"{B}/forum-fresh2-questions.json",
    f"{B}/forum-fresh3-questions.json",
    f"{B}/t4-77-questions.json",
    "/Users/charlienode/MIRA-worktrees/t1-rewrite/docs/evals/2026-10-29-t1-forum-ranking/questions/forum-fresh-dropped.json",
    f"{P}/benchmark-4791-session/new-forum-questions.round1.json",
    f"{P}/benchmark-4791-session/new-forum-questions.round2.json",
    f"{P}/benchmark-4791-session/forum-candidates-v0.2-unregistered.json",
    f"{P}/2026-10-30-investigator-harness/t1-scratch-snapshot/fresh3-raw.json",
    f"{P}/2026-10-30-investigator-harness/t1-scratch-snapshot/fresh-audit.json",
    f"{P}/2026-10-30-investigator-harness/t1-scratch-snapshot/fresh2-audit.json",
    f"{P}/2026-10-29-t1-fix/hybrid/fresh3-audit.json",
]

IMIB_AUTO_TRUTH_PATHS = [
    "docs/evals/benchmark-4791/forum-resolved/collected.json",
    "docs/evals/benchmark-4791/forum-resolved/forum-resolved-dropped.json",
    "docs/evals/benchmark-4791/forum-resolved/forum-resolved-provenance.json",
    "docs/evals/benchmark-4791/forum-resolved/forum-resolved-questions.json",
]

urls, heads = set(), set()


def take(x):
    if isinstance(x, dict):
        if x.get("url"):
            urls.add(x["url"].strip().lower().rstrip("/"))
        if x.get("question"):
            heads.add(re.sub(r"\s+", " ", x["question"]).strip().lower()[:60])
        for v in x.values():
            take(v)
    elif isinstance(x, list):
        for v in x:
            take(v)


for f in prior_files:
    try:
        take(json.load(open(f)))
    except FileNotFoundError:
        print("WARN prior file missing:", f, file=sys.stderr)

for p in IMIB_AUTO_TRUTH_PATHS:
    r = subprocess.run(
        ["git", "-C", MIRA_REPO, "show", f"origin/eval/imib-auto-truth:{p}"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print("WARN imib-auto-truth file missing:", p, r.stderr.strip(), file=sys.stderr)
        continue
    take(json.loads(r.stdout))

print(f"prior: {len(urls)} urls, {len(heads)} question heads")


def norm(t):
    return (
        re.sub(
            r"\s+", " ", t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
        )
        .strip()
        .lower()
    )


readers = {}


def page_text(pdf, p):
    r = readers.setdefault(pdf, PdfReader(pdf))
    return norm(r.pages[p - 1].extract_text() or "")


admitted, dropped = [], []
seen_url, seen_head = set(), set()
for n, c in enumerate(raw):
    reasons = []
    manual = c["manual"]
    if manual not in PDF:
        reasons.append("manual-not-in-19")
        pdf = None
    else:
        pdf = PDF[manual]
    u = c["url"].strip().lower().rstrip("/")
    h = re.sub(r"\s+", " ", c["question"]).strip().lower()[:60]
    if u in urls or u in seen_url:
        reasons.append("dup-url")
    if h in heads or h in seen_head:
        reasons.append("dup-question")
    seen_url.add(u)
    seen_head.add(h)
    sc = c["check"]
    if not (
        sc.get("url_reachable")
        and sc.get("question_verbatim_on_page")
        and sc.get("is_real_technician_question")
    ):
        reasons.append("source-check-failed")
    q = norm(c["evidence_quote"])
    if len(q.split()) < 10:
        reasons.append("quote-under-10-words")
    on_page = []
    if pdf is not None:
        on_page = [p for p in c["expected_pages"] if q and q in page_text(pdf, p)]
    if not on_page:
        reasons.append("quote-not-on-page")
    bl = c["check"]
    shared = sorted(set(c["expected_pages"]) & set(bl.get("my_pages") or []))
    proposed_ok = (
        bool(bl.get("proposed_page_answers_question"))
        and bl.get("answerable_from_manual", True) is not False
    )
    blind_confirmed = bool(shared) or proposed_ok
    if not blind_confirmed:
        reasons.append("blind-label-disagrees")
    accepted = sorted(
        set(c["expected_pages"]) | (set(bl.get("my_pages") or []) if blind_confirmed else set())
    )
    row = {
        "id": f"fs4-{manual}-{n:02d}",
        "set": "forum-sealed4",
        "manual": manual,
        "pdf": pdf,
        "url": c["url"],
        "forum": c["forum"],
        "question": c["question"],
        "accepted": accepted,
        "evidence_quote": c["evidence_quote"],
        "blind_pages": bl.get("my_pages") or [],
        "answerable": bool(bl.get("answerable_from_manual", True)),
        "reasons": reasons,
    }
    (dropped if reasons else admitted).append(row)

json.dump(
    {"admitted": admitted, "dropped": dropped}, open(f"{FORUM}/sealed4-audit.json", "w"), indent=1
)

# harness shape (same keys as forum-fresh2-questions.json, plus "kind" like forum-fresh3-questions.json)
tmpl = json.load(open(f"{B}/forum-fresh2-questions.json"))[0]
out = []
for r in admitted:
    o = {k: r.get(k) for k in tmpl if k in r}
    for k in tmpl:
        if k not in o:
            o[k] = tmpl[k] if not isinstance(tmpl[k], (list, dict)) else type(tmpl[k])()
    o.update(
        {
            "id": r["id"],
            "set": "forum-sealed4",
            "manual": r["manual"],
            "pdf": r["pdf"],
            "question": r["question"],
            "accepted": r["accepted"],
            "kind": "answerable" if r["answerable"] else "unanswerable",
        }
    )
    out.append(o)
json.dump(out, open(f"{FORUM}/forum-sealed4-questions.json", "w"), indent=1)

print("template keys:", list(tmpl))
print(f"admitted {len(admitted)} / dropped {len(dropped)}")

print("drop reasons:", Counter(r for d in dropped for r in d["reasons"]))
print("admitted per manual:", Counter(a["manual"] for a in admitted))
for d in dropped:
    print("  -", d["id"], d["reasons"])
