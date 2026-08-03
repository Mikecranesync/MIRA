"""Unsupported-attribution gate — citing a vendor for an unidentified machine.

The defect this closes, measured live on staging across 15 randomized
conversations: `unrelated_vendor` accounted for 24–34 of ~35 total defect
instances, and the rate climbed with conversation length (2 turns 50%, 8 turns
100%). A technician opened with "the conveyor stopped" and got Siemens, then
Rockwell, then a textbook section, then Demag, then Interroll — a different
manufacturer nearly every turn, each carrying a `[Source: …]` tag so every
reply looked grounded in isolation.

Three earlier attempts failed, and the reason is the point of this file:

* The chunks are **real**. Verified against the corpus — "Quick commissioning"
  (28), "BGV D06" (2, Demag), "Interroll" (43). Nothing is hallucinated, so no
  hallucination check can see it. The *attribution* is what is unsupported.
* `evaluate_citation_relevance` already stripped wrong-vendor tags, but only by
  comparing against a **resolved** manufacturer. With no vendor resolved,
  `expected` is empty and the whole check is skipped — so precisely the vague
  turns that fail worst were the ones it never examined.
* Two attempts patched `rag_worker` instead, which produced zero effect in
  staging logs.

The rule: a citation may only name a vendor the conversation has established.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.citation_compliance import (  # noqa: E402
    established_context_text,
    evaluate_citation_relevance,
    strip_conflicting_citations,
)
from shared.uns_resolver import vendors_in_text  # noqa: E402

SIEMENS = "[Source: Siemens — 5.5 Quick commissioning]"
DEMAG = "[Source: Demag — BGV D06]"
GS10 = "[Source: AutomationDirect GS10 manual — p. 42]"
GENERIC = "[Source: Conveyor belt tensioning — §3]"


# ── the resolver helper ──────────────────────────────────────────────────────


def test_vendors_in_text_finds_every_named_vendor():
    assert vendors_in_text("GS10 fault on the line") == {"AutomationDirect"}
    assert vendors_in_text("swapped the PowerFlex for a GS10") == {
        "Rockwell Automation",
        "AutomationDirect",
    }
    assert vendors_in_text("the conveyor stopped") == set()
    assert vendors_in_text("") == set()
    assert vendors_in_text(None) == set()


def test_vendor_aliases_resolve_to_one_family():
    """Allen-Bradley and PowerFlex are Rockwell — a citation naming any of
    them is licensed by a technician who named any other."""
    assert vendors_in_text("allen-bradley drive") == {"Rockwell Automation"}
    assert vendors_in_text("powerflex 525") == {"Rockwell Automation"}


# ── the defect ───────────────────────────────────────────────────────────────


def test_vendor_cited_for_an_unidentified_machine_is_stripped():
    """The live failure, reduced: a vague turn, a real chunk, a wrong claim."""
    rel = evaluate_citation_relevance(
        f"Check the drive's commissioning parameters. {SIEMENS}",
        None,
        established_text="the conveyor stopped did that fix it?",
    )
    assert rel["relevant"] is False
    assert rel["reason"] == "unestablished"
    assert rel["conflicting_tags"] == [SIEMENS]


def test_the_drift_case_across_turns():
    """A vendor established in turn 1 still licenses a citation in turn 6.

    This is the case the filter must NOT break — the conversation drifted, but
    the technician did name their machine, so GS10 material is legitimate.
    """
    rel = evaluate_citation_relevance(
        f"Verify P09.03. {GS10}",
        None,
        established_text="GS10 drive fault CE10 on the conveyor ... so what next?",
    )
    assert rel["relevant"] is True


def test_off_vendor_is_stripped_even_when_a_vendor_was_established():
    """Established GS10, cited Demag: only the Demag tag goes."""
    rel = evaluate_citation_relevance(
        f"Check the brake. {GS10} {DEMAG}",
        None,
        established_text="GS10 drive fault CE10",
    )
    assert rel["relevant"] is False
    assert rel["conflicting_tags"] == [DEMAG]


def test_generic_sources_survive():
    """A citation naming no vendor is not a vendor attribution."""
    rel = evaluate_citation_relevance(
        f"Check belt tension. {GENERIC}",
        None,
        established_text="the conveyor stopped",
    )
    assert rel["relevant"] is True


# ── fail-open: a false strip is worse than a missed one ──────────────────────


def test_without_established_text_behavior_is_unchanged():
    """Callers that cannot supply the conversation get the OLD behavior.

    This is what makes the change safe to roll out: the new check is opt-in per
    call site, so an un-migrated caller cannot start false-stripping.
    """
    rel = evaluate_citation_relevance(f"Do the thing. {SIEMENS}", None)
    assert rel["relevant"] is True
    assert rel["reason"] == ""


def test_no_citations_is_never_a_miss():
    rel = evaluate_citation_relevance("Check the belt.", None, established_text="conveyor")
    assert rel["relevant"] is True


def test_resolved_manufacturer_still_takes_the_conflict_path():
    """The original P0-3 gate is untouched."""
    rel = evaluate_citation_relevance(
        f"Check it. {SIEMENS}", "AutomationDirect", established_text="anything"
    )
    assert rel["relevant"] is False
    assert rel["reason"] == "conflict"


# ── the honesty note must not claim knowledge MIRA doesn't have ──────────────


def test_unestablished_note_asks_which_machine():
    out = strip_conflicting_citations(f"Check it. {SIEMENS}", [SIEMENS], None, "unestablished")
    assert SIEMENS not in out
    assert "which machine" in out
    assert "make and model" in out


def test_unestablished_note_does_not_claim_a_different_manufacturer():
    """The old wording implies MIRA knows the right vendor. It doesn't."""
    out = strip_conflicting_citations(f"Check it. {SIEMENS}", [SIEMENS], None, "unestablished")
    assert "different manufacturer" not in out


def test_conflict_note_is_unchanged():
    out = strip_conflicting_citations(f"Check it. {SIEMENS}", [SIEMENS], "AutomationDirect")
    assert "different manufacturer" in out
    assert "AutomationDirect" in out


# ── the context composer ─────────────────────────────────────────────────────


def test_established_text_gathers_turn_asset_uns_and_history():
    text = established_context_text(
        "what next?",
        {
            "asset_identified": "CV-101 conveyor",
            "context": {
                "uns_context": {"manufacturer": "AutomationDirect", "model": "GS10"},
                "history": [{"role": "user", "content": "drive fault CE10"}],
            },
        },
    )
    assert "what next?" in text
    assert "CV-101" in text
    assert "AutomationDirect" in text
    assert "CE10" in text


# ── P0: a reply must not license its own citation ────────────────────────────
#
# Both Supervisor paths append the freshly generated reply to history BEFORE
# calling the citation check (engine.py 3712-3713 and 5027-5028). An earlier
# version of established_context_text read every history entry, so the reply's
# own "[Source: Siemens …]" put "Siemens" into the established set and the gate
# passed itself. These tests recreate that exact ordering.


def _history_after_engine_appends(user_turns: list[str], assistant_reply: str) -> dict:
    """State as the engine actually presents it at the citation check.

    The user turn and the generated reply are BOTH already in history — that
    ordering is the bug, so the fixture reproduces it rather than idealising it.
    """
    history: list[dict] = []
    for t in user_turns:
        history.append({"role": "user", "content": t})
        history.append({"role": "assistant", "content": "..."})
    history.append({"role": "assistant", "content": assistant_reply})
    return {"context": {"history": history}}


def test_reply_cannot_license_its_own_vendor_citation():
    """The P0 case, end to end through the real composer."""
    reply = f"Check the commissioning parameters. {SIEMENS}"
    state = _history_after_engine_appends(["the conveyor stopped", "did that fix it?"], reply)
    established = established_context_text("did that fix it?", state)

    assert "Siemens" not in established, "the reply leaked into its own evidence"

    rel = evaluate_citation_relevance(reply, None, established_text=established)
    assert rel["relevant"] is False
    assert rel["reason"] == "unestablished"
    assert rel["conflicting_tags"] == [SIEMENS]

    sanitized = strip_conflicting_citations(reply, rel["conflicting_tags"], None, rel["reason"])
    assert SIEMENS not in sanitized
    assert "which machine" in sanitized


def test_a_prior_assistant_turn_cannot_establish_a_vendor_either():
    """A vendor MIRA invented in turn 3 must not authorise citing it in turn 6."""
    state = {
        "context": {
            "history": [
                {"role": "user", "content": "the conveyor stopped"},
                {"role": "assistant", "content": "This looks like a Siemens SINAMICS issue."},
            ]
        }
    }
    established = established_context_text("what next?", state)
    assert "Siemens" not in established
    rel = evaluate_citation_relevance(f"Check it. {SIEMENS}", None, established_text=established)
    assert rel["relevant"] is False


def test_untyped_history_entries_do_not_establish_a_vendor():
    """A bare string has no role, so it cannot be proven to be the technician."""
    state = {"context": {"history": ["I think this is a Siemens drive"]}}
    established = established_context_text("what next?", state)
    assert "Siemens" not in established


def test_a_real_user_turn_still_licenses_its_citation():
    """The legitimate case must survive the P0 fix — GS10 named by the user."""
    reply = f"Verify P09.03. {GS10}"
    state = _history_after_engine_appends(["my GS10 is faulted", "what next?"], reply)
    established = established_context_text("what next?", state)
    assert "GS10" in established
    rel = evaluate_citation_relevance(reply, None, established_text=established)
    assert rel["relevant"] is True


# ── P1: alias matching must respect word boundaries ──────────────────────────
#
# The alias table contains "ab" (Allen-Bradley) and "abb". A substring test
# fires on "c-ab-le" and "gr-abb-ed", so ordinary English established a vendor
# nobody named — and, worse, made a legitimate generic cable source look like
# an unsupported Rockwell citation and stripped it.


@pytest.mark.parametrize(
    "text",
    [
        "the cable came loose",
        "I grabbed the cable",
        "click the reset button",
        "check the label on the gearbox",
    ],
)
def test_ordinary_english_establishes_no_vendor(text):
    assert vendors_in_text(text) == set(), f"{text!r} matched a vendor inside a word"


def test_generic_cable_documentation_is_not_a_vendor():
    from shared.uns_resolver import canonical_vendor

    assert canonical_vendor("Cable installation procedure") is None


@pytest.mark.parametrize(
    "text,expected",
    [
        ("the AB drive is faulted", "Rockwell Automation"),
        ("PowerFlex 525 tripped", "Rockwell Automation"),
        ("my GS10 is faulted", "AutomationDirect"),
        ("Siemens SINAMICS G120", "Siemens"),
        ("Demag hoist brake", "Demag"),
        ("Interroll roller", "Interroll"),
    ],
)
def test_real_vendor_mentions_still_resolve(text, expected):
    """Boundary-awareness must not cost the aliases that matter."""
    assert expected in vendors_in_text(text)


def test_generic_cable_source_survives_but_siemens_is_still_stripped():
    """The two behaviors that must hold at once, in one reply."""
    reply = f"Check the wiring. {GENERIC} {SIEMENS}"
    established = established_context_text("the cable came loose", None)
    rel = evaluate_citation_relevance(reply, None, established_text=established)
    assert rel["conflicting_tags"] == [SIEMENS], "generic source must survive"
    sanitized = strip_conflicting_citations(reply, rel["conflicting_tags"], None, rel["reason"])
    assert GENERIC in sanitized
    assert SIEMENS not in sanitized


def test_established_text_survives_malformed_state():
    assert established_context_text("hi", None) == "hi"
    assert established_context_text("hi", {"context": "not-a-dict"}) == "hi"
    assert "hi" in established_context_text("hi", {"context": {"history": "not-a-list"}})


def test_history_alone_licenses_a_citation():
    """End-to-end of the drift case through the real composer."""
    state = {"context": {"history": [{"role": "user", "content": "my GS10 is faulted"}]}}
    rel = evaluate_citation_relevance(
        f"Check P09.03. {GS10}", None, established_text=established_context_text("what now?", state)
    )
    assert rel["relevant"] is True
