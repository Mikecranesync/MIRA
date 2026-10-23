"""B1: templated checker items from the frozen gold (BENCHMARK_PLAN.md B1). Truth is by construction.

Evidence for each item is the MIRA-today chunk list of the cited page (what the route would pass).
Writes .planning/.../bench/b1_items.jsonl.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
OUT = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench")


def target_col(i: int, ncols: int) -> int:
    return 1 + (i % (ncols - 1))


def chunks(manual: str, page: int) -> list[str]:
    return json.loads((OUT / "out/mira" / f"{manual}_p{page}.json").read_text())["chunks"]


def main() -> None:
    gold = [json.loads(line) for line in (HERE / "data/bench_gold.jsonl").read_text().splitlines()]
    pages_of: dict[str, list[int]] = {}
    for g in gold:
        pages_of.setdefault(g["manual"], []).append(g["page"])
    items, skipped = [], {}
    for g in gold:
        ncols = len(g["headers"])
        rows = [{int(k): v for k, v in r["cells"].items()} | {"_i": r["i"]} for r in g["rows"]]
        for r in rows:
            t = target_col(r["_i"], ncols)
            cells = {k: v for k, v in r.items() if k != "_i"}
            key = f"{g['manual']}:{g['page']}:{r['_i']}"
            if t not in cells:
                skipped[key] = "target excluded"
                continue
            label_col = min(k for k in cells if k != t) if len(cells) > 1 else None
            if label_col is None or label_col > t:
                skipped[key] = "no row label left of the target"
                continue
            value, label, header = cells[t], cells[label_col], g["headers"][t] or "value"
            others = [v for o in rows if o is not r for k, v in o.items() if k != "_i"]
            if value in others or value in [v for k, v in cells.items() if k != t]:
                skipped[key] = "target value repeats in the table"
                continue
            wrong = next(
                (
                    v
                    for o in rows
                    if o is not r
                    for k, v in o.items()
                    if k not in ("_i", t, label_col) and v != value and v not in cells.values()
                ),
                None,
            )
            q = f"What is the {header} for {label}?"
            correct = f"The {header} for {label} is {value} [1]."
            ev = [{"page": g["page"], "chunks": chunks(g["manual"], g["page"])}]
            base = {"manual": g["manual"], "page": g["page"], "row": r["_i"], "question": q}
            items.append(
                base
                | {
                    "id": key + ":correct",
                    "variant": "correct",
                    "truth": "correct",
                    "answer": correct,
                    "citations": ev,
                }
            )
            if wrong is not None:
                items.append(
                    base
                    | {
                        "id": key + ":wrong_cell",
                        "variant": "wrong_cell",
                        "truth": "wrong",
                        "answer": f"The {header} for {label} is {wrong} [1].",
                        "citations": ev,
                        "wrong_value": wrong,
                    }
                )
            other = [p for p in pages_of[g["manual"]] if p != g["page"]]
            if other:
                items.append(
                    base
                    | {
                        "id": key + ":wrong_page",
                        "variant": "wrong_page",
                        "truth": "wrong",
                        "answer": correct,
                        "citations": [{"page": other[0], "chunks": chunks(g["manual"], other[0])}],
                    }
                )
    (OUT / "b1_items.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items)
    )
    by = {}
    for x in items:
        by[x["variant"]] = by.get(x["variant"], 0) + 1
    print(
        json.dumps(
            {
                "items": len(items),
                "by_variant": by,
                "skipped": len(skipped),
                "skip_reasons": sorted(set(skipped.values())),
            }
        )
    )
    (HERE / "data/b1_skips.json").write_text(json.dumps(skipped, indent=1))


if __name__ == "__main__":
    main()
