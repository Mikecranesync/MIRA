"""Mechanical admission check for forum-new rows, run BEFORE pre-registration. No model calls.

    python3 forum_new_verify.py <collected.json> <out-dir>

A row is admitted only if all of these hold:
- its URL is unique, absent from batch2's need-tags.json and cases.json, and not an excluded plctalk thread;
- its question is not a near-copy (difflib ratio >= 0.8) of any t4-77 question;
- unanswerable rows have no accepted pages, and answerable rows have at least one, all inside the PDF;
- every evidence quote is at least 20 characters (a bare product name proves nothing) and, whitespace-collapsed,
  is a substring of `pdftotext -layout` for its page, and that page is one of the accepted pages;
- the URL is a discussion thread, not a manual or vendor attachment (no .pdf, /static/manuals/, /okcsFattach/);
- the row is not on the reviewed drop list (forum-new-drops.json: id -> reason), applied before admission.
Writes forum-new-questions.json (the harness schema: id, set, manual, pdf, question, accepted),
forum-new-provenance.json (everything else) and forum-new-admission.json (verdict and reasons per row).
"""

from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
EXCLUDED_PLCTALK = {"125753", "142881", "102851", "136237", "134924", "126768"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def page_text(pdf: str, n: int, cache: dict) -> str:
    key = (pdf, n)
    if key not in cache:
        cache[key] = norm(
            subprocess.run(
                ["pdftotext", "-layout", "-f", str(n), "-l", str(n), pdf, "-"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout
        )
    return cache[key]


def page_count(pdf: str) -> int:
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"^Pages:\s+(\d+)", out, re.M).group(1))


def excluded_urls() -> set[str]:
    b2 = os.path.join(REPO, "docs/evals/forum-batch2-2026-10-25")
    urls = {r["url"] for r in json.load(open(os.path.join(b2, "need-tags.json"))) if r.get("url")}
    urls |= set(re.findall(r"https?://[^\s\"')]+", open(os.path.join(b2, "cases.json")).read()))
    return {u.rstrip("/") for u in urls}


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    rows = json.load(open(src))
    t4 = [norm(q["question"]) for q in json.load(open(os.path.join(HERE, "t4-77-questions.json")))]
    bad_urls, seen, cache, pages_of = excluded_urls(), set(), {}, {}
    drops_path = os.path.join(HERE, "forum-new-drops.json")
    drops = json.load(open(drops_path)) if os.path.exists(drops_path) else {}
    verdicts, admitted = [], []
    for r in rows:
        why = []
        url = r["url"].rstrip("/")
        if url in seen:
            why.append("duplicate url")
        seen.add(url)
        if url.lower().endswith(".pdf") or "/static/manuals/" in url or "/okcsFattach/" in url:
            why.append("url is a document, not a forum thread")
        if r["id"] in drops:
            why.append(f"reviewed drop: {drops[r['id']]}")
        if url in bad_urls:
            why.append("url excluded (batch2)")
        m = re.search(r"plctalk\.net/.*?(\d{5,6})", url)
        if m and m.group(1) in EXCLUDED_PLCTALK:
            why.append("excluded plctalk thread")
        best = max(difflib.SequenceMatcher(None, norm(r["question"]), q).ratio() for q in t4)
        if best >= 0.8:
            why.append(f"near-copy of a t4-77 question ({best:.2f})")
        acc = r["accepted"]
        n_pages = pages_of.setdefault(r["pdf"], page_count(r["pdf"]))
        if r["kind"] == "unanswerable" and acc:
            why.append("unanswerable row has accepted pages")
        if r["kind"] == "answerable":
            if not acc:
                why.append("answerable row has no accepted pages")
            if any(not (1 <= p <= n_pages) for p in acc):
                why.append("accepted page outside the PDF")
            if not r.get("evidence"):
                why.append("no evidence quote")
            for e in r.get("evidence", []):
                if e["page"] not in acc:
                    why.append(f"evidence page {e['page']} not accepted")
                if len(norm(e["quote"])) < 20:
                    why.append("evidence quote shorter than 20 chars")
                if norm(e["quote"]) not in page_text(r["pdf"], e["page"], cache):
                    why.append(f"quote not on p.{e['page']}")
        verdicts.append(
            {
                "id": r["id"],
                "admitted": not why,
                "reasons": why,
                "max_t4_similarity": round(best, 3),
            }
        )
        if not why:
            admitted.append(r)
    os.makedirs(out, exist_ok=True)
    keep = ("id", "set", "manual", "pdf", "question", "accepted")
    json.dump(
        [{k: r[k] for k in keep} for r in admitted],
        open(f"{out}/forum-new-questions.json", "w"),
        indent=1,
    )
    json.dump(
        [{k: v for k, v in r.items() if k not in ("pdf",)} for r in admitted],
        open(f"{out}/forum-new-provenance.json", "w"),
        indent=1,
    )
    json.dump(verdicts, open(f"{out}/forum-new-admission.json", "w"), indent=1)
    kinds = [r["kind"] for r in admitted]
    print(
        f"{len(rows)} collected, {len(admitted)} admitted "
        f"({kinds.count('answerable')} answerable, {kinds.count('unanswerable')} unanswerable)"
    )
    for v in verdicts:
        if not v["admitted"]:
            print("DROP", v["id"], "; ".join(v["reasons"]))


if __name__ == "__main__":
    main()
