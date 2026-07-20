#!/usr/bin/env python3
"""Drive Commander — Lane A deterministic benchmark runner + grader.

No vision, no LLM, no network — 100% deterministic, $0. Drives the real
``shared.drive_packs`` reuse-map callables against a sha256-frozen corpus and
grades each case against the hard gates in DRIVE_COMMANDER_BENCHMARK_SPEC.md.

Run (from repo root, UTF-8 to mirror CI/Linux):
    PYTHONUTF8=1 python tools/drive_commander_bench/runner.py

Exit code 0 iff every case passes all hard gates and the corpus hash is intact.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# ── import the REAL deterministic pack API (no model, no DB) ──────────────────
_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots"))
import re  # noqa: E402

from shared.drive_packs import (  # noqa: E402
    answer_fault_code,
    answer_question,
    load_pack,
    resolve_pack,
)

# Require the F prefix: a real *conflicting fault-code claim* is F-prefixed
# (F008 / F040), never a bare number like the "40" in "PowerFlex 40" or a page
# number. This mirrors the product's "bare integers are never codes" discipline.
_CODE_TOKEN_RE = re.compile(r"\bF0*(\d{1,3})\b")


def _pack_numeric_codes(pack_id: str) -> set[str]:
    """The pack's real numeric fault codes (normalized), for a mutation check."""
    try:
        pack = load_pack(pack_id)
        return {str(int(k)) for k in pack.live_decode.fault_codes}
    except Exception:
        return set()

_CORPUS = Path(__file__).parent / "corpus" / "lane_a_v1.json"
# sha256 of the corpus BODY (the "cases" array, canonicalized) — frozen-corpus
# discipline: a silent edit to a case flips this and the run fails loudly.
_FROZEN_SHA = "2adf09552c776812413bb1a6afe9cc7f98af6cb81daee455cf6b505b68c85006"


def _canonical_cases(doc: dict) -> str:
    return json.dumps(doc["cases"], sort_keys=True, separators=(",", ":"))


def _check_frozen(doc: dict) -> str:
    return hashlib.sha256(_canonical_cases(doc).encode("utf-8")).hexdigest()


def _norm_code(tok: str) -> str:
    """Normalize a fault token for un-mutated comparison: F007 -> 7, 05 -> 5.

    Letters preserved (mnemonic); leading F/f + zero-padding stripped from a
    purely numeric code. This is the ALLOWED normalization; a digit CHANGE is a
    mutation (hard gate 6) and would fail the substring check below.
    """
    t = tok.strip()
    if t[:1] in ("F", "f") and t[1:].isdigit():
        t = t[1:]
    if t.isdigit():
        return str(int(t))
    return t


def _grade(case: dict) -> dict:
    cid, kind, fam, inp = case["id"], case["kind"], case["family"], case["input"]
    decline = bool(case["expect_decline"])
    want = case.get("expect_meaning_substr")
    gates: list[str] = []  # hard-gate violations
    route = "none"
    detail = ""

    try:
        if kind == "family_resolve":
            pack = resolve_pack(inp)
            got = getattr(pack, "pack_id", None)
            route = "exact_lookup" if got else "decline"
            if decline:
                # gate 4: must NOT silently pick a family for an unsupported drive
                if got is not None:
                    gates.append(f"gate4_silent_family_guess(picked={got})")
                detail = f"resolved={got!r} (want decline)"
            else:
                if got != want:
                    gates.append(f"gate4_family_wrong(got={got},want={want})")
                detail = f"resolved={got!r}"
            return {"id": cid, "route": route, "gates": gates, "ok": not gates, "detail": detail}

        # fault / param → a DrivePackAnswer
        if kind == "fault":
            ans = answer_fault_code(fam, inp)
        else:
            ans = answer_question(fam, inp)
        matched = bool(getattr(ans, "matched", False))
        source = getattr(ans, "answer_source", None)
        text = getattr(ans, "answer", "") or ""
        cites = getattr(ans, "citations", None) or []
        route = "exact_lookup" if matched else "decline"

        if decline:
            # gate 1 (no fabrication) + gate 9 (honest decline): a nonexistent
            # code/param MUST NOT be answered; must be answer_source="none".
            if matched or source != "none":
                gates.append(f"gate1_9_fabricated_or_no_decline(matched={matched},source={source})")
            detail = f"matched={matched} source={source}"
        else:
            if not matched or source != "drive_pack":
                # gate 5: a real pack claim must come from the pack, matched
                gates.append(f"gate5_not_pack_answer(matched={matched},source={source})")
            if not cites:
                gates.append("gate3_no_citation")
            # gate 6 (no code mutation): the answer must not assert a DIFFERENT
            # real pack code than the one asked. Describing the fault by name
            # (no digit echoed) is fine; asserting another pack's code is not.
            nc = _norm_code(inp)
            if kind == "fault" and nc.isdigit():
                other = {m for m in _CODE_TOKEN_RE.findall(text) if str(int(m)) != nc}
                mutated = other & _pack_numeric_codes(fam)
                if mutated:
                    gates.append(f"gate6_code_mutated(input={inp}->other_pack_code={sorted(mutated)})")
            # rubric-det: meaning correctness
            meaning_ok = want is None or (want.lower() in text.lower())
            if not meaning_ok:
                gates.append(f"meaning_wrong(want~{want!r})")
            detail = f"matched={matched} source={source} cites={len(cites)}"
        return {"id": cid, "route": route, "gates": gates, "ok": not gates, "detail": detail}
    except Exception as e:  # a crash on a valid deterministic call is itself a failure
        return {"id": cid, "route": "error", "gates": [f"exception:{type(e).__name__}:{e}"], "ok": False, "detail": ""}


def run() -> int:
    doc = json.loads(_CORPUS.read_text(encoding="utf-8"))
    sha = _check_frozen(doc)
    if len(sys.argv) > 1 and sys.argv[1] == "--freeze":
        print(f"corpus sha256(cases) = {sha}")
        return 0
    if _FROZEN_SHA is not None and sha != _FROZEN_SHA:
        print(f"FROZEN-CORPUS VIOLATION: {sha} != {_FROZEN_SHA}", file=sys.stderr)
        return 3

    results = [_grade(c) for c in doc["cases"]]
    passed = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    answerable = [c for c in doc["cases"] if not c["expect_decline"]]
    # Lane F: every non-decline case answered via tier-1 exact lookup = zero-token
    zero_token = [r for r in results if r["route"] == "exact_lookup"]
    zt_pct = 100.0 * len(zero_token) / max(1, len(answerable))

    print(f"\n=== Drive Commander Lane A ({doc['benchmark_version']}) ===")
    print(f"corpus sha256(cases): {sha[:16]}…  |  cases: {len(results)}")
    for r in results:
        mark = "PASS" if r["ok"] else "FAIL"
        print(f"  [{mark}] {r['id']:<22} route={r['route']:<12} {r['detail']}"
              + ("" if r["ok"] else f"  <-- {r['gates']}"))
    print(f"\nPASS {len(passed)}/{len(results)}  |  hard-gate failures: {len(failed)}")
    print(f"Lane F zero-token coverage: {zt_pct:.0f}% ({len(zero_token)}/{len(answerable)} answerable cases via exact lookup, $0)")
    grade = "A" if not failed else "F"
    print(f"Lane A grade: {grade} (any hard-gate failure => F)")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(run())
