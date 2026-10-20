"""B2 scorer (BENCHMARK_PLAN.md + amendments 2-3). Reads gold + extractor outputs; prints and writes results."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
OUT = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench/out")
GAP = 40  # amendment 4: max normalised chars between consecutive cells of one row
METHODS = ["mira", "plain", "layout", "docling-off", "docling-v1", "docling-v2"]
FOLD = str.maketrans(
    {
        "–": "-",
        "—": "-",
        "−": "-",
        "‐": "-",
        "“": '"',
        "”": '"',
        "’": "'",
        "‘": "'",
        "|": "",
        "•": "",
        "●": "",
    }
)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).replace("...", "…").translate(FOLD).lower()
    s = re.sub(r"\(\d\)", "", s)  # footnote markers, dropped on both sides (amendment 2)
    return re.sub(r"\s+", "", s)


def ordered_in(line: str, parts: list[str], gap: int | None = None) -> bool:
    """Parts appear left to right. With `gap`, each part must start within `gap` chars of the previous end
    (amendment 4: a whole table emitted as one line must not let a row borrow cells from other rows)."""
    if gap is None:
        pos = 0
        for p in parts:
            k = line.find(p, pos)
            if k < 0:
                return False
            pos = k + len(p)
        return True
    if not parts:
        return True
    start = line.find(parts[0])
    while start >= 0:
        pos, ok = start + len(parts[0]), True
        for p in parts[1:]:
            k = line.find(p, pos)
            if k < 0 or k - pos > gap:
                ok = False
                break
            pos = k + len(p)
        if ok:
            return True
        start = line.find(parts[0], start + 1)
    return False


def units(method: str, manual: str, page: int) -> list[list[str]]:
    """Blocks of lines; a row must sit in one line of one block (a chunk for MIRA, the page otherwise)."""
    if method == "mira":
        d = json.loads((OUT / "mira" / f"{manual}_p{page}.json").read_text())
        return [c.split("\n") for c in d["chunks"]]
    ext = "txt" if method in ("plain", "layout") else "md"
    return [(OUT / method / f"{manual}_p{page}.{ext}").read_text().split("\n")]


def header_ok(method: str, lines: list[str], idx: int, headers: list[str]) -> bool:
    # Hyphens ignored in the header test only, on both sides: Docling joins spanning header levels with
    # " - " ("Frame - Size"), which is the same header (amendment 4).
    dh = lambda x: x.replace("-", "")  # noqa: E731
    hs = [dh(norm(h)) for h in headers if h.strip()]
    if method.startswith("docling"):
        j = idx
        while j > 0 and lines[j - 1].lstrip().startswith("|"):
            j -= 1
        block = norm(lines[j]) if lines[j].lstrip().startswith("|") else ""
        return ordered_in(dh(block), hs)
    return ordered_in(dh(norm("\n".join(lines[:idx]))), hs)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(c - h, 3), round(c + h, 3))


def target_col(i: int, ncols: int) -> int:
    return 1 + (i % (ncols - 1))


def main() -> None:
    gold = [json.loads(line) for line in (HERE / "data/bench_gold.jsonl").read_text().splitlines()]
    per_item = []
    for g in gold:
        ncols = len(g["headers"])
        for row in g["rows"]:
            cells = {int(k): v for k, v in row["cells"].items()}
            spans = {int(k): v for k, v in row.get("spans", {}).items()}
            t = target_col(row["i"], ncols)
            tcell = cells.get(t)
            if tcell is None:  # a horizontal span covering t
                tcell = next((cells[s] for s, e in spans.items() if s <= t <= e), None)
            parts = [norm(cells[k]) for k in sorted(cells)]
            first = parts[0]
            rec = {
                "manual": g["manual"],
                "page": g["page"],
                "i": row["i"],
                "target_col": t,
                "scored": tcell is not None,
            }
            for m in METHODS:
                hit = pair = loose = False
                for blk in units(m, g["manual"], g["page"]):
                    nl = [norm(x) for x in blk]
                    for idx, ln in enumerate(nl):
                        if tcell is not None and first in ln and norm(tcell) in ln:
                            pair = True
                        if ordered_in(ln, parts) and header_ok(m, blk, idx, g["headers"]):
                            loose = True
                            if ordered_in(ln, parts, GAP):
                                hit = True
                rec[m] = hit
                rec[m + ":loose"] = loose
                rec[m + ":pair"] = pair
            per_item.append(rec)
    scored = [r for r in per_item if r["scored"]]
    summary = {"rows": len(per_item), "scored": len(scored), "methods": {}}
    for m in METHODS:
        k = sum(r[m] for r in scored)
        kp = sum(r[m + ":pair"] for r in scored)
        kl = sum(r[m + ":loose"] for r in scored)
        summary["methods"][m] = {
            "recovered": k,
            "n": len(scored),
            "rate": round(k / len(scored), 3),
            "wilson95": wilson(k, len(scored)),
            "pair_binding": kp,
            "pair_rate": round(kp / len(scored), 3),
            "recovered_without_gap_rule": kl,
        }
    for m in METHODS:
        t = OUT / f"{m}" / "timing.json"
        if t.exists():
            tj = json.loads(t.read_text())
            secs = sorted(tj["seconds"].values())
            summary["methods"][m]["sec_per_page_median"] = secs[len(secs) // 2]
            summary["methods"][m]["sec_per_page_max"] = secs[-1]
            summary["methods"][m]["max_rss_mb"] = tj["max_rss_mb"]
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results/bench_tables.json").write_text(
        json.dumps({"summary": summary, "per_item": per_item}, indent=1)
    )
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
