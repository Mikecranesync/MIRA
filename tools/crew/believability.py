#!/usr/bin/env python3
"""Crew believability scorer (#1945 follow-on: human-like dogfooding crew).

Scores whether a persona's output (an email reply, or an action transcript) reads
like the real person — the measurement that tells us the personas are working, not
just running. Reuses the social-skills scorers in `tests/social_eval.py`
(`technical_density`, `PERSONA_FORBIDDEN`, `contains_any`, `word_count`) so we have
one definition of "in character," not two.

Two layers:
  • Deterministic checks (no API): forbidden corporate tics, role-appropriate
    technical density, signature-vocabulary hits, conciseness.
  • Optional LLM judge (same path social_eval.py uses): "would a human believe a
    real <role> wrote this?" 1–5 + reason. Enabled with --judge.

Usage:
    python3 tools/crew/believability.py --persona carlos --text-file reply.txt
    python3 tools/crew/believability.py --persona dana --text-file reply.txt --judge
    # programmatic:
    from believability import score_text
    score_text("Filler bowl pressure dropped to 5 PSI...", "carlos")
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Reuse the single source of truth for the scorers.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
from social_eval import (  # noqa: E402
    PERSONA_FORBIDDEN,
    contains_any,
    technical_density,
    word_count,
)

# Per-role believability expectations. Technicians talk in codes and fragments
# (high jargon density); managers talk in priorities and cost (lower density, but a
# distinct domain vocabulary). Signature vocab is a *sample*, not exhaustive.
PERSONAS: dict[str, dict] = {
    "carlos": {
        "role": "maintenance technician",
        # Calibrated to real multi-sentence emails: a tech sprinkles codes
        # (~0.4–0.7 density across a reply), generic prose is ~0.0–0.1.
        "min_density": 0.4,
        "vocab": ["vfd", "oc", "fla", "fault", "trip", "bus", "pressure", "drift",
                  "f00", "powerflex", "amp", "belt", "motor"],
    },
    "dana": {
        "role": "maintenance manager",
        # Managers are far less jargon-dense; signature vocab carries the persona.
        "min_density": 0.1,
        "vocab": ["priority", "downtime", "overdue", "pm", "schedule", "cost",
                  "assign", "approve", "critical", "backlog", "team"],
    },
}


def score_text(text: str, persona: str) -> dict:
    """Deterministic believability checks for one persona utterance."""
    cfg = PERSONAS.get(persona)
    if cfg is None:
        raise SystemExit(f"unknown persona '{persona}' (known: {', '.join(PERSONAS)})")

    forbidden = contains_any(text, PERSONA_FORBIDDEN)
    density = technical_density(text)
    vocab_hits = [w for w in cfg["vocab"] if w in text.lower()]
    words = word_count(text)

    checks = {
        "no_corporate_tics": (not forbidden, f"forbidden phrases: {forbidden or 'none'}"),
        "role_density": (density >= cfg["min_density"],
                         f"technical_density={density:.2f} (min {cfg['min_density']})"),
        "uses_signature_vocab": (len(vocab_hits) >= 1,
                                 f"matched: {vocab_hits or 'none'}"),
        "concise": (words <= 120, f"word_count={words} (<=120 reads like a busy person)"),
    }
    passed = sum(1 for ok, _ in checks.values() if ok)
    return {
        "persona": persona,
        "role": cfg["role"],
        "passed": passed,
        "total": len(checks),
        "score_5": round(1 + 4 * passed / len(checks), 1),  # map 0..N → 1..5
        "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()},
    }


def llm_judge(text: str, persona: str) -> dict:
    """Optional LLM rubric judge — same eval path as tests/social_eval.py.

    Returns {"score_5": int, "reason": str}. Requires ANTHROPIC_API_KEY (eval-only;
    this is test tooling, not the product cascade). Falls back gracefully if absent.
    """
    import json
    import re

    import httpx

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"score_5": 0, "reason": "ANTHROPIC_API_KEY not set — judge skipped (run under doppler)"}

    role = PERSONAS[persona]["role"]
    system = (
        "You are a strict judge of realism. You are shown a message that an automated "
        f"agent wrote while role-playing a {role} using an industrial maintenance app. "
        "Score 1-5 how believably a REAL person in that role wrote it (5 = indistinguishable "
        "from a real shop-floor message; 1 = obviously an AI/QA bot). Reply with JSON only: "
        '{"score": <1-5>, "reason": "<one sentence>"}.'
    )
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": "claude-sonnet-4-6", "max_tokens": 200, "system": system,
                  "messages": [{"role": "user", "content": text}]},
        )
        resp.raise_for_status()
        raw = resp.json()["content"][0]["text"]
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {"score_5": 0, "reason": f"unparseable judge reply: {raw[:120]}"}
    data = json.loads(m.group())
    return {"score_5": int(data.get("score", 0)), "reason": str(data.get("reason", ""))}


def main() -> None:
    ap = argparse.ArgumentParser(description="Score how human a persona's output reads.")
    ap.add_argument("--persona", required=True, choices=sorted(PERSONAS))
    ap.add_argument("--text-file", help="file with the persona's reply/transcript (else stdin)")
    ap.add_argument("--judge", action="store_true", help="also run the LLM rubric judge")
    args = ap.parse_args()

    text = Path(args.text_file).read_text() if args.text_file else sys.stdin.read()
    result = score_text(text, args.persona)

    print(f"\nBelievability — {args.persona} ({result['role']})")
    print(f"  deterministic: {result['passed']}/{result['total']}  →  {result['score_5']}/5")
    for name, c in result["checks"].items():
        print(f"   {'✓' if c['ok'] else '✗'} {name}: {c['detail']}")
    if args.judge:
        j = llm_judge(text, args.persona)
        print(f"  LLM judge: {j['score_5']}/5 — {j['reason']}")
    print()
    # Non-zero exit if it clearly doesn't read in-character (CI/gating hook).
    sys.exit(0 if result["passed"] >= 3 else 1)


if __name__ == "__main__":
    main()
