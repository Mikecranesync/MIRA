"""CIT-006 (#3165) — an asserted parameter must be supported by something.

Live on staging MIRA answered "How do I reset it?" with
``set P0594 = 1 [Source: Allen-Bradley PowerFlex 525, Parameter Reference]``.
P0594 exists nowhere in the corpus, yet every guard passed: `_is_grounded`
scores a bag-of-words overlap that generic prose clears, and
citation_compliance validates the attributed VENDOR, which was correct.

So the hole is specific: an invented SPECIFIC wearing a correctly-attributed
citation. This guard closes it at the one place that can see both the reply and
the turn's retrieved sources, and it fails safe — one corrective retry, then the
reply goes out regardless, because suppressing a CORRECT answer would be worse
than the defect.
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

from shared.engine import Supervisor, _find_unsupported_param_claims  # noqa: E402

SOURCES = [
    "Clear fault. Press Stop if P045 [Stop Mode] is set to a value between 0 and 3. "
    "Cycle drive power.",
    "A551 [Fault Clear] Resets a fault and clears the fault queue.",
]


class TestFindUnsupportedParamClaims:
    def test_the_live_p0594_fabrication_is_caught(self):
        reply = (
            "To reset digital output on Rockwell Automation 525, set P0594 = 1 "
            "[Source: Allen-Bradley PowerFlex 525, Parameter Reference]"
        )
        assert _find_unsupported_param_claims(reply, "How do I reset it?", [], SOURCES) == ["P0594"]

    def test_a_parameter_present_in_the_sources_is_supported(self):
        reply = "Press Stop if P045 [Stop Mode] is 0-3, or cycle power."
        assert _find_unsupported_param_claims(reply, "how do I reset it?", [], SOURCES) == []

    def test_a_parameter_the_technician_named_is_supported(self):
        reply = "Raise P09.03 — the Modbus time-out — above the master's poll interval."
        assert _find_unsupported_param_claims(reply, "what is P09.03 set to?", [], []) == []

    def test_a_parameter_established_earlier_in_the_conversation_is_supported(self):
        history = [{"role": "assistant", "content": "CE10 is a time-out governed by P09.03."}]
        reply = "Set P09.03 to 5.0 seconds."
        assert _find_unsupported_param_claims(reply, "what now?", history, []) == []

    def test_fault_codes_are_never_treated_as_parameter_claims(self):
        """F004/F111 legitimately arrive from uns_context with no chunk behind
        them — treating them as claims would fire on every fault conversation."""
        reply = "F004 = UnderVoltage. Related: F111 Safety Hardware."
        assert _find_unsupported_param_claims(reply, "what does F004 mean?", [], []) == []

    def test_a_token_only_inside_a_source_label_is_attribution_not_a_claim(self):
        reply = "Cycle drive power. [Source: AutomationDirect GS10 P09.03 Table]"
        assert _find_unsupported_param_claims(reply, "how do I clear it?", [], []) == []

    def test_no_parameters_means_nothing_to_check(self):
        reply = "Cycle drive power, then confirm the incoming supply at L1-L2-L3."
        assert _find_unsupported_param_claims(reply, "how do I reset it?", [], []) == []


# ── Engine integration: one corrective retry, then fail safe ─────────────────


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "param.db")
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
    return sup


def _state():
    return {"state": "Q1", "context": {"history": [], "session_context": {}, "uns_context": {}}}


def _mk_rag(replies, calls):
    async def rag(message, state, *args, **kwargs):
        calls.append(message)
        idx = min(len(calls) - 1, len(replies) - 1)
        return '{"reply": %s, "next_state": "Q1", "confidence": "MEDIUM"}' % (
            __import__("json").dumps(replies[idx])
        )

    return rag


FABRICATED = "To reset the output on the 525, set P0594 = 1."
CORRECTED = "Press Stop if P045 [Stop Mode] is 0-3, or cycle drive power."


@pytest.mark.asyncio
async def test_unsupported_claim_triggers_exactly_one_retry(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([FABRICATED, CORRECTED], calls)

    _, parsed = await sv._call_with_correction("How do I reset it?", _state())

    assert "UNSUPPORTED_PARAM_CLAIM_DETECTED" in caplog.text
    assert len(calls) == 2, "exactly one corrective retry"
    assert "P0594" not in parsed.get("reply", "")


@pytest.mark.asyncio
async def test_a_repeat_offender_fails_safe_and_is_still_returned(sv, caplog):
    """Fail-safe: if the retry invents it again the reply is returned, loudly.
    Withholding an answer is not this guard's job."""
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([FABRICATED], calls)

    _, parsed = await sv._call_with_correction("How do I reset it?", _state())

    assert "UNSUPPORTED_PARAM_CLAIM_UNRESOLVED" in caplog.text
    assert "P0594" in parsed.get("reply", ""), "fail-safe: the reply is still returned"


@pytest.mark.asyncio
async def test_a_supported_answer_costs_no_extra_call(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([CORRECTED], calls)
    state = _state()
    state["context"]["history"] = [{"role": "assistant", "content": SOURCES[0]}]

    await sv._call_with_correction("How do I reset it?", state)

    assert len(calls) == 1, "a grounded answer must not pay for a retry"
    assert "UNSUPPORTED_PARAM_CLAIM_DETECTED" not in caplog.text
