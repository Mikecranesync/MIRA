#!/usr/bin/env python3
"""Token + dollar estimate for a paid end-to-end safety eval, from real requests.

Reads requests.jsonl files written by run.e2e.ts (SAFETY_E2E_LOG_REQUESTS=1)
and generations.jsonl, counts input tokens with tiktoken o200k_base (the
gpt-5 / gpt-oss tokenizer family; an approximation for other models), and
prices a planned run. Output tokens are bounded by each request's own cap
(max_tokens / max_completion_tokens), which for gpt-5.x includes reasoning
tokens, so the cap is the true worst case; the expected case uses
2 x the measured visible answer length (visible + low-effort reasoning).

Usage:
  python3 tools/safety_e2e/cost_estimate.py --run DIR/gen-main [--run ...] \
     --cases-per-build 540 --builds 2 --calib 420 \
     --gen-in 0.75 --gen-out 4.5 --grader-in 0.15 --grader-out 0.60 \
     --grader-sys-chars N --grader-max-out 400
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

import tiktoken

ENC = tiktoken.get_encoding("o200k_base")


def toks(s: str) -> int:
    return len(ENC.encode(s))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="append", required=True, type=Path)
    ap.add_argument("--cases-per-build", type=int, default=540)
    ap.add_argument("--builds", type=int, default=2)
    ap.add_argument("--calib", type=int, default=420)
    ap.add_argument("--gen-in", type=float, default=0.75)
    ap.add_argument("--gen-out", type=float, default=4.5)
    ap.add_argument("--grader-in", type=float, default=0.15)
    ap.add_argument("--grader-out", type=float, default=0.60)
    ap.add_argument("--grader-sys-chars", type=int, default=2600)
    ap.add_argument("--grader-max-out", type=int, default=400)
    ap.add_argument(
        "--extra-context-chars",
        type=int,
        default=0,
        help="add production-shape retrieval context per grounded call",
    )
    a = ap.parse_args()

    gen_in, gen_cap, judge_in, judge_cap, vis_out, grade_in = [], [], [], [], [], []
    for d in a.run:
        for line in (d / "requests.jsonl").read_text().splitlines():
            r = json.loads(line)
            b = r["body"]
            t = sum(toks(m["content"]) for m in b["messages"] if isinstance(m.get("content"), str))
            cap = b.get("max_completion_tokens") or b.get("max_tokens") or 4000
            if b.get("stream"):
                gen_in.append(t + a.extra_context_chars // 4)
                gen_cap.append(cap)
            else:
                judge_in.append(t)
                judge_cap.append(cap)
        for line in (d / "generations.jsonl").read_text().splitlines():
            g = json.loads(line)
            vis_out.append(toks(g["served_text"]))
            grade_in.append(toks(g["served_text"]) + a.grader_sys_chars // 4 + 250)

    def m(x: list[int]) -> float:
        return statistics.mean(x) if x else 0.0

    turns = a.cases_per_build * a.builds
    judge_rate = len(judge_in) / max(1, len(gen_in))
    exp_gen_out = min(m(gen_cap), 2 * m(vis_out))
    per_turn_exp = (m(gen_in) * a.gen_in + exp_gen_out * a.gen_out) / 1e6 + judge_rate * (
        m(judge_in) * a.gen_in + 0.6 * m(judge_cap) * a.gen_out
    ) / 1e6
    per_turn_worst = (m(gen_in) * a.gen_in + m(gen_cap) * a.gen_out) / 1e6 + (
        m(judge_in) * a.gen_in + m(judge_cap) * a.gen_out
    ) / 1e6
    grade_calls = turns + a.calib
    grade_exp = grade_calls * (m(grade_in) * a.grader_in + 150 * a.grader_out) / 1e6
    grade_worst = grade_calls * (m(grade_in) * a.grader_in + a.grader_max_out * a.grader_out) / 1e6
    out = {
        "tokenizer": "tiktoken o200k_base",
        "measured_calls": {"generator": len(gen_in), "judge": len(judge_in)},
        "mean_tokens": {
            "generator_in": round(m(gen_in)),
            "generator_cap": round(m(gen_cap)),
            "visible_answer": round(m(vis_out)),
            "judge_in": round(m(judge_in)),
            "judge_cap": round(m(judge_cap)),
            "grader_in": round(m(grade_in)),
        },
        "judge_calls_per_turn": round(judge_rate, 3),
        "turns": turns,
        "generation_usd": {
            "expected": round(turns * per_turn_exp, 2),
            "worst": round(turns * per_turn_worst, 2),
        },
        "grader_calls": grade_calls,
        "grader_usd": {"expected": round(grade_exp, 2), "worst": round(grade_worst, 2)},
        "per_turn_worst_usd": round(per_turn_worst, 5),
    }
    out["total_usd"] = {
        "expected": round(out["generation_usd"]["expected"] + out["grader_usd"]["expected"], 2),
        "worst": round(out["generation_usd"]["worst"] + out["grader_usd"]["worst"], 2),
    }
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
