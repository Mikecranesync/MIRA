"""Deterministic keyword-match scorer extracted from judge.py.

Provides the CONTAINS check layer: keyword matching, hallucination detection,
fault-cause/next-step pattern matching. No LLM, no network, no side effects.
"""

from __future__ import annotations

# Built-in fault cause patterns (case-insensitive)
FAULT_CAUSE_PATTERNS: list[str] = [
    "caused by", "due to", "likely", "indicates", "suggest",
    "overloaded", "overheated", "failed", "tripped", "worn",
    "shorted", "open circuit", "low voltage", "high temp",
    "overcurrent", "overload", "overheat", "burnout", "damaged",
    "corroded", "loose", "vibration", "moisture", "contamination",
    "misalignment", "rotor", "rotation", "seal", "coupling",
    "winding", "bearing", "insulation", "phase", "imbalance",
    "lubrication", "wear", "probable", "most likely", "voltage",
]

# Built-in next step patterns (case-insensitive)
NEXT_STEP_PATTERNS: list[str] = [
    "check", "inspect", "replace", "reset", "measure", "verify",
    "test", "tighten", "clean", "call", "contact", "disconnect",
    "reconnect", "read", "set", "clear", "remove", "install",
    "confirm", "ensure", "turn off", "power off", "shut down",
]

# Fix suggestions per failure bucket
FIX_SUGGESTIONS: dict[str, str] = {
    "TRANSPORT_FAILURE": "No reply received. Check bot container health, Telegram token validity, network connectivity.",
    "IDENTIFICATION_ONLY": "Bot identified device but gave no fault cause or next step. Update system prompt to require: 1) likely cause, 2) immediate action.",
    "NO_FAULT_CAUSE": "Bot gave a next step but never explained why the device might have failed. Add 'explain likely fault cause' to system prompt.",
    "NO_NEXT_STEP": "Bot explained the fault cause but gave no action. Add 'give one specific next step' to system prompt.",
    "TOO_VERBOSE": "Response over 150 words. Add word limit instruction to system prompt: 'Keep response under 100 words.'",
    "HALLUCINATION": "Bot mentioned brand or component not in image. Review vision model confidence or add grounding instruction.",
    "OCR_FAILURE": "Bot failed to read the nameplate. Try: better photo quality, tighter crop, stronger lighting.",
    "JARGON_FAILURE": "Response uses unexplained acronyms. Add: 'Define any technical terms you use' to system prompt.",
    "RESPONSE_TOO_GENERIC": "Response could apply to any machine. Add: 'Reference the specific model you see in the image' to system prompt.",
    "ADVERSARIAL_PARTIAL": "Partial pass on adversarial/degraded case. Expected — monitor for regression.",
}


def keyword_match_score(
    reply: str,
    must_contain: list[str],
    must_not_contain: list[str] | None = None,
) -> tuple[float, list[str], list[str]]:
    """Score keyword presence in a reply.

    Returns:
        (score, matched_keywords, violated_keywords)
        score: fraction of must_contain found (0.0 - 1.0)
        matched_keywords: which must_contain terms were found
        violated_keywords: which must_not_contain terms were found (hallucinations)
    """
    if not reply:
        return 0.0, [], []

    reply_lower = reply.lower()
    matched = [t for t in must_contain if t.lower() in reply_lower]
    score = len(matched) / len(must_contain) if must_contain else 1.0

    violated = []
    if must_not_contain:
        violated = [t for t in must_not_contain if t.lower() in reply_lower]

    return score, matched, violated


def check_fault_cause(
    reply: str,
    extra_keywords: list[str] | None = None,
) -> tuple[bool, list[str]]:
    """Check if reply contains fault cause indicators.

    Returns:
        (found, matched_patterns)
    """
    if not reply:
        return False, []

    reply_lower = reply.lower()
    all_patterns = FAULT_CAUSE_PATTERNS + [k.lower() for k in (extra_keywords or [])]
    matched = [p for p in all_patterns if p in reply_lower]
    return len(matched) > 0, matched[:5]


def check_next_step(
    reply: str,
    extra_keywords: list[str] | None = None,
) -> tuple[bool, list[str]]:
    """Check if reply contains actionable next step indicators.

    Returns:
        (found, matched_patterns)
    """
    if not reply:
        return False, []

    reply_lower = reply.lower()
    all_patterns = NEXT_STEP_PATTERNS + [k.lower() for k in (extra_keywords or [])]
    matched = [p for p in all_patterns if p in reply_lower]
    return len(matched) > 0, matched[:5]


def score_case(case: dict, reply: str | None, elapsed: float = 0.0) -> dict:
    """Full deterministic scoring of a single test case.

    Compatible with the judge.py score() interface. Extracted and reusable
    across all regimes.

    Args:
        case: test case dict (must_contain, must_not_contain, expected, etc.)
        reply: bot reply text or None (transport failure)
        elapsed: response time in seconds

    Returns:
        Result dict with conditions, passed, failure_bucket, contains_score
    """
    name = case.get("name", case.get("id", "unknown"))
    _pc = case.get("pass_conditions", {})
    must_contain = case.get("must_contain") or _pc.get("must_contain", [])
    must_not_contain = case.get("must_not_contain") or _pc.get("must_not_contain", [])
    expected = case.get("expected", {})
    fault_cause_keywords = case.get("fault_cause_keywords", [])
    next_step_keywords = case.get("next_step_keywords", [])
    max_words = case.get("max_words") or _pc.get("max_words", 150)
    adversarial = case.get("adversarial", False)
    speed_timeout = case.get("speed_timeout", 30)
    require_fault_cause = expected.get("must_give_fault_cause", True)

    # Transport failure
    if reply is None:
        return _transport_failure(name)

    reply_lower = reply.lower()
    word_count = len(reply.split())

    # 1. IDENTIFICATION
    id_terms = list(must_contain) + [expected.get("make", ""), expected.get("model", "")]
    id_terms = [t for t in id_terms if t]
    identification = any(t.lower() in reply_lower for t in id_terms) if id_terms else True

    # 2. FAULT_CAUSE
    fault_cause_found, fault_cause_matched = check_fault_cause(reply, fault_cause_keywords)

    # 3. NEXT_STEP
    next_step_found, next_step_matched = check_next_step(reply, next_step_keywords)

    # 4. READABILITY
    readability = word_count <= max_words

    # 5. SPEED
    speed = (elapsed == 0.0) or (elapsed < speed_timeout)

    # 6. ACTIONABILITY
    actionability = identification and next_step_found

    # Hallucination check
    must_not_violated = [t for t in must_not_contain if t.lower() in reply_lower]
    hallucination = len(must_not_violated) > 0

    conditions = {
        "IDENTIFICATION": identification,
        "FAULT_CAUSE": fault_cause_found if require_fault_cause else True,
        "NEXT_STEP": next_step_found,
        "READABILITY": readability,
        "SPEED": speed,
        "ACTIONABILITY": actionability,
    }

    passed = all(conditions.values()) and not hallucination

    # Failure bucket
    failure_bucket = None
    if passed:
        if adversarial:
            failure_bucket = "ADVERSARIAL_PARTIAL"
    else:
        if hallucination:
            failure_bucket = "HALLUCINATION"
        elif not identification:
            failure_bucket = "OCR_FAILURE"
        elif identification and not fault_cause_found and not next_step_found and require_fault_cause:
            failure_bucket = "IDENTIFICATION_ONLY"
        elif identification and next_step_found and not fault_cause_found and require_fault_cause:
            failure_bucket = "NO_FAULT_CAUSE"
        elif identification and fault_cause_found and not next_step_found:
            failure_bucket = "NO_NEXT_STEP"
        elif not readability:
            failure_bucket = "TOO_VERBOSE"
        else:
            failure_bucket = "RESPONSE_TOO_GENERIC"

    # CONTAINS score: fraction of must_contain keywords matched
    contains_score, matched_kws, _ = keyword_match_score(reply, must_contain, must_not_contain)

    fix_suggestion = FIX_SUGGESTIONS.get(failure_bucket, "") if failure_bucket else ""

    return {
        "case": name,
        "passed": passed,
        "failure_bucket": failure_bucket,
        "fix_suggestion": fix_suggestion,
        "contains_score": contains_score,
        "word_count": word_count,
        "elapsed": elapsed,
        "conditions": conditions,
        "extracted_facts": {
            "identification_terms_found": [t for t in id_terms if t.lower() in reply_lower],
            "fault_cause_found": fault_cause_matched,
            "next_step_found": next_step_matched,
            "must_not_contain_violated": must_not_violated,
        },
        "score": sum(1 for v in conditions.values() if v),
        "max_score": 6,
        "confidence": round(sum(1 for v in conditions.values() if v) / 6, 4),
    }


def _transport_failure(name: str) -> dict:
    return {
        "case": name,
        "passed": False,
        "failure_bucket": "TRANSPORT_FAILURE",
        "fix_suggestion": FIX_SUGGESTIONS["TRANSPORT_FAILURE"],
        "contains_score": 0.0,
        "word_count": 0,
        "elapsed": 0.0,
        "conditions": {k: False for k in [
            "IDENTIFICATION", "FAULT_CAUSE", "NEXT_STEP",
            "READABILITY", "SPEED", "ACTIONABILITY",
        ]},
        "extracted_facts": {
            "identification_terms_found": [],
            "fault_cause_found": [],
            "next_step_found": [],
            "must_not_contain_violated": [],
        },
        "score": 0,
        "max_score": 6,
        "confidence": 0.0,
    }
