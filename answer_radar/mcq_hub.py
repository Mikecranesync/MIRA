"""The 100-question industrial maintenance exam, asked through MIRA on staging.

`tests/mira_eval.py` scores a *bare model* on `tests/benchmark/mira_mcq_benchmark.json`.
This asks the same questions through the deployed staging Hub chat route (the path the
Hub web app and the phone app both use), one fresh blank chat per question, so the two
scores answer one question: is a wrong answer the model's, or the system's?

A reply counts only if a letter can be read from it without guessing (`parse_letter`).
Anything else is UNPARSED and kept verbatim for a human to read. `tests/mira_eval.py`'s
parser is NOT reused: its last-resort "last A-D letter in the text" rule upper-cases the
text first, so the article "a" reads as option A in any full-sentence reply.

Usage (see tools/qa/mcq_exam_staging.sh, which provisions a throwaway stranger):
    ANSWER_RADAR_BASE=https://app-staging.factorylm.com ANSWER_RADAR_COOKIE=... \\
      python -m answer_radar.mcq_hub --out <dir> [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from answer_radar.hub_runner import (
    TERMINAL_STATUSES,
    _frames,
    assert_staging,
    deployed_sha,
    load_hub_client,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAM = REPO_ROOT / "tests" / "benchmark" / "mira_mcq_benchmark.json"
LETTERS = ("A", "B", "C", "D")

# How a technician would type an exam question into the app. Same stem and options
# the bare-model run sees; the answer format is asked for, not forced.
_ASK = "{body}\n\nWhich option is correct? Start your reply with the letter (A, B, C or D)."

_EXPLICIT = re.compile(
    r"(?i:\b(?:the\s+)?(?:correct\s+)?(?:answer|option|choice)\s*(?:is|:|=)?\s*)"
    r"[*_\s(]*([A-D])(?![A-Za-z])"
)
_ALONE = re.compile(r"^[\s>*_#(]*([A-D])[)*_.:\s]*$", re.MULTILINE)
_LEADING = re.compile(r"^[\s>*_#]*\(?([A-D])(?:\)|\.|:|\*\*|\s*[-–—]|\s*$)", re.MULTILINE)


def format_question(q: dict[str, Any]) -> str:
    lines = [q["stem"], ""] + [f"{k}) {q['options'][k]}" for k in LETTERS]
    return _ASK.format(body="\n".join(lines))


def parse_letter(text: str, options: dict[str, str]) -> tuple[str, str]:
    """(letter or 'UNPARSED', rule used). Never guesses from a stray capital."""
    if not text or not text.strip():
        return "UNPARSED", "empty"
    t = text.strip()
    if t in LETTERS:
        return t, "bare_letter"
    alone = {m.group(1) for m in _ALONE.finditer(t)}
    if len(alone) > 1:
        return "UNPARSED", "conflicting_letters"
    m = _LEADING.search(t.splitlines()[0])
    if m and alone <= {m.group(1)}:
        return m.group(1), "leading_letter"
    led = {x.group(1) for x in _LEADING.finditer(t)} | alone
    if len(led) == 1 and not alone:
        return led.pop(), "letter_led_line"  # "D – …" under a safety banner
    if len(led) > 1:
        return "UNPARSED", "conflicting_letters"
    if len(alone) == 1:
        return alone.pop(), "letter_on_own_line"  # e.g. under a safety banner
    found = {x.group(1) for x in _EXPLICIT.finditer(t)}
    if len(found) == 1:
        return found.pop(), "explicit_phrase"
    if len(found) > 1:
        return "UNPARSED", "conflicting_letters"
    quoted = [k for k, v in options.items() if v and v.lower() in t.lower()]
    if len(quoted) == 1:
        return quoted[0], "quoted_option_text"
    return "UNPARSED", "no_letter"


def ask(hub, q: dict[str, Any], stamp: str, diagnostics: bool = False) -> dict[str, Any]:
    nb = hub.create_notebook(f"MCQ exam Q{q['id']} {stamp}")
    body = {
        "message": format_question(q),
        "sourceDocIds": [],
        "mode": "general",
        "clientRequestId": str(uuid.uuid4()),
    }
    t0 = time.monotonic()
    st, hd, raw = hub._req(
        "POST",
        f"/api/equipment-notebooks/{nb['id']}/chat/",
        json.dumps(body).encode(),
        {"Content-Type": "application/json"},
    )
    ms = int((time.monotonic() - t0) * 1000)
    frames = _frames(raw)
    content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
    statuses = [f for f in frames if f.get("kind") == "status"]
    status = statuses[-1].get("status") if statuses else None
    if not content and statuses and statuses[-1].get("message"):
        content = str(statuses[-1]["message"])  # a decline carries its text here
    evidence = next((f for f in frames if f.get("kind") == "evidence"), {})
    complete = st == 200 and len(statuses) == 1 and status in TERMINAL_STATUSES
    letter, rule = parse_letter(content, q["options"]) if complete else ("ERROR", "incomplete")
    if status == "error":
        letter, rule = "ERROR", "status_error"
    diag: Any = None
    if diagnostics:
        try:  # the turn's own record: which gate replaced or flagged the draft
            diag = hub.diagnostics(nb["id"], hd.get("x-mira-trace-id"))
        except RuntimeError as exc:
            diag = {"error": str(exc)[:200]}
    return {
        "diagnostics": diag,
        "id": q["id"],
        "domain": q["domain"],
        "difficulty": q["difficulty"],
        "type": q["type"],
        "correct_answer": q["key"],
        "model_answer": letter,
        "parse_rule": rule,
        "is_correct": letter == q["key"],
        "http": st,
        "turn_status": status,
        "basis": evidence.get("basis"),
        "trace_id": hd.get("x-mira-trace-id"),
        "response_time_ms": ms,
        "answer_text": content,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="answer_radar.mcq_hub")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ids", default="", help="comma-separated question ids to re-ask")
    ap.add_argument("--diagnostics", action="store_true", help="record each turn's diagnostics")
    a = ap.parse_args(argv)
    base = os.environ["ANSWER_RADAR_BASE"]
    assert_staging(base)
    hub = load_hub_client()(base.rstrip("/"), os.environ["ANSWER_RADAR_COOKIE"])
    qs = json.loads(EXAM.read_text(encoding="utf-8"))
    if a.ids:
        want = {int(x) for x in a.ids.split(",")}
        qs = [q for q in qs if q["id"] in want]
    if a.limit:
        qs = qs[: a.limit]
    sha = deployed_sha(hub)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    with (out / "mira_hub_answers.jsonl").open("w", encoding="utf-8") as fh:
        for q in qs:
            r = ask(hub, q, stamp, a.diagnostics)
            rows.append(r)
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
            fh.flush()
            print(f"Q{q['id']:>3} key={q['key']} got={r['model_answer']:<8} {r['parse_rule']}")
    if deployed_sha(hub) != sha:
        raise SystemExit(f"staging redeployed mid-run (started on {sha}); results are mixed-build")
    summary = {
        "target": base,
        "staging_sha": sha,
        "questions": len(rows),
        "correct": sum(r["is_correct"] for r in rows),
        "unparsed": sum(r["model_answer"] == "UNPARSED" for r in rows),
        "errors": sum(r["model_answer"] == "ERROR" for r in rows),
    }
    (out / "mira_hub_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
