"""Standalone corpus scanner — seed of table_discovery.

For each PDF: find pages whose leftmost band carries a repeated identifier
column (numeric / mnemonic / dotted / F-A codes) and header vocabulary that
smells like a fault or parameter table. Emits per-manual candidate-page lists
+ sample id tokens so a human can eyeball ground truth. Pure read-only.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter

import pdfplumber

ID_PATTERNS = [
    re.compile(r"^\d{1,4}$"),                              # numeric fault (Delta, Yaskawa)
    re.compile(r"^[A-Za-z]{1,4}\d{2,5}[A-Za-z]?$"),       # F30001, A0503, SCF1, F074 (>=2 digits)
    re.compile(r"^[A-Za-z]{1,4}[.\-]\d{1,3}([.\-]\d{1,3})?$"),  # Pr.00, B01.18, 12-04
    re.compile(r"^\d{1,3}\.\d{1,3}$"),                     # 00.00 dotted
]
FAULT_VOCAB = {"fault", "faults", "alarm", "alarms", "trip", "error", "errors",
               "cause", "causes", "remedy", "remedies", "corrective", "action",
               "solution", "solutions", "reaction", "acknowledge", "warning", "warnings",
               "code", "display", "diagnosis"}
PARAM_VOCAB = {"parameter", "parameters", "default", "range", "setting", "settings",
               "unit", "units", "index", "min", "max", "function", "no.", "name"}

LINE_TOL = 3.0
LEFT_BAND = 170.0  # id column is usually in the left ~170pt


def cluster_lines(words):
    words = sorted(words, key=lambda w: (round(w["top"] / LINE_TOL), w["x0"]))
    lines, cur, cur_top = [], [], None
    for w in words:
        if cur_top is None or abs(w["top"] - cur_top) <= LINE_TOL:
            cur.append(w)
            cur_top = w["top"] if cur_top is None else cur_top
        else:
            lines.append(sorted(cur, key=lambda x: x["x0"]))
            cur, cur_top = [w], w["top"]
    if cur:
        lines.append(sorted(cur, key=lambda x: x["x0"]))
    return lines


def id_like(tok: str) -> bool:
    return any(p.match(tok) for p in ID_PATTERNS)


def scan_pdf(path: str, max_pages: int | None = None):
    results = []
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:max_pages] if max_pages else pdf.pages
        for page in pages:
            pno = page.page_number
            try:
                words = page.extract_words()
            except Exception:
                continue
            if not words:
                continue
            text_lower = (page.extract_text() or "").lower()
            fault_hits = sum(1 for v in FAULT_VOCAB if v in text_lower)
            param_hits = sum(1 for v in PARAM_VOCAB if v in text_lower)
            lines = cluster_lines(words)
            id_rows, id_toks = 0, []
            for ln in lines:
                left = [w for w in ln if w["x0"] < LEFT_BAND]
                if not left:
                    continue
                first = left[0]["text"]
                if id_like(first):
                    id_rows += 1
                    id_toks.append(first)
            n_rects = len(page.rects)
            n_lines_geom = len(page.lines)
            results.append({
                "page": pno,
                "id_rows": id_rows,
                "fault_vocab": fault_hits,
                "param_vocab": param_hits,
                "rects": n_rects,
                "hlines": n_lines_geom,
                "sample_ids": id_toks[:12],
            })
    return results


def summarize(name, rows):
    # candidate = >=4 id-like rows on the page
    cands = [r for r in rows if r["id_rows"] >= 4]
    cand_pages = [r["page"] for r in cands]
    # split by which vocab dominates
    fault_pages = [r["page"] for r in cands if r["fault_vocab"] >= r["param_vocab"] and r["fault_vocab"] >= 2]
    param_pages = [r["page"] for r in cands if r["param_vocab"] > r["fault_vocab"] and r["param_vocab"] >= 2]
    all_ids = Counter()
    for r in cands:
        all_ids.update(r["sample_ids"])
    return {
        "manual": name,
        "total_pages": len(rows),
        "candidate_table_pages": len(cand_pages),
        "candidate_pages": cand_pages,
        "fault_leaning_pages": fault_pages,
        "param_leaning_pages": param_pages,
        "top_id_tokens": all_ids.most_common(25),
    }


if __name__ == "__main__":
    targets = sys.argv[1:]
    out = {}
    for t in targets:
        name = t.split("/")[-1]
        rows = scan_pdf(t)
        summ = summarize(name, rows)
        out[name] = summ
        print(f"\n=== {name} ({summ['total_pages']}pp) ===")
        print(f"candidate table pages: {summ['candidate_table_pages']}")
        print(f"  fault-leaning: {summ['fault_leaning_pages'][:40]}")
        print(f"  param-leaning: {summ['param_leaning_pages'][:40]}")
        print(f"  top id tokens: {summ['top_id_tokens'][:15]}")
        with open("/Users/bravonode/drive-manuals/analysis/scan_%s.json" % name.replace('.pdf', ''), "w") as f:
            json.dump({"summary": summ, "rows": rows}, f, indent=2)
    print("\nDONE")
