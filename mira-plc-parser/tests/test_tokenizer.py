"""Tokenizer (_kw) boundary tests -- camelCase humps must act as word breaks.

The name-pattern matcher used by the analysis layer originally treated only `_`, digits, spaces
and symbols as word boundaries, so a keyword fused into a camelCase identifier was missed
(`fault` in `FaultRoutine`). PLC names are routinely camelCase, so that was a real coverage gap.
These tests pin both the fix (humps match) and the guard (no new false positives on fused words).
"""
from mira_plc_parser.analyze import _FAULT_PAT, _kw


def test_camelcase_hump_after_keyword_matches():
    # the canonical miss: "fault" fused before an uppercase hump
    assert _FAULT_PAT.search("FaultRoutine")
    assert _FAULT_PAT.search("VFD_FaultCode")   # matched on the NAME now, not just a description


def test_camelcase_hump_before_keyword_matches():
    # "fault" fused after a lowercase->Uppercase hump
    assert _FAULT_PAT.search("MotorFault")
    assert _FAULT_PAT.search("conveyorTripCount")   # "trip" between humps


def test_classic_boundaries_still_match():
    # underscore / digit / start / end boundaries keep working unchanged
    assert _FAULT_PAT.search("Conv_Fault")
    assert _FAULT_PAT.search("fault")
    assert _FAULT_PAT.search("ALARM_1")


def test_no_false_positive_on_fused_lowercase():
    # not a boundary: keyword buried inside a lowercase run must NOT match (guards against
    # the lazy fix of just dropping the boundary checks)
    assert not _kw(["fault"]).search("defaulting")   # 'fault' inside 'defaulting'
    assert not _kw(["trip"]).search("stripe")        # 'trip' inside 'stripe'
    assert not _kw(["alarm"]).search("alarmist")     # trailing lowercase run, no hump
