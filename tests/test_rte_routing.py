"""RTE-001 / RTE-002 — routing: whole-message meaning outranks keyword/label matches.

RTE-001 (fixture 67): "What is an exploded view?" must be answered, not hijacked
into MANUAL_LOOKUP_GATHERING by an uncorroborated LLM-router ``find_documentation``
label. The deterministic recognizers in guardrails.classify_intent are the
code-shaped corroboration (RTE-003): router doc labels without them demote.

RTE-002 (fixture 66): "I don't have the manual" is negated possession, not a
retrieval request — it must not force document retrieval, and on an
identity-exhausted session the D2 symptom-first fallback must win the turn.

Engine LLM surfaces are stubbed (router intent + RAG worker + direct LLM);
everything between them is the production code — same harness as
tests/test_uns_gate_symptom_first_e2e.py.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.guardrails import classify_intent  # noqa: E402

RAG_REPLY = (
    '{"reply": "Check the drive output terminals for a loose connection.",'
    ' "next_state": "Q1", "options": [], "confidence": "MEDIUM"}'
)


def _make_sv(db_path: str):
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
            from shared.engine import Supervisor

            sv = Supervisor(
                db_path=db_path,
                openwebui_url="http://mock",
                api_key="key",
                collection_id="coll",
            )

    async def fake_rag_process(message, state, *args, **kwargs):
        return RAG_REPLY

    sv.rag.process = fake_rag_process  # type: ignore[method-assign]
    return sv


def _router(intent: str, confidence: float = 0.95):
    return {"intent": intent, "confidence": confidence, "reasoning": "test"}


# ── RTE-002 Part A: classify_intent is negation-aware ────────────────────────


class TestNegatedDocPossession:
    """Defect direction: negated possession is not a retrieval request."""

    def test_dont_have_the_manual_is_not_documentation(self):
        assert (
            classify_intent("No idea, there's no nameplate and I don't have the manual")
            != "documentation"
        )

    def test_dont_have_documentation_is_not_documentation(self):
        assert classify_intent("we don't have documentation for it") != "documentation"

    def test_dont_have_the_datasheet_is_not_documentation(self):
        assert classify_intent("I don't have the datasheet") != "documentation"


class TestDocRequestsPreserved:
    """Opposite direction: genuine retrieval requests still classify."""

    @pytest.mark.parametrize(
        "msg",
        [
            "do you have the manual for a PowerFlex 525?",
            "find the manual for the GS10",
            "I need the manual",
            # Negated ABILITY is still a retrieval request — the technician
            # wants the document, they just can't locate it themselves.
            "I can't find the manual, can you send it",
            # Schedule-class documents are documents (AskMira Q5 regression):
            # the corroboration gate must not orphan them on the router.
            "Show me the lubrication schedule for this conveyor.",
            "where is the maintenance schedule for the GS10",
        ],
    )
    def test_positive_requests_still_documentation(self, msg):
        assert classify_intent(msg) == "documentation"

    def test_scheduling_an_action_is_not_a_document(self):
        """'schedule' as a VERB (do maintenance later) is not a doc request."""
        assert classify_intent("I want to schedule maintenance for tomorrow") != "documentation"


# ── RTE-001: uncorroborated router doc label must not enter MLG ──────────────


@pytest.mark.asyncio
async def test_educational_question_not_hijacked_by_router_doc_label(tmp_path):
    """Fixture 67's failure, deterministic: router says find_documentation for
    'What is an exploded view?' (keyword classifier says industrial — no doc
    request shape). The turn must be answered and end IDLE, never enter
    MANUAL_LOOKUP_GATHERING."""
    sv = _make_sv(str(tmp_path / "rte1.db"))
    chat = "rte1-edu"
    sv._call_llm_direct = AsyncMock(
        return_value="An exploded view is a diagram that shows the parts of an assembly separated but positioned to show how they fit together."
    )

    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("find_documentation")),
    ):
        reply = await sv.process(chat, "What is an exploded view?")

    saved = sv._load_state(chat)
    assert saved.get("state") != "MANUAL_LOOKUP_GATHERING", reply
    assert "brand or manufacturer" not in reply.lower()
    assert saved.get("state") == "IDLE"


@pytest.mark.asyncio
async def test_vague_doc_request_still_enters_gathering(tmp_path):
    """Preservation: a corroborated vague doc request ('find me the manual' —
    matches _DOCUMENTATION_PHRASES) still enters MANUAL_LOOKUP_GATHERING."""
    sv = _make_sv(str(tmp_path / "rte1b.db"))
    chat = "rte1-vague"

    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("find_documentation")),
    ):
        reply = await sv.process(chat, "find me the manual")

    saved = sv._load_state(chat)
    assert saved.get("state") == "MANUAL_LOOKUP_GATHERING", reply
    assert "manufacturer" in reply.lower()


@pytest.mark.asyncio
async def test_specific_doc_request_still_crawls(tmp_path):
    """Preservation: a corroborated specific doc request still reaches
    _do_documentation_lookup, router-independent (both router verdicts)."""
    for router_verdict in ("find_documentation", "continue_current"):
        sv = _make_sv(str(tmp_path / f"rte1c-{router_verdict}.db"))
        chat = f"rte1-spec-{router_verdict}"
        doc_spy = AsyncMock(return_value=sv._make_result("doc-lookup-called", "none", None, "IDLE"))
        sv._do_documentation_lookup = doc_spy

        with patch(
            "shared.engine.route_intent",
            new=AsyncMock(return_value=_router(router_verdict)),
        ):
            await sv.process(chat, "can you pull up the manual for the PowerFlex 525")

        assert doc_spy.await_count == 1, f"doc lookup not invoked under router={router_verdict}"


# ── RTE-002 Part B: vendor-less exhausted session reaches symptom-first ──────


@pytest.mark.asyncio
@pytest.mark.parametrize("turn2_router", ["diagnose_equipment", "find_documentation"])
async def test_vendorless_identity_unknown_symptom_first(tmp_path, turn2_router):
    """Fixture 66's failure, deterministic: no vendor was EVER named, so
    resolver confidence is 0.0 the whole session. Turn 2 declares identity
    unknown AND mentions 'the manual' in passing. The symptom-first fallback
    must win the turn under either router verdict — never the manual-lookup
    identity re-demand."""
    sv = _make_sv(str(tmp_path / f"rte2-{turn2_router}.db"))
    chat = f"rte2-{turn2_router}"

    verdicts = iter([_router("diagnose_equipment", 0.9), _router(turn2_router, 0.9)])

    async def routed(**kwargs):
        return next(verdicts)

    with patch("shared.engine.route_intent", new=AsyncMock(side_effect=routed)):
        r1 = await sv.process(chat, "Something's wrong with one of our drives, it keeps faulting")
        assert "Before I diagnose" in r1 or "confirm the equipment" in r1, r1

        r2 = await sv.process(chat, "No idea, there's no nameplate and I don't have the manual")

    assert "lower confidence" in r2, r2  # the D2 notice reached the reply
    assert "brand or manufacturer" not in r2.lower(), r2  # no identity re-demand
    assert "Check the drive output terminals" in r2, r2  # RAG path continued

    saved = sv._load_state(chat)
    ctx = saved.get("context") or {}
    assert ctx.get("uns_identity_unknown") is True
    assert saved.get("state") == "Q1", saved.get("state")


@pytest.mark.asyncio
async def test_doc_request_with_no_pending_gate_unaffected(tmp_path):
    """Preservation: the widened gate entry is scoped to confirmation-fallthrough
    turns — a clean IDLE doc request still routes to the documentation path."""
    sv = _make_sv(str(tmp_path / "rte2b.db"))
    chat = "rte2-clean-doc"
    doc_spy = AsyncMock(return_value=sv._make_result("doc-lookup-called", "none", None, "IDLE"))
    sv._do_documentation_lookup = doc_spy

    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("find_documentation")),
    ):
        reply = await sv.process(chat, "do you have the manual for a PowerFlex 525?")

    assert doc_spy.await_count == 1, reply
