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

Spend cap (fails closed): before each call the worst case
(input chars/4 + max_tokens output) is priced with --price-in/--price-out and
checked against --budget-usd; actual usage is metered from the response. The
run exits 3 (partial grades kept) when the next call could exceed the cap.
--budget-usd 0 is legal only for a free local endpoint (--free).

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
import os
import random
import sys
import time
from pathlib import Path

import httpx

PROMPT_VERSION = "safety-e2e-grader-v1"
RUBRIC = Path(__file__).with_name("rubric.md")


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
    ap.add_argument("--price-in", type=float, default=0.15, help="USD per 1M input tokens")
    ap.add_argument("--price-out", type=float, default=0.60, help="USD per 1M output tokens")
    ap.add_argument("--max-tokens", type=int, default=400)
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument(
        "--extra-body", default="{}", help="JSON merged into the request (e.g. provider routing)"
    )
    a = ap.parse_args()

    if not a.free and a.budget_usd <= 0:
        print("refusing: a non-free grader needs --budget-usd > 0", file=sys.stderr)
        return 2
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
                sum(len(m["content"]) for m in msgs) / 4 * a.price_in + a.max_tokens * a.price_out
            ) / 1e6
            if not a.free and spent + worst > a.budget_usd:
                print(
                    f"ABORT budget: spent {spent:.4f} + worst {worst:.4f} > cap {a.budget_usd}",
                    file=sys.stderr,
                )
                rc = 3
                break
            body = {
                "model": a.model,
                "messages": msgs,
                "max_tokens": a.max_tokens,
                "temperature": 0,
                **extra,
            }
            t0 = time.time()
            verdict, raw, usage, err = None, "", {}, None
            for _attempt in range(2):
                try:
                    r = client.post(
                        f"{a.base_url.rstrip('/')}/chat/completions",
                        json=body,
                        headers={"Authorization": f"Bearer {key}"},
                    )
                    r.raise_for_status()
                    d = r.json()
                    raw = d["choices"][0]["message"].get("content") or ""
                    usage = d.get("usage") or {}
                    spent += (
                        (usage.get("prompt_tokens") or 0) * a.price_in
                        + (usage.get("completion_tokens") or 0) * a.price_out
                    ) / 1e6
                    verdict = parse_verdict(raw)
                    if verdict:
                        break
                    err = "unparseable"
                except (httpx.HTTPError, KeyError, ValueError) as e:
                    err = f"{type(e).__name__}: {e}"[:200]
            fo.write(
                json.dumps(
                    {
                        "id": cid,
                        "grading_id": gid,
                        "verdict": verdict,
                        "error": None if verdict else err,
                        "grader": {
                            "model": a.model,
                            "base_url": a.base_url,
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
    print(
        json.dumps(
            {"to_grade": len(items), "graded": written, "spent_usd": round(spent, 6), "rc": rc}
        )
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
