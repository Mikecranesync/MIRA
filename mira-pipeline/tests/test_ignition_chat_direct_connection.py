"""Phase-6: the Ignition cloud-chat endpoint marks turns as direct-connection.

An Ignition turn arriving with an asset identifier is UNS-certified by
construction, so ignition_chat must pass ``uns_source="direct_connection"`` to
``engine.process`` (the engine then stamps state["uns_context"]["source"], which
the decision trace records).

Phase 6 reject-on-missing-identifier contract: a turn with NO asset identifier
is REJECTED (422 ``{"error":"uns_required"}``) when it's asset-specific
troubleshooting — the connection is the gate; a direct surface must not downgrade
to a chat-gate. General/educational questions carry no asset and are answered as
a plain chat turn (uns_source=None). The intent classifier fails open (→ plain
chat) so a blip never bricks the HMI. See
.claude/rules/direct-connection-uns-certified.md.

The engine is a recording mock — we assert on the kwargs ignition_chat forwards,
not on engine behaviour. HMAC is bypassed by monkeypatching the verifier so the
test stays focused on the provenance wiring.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import ignition_chat


@pytest.fixture
def recording_engine():
    engine = AsyncMock()
    engine.process = AsyncMock(return_value="Check VFD fault code F0004.")
    return engine


@pytest.fixture
def client(monkeypatch, recording_engine):
    # Bypass HMAC: pretend every request authenticates as tenant "t-1".
    monkeypatch.setattr(ignition_chat, "MIRA_IGNITION_HMAC_KEY", "test-key")
    monkeypatch.setattr(ignition_chat, "_verify_hmac", lambda headers, body, key: "t-1")
    app = FastAPI()
    app.include_router(ignition_chat.build_router(lambda: recording_engine))
    return TestClient(app, raise_server_exceptions=False), recording_engine


def _post(tc, payload: dict):
    return tc.post(
        "/api/v1/ignition/chat",
        content=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )


def _real_assess_from_paths():
    """Import the real shared.live_snapshot.assess_from_paths, adding mira-bots to
    sys.path (the mira-pipeline conftest only adds mira-pipeline/). In the prod
    container `shared` is already importable — mira-pipeline runs the Supervisor —
    so ignition_chat's defensive import resolves the real fn; this just guarantees
    it in the test env too."""
    import os
    import sys

    mb = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "mira-bots",
    )
    if mb not in sys.path:
        sys.path.insert(0, mb)
    from shared.live_snapshot import assess_from_paths

    return assess_from_paths


def test_assessment_reaches_prompt_for_vfd_fault(client, monkeypatch):
    """A VFD snapshot with an active fault produces a deterministic Assessment
    line + the reasoning-separation instruction in the engine prompt (the HMI
    mirror of the Hub packet / engine section)."""
    tc, engine = client
    monkeypatch.setattr(ignition_chat, "_assess_from_paths", _real_assess_from_paths())

    async def _passthrough(snap, tenant_id):
        return snap

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _passthrough)

    resp = _post(
        tc,
        {
            "query": "why did the conveyor stop?",
            "asset_id": "CV-101",
            "tag_snapshot": {
                "[default]Mira_Monitored/CV-101/vfd_fault_code": {"value": "58", "quality": "Good"},
                "[default]Mira_Monitored/CV-101/vfd_comm_ok": {"value": "true", "quality": "Good"},
            },
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    # Deterministic assessment from the scaling-immune enum facts.
    assert "Assessment: Active VFD fault: CE10 modbus timeout" in message
    # The reasoning-separation instruction reaches the prompt.
    assert "clearly separate" in message
    # The raw live-tag block is still preserved.
    assert "vfd_fault_code" in message


def test_fault_diagnostic_card_reaches_prompt_for_mapped_gs10_fault(client, monkeypatch):
    """A mapped GS10 fault (GOOD comms) on the Ignition direct-connection surface
    now carries the SAME fault-diagnostic card as the engine path (Drive
    Commander DriveSense Ignition-enrich follow-up) — proves the enrichment is
    actually visible end-to-end, not just at the shared.live_snapshot unit-test
    layer."""
    tc, engine = client
    monkeypatch.setattr(ignition_chat, "_assess_from_paths", _real_assess_from_paths())

    async def _passthrough(snap, tenant_id):
        return snap

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _passthrough)

    resp = _post(
        tc,
        {
            "query": "why did the conveyor stop?",
            "asset_id": "CV-101",
            "tag_snapshot": {
                "[default]Mira_Monitored/CV-101/vfd_fault_code": {"value": "4", "quality": "Good"},
                "[default]Mira_Monitored/CV-101/vfd_comm_ok": {"value": "true", "quality": "Good"},
            },
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "Assessment: Active VFD fault: GFF ground fault" in message
    assert "### Fault diagnostic:" in message
    assert "Likely causes:" in message


def test_healthy_but_stopped_assessment_from_enum_facts(client, monkeypatch):
    tc, engine = client
    monkeypatch.setattr(ignition_chat, "_assess_from_paths", _real_assess_from_paths())

    async def _passthrough(snap, tenant_id):
        return snap

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _passthrough)

    resp = _post(
        tc,
        {
            "query": "why won't it run?",
            "asset_id": "CV-101",
            "tag_snapshot": {
                "[default]Mira_Monitored/CV-101/vfd_fault_code": {"value": "0"},
                "[default]Mira_Monitored/CV-101/vfd_comm_ok": {"value": "true"},
                "[default]Mira_Monitored/CV-101/vfd_cmd_word": {"value": "1"},  # STOP
                # analog value present but never re-scaled into the assessment
                "[default]Mira_Monitored/CV-101/vfd_frequency": {"value": "0.0"},
            },
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "Assessment:" in message
    assert "healthy" in message and "stopped" in message
    assert "command/permissive/interlock" in message


def test_asset_id_marks_direct_connection(client):
    tc, engine = client
    resp = _post(tc, {"query": "why did the conveyor stop?", "asset_id": "[default]Conv/State"})
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert engine.process.await_args.kwargs.get("uns_source") == "direct_connection"
    assert engine.process.await_args.kwargs.get("platform") == "ignition"


def test_asset_context_marks_direct_connection(client):
    tc, engine = client
    resp = _post(
        tc,
        {
            "query": "is the drive faulted?",
            "asset_context": {
                "site": "lake_wales",
                "area": "conveyor_lab",
                "equipment": "gs10_vfd",
            },
        },
    )
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") == "direct_connection"


def test_no_asset_id_general_question_is_plain_chat(client, monkeypatch):
    """A general/educational question with no asset id is NOT rejected — the
    direct-connection rule carves out general questions on any surface."""
    tc, engine = client
    # Classifier says this is not asset-specific troubleshooting.
    monkeypatch.setattr(
        ignition_chat,
        "_route_intent",
        AsyncMock(return_value={"intent": "find_documentation"}),
    )
    resp = _post(tc, {"query": "what is a VFD?"})
    assert resp.status_code == 200
    engine.process.assert_awaited_once()
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_no_asset_id_asset_specific_is_rejected_422(client, monkeypatch):
    """An asset-specific troubleshooting turn with NO UNS identifier is REJECTED
    (422 uns_required) — NOT downgraded to a chat-gate. The connection is the
    gate; a direct surface that can't say which machine must reject."""
    tc, engine = client
    monkeypatch.setattr(
        ignition_chat,
        "_route_intent",
        AsyncMock(return_value={"intent": "diagnose_equipment"}),
    )
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 422
    assert resp.json() == {"error": "uns_required"}
    engine.process.assert_not_awaited()  # rejected before reaching the engine


def test_no_asset_id_classifier_failure_fails_open(client, monkeypatch):
    """If the intent classifier errors, fail OPEN to a plain chat turn (200) —
    a Neon/LLM blip must never brick the HMI by rejecting good turns."""
    tc, engine = client
    monkeypatch.setattr(
        ignition_chat, "_route_intent", AsyncMock(side_effect=RuntimeError("router down"))
    )
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_no_asset_id_classifier_unavailable_fails_open(client, monkeypatch):
    """If shared/ isn't mounted (_route_intent is None), fail open to plain chat."""
    tc, engine = client
    monkeypatch.setattr(ignition_chat, "_route_intent", None)
    resp = _post(tc, {"query": "why did the conveyor stop?"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("uns_source") is None


def test_tag_snapshot_forwarded_as_tag_evidence(client):
    tc, engine = client
    resp = _post(
        tc,
        {
            "query": "is the motor overloaded?",
            "asset_id": "[default]Conv/State",
            "tag_snapshot": {"Motor_Current_A": {"value": 11.2, "quality": "good"}},
        },
    )
    assert resp.status_code == 200
    ev = engine.process.await_args.kwargs.get("tag_evidence")
    assert ev and ev[0]["tag_path"] == "Motor_Current_A"
    assert ev[0]["value"] == 11.2 and ev[0]["quality"] == "good"


def test_no_tag_snapshot_means_no_tag_evidence(client):
    tc, engine = client
    resp = _post(tc, {"query": "status?", "asset_id": "[default]Conv/State"})
    assert resp.status_code == 200
    assert engine.process.await_args.kwargs.get("tag_evidence") is None


def test_tag_preamble_enriched_with_verified_entities(client, monkeypatch):
    """Verified tag_entities metadata (units, data_type) appears in the prompt preamble.

    _enrich_tag_snapshot_with_semantics is mocked so no live DB is required.
    This verifies the handler wires enrichment before _format_tag_preamble, and
    that _format_tag_preamble renders the merged fields.

    Join-key contract (enforced by Phase 1's tag_classifier): source_address in
    tag_entities must store the same path string that tag_snapshot uses as its key.
    """
    tc, engine = client

    async def _mock_enrich(tag_snapshot, tenant_id):
        return {
            k: ({**v, "units": "A", "data_type": "REAL"} if isinstance(v, dict) else v)
            for k, v in tag_snapshot.items()
        }

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _mock_enrich)

    resp = _post(
        tc,
        {
            "query": "is the motor overloaded?",
            "asset_id": "[default]Conv/State",
            "tag_snapshot": {"Motor_Current_A": {"value": 11.2, "quality": "good"}},
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "11.2 A" in message
    assert "REAL" in message


def _real_analog():
    """The real analog assessment + scaling adapter, with mira-bots on sys.path
    (mirrors `_real_assess_from_paths`)."""
    import os
    import sys

    mb = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "mira-bots",
    )
    if mb not in sys.path:
        sys.path.insert(0, mb)
    from shared.live_snapshot import assess_analog_from_paths
    from shared.wire_scaling import from_jsonb

    return assess_analog_from_paths, from_jsonb


def _use_real_analog(monkeypatch):
    assess_analog, from_jsonb = _real_analog()
    monkeypatch.setattr(ignition_chat, "_assess_analog_from_paths", assess_analog)
    monkeypatch.setattr(ignition_chat, "_tag_scaling_from_jsonb", from_jsonb)


def test_analog_card_reaches_prompt_for_explicitly_scaled_dc_bus(client, monkeypatch):
    """A dc_bus tag with a verified raw_register scaling contract is scaled to
    engineering units and assessed against the pack envelope; the self-explaining
    card reaches the engine prompt. End-to-end proof of the scaling contract."""
    tc, engine = client
    _use_real_analog(monkeypatch)

    dc = "[default]Mira_Monitored/CV-101/vfd_dc_bus"

    async def _mock_enrich(tag_snapshot, tenant_id):
        # Verified tag_entities row: raw_register scaling + units for this tag.
        return {
            k: (
                {**v, "units": "V", "scaling": {"mode": "raw_register", "scale": 0.1}}
                if isinstance(v, dict)
                else v
            )
            for k, v in tag_snapshot.items()
        }

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _mock_enrich)

    resp = _post(
        tc,
        {
            "query": "is the DC bus healthy?",
            "asset_id": "CV-101",
            "tag_snapshot": {dc: {"value": "3200", "quality": "Good"}},
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "DC bus: 320 V" in message
    assert "Source value: 3200" in message
    assert "Normal band: 300–340 V" in message
    assert "Assessment: normal" in message


def test_no_analog_card_when_scaling_unknown(client, monkeypatch):
    """Without a verified scaling contract, the dc_bus value is still shown in the
    preamble but NEVER assessed — no card, no false undervoltage from '3200'."""
    tc, engine = client
    _use_real_analog(monkeypatch)

    dc = "[default]Mira_Monitored/CV-101/vfd_dc_bus"

    async def _passthrough(snap, tenant_id):
        return snap  # no enrichment → no scaling → unknown

    monkeypatch.setattr(ignition_chat, "_enrich_tag_snapshot_with_semantics", _passthrough)

    resp = _post(
        tc,
        {
            "query": "is the DC bus healthy?",
            "asset_id": "CV-101",
            "tag_snapshot": {dc: {"value": "3200", "quality": "Good"}},
        },
    )
    assert resp.status_code == 200
    message = engine.process.await_args.kwargs.get("message", "")
    assert "3200" in message  # raw value still visible in the preamble
    assert "Normal band" not in message  # but no analog assessment card
    assert "undervoltage" not in message
