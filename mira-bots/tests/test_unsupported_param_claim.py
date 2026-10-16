"""CIT-006 (#3165) — an asserted parameter must be supported by something.

Live on staging MIRA answered "How do I reset it?" with
``set P0594 = 1 [Source: Allen-Bradley PowerFlex 525, Parameter Reference]``.
P0594 exists nowhere in the corpus, yet every guard passed: `_is_grounded`
scores a bag-of-words overlap that generic prose clears, and
citation_compliance validates the attributed VENDOR, which was correct.

CIT-006 now requires applicable passages and the asserted values/units. One
corrective retry is allowed; unresolved sentences are removed before delivery.
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

    def test_a_user_question_does_not_authorize_parameter_adjustment(self):
        reply = "Raise P09.03 — the Modbus time-out — above the master's poll interval."
        assert _find_unsupported_param_claims(reply, "what is P09.03 set to?", [], []) == ["P09.03"]

    def test_assistant_history_cannot_authorize_parameter_adjustment(self):
        history = [{"role": "assistant", "content": "CE10 is a time-out governed by P09.03."}]
        reply = "Set P09.03 to 5.0 seconds."
        assert _find_unsupported_param_claims(reply, "what now?", history, []) == ["P09.03"]

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
        state["_rag_last_chunks"] = [
            {"content": x, "evidence_applicability": "model"} for x in SOURCES
        ]
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
async def test_a_repeat_offender_cannot_deliver_unsupported_setting(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag([FABRICATED], calls)

    _, parsed = await sv._call_with_correction("How do I reset it?", _state())

    assert "UNSUPPORTED_PARAM_CLAIM_UNRESOLVED" in caplog.text
    assert "P0594" not in parsed.get("reply", ""), "unsupported instruction must be withheld"


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


@pytest.mark.parametrize(
    "reply,passage,want",
    [
        (
            "Increase P3.00 from 10s to 20–30s.",
            "P3.00 is acceleration time, default 10s.",
            ["P3.00"],
        ),
        ("Set E-01 to 400 V.", "E-01 is not documented here.", ["E-01"]),
        ("Set E-01 to 400 V.", "Set E-01 to 400V for this motor.", []),
        ("Set P09.03 to 20 seconds.", "Set P09.03 to 10 seconds.", ["P09.03"]),
        ("Set P09.03 to 10 seconds.", "Set P09.03 to 10 milliseconds.", ["P09.03"]),
        ("Do not change P3.00 without the manual.", "", []),
        ('You reported "P3.00 is 10s".', "", []),
        ("What is P3.00 currently set to?", "", []),
        ("Compare P3.00 with P09.03 in the manual.", "", []),
        ("F004 is the active fault code.", "", []),
    ],
)
def test_parameter_value_and_units_need_same_applicable_passage(reply, passage, want):
    rows = [{"content": passage, "evidence_applicability": "model"}]
    assert _find_unsupported_param_claims(reply, "P3.00 is 10s", [], rows) == want


def test_unknown_model_and_source_metadata_cannot_support_setting():
    rows = [
        {
            "content": "Set P09.03 to 5 seconds.",
            "evidence_applicability": "unknown",
            "title": "Set P09.03 to 5 seconds.",
        }
    ]
    assert _find_unsupported_param_claims("Set P09.03 to 5 seconds.", "", [], rows) == ["P09.03"]


@pytest.mark.asyncio
async def test_repeat_offender_keeps_general_guidance_and_no_load_fact(sv):
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag(
        [
            "Increase P3.00 from 10s to 20–30s. The motor is disconnected. "
            "Record the displayed fault and when it occurs."
        ],
        calls,
    )
    _, parsed = await sv._call_with_correction("There is no load connected.", _state())
    assert "P3.00" not in parsed["reply"]
    assert "motor is disconnected" not in parsed["reply"]
    assert "Record the displayed fault" in parsed["reply"]


@pytest.mark.asyncio
async def test_photo_reply_also_cannot_prescribe_unsupported_settings(sv):
    calls = []
    sv.rag = MagicMock()
    sv.rag.process = _mk_rag(["Set P0594 = 1."], calls)
    _, parsed = await sv._call_with_correction("Reset?", _state(), photo_b64="test")
    assert "P0594" not in parsed["reply"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["", "session_followup"])
async def test_final_delivery_removes_late_reintroduced_setting(sv, kind):
    from unittest.mock import AsyncMock

    result = {
        "reply": "Record the fault.",
        "dispatch_kind": kind,
        "next_state": "Q1",
        "_citation_evidence": {"chunks": []},
    }
    late = "Set P3.00 to 30 seconds. Record the fault."
    with (
        patch.dict("os.environ", {"MIRA_ANSWER_QC": "off"}),
        patch.object(sv, "process_full", AsyncMock(return_value=result)),
        patch.object(sv, "_apply_quality_gate", AsyncMock(return_value="Record the fault.")),
        patch.object(sv, "_enforce_citation_rewrite", AsyncMock(return_value=late)),
        patch.object(sv, "_log_interaction"),
        patch.object(sv, "_schedule_decision_trace"),
    ):
        delivered = await sv.process("claims-final", "No load connected.")
    assert "P3.00" not in delivered
    assert "Record the fault." in delivered


@pytest.mark.parametrize(
    "reply,message,rejected",
    [
        (
            "Extend P3.00 accel time from 10s to 20-30s and retry.",
            "Centrifugal pump on factory defaults",
            "P3.00",
        ),
        (
            "Check parameter E-01 to ensure dynamic braking is set correctly.",
            "Yaskawa A1000 OV during decel",
            "E-01",
        ),
        (
            "Motor is disconnected on startup. Did the OC still trip with the output wires off?",
            "Motor is 5HP 460V three-phase, no load connected during startup test",
            "Motor is disconnected",
        ),
    ],
)
def test_saved_benchmark_claims_are_not_delivered_without_evidence(reply, message, rejected):
    from shared.engine import _sanitize_claim_support

    delivered = _sanitize_claim_support(reply, message, [], [])
    assert rejected not in delivered


@pytest.mark.parametrize(
    "reply,source",
    [
        ("Could you set P3.00 to 30s?", ""),
        ("Disable P03.", "Enable P03."),
        ("Set P03 to -10V.", "Set P03 to 10V."),
        ("Set P03 to 20-30s.", "Set P03 to 20V and 30s."),
        ('You reported "P3.00 is 10s".', ""),
    ],
)
def test_questions_reports_actions_and_signed_values_cannot_launder_support(reply, source):
    assert _find_unsupported_param_claims(reply, "What now?", [], [source])


def test_invented_disconnection_report_is_removed():
    from shared.engine import _sanitize_claim_support

    result = _sanitize_claim_support(
        "You reported motor disconnected.", "No load connected.", [], []
    )
    assert "You reported motor disconnected" not in result


def test_supported_family_value_and_real_disconnection_survive():
    from shared.engine import _sanitize_claim_support

    reply = "Set E-01 to 400 V. Motor is disconnected."
    chunks = [{"text": "Set E-01 to 400V.", "evidence_applicability": "family"}]
    assert _sanitize_claim_support(reply, "Motor is disconnected.", [], chunks) == reply


def test_claim_sanitization_is_idempotent():
    from shared.engine import _sanitize_claim_support

    once = _sanitize_claim_support("Set P3.00 to 30s. Record the fault.", "", [], [])
    assert _sanitize_claim_support(once, "", [], []) == once


def test_source_condition_cannot_be_dropped_from_instruction():
    rows = [
        {
            "text": "Set P03 to 10V only when the motor is isolated.",
            "evidence_applicability": "model",
        }
    ]
    assert _find_unsupported_param_claims("Set P03 to 10V.", "", [], rows) == ["P03"]
    assert (
        _find_unsupported_param_claims(
            "Set P03 to 10V only when the motor is isolated.", "", [], rows
        )
        == []
    )


@pytest.mark.parametrize(
    "reply", ["Yaskawa A1000 OV occurs during deceleration.", "Check the Yaskawa A1000 nameplate."]
)
def test_equipment_model_reference_is_not_parameter_assertion(reply):
    assert _find_unsupported_param_claims(reply, "Yaskawa A1000", [], []) == []


@pytest.mark.parametrize(
    "reply",
    [
        "Set acceleration time to 30 seconds.",
        "Increase the deceleration ramp to 20-30s.",
        "The default acceleration time is 10 seconds.",
    ],
)
def test_setting_without_parameter_code_still_needs_applicable_source(reply):
    from shared.engine import _sanitize_claim_support

    assert reply not in _sanitize_claim_support(reply, "Startup fault.", [], [])


def test_documented_named_setting_survives_and_measurement_is_not_setting():
    from shared.engine import _sanitize_claim_support

    reply = "Set acceleration time to 30 seconds."
    chunks = [{"text": reply, "evidence_applicability": "model"}]
    assert _sanitize_claim_support(reply, "", [], chunks) == reply
    measured = "Record the input voltage, for example 400 V."
    assert _sanitize_claim_support(measured, "", [], []) == measured


@pytest.mark.parametrize(
    "reply",
    ["Default is 10 seconds. Increase it to 20-30 seconds.", "Increase it to 20-30 seconds."],
)
def test_unresolved_numeric_setting_references_cannot_escape(reply):
    from shared.engine import _sanitize_claim_support

    delivered = _sanitize_claim_support(reply, "Startup fault.", [], [])
    assert "20-30" not in delivered
    assert "10 seconds" not in delivered


@pytest.mark.parametrize(
    "user",
    [
        "Is motor disconnected?",
        "If motor is disconnected, what next?",
        "The motor might be disconnected.",
    ],
)
def test_uncertain_user_wiring_statement_is_not_verified_disconnection(user):
    from shared.engine import _sanitize_claim_support

    assert "Motor is disconnected." not in _sanitize_claim_support(
        "Motor is disconnected.", user, [], []
    )


def test_model_name_cannot_hide_a_numeric_setting():
    from shared.engine import _sanitize_claim_support

    reply = "Set acceleration time on the Yaskawa A1000 to 30 seconds."
    assert reply not in _sanitize_claim_support(reply, "A1000 startup fault", [], [])


@pytest.mark.parametrize("token", ["A09", "C03", "D02"])
def test_article_does_not_hide_parameter_action(token):
    reply = f"Disable the {token} parameter."
    assert _find_unsupported_param_claims(reply, "What next?", [], [])
    rows = [{"content": reply, "evidence_applicability": "model"}]
    assert _find_unsupported_param_claims(reply, "What next?", [], rows) == []


def test_supported_parameter_value_with_article_is_retained():
    reply = "Set the A09 parameter to 10."
    rows = [{"content": "Set A09 to 10.", "evidence_applicability": "model"}]
    assert _find_unsupported_param_claims(reply, "What next?", [], rows) == []


@pytest.mark.parametrize("suffix", [" (step 2 of 3)", " (see item 2)", " (see steps 2 and 3)"])
def test_incidental_step_reference_does_not_change_supported_values(suffix):
    reply = "Increase P3.00 from 10s to 20s" + suffix + "."
    rows = [{"content": "Increase P3.00 from 10s to 20s.", "evidence_applicability": "model"}]
    assert _find_unsupported_param_claims(reply, "What next?", [], rows) == []


@pytest.mark.parametrize("value", ["2", "3", "23"])
def test_real_unitless_settings_are_not_incidental_step_counts(value):
    rows = [{"content": "Set A09 to 1.", "evidence_applicability": "model"}]
    assert _find_unsupported_param_claims(f"Set A09 to {value} (see item 2).", "", [], rows)


def test_step_reference_does_not_license_unsupported_start_value():
    rows = [{"content": "Increase P3.00 to 20s.", "evidence_applicability": "model"}]
    reply = "Increase P3.00 from 10s to 20s (step 2 of 3)."
    assert _find_unsupported_param_claims(reply, "What next?", [], rows) == ["P3.00"]


def test_model_parameter_list_reference_is_not_parameter_setting():
    reply = "Read the Yaskawa A1000 parameter list."
    assert _find_unsupported_param_claims(reply, "A1000 manual?", [], []) == []
