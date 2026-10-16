"""Frozen delivered replies at raw recall -> RAG -> public process boundaries.

Only external I/O/generation is mocked. Applicability is computed by the real
RAGWorker; no fixture supplies evidence_applicability. Drive-pack fast paths are
disabled so these tests deliberately exercise the generative benchmark path.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared import engine
from shared.workers.rag_worker import RAGWorker

RECORDINGS = json.loads(
    (Path(__file__).parent / "fixtures/answer_quality_recordings.json").read_text()
)["cases"]


def raw_row(content, vendor="", model=""):
    return {
        "content": content,
        "manufacturer": vendor,
        "model_number": model,
        "metadata": {"section": "Fault Code Table"},
        "retrieval_streams": ["bm25"],
        "similarity": 1.0,
    }


@pytest.fixture
def harness(tmp_path, monkeypatch):
    monkeypatch.setenv("INFERENCE_BACKEND", "local")
    monkeypatch.setenv("MIRA_CITATION_ENFORCE", "1")
    monkeypatch.setenv("MIRA_CITATION_REWRITE", "0")
    monkeypatch.setenv("MIRA_ANSWER_QC", "off")
    monkeypatch.setattr(engine, "_CRITIQUE_DISABLED", True)
    monkeypatch.setattr(engine, "resolve_pack", lambda text: None)
    monkeypatch.setattr(
        engine,
        "route_intent",
        AsyncMock(return_value={"intent": "continue_current", "confidence": 0.95}),
    )
    with (
        patch("shared.engine.VisionWorker"),
        patch("shared.engine.NameplateWorker"),
        patch("shared.engine.PrintWorker"),
        patch("shared.engine.PLCWorker"),
        patch("shared.engine.NemotronClient"),
        patch("shared.engine.InferenceRouter"),
    ):
        sup = engine.Supervisor(
            str(tmp_path / "integrated.db"), "http://test", "test", "test", tenant_id="tenant-a"
        )
    sup.router.enabled = False
    sup.nemotron.enabled = False
    sup.rag = RAGWorker("http://test", "test", "test", router=sup.router, tenant_id="tenant-a")
    sup.rag._ingest_url = ""
    monkeypatch.setattr(sup.rag, "_embed_ollama", AsyncMock(return_value=None))
    for name in [
        "_build_kg_context",
        "_build_live_data_context",
        "_build_ctx_signals_context",
        "_build_interlock_context",
        "_build_wo_evidence_context",
        "_build_prior_decisions_context",
    ]:
        monkeypatch.setattr(sup, name, AsyncMock(return_value=""))
    monkeypatch.setattr(sup, "_schedule_decision_trace", MagicMock())
    monkeypatch.setattr(sup, "_schedule_session_lifecycle", MagicMock())
    monkeypatch.setattr(
        sup, "_apply_quality_gate", AsyncMock(side_effect=lambda chat, message, reply, **kw: reply)
    )
    prompts = []

    def seed(chat, vendor, model, history=None):
        sup._save_state(
            chat,
            {
                "state": "Q2",
                "asset_identified": f"{vendor} {model}",
                "exchange_count": 2,
                "context": {
                    "uns_context": {"manufacturer": vendor, "model": model, "confidence": 0.9},
                    "session_context": {},
                    "history": history or [],
                },
            },
        )

    async def run(
        case,
        rows,
        vendor="AutomationDirect",
        model="GS20",
        draft=None,
        chat="recording",
        tenant="tenant-a",
        next_state="Q2",
    ):
        seed(chat, vendor, model)

        async def llm(messages, model=None):
            prompts.append(str(messages))
            return json.dumps(
                {
                    "reply": draft or case["bot_response"],
                    "next_state": next_state,
                    "confidence": "HIGH",
                }
            )

        with (
            patch.object(sup.rag, "_call_llm", llm),
            patch(
                "shared.workers.rag_worker._neon_recall.recall_knowledge", return_value=rows
            ) as recall,
        ):
            output = await sup.process(chat, case["user_message"], tenant_id=tenant)
        assert recall.called, "Must exercise raw recall, not a shortcut/gap template"
        assert prompts, "Must exercise actual RAG prompt assembly"
        return output

    return sup, run, prompts


@pytest.mark.asyncio
async def test_recorded_gs20_fault_definition_requires_applicable_evidence(harness):
    sup, run, prompts = harness
    case = RECORDINGS["gs20_cross_vendor_03"]
    output = await run(case, [raw_row("F004 = UnderVoltage. Generic untagged drawing note.")])
    assert "under-voltage condition" not in output
    assert "cannot verify" in output.lower()
    assert "Most likely causes" not in output
    assert "Check the incoming voltage" in output
    assert "qualified person" in output
    assert "general/context only" in prompts[0]


@pytest.mark.asyncio
@pytest.mark.parametrize("passage", ["F004 = Overcurrent.", "F004 = UnderVoltage."])
async def test_actual_fault_meaning_requires_matching_passage(harness, passage):
    _, run, _ = harness
    case = RECORDINGS["gs20_cross_vendor_03"]
    draft = "F004 = UnderVoltage. Record when it trips."
    output = await run(case, [raw_row(passage, "AutomationDirect", "GS20")], draft=draft)
    assert ("F004 = UnderVoltage" in output) == ("UnderVoltage" in passage)
    assert "Record when it trips." in output


@pytest.mark.asyncio
async def test_supplied_fault_status_and_general_guidance_survive_unknown_scope(harness):
    _, run, _ = harness
    draft = "You reported F004. F004 is the active fault code. Record when it trips."
    output = await run(
        RECORDINGS["gs20_cross_vendor_03"], [raw_row("A tenant drawing context note.")], draft=draft
    )
    assert draft in output


def test_claim_removal_preserves_layout_and_drops_only_orphan_attribution():
    reply = (
        "1. Increase P3.00 from 10s to 20s.\n[Source: Bad settings]\n\n"
        "2. Record the displayed fault. [Source: Good observations]\n\n"
        "3. Tell me when it occurs.\n\n--- Sources ---\n"
        "[1] Bad settings\n[2] Good observations"
    )
    output = engine._sanitize_claim_support(reply, "OC at startup", [], [])
    assert "Bad settings" not in output
    assert "2. Record the displayed fault. [Source: Good observations]\n\n3." in output
    assert "Good observations" in output


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case_key,vendor,model,row,forbidden",
    [
        (
            "pilz_manual_miss_11",
            "Pilz",
            "PNOZ",
            raw_row("wrong relay passage", "Rockwell Automation", "PowerFlex 525"),
            "PowerFlex 525",
        ),
        (
            "yaskawa_a1000_ov_23",
            "Yaskawa",
            "A1000",
            raw_row("E1-01 < 400 V Vdc = 660 V", "Yaskawa", "V1000"),
            "E1-01",
        ),
        (
            "full_diagnosis_happy_path_07",
            "AutomationDirect",
            "GS10",
            raw_row("Record displayed fault.", "AutomationDirect", "GS10"),
            "P3.00",
        ),
        (
            "gs10_overcurrent_01",
            "AutomationDirect",
            "GS10",
            raw_row("Record displayed fault.", "AutomationDirect", "GS10"),
            "Motor is disconnected",
        ),
    ],
)
async def test_recorded_boundary_cases_on_public_process(
    harness, case_key, vendor, model, row, forbidden
):
    sup, run, prompts = harness
    output = await run(RECORDINGS[case_key], [row], vendor, model)
    assert forbidden not in output
    assert "MIRA error" not in output
    assert "having trouble accessing" not in output
    assert output.strip()
    assert sup._load_state("recording")["asset_identified"]
    if row["model_number"] in {"V1000", "PowerFlex 525"}:
        assert row["content"] not in prompts[0]


@pytest.mark.asyncio
async def test_same_vendor_correction_reaches_real_rag_and_saved_state(harness):
    sup, run, prompts = harness
    case = RECORDINGS["asset_change_mid_session_08"]
    output = await run(
        case,
        [raw_row("Record whether OC occurs before rotation.", "AutomationDirect", "GS20")],
        "AutomationDirect",
        "GS10",
        draft="Confirmed GS20. Record whether OC occurs before rotation.",
    )
    state = sup._load_state("recording")
    assert "GS20" in state["asset_identified"] and "GS10" not in state["asset_identified"]
    assert state["context"]["uns_context"]["model"].lower() == "gs20"
    assert "Confirmed GS20" in output
    assert "Record whether OC occurs before rotation" in prompts[0]


@pytest.mark.asyncio
async def test_unknown_scope_title_is_not_support_for_a_model_setting(harness):
    _, run, prompts = harness
    row = raw_row("Set E-01 to 400 V.", "Yaskawa", "")
    row["title"] = "Yaskawa V1000 manual"
    row["metadata"]["section"] = "V1000 settings"
    output = await run(
        RECORDINGS["yaskawa_a1000_ov_23"],
        [row],
        "Yaskawa",
        "A1000",
        draft="Set E-01 to 400 V. Record the displayed fault. [Source: Yaskawa V1000]",
    )
    assert "Set E-01" not in output
    assert "Yaskawa V1000" not in output
    assert "Record the displayed fault" in output
    assert "general/context only" in prompts[0]


@pytest.mark.asyncio
async def test_supported_source_and_model_specific_setting_survive(harness):
    _, run, _ = harness
    row = raw_row(
        "Set P09.03 to 5 seconds. Record the displayed fault.", "AutomationDirect", "GS20"
    )
    output = await run(
        RECORDINGS["gs20_cross_vendor_03"],
        [row],
        draft="Set P09.03 to 5 seconds. Record the displayed fault. [Source: AutomationDirect GS20 — Fault Code Table]",
    )
    assert "Set P09.03 to 5 seconds" in output
    assert "[Source: AutomationDirect GS20" in output
    assert "cannot verify" not in output.lower()


@pytest.mark.asyncio
async def test_other_fault_definition_in_same_passage_cannot_support_assertion(harness):
    _, run, _ = harness
    row = raw_row("F004 = Overcurrent, F005 = UnderVoltage.", "AutomationDirect", "GS20")
    output = await run(
        RECORDINGS["gs20_cross_vendor_03"],
        [row],
        draft="F004 = UnderVoltage. Record when it trips.",
    )
    assert "F004 = UnderVoltage" not in output


@pytest.mark.asyncio
async def test_quoted_user_report_is_not_certified_manual_definition(harness):
    _, run, _ = harness
    case = {"user_message": "I saw F004 indicates undervoltage in the log"}
    draft = 'You reported "F004 indicates undervoltage". Record when it trips.'
    output = await run(case, [raw_row("A tenant log context.")], draft=draft)
    assert draft in output


@pytest.mark.asyncio
async def test_concurrent_tenants_keep_raw_recall_and_final_sources_local(harness):
    import asyncio

    sup, _, _ = harness
    arrivals = asyncio.Event()
    count = 0

    async def llm(messages, model=None):
        nonlocal count
        text = str(messages)
        token = "PRIVATE_A" if "PRIVATE_A" in text else "PRIVATE_B"
        count += 1
        if count >= 2:
            arrivals.set()
        await asyncio.wait_for(arrivals.wait(), 2)
        return json.dumps(
            {
                "reply": f"Record {token} fault timing. [Source: AutomationDirect GS20 — {token}]",
                "next_state": "Q2",
            }
        )

    def recall(embedding, tenant_id, **kw):
        token = "PRIVATE_A" if tenant_id == "tenant-a" else "PRIVATE_B"
        row = raw_row(f"Record {token} fault timing.", "AutomationDirect", "GS20")
        row["metadata"]["section"] = token
        return [row]

    for chat in ["a", "b"]:
        sup._save_state(
            chat,
            {
                "state": "Q2",
                "asset_identified": "AutomationDirect GS20",
                "exchange_count": 2,
                "context": {
                    "uns_context": {
                        "manufacturer": "AutomationDirect",
                        "model": "GS20",
                        "confidence": 0.9,
                    },
                    "history": [],
                },
            },
        )
    with (
        patch.object(sup.rag, "_call_llm", llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", side_effect=recall),
    ):
        a, b = await asyncio.gather(
            sup.process("a", "GS20 OC at startup", tenant_id="tenant-a"),
            sup.process("b", "GS20 OC at startup", tenant_id="tenant-b"),
        )
    assert "PRIVATE_A" in a and "PRIVATE_B" not in a
    assert "PRIVATE_B" in b and "PRIVATE_A" not in b
    assert count == 2


@pytest.mark.asyncio
async def test_known_fault_does_not_repeat_generic_question(harness, monkeypatch):
    sup, run, _ = harness
    monkeypatch.setattr(engine, "_CRITIQUE_DISABLED", False)
    monkeypatch.setattr(
        sup,
        "_self_critique_diagnosis",
        AsyncMock(
            return_value={
                "groundedness": 1,
                "helpfulness": 4,
                "instruction_following": 4,
                "groundedness_note": "Fault known; wiring state missing.",
            }
        ),
    )
    case = RECORDINGS["gs20_cross_vendor_03"]
    draft = "Record whether the trip occurs before rotation."
    output = await run(
        case, [raw_row(draft, "AutomationDirect", "GS20")], draft=draft, next_state="DIAGNOSIS"
    )
    assert "what exact fault code" not in output.lower()
    assert output.strip()
    sup._self_critique_diagnosis.assert_awaited()


@pytest.mark.asyncio
async def test_negated_fault_meaning_is_not_support(harness):
    _, run, _ = harness
    output = await run(
        RECORDINGS["gs20_cross_vendor_03"],
        [raw_row("F004 is not UnderVoltage.", "AutomationDirect", "GS20")],
        draft="F004 = UnderVoltage. Record when it trips.",
    )
    assert "F004 = UnderVoltage" not in output


def test_model_identification_is_not_a_fault_definition():
    reply = "GS20 is the drive model. A1000 is another model. FR-F800 is a Mitsubishi drive."
    assert engine._sanitize_claim_support(reply, "Identify models", [], []) == reply


@pytest.mark.asyncio
@pytest.mark.parametrize("family", [False, True])
async def test_general_heading_and_declared_family_sources_remain_citable(harness, family):
    _, run, _ = harness
    row = raw_row("Record the displayed fault.", "Yaskawa", "V1000" if family else "")
    if family:
        row["metadata"]["applies_to_models"] = ["A1000", "V1000"]
        label = "Yaskawa V1000 — Fault Code Table"
    else:
        row["metadata"]["section"] = "Getting Started"
        label = "Yaskawa — Getting Started"
    draft = f"Record the displayed fault. [Source: {label}]"
    output = await run(RECORDINGS["yaskawa_a1000_ov_23"], [row], "Yaskawa", "A1000", draft=draft)
    assert f"[Source: {label}]" in output


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "meaning,supported",
    [
        ("overcurrent", False),
        ("overcurrent on startup", False),
        ("overcurrent at constant speed", True),
    ],
)
async def test_fault_definition_retains_explicit_operating_condition(harness, meaning, supported):
    _, run, _ = harness
    case = {"user_message": "GS20 OC on startup"}
    output = await run(
        case,
        [raw_row("OC = Overcurrent at Constant Speed.", "AutomationDirect", "GS20")],
        draft=f"OC means {meaning}. Record the displayed code and when it occurs.",
    )
    assert (f"OC means {meaning}" in output) == supported
    assert "Record the displayed code" in output
    if supported:
        assert "reported startup" in output


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["", "A1000"])
async def test_v1000_title_cannot_be_excused_by_an_a1000_prefix(harness, model):
    _, run, _ = harness
    row = raw_row("Record the displayed fault.", "Yaskawa", model)
    row["metadata"]["section"] = "V1000 Family Manual"
    label = "Yaskawa A1000 — V1000 Family Manual"
    output = await run(
        RECORDINGS["yaskawa_a1000_ov_23"],
        [row],
        "Yaskawa",
        "A1000",
        draft=f"Record the displayed fault. [Source: {label}]",
    )
    assert f"[Source: {label}]" not in output
    assert "Record the displayed fault." in output
