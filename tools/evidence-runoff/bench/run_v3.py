"""Run the frozen V3 table-aware checker (v3_table_checker.check, frozen 1eb90ca0) over a B1 item set.

Evidence for each item is the Docling-v1 markdown of every page it cites, read from
<out_root>/docling-v1/<manual>_p<page>.md (per-page conversion, as round 1).

Scoring (ARCHITECTURE_MISSION_PLAN.md amendment 2, rule 4):
  caught      = verdict "unsupported" on a wrong item (per variant: wrong_cell, wrong_page)
  false flag  = verdict "unsupported" on a correct item
The current checker (V1b) counts as flagging when its verdict is anything other than
"supported" / "no_opinion" — the same reading the B1 scorer used. The union flags when either does.
McNemar is exact, two-sided, on the paired wrong_cell items (V3 caught vs V1b caught).

  python3 run_v3.py <items.jsonl> <out_root> <v1b_out.jsonl> <results.json>
"""

from __future__ import annotations

import json
import sys
import time
from math import comb
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from score_tables import wilson  # noqa: E402
from v3_table_checker import check  # noqa: E402

V1B_PASS = {"supported", "no_opinion"}


def mcnemar_exact(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2**n)


def main(items_path: str, out_root: str, v1b_path: str, res_path: str) -> None:
    items = [json.loads(x) for x in Path(items_path).read_text().splitlines() if x.strip()]
    v1b = {
        r["id"]: r
        for r in (json.loads(x) for x in Path(v1b_path).read_text().splitlines() if x.strip())
    }
    md_dir = Path(out_root) / "docling-v1"
    rows, ms = [], []
    for it in items:
        pages = [(md_dir / f"{it['manual']}_p{c['page']}.md").read_text() for c in it["citations"]]
        t0 = time.perf_counter()
        r = check(it["question"], it["answer"], pages)
        ms.append((time.perf_counter() - t0) * 1000)
        v3_flag = r["verdict"] == "unsupported"
        v1_flag = v1b[it["id"]]["verdict"] not in V1B_PASS
        rows.append(
            {
                "id": it["id"],
                "variant": it["variant"],
                "v3": r,
                "v3_flag": v3_flag,
                "v1b_flag": v1_flag,
            }
        )

    def rate(variant: str, key: str) -> dict:
        sel = [r for r in rows if r["variant"] == variant]
        k = sum(r[key] if key != "union" else (r["v3_flag"] or r["v1b_flag"]) for r in sel)
        return {
            "k": k,
            "n": len(sel),
            "rate": round(k / len(sel), 3) if sel else None,
            "wilson95": wilson(k, len(sel)),
        }

    summary = {}
    for name, key in (("v3", "v3_flag"), ("v1b", "v1b_flag"), ("union", "union")):
        summary[name] = {
            "wrong_cell_caught": rate("wrong_cell", key),
            "wrong_page_caught": rate("wrong_page", key),
            "false_flag_on_correct": rate("correct", key),
        }
    wc = [r for r in rows if r["variant"] == "wrong_cell"]
    b = sum(r["v3_flag"] and not r["v1b_flag"] for r in wc)
    c = sum(r["v1b_flag"] and not r["v3_flag"] for r in wc)
    summary["mcnemar_wrong_cell"] = {
        "v3_only": b,
        "v1b_only": c,
        "p_exact_two_sided": round(mcnemar_exact(b, c), 6),
    }
    ms.sort()
    summary["checker_ms"] = {"p50": round(ms[len(ms) // 2], 3), "max": round(ms[-1], 3)}
    Path(res_path).write_text(
        json.dumps({"summary": summary, "per_item": rows}, indent=1, ensure_ascii=False)
    )
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:5])
