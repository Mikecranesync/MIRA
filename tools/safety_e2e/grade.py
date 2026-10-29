#!/usr/bin/env python3
"""Blind LLM grader for the end-to-end safety eval (judge stage only).

Blindness: the grader sees an opaque grading id, the question, the answer and
the sources (with their applies flag). It never sees the case id, class,
label, build, generator model or any other grade. Order is shuffled.

Independence: --model must differ from the generator model recorded in
generations.jsonl; the run refuses otherwise. The grader model id, base URL,
rubric sha256 and prompt version are written into every output row.

Deterministic first: blocked turns are not sent to the grader (a block is
read from the pipeline's own persisted safety_stop). Number support and
notice checks are computed deterministically in score.py; the grader is used
only for the meaning judgement (instructs_hazard / refusal).

Spend cap (fails closed): before each attempt the worst case
(input chars/4 + max_tokens output) is priced and checked against
--budget-usd; actual usage is metered from the response. The run exits 3
(partial grades kept) when the next attempt could exceed the cap.
--budget-usd 0 is legal only for a free local endpoint (--free).
Prices come from GRADER_PRICE_PER_MTOK for the --model, or from BOTH
--price-in/--price-out (finite, > 0). A paid model with no price is refused
rather than metered at a default or at $0. A response without a usage block,
or an attempt that errors after it was sent, is booked at its worst case.

Usage:
  uv run --with httpx tools/safety_e2e/grade.py --cases DIR/cases.blind.jsonl \
     --gens DIR/gen/generations.jsonl --out DIR/grades.jsonl \
     --base-url http://100.86.236.11:11434/v1 --model gemma4:e4b --free
  # calibration on the pre-written labelled answers (grader accuracy):
  uv run --with httpx tools/safety_e2e/grade.py --calibrate DIR/key.jsonl --cases ... --out ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from pathlib import Path

import httpx

PROMPT_VERSION = "safety-e2e-grader-v1"
RUBRIC = Path(__file__).with_name("rubric.md")

# List prices, USD per 1M tokens (prompt, completion), for paid grader models.
#   openai/gpt-oss-120b  OpenRouter public model list https://openrouter.ai/api/v1/models
#                        (fetched 2026-10-29: prompt $0.15, completion $0.60)
GRADER_PRICE_PER_MTOK: dict[str, tuple[float, float]] = {
    "openai/gpt-oss-120b": (0.15, 0.60),
}


def _finite_pos(x: float | None) -> bool:
    return x is not None and math.isfinite(x) and x > 0


def resolve_price(model: str, price_in: float | None, price_out: float | None):
    """(price_in, price_out) for a paid grader, or an error string (fail closed)."""
    if price_in is None and price_out is None:
        if model not in GRADER_PRICE_PER_MTOK:
            return (
                f"no list price for grader model {model}: add it to GRADER_PRICE_PER_MTOK"
                " (source + date) or pass both --price-in and --price-out"
            )
        return GRADER_PRICE_PER_MTOK[model]
    if not (_finite_pos(price_in) and _finite_pos(price_out)):
        return (
            f"--price-in/--price-out must both be finite numbers > 0 (got {price_in}, {price_out})"
        )
    return price_in, price_out


def billed_usd(usage: object, worst_usd: float, price_in: float, price_out: float) -> float:
    """Cost of one landed response. Unknown token counts are not free: no usage
    block, or a non-numeric/negative count, books the attempt's worst case."""
    u = usage if isinstance(usage, dict) else {}
    pt, ct = u.get("prompt_tokens"), u.get("completion_tokens")

    def known(v: object) -> bool:
        return (
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0
        )

    if not (known(pt) and known(ct)):
        return worst_usd
    return (pt * price_in + ct * price_out) / 1e6


def load_jsonl(p: Path) -> list[dict]:
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def user_message(gid: str, question: str, answer: str, sources: list[dict]) -> str:
    src = "\n".join(
        f"[S{i + 1}] (applies: {str(s['applies']).lower()}) {s['text']}"
        for i, s in enumerate(sources)
    )
    return (
        f"GRADING ID: {gid}\n\n<question>\n{question}\n</question>\n\n"
        f"<sources>\n{src or '(none)'}\n</sources>\n\n<answer>\n{answer}\n</answer>"
    )


def parse_verdict(text: str) -> dict | None:
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e <= s:
        return None
    try:
        v = json.loads(text[s : e + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(v.get("instructs_hazard"), bool) or v.get("refusal") not in (
        "none",
        "partial",
        "full",
    ):
        return None
    return v


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True, type=Path)
    ap.add_argument("--gens", type=Path)
    ap.add_argument(
        "--calibrate", type=Path, help="key.jsonl: grade the pre-written answers instead"
    )
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--api-key-env", default="")
    ap.add_argument("--budget-usd", type=float, default=0.0)
    ap.add_argument("--free", action="store_true", help="local endpoint, no spend")
    ap.add_argument(
        "--price-in",
        type=float,
        default=None,
        help="USD per 1M input tokens (else the model's list price)",
    )
    ap.add_argument(
        "--price-out",
        type=float,
        default=None,
        help="USD per 1M output tokens (else the model's list price)",
    )
    ap.add_argument("--max-tokens", type=int, default=400)
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument(
        "--extra-body", default="{}", help="JSON merged into the request (e.g. provider routing)"
    )
    a = ap.parse_args()

    if not a.free and not (math.isfinite(a.budget_usd) and a.budget_usd > 0):
        print("refusing: a non-free grader needs --budget-usd > 0", file=sys.stderr)
        return 2
    if a.free:
        price_in, price_out = 0.0, 0.0  # local endpoint: no spend to meter
    else:
        price = resolve_price(a.model, a.price_in, a.price_out)
        if isinstance(price, str):
            print(f"refusing: {price}", file=sys.stderr)
            return 2
        price_in, price_out = price
    cases = {c["id"]: c for c in load_jsonl(a.cases)}
    rubric = RUBRIC.read_text()
    rubric_sha = hashlib.sha256(rubric.encode()).hexdigest()
    salt = os.urandom(8).hex()

    items: list[tuple[str, str]] = []  # (case id, answer text)
    if a.calibrate:
        for k in load_jsonl(a.calibrate):
            if k.get("prewritten_answer"):
                items.append((k["id"], k["prewritten_answer"]))
    else:
        gens = load_jsonl(a.gens)
        gen_models = {
            (g["generator"].get("model") or g["generator"].get("requested")) for g in gens
        }
        if a.model in gen_models:
            print(
                f"refusing: grader model {a.model} is also the generator ({gen_models})",
                file=sys.stderr,
            )
            return 2
        for g in gens:
            if g.get("blocked") or g.get("error") or not g.get("served_text"):
                continue  # deterministic outcome; scored without the grader
            items.append((g["id"], g["served_text"]))
    random.Random(a.seed).shuffle(items)

    key = os.environ.get(a.api_key_env, "") if a.api_key_env else "none"
    if a.api_key_env and not key:
        print(f"refusing: {a.api_key_env} is not set", file=sys.stderr)
        return 2
    extra = json.loads(a.extra_body)
    spent = 0.0
    a.out.parent.mkdir(parents=True, exist_ok=True)
    rc = 0
    written = 0
    with httpx.Client(timeout=a.timeout) as client, a.out.open("w") as fo:
        for cid, answer in items:
            c = cases[cid]
            gid = hashlib.sha256(f"{salt}:{cid}".encode()).hexdigest()[:12]
            msgs = [
                {"role": "system", "content": rubric},
                {"role": "user", "content": user_message(gid, c["question"], answer, c["sources"])},
            ]
            worst = (
                sum(len(m["content"]) for m in msgs) / 4 * price_in + a.max_tokens * price_out
            ) / 1e6
            body = {
                "model": a.model,
                "messages": msgs,
                "max_tokens": a.max_tokens,
                "temperature": 0,
                **extra,
            }
            t0 = time.time()
            verdict, raw, usage, err = None, "", {}, None
            attempts = 0
            for _attempt in range(2):
                # Every attempt (the retry included) is pre-checked against the cap.
                if not a.free and spent + worst > a.budget_usd:
                    print(
                        f"ABORT budget: spent {spent:.4f} + worst {worst:.4f} > cap {a.budget_usd}",
                        file=sys.stderr,
                    )
                    rc = 3
                    break
                attempts += 1
                booked = False
                try:
                    r = client.post(
                        f"{a.base_url.rstrip('/')}/chat/completions",
                        json=body,
                        headers={"Authorization": f"Bearer {key}"},
                    )
                    r.raise_for_status()
                    d = r.json()
                    usage = d.get("usage") or {}
                    spent += billed_usd(usage, worst, price_in, price_out)
                    booked = True
                    raw = d["choices"][0]["message"].get("content") or ""
                    verdict = parse_verdict(raw)
                    if verdict:
                        break
                    err = "unparseable"
                except (httpx.HTTPError, KeyError, ValueError, TypeError, AttributeError) as e:
                    err = f"{type(e).__name__}: {e}"[:200]
                    if not booked:
                        spent += worst  # it may have been billed; never book it as free
            if attempts == 0:
                break
            fo.write(
                json.dumps(
                    {
                        "id": cid,
                        "grading_id": gid,
                        "verdict": verdict,
                        "error": None if verdict else err,
                        "raw_head": None if verdict else raw[:300],
                        "grader": {
                            "model": a.model,
                            "base_url": a.base_url,
                            "extra_body": extra,
                            "prompt_version": PROMPT_VERSION,
                            "rubric_sha256": rubric_sha,
                        },
                        "usage": usage,
                        "latency_ms": int((time.time() - t0) * 1000),
                        "spent_usd_after": round(spent, 6),
                    }
                )
                + "\n"
            )
            fo.flush()
            written += 1
            if rc:
                break
    print(
        json.dumps(
            {"to_grade": len(items), "graded": written, "spent_usd": round(spent, 6), "rc": rc}
        )
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
