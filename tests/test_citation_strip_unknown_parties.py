"""An unestablished attribution is stripped even when the party is unrecognized.

`unrelated_vendor` is 13 of 19 failing turns on the synthetic QC loop — the
dominant remaining class. The citation gate already has the right shape for it
(`evaluate_citation_relevance`'s "unestablished" case: no manufacturer resolved,
yet the reply cites one anyway), but it can only see parties that
`canonical_vendor` recognizes. The corpus is full of ones it does not: Demag,
Interroll, SKF, Westward. Those get cited on turns where nobody named them and
are never stripped.

The module docstring in `answer_qc` records the same conclusion from the other
direction — "the right seam is almost certainly citation_compliance … it needs a
resolved manufacturer, so vague turns bypass it."

Both directions matter more than usual here, because stripping is destructive: a
gate that removes correct citations is worse than one that misses wrong ones.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.citation_compliance import (  # noqa: E402
    attributed_parties,
    evaluate_citation_relevance,
)


# ── the parties a reply attributes to ────────────────────────────────────────


def test_attributed_parties_reads_the_leading_token_of_each_tag():
    reply = "See [Source: Demag — BGV D06] and [Source: AutomationDirect GS10 — Fault Codes]"
    assert attributed_parties(reply) == ["demag", "automationdirect"]


def test_attributed_parties_skips_document_words_and_artifacts():
    """Same rules the detector uses: a generic title word or a file/URL artifact
    names a document, not a party."""
    reply = (
        "[Source: Serial Comms, p. 1] [Source: cm5003%20vibration%20guide1] "
        "[Source: 22COMM — User Manual] [Source: Wiring Diagram, p. 4]"
    )
    assert attributed_parties(reply) == []


def test_attributed_parties_ignores_a_bare_reference_number():
    assert attributed_parties("[Source: [3] --- Reference Documents]") == []


# ── the strip ────────────────────────────────────────────────────────────────


def test_an_unrecognized_party_is_stripped_when_nothing_was_established():
    """The Demag/Interroll/SKF class — cited for a machine nobody identified."""
    reply = "Have you checked the brake gap [Source: Demag — BGV D06]?"
    out = evaluate_citation_relevance(reply, None, "the conveyor stopped again")
    assert not out["relevant"]
    assert out["reason"] == "unestablished"
    assert out["conflicting_tags"]


def test_an_established_party_is_kept_even_when_unrecognized():
    """Both directions — the technician named Demag, so citing it is correct."""
    reply = "Have you checked the brake gap [Source: Demag — BGV D06]?"
    out = evaluate_citation_relevance(reply, None, "the Demag hoist keeps faulting")
    assert out["relevant"], out


def test_a_recognized_vendor_still_behaves_exactly_as_before():
    reply = "Check the fault table [Source: Yaskawa V1000 — Cause Possible Solution]"
    out = evaluate_citation_relevance(reply, None, "it stopped again")
    assert not out["relevant"]
    assert out["reason"] == "unestablished"


def test_a_resolved_manufacturer_still_takes_the_conflict_path():
    """The original P0-3 gate is untouched: expected vendor vs a different one."""
    reply = "See [Source: Siemens — Quick commissioning]"
    out = evaluate_citation_relevance(reply, "AutomationDirect", "my GS10 shows CE10")
    assert not out["relevant"]
    assert out["reason"] == "conflict"


def test_a_document_title_is_never_stripped_as_a_party():
    """Both directions — stripping is destructive; a real cited section stays."""
    reply = "CE10 is a comms fault [Source: Serial Comms, p. 1]"
    out = evaluate_citation_relevance(reply, None, "my drive shows CE10")
    assert out["relevant"], out


def test_no_established_text_still_disables_the_check():
    """Fail-open contract preserved: a caller that cannot supply the
    conversation gets the old behaviour, not a false strip."""
    reply = "Have you checked the brake gap [Source: Demag — BGV D06]?"
    assert evaluate_citation_relevance(reply, None, "")["relevant"]


# ── the RAG path must run the gate too ──────────────────────────────────────


def test_the_general_question_path_gates_its_citations():
    """`_handle_general_question` is the path that EMITS citations, and it had
    four return points and zero citation checks. The strip fires correctly
    wherever it runs; `unrelated_vendor` stayed flat across two synthetic runs
    because these replies never reached it — and routing specific questions here
    (the ct-04 fix) sent more traffic down the ungated path.
    """
    import shared.engine as eng_mod

    eng = eng_mod.Supervisor.__new__(eng_mod.Supervisor)
    reply = "Check the brake gap [Source: Demag — BGV D06]"
    state = {"state": "IDLE", "context": {}}

    out = eng._gate_reply_citations(reply, "the conveyor stopped again", state, "c1")

    assert "[Source: Demag" not in out
    assert "removed a citation" in out


def test_the_gate_helper_is_a_no_op_without_citations():
    """Both directions — safe to call on every return point."""
    import shared.engine as eng_mod

    eng = eng_mod.Supervisor.__new__(eng_mod.Supervisor)
    reply = "What fault code is on the display?"
    assert eng._gate_reply_citations(reply, "it stopped", {"state": "IDLE"}, "c1") == reply


def test_the_gate_helper_keeps_an_established_citation():
    import shared.engine as eng_mod

    eng = eng_mod.Supervisor.__new__(eng_mod.Supervisor)
    reply = "CE10 is a comms fault [Source: AutomationDirect GS10 — Fault Codes]"
    out = eng._gate_reply_citations(
        reply, "my AutomationDirect GS10 shows CE10", {"state": "IDLE"}, "c1"
    )
    assert "[Source: AutomationDirect GS10 — Fault Codes]" in out
