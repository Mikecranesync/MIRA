"""Regression suite for #3213 — a no-docs admission reply must never carry a
[Source:] citation.

Observed live (staging-gate run 31662003031, question oem-model-fault-
powerflex-f004): the engine shipped

    "I don't have documentation for this equipment in my records — searching
    now. Type PROCEED to continue with my best estimate (not manual-verified).

    [Source: Bulletin 193 E1 Plus Overload Relay — User Manual 002, p. 1]"

— an admission of having no documentation, PLUS a citation to an irrelevant
retrieved chunk. The judge hard-failed it as a hallucinated source on 4/4
independent draws. Two code paths can produce the contradiction:

  1. the model itself copies a retrieved chunk's tag while also emitting the
     rule-16 no-docs sentence (this run's shape) — no layer checked the
     admission/citation contradiction;
  2. the insertion-only salvage rewrite stamps a chunk label onto an
     admission reply (same outcome, machine-made).

A third, adjacent shape from the same run (photo-less-ocr-claim): the
relevance gate STRIPS an unestablished-vendor citation and the salvage
rewrite immediately re-inserts a label from the same chunk set — the strip
undone. `disallowed_labels` closes that loop.

Invariant: a citation presented to the user must correspond to evidence
actually backing THAT reply. Never manufacture, reconstruct, or preserve one
that the reply itself disclaims or that validation just rejected.

Run from the repo/worktree ROOT (cwd=mira-bots shadows stdlib ``email``):
    python3.12 -m pytest mira-bots/tests/test_citation_admission_conflict.py -q
"""

from __future__ import annotations

from shared.citation_compliance import (
    check_citation_compliance,
    enforce_citation_via_rewrite,
    is_no_docs_admission,
)

# The exact reply shape from the staging artifact (label swapped for a neutral
# fixture vendor to keep the test self-contained).
ADMISSION = (
    "I don't have documentation for this equipment in my records — searching now. "
    "Type PROCEED to continue with my best estimate (not manual-verified)."
)
IRRELEVANT_LABEL = "Bulletin 193 E1 Plus Overload Relay — User Manual 002, p. 1"
ADMISSION_WITH_TAG = (
    f"{ADMISSION}\n\n[Source: {IRRELEVANT_LABEL}]\n\n--- Sources ---\n[1] {IRRELEVANT_LABEL}"
)

CHUNKS = [
    {
        "manufacturer": "AutomationDirect",
        "model_number": "GS10",
        "metadata": {"section": "Chapter 5"},
        "text": "Set P01-01 to 60Hz to configure the max output frequency.",
    }
]
VALID_LABEL = "AutomationDirect GS10 — Chapter 5"
PARTIAL = {"status": "partial"}


def _make_llm(return_value: str, calls: list):
    async def _llm(messages):
        calls.append(messages)
        return return_value

    return _llm


# ---------------------------------------------------------------------------
# The admission classifier
# ---------------------------------------------------------------------------
def test_admission_signatures_recognized():
    # rule-16 sentence (rag_worker system prompt)
    assert is_no_docs_admission(ADMISSION)
    # H4 stock admission (engine)
    assert is_no_docs_admission(
        "I don't have specific documentation indexed for this — consult the asset nameplate."
    )
    # kiosk direct-answer phrasing
    assert is_no_docs_admission("I don't have documentation for that in my records.")


def test_partial_scope_admissions_do_NOT_trip_the_guard():
    """An admission about ONE aspect next to genuinely grounded advice must not
    cost the reply its legitimate citation (dropped-citation regression guard)."""
    mixed = (
        "I don't have documentation for the brake circuit, but the drive manual "
        f"covers this: set P01-01 to 60Hz [Source: {VALID_LABEL}]."
    )
    assert not is_no_docs_admission(mixed)
    out = check_citation_compliance(
        mixed, PARTIAL, fsm_state="DIAGNOSIS", chat_id="c-mixed", enforce=True
    )
    assert out["sanitized_reply"] is None  # untouched


# ---------------------------------------------------------------------------
# Shape 1 — model-emitted contradictory tag (the F004 staging failure)
# ---------------------------------------------------------------------------
def test_enforce_strips_citation_from_admission_reply():
    out = check_citation_compliance(
        ADMISSION_WITH_TAG, PARTIAL, fsm_state="Q2", chat_id="c-f004", enforce=True
    )
    sanitized = out["sanitized_reply"]
    assert sanitized is not None, "admission+citation contradiction must sanitize"
    assert "[Source:" not in sanitized
    assert IRRELEVANT_LABEL not in sanitized  # sources block pruned too
    assert "I don't have documentation for this equipment" in sanitized  # admission kept


def test_observe_mode_still_reports_without_mutating():
    out = check_citation_compliance(
        ADMISSION_WITH_TAG, PARTIAL, fsm_state="Q2", chat_id="c-f004", enforce=False
    )
    assert out["sanitized_reply"] is None  # observational mode never rewrites


# ---------------------------------------------------------------------------
# Shape 2 — the salvage rewrite must never tag an admission reply
# ---------------------------------------------------------------------------
async def test_rewrite_never_salvages_an_admission_reply():
    calls = []
    llm = _make_llm(f"{ADMISSION} [Source: {VALID_LABEL}]", calls)
    out = await enforce_citation_via_rewrite(
        ADMISSION, CHUNKS, PARTIAL, fsm_state="Q2", chat_id="c-adm", llm_call=llm
    )
    assert out == ADMISSION  # unchanged
    assert calls == []  # the rewrite LLM must not even be consulted


# ---------------------------------------------------------------------------
# Shape 3 — a label the relevance gate just stripped must not be re-inserted
# ---------------------------------------------------------------------------
async def test_rewrite_respects_disallowed_labels():
    calls = []
    uncited = "Set P01-01 to 60Hz to configure the max output frequency."
    llm = _make_llm(f"{uncited} [Source: {VALID_LABEL}]", calls)
    out = await enforce_citation_via_rewrite(
        uncited,
        CHUNKS,
        PARTIAL,
        fsm_state="DIAGNOSIS",
        chat_id="c-strip",
        llm_call=llm,
        disallowed_labels={VALID_LABEL},
    )
    assert out == uncited  # the only candidate label was disallowed → no salvage
    assert calls == []


async def test_rewrite_still_salvages_when_labels_remain_allowed():
    """Canary: the legitimate salvage path is unchanged when nothing was stripped."""
    calls = []
    uncited = "Set P01-01 to 60Hz to configure the max output frequency."
    cited = f"{uncited} [Source: {VALID_LABEL}]"
    llm = _make_llm(cited, calls)
    out = await enforce_citation_via_rewrite(
        uncited, CHUNKS, PARTIAL, fsm_state="DIAGNOSIS", chat_id="c-ok", llm_call=llm
    )
    assert out == cited
    assert len(calls) == 1
