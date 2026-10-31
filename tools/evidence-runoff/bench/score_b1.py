"""B1 scorer: coverage, catch rate and false-flag rate with Wilson 95% intervals (BENCHMARK_PLAN.md)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from score_tables import wilson  # noqa: E402

HERE = Path(__file__).resolve().parents[1]
D = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench")
rows = [json.loads(line) for line in (D / "b1_out.jsonl").read_text().splitlines()]


def rate(sub, pred):
    k, n = sum(1 for r in sub if pred(r)), len(sub)
    return {"k": k, "n": n, "rate": round(k / n, 3) if n else None, "wilson95": wilson(k, n)}


opinion = lambda r: r["verdict"] in ("supported", "unsupported")  # noqa: E731
flag = lambda r: r["verdict"] == "unsupported"  # noqa: E731
wrong = [r for r in rows if r["truth"] == "wrong"]
right = [r for r in rows if r["truth"] == "correct"]
out = {
    "n": len(rows),
    "coverage_all": rate(rows, opinion),
    "catch_all_wrong": rate(wrong, flag),
    "catch_given_opinion": rate([r for r in wrong if opinion(r)], flag),
    "false_flag_all_correct": rate(right, flag),
    "false_flag_given_opinion": rate([r for r in right if opinion(r)], flag),
    "by_variant": {
        v: {
            "coverage": rate([r for r in rows if r["variant"] == v], opinion),
            "flagged": rate([r for r in rows if r["variant"] == v], flag),
        }
        for v in ("correct", "wrong_cell", "wrong_page")
    },
    "verdicts": {},
}
for r in rows:
    k = f"{r['variant']}:{r['verdict']}:{r['reason']}"
    out["verdicts"][k] = out["verdicts"].get(k, 0) + 1
(HERE / "results/bench_checker.json").write_text(
    json.dumps({"summary": out, "per_item": rows}, indent=1)
)
print(json.dumps(out, indent=1))
