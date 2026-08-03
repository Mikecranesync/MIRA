"""Vendor-consistency filter — retrieved chunks must match the machine in hand.

Measured live on staging (2026-08-03): one 8-turn conversation opening
"the conveyor stopped" cited Siemens, Rockwell, a textbook section, Demag and
Interroll — a different manufacturer nearly every turn. Every reply carried a
`[Source: …]` tag, so each looked grounded in isolation; only the sequence
showed retrieval steering the conversation. A randomized 15-conversation fuzz
put `unrelated_vendor` at 30 of 35 total defect instances.

The filter drops chunks belonging to a vendor family the conversation never
established, and is deliberately conservative:
  * a chunk with no resolvable vendor is KEPT (generic material is fine),
  * nothing is filtered until a family IS established,
  * it never strips every chunk (that would convert a partial answer into a
    KB-gap admission),
  * any error returns the chunks untouched.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.workers.rag_worker import (  # noqa: E402
    _filter_chunks_to_established_vendor,
    vendor_families_in,
)


def _chunk(manufacturer: str = "", model: str = "", content: str = "text") -> dict:
    return {"manufacturer": manufacturer, "model": model, "content": content, "similarity": 0.9}


# ── family resolution ────────────────────────────────────────────────────────


def test_families_resolve_by_maker_or_product_line():
    assert vendor_families_in("GS10 drive fault") == {"automationdirect"}
    assert vendor_families_in("PowerFlex 525") == {"rockwell"}
    assert vendor_families_in("SINAMICS G120") == {"siemens"}
    assert vendor_families_in("the conveyor stopped") == set()


# ── the core behavior ────────────────────────────────────────────────────────


def test_off_vendor_chunks_are_dropped_when_a_family_is_established():
    chunks = [
        _chunk("AutomationDirect", "GS10"),
        _chunk("Siemens", "SINAMICS"),
        _chunk("Demag", "BGV D06"),
    ]
    kept = _filter_chunks_to_established_vendor(chunks, "GS10 drive fault CE10", {})
    makers = {c["manufacturer"] for c in kept}
    assert makers == {"AutomationDirect"}


def test_generic_chunks_survive():
    """No resolvable vendor is not the same as the wrong vendor."""
    chunks = [_chunk("AutomationDirect", "GS10"), _chunk("", "", "general belt tensioning")]
    kept = _filter_chunks_to_established_vendor(chunks, "GS10 fault CE10", {})
    assert len(kept) == 2


def test_unestablished_vendor_keeps_only_generic_chunks():
    """The case that actually fails live.

    A vague turn retrieves whatever is nearest across an 83k-chunk multi-vendor
    corpus. Those chunks are REAL (verified against the corpus), so they get
    cited as authoritative for a machine nobody has identified. Vendor-specific
    material cannot be relevant to unknown equipment.
    """
    chunks = [
        _chunk("Siemens", "SINAMICS"),
        _chunk("Demag", "BGV"),
        _chunk("", "", "general belt tensioning guidance"),
    ]
    kept = _filter_chunks_to_established_vendor(chunks, "did that fix it?", {})
    assert len(kept) == 1
    assert kept[0]["content"] == "general belt tensioning guidance"


def test_unestablished_with_no_generic_chunks_keeps_everything():
    """Never strip the whole reference block — a partial answer beats none."""
    chunks = [_chunk("Siemens", "SINAMICS"), _chunk("Demag", "BGV")]
    kept = _filter_chunks_to_established_vendor(chunks, "the conveyor stopped", {})
    assert kept == chunks


def test_family_established_by_the_confirmed_asset():
    chunks = [_chunk("Siemens", "SINAMICS"), _chunk("AutomationDirect", "GS10")]
    state = {"asset_identified": "DURApulse GS10 on CV-101", "context": {}}
    kept = _filter_chunks_to_established_vendor(chunks, "what should I check?", state)
    assert {c["manufacturer"] for c in kept} == {"AutomationDirect"}


def test_family_established_by_conversation_history():
    """A vendor named in turn 1 must still govern turn 6 — the drift case."""
    chunks = [_chunk("Siemens", "SINAMICS"), _chunk("AutomationDirect", "GS10")]
    state = {
        "context": {
            "history": [
                {"role": "user", "content": "GS10 drive fault CE10 on the conveyor"},
                {"role": "assistant", "content": "..."},
            ]
        }
    }
    kept = _filter_chunks_to_established_vendor(chunks, "so what next?", state)
    assert {c["manufacturer"] for c in kept} == {"AutomationDirect"}


def test_uns_manufacturer_establishes_the_family():
    chunks = [_chunk("Demag", "BGV"), _chunk("Rockwell", "PowerFlex 525")]
    state = {"context": {"uns_context": {"manufacturer": "Allen-Bradley", "model": "PowerFlex 525"}}}
    kept = _filter_chunks_to_established_vendor(chunks, "what do I check?", state)
    assert {c["manufacturer"] for c in kept} == {"Rockwell"}


# ── safety rails: the filter must never starve an answer ─────────────────────


def test_never_strips_every_chunk():
    """All-mismatched retrieval returns unchanged — a partial answer beats none."""
    chunks = [_chunk("Siemens", "SINAMICS"), _chunk("Demag", "BGV")]
    kept = _filter_chunks_to_established_vendor(chunks, "GS10 fault CE10", {})
    assert kept == chunks


def test_empty_input_is_safe():
    assert _filter_chunks_to_established_vendor([], "GS10", {}) == []
    assert _filter_chunks_to_established_vendor(None, "GS10", {}) == []


def test_malformed_state_fails_open():
    chunks = [_chunk("Siemens", "SINAMICS")]
    assert _filter_chunks_to_established_vendor(chunks, "GS10", {"context": "not-a-dict"}) == chunks


def test_cross_family_is_symmetric():
    """Establishing Siemens must drop AutomationDirect, not just the reverse."""
    chunks = [_chunk("AutomationDirect", "GS10"), _chunk("Siemens", "SINAMICS G120")]
    kept = _filter_chunks_to_established_vendor(chunks, "SINAMICS G120 fault F30001", {})
    assert {c["manufacturer"] for c in kept} == {"Siemens"}
