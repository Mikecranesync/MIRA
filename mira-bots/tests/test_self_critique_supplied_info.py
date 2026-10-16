"""CTX-005 — the groundedness clarifier must not re-ask for information the
session already holds.

Campaign defect (A) behind t2:pivot_after_fault (#3160) and the unfixed half of
t1:reset_procedure (#3156). After MIRA has explained F004 on a PowerFlex 525,
"How do I reset it?" is answered with:

    Before I can give you a confident diagnosis, could you share one more
    detail — what exact fault code, alarm number, or behaviour is the
    equipment showing right now?

while ``uns_context.fault_code`` is pinned to F004 and the model is resolved.
The clarifier discards a real answer to re-ask what the technician already
supplied — a re-ask of supplied info, the shape gates.reasks_supplied_info
detects on the transcript side.

The critique judge only ever sees (question, reply); it cannot know the session
already holds the answer. So the guard belongs at the call site, not in the
judge.

Negative control: eval fixture 34 (a vague "VFD making a strange noise and
sometimes stops" with NO fault code and NO model) is the case the clarifier
exists FOR. It must keep firing.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor  # noqa: E402

# A plausible procedural draft, deliberately without retrieved support.
# A known fault prevents a repeat question but cannot verify this procedure.
DIAG_REPLY = (
    '{"reply": "Reset F004 by cycling power, or press Stop/Reset on the keypad. '
    'Then verify incoming voltage at L1-L2-L3 before restarting.",'
    ' "next_state": "DIAGNOSIS", "options": [], "confidence": "MEDIUM"}'
)

LOW_GROUNDEDNESS = (
    '{"groundedness": {"score": 2, "note": "no citation"},'
    ' "helpfulness": {"score": 4},'
    ' "instruction_following": {"score": 4}}'
)

ROUTED = {"intent": "diagnose_equipment", "confidence": 0.9, "reasoning": "test"}

CLARIFIER_MARK = "Before I can give you a confident diagnosis"


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "critique.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with (
            patch("shared.engine.VisionWorker"),
            patch("shared.engine.NameplateWorker"),
            patch("shared.engine.RAGWorker"),
            patch("shared.engine.PrintWorker"),
            patch("shared.engine.PLCWorker"),
            patch("shared.engine.NemotronClient"),
            patch("shared.engine.InferenceRouter"),
        ):
            sup = Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test-key",
                collection_id="test-collection",
            )
    sup.rag = MagicMock()

    async def fake_rag_process(message, state, *args, **kwargs):
        return DIAG_REPLY

    sup.rag.process = fake_rag_process
    # The critique judge always scores groundedness low, so every test here
    # exercises the clarifier branch and nothing depends on judge variance.
    sup.router = MagicMock()
    sup.router.enabled = True
    sup.router.complete = AsyncMock(return_value=(LOW_GROUNDEDNESS, {}))
    return sup


def _state(*, fault_code=None, model=None, manufacturer=None, symptom_history=None):
    uns = {"confidence": 0.81}
    if fault_code:
        uns["fault_code"] = fault_code
    if model:
        uns["model"] = model
    if manufacturer:
        uns["manufacturer"] = manufacturer
    return {
        "state": "Q1",
        "asset_identified": f"{manufacturer or 'Unknown'}, {model or 'Unknown'}",
        "exchange_count": 2,
        "context": {
            "history": symptom_history or [],
            "session_context": {},
            "uns_context": uns,
        },
    }


async def _turn(sv, state, message, chat):
    sv._save_state(chat, state)
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        reply = await sv.process(chat, message)
    return reply, sv._load_state(chat)


# ── The defect ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_clarifier_does_not_reask_a_pinned_fault_code(sv):
    """#3160 defect (A): the session holds F004 on a resolved PowerFlex 525 and
    the technician asks a procedural follow-up. Re-asking "what exact fault
    code is the equipment showing right now?" discards a real answer to request
    what was already supplied."""
    state = _state(
        fault_code="F004",
        model="PowerFlex 525",
        manufacturer="Rockwell Automation",
        symptom_history=[
            {"role": "user", "content": "What does F004 mean on a PowerFlex 525?"},
            {"role": "assistant", "content": "F004 = UnderVoltage on the DC bus."},
        ],
    )
    reply, saved = await _turn(sv, state, "How do I reset it?", "reask-pinned-fault")

    assert CLARIFIER_MARK not in reply, (
        "the clarifier re-asked for the fault code the session already holds"
    )
    assert "can't verify" in reply.lower()
    assert "cycling power" not in reply.lower(), "a known fault is not procedure support"
    assert saved.get("state") != "DIAGNOSIS_REVISION", (
        "session parked in DIAGNOSIS_REVISION on info it already had — this is "
        "the park CTX-001d's pivot then has to escape"
    )


# ── Negative controls: the clarifier must still fire when it should ─────────


@pytest.mark.asyncio
async def test_clarifier_still_fires_on_a_vague_symptom(sv):
    """Eval fixture 34 — 'My VFD is making a strange noise and sometimes stops'
    with NO fault code and NO model. This is the case the groundedness
    clarifier exists for; narrowing it must not switch it off."""
    reply, saved = await _turn(
        sv,
        _state(),
        "My VFD is making a strange noise and sometimes stops",
        "vague-symptom",
    )
    assert CLARIFIER_MARK in reply, "the clarifier must still fire on a vague symptom"
    assert saved.get("state") == "DIAGNOSIS_REVISION"


@pytest.mark.asyncio
async def test_clarifier_still_fires_when_only_the_model_is_known(sv):
    """A resolved model is NOT the information the clarifier asks for. Knowing
    it is a PowerFlex 525 says nothing about what the equipment is displaying,
    so the clarifier must still fire."""
    reply, _ = await _turn(
        sv,
        _state(model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "It keeps tripping, what's wrong with it?",
        "model-only",
    )
    assert CLARIFIER_MARK in reply, (
        "a known model does not supply the fault/symptom the clarifier requests"
    )


@pytest.mark.asyncio
async def test_critic_receives_turn_evidence_user_facts_and_full_bounded_answer(sv):
    state = _state(
        model="GS10",
        manufacturer="AutomationDirect",
        symptom_history=[
            {
                "role": "user",
                "content": "Motor is 5HP 460V three-phase, no load connected during startup test",
            },
            {"role": "assistant", "content": "ASSISTANT_INFERENCE_POISON motor disconnected"},
        ],
    )
    chunks = [
        {"content": "Applicable OC passage", "evidence_applicability": "model"},
        {"content": "Unknown settings poison", "evidence_applicability": "unknown"},
    ]
    scores = await sv._self_critique_diagnosis(
        "prefix " * 100 + "FINAL CLAIM", "How do I reset it?", "ctx", state=state, chunks=chunks
    )
    prompt = sv.router.complete.call_args.args[0][0]["content"]
    assert "Applicable OC passage" in prompt
    assert "Unknown settings poison" not in prompt
    assert "no load connected" in prompt
    assert "ASSISTANT_INFERENCE_POISON" not in prompt
    assert "FINAL CLAIM" in prompt
    assert scores["notes"]["groundedness"] == "no citation"


@pytest.mark.asyncio
async def test_recorded_startup_symptom_does_not_get_generic_symptom_question(sv):
    # Stored PF525 transcript's second user turn; historical F004 was lost by
    # the old resolver on later turns, so user history must inform the critic.
    state = _state(
        model="PowerFlex 525",
        manufacturer="Rockwell Automation",
        symptom_history=[
            {"role": "user", "content": "PF525 showing F004, what's wrong?"},
            {"role": "assistant", "content": "F004 = undervoltage"},
        ],
    )
    reply, saved = await _turn(
        sv, state, "Main conveyor, trips on startup every time", "recorded-startup"
    )
    assert "what exact fault code, alarm number, or behaviour" not in reply
    assert "what exact fault or alarm code" not in reply
    assert "can't verify" in reply.lower()
    assert "cycling power" not in reply.lower()
    assert saved["context"]["revision_critique"]["scores"]["notes"]["groundedness"] == "no citation"


@pytest.mark.asyncio
async def test_missing_fault_question_options_survive_persistence(sv):
    reply, saved = await _turn(
        sv,
        _state(model="GS10", manufacturer="AutomationDirect"),
        "It trips on startup",
        "missing-code-options",
    )
    assert "behaviour is the equipment showing" not in reply
    assert "code" in reply.lower()
    sc = saved["context"]["session_context"]
    assert sc["last_options"]
    assert sc["last_question"].split("\n", 1)[0] == reply.split("\n", 1)[0]
    assert sc["last_options"] == [
        "Fault/alarm code displayed",
        "No code displayed",
        "Display unreadable",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "output", ["not json", "[]", '{"groundedness":{"score":true}}', '{"groundedness":{"score":8}}']
)
async def test_malformed_critic_scores_fail_open_without_false_revision(sv, output):
    sv.router.complete = AsyncMock(return_value=(output, {}))
    assert await sv._self_critique_diagnosis("answer", "question", "bad-output") == {}


@pytest.mark.asyncio
async def test_explicit_no_code_is_not_asked_for_again(sv):
    reply, _ = await _turn(
        sv,
        _state(model="GS10", manufacturer="AutomationDirect"),
        "The drive trips on startup, no code displayed",
        "no-code",
    )
    assert "what exact fault or alarm code" not in reply


@pytest.mark.asyncio
async def test_critic_input_is_bounded_with_explicit_truncation_and_tail(sv):
    await sv._self_critique_diagnosis(
        "x" * 10000 + "DRAFT_TAIL",
        "question",
        "bound",
        state=_state(symptom_history=[{"role": "user", "content": "y" * 10000}] * 20),
        chunks=[{"content": "z" * 10000, "evidence_applicability": "family"}] * 20,
    )
    prompt = sv.router.complete.call_args.args[0][0]["content"]
    assert "[... truncated ...]" in prompt
    assert "DRAFT_TAIL" in prompt
    assert len(prompt) < 10000


@pytest.mark.asyncio
async def test_process_threads_only_turn_local_applicable_passages_to_critic(sv):
    async def rag(message, state, **kwargs):
        state["_rag_last_chunks"] = [
            {"content": "TURN_LOCAL_MANUAL", "evidence_applicability": "model"}
        ]
        return DIAG_REPLY

    sv.rag.process = rag
    sv.rag._last_neon_chunks = [{"content": "OTHER_TENANT_POISON"}]
    await _turn(
        sv,
        _state(fault_code="F004", model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "How do I reset it?",
        "context-bridge",
    )
    prompts = str(sv.router.complete.call_args_list)
    assert "TURN_LOCAL_MANUAL" in prompts
    assert "OTHER_TENANT_POISON" not in prompts


@pytest.mark.asyncio
async def test_known_fault_missing_manual_gets_concrete_evidence_request(sv):
    reply, _ = await _turn(
        sv,
        _state(fault_code="F004", model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "How do I reset it?",
        "manual-gap",
    )
    assert "upload" in reply.lower() and "manual" in reply.lower()
    assert "no citation" not in reply  # free-form critic notes remain internal


@pytest.mark.asyncio
async def test_supported_general_help_survives_and_only_missing_condition_is_asked(sv):
    guidance = "Record when the fault occurs and any recent changes."

    async def rag(message, state, **kwargs):
        state["_rag_last_chunks"] = [{"content": guidance, "evidence_applicability": "model"}]
        return (
            '{"reply": "'
            + guidance
            + ' Set an undocumented control.", "next_state": "DIAGNOSIS", "options": []}'
        )

    sv.rag.process = rag
    reply, saved = await _turn(
        sv,
        _state(fault_code="F004", model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "What should I check?",
        "supported-general",
    )
    assert guidance in reply
    assert "undocumented control" not in reply
    assert "startup" in reply.lower() and "stopping" in reply.lower()
    assert saved["context"]["session_context"]["last_options"]


@pytest.mark.asyncio
async def test_source_prohibition_does_not_support_positive_instruction(sv):
    async def rag(message, state, **kwargs):
        state["_rag_last_chunks"] = [
            {"content": "Never increase the motor speed.", "evidence_applicability": "model"}
        ]
        return '{"reply": "Increase the motor speed.", "next_state": "DIAGNOSIS", "options": []}'

    sv.rag.process = rag
    reply, _ = await _turn(
        sv,
        _state(fault_code="F004", model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "What should I check?",
        "negated-evidence",
    )
    assert "Increase the motor speed." not in reply


@pytest.mark.asyncio
async def test_reported_startup_condition_is_not_reasked_with_applicable_evidence(sv):
    async def rag(message, state, **kwargs):
        state["_rag_last_chunks"] = [
            {"content": "Applicable fault description.", "evidence_applicability": "model"}
        ]
        return DIAG_REPLY

    sv.rag.process = rag
    reply, _ = await _turn(
        sv,
        _state(fault_code="F004", model="PowerFlex 525", manufacturer="Rockwell Automation"),
        "Trips on startup, no code displayed",
        "condition-supplied",
    )
    assert "Does it happen during startup" not in reply
    assert "What changed" in reply
