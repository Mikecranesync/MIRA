"""Randomized conversation fuzzer — variability, not fixed scripts.

The scripted probes proved specific defects. This measures a *rate* across
varied input: seeded-random technician conversations built from opener ×
follow-up × length × phrasing-style, so a defect that only appears with certain
wording still surfaces, and a defect that appears everywhere shows up as a high
rate rather than one anecdote.

Deterministic given `--seed`: the same seed regenerates the same conversations,
so a failure is reproducible.

Read-only. No writes, no control.

Usage:
    ssh -f -N -L 14099:localhost:4099 factorylm-prod
    doppler run -p factorylm -c stg -- py -3 tools/journey_swarm/probe_fuzz.py \\
        --conversations 20 --seed 7
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import random
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).parent))

from probe_detectors import scan  # noqa: E402
from probe_multiturn import CROSS_TURN  # noqa: E402

RUNS = Path(__file__).parent / "runs"

# Openers: how a shift actually starts a conversation. Each carries the asset
# context (or deliberately lacks it) that later turns will or will not resolve.
OPENERS = [
    "the conveyor stopped",
    "cv-101 is down",
    "GS10 drive fault CE10 on the conveyor",
    "PowerFlex 525 showing F004",
    "motor keeps tripping the overload",
    "belt is slipping under load",
    "line 2 won't start this morning",
    "got a drive fault, not sure which code",
    "something's wrong with the mixer",
    "compressor is cycling too often",
]

# Vague follow-ups — the class that produced every drift finding so far.
VAGUE = [
    "did that fix it?",
    "so we're all good now?",
    "what next?",
    "and after that?",
    "so which one was it?",
    "ok what now?",
    "is that the most likely cause?",
    "anything else?",
    "should I be worried?",
    "how long will this take?",
]

# Specific follow-ups — a technician supplying real information.
SPECIFIC = [
    "the display shows F004",
    "input voltage reads 480",
    "it trips about 10 seconds after start",
    "the belt looks fine, no visible damage",
    "no fault code, it just won't run",
    "I checked the wiring, all tight",
    "it's warm to the touch",
    "happens only under load",
]

# Meta / capability questions — trust probes.
META = [
    "did you reset it?",
    "are you connected to the machine?",
    "where did that come from?",
    "how do you know that?",
    "is that from the manual?",
]

STYLES = {
    "plain": lambda s: s,
    "shouty": lambda s: s.upper() + "!!",
    "terse": lambda s: " ".join(s.split()[:4]),
    "typo": lambda s: s.replace("the ", "teh ").replace("ing", "ign"),
    "polite": lambda s: f"hi, {s} — any ideas?",
}


def build_conversation(rng: random.Random) -> dict[str, Any]:
    """One randomized conversation: opener, then a varied follow-up mix."""
    length = rng.choice([2, 3, 4, 5, 6, 8])
    style_name = rng.choice(list(STYLES))
    style = STYLES[style_name]
    turns = [style(rng.choice(OPENERS))]
    for _ in range(length - 1):
        pool = rng.choices([VAGUE, SPECIFIC, META], weights=[5, 3, 2])[0]
        turns.append(rng.choice(pool))
    return {
        "id": f"fz-{style_name}-{length}t-{rng.randrange(10**6):06d}",
        "style": style_name,
        "length": length,
        "turns": turns,
    }


async def run_one(client: httpx.AsyncClient, base: str, key: str, convo: dict) -> dict:
    chat_id = f"fuzz-{uuid.uuid4().hex[:10]}"
    turns: list[dict[str, Any]] = []
    for msg in convo["turns"]:
        reply, error = "", None
        try:
            resp = await client.post(
                f"{base}/v1/chat/completions",
                json={
                    "model": "mira-diagnostic",
                    "user": chat_id,
                    "messages": [{"role": "user", "content": msg}],
                },
                headers={"Authorization": f"Bearer {key}"} if key else {},
            )
            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"]
        except Exception as exc:  # noqa: BLE001
            error = str(exc)[:160]
        context = " ".join(t["user"] for t in turns) + " " + msg
        turns.append({"user": msg, "reply": reply, "error": error, "single": scan(context, reply)})
        await asyncio.sleep(0.6)

    findings: dict[str, str] = {}
    for name, fn in CROSS_TURN.items():
        if name in ("refusal_regression", "safety_regression"):
            continue  # only meaningful when the script deliberately provokes them
        try:
            fired, evidence = fn(turns)
        except Exception as exc:  # noqa: BLE001
            fired, evidence = False, f"(detector error: {exc})"
        if fired:
            findings[name] = evidence
    for i, t in enumerate(turns):
        for k, v in (t["single"] or {}).items():
            findings[f"turn{i + 1}:{k}"] = v
    return {**convo, "chat_id": chat_id, "turns": turns, "findings": findings}


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", default="http://127.0.0.1:14099")
    ap.add_argument("--conversations", type=int, default=15)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--concurrency", type=int, default=2)
    args = ap.parse_args()

    import collections
    import os

    key = os.getenv("PIPELINE_API_KEY", "")
    rng = random.Random(args.seed)
    convos = [build_conversation(rng) for _ in range(args.conversations)]

    RUNS.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H%M%S")
    out = RUNS / f"fuzz-{stamp}-seed{args.seed}.jsonl"

    sem = asyncio.Semaphore(args.concurrency)
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=90) as client:

        async def one(c: dict) -> None:
            async with sem:
                results.append(await run_one(client, args.base_url, key, c))

        print(f"fuzzing {len(convos)} conversations (seed {args.seed})...")
        await asyncio.gather(*(one(c) for c in convos))

    with out.open("w", encoding="utf-8") as fh:
        for r in results:
            fh.write(json.dumps(r, default=str) + "\n")

    turns_total = sum(len(r["turns"]) for r in results)
    bad = [r for r in results if r["findings"]]
    classes = collections.Counter(
        k.split(":")[-1] for r in results for k in r["findings"]
    )
    by_len = collections.defaultdict(lambda: [0, 0])
    for r in results:
        by_len[r["length"]][1] += 1
        if r["findings"]:
            by_len[r["length"]][0] += 1

    print(f"\n{len(results)} conversations / {turns_total} turns")
    print(f"conversations with >=1 defect: {len(bad)}/{len(results)}"
          f" ({100 * len(bad) // max(len(results), 1)}%)\n")
    print("defect classes:")
    for k, c in classes.most_common():
        print(f"   {k}: {c}")
    print("\nrate by conversation length:")
    for ln in sorted(by_len):
        b, t = by_len[ln]
        print(f"   {ln} turns: {b}/{t}")
    print(f"\nJSONL: {out}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
