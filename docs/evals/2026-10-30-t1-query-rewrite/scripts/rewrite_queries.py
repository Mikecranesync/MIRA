"""Query rewrite for the T-1 bench (#4983, owner decision 2026-10-30): one paid pass per question set,
cached on disk by sha256(question) so every later retrieval run is zero-token.

    doppler run -p factorylm -c dev -- python3 tools/bench4589/rewrite_queries.py <cache.json> <questions.json>...

Budget: hard stop at REWRITE_BUDGET_USD (default 0.50) cumulative across the cache, priced from
tools/review_router/prices.json (gpt-5.4-mini: $0.75 / $4.50 per M). The model takes no temperature parameter; rewrites are cached, so a run is reproducible from the cache.
The prompt asks for the MANUAL's vocabulary — section titles, parameter names, normalised codes — not
an answer. Stdlib only.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.request

MODEL = "gpt-5.4-mini"
PRICES = json.load(
    open(os.path.join(os.path.dirname(__file__), "..", "review_router", "prices.json"))
)["usd_per_mtok"][MODEL]
BUDGET = float(os.environ.get("REWRITE_BUDGET_USD", "0.50"))

SYSTEM = (
    "You translate a maintenance technician's forum post into the vocabulary an OEM equipment manual uses, "
    "so a keyword search over that manual finds the page that answers the post. Output ONLY 3 to 6 short search "
    "phrases, one per line, no numbering, no explanation, no answer. Use the manual's terms: section titles "
    "(e.g. 'Fault Descriptions', 'Analog Input Configuration', 'Communication Settings'), parameter names and "
    "numbers as the manual prints them, fault codes normalised (F081 -> F81 and F081 both), signal and terminal "
    "names, protocol names. Drop greetings, story, brand names and model numbers; keep the thing being asked."
)


def rewrite(question: str, key: str) -> tuple[str, int, int]:
    body = json.dumps(
        {
            "model": MODEL,
            "max_completion_tokens": 200,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": question[:3000]},
            ],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            text = data["choices"][0]["message"]["content"].strip()
            usage = data.get("usage", {})
            return text, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
        except Exception:  # noqa: BLE001 — retry then surface
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def main() -> None:
    cache_path, *qfiles = sys.argv[1:]
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY missing (run under doppler)")
    cache = (
        json.load(open(cache_path))
        if os.path.exists(cache_path)
        else {"model": MODEL, "spent_usd": 0.0, "in_tokens": 0, "out_tokens": 0, "rewrites": {}}
    )
    spent = cache["spent_usd"]
    todo = []
    for qf in qfiles:
        for q in json.load(open(qf)):
            h = hashlib.sha256(q["question"].encode()).hexdigest()
            if h not in cache["rewrites"]:
                todo.append((h, q["question"], q["id"]))
    print(f"{len(todo)} to rewrite; spent so far ${spent:.4f}; cap ${BUDGET:.2f}")
    for h, question, qid in todo:
        if spent >= BUDGET:
            print(f"BUDGET STOP at ${spent:.4f} — {qid} and later not rewritten")
            break
        text, pin, pout = rewrite(question, key)
        cost = pin * PRICES["input"] / 1e6 + pout * PRICES["output"] / 1e6
        spent += cost
        cache["in_tokens"] += pin
        cache["out_tokens"] += pout
        cache["spent_usd"] = spent
        cache["rewrites"][h] = {"id": qid, "rewrite": text}
        json.dump(cache, open(cache_path, "w"), indent=1)
        print(f"{qid}: ${cost:.5f} | {text.replace(chr(10), ' / ')[:140]}")
    print(
        f"done; cumulative ${spent:.4f} ({cache['in_tokens']} in / {cache['out_tokens']} out tokens)"
    )


if __name__ == "__main__":
    main()
