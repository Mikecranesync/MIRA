"""OEM-anchored ground truth: questions whose answer page is stated by the manufacturer, not by a person or an AI.

    python3 v02/oem_truth.py --pdf-dir <dir with the 19 manuals>        (writes oem-fault/ and oem-index/)

Two sources, both read mechanically from the PDF text (`pdftotext -layout`, physical 1-based pages):

1. FAULT / ALARM / ERROR TABLES. Per manual, a small spec says which pages hold the table and what a table row
   looks like (the spec is the only hand-made part; it was read off the manual, see SPECS). A code's STRICT pages
   are the pages where it starts a table row; its LENIENT pages are every page where the code appears as a whole
   word. A row is kept only if its fault name is also on that page.
2. BACK-OF-BOOK INDEX. Index pages are split into their two columns, entries and sub-entries parsed, and printed
   page numbers mapped to physical pages through the page numbers printed on the pages themselves. An entry is
   kept only if every significant word of the entry appears on the mapped page (the manufacturer's index plus a
   text check). Limitation: that check favours wording the page already contains; the robustness variants exist
   for exactly this reason.

Balance: at most CAP questions per manual, sampled with a fixed seed. Output is deterministic (same PDFs -> same
bytes). Question wording comes from fixed templates; that is a stated limitation, not hidden.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
CAP, SEED = 30, 4791
PRODUCT = {
    "pf40": "PowerFlex 40",
    "pf4m": "PowerFlex 4M",
    "acs355": "ABB ACS355",
    "gs10-ch6": "GS10 drive",
    "gs4-ch6": "DURApulse GS4",
    "smcflex": "SMC Flex",
    "smc50": "SMC-50",
    "micro820-um": "Micro820",
    "micro810": "Micro810",
    "ml1100": "MicroLogix 1100",
    "se-m172": "Modicon M172",
    "se-canopen-hw": "Schneider CANopen",
    "se-premium-serial": "Schneider Premium",
}
# (pages, row regex with groups (code, name), kind). Read off each manual's own fault/alarm/error tables.
SPECS = {
    "pf40": [((92, 96), r"^\s{0,12}(F\d{1,3})\s{1,6}([A-Z][A-Za-z0-9 /\-]{2,22}?)\s{2,}", "fault")],
    "pf4m": [((73, 76), r"^\s{0,12}(F\d{1,3})\s{1,6}([A-Z][A-Za-z0-9 /\-]{2,22}?)\s{2,}", "fault")],
    "acs355": [
        ((359, 368), r"^(\d{4})\s{2,}([A-Z][A-Z0-9 /\-]{2,20}?)(?:\s{2,}|$)", "fault"),
        ((353, 358), r"^(\d{4})\s{2,}([A-Z][A-Z0-9 /\-]{2,20}?)(?:\s{2,}|$)", "alarm"),
    ],
    "gs10-ch6": [((17, 37), r"^\s{2,10}([A-Za-z][A-Za-z0-9]{1,4})\s{3,}(\d{1,3})\s*$", "fault_id")],
    "micro820-um": [
        (
            (150, 156),
            r"^\s{0,4}(0xF[0-9A-F]{3})\s{2,}(Recoverable|Non-User|Non-Recoverable|User)",
            "error",
        ),
        ((92, 100), r"^\s{0,4}(0x0[0-9A-F]{3})\s{2,}(\S.{2,40}?)(?:\s{2,}|$)", "connection_fault"),
    ],
    "micro810": [
        (
            (34, 40),
            r"^\s{0,4}(0xF[0-9A-F]{3})\s{2,}(Recoverable|Non-User|Non-Recoverable|User)",
            "error",
        )
    ],
    "smcflex": [
        (
            (104, 105),
            r"^([A-Z][A-Za-z ]{3,24}?)(?:\(\d\))?\s{2,}(\d{1,3}(?:,\s*\d{1,3})*)\s",
            "fault_display",
        )
    ],
}
TEMPLATES = {
    "fault": [
        "What does fault {code} mean on a {product}?",
        "{product} is showing {code}, what does that fault mean",
    ],
    "alarm": ["What does alarm {code} mean on an {product}?", "{product} alarm {code} what is it"],
    "fault_id": [
        "{product} faulted with {code} on the keypad, what does it mean?",
        "What is fault {code} on a {product}?",
    ],
    "error": [
        "{product} error code {code} - what does it mean?",
        "What does {code} mean on a {product} controller?",
    ],
    "connection_fault": ["{product} EtherNet/IP connection fault {code}, what does it mean?"],
    "fault_display": [
        "{product} fault code {code}, what does it mean?",
        "What is fault {code} on an {product} soft starter?",
    ],
    "index": ["{product}: {term}", "Where does the {product} manual cover {term}?"],
}
STOP = set("a an and are as at be by for from in is it of on or the to with see also".split())


PAGE_CACHE = os.environ.get("IMIB_PAGE_CACHE", os.path.expanduser("~/.cache/imib-pages"))


def pages_of(pdf: str) -> list[str]:
    """`pdftotext -layout` pages, cached on disk by the PDF's sha256 (the text of identical bytes never changes)."""
    key = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    path = os.path.join(PAGE_CACHE, f"{key}.json")
    if os.path.exists(path):
        return json.load(open(path))
    pages = subprocess.run(
        ["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True
    ).stdout.split("\f")
    os.makedirs(PAGE_CACHE, exist_ok=True)
    tmp = path + f".{os.getpid()}.tmp"
    json.dump(pages, open(tmp, "w"))
    os.replace(tmp, path)
    return pages


def word_pages(pages: list[str], token: str) -> list[int]:
    rx = re.compile(r"(?<![A-Za-z0-9])" + re.escape(token) + r"(?![A-Za-z0-9])")
    return [i + 1 for i, p in enumerate(pages) if rx.search(p)]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def pick(seed_key: str, options: list[str]) -> str:
    return options[int(hashlib.sha256(seed_key.encode()).hexdigest(), 16) % len(options)]


def fault_rows(key: str, pages: list[str]) -> list[dict]:
    """One row per code: strict pages (row starts), lenient pages (word anywhere), the table name."""
    found: dict[str, dict] = {}
    for (a, b), rx, kind in SPECS[key]:
        for n in range(a, min(b, len(pages)) + 1):
            for m in re.finditer(rx, pages[n - 1], re.M):
                if kind == "fault_display":  # "Line Loss  1, 2, 3": one row, several codes
                    name, codes = m.group(1).strip(), [c.strip() for c in m.group(2).split(",")]
                elif kind == "fault_id":  # GS10: display code + ID number; ask by display code
                    codes, name = [m.group(1)], f"ID {m.group(2)}"
                else:
                    codes, name = [m.group(1)], m.group(2).strip()
                for code in codes:
                    r = found.setdefault(
                        f"{kind}:{code}", {"code": code, "name": name, "kind": kind, "strict": []}
                    )
                    if n not in r["strict"]:
                        r["strict"].append(n)
    out = []
    for r in found.values():
        name_ok = (
            all(norm(r["name"]) in norm(pages[p - 1]) for p in r["strict"])
            if r["kind"] != "fault_id"
            else True
        )
        if not name_ok or not r["strict"]:
            continue
        lenient = (
            sorted(set(word_pages(pages, r["code"])) | set(r["strict"]))
            if not r["code"].isdigit()
            else sorted(r["strict"])
        )
        out.append({**r, "strict": sorted(r["strict"]), "lenient": lenient})
    return sorted(out, key=lambda r: (r["kind"], r["code"]))


# ── index ────────────────────────────────────────────────────────────────────────────────────────────
PNUM = re.compile(r"(?<![\w.-])(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?(?![\w.])")


def printed_map(pages: list[str]) -> dict[int, int]:
    """printed page number -> physical page, from numbers printed in each page's first/last lines + a consistent offset."""
    votes: Counter = Counter()
    for i, p in enumerate(pages):
        lines = [ln for ln in p.splitlines() if ln.strip()]
        for ln in lines[:3] + lines[-3:]:
            for m in re.finditer(r"(?:^\s*|\s{3,})(\d{1,3})\s*$|^\s*(\d{1,3})(?:\s{3,}|$)", ln):
                v = int(m.group(1) or m.group(2))
                votes[(i + 1) - v] += 1
    if not votes:
        return {}
    offset = votes.most_common(1)[0][0]
    return {n - offset: n for n in range(1, len(pages) + 1) if n - offset >= 1}


def split_columns(line: str) -> list[str]:
    parts = re.split(r"\s{4,}", line.rstrip())
    return [p for p in parts if p.strip()]


def index_entries(pages: list[str]) -> list[dict]:
    idx = [
        i
        for i, p in enumerate(pages)
        if re.match(
            r"\s*Index\b",
            "\n".join(ln for ln in p.splitlines() if ln.strip())[:200].strip() or "",
            re.I,
        )
    ]
    entries, parent = [], {}
    for i in idx:
        cols: dict[int, list[str]] = {}
        for ln in pages[i].splitlines():
            if not ln.strip():
                continue
            # left column = text before the widest gap past position 30; right column = the rest
            m = re.match(r"^(.{0,80}?\S)(\s{6,})(\S.*)$", ln)
            if m and len(m.group(1)) >= 15:
                cols.setdefault(0, []).append(m.group(1))
                cols.setdefault(1, []).append(
                    " " * (len(m.group(1)) + len(m.group(2))) + m.group(3)
                )
            else:
                cols.setdefault(0 if len(ln) - len(ln.lstrip()) < 40 else 1, []).append(ln)
        for c, lines in cols.items():
            base = min((len(ln) - len(ln.lstrip()) for ln in lines), default=0)
            for ln in lines:
                indent = len(ln) - len(ln.lstrip()) - base
                text = ln.strip()
                m = re.match(
                    r"^(.*?[A-Za-z].*?)\s+((?:\d{1,3}(?:\s*[-–]\s*\d{1,3})?)(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)$",
                    text,
                )
                if not m:
                    if re.match(r"^[A-Za-z]", text) and not re.match(
                        r"(?i)^(index|symbols|numerics|[a-z])$", text
                    ):
                        parent[c] = text if indent <= 2 else parent.get(c, "")
                    continue
                term, nums = m.group(1).strip(" ,"), m.group(2)
                printed = []
                for a, b in re.findall(r"(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?", nums):
                    printed += (
                        list(range(int(a), int(b) + 1)) if b and int(b) - int(a) < 6 else [int(a)]
                    )
                full = term if indent <= 2 else f"{parent.get(c, '')} {term}".strip()
                if indent <= 2:
                    parent[c] = term
                if len(term) >= 3 and not re.match(r"(?i)^see ", term):
                    entries.append({"term": full, "printed": printed, "index_page": i + 1})
    return entries


def index_rows(pages: list[str]) -> list[dict]:
    pmap = printed_map(pages)
    rows, seen = [], set()
    for e in index_entries(pages):
        words = [
            w for w in re.findall(r"[a-z0-9_]+", e["term"].lower()) if w not in STOP and len(w) >= 3
        ]
        if not words or e["term"].lower() in seen:
            continue
        ok = [
            pmap[p]
            for p in e["printed"]
            if p in pmap and all(w in pages[pmap[p] - 1].lower() for w in words)
        ]
        if ok:
            seen.add(e["term"].lower())
            rows.append(
                {
                    "term": e["term"],
                    "printed": e["printed"],
                    "strict": sorted(set(ok)),
                    "kind": "index",
                    "index_page": e["index_page"],
                }
            )
    return rows


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build(pdf_by_key: dict[str, str]) -> dict[str, list[dict]]:
    out = {"oem-fault": [], "oem-index": []}
    for key in sorted(pdf_by_key):
        pdf = pdf_by_key[key]
        pages = pages_of(pdf)
        groups = {}
        if key in SPECS:
            groups["oem-fault"] = fault_rows(key, pages)
        groups["oem-index"] = index_rows(pages) if key in PRODUCT else []
        for set_name, rows in groups.items():
            rng = random.Random(f"{SEED}:{set_name}:{key}")
            chosen = sorted(
                rng.sample(rows, min(CAP, len(rows))), key=lambda r: r.get("code") or r.get("term")
            )
            for r in chosen:
                ident = r.get("code") or r["term"]
                tpl = pick(f"{key}:{ident}", TEMPLATES[r["kind"]])
                q = tpl.format(code=r.get("code", ""), term=r.get("term", ""), product=PRODUCT[key])
                rid = f"{'of' if set_name == 'oem-fault' else 'oi'}-{key}-{hashlib.sha256(ident.encode()).hexdigest()[:8]}"
                out[set_name].append(
                    {
                        "id": rid,
                        "set": set_name,
                        "manual": key,
                        "pdf": pdf,
                        "question": q,
                        "accepted": r["strict"],
                        "_prov": {
                            **{k: v for k, v in r.items() if k != "strict"},
                            "strict": r["strict"],
                            "template": tpl,
                            "pdf_sha256": sha(pdf),
                        },
                    }
                )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--out", default=BENCH)
    a = ap.parse_args()
    want = {}
    for line in open(os.path.join(BENCH, "manual-pdfs.sha256")):
        h, key, path = line.split(maxsplit=2)
        want[h] = (key, path.strip())
    pdf_by_key = {}
    for root, _, files in os.walk(a.pdf_dir):
        for f in files:
            if f.lower().endswith(".pdf"):
                p = os.path.join(root, f)
                h = sha(p)
                if h in want:
                    pdf_by_key[want[h][0]] = want[h][
                        1
                    ]  # record the canonical path the other sets use
    out = build(pdf_by_key)
    for set_name, rows in out.items():
        d = os.path.join(a.out, set_name)
        os.makedirs(d, exist_ok=True)
        json.dump(
            [{k: v for k, v in r.items() if k != "_prov"} for r in rows],
            open(os.path.join(d, f"{set_name}-questions.json"), "w"),
            indent=1,
        )
        json.dump(
            [{"id": r["id"], **r["_prov"]} for r in rows],
            open(os.path.join(d, f"{set_name}-provenance.json"), "w"),
            indent=1,
        )
        print(
            f"{set_name}: {len(rows)} questions from {len({r['manual'] for r in rows})} manuals; per manual {dict(Counter(r['manual'] for r in rows))}"
        )


if __name__ == "__main__":
    main()
