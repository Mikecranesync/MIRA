"""H4 citation-integrity regressions — from the 2026-08-03 probe sweep.

Two live defects in `enforce_citation_or_gap_admission`:

1. **A meaningless citation counted as grounding.** `_H4_SOURCE_RE` matched any
   `[Source:` at all, so `[Source: [3] --- Reference Documents]` — a bare
   reference number — SUPPRESSED the honest KB-gap admission. A reply with a
   worthless citation looked better grounded than one with none.
2. **The stock admission contradicted the reply above it.** Probe `dc-02`
   returned "I have the AutomationDirect GS10 manual indexed." with no citation,
   so H4 appended "I don't have specific documentation indexed for this" — both
   claims in one message. Judged 4.4/5, because the rubric has no dimension for
   internal consistency.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.engine import (  # noqa: E402
    _has_usable_citation,
    enforce_citation_or_gap_admission,
)


# ── 1. a citation must name something ────────────────────────────────────────


def test_bare_reference_number_is_not_a_citation():
    assert not _has_usable_citation("Check the capacitor [Source: [3]].")
    assert not _has_usable_citation("Check it [Source: [3] --- Reference Documents].")
    assert not _has_usable_citation("See [Source: Reference Documents].")


def test_a_real_citation_is_usable():
    assert _has_usable_citation("CE10 is a comms fault [Source: AutomationDirect — Fault Codes].")
    assert _has_usable_citation("[Source: Rockwell Automation PowerFlex 525 manual]")


def test_mixed_citations_count_when_one_is_real():
    reply = "See [Source: [3]] and also [Source: AutomationDirect GS10 manual]."
    assert _has_usable_citation(reply)


def test_meaningless_citation_no_longer_suppresses_the_admission():
    """The core bug: a worthless citation used to satisfy H4 entirely."""
    reply = (
        "Do you know why a faulty capacitor can prevent the condenser fan from "
        "spinning [Source: [3] --- Reference Documents]?"
    )
    out = enforce_citation_or_gap_admission(reply)
    assert "KB-gap" in out, "a meaningless citation must not stand in for grounding"


# ── 2. the admission must not contradict the reply ───────────────────────────


def test_possession_claim_gets_a_correcting_admission_not_a_contradiction():
    """Observed live as probe `dc-02`."""
    reply = "I have the AutomationDirect GS10 manual indexed."
    out = enforce_citation_or_gap_admission(reply)
    assert "KB-gap" in out, "still has to admit the gap"
    assert "Correction:" in out, "must correct itself rather than contradict"
    assert "I don't have specific documentation indexed for this" not in out


def test_ordinary_ungrounded_reply_still_gets_the_stock_admission():
    reply = "Check the belt tension and the drive coupling before anything else."
    out = enforce_citation_or_gap_admission(reply)
    assert "I don't have specific documentation" in out
    assert "Correction:" not in out


def test_grounded_reply_is_untouched():
    reply = "CE10 is a COM1 transmission fault [Source: AutomationDirect — Fault Code Table]."
    assert enforce_citation_or_gap_admission(reply) == reply


def test_existing_gap_admission_is_not_doubled():
    reply = "I don't have specific documentation for that device — check the nameplate."
    assert enforce_citation_or_gap_admission(reply) == reply


def test_short_replies_are_left_alone():
    assert enforce_citation_or_gap_admission("OK") == "OK"


# ── E2 regression (prod 2026-08-04): no KB-gap footer on policy templates ────
# The H4 enforcer appended the stock admission to the canned control refusal
# (prod trace: text_len=666 vs the ~430-char template). A policy reply asserts
# no technical fact and must exit enforcement byte-identical.


def test_control_refusal_exits_enforcement_byte_identical():
    from shared.engine import enforce_citation_or_gap_admission
    from shared.guardrails import CONTROL_ACTION_REFUSAL

    out = enforce_citation_or_gap_admission(
        CONTROL_ACTION_REFUSAL, dispatch_kind="control_action_refusal"
    )
    assert out == CONTROL_ACTION_REFUSAL


def test_uns_gate_prompt_is_not_footered():
    from shared.engine import enforce_citation_or_gap_admission

    prompt = (
        "Before I diagnose, I need to know the equipment. Tell me the "
        "manufacturer and model (e.g., 'Allen-Bradley PowerFlex 525')."
    )
    assert enforce_citation_or_gap_admission(prompt, dispatch_kind="uns_confirm_request") == prompt


def test_uncited_technical_reply_still_gets_the_admission():
    from shared.engine import _H4_STOCK_ADMISSION, enforce_citation_or_gap_admission

    reply = "Set the acceleration time parameter to 10 seconds and retry the start."
    out = enforce_citation_or_gap_admission(reply, dispatch_kind="")
    assert out == reply + _H4_STOCK_ADMISSION


def test_admission_append_is_logged_without_message_content(caplog):
    import logging

    from shared.engine import enforce_citation_or_gap_admission

    reply = "SECRET-MARKER torque spec is 4.5 Nm on the coupling bolts."
    with caplog.at_level(logging.INFO, logger="mira-gsd"):
        enforce_citation_or_gap_admission(reply, dispatch_kind="continue_current")
    lines = [r.message for r in caplog.records if "H4_GAP_ADMISSION" in r.message]
    assert lines, "append must emit an H4_GAP_ADMISSION log line"
    assert "dispatch_kind=continue_current" in lines[0]
    assert "SECRET-MARKER" not in " ".join(lines)  # never log message bodies


# ── CIT-005: a reply that asserts nothing never gets the KB-gap footer ───────
# Live Telethon campaign c1/c1r4 (t1:reset_procedure, t1:symptom_report). MIRA
# asked the technician a clarifying question and, in the same message, told them
# it had no documentation and to go read the nameplate themselves. Two failures,
# one root cause. This is the same class as the E2 control-refusal incident that
# created _H4_SKIP_DISPATCH_KINDS — but keyed on the REPLY rather than on the
# dispatch kind, because the diagnostic path returns dispatch_kind="".


def test_bare_clarifying_question_is_not_footered():
    from shared.engine import enforce_citation_or_gap_admission

    q = "What is the exact fault code displayed after the undervoltage fault?"
    assert enforce_citation_or_gap_admission(q, dispatch_kind="") == q


def test_clarifying_question_with_an_option_menu_is_not_footered():
    from shared.engine import enforce_citation_or_gap_admission

    reply = (
        "Before I can give you a confident diagnosis, could you share one more "
        "detail \u2014 what exact fault code, alarm number, or behaviour is the "
        "equipment showing right now?\n\n"
        "1. Fault/alarm code displayed (e.g. F001, AL-14, OC)\n"
        "2. Visible symptom (e.g. trips on start, runs slow, won't start)\n"
        "3. Sensor reading (e.g. pressure at 120 PSI, temp at 90C)\n"
        "4. Other \u2014 describe what you're seeing"
    )
    assert enforce_citation_or_gap_admission(reply, dispatch_kind="") == reply


def test_a_question_that_also_asserts_still_gets_the_admission():
    """The exemption is for replies that assert NOTHING — not for any reply
    that happens to contain a question mark. A technical claim still needs its
    citation or its admission."""
    from shared.engine import _H4_STOCK_ADMISSION, enforce_citation_or_gap_admission

    reply = "F004 is an overcurrent trip on that drive. What is the code on the keypad?"
    out = enforce_citation_or_gap_admission(reply, dispatch_kind="")
    assert out == reply + _H4_STOCK_ADMISSION


def test_a_conversational_acknowledgement_is_still_footered_for_now():
    """Deliberate scope limit, not an oversight.

    The tier-8 impatient transcript also footered "Got it - switching to a new
    asset." That sentence asserts nothing about equipment, but it IS declarative,
    and a rule loose enough to exempt it would start suppressing genuine KB-gap
    admissions - the failure H4 exists to prevent. The right fix for that lane is
    a dispatch_kind, exactly as #3142 did for the greeting lanes. Asserted here so
    the limit stays visible instead of being silently assumed.
    """
    from shared.engine import _H4_STOCK_ADMISSION, enforce_citation_or_gap_admission

    reply = "Got it — switching to a new asset. What equipment do you need help with?"
    out = enforce_citation_or_gap_admission(reply, dispatch_kind="")
    assert out == reply + _H4_STOCK_ADMISSION
    # ...and giving that lane a dispatch_kind is all it takes to fix it properly.
    assert enforce_citation_or_gap_admission(reply, dispatch_kind="greeting") == reply
