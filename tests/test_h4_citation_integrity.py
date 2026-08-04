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
