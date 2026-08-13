"""CTX-004 — deterministic repeated-answer guard.

A reply that is a near-duplicate of a recent assistant turn, when the
technician's question CHANGED, is caught post-generation: the guard grants
exactly one severed retry (fresh_thread_turn armed so the rebuilt prompt drops
the dead thread), and fails safe (reply still returned, logged) if the retry
repeats too. Repeating an answer because the technician re-asked the SAME
question is legitimate and never triggers the guard.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor, _find_repeated_answer  # noqa: E402

PRIOR_ANSWER = (
    "CE10 is a Modbus communication time-out. Check the RS-485 wiring at the "
    "drive terminals and verify parameter P09.03 is set to the expected "
    "time-out value. [Source: AutomationDirect GS10 Manual, p. 4-12]"
)


def _history():
    return [
        {"role": "user", "content": "What does CE10 mean on my GS10?"},
        {"role": "assistant", "content": PRIOR_ANSWER},
    ]


# ── Pure-function behavior ───────────────────────────────────────────────────


class TestFindRepeatedAnswer:
    def test_duplicate_with_changed_question_fires(self):
        assert _find_repeated_answer(PRIOR_ANSWER, "why does the conveyor surge?", _history())

    def test_duplicate_with_same_question_reasked_is_legitimate(self):
        assert not _find_repeated_answer(
            PRIOR_ANSWER, "what does CE10 mean on my GS10?", _history()
        )

    def test_different_reply_does_not_fire(self):
        fresh = (
            "Surging usually points to an unstable speed reference or PID "
            "tuning. Is the speed reference coming from the keypad or an "
            "analog input?"
        )
        assert not _find_repeated_answer(fresh, "why does the conveyor surge?", _history())

    def test_source_tag_differences_are_ignored(self):
        tweaked = PRIOR_ANSWER.replace(
            "[Source: AutomationDirect GS10 Manual, p. 4-12]",
            "[Source: AutomationDirect GS10 Manual, p. 7-2]",
        )
        assert _find_repeated_answer(tweaked, "why does the conveyor surge?", _history())

    def test_short_replies_never_fire(self):
        hist = [
            {"role": "user", "content": "status?"},
            {"role": "assistant", "content": "Understood."},
        ]
        assert not _find_repeated_answer("Understood.", "different question", hist)

    def test_empty_history_never_fires(self):
        assert not _find_repeated_answer(PRIOR_ANSWER, "anything", [])


# ── CTX-004b — a CONTAINED repeat, not just a duplicate ──────────────────────
#
# Campaign defect (B), caught live in c6 t2_000 (2026-08-09) on a run the
# scenario otherwise PASSED. After MIRA explains F004, "How do I reset it?" is
# answered by reproducing the ENTIRE previous reply verbatim as a prefix and
# appending one new sentence.
#
# The whole-reply similarity test cannot see it: measured on normalized text
# the ratio is 0.765, well under the 0.9 threshold. The perverse part is that
# appending MORE new text pushes the ratio DOWN — the more padding the model
# adds around a verbatim repeat, the safer that repeat is from the guard.
#
# Containment is the missing signal. It is deliberately fenced by a length
# floor AND a fraction, so quoting a short earlier line inside a genuinely new
# longer answer is not a repeat.

C6_PRIOR = (
    "F004 = UnderVoltage — the DC bus dropped below the minimum. Most common "
    "causes: low incoming line or a supply sag during start. Measure the "
    "incoming voltage at L1-L2-L3. "
    "[Source: Allen-Bradley PowerFlex 525, Fault Code Table]"
)
C6_REPEAT = (
    C6_PRIOR + "\n\nYou've asked about resetting a digital output. "
    "Is the digital output related to the UnderVoltage fault?"
)


def _c6_history():
    return [
        {"role": "user", "content": "What does F004 mean on a PowerFlex 525?"},
        {"role": "assistant", "content": C6_PRIOR},
    ]


class TestContainedRepeat:
    def test_prior_answer_repeated_verbatim_as_a_prefix_fires(self):
        """The live c6 t2_000 shape, byte-for-byte."""
        assert _find_repeated_answer(C6_REPEAT, "How do I reset it?", _c6_history())

    def test_the_similarity_test_alone_would_miss_it(self):
        """Pins WHY containment is needed: if this ever rises above 0.9 the
        containment branch is no longer load-bearing and this test says so."""
        import difflib

        from shared.engine import _REPEAT_REPLY_SIM, _normalize_reply_text

        ratio = difflib.SequenceMatcher(
            None, _normalize_reply_text(C6_REPEAT), _normalize_reply_text(C6_PRIOR)
        ).ratio()
        assert ratio < _REPEAT_REPLY_SIM, (
            f"ratio {ratio:.3f} now clears the threshold — re-check the guard"
        )

    def test_padding_a_repeat_does_not_buy_immunity(self):
        """The inverted incentive, stated as a test: appending MORE text lowers
        the similarity ratio, so a guard that only measures similarity gets
        weaker exactly as the padding grows. Containment must not."""
        padded = C6_REPEAT + " " + ("Also check the drive's input fusing. " * 3)
        assert _find_repeated_answer(padded, "How do I reset it?", _c6_history())

    def test_contained_repeat_with_the_same_question_reasked_is_legitimate(self):
        """The CTX-004 carve-out still governs: if the technician re-asks the
        SAME question, restating the answer is correct behaviour."""
        assert not _find_repeated_answer(
            C6_REPEAT, "What does F004 mean on a PowerFlex 525?", _c6_history()
        )

    def test_a_short_prior_quoted_inside_a_long_new_answer_does_not_fire(self):
        """Negative control. A brief earlier line re-used inside a substantially
        new, longer answer is elaboration, not repetition — the fraction floor
        keeps the guard off it."""
        short_prior = "CE10 is a Modbus communication time-out on the GS10 drive."
        hist = [
            {"role": "user", "content": "what is CE10?"},
            {"role": "assistant", "content": short_prior},
        ]
        elaborated = (
            short_prior + " To clear it, first confirm the RS-485 A/B pair is not "
            "swapped at the drive terminals, then check the shield is grounded at "
            "ONE end only. Verify P09.01 matches the master's baud rate and P09.02 "
            "matches its parity. If the master polls faster than P09.03 allows, "
            "raise the time-out or slow the poll. Finally, confirm the slave "
            "address is unique on the segment — two nodes at the same address "
            "produce exactly this fault intermittently."
        )
        assert not _find_repeated_answer(elaborated, "how do I fix it?", hist)


# ── Engine integration at the _call_with_correction seam ─────────────────────


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "guard.db")
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
    sup.nemotron = MagicMock()
    sup.nemotron.enabled = False  # isolate the guard's own retry grant
    sup._is_grounded = MagicMock(return_value=True)
    return sup


def _state():
    return {
        "state": "Q1",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 2,
        "context": {"history": _history(), "session_context": {}},
    }


def _mk_rag(replies, calls):
    """A rag.process stub returning canned raw replies; records the
    fresh_thread_turn flag visible at call time (and consumes it, as the
    real prompt builder does)."""

    async def rag_process(message, state, *args, **kwargs):
        ctx = state.get("context") or {}
        calls.append(bool(ctx.pop("fresh_thread_turn", False)))
        reply = replies[min(len(calls) - 1, len(replies) - 1)]
        return f'{{"reply": {reply!r}, "next_state": "Q1", "options": []}}'.replace("'", '"')

    return rag_process


FRESH_REPLY = (
    "Surging usually points to an unstable speed reference. Is the reference "
    "coming from the keypad or an analog input?"
)


@pytest.mark.asyncio
async def test_guard_retries_once_severed_and_returns_fresh_reply(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([PRIOR_ANSWER, FRESH_REPLY], calls)
    state = _state()

    _raw, parsed = await sv._call_with_correction("why does the conveyor surge?", state)

    assert "REPEATED_ANSWER_DETECTED" in caplog.text
    assert len(calls) == 2, "guard must grant exactly one severed retry"
    assert calls[1] is True, "retry attempt must run with fresh_thread_turn armed"
    assert "Surging" in parsed.get("reply", "")


@pytest.mark.asyncio
async def test_guard_fails_safe_when_retry_repeats_too(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([PRIOR_ANSWER, PRIOR_ANSWER], calls)
    state = _state()

    _raw, parsed = await sv._call_with_correction("why does the conveyor surge?", state)

    assert len(calls) == 2
    assert "REPEATED_ANSWER_UNRESOLVED" in caplog.text
    assert "CE10" in parsed.get("reply", ""), "fail-safe: the reply is still returned"


@pytest.mark.asyncio
async def test_same_question_reasked_no_guard_no_extra_call(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([PRIOR_ANSWER], calls)
    state = _state()

    await sv._call_with_correction("What does CE10 mean on my GS10?", state)

    assert len(calls) == 1, "legitimate repeat must not cost an extra LLM call"
    assert "REPEATED_ANSWER_DETECTED" not in caplog.text


@pytest.mark.asyncio
async def test_fresh_reply_no_guard_single_call(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([FRESH_REPLY], calls)
    state = _state()

    await sv._call_with_correction("why does the conveyor surge?", state)

    assert len(calls) == 1
    assert "REPEATED_ANSWER_DETECTED" not in caplog.text
