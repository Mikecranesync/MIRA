"""Resolved state must not authorize a citation the technician never grounded.

Root cause of the residual `unrelated_vendor` failures on the synthetic QC loop
(2026-08-04/05). On a vague turn MIRA retrieves whatever is nearest across an 83k
multi-vendor corpus; the resolver writes that vendor into
`state["context"]["uns_context"]`; `established_context_text` then reports it as
established; and the citation gate rules the citation grounded and keeps it.

Measured verbatim — cold_start, technician said only "it stopped again / the drive
faulted out, tripped the breaker":

    "What fault code is on the display of LN3-DRV001?
     [Source: Rockwell Automation PowerFlex 40P — Troubleshooting]"

Nobody said Rockwell. MIRA inferred it from its own retrieval and then cited it.

This is the self-licensing loop the function's own docstring guards against one
level down — "a vendor MIRA hallucinated in turn 3 must not authorise citing that
vendor in turn 6" — leaking back in through resolved state.

Alias handling is NOT lost by this: `_vendors_in_text` canonicalizes the
technician's own words, so a technician who typed "PowerFlex 525" still
establishes Rockwell without the uns_context contribution.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.citation_compliance import (  # noqa: E402
    established_context_text,
    evaluate_citation_relevance,
)

ROCKWELL_CITE = "What fault code is on the display? [Source: Rockwell Automation PowerFlex 40P]"
VAGUE = "it stopped again. the drive faulted out, tripped the breaker."


def _state(*, mfr="", model="", asset="", source=None, history=VAGUE):
    uns = {"manufacturer": mfr, "model": model}
    if source:
        uns["source"] = source
    return {
        "asset_identified": asset,
        "context": {"uns_context": uns, "history": [{"role": "user", "content": history}]},
    }


def test_an_unconfirmed_resolved_vendor_does_not_authorize_its_own_citation():
    state = _state(mfr="Rockwell Automation", model="PowerFlex 40P")
    est = established_context_text("what fault code?", state)
    assert "rockwell" not in est.lower()
    assert evaluate_citation_relevance(ROCKWELL_CITE, None, est)["reason"] == "unestablished"


def test_the_technicians_own_words_still_establish_the_vendor():
    """Both directions — and the alias path survives: "PowerFlex" canonicalizes."""
    state = _state(history="how do I reset a PowerFlex 525?")
    est = established_context_text("which is safer?", state)
    assert evaluate_citation_relevance(ROCKWELL_CITE, None, est)["relevant"]


def test_a_confirmed_asset_still_establishes_the_vendor():
    """`asset_identified` is set only after the technician confirms at the UNS gate."""
    state = _state(mfr="Rockwell Automation", asset="PowerFlex 40P drive, Line 3")
    est = established_context_text("what fault code?", state)
    assert evaluate_citation_relevance(ROCKWELL_CITE, None, est)["relevant"]


def test_a_direct_connection_still_establishes_the_vendor():
    """A certified connection proved the machine; it is not an inference."""
    state = _state(mfr="Rockwell Automation", model="PowerFlex 40P", source="direct_connection")
    est = established_context_text("what fault code?", state)
    assert evaluate_citation_relevance(ROCKWELL_CITE, None, est)["relevant"]


def test_the_message_itself_is_always_included():
    state = _state()
    assert "powerflex" in established_context_text("my PowerFlex 40P tripped", state).lower()


# ── detector precision, from the same measured turns ────────────────────────


def test_a_filename_prefix_is_not_a_vendor():
    """`[Source: En Acs880 Drive Application Programming Manual]` reported `en`."""
    from shared.answer_qc import run_output_qc

    reply = "See [Source: En Acs880 Drive Application Programming Manual C A4]"
    assert "unrelated_vendor" not in run_output_qc("it stopped", reply, mode="observe").findings


def test_a_suggestion_chip_is_not_an_attribution():
    """MIRA's own UI affordances — "*Find documentation*" reported a vendor `find`."""
    from shared.answer_qc import run_output_qc

    reply = "Paste a link and I'll index it.\n\n--- *Find documentation* | *Log a work order*"
    assert "unrelated_vendor" not in run_output_qc("it stopped", reply, mode="observe").findings


def test_a_real_prose_attribution_still_fires():
    """Both directions — the original co-01 Demag prose case is untouched."""
    from shared.answer_qc import run_output_qc

    reply = "Check the PE conductor as mentioned in the Demag documentation"
    assert "unrelated_vendor" in run_output_qc("it stopped", reply, mode="observe").findings


# ── the conflict branch must not bless an invented expectation ──────────────


def test_an_unconfirmed_resolved_vendor_is_not_a_trusted_expectation():
    """The mirror bug: an unconfirmed resolver hit does not merely fail to strip
    a wrong citation, it BLESSES it — a Yaskawa citation "matches" a Yaskawa
    expectation MIRA inferred from the very chunk it is citing."""
    from shared.citation_compliance import trusted_uns_context

    state = _state(mfr="Yaskawa", model="V1000", history="my GS10 keeps tripping CE10")
    assert trusted_uns_context(state)["manufacturer"] == ""


def test_a_confirmed_asset_keeps_the_expectation():
    from shared.citation_compliance import trusted_uns_context

    state = _state(mfr="AutomationDirect", asset="GS10 drive, conveyor 1")
    assert trusted_uns_context(state)["manufacturer"] == "AutomationDirect"


def test_a_direct_connection_keeps_the_expectation():
    from shared.citation_compliance import trusted_uns_context

    state = _state(mfr="AutomationDirect", source="direct_connection")
    assert trusted_uns_context(state)["manufacturer"] == "AutomationDirect"


def test_blanking_the_expectation_makes_the_gate_stricter_not_weaker():
    """Both directions — the turn falls to the unsupported-attribution branch,
    which compares against the technician's own words."""
    reply = "Press MENU on the keypad [Source: Yaskawa V1000 — Step Display]"
    established = "my GS10 keeps tripping CE10"
    assert evaluate_citation_relevance(reply, "", established)["reason"] == "unestablished"
