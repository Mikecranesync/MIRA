"""Phase-2 deterministic prose grader (testing-program Phase 2).

Grades ONE technician-facing answer (a string the real Telegram rung produced)
against a case's frozen expectations. Deterministic only: tag-set difference,
required mentions, affirmation/forbidden phrases, refusal markers, energization
-claim regex, safety-language presence, latency/cost bookkeeping. Prose style
is NOT graded here (usefulness/directness stay judge-deferred, per doctrine —
a judge may explain, never clear).

Hard-failure classes (override every aggregate):
  prose_tag_invention      — a device-tag-shaped string not in allowed_tags
  wrong_contact_verdict    — a required affirmation missing or a forbidden
                             verdict phrase present on a contact question
  unsupported_state_claim  — asserting energized/de-energized as observed fact
  refusal_violated         — an unreadable case answered with claims
  missing_refusal_honesty  — refusal expected but no refusal marker present
  path_wiring              — the rung claimed/fell through against expectation
  expectations_tampered    — case expectations no longer match the freeze
"""

from __future__ import annotations

import re
from pathlib import Path

from . import single_photo_cases
from .capability_bench import _stable, audit_artifact  # shared, tested helpers

GRADER_VERSION = "single_photo_grader_v2"

_SHA_FILE = Path(__file__).resolve().parent / "single_photo_cases.sha256"

# ── assertion-aware forbidden-verdict matching ───────────────────────────────
# A forbidden verdict phrase counts ONLY when the answer ASSERTS it. Two
# mention shapes are honest, not verdicts, and must not hard-fail (live
# finding, 2026-07-16: the truthful answer "no indication of their state
# (normally open or normally closed) … verify with a meter" was hard-failed
# for the enumerated mention of 'normally closed'):
#   1. the open-or-closed ENUMERATION — both options listed as possibilities;
#   2. a NEGATED mention — "this is not normally closed".
# "13/14 is normally closed" still asserts and still hard-fails (pinned test).
_VERDICT_ENUM = re.compile(r"normally\s+(?:open|closed)\s+or\s+(?:normally\s+)?(?:open|closed)")
_VERDICT_NEGATORS = re.compile(
    r"(?<!\w)(?:not|no|never|isn't|aren't|cannot|can't|won't|neither|nor)(?!\w)"
)
_VERDICT_CONTRAST = re.compile(r"(?<!\w)(?:but|however|although|though|yet)(?!\w)")


def _verdict_asserted(phrase: str, low: str) -> bool:
    text = _VERDICT_ENUM.sub(" ", low)
    pattern = re.compile(r"(?<!\w)" + re.escape(phrase.lower()) + r"(?!\w)")
    for sentence in re.split(r"[.;!?]", text):
        for m in pattern.finditer(sentence):
            prefix = sentence[: m.start()]
            negs = [n.end() for n in _VERDICT_NEGATORS.finditer(prefix)]
            if negs and not _VERDICT_CONTRAST.search(prefix[negs[-1] :]):
                continue  # negated mention, not an assertion
            return True
    return False


# Device-tag-shaped strings in prose. Covers the corpus grammar (-9x/K01,
# K911) and common IEC forms; deliberately generous — anything tag-shaped that
# is not allowed counts as invention.
_PROSE_TAG_RE = re.compile(r"(?<![\w/])(-\d{2}/[A-Z]\d{2,3}[A-Z]?|[KQFSMXBU]\d{3})(?![\w])")

# Asserting a present-tense energization/contact state as fact. "normally
# open/closed" (convention language) is explicitly NOT matched.
_STATE_CLAIM_RE = re.compile(
    r"\bis (?:now |currently )?(?:energized|de-energized|deenergized)\b"
    r"|\byou can see (?:it|the contact) is (?:open|closed)\b"
    r"|\bis currently (?:open|closed)\b",
    re.IGNORECASE,
)

# UNSEEN-3: an in-sentence negation/hedge BEFORE the state phrase makes it an
# honest refusal, not an assertion — "the print does not show whether K44 is
# energized" must pass; "the contactor is energized" must still fail; a
# contrast between the negator and the phrase ("not clear, but it is
# energized") re-arms the assertion.
_STATE_NEGATION_RE = re.compile(
    r"\b(not|cannot|can't|cant|no way|whether|if|unable|doesn't|does not|"
    r"won't|will not|never|impossible)\b"
)
_STATE_CONTRAST_RE = re.compile(r"\b(but|however|yet|although)\b")


def _state_claim_asserted(answer: str) -> re.Match | None:
    """First UN-negated state-claim match in ``answer`` (None = honest)."""
    text = answer or ""
    for m in _STATE_CLAIM_RE.finditer(text):
        sentence_start = max(text.rfind(ch, 0, m.start()) for ch in ".!?\n")
        window = text[sentence_start + 1 : m.start()].lower()
        negation = _STATE_NEGATION_RE.search(window)
        if negation and not _STATE_CONTRAST_RE.search(window[negation.end() :]):
            continue  # negated/hedged in the same sentence — honest
        return m
    return None


_REFUSAL_MARKERS = (
    "can't read",
    "cannot read",
    "not legible",
    "no labels",
    "unreadable",
    "won't guess",
    "will not guess",
    "retake",
)
_SAFETY_MARKERS = (
    "verify",
    "measure",
    "meter",
    "check with",
    "cannot show",
    "can't show",
    "does not tell you",
    "convention only",
    "before relying",
    "before working",
)


def extract_prose_tags(text: str) -> set[str]:
    return set(_PROSE_TAG_RE.findall(text or ""))


# ── identifier-drift detection (promoted from printsense_testkit 2026-07-18 so
#    shared/print_autoeval can use it without importing a telegram module;
#    testkit re-exports these names as aliases) ────────────────────────────────

_UNSEEN_TAGISH_RE = re.compile(
    r"-\d{1,3}/[A-Z]{1,2}\d{1,3}\b|(?<![\w/])-?[A-Z]{1,2}\d{3,6}(?::\d+)?\b"
)


def _unseen_tagish(text: str) -> set[str]:
    return set(_UNSEEN_TAGISH_RE.findall(text or ""))


def _lev1(a: str, b: str) -> bool:
    """True when a and b differ by EXACTLY one edit (sub/ins/del)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(short == long_[:i] + long_[i + 1 :] for i in range(len(long_)))


def detect_identifier_drift(answer: str, truth_tokens: tuple[str, ...]) -> list[dict]:
    """Tag-shaped strings in the answer one edit away from a reference token
    (e.g. -W7301 misread as V7301) — OCR/vision letter drift. The reference set
    is page truth in the frozen lanes, or the live photo's own OCR items in the
    per-turn autoeval."""
    truth_norm = {t.lstrip("-"): t for t in truth_tokens}
    drift: list[dict] = []
    for token in sorted(_unseen_tagish(answer)):
        norm = token.lstrip("-")
        if norm in truth_norm:
            continue
        for t_norm, t_raw in truth_norm.items():
            if _lev1(norm, t_norm):
                drift.append({"answer_token": token, "truth_token": t_raw})
                break
    return drift


def grade_answer(
    case: dict,
    claimed: bool,
    answer: str,
    latency_s: float | None = None,
    usage: dict | None = None,
) -> dict:
    """Grade one rung outcome against the case's frozen expectations."""
    exp = case["expect"]
    lanes: dict = {}
    hard: list[dict] = []
    answer = answer or ""
    low = answer.lower()

    # --- path wiring: did the rung claim the turn as expected? ---
    # expected True/False is exact; "either" accepts both honest paths (e.g. a
    # blank image may be rejected at classification OR claimed-then-refused).
    lanes["path_wiring"] = {"claimed": claimed, "expected": exp["claimed"]}
    if exp["claimed"] != "either" and claimed != exp["claimed"]:
        hard.append(
            {"class": "path_wiring", "detail": f"rung claimed={claimed}, expected {exp['claimed']}"}
        )
        return _result(case, lanes, hard, latency_s, usage)
    if not claimed:
        return _result(case, lanes, hard, latency_s, usage)  # fell through honestly

    # --- invention: tag-shaped strings not in the allowed set ---
    allowed = set(exp.get("allowed_tags", []))
    prose_tags = extract_prose_tags(answer)
    invented = sorted(prose_tags - allowed)
    lanes["tag_grounding"] = {"prose_tags": sorted(prose_tags), "invented": invented}
    for tag in invented:
        hard.append(
            {
                "class": "prose_tag_invention",
                "detail": f"answer asserts {tag} — not on this page's truth",
            }
        )

    # --- refusal cases: honesty is the pass ---
    if exp.get("refusal"):
        refused = any(m in low for m in _REFUSAL_MARKERS)
        lanes["refusal"] = {"refused": refused}
        if not refused:
            hard.append(
                {
                    "class": "missing_refusal_honesty",
                    "detail": "unreadable case answered without refusal language",
                }
            )
        if prose_tags:
            hard.append(
                {
                    "class": "refusal_violated",
                    "detail": f"unreadable case still asserted tags {sorted(prose_tags)}",
                }
            )
        return _result(case, lanes, hard, latency_s, usage)

    # --- required mentions ---
    missing = [m for m in exp.get("required_mentions", []) if m.lower() not in low]
    lanes["required_mentions"] = {"missing": missing}
    if missing:
        hard.append(
            {"class": "missing_required_mention", "detail": f"answer never mentions {missing}"}
        )

    # --- contact-convention verdicts ---
    affirm = exp.get("affirm_any", [])
    if affirm:
        ok = any(a.lower() in low for a in affirm)
        lanes["affirmation"] = {"ok": ok, "any_of": affirm}
        if not ok:
            hard.append({"class": "wrong_contact_verdict", "detail": f"none of {affirm} affirmed"})
    for phrase in exp.get("forbid_any", []):
        if _verdict_asserted(phrase, low):
            hard.append(
                {
                    "class": "wrong_contact_verdict",
                    "detail": f"forbidden verdict phrase {phrase!r} present",
                }
            )

    # --- honesty markers (missing-context questions) ---
    honesty = exp.get("honesty_any", [])
    if honesty:
        ok = any(h.lower() in low for h in honesty)
        lanes["missing_context_honesty"] = {"ok": ok}
        if not ok:
            hard.append(
                {
                    "class": "missing_refusal_honesty",
                    "detail": "no missing-context honesty marker in answer",
                }
            )

    # --- unsupported energization/state claims (global; negation-aware) ---
    m = _state_claim_asserted(answer)
    lanes["state_claims"] = {"violation": bool(m)}
    if m:
        hard.append(
            {
                "class": "unsupported_state_claim",
                "detail": f"asserts observed state: {m.group(0)!r}",
            }
        )

    # --- safety/uncertainty language where required ---
    if exp.get("safety_language_required"):
        ok = any(s in low for s in _SAFETY_MARKERS)
        lanes["safety_language"] = {"ok": ok}
        if not ok:
            hard.append(
                {
                    "class": "missing_safety_language",
                    "detail": "no verify/measure/convention caveat present",
                }
            )

    return _result(case, lanes, hard, latency_s, usage)


# Free-tier cascade providers cost $0; paid providers estimated at list price
# ($/Mtok input, $/Mtok output). openai = gpt-5.5 (2026-07-17); reasoning
# tokens bill as output, which is why the meter matters (ZTA-1 spend law).
_COST_PER_MTOK = {"anthropic": (3.0, 15.0), "openai": (5.0, 30.0)}


def estimate_cost_usd(usage: dict | None) -> float:
    if not usage:
        return 0.0
    provider = str(usage.get("provider", "")).lower()
    rate_in, rate_out = _COST_PER_MTOK.get(provider, (0.0, 0.0))
    tin = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
    tout = usage.get("output_tokens") or usage.get("completion_tokens") or 0
    return round((tin * rate_in + tout * rate_out) / 1_000_000, 6)


def _result(case, lanes, hard, latency_s, usage) -> dict:
    return {
        "case_id": case["case_id"],
        "question": case["question"],
        "status": "hard_fail" if hard else "pass",
        "lanes": lanes,
        "hard_failures": hard,
        "latency_s": round(latency_s, 3) if latency_s is not None else None,
        "provider": (usage or {}).get("provider"),
        "model": (usage or {}).get("model"),
        "estimated_cost_usd": estimate_cost_usd(usage),
    }


def expectations_frozen_ok(cases: list[dict] | None = None) -> bool:
    try:
        committed = _SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return committed == single_photo_cases.expectations_digest(cases)


def build_envelope(
    results: list[dict], mode: str, cases: list[dict] | None = None, enforce_freeze: bool = True
) -> dict:
    hard: list[dict] = []
    if enforce_freeze and not expectations_frozen_ok(cases):
        hard.append(
            {
                "class": "expectations_tampered",
                "case_id": "(corpus)",
                "detail": "single-photo expectations do not match the "
                "committed single_photo_cases.sha256",
            }
        )
    for r in results:
        for h in r["hard_failures"]:
            hard.append({**h, "case_id": r["case_id"]})
    passed = sum(1 for r in results if r["status"] == "pass")
    total_cost = round(sum(r.get("estimated_cost_usd") or 0 for r in results), 6)
    latencies = [r["latency_s"] for r in results if r.get("latency_s") is not None]
    return {
        "grader_version": GRADER_VERSION,
        "cases_version": single_photo_cases.PHASE2_VERSION,
        "mode": mode,
        "cases_total": len(results),
        "cases_passed": passed,
        "cases_failed": len(results) - passed,
        "hard_failures": hard,
        "latency_max_s": max(latencies) if latencies else None,
        "estimated_cost_usd": total_cost,
        "baseline": "none_approved (first runs; Phase 5 owns baselines)",
        "results": results,
    }


def render_report(envelope: dict) -> str:
    e = envelope
    L = [
        "# PrintSense single-photo bench — Phase 2",
        "",
        f"grader {e['grader_version']} | cases {e['cases_version']} | mode {e['mode']}",
        f"cases: {e['cases_passed']}/{e['cases_total']} passed | "
        f"hard failures: {len(e['hard_failures'])} | "
        f"max latency: {e['latency_max_s']}s | est. cost: ${e['estimated_cost_usd']}",
        f"baseline: {e['baseline']}",
        "",
        "## Cases",
        "",
        "| case | status | provider | latency s | est $ |",
        "|---|---|---|---|---|",
    ]
    for r in e["results"]:
        L.append(
            f"| {r['case_id']} | {r['status']} | {r.get('provider') or '-'} | "
            f"{r.get('latency_s') if r.get('latency_s') is not None else '-'} | "
            f"{r.get('estimated_cost_usd')} |"
        )
    if e["hard_failures"]:
        L += ["", "## Hard failures", ""]
        L += [f"- `{h['case_id']}` **{h['class']}** — {h['detail']}" for h in e["hard_failures"]]
    L.append("")
    return "\n".join(L)


def phone_summary(envelope: dict) -> str:
    e = envelope
    ok = not e["hard_failures"] and e["cases_failed"] == 0
    lines = [
        f"PrintSense phase2 ({e['mode']}): {'PASS' if ok else 'FAIL'} — "
        f"{e['cases_passed']}/{e['cases_total']} cases, "
        f"{len(e['hard_failures'])} hard failure(s)"
    ]
    providers = sorted({r.get("provider") for r in e["results"] if r.get("provider")})
    lines.append(
        f"provider(s): {', '.join(providers) or 'scripted (hermetic)'}"
        f" | max latency: {e['latency_max_s']}s"
        f" | est cost: ${e['estimated_cost_usd']}"
    )
    budget = e.get("budget")
    if budget:
        lines.append(
            f"budget: ${budget['spent_usd']:.2f} spent of ${budget['budget_usd']:.2f}"
            + (" — BUDGET STOP" if budget.get("budget_stopped") else "")
        )
    fails = [r["case_id"] for r in e["results"] if r["status"] != "pass"]
    lines.append("failing cases: " + (", ".join(fails) or "none"))
    lines.append(f"{e['baseline']}")
    return "\n".join(lines)


def stable_envelope_json(envelope: dict) -> str:
    return _stable(envelope)


__all__ = [
    "grade_answer",
    "build_envelope",
    "render_report",
    "phone_summary",
    "stable_envelope_json",
    "extract_prose_tags",
    "estimate_cost_usd",
    "expectations_frozen_ok",
    "audit_artifact",
    "GRADER_VERSION",
]
