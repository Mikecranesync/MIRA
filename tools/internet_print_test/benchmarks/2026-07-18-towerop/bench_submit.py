#!/usr/bin/env python3
"""One benchmark case through the REAL Telegram print-translator path.

Usage (from repo root, secrets via Doppler stg):
  doppler run -p factorylm -c stg -- python \
    tools/internet_print_test/benchmarks/2026-07-18-towerop/bench_submit.py \
    <photo.jpg> "<question>" <chat_id> <out.json>

Reuses tools/internet_print_test/submit.py (imports the real bot module; no
mocks, no live Telegram). Writes the verbatim capture dict to <out.json> and
prints a one-line summary. Each chat_id gets its own scratch sqlite.
"""
import asyncio, json, os, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
os.chdir(REPO)
sys.path.insert(0, str(REPO / "tools" / "internet_print_test"))
photo, question, chat_id, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.environ["MIRA_DB_PATH"] = f"/tmp/printbench_{chat_id}.sqlite"
from submit import submit_image  # noqa: E402

raw = open(photo, "rb").read()
t0 = time.time()
r = asyncio.run(submit_image(raw, question, chat_id=chat_id))
r["latency_s"] = round(time.time() - t0, 1)
r["photo"] = photo
r["question"] = question
json.dump(r, open(out, "w"), indent=1, default=str)
print(json.dumps({"ok": r.get("handled"), "classification": r.get("classification"),
    "ocr_items": len(r.get("ocr_items") or []), "provider": r.get("provider"),
    "interpreter_used": r.get("interpreter_used"), "latency_s": r["latency_s"],
    "error": r.get("error")}, default=str))
