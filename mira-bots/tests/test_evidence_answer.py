"""EvidenceAnswer contract (Package B) — hermetic tests.

Covers ``shared/visual/evidence_answer.py``: 12-field ``to_dict`` completeness,
every trust-label mapping (incl. metadata-trust overrides), the safety-class
render guarantee (energized_measurement / state_change renders always carry a
grader safety marker and never assert a live state), coordinate honesty,
claim/suggestion bounds, plain-vs-trace rendering, and the technician-
measurement detector matrix. Keyless, no network, no LLM.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from printsense.benchmarks.single_photo_grader import (  # noqa: E402
    _SAFETY_MARKERS,
    _state_claim_asserted,
)
from shared.visual import evidence_answer as ev  # noqa: E402
from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.models import AnswerClaim, AnswerEnvelope, Observation, VisualSession  # noqa: E402

# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #

EXPECTED_TO_DICT_KEYS = {
    "session_id",
    "print_model_version",
    "question",
    "focus_entity",
    "answer",
    "claims",
    "trust_summary",
    "safety_class",
    "safety_notes",
    "answer_source",
    "superseded_evidence_used",
    "suggested_next_questions",
    "read_only",
}


def _session(revision: str | None = "abcd1234-rev") -> VisualSession:
    return VisualSession(session_id="s1", tenant_id="t1", current_revision=revision)


def _obs(oid: str, **kw) -> Observation:
    defaults = dict(
        observation_id=oid,
        session_id="s1",
        tenant_id="t1",
        obs_kind="entity",
        evidence_state=EvidenceState.VISIBLE,
        extractor="ocr",
    )
    defaults.update(kw)
    return Observation(**defaults)


def _ledger() -> list[Observation]:
    return [
        _obs("o1", raw_value="-K17", metadata={"bbox": [430, 120, 520, 145], "page": "3"}),
        _obs("o2", raw_value="13  14", metadata={"bbox": [200, 300, 260, 320]}),
        _obs("o3", raw_value="-F12", metadata={"bbox": None}),
        _obs(
            "o4",
            obs_kind="property",
            raw_value="I have 24V before F12 but nothing after",
            evidence_state=EvidenceState.DOCUMENTED,
            extractor="technician",
            metadata={"measurement": {"value": 24.0}},
        ),
        _obs(
            "o5",
            obs_kind="relation",
            raw_value="printsynth graph captured",
            evidence_state=EvidenceState.LIKELY,
            extractor="graph",
            metadata={"graph_cas_key": "k", "trust": "proposed"},
        ),
    ]


# --------------------------------------------------------------------------- #
# contract completeness
# --------------------------------------------------------------------------- #


def test_to_dict_carries_the_full_contract():
    ea = ev.build_evidence_answer(
        _session(), _ledger(), "what feeds K17?", "-K17", "ledger", "From the workspace:"
    )
    payload = ea.to_dict()
    assert set(payload.keys()) == EXPECTED_TO_DICT_KEYS
    assert payload["session_id"] == "s1"
    assert payload["print_model_version"] == "abcd1234-rev"
    assert payload["question"] == "what feeds K17?"
    assert payload["focus_entity"] == "-K17"
    assert payload["answer_source"] == "ledger"
    assert payload["read_only"] is True
    assert isinstance(payload["claims"], list) and payload["claims"]
    claim_keys = {
        "text",
        "trust_label",
        "evidence_state",
        "extractor",
        "coordinates",
        "observation_id",
        "superseded",
    }
    assert all(set(c.keys()) == claim_keys for c in payload["claims"])
    assert payload["answer_source"] in ev.ANSWER_SOURCES
    assert payload["safety_class"] in ev.SAFETY_CLASSES


# --------------------------------------------------------------------------- #
# trust labels
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("state", "extractor", "metadata", "expected"),
    [
        (EvidenceState.DOCUMENTED, "technician", {}, "Reported by technician"),
        (EvidenceState.SUPERSEDED, "technician", {}, "Reported by technician"),
        (EvidenceState.MACHINE_VERIFIED, "ocr", {}, "Shown on the drawing (verified)"),
        (
            EvidenceState.VISIBLE,
            "ocr",
            {"trust": "machine_verified"},
            "Shown on the drawing (verified)",
        ),
        (EvidenceState.VISIBLE, "ocr", {}, "Shown on the drawing"),
        (EvidenceState.DOCUMENTED, "nameplate_worker", {}, "Documented"),
        (EvidenceState.LIKELY, "graph", {}, "Derived (not verified)"),
        (EvidenceState.NEEDS_CONTEXT, "graph", {"trust": "proposed"}, "Derived (not verified)"),
        (EvidenceState.NEEDS_CONTEXT, "quality_gate", {}, "Not proven"),
        (EvidenceState.CONFLICTING, "ocr", {}, "Conflicting evidence"),
        (EvidenceState.SUPERSEDED, "ocr", {}, "Superseded"),
        (EvidenceState.REJECTED, "ocr", {}, "Not proven"),
        ("VISIBLE", "ocr", None, "Shown on the drawing"),  # str-state coercion
    ],
)
def test_trust_label_mapping(state, extractor, metadata, expected):
    assert ev.trust_label(state, extractor, metadata) == expected


def test_trust_summary_counts_buckets():
    ea = ev.build_evidence_answer(_session(), _ledger(), "what feeds K17?", None, "ledger", "lead")
    # 3 OCR VISIBLE + 1 technician + 1 proposed-graph LIKELY
    assert ea.trust_summary == "3 shown on drawing · 1 derived · 1 reported by technician"


# --------------------------------------------------------------------------- #
# safety classes + the render guarantee
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("I have 24V before F12 but nothing after", "energized_measurement"),
        ("measured 0.4 ohm across 13-14", "de_energized_verification"),
        ("is it safe to touch this panel?", "de_energized_verification"),
        ("why would K17 drop out?", "state_change"),
        ("there is visible smoke from the panel", "stop_escalate"),
        ("is the 13/14 contact normally open or closed?", "informational"),
        ("what does K17 mean?", "informational"),
    ],
)
def test_classify_answer_safety(question, expected):
    assert ev.classify_answer_safety(question) == expected


@pytest.mark.parametrize(
    "question", ["I have 24V before F12 but nothing after", "why would K17 drop out?"]
)
@pytest.mark.parametrize("mode", ["plain", "trace"])
def test_energized_and_state_change_renders_carry_a_safety_marker(question, mode):
    ea = ev.build_evidence_answer(
        _session(),
        [o for o in _ledger() if o.extractor == "ocr"],
        question,
        "-K17",
        "model_explanation",
        "Grounded explanation text.",
    )
    assert ea.safety_class in ("energized_measurement", "state_change")
    rendered = ev.format_evidence_answer(ea, mode)
    assert any(marker in rendered.lower() for marker in _SAFETY_MARKERS)


def test_safety_floor_survives_stripped_notes():
    """Even a hand-built EvidenceAnswer with emptied notes renders the marker."""
    ea = ev.build_evidence_answer(
        _session(), _ledger(), "why would K17 drop out?", "-K17", "model_explanation", "x"
    )
    ea.safety_notes = []
    rendered = ev.format_evidence_answer(ea, "plain")
    assert any(marker in rendered.lower() for marker in _SAFETY_MARKERS)


@pytest.mark.parametrize(
    ("source", "answer"),
    [
        ("deterministic", "Contact 13/14 is a NORMALLY OPEN (NO) auxiliary contact by convention."),
        ("ledger", "Here's what the stored print workspace shows for that:"),
        ("model_explanation", "The reported 24V loss after F12 would open the coil circuit."),
        ("observation_ack", "You report 24 V before F12 and nothing after F12 — logged."),
        ("none", "The workspace has no legible evidence for that — send a closer photo."),
    ],
)
@pytest.mark.parametrize("mode", ["plain", "trace"])
def test_every_answer_source_render_is_state_claim_clean(source, answer, mode):
    ea = ev.build_evidence_answer(_session(), _ledger(), "what about K17?", "-K17", source, answer)
    rendered = ev.format_evidence_answer(ea, mode)
    assert _state_claim_asserted(rendered) is None


# --------------------------------------------------------------------------- #
# coordinate honesty
# --------------------------------------------------------------------------- #


def test_coordinates_come_only_from_stored_bboxes():
    ea = ev.build_evidence_answer(
        _session(), _ledger(), "what feeds K17?", "-K17", "ledger", "lead"
    )
    by_id = {c["observation_id"]: c for c in ea.claims}
    assert by_id["o1"]["coordinates"] == {"bbox": [430, 120, 520, 145], "page": "3"}
    assert by_id["o3"]["coordinates"] is None  # bbox None -> no coordinates
    assert by_id["o4"]["coordinates"] is None  # technician obs carry no bbox

    trace = ev.format_evidence_answer(ea, "trace")
    assert "bbox 430,120,520,145" in trace
    assert "coordinates unavailable" in trace
    # never fabricated: the only bbox strings are the two stored ones
    assert trace.count("bbox ") == 2


# --------------------------------------------------------------------------- #
# bounds + rendering modes
# --------------------------------------------------------------------------- #


def test_claims_and_suggestions_are_bounded():
    many = [_obs(f"o{i}", raw_value=f"-K{i}") for i in range(30)]
    ea = ev.build_evidence_answer(
        _session(), many, "why would it drop out? K3", "-K3", "model_explanation", "x"
    )
    assert len(ea.claims) <= ev.MAX_CLAIMS == 8
    assert len(ea.suggested_next_questions) <= ev.MAX_SUGGESTIONS == 3
    rendered = ev.format_evidence_answer(ea, "plain")
    assert rendered.count("\n- [") <= ev.MAX_CLAIMS


def test_plain_and_trace_modes_differ():
    ea = ev.build_evidence_answer(
        _session(), _ledger(), "what feeds K17?", "-K17", "ledger", "lead"
    )
    plain = ev.format_evidence_answer(ea, "plain")
    trace = ev.format_evidence_answer(ea, "trace")
    assert plain != trace
    assert "print model" not in plain
    assert "print model abcd1234" in trace
    assert "coordinates unavailable" not in plain


def test_focus_ordering_puts_focus_then_technician_first():
    ea = ev.build_evidence_answer(
        _session(), _ledger(), "what feeds F12?", "-F12", "ledger", "lead"
    )
    labels = [c["observation_id"] for c in ea.claims]
    # -F12 obs first (focus; o4's verbatim also mentions F12), technician next
    assert set(labels[:2]) == {"o3", "o4"}


def test_superseded_evidence_used_flag_and_note():
    superseded = _obs(
        "old1",
        raw_value="-K17",
        evidence_state=EvidenceState.SUPERSEDED,
        superseded_by="o1",
    )
    ea = ev.build_evidence_answer(
        _session(), [superseded], "what about K17?", "-K17", "ledger", "lead"
    )
    assert ea.superseded_evidence_used is True
    assert ea.claims[0]["superseded"] is True
    assert "superseded" in ev.format_evidence_answer(ea, "trace")

    note = ev.superseded_note_for([superseded], "-K17", "abcd1234-rev")
    assert note == "(earlier readings of -K17 were replaced by your close-up — revision abcd1234)"
    assert ev.superseded_note_for([superseded], "-F12", "abcd1234-rev") is None
    assert ev.superseded_note_for([], "-K17", None) is None


def test_build_from_envelope_enriches_backed_claims_and_keeps_safety():
    obs = _ledger()
    envelope = AnswerEnvelope(
        answer="- [Seen in photo] -K17",
        claims=[
            AnswerClaim(
                text="-K17",
                evidence_state=EvidenceState.VISIBLE,
                supporting_observation_ids=["o1"],
            ),
            AnswerClaim(
                text="Cannot be confirmed safe from a photo.",
                evidence_state=EvidenceState.NEEDS_CONTEXT,
                safety_flag=True,
            ),
        ],
        next_best_evidence="Verify a zero-energy state with a meter under lockout/tagout.",
        safety_notes=["Image evidence does not establish a de-energized state."],
    )
    ea = ev.build_from_envelope(
        _session(), envelope, obs, "is it safe to touch?", "-K17", "ledger", ""
    )
    backed = next(c for c in ea.claims if c["observation_id"] == "o1")
    assert backed["coordinates"] == {"bbox": [430, 120, 520, 145], "page": "3"}
    unbacked = next(c for c in ea.claims if c["observation_id"] is None)
    assert unbacked["coordinates"] is None
    assert "Image evidence does not establish a de-energized state." in ea.safety_notes
    assert any("zero-energy" in n for n in ea.safety_notes)
    assert _state_claim_asserted(ev.format_evidence_answer(ea, "plain")) is None


# --------------------------------------------------------------------------- #
# technician-measurement detector
# --------------------------------------------------------------------------- #


def test_detect_fires_on_reported_measurements():
    parsed = ev.detect_technician_observation("I have 24V before F12 but nothing after")
    assert parsed == {
        "quantity": "voltage",
        "value": 24.0,
        "unit": "V",
        "location_before": "F12",
        "location_after": None,
        "negated": True,
        "tags": ["F12"],
    }

    parsed = ev.detect_technician_observation("measured 0.4 ohm across 13-14")
    assert parsed is not None
    assert parsed["quantity"] == "resistance"
    assert parsed["value"] == 0.4
    assert parsed["negated"] is False
    assert parsed["tags"] == ["13-14"]

    parsed = ev.detect_technician_observation("24VDC at X2:4, dead at X2:5")
    assert parsed is not None
    assert parsed["quantity"] == "voltage"
    assert parsed["unit"].lower() == "vdc"
    assert parsed["negated"] is True
    assert parsed["tags"] == ["X2:4", "X2:5"]


@pytest.mark.parametrize(
    "text",
    [
        "what is K17",
        "yes",
        "the coil is energized",
        "24",
        "",
        "explain this print to me",
    ],
)
def test_detect_does_not_fire_on_non_measurements(text):
    assert ev.detect_technician_observation(text) is None


def test_observation_ack_restates_and_relates():
    parsed = ev.detect_technician_observation("I have 24V before F12 but nothing after")
    ack = ev.observation_ack_text(
        "I have 24V before F12 but nothing after", parsed, ["-K17", "-F12"]
    )
    assert ack.lower().startswith("you report 24v before f12")
    assert "-F12 is shown on the stored drawing." in ack
    assert _state_claim_asserted(ack) is None

    parsed = ev.detect_technician_observation("24VDC at X2:4, dead at X2:5")
    ack = ev.observation_ack_text("24VDC at X2:4, dead at X2:5", parsed, ["-K17"])
    assert "you report" in ack.lower()
    assert "not among the legible tags" in ack
