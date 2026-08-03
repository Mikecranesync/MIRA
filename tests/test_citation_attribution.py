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
