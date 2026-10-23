"""T3 column test (ARCHITECTURE_MISSION_PLAN.md): can (row label, header) -> value be read deterministically?

Markdown (Docling): parse `|` tables into grids. A gold header matches a column whose normalised header
ends with it (Docling joins header levels with " - "); a repeated header matches its k-th occurrence.
`-layout` text: header columns from the header line's character offsets; the row's 2+-space runs are
assigned to the header whose span they start in. Other representations have no columns: not applicable.

  python3 column_lookup.py <gold.jsonl> <out_root> <method> [<method> ...]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from score_tables import norm as _norm  # noqa: E402
from score_tables import target_col, wilson  # noqa: E402

_PUA = re.compile("[\ue000-\uf8ff]")


def norm(s: str) -> str:
    """The frozen B2 normaliser, plus private-use glyphs dropped (font bullets such as U+F06C)."""
    return _norm(_PUA.sub("", s))


dh = lambda s: s.replace("-", "")  # noqa: E731


def md_tables(text: str) -> list[list[list[str]]]:
    tables, cur = [], []
    for ln in text.split("\n"):
        if ln.lstrip().startswith("|"):
            cells = [c.strip() for c in re.split(r"(?<!\\)\|", ln.strip())[1:-1]]
            if cells and all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                continue
            cur.append(cells)
        elif cur:
            tables.append(cur)
            cur = []
    if cur:
        tables.append(cur)
    return tables


def header_cols(headers: list[str], grid_header: list[str]) -> list[int | None]:
    """Gold header index -> grid column, k-th occurrence for repeated names; None when absent/blank."""
    out: list[int | None] = []
    seen: dict[str, int] = {}
    for i, h in enumerate(headers):
        nh = dh(norm(h))
        if not nh:  # blank header: positional, only when the grid has exactly the gold width
            out.append(i if len(grid_header) == len(headers) else None)
            continue
        k = seen.get(nh, 0)
        seen[nh] = k + 1
        cols = [j for j, c in enumerate(grid_header) if dh(norm(c)).endswith(nh)]
        out.append(cols[k] if k < len(cols) else None)
    return out


def lookup_md(text: str, headers: list[str], label: str, label_col: int, t: int) -> str | None:
    for grid in md_tables(text):
        if not grid:
            continue
        cols = header_cols(headers, grid[0])
        tc = cols[t] if t < len(cols) else None
        lc = cols[label_col] if label_col < len(cols) else None
        if tc is None:
            continue
        for row in grid[1:]:
            cands = [row[lc]] if lc is not None and lc < len(row) else row
            if any(norm(c) == norm(label) for c in cands) and tc < len(row):
                return row[tc]
    return None


def lookup_layout(text: str, headers: list[str], label: str, t: int) -> str | None:
    lines = text.split("\n")
    best, best_i = -1, None
    for i, ln in enumerate(lines):
        hits = sum(1 for h in headers if h.strip() and h.split()[0].lower() in ln.lower())
        if hits > best:
            best, best_i = hits, i
    if best_i is None or best < 2:
        return None
    block = lines[max(0, best_i - 2) : best_i + 3]
    starts: list[int | None] = []
    for h in headers:
        pos = None
        first = h.split()[0] if h.strip() else ""
        for ln in block:
            k = ln.lower().find(first.lower()) if first else -1
            if k >= 0:
                pos = k
                break
        starts.append(pos)
    st = starts[t]
    if st is None:
        return None
    nxt = min([s for s in starts if s is not None and s > st], default=10**6)
    pat = re.compile(r"\s+".join(re.escape(w) for w in label.split()), re.I)
    for ln in lines[best_i + 1 :]:
        if pat.search(ln):
            for m in re.finditer(r"\S+(?: \S+)*", ln):
                if st - 3 <= m.start() < nxt:
                    return m.group(0)
            return None
    return None


def main() -> None:
    gold_path, out_root, *methods = sys.argv[1:]
    gold = [json.loads(line) for line in Path(gold_path).read_text().splitlines()]
    root = Path(out_root)
    per_item, summary = [], {}
    for g in gold:
        ncols = len(g["headers"])
        for row in g["rows"]:
            cells = {int(k): v for k, v in row["cells"].items()}
            t = target_col(row["i"], ncols)
            if t not in cells:
                continue
            label_col = min(k for k in cells if k != t) if len(cells) > 1 else None
            if label_col is None:
                continue
            rec = {"manual": g["manual"], "page": g["page"], "i": row["i"], "target": cells[t]}
            for m in methods:
                if m == "layout":
                    got = lookup_layout(
                        (root / m / f"{g['manual']}_p{g['page']}.txt").read_text(),
                        g["headers"],
                        cells[label_col],
                        t,
                    )
                else:
                    got = lookup_md(
                        (root / m / f"{g['manual']}_p{g['page']}.md").read_text(),
                        g["headers"],
                        cells[label_col],
                        label_col,
                        t,
                    )
                rec[m] = got
                rec[m + ":ok"] = got is not None and norm(got) == norm(cells[t])
            per_item.append(rec)
    for m in methods:
        k = sum(r[m + ":ok"] for r in per_item)
        summary[m] = {
            "ok": k,
            "n": len(per_item),
            "rate": round(k / len(per_item), 3),
            "wilson95": wilson(k, len(per_item)),
        }
    print(json.dumps(summary, indent=1))
    Path(root / "column_lookup.json").write_text(
        json.dumps({"summary": summary, "per_item": per_item}, indent=1, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
