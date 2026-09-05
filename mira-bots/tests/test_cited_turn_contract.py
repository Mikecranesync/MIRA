"""Conformance suite for the Cited Technician Turn contract.

PRD `docs/prd/2026-08-03-cited-technician-turn.md` §11.3 asks for fixtures
covering every required turn state, and for proof that the same evidence
produces equivalent semantics on every renderer. That is what this file is.

Three kinds of assertion, in order of how much they matter:

1. **Prohibited content.** Each state has content it must never carry — a
   diagnosis before the gate closes, a numeric confidence, steps inside a
   safety STOP, a claimed control action anywhere. These encode product
   invariants, so they are written to fail loudly rather than to pass easily.
2. **Required content.** A grounded answer has a checkable citation; an
   evidence gap names the smallest useful missing input; a handoff is a draft.
3. **Cross-renderer survival.** A block that no renderer draws is content the
   technician never sees. The contract declares 11 block kinds; every one of
   them must reach the fallback text and survive Slack, Google Chat, and Teams.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared.chat.cited_turn import (  # noqa: E402
    CONTRACT_VERSION,
    Citation,
    TurnContext,
    build,
    context_confirmation,
    evidence_gap,
    grounded_answer,
    human_handoff,
    safety_stop,
    uns_required,
)
from shared.chat.renderers.gchat_cards import render_gchat  # noqa: E402
from shared.chat.renderers.slack_blocks import render_slack  # noqa: E402
from shared.chat.renderers.teams_cards import render_teams  # noqa: E402
from shared.chat.types import ResponseBlock  # noqa: E402

# ── fixtures: one per required turn state (PRD §5.2) ─────────────────────────

CONFIRMED = TurnContext(
    site="riverside", area="packaging", line="line_2", asset="CV-101",
    component="drive", fault="CE10", state="confirmed", band="high",
    uns_path="enterprise.riverside.packaging.line_2.cv_101", source="chat_resolver",
)
CERTIFIED = TurnContext(
    site="riverside", area="packaging", line="line_2", asset="CV-101",
    state="certified", band="high",
    uns_path="enterprise.riverside.packaging.line_2.cv_101", source="direct_connection",
)
UNCONFIRMED = TurnContext(asset="CV-101", fault="drive fault", state="needs_confirmation", band="medium")

MANUAL = Citation("manual", "GS10 user manual", "p. 42, §4.3 CE10", "static")
LIVE = Citation("live_tag", "cv_101.dc_bus", "320.0 V at 14:02:16", "live")
STALE = Citation("live_tag", "cv_101.speed", "0 Hz at 09:11:04", "stale")
WORK_ORDER = Citation("work_order", "WO-1042", "closed 2026-06-14", "static")


def all_states():
    """Every turn state, as (name, response) — the table the suite sweeps."""
    return [
        ("confirmation", context_confirmation(UNCONFIRMED, ["UNS match on CV-101", "fault CE10 seen 3x"])),
        ("certified", grounded_answer(CERTIFIED, "The drive lost comms.", "Check the RS-485 shield.", [MANUAL, LIVE])),
        ("grounded", grounded_answer(CONFIRMED, "CE10 is a comms timeout.", "Verify P09.03.", [MANUAL])),
        ("evidence_gap", evidence_gap(CONFIRMED, "CV-101 is the asset", "which drive is installed", "the drive nameplate")),
        ("safety_stop", safety_stop("live electrical work", "NFPA 70E")),
        ("handoff", human_handoff(CONFIRMED, ["reseated the comms cable"], "why does CE10 return after reset?")),
        ("uns_required", uns_required()),
    ]


# ── 1. prohibited content ────────────────────────────────────────────────────

_NUMERIC_CONFIDENCE = re.compile(
    r"\b(?:confidence|certainty|probability)\b[^.\n]{0,20}?\d"
    r"|\b\d{1,3}\s?%\s*(?:confiden|sure|certain)"
    r"|\b0\.\d+\s*(?:confidence|score)",
    re.IGNORECASE,
)

# Past-tense possession of a control action. MIRA is read-only; it may never
# claim it reset, forced, wrote, or started anything.
_CLAIMED_ACTION = re.compile(
    r"\bI\s+(?:have\s+)?(?:just\s+)?(?:reset|restarted|cleared|forced|wrote|"
    r"started|stopped|enabled|disabled|changed|set)\b",
    re.IGNORECASE,
)


@pytest.mark.parametrize("name,resp", all_states(), ids=lambda v: v if isinstance(v, str) else "")
def test_no_numeric_confidence_is_ever_shown(name, resp):
    """PRD §11.1 — the technician never sees a numeric LLM confidence score."""
    assert not _NUMERIC_CONFIDENCE.search(resp.text), f"{name}: {resp.text}"


@pytest.mark.parametrize("name,resp", all_states(), ids=lambda v: v if isinstance(v, str) else "")
def test_no_state_claims_a_control_action(name, resp):
    """MIRA is read-only. No turn state may claim it acted on equipment."""
    assert not _CLAIMED_ACTION.search(resp.text), f"{name}: {resp.text}"


@pytest.mark.parametrize("name,resp", all_states(), ids=lambda v: v if isinstance(v, str) else "")
def test_every_state_has_a_text_fallback(name, resp):
    assert resp.text.strip(), f"{name} rendered no accessible text"


def test_confirmation_card_does_not_troubleshoot():
    """The gate is load-bearing: no advice before the context is confirmed."""
    resp = context_confirmation(UNCONFIRMED, ["UNS match on CV-101"])
    lowered = resp.text.lower()
    for forbidden in ("check ", "reset", "replace", "verify ", "next safe check"):
        assert forbidden not in lowered, f"troubleshooting leaked into the gate: {forbidden!r}"


def test_confirmation_card_offers_explicit_correction():
    """A confirmation must be explicit — never inferred from a reaction."""
    resp = context_confirmation(UNCONFIRMED, [])
    actions = {b["action"] for blk in resp.blocks if blk.kind == "button_row" for b in blk.data["buttons"]}
    assert {"context.confirm", "context.reject"} <= actions


def test_safety_stop_gives_no_steps():
    """A STOP that lists steps is a cosmetic warning, not a stop."""
    resp = safety_stop("arc flash", "NFPA 70E")
    assert not re.search(r"^\s*\d+[.)]\s", resp.text, re.MULTILINE), resp.text
    assert "lockout" in resp.text.lower()


def test_safety_stop_offers_no_resume_control():
    """Acknowledgement may be recorded; it must not unlock troubleshooting."""
    resp = safety_stop("confined space", "OSHA 1910.146")
    actions = {b["action"] for blk in resp.blocks if blk.kind == "button_row" for b in blk.data["buttons"]}
    assert not any("resume" in a or "continue" in a for a in actions), actions


def test_handoff_is_a_draft_never_a_send():
    resp = human_handoff(CONFIRMED, ["swapped the sensor"], "why does it recur?")
    actions = {b["action"] for blk in resp.blocks if blk.kind == "button_row" for b in blk.data["buttons"]}
    assert "handoff.draft" in actions
    assert not any(a.startswith(("handoff.send", "cmms.create", "escalate.send")) for a in actions)
    assert "draft" in resp.text.lower()


def test_uns_required_does_not_ask_a_chat_gate_question():
    """A certified surface missing identity REJECTS. It never downgrades."""
    resp = uns_required()
    assert "?" not in resp.text, f"downgraded to a question: {resp.text}"


# ── 2. required content ──────────────────────────────────────────────────────


def test_grounded_answer_requires_confirmed_context():
    with pytest.raises(ValueError, match="confirmed or certified"):
        grounded_answer(UNCONFIRMED, "It's the drive.", "Check power.", [MANUAL])


def test_grounded_answer_requires_a_citation():
    """No evidence is an evidence gap, not a confident answer."""
    with pytest.raises(ValueError, match="at least one citation"):
        grounded_answer(CONFIRMED, "It's the drive.", "Check power.", [])


def test_citation_without_a_locator_is_rejected():
    """A citation you cannot go look up is decoration."""
    with pytest.raises(ValueError, match="locator"):
        build([ResponseBlock(kind="citation", data={"source": "the manual"})])


def test_grounded_answer_carries_a_checkable_locator():
    resp = grounded_answer(CONFIRMED, "CE10 is a comms timeout.", "Verify P09.03.", [MANUAL])
    cites = [b for b in resp.blocks if b.kind == "citation"]
    assert cites and all(c.data["locator"] for c in cites)
    assert "p. 42" in resp.text


def test_evidence_freshness_is_distinguishable():
    """Static reference, live telemetry, and stale data must not look alike."""
    resp = grounded_answer(CERTIFIED, "Bus voltage is nominal.", "Watch under load.", [MANUAL, LIVE, STALE])
    kinds = {c.data["freshness"] for c in resp.blocks if c.kind == "citation"}
    assert {"static", "live", "stale"} == kinds
    assert "stale" in resp.text  # and it is visible, not just structured


def test_evidence_gap_names_the_smallest_next_input():
    resp = evidence_gap(CONFIRMED, "CV-101 is the asset", "which drive is installed", "the drive nameplate")
    assert "drive nameplate" in resp.text
    assert "can't" in resp.text.lower() or "cannot" in resp.text.lower()


def test_evidence_gap_does_not_pad_with_generic_advice():
    resp = evidence_gap(CONFIRMED, "the asset", "the fault", "a fault code")
    lowered = resp.text.lower()
    for filler in ("common fixes", "try these", "generally", "usually you"):
        assert filler not in lowered


def test_certified_context_is_labelled_as_certified():
    """A certified turn must not read as if the technician confirmed it."""
    resp = grounded_answer(CERTIFIED, "Comms dropped.", "Check the shield.", [LIVE])
    assert "Certified connection" in resp.text


# ── adaptive dialogue mode (Answer Integrity PRD §2.2) ───────────────────────
#
# The policy fails in two directions, so both are pinned. Quizzing a technician
# who asked a direct question wastes the one thing they cannot spare; deleting
# the guiding question from live conversational diagnosis throws away the
# interaction that makes MIRA useful. Neither test means much on its own.

KIOSK = TurnContext(
    site="riverside", asset="CV-101", state="certified", band="high",
    source="direct_connection", single_shot=True,
)


def test_single_shot_surface_refuses_a_guiding_question():
    """Ignition Ask MIRA / QR / kiosk: the technician cannot answer a follow-up."""
    with pytest.raises(ValueError, match="single-shot"):
        grounded_answer(
            KIOSK, "CE10 is a comms timeout.", "Verify P09.03.", [MANUAL],
            guiding_question="What does the display show?",
        )


def test_single_shot_answer_ends_without_a_question():
    resp = grounded_answer(KIOSK, "CE10 is a comms timeout.", "Verify P09.03.", [MANUAL])
    assert "?" not in resp.text, f"trailing question on a single-shot surface: {resp.text}"


def test_conversational_surface_may_ask_one_guiding_question():
    """The other half of the policy — this must stay possible."""
    resp = grounded_answer(
        CONFIRMED,
        "The trip repeats under load, which points at the motor circuit.",
        "Feel the motor housing after the next trip.",
        [MANUAL],
        guiding_question="Does it trip at the same point in the cycle every time?",
    )
    assert "same point in the cycle" in resp.text


def test_the_answer_precedes_the_question():
    """A supported answer is never withheld to make room for a question."""
    resp = grounded_answer(
        CONFIRMED, "ANSWERTEXT", "check the shield", [MANUAL], guiding_question="QUESTIONTEXT"
    )
    assert resp.text.index("ANSWERTEXT") < resp.text.index("QUESTIONTEXT")


def test_a_guiding_question_never_replaces_the_citation():
    resp = grounded_answer(CONFIRMED, "a", "b", [MANUAL], guiding_question="what shows?")
    assert any(b.kind == "citation" for b in resp.blocks)


def test_safety_stop_asks_nothing_at_all():
    """STOP overrides every dialogue mode, including the conversational one.

    A question inside a STOP is how troubleshooting steps get smuggled past the
    guardrail ("have you checked whether the bus is discharged?").
    """
    resp = safety_stop("arc flash", "NFPA 70E")
    assert "?" not in resp.text, f"STOP asked a question: {resp.text}"


def test_grounded_answer_shows_at_most_three_citations():
    """PRD §5.4 — no more than three primary evidence chips."""
    resp = grounded_answer(CONFIRMED, "a", "b", [MANUAL, LIVE, STALE, WORK_ORDER])
    assert sum(1 for b in resp.blocks if b.kind == "citation") == 3


def test_context_summary_orders_site_to_fault():
    assert CONFIRMED.summary() == "riverside / packaging / line_2 / CV-101 / drive — CE10"


# ── 3. cross-renderer survival ───────────────────────────────────────────────

ALL_BLOCK_KINDS = [
    "header", "paragraph", "bullet_list", "key_value", "button_row",
    "divider", "image", "code", "citation", "warning", "suggestion_chips",
]


# Kinds no renderer implements yet. `strict=True` is the point: if someone adds
# a branch, the xfail turns into an unexpected pass and they are forced to drop
# the marker — so the gap can neither persist silently nor disappear silently.
# None of these are emitted by a Cited Turn state today; `bullet_list` was, and
# that one is fixed rather than marked.
UNRENDERED = {
    ("slack", "image"), ("slack", "code"),
    ("gchat", "image"), ("gchat", "code"), ("gchat", "divider"), ("gchat", "suggestion_chips"),
    ("teams", "image"), ("teams", "code"), ("teams", "suggestion_chips"),
}


def _structured(payload: dict) -> str:
    """The renderer's own structure, with the plain-text fallback removed.

    Every renderer ships `response.text` alongside its native payload. Leaving
    it in would make each block kind look supported, since the fallback always
    contains the content. Only the structured part proves a renderer branch
    actually exists.
    """
    return repr({k: v for k, v in payload.items() if k != "text"})


def _sample(kind: str) -> ResponseBlock:
    data = {
        "header": {"text": "HEADERMARK"},
        "paragraph": {"text": "PARAMARK"},
        "bullet_list": {"items": ["BULLETMARK"]},
        "key_value": {"pairs": [["KEYMARK", "VALMARK"]]},
        "button_row": {"buttons": [{"label": "BTNMARK", "action": "a.b"}]},
        "divider": {},
        "image": {"url": "http://x/y.png", "alt": "IMGMARK"},
        "code": {"code": "CODEMARK"},
        "citation": {"source": "CITEMARK — p. 1", "locator": "p. 1"},
        "warning": {"text": "WARNMARK"},
        "suggestion_chips": {"suggestions": ["CHIPMARK"]},
    }[kind]
    return ResponseBlock(kind=kind, data=data)


@pytest.mark.parametrize("kind", ALL_BLOCK_KINDS)
def test_every_declared_block_kind_reaches_the_text_fallback(kind):
    """A kind absent from the fallback is content a screen reader never gets."""
    if kind == "divider":
        pytest.skip("a divider is presentational and has no text equivalent")
    resp = build([_sample(kind)])
    assert "MARK" in resp.text, f"{kind} produced no fallback text"


@pytest.mark.parametrize("kind", ALL_BLOCK_KINDS)
@pytest.mark.parametrize(
    "surface,render",
    [("slack", render_slack), ("gchat", render_gchat), ("teams", render_teams)],
    ids=["slack", "gchat", "teams"],
)
def test_every_declared_block_kind_survives_every_renderer(surface, kind, render, request):
    """The gap this suite was written to catch.

    `bullet_list` is declared in the ResponseBlock Literal, so any producer may
    legitimately emit one — but a renderer that has no branch for it drops the
    block silently, and the technician simply never sees those lines. Same for
    any kind added to the Literal without a matching renderer branch.
    """
    if kind == "divider" and surface != "gchat":
        pytest.skip("a divider carries no content to lose")
    if (surface, kind) in UNRENDERED:
        request.node.add_marker(
            pytest.mark.xfail(strict=True, reason=f"{surface} has no {kind} branch yet")
        )

    # The block under test is paired with a paragraph ANCHOR on purpose. Every
    # renderer ends with `if not blocks: <emit response.text>` — an empty-blocks
    # rescue. Rendered alone, an unsupported kind trips that rescue and looks
    # supported. The anchor guarantees `blocks` is non-empty, so the rescue
    # cannot fire and a dropped kind actually shows up as dropped. (Verified:
    # without the anchor this test passed for `bullet_list`, which no renderer
    # implements.)
    resp = build([ResponseBlock(kind="paragraph", data={"text": "ANCHOR"}), _sample(kind)])
    payload = _structured(render(resp))
    assert "ANCHOR" in payload, f"anchor missing — {render.__name__} changed shape"
    assert "MARK" in payload, f"{kind} was dropped by {render.__name__}"


@pytest.mark.parametrize("name,resp", all_states(), ids=lambda v: v if isinstance(v, str) else "")
@pytest.mark.parametrize("render", [render_slack, render_gchat, render_teams], ids=["slack", "gchat", "teams"])
def test_every_turn_state_renders_on_every_surface(name, resp, render):
    """Behavioral equivalence across front doors, not just per-block coverage."""
    payload = render(resp)
    assert payload, f"{name} rendered empty on {render.__name__}"


@pytest.mark.parametrize("name,resp", all_states(), ids=lambda v: v if isinstance(v, str) else "")
def test_citations_carry_the_contract_version(name, resp):
    """A `data` payload a renderer consumes must be versioned (PRD §6.1)."""
    for b in resp.blocks:
        if b.kind == "citation":
            assert b.data["v"] == CONTRACT_VERSION
