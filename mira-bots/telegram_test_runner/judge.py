"""
Deterministic scoring engine — 6-part pass condition.
No LLM, no network, no side effects.
"""

# Built-in fault cause patterns (case-insensitive)
_FAULT_CAUSE_PATTERNS = [
    "caused by",
    "due to",
    "likely",
    "indicates",
    "suggest",
    "overloaded",
    "overheated",
    "failed",
    "tripped",
    "worn",
    "shorted",
    "open circuit",
    "low voltage",
    "high temp",
    "overcurrent",
    "overload",
    "overheat",
    "burnout",
    "damaged",
    "corroded",
    "loose",
    "vibration",
    "moisture",
    "contamination",
    # mechanical / motor faults
    "misalignment",
    "rotor",
    "rotation",
    "seal",
    "coupling",
    "winding",
    "bearing",
    "insulation",
    "phase",
    "imbalance",
    "lubrication",
    "wear",
    "probable",
    "most likely",
    "voltage",
]

# Built-in next step patterns (case-insensitive)
_NEXT_STEP_PATTERNS = [
    "check",
    "inspect",
    "replace",
    "reset",
    "measure",
    "verify",
    "test",
    "tighten",
    "clean",
    "call",
    "contact",
    "disconnect",
    "reconnect",
    "read",
    "set",
    "clear",
    "remove",
    "install",
    "confirm",
    "ensure",
    "turn off",
    "power off",
    "shut down",
]

FIX_SUGGESTIONS = {
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


def score(case: dict, reply: str | None, elapsed: float = 0.0) -> dict:
    """Score a single test case against the bot reply.

    Args:
        case: test case dict from manifest
        reply: bot reply text or None (transport failure)
        elapsed: response time in seconds

    Returns:
        result dict with conditions, passed, failure_bucket, fix_suggestion
    """
    name = case.get("name", "unknown")
    _pc = case.get("pass_conditions", {})
    must_contain = case.get("must_contain", None) or _pc.get("must_contain", [])
    must_not_contain = case.get("must_not_contain", None) or _pc.get("must_not_contain", [])
    expected = case.get("expected", {})
    fault_cause_keywords = case.get("fault_cause_keywords", [])
    next_step_keywords = case.get("next_step_keywords", [])
    max_words = case.get("max_words", None) or _pc.get("max_words", 150)
    adversarial = case.get("adversarial", False)
    speed_timeout = case.get("speed_timeout", 30)
    require_fault_cause = expected.get("must_give_fault_cause", True)

    # Transport failure
    if reply is None:
        return _transport_failure(name)

    reply_lower = reply.lower()
    word_count = len(reply.split())

    # --- Evaluate each condition ---

    # 1. IDENTIFICATION: at least one device-specific term found
    id_terms = must_contain + [expected.get("make", ""), expected.get("model", "")]
    id_terms = [t for t in id_terms if t]
    if not id_terms:
        # No specific terms required (adversarial/degraded image) — vacuously true
        identification = True
    else:
        identification = any(t.lower() in reply_lower for t in id_terms)

    # 2. FAULT_CAUSE: built-in patterns OR manifest keywords
    all_fault_kws = _FAULT_CAUSE_PATTERNS + [k.lower() for k in fault_cause_keywords]
    fault_cause_found = [kw for kw in all_fault_kws if kw in reply_lower]
    fault_cause = len(fault_cause_found) > 0

    # 3. NEXT_STEP: built-in patterns OR manifest keywords
    all_next_kws = _NEXT_STEP_PATTERNS + [k.lower() for k in next_step_keywords]
    next_step_found = [kw for kw in all_next_kws if kw in reply_lower]
    next_step = len(next_step_found) > 0

    # 4. READABILITY: word count <= max_words
    readability = word_count <= max_words

    # 5. SPEED: elapsed < speed_timeout (always True in fallback mode where elapsed=0.0)
    speed = (elapsed == 0.0) or (elapsed < speed_timeout)

    # 6. ACTIONABILITY: identification + next_step both pass
    actionability = identification and next_step

    # Hallucination check (affects bucket but doesn't block pass directly — hallucination IS a fail)
    must_not_violated = [t for t in must_not_contain if t.lower() in reply_lower]
    hallucination = len(must_not_violated) > 0

    conditions = {
        "IDENTIFICATION": identification,
        "FAULT_CAUSE": fault_cause if require_fault_cause else True,
        "NEXT_STEP": next_step,
        "READABILITY": readability,
        "SPEED": speed,
        "ACTIONABILITY": actionability,
    }

    passed = all(conditions.values()) and not hallucination

    # --- Failure bucket ---
    failure_bucket = None
    if passed:
        if adversarial:
            failure_bucket = "ADVERSARIAL_PARTIAL"
    else:
        if hallucination:
            failure_bucket = "HALLUCINATION"
        elif not identification:
            failure_bucket = "OCR_FAILURE"
        elif identification and not fault_cause and not next_step and require_fault_cause:
            failure_bucket = "IDENTIFICATION_ONLY"
        elif identification and next_step and not fault_cause and require_fault_cause:
            failure_bucket = "NO_FAULT_CAUSE"
        elif identification and fault_cause and not next_step:
            failure_bucket = "NO_NEXT_STEP"
        elif not readability:
            failure_bucket = "TOO_VERBOSE"
        else:
            failure_bucket = "RESPONSE_TOO_GENERIC"

    fix_suggestion = FIX_SUGGESTIONS.get(failure_bucket, "") if failure_bucket else ""

    return {
        "case": name,
        "passed": passed,
        "failure_bucket": failure_bucket,
        "fix_suggestion": fix_suggestion,
        "word_count": word_count,
        "elapsed": elapsed,
        "conditions": conditions,
        "extracted_facts": {
            "identification_terms_found": [t for t in id_terms if t.lower() in reply_lower],
            "fault_cause_found": fault_cause_found[:3],
            "next_step_found": next_step_found[:3],
            "must_not_contain_violated": must_not_violated,
        },
        # Legacy fields for backward compat with report.py
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
        "word_count": 0,
        "elapsed": 0.0,
        "conditions": {
            k: False
            for k in [
                "IDENTIFICATION",
                "FAULT_CAUSE",
                "NEXT_STEP",
                "READABILITY",
                "SPEED",
                "ACTIONABILITY",
            ]
        },
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
