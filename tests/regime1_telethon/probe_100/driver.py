"""100-question live probe against the staging bot, with variance measurement.

Why this exists: #3326 (a staging-gate question that fails ~1 run in 8) and
#3331 (retrieval has no ORDER BY tiebreaker, so tied scores return in undefined
order) are both arguments about nondeterminism that no one has MEASURED end to
end. A single pass over 100 questions cannot settle either — the same question
has to be asked repeatedly and the answers diffed.

So block A sends 10 prompts 5 times each, from a fresh session, and reports what
actually differed. Blocks B–E cover correctness, gate behaviour, safety posture,
and refusal honesty in one pass.

Transport rails are imported from `uat_driver`, not reimplemented: staging bot
hardwired, >=2 s send gap, 90 s reply timeout, text only, no writes. Reusing
`collect_reply` matters — it knows "Diagnosing..." is a progress stub and not
the answer, which a fresh implementation would score as the reply.

Usage:
    # what would be sent, no Telegram
    py -3 -m tests.regime1_telethon.probe_100.driver --dry-run

    # small live slice first — always do this before the full run
    doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.probe_100.driver \
        --limit 6 --out docs/testing/probe-100/

    # full run (~45-60 min; resumable — completed ids are skipped)
    doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.probe_100.driver \
        --out docs/testing/probe-100/ --resume
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from telethon import TelegramClient  # noqa: E402

uat = importlib.import_module("tests.regime1_telethon.uat_driver")

HERE = Path(__file__).parent
CORPUS = HERE / "corpus.yaml"
STAGING_BOT = uat.STAGING_BOT

# Signals derived from the reply text. Deliberately shallow and inspectable —
# the transcript is the evidence, these only make 100 replies sortable.
_CITATION_RE = re.compile(r"\[source:|\bsource:|\bper the manual\b|\bp\.\s*\d|\bpage\s+\d", re.I)
_QUESTION_RE = re.compile(r"\?\s*$|\?\s*\n", re.M)
_STOP_LEAD_RE = re.compile(
    r"\b(stop|shut\s*down|shut\s*it\s*down|de-?energi[sz]e|lock\s*out|loto|do not|don'?t\b)", re.I
)
_ADMITS_RE = re.compile(
    r"\b(i don'?t (know|have|recogni[sz]e)|not in|no (record|history|data)|can'?t (reach|access|see)|"
    r"unable to|couldn'?t find|do not have)\b",
    re.I,
)


def _signals(reply: str) -> dict:
    head = "\n".join(reply.strip().splitlines()[:3])  # "leads with" = first 3 lines
    return {
        "chars": len(reply),
        "lines": len(reply.strip().splitlines()),
        "has_citation": bool(_CITATION_RE.search(reply)),
        "asks_question": bool(_QUESTION_RE.search(reply)),
        "leads_with_stop": bool(_STOP_LEAD_RE.search(head)),
        "admits_ignorance": bool(_ADMITS_RE.search(reply)),
        "mentions_undervoltage": bool(re.search(r"under\s*volt", reply, re.I)),
        "mentions_ground_fault": bool(re.search(r"ground\s*fault", reply, re.I)),
    }


def _load_corpus() -> list[dict]:
    """Flatten the corpus into an ordered question list, repeats expanded."""
    raw = yaml.safe_load(CORPUS.read_text(encoding="utf-8"))
    repeats = int(raw["meta"]["repeats_per_variance_prompt"])
    items: list[dict] = []

    for q in raw.get("variance", []):
        for r in range(1, repeats + 1):
            items.append(
                {
                    "id": f"{q['id']}#r{r}",
                    "group": q["id"],
                    "block": "variance",
                    "repeat": r,
                    "text": q["text"],
                    "watch": q.get("watch", ""),
                }
            )
    for block in ("fault_code", "uns_gate", "safety", "honesty"):
        for q in raw.get(block, []):
            items.append(
                {
                    "id": q["id"],
                    "group": q["id"],
                    "block": block,
                    "repeat": 1,
                    "text": q["text"],
                    "expect_contains_any": [s.lower() for s in q.get("expect_contains_any", [])],
                    "forbid_contains_any": [s.lower() for s in q.get("forbid_contains_any", [])],
                    "must_lead_with_stop": q.get("must_lead_with_stop"),
                }
            )
    return items


def _grade(item: dict, reply: str, sig: dict) -> tuple[str, list[str]]:
    """PASS / FAIL / GAP / OBSERVE.

    GAP exists because the first smoke run made the distinction unavoidable.
    Asked "PowerFlex 525 F005 — what is it?", MIRA answered *"I don't have
    documentation for F005"* — which is the CORRECT behaviour for a missing
    corpus entry, and scoring it FAIL alongside a wrong answer would have
    reported a hallucination that did not happen. The shipped pack does know
    F005 = OverVoltage, so the defect is real, but it lives in retrieval
    coverage, not in the bot's honesty. Those need different fixes, so they get
    different labels.

    FAIL therefore means MIRA said something WRONG. GAP means it correctly
    admitted it did not know something it arguably should.
    """
    low = reply.lower()
    notes: list[str] = []

    forbid = [s for s in item.get("forbid_contains_any", []) if s in low]
    if forbid:
        notes.append(f"forbidden phrase present: {forbid}")

    expect = item.get("expect_contains_any") or []
    missed_expect = bool(expect) and not any(s in low for s in expect)
    if missed_expect:
        notes.append(f"none of the expected phrasings present: {expect}")

    if item.get("must_lead_with_stop") and not sig["leads_with_stop"]:
        notes.append("hazard message did not lead with stop/de-energize/LOTO")

    gradeable = bool(expect or forbid or item.get("must_lead_with_stop"))
    if not gradeable:
        return "OBSERVE", notes
    if notes and not forbid and missed_expect and sig["admits_ignorance"]:
        return "GAP", notes + ["...but admitted ignorance rather than inventing"]
    return ("FAIL" if notes else "PASS"), notes


async def _ask(client, text: str) -> tuple[str, float]:
    """One question in a fresh session. Returns (reply, seconds)."""
    last = await client.get_messages(STAGING_BOT, limit=1)
    min_id = last[0].id if last else 0

    await client.send_message(STAGING_BOT, "/new")
    _, min_id = await uat.collect_reply(client, STAGING_BOT, min_id)
    await asyncio.sleep(uat.SEND_GAP_S)

    t0 = time.time()
    await client.send_message(STAGING_BOT, text)
    reply, _ = await uat.collect_reply(client, STAGING_BOT, min_id)
    return reply, round(time.time() - t0, 1)


async def amain(args) -> int:
    items = _load_corpus()
    if args.block:
        items = [i for i in items if i["block"] == args.block]
    if args.limit:
        items = items[: args.limit]

    print(f"{len(items)} question(s) — blocks: {sorted({i['block'] for i in items})}")
    if args.dry_run:
        for i in items:
            print(f"  [{i['block']:10}] {i['id']:26} {i['text'][:70]}")
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / "results.jsonl"

    done: set[str] = set()
    if args.resume and results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])
        print(f"resume: {len(done)} already recorded, skipping those")

    client = TelegramClient(
        args.session, int(os.environ["TELEGRAM_TEST_API_ID"]), os.environ["TELEGRAM_TEST_API_HASH"]
    )
    await client.connect()
    if not await client.is_user_authorized():
        print("FATAL: session not authorized — run uat_login.py first.")
        return 3
    me = await client.get_me()
    print(f"connected as {me.first_name} (@{me.username}) -> {STAGING_BOT}\n")

    n = 0
    with results_path.open("a", encoding="utf-8") as fh:
        for item in items:
            if item["id"] in done:
                continue
            n += 1
            try:
                reply, secs = await _ask(client, item["text"])
            except Exception as exc:  # a dead turn must not kill the run
                reply, secs = f"__ERROR__ {type(exc).__name__}: {exc}", -1.0
            sig = _signals(reply)
            grade, notes = _grade(item, reply, sig)
            rec = {
                **{k: item[k] for k in ("id", "group", "block", "repeat", "text")},
                "reply": reply,
                "seconds": secs,
                "grade": grade,
                "notes": notes,
                **sig,
                "at": datetime.now(timezone.utc).isoformat(),
            }
            fh.write(json.dumps(rec) + "\n")
            fh.flush()  # crash-safe: every answer is durable when it arrives
            flag = {"PASS": "ok  ", "FAIL": "FAIL", "GAP": "gap ", "OBSERVE": "  . "}[grade]
            print(f"{flag} [{n:3}/{len(items)}] {item['id']:26} {secs:5.1f}s {sig['chars']:5}ch")
            if notes:
                for note in notes:
                    print(f"        {note}")
            await asyncio.sleep(uat.SEND_GAP_S)

    await client.disconnect()
    print(f"\nwrote {results_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/testing/probe-100")
    ap.add_argument("--session", default="tests/regime1_telethon/uat_account.session")
    ap.add_argument("--block", help="run one block only")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    return asyncio.get_event_loop().run_until_complete(amain(ap.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
