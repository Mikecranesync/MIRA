"""AI labelers (non-Claude, via OpenRouter), calibrated against the manufacturer's own answer key before any use.

    doppler run -p factorylm -c dev -- uv run --no-project --python 3.12 --with httpx python v02/ai_labelers.py \
        --task calibration|forum-new --budget-usd 3.00

Each case shows the labeler the question and up to 6 candidate manual pages (page text, shuffled, unlabelled, so it
cannot tell which were the answer key, MIRA or BM25), and asks which pages answer it. Prices come from OpenRouter's
/models endpoint at run time; spend is the provider-reported token usage times those prices, and the run hard-stops
before a call that could cross the budget. Every response is cached under v02/labels/<model>/<task>/<id>.json and
never re-requested (zero-token rule: no paid call on unchanged inputs).

Tasks:
  calibration  oem-fault (174): candidates = manufacturer page(s) + post top-3 + BM25 top-3, deduplicated, max 6
  forum-new    the 34 real forum questions, with exactly the candidate pages Mike's review page shows (review-data)
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from oem_truth import pages_of  # noqa: E402

MODELS = [
    "openai/gpt-4.1-mini",
    "google/gemini-2.5-flash-lite",
    "meta-llama/llama-3.3-70b-instruct",
    # added after calibration left only one qualified labeler (deviation, REPORT-v02.md); judged by the same bar
    "deepseek/deepseek-chat-v3.1",
]
SPEND_FILE = os.path.join(HERE, "labels", "spend.json")
PAGE_CHARS = 2500
PROMPT = """You are labelling an industrial-maintenance retrieval benchmark.
A technician asked the QUESTION below. You are shown numbered pages from the {product} manual.
Decide which pages, ON THEIR OWN, contain the information that answers the question (a fault meaning, a parameter, a
procedure, a setting). A page that merely mentions the topic without answering does not count. If no page answers it,
return an empty list.

QUESTION: {question}

{pages}

Reply with JSON only: {{"answer_pages": [page numbers], "confidence": "high|medium|low"}}"""


def pdf_map() -> dict[str, str]:
    return {
        line.split()[1]: line.split(maxsplit=2)[2].strip()
        for line in open(os.path.join(BENCH, "manual-pdfs.sha256"))
    }


def tasks(task: str) -> list[dict]:
    if task == "calibration":
        qs = json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-questions.json")))
        post = {
            r["id"]: r["ranked_pages"]
            for r in map(
                json.loads,
                open(os.path.join(BENCH, "raw", "oem-fault", "oem-fault-cc0d26c1d-k6-r1.jsonl")),
            )
        }
        bm = {
            r["id"]: r["ranked_pages"]
            for r in map(
                json.loads,
                open(os.path.join(BENCH, "raw", "oem-fault", "oem-fault-bm25-k10-r1.jsonl")),
            )
        }
        out = []
        for q in qs:
            cands = list(
                dict.fromkeys(
                    q["accepted"] + list(dict.fromkeys(post[q["id"]]))[:3] + bm[q["id"]][:3]
                )
            )[:6]
            random.Random(f"4791:{q['id']}").shuffle(cands)
            out.append(
                {"id": q["id"], "manual": q["manual"], "question": q["question"], "pages": cands}
            )
        return out
    review = json.load(open(os.path.join(BENCH, "human-key", "review-data.json")))
    return [
        {
            "id": f["id"],
            "manual": f["manual"],
            "question": f["question"],
            "pages": f["pages"],
            "product": f["manual_title"],
        }
        for f in review["forum"]
    ]


def prices() -> dict[str, tuple[float, float]]:
    d = httpx.get("https://openrouter.ai/api/v1/models", timeout=60).json()["data"]
    return {
        m["id"]: (float(m["pricing"]["prompt"]), float(m["pricing"]["completion"]))
        for m in d
        if m["id"] in MODELS
    }


def spent_so_far() -> float:
    """Total spend = the sum of every cached label's own recorded cost, so a killed run can never lose track."""
    return sum(
        json.load(open(f)).get("cost_usd", 0.0)
        for f in glob.glob(os.path.join(HERE, "labels", "*", "*", "*.json"))
    )


def label_one(client, key, model, pin, pout, it, prompt, path) -> float:
    for attempt in range(4):
        r = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_tokens": 300,
            },
        )
        if r.status_code == 200:
            break
        time.sleep(2 * (attempt + 1))
    r.raise_for_status()
    j = r.json()
    u = j.get("usage", {})
    cost = u.get("prompt_tokens", 0) * pin + u.get("completion_tokens", 0) * pout
    text = j["choices"][0]["message"]["content"] or ""
    m = re.search(r"\{.*\}", text, re.S)
    try:
        parsed = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        parsed = {}
    pages_out = sorted(
        {
            int(p)
            for p in parsed.get("answer_pages", [])
            if str(p).isdigit() and int(p) in it["pages"]
        }
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(
        {
            "id": it["id"],
            "model": model,
            "candidates": it["pages"],
            "answer_pages": pages_out,
            "confidence": parsed.get("confidence"),
            "parsed": bool(parsed),
            "raw": text[:500],
            "usage": u,
            "cost_usd": cost,
            "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        },
        open(path, "w"),
        indent=1,
    )
    return cost


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True, choices=["calibration", "forum-new"])
    ap.add_argument(
        "--budget-usd",
        type=float,
        required=True,
        help="cap on TOTAL labeler spend across all tasks",
    )
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        sys.exit("OPENROUTER_API_KEY not set (doppler run -p factorylm -c dev)")
    price = prices()
    pdfs, text_cache = pdf_map(), {}
    product = json.load(open(os.path.join(HERE, "products.json")))
    items = tasks(a.task)
    lock = threading.Lock()
    state = {"usd": spent_so_far(), "stopped": False}
    jobs = []
    for model in MODELS:
        pin, pout = price[model]
        for it in items:
            path = os.path.join(HERE, "labels", model.replace("/", "_"), a.task, f"{it['id']}.json")
            if os.path.exists(path):
                continue
            pages = text_cache.setdefault(it["manual"], pages_of(pdfs[it["manual"]]))
            body = "\n\n".join(
                f"--- PAGE {p} ---\n{re.sub(r'[ \t]+', ' ', pages[p - 1])[:PAGE_CHARS]}"
                for p in it["pages"]
            )
            prompt = PROMPT.format(
                product=it.get("product") or product[it["manual"]],
                question=it["question"],
                pages=body,
            )
            jobs.append((model, pin, pout, it, prompt, path, (len(prompt) / 3) * pin + 300 * pout))

    def run(job):
        model, pin, pout, it, prompt, path, worst = job
        with (
            lock
        ):  # reserve the pessimistic cost first, so parallel calls can never jointly cross the cap
            if state["stopped"] or state["usd"] + worst > a.budget_usd:
                state["stopped"] = True
                return
            state["usd"] += worst
        cost = label_one(client, key, model, pin, pout, it, prompt, path)
        with lock:
            state["usd"] += cost - worst

    with httpx.Client(timeout=120) as client, ThreadPoolExecutor(a.workers) as pool:
        list(pool.map(run, jobs))
    json.dump({"usd": spent_so_far(), "cap_usd": a.budget_usd}, open(SPEND_FILE, "w"), indent=1)
    msg = "BUDGET STOP" if state["stopped"] else "done"
    print(f"{a.task}: {msg}; total labeler spend ${spent_so_far():.4f} (cap ${a.budget_usd})")


if __name__ == "__main__":
    main()
