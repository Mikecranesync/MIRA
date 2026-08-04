"""D3 — premature FSM exit with a junk citation (W2a eval, 2026-08-03).

Recorded in `docs/evals/2026-08-03-dialogue-mode-w2a/results.md` as the one
surfaced defect that shipped no fix: MIRA emits a bare reflection ("You think
it's a WEG motor."), cites an uploaded photo *filename* as its source, and the
conversation ends as though a diagnosis had been delivered. Baseline case 6 and
post-run case 7 both scored composite 3.6 on it.

It is two independent defects that happen to co-occur, and each is fixed here:

**A. The FSM accepts a DIAGNOSIS transition from a reply containing no
diagnosis.** `advance_state` honours whatever `next_state` the model proposes
(or an alias of it — `ANALYZING`, `ROOT_CAUSE`, `IDEA_GENERATION` all resolve to
DIAGNOSIS) and only guards *backward* motion. A content-free acknowledgement
plus `next_state: DIAGNOSIS` therefore lands the session in DIAGNOSIS, which
every downstream surface reads as "diagnosed".

**B. A photo filename counts as grounding.** `_has_usable_citation` strips only
`_H4_EMPTY_SOURCE_BODY_RE` (bare reference numbers). `[Source: 481923.jpg]` —
the technician's own uploaded photo, saved by `photo_handler` as
``{chat_id}.jpg`` — survives it, so a worthless citation SUPPRESSES the honest
KB-gap admission. That is the identical failure mode the bare-number fix
addressed in #3121; the filename class was left unpatched.

Both directions are asserted throughout: the fix must not stop a genuine
diagnosis from reaching DIAGNOSIS, and must not reject a real citation.

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
from shared.fsm import advance_state  # noqa: E402

# The observed reply, verbatim from the eval transcript description.
BARE_REFLECTION = "You think it's a WEG motor."

# A genuine DIAGNOSIS-worthy reply — the must-pass fixture. A guard that fails
# this one is miscalibrated and would break real diagnoses.
REAL_DIAGNOSIS = (
    "The overload trip with a 195F surface temperature four months after a rewind "
    "points at the rewind itself — wrong wire gauge or turn count raises running "
    "current above nameplate FLA. Measure running current on all three phases and "
    "compare to the FLA on the nameplate."
)


def _state(current: str = "IDLE") -> dict:
    return {"state": current, "exchange_count": 0, "context": {}, "chat_id": "d3-test"}


# ── A. a content-free reply must not reach DIAGNOSIS ─────────────────────────


def test_bare_reflection_does_not_reach_diagnosis():
    out = advance_state(_state("IDLE"), {"reply": BARE_REFLECTION, "next_state": "DIAGNOSIS"})
    assert out["state"] != "DIAGNOSIS"


def test_bare_reflection_keeps_the_conversation_going():
    """Clamped forward, not frozen — the technician still gets a next turn."""
    out = advance_state(_state("IDLE"), {"reply": BARE_REFLECTION, "next_state": "DIAGNOSIS"})
    assert out["state"] == "Q1"


def test_acknowledgement_only_does_not_reach_diagnosis():
    for reply in ("Got it.", "Understood, thanks.", "Okay.", "So you're saying it's the motor."):
        out = advance_state(_state("IDLE"), {"reply": reply, "next_state": "DIAGNOSIS"})
        assert out["state"] != "DIAGNOSIS", reply


def test_alias_route_into_diagnosis_is_clamped_too():
    """ANALYZING/ROOT_CAUSE/IDEA_GENERATION all alias to DIAGNOSIS."""
    for proposed in ("ANALYZING", "ROOT_CAUSE", "IDEA_GENERATION", "FAULT_ANALYSIS"):
        out = advance_state(_state("IDLE"), {"reply": BARE_REFLECTION, "next_state": proposed})
        assert out["state"] != "DIAGNOSIS", proposed


def test_a_real_diagnosis_still_reaches_diagnosis():
    """Must-pass fixture — the guard may not cost us a genuine diagnosis."""
    out = advance_state(_state("Q2"), {"reply": REAL_DIAGNOSIS, "next_state": "DIAGNOSIS"})
    assert out["state"] == "DIAGNOSIS"


def test_a_real_diagnosis_from_idle_still_reaches_diagnosis():
    out = advance_state(_state("IDLE"), {"reply": REAL_DIAGNOSIS, "next_state": "DIAGNOSIS"})
    assert out["state"] == "DIAGNOSIS"


def test_clamping_cannot_stonewall_the_technician():
    """The Q-trap escape still commits, so the clamp can never deadlock.

    Three consecutive content-free turns must still land in DIAGNOSIS rather
    than looping in Q-states forever — the D2 failure mode in a new costume.
    """
    state = _state("IDLE")
    for _ in range(3):
        state = advance_state(state, {"reply": BARE_REFLECTION, "next_state": "DIAGNOSIS"})
    assert state["state"] == "DIAGNOSIS"


def test_safety_alert_still_overrides_the_clamp():
    """A reflection that trips a safety keyword must still escalate."""
    out = advance_state(
        _state("IDLE"),
        {"reply": "You think it's arc flash.", "next_state": "DIAGNOSIS"},
    )
    assert out["state"] == "SAFETY_ALERT"


def test_backward_guard_is_unchanged():
    out = advance_state(_state("DIAGNOSIS"), {"reply": REAL_DIAGNOSIS, "next_state": "Q1"})
    assert out["state"] == "DIAGNOSIS"


# ── B. an uploaded photo filename is not a citation ──────────────────────────


def test_uploaded_photo_filename_is_not_a_citation():
    assert not _has_usable_citation(f"{BARE_REFLECTION} [Source: 481923.jpg]")
    assert not _has_usable_citation("Looks like the nameplate [Source: nameplate.jpeg]")
    assert not _has_usable_citation("See [Source: IMG_2043.PNG]")
    assert not _has_usable_citation("As shown [Source: photo.heic]")


def test_self_referential_photo_label_is_not_a_citation():
    for label in ("the uploaded photo", "your photo", "photo", "attached image", "the image"):
        assert not _has_usable_citation(f"It's a WEG motor [Source: {label}]."), label


def test_a_document_filename_is_still_a_citation():
    """A manual PDF you can go look up is evidence; the tech's own photo is not."""
    assert _has_usable_citation("CE10 is a comms fault [Source: GS10M_UM.pdf]")


def test_a_real_citation_is_still_usable():
    assert _has_usable_citation("[Source: AutomationDirect GS10 — Fault Codes]")
    assert _has_usable_citation("[Source: Rockwell Automation PowerFlex 525 manual]")


def test_a_section_named_photo_is_still_a_citation():
    """Anchored on the whole label — a section that merely mentions a photo survives."""
    assert _has_usable_citation("[Source: Siemens G120 — Nameplate Photo]")


def test_mixed_citations_count_when_one_is_real():
    assert _has_usable_citation(
        "It's a WEG motor [Source: 481923.jpg] rated 15HP [Source: WEG W22 — Technical Data]."
    )


def test_photo_citation_no_longer_suppresses_the_admission():
    """The whole point: a junk citation must not look better-grounded than none."""
    reply = (
        "You think it's a WEG motor, and the overload keeps tripping on the blower "
        "circuit under load. [Source: 481923.jpg]"
    )
    out = enforce_citation_or_gap_admission(reply)
    assert "KB-gap:" in out
