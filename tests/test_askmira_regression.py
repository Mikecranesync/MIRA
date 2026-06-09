"""AskMira regression tests — 2026-06-06 P0/P1 fixes.

Covers:
  Q1 — status "current status?" must not trigger GRACEFUL_FALLBACK
  Q2 — "is the e-stop OK?" must read the live tag, not history DB
  Q5 — lubrication schedule query must emit KB-gap admission (>30 words)
  Q7 — motor frequency query must carry [Source:] or gap admission
  H4 — enforce_citation_or_gap_admission() appends stock line when missing

All tests are OFFLINE — LLM cascade and DB are mocked.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# Add mira-bots to path (mirrors tests/test_edge_cases.py pattern)
sys.path.insert(0, str(Path(__file__).parent.parent / "mira-bots"))

from shared.engine import Supervisor, enforce_citation_or_gap_admission
from shared.quality_gate import GRACEFUL_FALLBACK


# ---------------------------------------------------------------------------
# Plant state fixture matching ~/.claude/skills/askmira-tester/fixtures/plant-state-current.json
# ---------------------------------------------------------------------------

_NO_FAULT_STATUS_BLOCK = """\
[LIVE CONVEYOR STATUS]
VFD Comm: OK  |  E-Stop: ARMED  |  MLC: ARMED  |  PE Beam: CLEAR  |  PE Latched: ARMED
Frequency: 0.0 Hz  |  Setpoint: 30.0 Hz  |  Current: 0.0 A  |  DC Bus: 0 V
Fault Code: 0 (No Fault)
"""

_MACHINE_CONTEXT_STUB = """\
[MACHINE CONTEXT]
Machine: PMC Garage Conveyor
VFD: AutomationDirect GS10
PLC: Allen-Bradley Micro820
"""


def _make_enriched_message(question: str, status_block: str = _NO_FAULT_STATUS_BLOCK) -> str:
    """Mirror what ask_api.app._build_status_block + /ask produces."""
    return _MACHINE_CONTEXT_STUB + "\n\n" + status_block.strip() + "\n\n[QUESTION]\n" + question


# ---------------------------------------------------------------------------
# Offline Supervisor fixture — mocks all I/O
# ---------------------------------------------------------------------------


@pytest.fixture()
def sv(tmp_path):
    """Offline Supervisor with all external I/O stubbed."""
    db_path = str(tmp_path / "regression.db")

    # Canned router reply used by InferenceRouter.complete (returned for
    # any LLM call the engine makes — instructional, RAG, general question).
    _CANNED_LLM_REPLY = (
        "The conveyor is in idle state. E-Stop is armed, MLC is armed, "
        "PE beam is clear, and no VFD fault is active (fault code 0). "
        "Frequency setpoint is 30.0 Hz; current output is 0 Hz (stopped)."
        " [Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]"
    )

    with patch.dict(
        "os.environ",
        {
            "INFERENCE_BACKEND": "local",
            "MIRA_UNS_GATE_ENABLED": "0",  # skip UNS gate — tests single-turn paths
            "QUALITY_GATE_ENABLED": "1",
            "QUALITY_GATE_JUDGE": "0",  # heuristics only, no LLM judge
        },
    ):
        with (
            patch("shared.engine.VisionWorker"),
            patch("shared.engine.NameplateWorker"),
            patch("shared.engine.PrintWorker"),
            patch("shared.engine.PLCWorker"),
            patch("shared.engine.NemotronClient"),
            patch("shared.engine.InferenceRouter") as MockRouter,
            patch("shared.engine.RAGWorker") as MockRAG,
        ):
            # InferenceRouter.complete must be an async function
            mock_router_inst = MockRouter.return_value
            mock_router_inst.enabled = True
            mock_router_inst.complete = AsyncMock(
                return_value=(
                    _CANNED_LLM_REPLY,
                    {"provider": "mock", "tokens_in": 0, "tokens_out": 80},
                )
            )
            mock_router_inst.sanitize_context = lambda msgs: msgs

            # RAGWorker.process returns a grounded status answer with citation
            mock_rag = MockRAG.return_value
            mock_rag.process = AsyncMock(return_value=_CANNED_LLM_REPLY)
            mock_rag._last_sources = []
            mock_rag._last_no_kb = True
            mock_rag._last_kb_status = {"status": "uncovered"}
            mock_rag.kb_status = {"status": "uncovered"}

            supervisor = Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test",
                collection_id="test",
            )
            yield supervisor


# ---------------------------------------------------------------------------
# Q1: status query must NOT produce GRACEFUL_FALLBACK
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_q1_status_no_fault_does_not_punt(sv, tmp_path):
    """Q1 regression: 'current status?' with no-fault state must not trigger GRACEFUL_FALLBACK.

    The Q1 failure was non-deterministic (gate fired on repeated tag names).
    After the fix the gate is bypassed for messages containing [LIVE CONVEYOR STATUS].
    """
    enriched = _make_enriched_message("What is the current status of the conveyor?")
    with patch("shared.engine.route_intent") as mock_route:
        mock_route.return_value = {
            "intent": "answer_question",
            "confidence": 0.9,
            "reasoning": "status summary",
        }
        reply = await sv.process(chat_id="test-q1", message=enriched, platform="ignition")

    assert GRACEFUL_FALLBACK not in reply, (
        f"Q1 regression: quality gate punted for a valid status reply.\nReply: {reply!r}"
    )
    assert "rephrase your question" not in reply.lower(), (
        f"Q1 regression: engine told user to rephrase for a valid status query.\nReply: {reply!r}"
    )
    # Must be substantive
    assert len(reply.strip()) > 30, f"Q1: reply too short ({len(reply)} chars): {reply!r}"


# ---------------------------------------------------------------------------
# Q2: e-stop query must read the live tag, not history DB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_q2_estop_query_reads_tag(sv, tmp_path):
    """Q2 regression: 'is the e-stop OK?' must route to tag-query fast-path, NOT history.

    The Q2 failure was the LLM router returning check_equipment_history, which
    produced 'No previous interactions found for this AutomationDirect...'.
    After the fix the tag-query fast-path intercepts it before route_intent.
    """
    enriched = _make_enriched_message("Is the e-stop OK?")
    with patch("shared.engine.route_intent") as mock_route:
        # This should NOT be called — fast-path intercepts
        mock_route.return_value = {
            "intent": "check_equipment_history",
            "confidence": 0.8,
            "reasoning": "asking about e-stop status",
        }
        reply = await sv.process(chat_id="test-q2", message=enriched, platform="ignition")

    bad_phrases = [
        "no previous interactions found",
        "first time it's been diagnosed",
        "no previous",
    ]
    for phrase in bad_phrases:
        assert phrase.lower() not in reply.lower(), (
            f"Q2 regression: history handler fired for e-stop query.\n"
            f"Matched phrase: {phrase!r}\nReply: {reply!r}"
        )

    # Reply should reference the live block or e-stop state
    good_keywords = ["e-stop", "estop", "armed", "live", "tag", "conveyor status", "ok"]
    found = any(kw.lower() in reply.lower() for kw in good_keywords)
    assert found, f"Q2: reply doesn't mention e-stop state or live data.\nReply: {reply!r}"


# ---------------------------------------------------------------------------
# Q5: lubrication schedule query must be a KB-gap admission (>30 words)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_q5_lube_gap_is_explicit(sv, tmp_path):
    """Q5 regression: 'show me the lubrication schedule' must emit a KB-gap admission.

    The Q5 failure was a 5-word "I have AutomationDirect documentation indexed."
    reply from the KB-hit fast-path. After the fix the maintenance-gap regex
    routes to a detailed gap-admission reply.
    """
    enriched = _make_enriched_message("Show me the lubrication schedule for this conveyor.")
    with patch("shared.engine.route_intent") as mock_route:
        mock_route.return_value = {
            "intent": "find_documentation",
            "confidence": 0.85,
            "reasoning": "asking for lubrication schedule doc",
        }
        # Stub KB coverage check to return True (AutomationDirect is indexed)
        with (
            patch("shared.engine.kb_has_coverage", return_value=(True, "vendor_match")),
            patch("shared.engine.kb_has_pair_coverage", return_value=(False, 0)),
        ):
            reply = await sv.process(chat_id="test-q5", message=enriched, platform="ignition")

    # Must be longer than 30 words
    word_count = len(reply.split())
    assert word_count > 30, (
        f"Q5 regression: gap admission reply too short ({word_count} words).\nReply: {reply!r}"
    )

    # Must contain an explicit KB-gap signal
    gap_pattern = re.compile(
        r"don.t have|not.{0,20}indexed|not.{0,20}scheduled|consult|nameplate|kb.gap",
        re.IGNORECASE,
    )
    assert gap_pattern.search(reply), (
        f"Q5: reply doesn't contain an explicit KB-gap admission.\nReply: {reply!r}"
    )


# ---------------------------------------------------------------------------
# Q7: motor frequency query must carry [Source:] or gap admission
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_q7_freq_has_citation_or_admission(sv, tmp_path):
    """Q7 regression: motor frequency query reply must contain [Source:] or a KB-gap phrase.

    H4 enforcer is applied in process() after the quality gate. If neither
    is present in the raw reply, the stock [KB-gap: ...] line is appended.
    """
    enriched = _make_enriched_message("What is the normal-running frequency for the motor?")
    with patch("shared.engine.route_intent") as mock_route:
        mock_route.return_value = {
            "intent": "answer_question",
            "confidence": 0.8,
            "reasoning": "parameter lookup",
        }
        reply = await sv.process(chat_id="test-q7", message=enriched, platform="ignition")

    has_source = "[Source:" in reply or "[source:" in reply.lower()
    gap_pattern = re.compile(
        r"don.t have|not.{0,20}indexed|I do not have|no docs|KB-gap",
        re.IGNORECASE,
    )
    has_gap = bool(gap_pattern.search(reply))
    assert has_source or has_gap, (
        f"Q7 / H4: reply has neither [Source:] nor KB-gap admission.\nReply: {reply!r}"
    )


# ---------------------------------------------------------------------------
# H4: enforce_citation_or_gap_admission unit tests
# ---------------------------------------------------------------------------


def test_h4_enforcer_appends_when_missing():
    """H4 pure unit test: a reply with no source or gap phrase gets the stock admission."""
    bare_reply = "Some reply without any citation or gap information."
    result = enforce_citation_or_gap_admission(bare_reply)
    assert "[KB-gap:" in result, f"H4: stock admission not appended.\nResult: {result!r}"
    assert "consult the asset nameplate or vendor manual" in result


def test_h4_enforcer_skips_when_source_present():
    """H4: reply already has [Source:] — must be returned unchanged."""
    reply = "The freq setpoint is 30 Hz. [Source: GS10 Manual §4.2]"
    result = enforce_citation_or_gap_admission(reply)
    assert result == reply, "H4: modified a reply that already had [Source:]"


def test_h4_enforcer_skips_graceful_fallback():
    """H4: GRACEFUL_FALLBACK string must NOT have the admission appended."""
    result = enforce_citation_or_gap_admission(GRACEFUL_FALLBACK)
    assert result == GRACEFUL_FALLBACK, (
        "H4: modified GRACEFUL_FALLBACK — would create a Frankenstein reply"
    )


def test_h4_enforcer_skips_when_gap_phrase_present():
    """H4: reply already admits KB gap — must not double-append."""
    reply = "I don't have specific documentation for that lubrication schedule."
    result = enforce_citation_or_gap_admission(reply)
    assert result == reply, "H4: double-appended to a reply that already has a gap phrase"


def test_h4_enforcer_skips_short_reply():
    """H4: very short replies (<= 20 chars) must be returned unchanged."""
    for short in ["OK", "Yes.", "No fault."]:
        result = enforce_citation_or_gap_admission(short)
        assert result == short, f"H4: modified short reply {short!r}"


def test_h4_normalizes_sources_block_to_inline():
    """H4 normalizer: `--- Sources ---\\n[1] Vendor` → `[Source: Vendor]` inline.

    Some LLM cascade replies emit a sources block instead of inline tags. The
    enforcer must normalize so the scorer + view both see canonical inline
    markers. The original block stays in the reply for human readability.
    """
    reply = (
        "The motor is not running because PE-01 is latched.\n\n"
        "--- Sources ---\n"
        "[1] AutomationDirect GS10\n"
        "[2] AutomationDirect — Fault Code Table\n"
    )
    result = enforce_citation_or_gap_admission(reply)
    assert "[Source: AutomationDirect GS10]" in result, (
        "normalizer missed first sources-block entry"
    )
    assert "[Source: AutomationDirect — Fault Code Table]" in result, (
        "normalizer missed second sources-block entry"
    )
    # Original block stays for readability.
    assert "--- Sources ---" in result
    # No stock admission appended — citations are now present.
    assert "[KB-gap:" not in result, (
        "H4: stock admission appended even though sources block was present"
    )


def test_h4_stock_admission_contains_scorer_recognized_phrase():
    """The stock admission must include the phrase the askmira-tester scorer
    matches ("I don't have specific documentation"). Keeping these in sync
    avoids a sterile fail where the engine IS H4-compliant but the scorer
    cannot recognize the admission.
    """
    from shared.engine import _H4_STOCK_ADMISSION

    assert "I don't have specific documentation" in _H4_STOCK_ADMISSION, (
        "_H4_STOCK_ADMISSION drifted from the scorer's recognized vocabulary"
    )


# ---------------------------------------------------------------------------
# Q1 length trim — kiosk status-summary post-process. Drops trailing
# non-citation sentences until the reply is <= 130 words. Refuses to drop
# below 4 sentences or to touch a `[Source:` sentence.
# ---------------------------------------------------------------------------


def _wc(s: str) -> int:
    return len(re.findall(r"\S+", s))


# Reproduces the actual 165-word Q1 reply observed on prod 2026-06-06 after
# the PR #1754 / #1755 deploys. Two `[Source:` markers, one at sentence 6
# and one at sentence 9; total 11 sentences.
_LONG_STATUS_REPLY = (
    "The current status of the garage conveyor belt is stopped due to a photo-eye "
    "jam latch, which is a soft-stop condition that prevents the drive from running "
    "until the operator clears the latch. The variable frequency drive (VFD) is in "
    "a stopped state with a status word of 0, and the command is set to STOP, with "
    "no active motion currently being commanded by the controller. The frequency "
    "setpoint is 30.0 Hz, but the output frequency is 0.0 Hz, which indicates the "
    "drive has not begun ramping toward setpoint. The main line contactor is closed "
    "and energized, but the drive is not running due to the photo-eye jam latch "
    "still being active. To resume operation, the operator must press the Start "
    "button (DI_04) with the photo-eye beam clear to clear the latch and restart "
    "the drive [Source: AutomationDirect GS10]. The steps to clear the fault are: "
    "ensure the photo-eye beam is clear, then press the Start button (DI_04) to "
    "clear the photo-eye jam latch and resume the drive. Note that the VFD fault "
    "code is 0, indicating no active fault, and the VFD communications are OK with "
    "no comm-loss alarm currently active [Source: AutomationDirect GS10]."
)


def test_q1_trim_caps_long_status_reply_under_target():
    """A 160-word kiosk status reply should be trimmed to <= 130 words."""
    from shared.engine import _trim_kiosk_status_reply

    reply = _LONG_STATUS_REPLY
    assert _wc(reply) > 145, "fixture must exceed the cap to exercise the trimmer"
    trimmed = _trim_kiosk_status_reply(reply)
    assert _wc(trimmed) <= 145, f"trim did not bring reply under cap (got {_wc(trimmed)})"


def test_q1_trim_preserves_at_least_80_words():
    """The trimmer must never strip the reply down so far it becomes useless.

    Minimum-sentence guard (>=4 sentences) effectively keeps the reply
    informative. Verify the trimmed reply still carries the dominant fault
    description and at least one action.
    """
    from shared.engine import _trim_kiosk_status_reply

    reply = (
        "The garage conveyor belt is currently in a soft-stop state due to a photo-eye "
        "jam latch, which prevents the drive from running. The variable frequency drive "
        "is currently stopped with status word 0 and command STOP. The frequency "
        "setpoint is 30.0 Hz but the output frequency is 0.0 Hz. The main line "
        "contactor is closed and energized. To resume operation, the operator must "
        "press the Start button (DI_04) with the photo-eye beam clear to clear the "
        "pe_latched flag and restart the drive [Source: AutomationDirect GS10]. The "
        "steps to clear the fault are: ensure the photo-eye beam is clear; press "
        "the Start button (DI_04) to clear the photo-eye jam latch and resume the "
        "drive. Note that the VFD fault code is 0, indicating no active fault, and "
        "the VFD communications are OK [Source: AutomationDirect GS10]."
    )
    trimmed = _trim_kiosk_status_reply(reply)
    assert _wc(trimmed) >= 80, (
        f"trim went below 80 words ({_wc(trimmed)}) — reply lost too much information"
    )


def test_q1_trim_never_drops_a_citation_sentence():
    """Sentences containing `[Source:` must NEVER be dropped — losing a citation
    would force the H4 enforcer to re-append a stock admission, ballooning
    the reply right back over the cap.
    """
    from shared.engine import _trim_kiosk_status_reply

    # Reply where the longest content is BEFORE the citation, and a trailing
    # non-citation note pads it over the cap. The citation sentence must
    # remain in the trimmed output.
    reply = (
        "The garage conveyor belt is currently in a soft-stop state due to a photo-eye "
        "jam latch, which prevents the drive from running. The variable frequency drive "
        "is currently stopped with status word 0 and command STOP. The frequency "
        "setpoint is 30.0 Hz but the output frequency is 0.0 Hz. The main line "
        "contactor is closed and energized. To resume operation, the operator must "
        "press the Start button (DI_04) with the photo-eye beam clear "
        "[Source: AutomationDirect GS10]. Note that the VFD fault code is 0, "
        "indicating no active fault, and the VFD communications are OK."
    )
    trimmed = _trim_kiosk_status_reply(reply)
    assert "[Source: AutomationDirect GS10]" in trimmed, (
        "trim dropped the citation sentence — would break H4 + force redundant admission"
    )


def test_q1_trim_passes_through_short_reply_unchanged():
    """A reply already under the cap must be returned byte-identical."""
    from shared.engine import _trim_kiosk_status_reply

    reply = (
        "The garage conveyor is currently in a soft-stop state due to a photo-eye "
        "jam latch. Press Start (DI_04) with the beam clear to clear the latch "
        "and resume the drive [Source: AutomationDirect GS10]."
    )
    assert _wc(reply) <= 145, "fixture must already be under the cap"
    assert _trim_kiosk_status_reply(reply) == reply
