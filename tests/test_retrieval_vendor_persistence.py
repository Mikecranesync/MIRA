"""The cross-vendor retrieval filter must not switch itself off mid-conversation.

Root cause of the residual `unrelated_vendor` class, which after the citation-gate
work was confined to the two long multi-turn scenarios on the synthetic QC loop:

    live_diagnosis_vfd   62.5%      direct_howto        100%
    motor_overheat       60.9%      safety_escalation   100%

`_merge_with_prior` carries manufacturer and model FORWARD intact, but scores the
merged context as `max(fresh.confidence, prior.confidence * 0.9)`. One turn where
the technician does not repeat the model number gives 0.7 * 0.9 = 0.63 — under
`_confident_query_vendor`'s 0.7 threshold — while the context still knows both
AutomationDirect and GS10. The confidence decays although the evidence it scores
is unchanged, so the filter disengages from turn 2 onward and unfiltered
nearest-neighbours from an 83k multi-vendor corpus reach the LLM, which cites them.

Short scenarios never hit it. Long ones fail steadily. That is the measured shape.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.workers.rag_worker import _confident_query_vendor  # noqa: E402


def _state(mfr="", model="", conf=0.0):
    return {"context": {"uns_context": {"manufacturer": mfr, "model": model, "confidence": conf}}}


def test_a_decayed_but_complete_context_still_drives_the_filter():
    """The measured failure: 0.7 * 0.9 = 0.63, with manufacturer AND model intact."""
    assert _confident_query_vendor(_state("AutomationDirect", "GS10", 0.63)) == "AutomationDirect"


def test_the_filter_survives_several_quiet_turns():
    """0.7 * 0.9^4 = 0.459 — still AutomationDirect + GS10 in the context."""
    assert _confident_query_vendor(_state("AutomationDirect", "GS10", 0.459)) == "AutomationDirect"


def test_a_fresh_high_confidence_context_still_works():
    assert _confident_query_vendor(_state("AutomationDirect", "GS10", 0.9)) == "AutomationDirect"


def test_manufacturer_only_at_low_confidence_is_still_refused():
    """Both directions — the #2211 guard. A false-positive alias
    ("delta pressure" -> Delta Electronics @0.5) must not suppress all evidence,
    so manufacturer WITHOUT a model still requires real confidence."""
    assert _confident_query_vendor(_state("Delta Electronics", "", 0.5)) is None


def test_no_vendor_is_still_no_filter():
    assert _confident_query_vendor(_state("", "", 0.0)) is None
    assert _confident_query_vendor({"context": {}}) is None
