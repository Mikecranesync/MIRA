"""TDD suite for #1659 citation enforce-mode — the insertion-only second-pass
rewrite.

The gap it closes: when the KB returned chunks (``kb_status`` covered/partial)
and the LLM answered correctly but **dropped the inline ``[Source:]`` tag**, the
existing H4 enforcer appends a misleading "I don't have docs" admission instead
of salvaging the grounded answer. This rewrite re-asks the LLM to *insert* the
citation tags (changing nothing else), validates the result, and only falls
through to the admission when salvage genuinely fails.

Safety constraints under test (per advisor):
  * insertion-only — content must be byte-for-token preserved (no 60Hz→50Hz)
  * no invented labels — every emitted ``[Source: X]`` must come from a chunk
  * reject → return the ORIGINAL reply (H4 admission fires downstream)

Run from the repo/worktree ROOT (cwd=mira-bots shadows stdlib ``email``):
    python3.12 -m pytest mira-bots/tests/test_citation_rewrite.py -q
"""

from __future__ import annotations

from shared.citation_compliance import (
    enforce_citation_via_rewrite,
    valid_source_labels,
)

# A retrieved chunk set whose label is "AutomationDirect GS10 — Chapter 5".
CHUNKS = [
    {
        "manufacturer": "AutomationDirect",
        "model_number": "GS10",
        "metadata": {"section": "Chapter 5"},
        "text": "Set P01-01 to 60Hz to configure the max output frequency.",
    }
]
VALID_LABEL = "AutomationDirect GS10 — Chapter 5"
COVERED = {"status": "covered"}

# A technical reply that owes a citation but dropped the tag.
UNCITED = "Set P01-01 to 60Hz to configure the max output frequency."
CITED = f"Set P01-01 to 60Hz to configure the max output frequency. [Source: {VALID_LABEL}]"


def _make_llm(return_value: str, calls: list):
    async def _llm(messages):
        calls.append(messages)
        return return_value

    return _llm


# ---------------------------------------------------------------------------
# valid_source_labels — pure helper
# ---------------------------------------------------------------------------
def test_valid_source_labels_builds_from_chunks():
    assert valid_source_labels(CHUNKS) == {VALID_LABEL}
    assert valid_source_labels([]) == set()
    assert valid_source_labels(None) == set()
    # chunks with no usable metadata produce no label (not an empty-string label)
    assert valid_source_labels([{"manufacturer": "", "model_number": ""}]) == set()


# ---------------------------------------------------------------------------
# The salvage path
# ---------------------------------------------------------------------------
async def test_rewrite_salvages_uncited_technical_reply():
    calls = []
    llm = _make_llm(CITED, calls)
    out = await enforce_citation_via_rewrite(
        UNCITED, CHUNKS, COVERED, fsm_state="DIAGNOSIS", chat_id="c1", llm_call=llm
    )
    assert out == CITED
    assert "[Source:" in out
    assert len(calls) == 1  # the second-pass LLM call fired exactly once


async def test_rewrite_accepts_tag_inserted_midsentence():
    """Insertion mid-sentence (not just appended) still preserves content."""
    calls = []
    mid = f"Set P01-01 to 60Hz [Source: {VALID_LABEL}] to configure the max output frequency."
    out = await enforce_citation_via_rewrite(
        UNCITED,
        CHUNKS,
        COVERED,
        fsm_state="DIAGNOSIS",
        chat_id="c1",
        llm_call=_make_llm(mid, calls),
    )
    assert out == mid
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# Safety: reject content drift + invented labels  → fall back to ORIGINAL
# ---------------------------------------------------------------------------
async def test_rewrite_rejects_content_drift():
    """A rewrite that changes 60Hz→50Hz while 'adding a citation' is rejected."""
    calls = []
    drifted = f"Set P01-01 to 50Hz to configure the max output frequency. [Source: {VALID_LABEL}]"
    out = await enforce_citation_via_rewrite(
        UNCITED,
        CHUNKS,
        COVERED,
        fsm_state="DIAGNOSIS",
        chat_id="c1",
        llm_call=_make_llm(drifted, calls),
    )
    assert out == UNCITED  # rejected → original, so H4 admission fires downstream
    assert len(calls) == 1


async def test_rewrite_rejects_invented_label():
    """A [Source:] whose label is not in the chunk set is rejected (no inventing)."""
    calls = []
    invented = f"{UNCITED} [Source: Totally Made Up Manual — Page 9]"
    out = await enforce_citation_via_rewrite(
        UNCITED,
        CHUNKS,
        COVERED,
        fsm_state="DIAGNOSIS",
        chat_id="c1",
        llm_call=_make_llm(invented, calls),
    )
    assert out == UNCITED


async def test_rewrite_rejects_when_llm_drops_tag_entirely():
    """If the second pass still returns no tag, fall back to the original."""
    calls = []
    out = await enforce_citation_via_rewrite(
        UNCITED,
        CHUNKS,
        COVERED,
        fsm_state="DIAGNOSIS",
        chat_id="c1",
        llm_call=_make_llm(UNCITED, calls),
    )
    assert out == UNCITED


# ---------------------------------------------------------------------------
# Gating: don't fire the second pass when it isn't owed
# ---------------------------------------------------------------------------
async def test_rewrite_skipped_when_already_cited():
    calls = []
    out = await enforce_citation_via_rewrite(
        CITED, CHUNKS, COVERED, fsm_state="DIAGNOSIS", chat_id="c1", llm_call=_make_llm("x", calls)
    )
    assert out == CITED
    assert calls == []  # no LLM call when a citation is already present


async def test_rewrite_skipped_when_no_chunks():
    calls = []
    out = await enforce_citation_via_rewrite(
        UNCITED, [], COVERED, fsm_state="DIAGNOSIS", chat_id="c1", llm_call=_make_llm("x", calls)
    )
    assert out == UNCITED
    assert calls == []  # nothing to cite → no second pass


async def test_rewrite_skipped_when_kb_uncovered():
    calls = []
    out = await enforce_citation_via_rewrite(
        UNCITED,
        CHUNKS,
        {"status": "none"},
        fsm_state="DIAGNOSIS",
        chat_id="c1",
        llm_call=_make_llm("x", calls),
    )
    assert out == UNCITED
    assert calls == []  # citation not required when the KB returned nothing


async def test_rewrite_skipped_when_not_technical():
    calls = []
    chatter = "Sure, happy to help — what would you like to know?"
    out = await enforce_citation_via_rewrite(
        chatter, CHUNKS, COVERED, fsm_state="GREETING", chat_id="c1", llm_call=_make_llm("x", calls)
    )
    assert out == chatter
    assert calls == []  # non-technical reply owes no citation


# ---------------------------------------------------------------------------
# Robustness: fail-open if the second-pass LLM raises
# ---------------------------------------------------------------------------
async def test_rewrite_failopen_when_llm_raises():
    async def _boom(_messages):
        raise RuntimeError("provider down")

    out = await enforce_citation_via_rewrite(
        UNCITED, CHUNKS, COVERED, fsm_state="DIAGNOSIS", chat_id="c1", llm_call=_boom
    )
    assert out == UNCITED  # never raise to the caller; original reply survives


def test_mixed_sources_do_not_license_a_wrong_vendor():
    from shared.citation_compliance import check_citation_compliance

    reply = "Check the wiring. [Source: Pilz PNOZ] [Source: Rockwell Automation PowerFlex 525]"
    result = check_citation_compliance(
        reply,
        COVERED,
        uns_context={"manufacturer": "Pilz"},
        established_text="Pilz PNOZ",
        enforce=True,
    )
    assert result["sanitized_reply"] is not None
    assert "PowerFlex" not in result["sanitized_reply"]
    assert "[Source: Pilz PNOZ]" in result["sanitized_reply"]


async def test_unknown_scope_cannot_salvage_an_equipment_specific_procedure():
    reply = "Reset the A1000 by cycling power."
    chunk = {
        "manufacturer": "Yaskawa",
        "model_number": "",
        "metadata": {"section": "Getting Started"},
        "content": reply,
        "evidence_applicability": "unknown",
    }
    calls = []
    output = await enforce_citation_via_rewrite(
        reply,
        [chunk],
        COVERED,
        fsm_state="DIAGNOSIS",
        llm_call=_make_llm(reply + " [Source: Yaskawa — Getting Started]", calls),
        uns_context={"manufacturer": "Yaskawa", "model": "A1000"},
    )
    assert output == reply
    assert not calls


async def test_unknown_scope_generic_drawing_guidance_can_be_salvaged():
    reply = "Record the displayed fault and compare the drawing labels."
    chunk = {
        "manufacturer": "Yaskawa",
        "model_number": "",
        "metadata": {"section": "Drawing"},
        "content": reply,
        "evidence_applicability": "unknown",
    }
    cited = reply + " [Source: Yaskawa — Drawing]"
    output = await enforce_citation_via_rewrite(
        reply,
        [chunk],
        COVERED,
        fsm_state="DIAGNOSIS",
        llm_call=_make_llm(cited, []),
        uns_context={"manufacturer": "Yaskawa", "model": "A1000"},
    )
    assert output == cited


async def test_unknown_generic_label_cannot_be_moved_to_model_specific_sentence():
    general = "Record the displayed fault and compare the drawing labels."
    specific = "Reset the A1000 by cycling power."
    reply = general + " " + specific
    chunk = {
        "manufacturer": "Yaskawa",
        "model_number": "",
        "metadata": {"section": "Drawing"},
        "content": general,
        "evidence_applicability": "unknown",
    }
    bad = general + " " + specific + " [Source: Yaskawa — Drawing]"
    output = await enforce_citation_via_rewrite(
        reply,
        [chunk],
        COVERED,
        fsm_state="DIAGNOSIS",
        llm_call=_make_llm(bad, []),
        uns_context={"manufacturer": "Yaskawa", "model": "A1000"},
    )
    assert output == reply


async def test_mixed_reply_preserves_generic_unknown_citation_on_its_own_sentence():
    general = "Record the displayed fault and compare the drawing labels."
    specific = "Reset the A1000 by cycling power."
    generic = {
        "manufacturer": "Yaskawa",
        "model_number": "",
        "metadata": {"section": "Drawing"},
        "content": general,
        "evidence_applicability": "unknown",
    }
    model = {
        "manufacturer": "Yaskawa",
        "model_number": "A1000",
        "metadata": {"section": "Reset"},
        "content": specific,
        "evidence_applicability": "model",
    }
    reply = general + " " + specific
    cited = (
        general + " [Source: Yaskawa — Drawing] " + specific + " [Source: Yaskawa A1000 — Reset]"
    )
    output = await enforce_citation_via_rewrite(
        reply,
        [generic, model],
        COVERED,
        fsm_state="DIAGNOSIS",
        llm_call=_make_llm(cited, []),
        uns_context={"manufacturer": "Yaskawa", "model": "A1000"},
    )
    assert output == cited


async def test_explicitly_applicable_family_manual_can_be_salvaged_for_another_model():
    reply = "Set P01-01 to 60Hz to configure the max output frequency."
    chunk = {**CHUNKS[0], "evidence_applicability": "family"}
    cited = reply + f" [Source: {VALID_LABEL}]"
    output = await enforce_citation_via_rewrite(
        reply,
        [chunk],
        COVERED,
        fsm_state="DIAGNOSIS",
        llm_call=_make_llm(cited, []),
        uns_context={"manufacturer": "AutomationDirect", "model": "GS20"},
    )
    assert output == cited
