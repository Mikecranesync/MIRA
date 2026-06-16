"""
Unit tests for judge.py — 13 tests, zero network, zero disk I/O.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram_test_runner"))

from judge import FIX_SUGGESTIONS, score  # noqa: E402

# --- Fixtures ---

PLC_CASE = {
    "name": "ab_micro820_tag",
    "must_contain": ["Allen-Bradley", "Micro820", "PLC"],
    "must_not_contain": ["Siemens", "PowerFlex", "VFD"],
    "expected": {
        "make": "Allen-Bradley",
        "model": "Micro820",
        "catalog": "2080-LC20-20QWB",
        "component_type": "PLC",
    },
    "fault_cause_keywords": ["I/O", "input", "output", "programming"],
    "next_step_keywords": ["check I/O", "verify program"],
    "max_words": 150,
    "adversarial": False,
}

PERFECT_REPLY = (
    "Allen-Bradley Micro820 PLC, catalog 2080-LC20-20QWB. "
    "This controller handles I/O and program logic. The fault is likely caused by an input mismatch. "
    "Check the I/O status and verify the program logic."
)

ADVERSARIAL_CASE = {**PLC_CASE, "adversarial": True}

VFD_CASE = {
    "name": "gs10_vfd_tag",
    "must_contain": ["AutomationDirect", "GS10", "VFD"],
    "must_not_contain": ["Allen-Bradley", "PowerFlex", "PLC"],
    "expected": {
        "make": "AutomationDirect",
        "model": "GS10",
        "catalog": "GS10-20P5",
        "component_type": "VFD",
    },
    "fault_cause_keywords": ["motor", "drive", "frequency", "speed"],
    "next_step_keywords": ["check motor", "reset drive"],
    "max_words": 150,
    "adversarial": False,
}


# --- Tests ---


def test_perfect_score():
    result = score(PLC_CASE, PERFECT_REPLY)
    assert result["passed"] is True
    assert result["failure_bucket"] is None
    assert all(result["conditions"].values())
    assert result["score"] == result["max_score"]


def test_transport_failure():
    result = score(PLC_CASE, None)
    assert result["passed"] is False
    assert result["failure_bucket"] == "TRANSPORT_FAILURE"
    assert result["confidence"] == 0.0
    assert result["score"] == 0


def test_identification_only():
    reply = "This is an Allen-Bradley Micro820 PLC."
    result = score(PLC_CASE, reply)
    assert result["passed"] is False
    assert result["failure_bucket"] == "IDENTIFICATION_ONLY"
    assert result["conditions"]["IDENTIFICATION"] is True
    assert result["conditions"]["FAULT_CAUSE"] is False
    assert result["conditions"]["NEXT_STEP"] is False


def test_no_fault_cause():
    reply = "Allen-Bradley Micro820 PLC. Reset the device and check connections."
    result = score(PLC_CASE, reply)
    assert result["passed"] is False
    assert result["failure_bucket"] == "NO_FAULT_CAUSE"
    assert result["conditions"]["IDENTIFICATION"] is True
    assert result["conditions"]["FAULT_CAUSE"] is False
    assert result["conditions"]["NEXT_STEP"] is True


def test_no_next_step():
    reply = "Allen-Bradley Micro820 PLC. The failure is likely caused by an I/O mismatch in the program logic."
    result = score(PLC_CASE, reply)
    assert result["passed"] is False
    assert result["failure_bucket"] == "NO_NEXT_STEP"
    assert result["conditions"]["IDENTIFICATION"] is True
    assert result["conditions"]["FAULT_CAUSE"] is True
    assert result["conditions"]["NEXT_STEP"] is False


def test_too_verbose():
    # Build a reply that passes ID, FAULT_CAUSE, NEXT_STEP but exceeds word limit
    reply_base = "Allen-Bradley Micro820 PLC. This is due to overload. Check status. "
    # Add enough words to exceed 150
    words = reply_base.split() + ["word"] * 150
    long_reply = " ".join(words)
    result = score(PLC_CASE, long_reply)
    assert result["word_count"] > 150
    # Verify it has all conditions except readability
    assert result["conditions"]["IDENTIFICATION"] is True
    assert result["conditions"]["FAULT_CAUSE"] is True
    assert result["conditions"]["NEXT_STEP"] is True
    assert result["conditions"]["READABILITY"] is False
    assert result["passed"] is False
    assert result["failure_bucket"] == "TOO_VERBOSE"


def test_hallucination_detected():
    hallucinated = "This appears to be a Siemens S7-1200 PLC controller."
    result = score(PLC_CASE, hallucinated)
    assert result["passed"] is False
    assert result["failure_bucket"] == "HALLUCINATION"
    assert "Siemens" in result["extracted_facts"]["must_not_contain_violated"]


def test_ocr_failure():
    generic = "I can see some kind of electrical equipment but cannot read the label clearly."
    result = score(PLC_CASE, generic)
    assert result["passed"] is False
    assert result["failure_bucket"] == "OCR_FAILURE"
    assert result["conditions"]["IDENTIFICATION"] is False


def test_adversarial_pass_gets_informational_bucket():
    result = score(ADVERSARIAL_CASE, PERFECT_REPLY)
    assert result["passed"] is True
    assert result["failure_bucket"] == "ADVERSARIAL_PARTIAL"


def test_word_count_exactly_150_passes():
    reply = (
        "Allen-Bradley Micro820 PLC controller with catalog number. "
        + "This device is likely to fail. " * 30
        + "Check I/O immediately."
    )
    word_count = len(reply.split())
    if word_count > 150:
        reply = " ".join(reply.split()[:150])
    result = score(PLC_CASE, reply)
    assert result["word_count"] <= 150
    assert result["conditions"]["READABILITY"] is True


def test_word_count_151_fails():
    reply = (
        "Allen-Bradley Micro820 PLC controller with catalog number. "
        + "This device is likely to fail. " * 30
    )
    # Ensure > 150 words
    while len(reply.split()) <= 150:
        reply += "extra word "
    result = score(PLC_CASE, reply)
    assert result["word_count"] > 150
    assert result["conditions"]["READABILITY"] is False


def test_fix_suggestions_non_empty():
    buckets = [
        "TRANSPORT_FAILURE",
        "IDENTIFICATION_ONLY",
        "NO_FAULT_CAUSE",
        "NO_NEXT_STEP",
        "TOO_VERBOSE",
        "HALLUCINATION",
        "OCR_FAILURE",
        "JARGON_FAILURE",
        "RESPONSE_TOO_GENERIC",
        "ADVERSARIAL_PARTIAL",
    ]
    for bucket in buckets:
        assert bucket in FIX_SUGGESTIONS
        assert len(FIX_SUGGESTIONS[bucket]) > 10


def test_fault_cause_from_manifest_keywords():
    # Manifest keywords should trigger fault_cause
    reply_with_manifest_kw = (
        "Allen-Bradley Micro820 PLC. The motor overload caused the fault. Check status."
    )
    result = score(PLC_CASE, reply_with_manifest_kw)
    assert result["conditions"]["FAULT_CAUSE"] is True
