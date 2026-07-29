"""ADR-0033 common context contract — hermetic tests."""

from __future__ import annotations

from materialized_evidence.context_contract import (
    ALLOWED_ACTION_VOCAB,
    CONTEXT_CONTRACT_VERSION,
    AssetIdentity,
    Contradiction,
    EvidenceItem,
    EvidenceKind,
    Freshness,
    TaskMode,
    TechnicianContext,
    asset_from_uns_context,
    evidence_from_drive_pack_answer,
    evidence_from_kg_context,
    evidence_from_recall_chunks,
    live_overlay_from_machine_packet,
    to_prompt_block,
    validate_context,
)


def _ctx(**kw) -> TechnicianContext:
    base = dict(
        contract_version=CONTEXT_CONTRACT_VERSION,
        task_mode=TaskMode.GENERAL_TROUBLESHOOTING,
        tenant_id="t-1",
        environment="dev",
    )
    base.update(kw)
    return TechnicianContext(**base)


def test_valid_default_context_passes() -> None:
    assert validate_context(_ctx()) == []


def test_write_shaped_actions_are_rejected() -> None:
    for bad in ("write_tag", "reset_fault", "clear_alarm", "jog_motor", "set_param", "bypass_gate"):
        v = validate_context(_ctx(allowed_actions=[*ALLOWED_ACTION_VOCAB, bad]))
        assert any(x.startswith("forbidden_action") for x in v), bad


def test_non_read_only_authorization_rejected() -> None:
    v = validate_context(_ctx(authorization_state="write_enabled"))
    assert "authorization_state:write_enabled" in v


def test_duplicate_and_missing_citation_ids_rejected() -> None:
    e1 = EvidenceItem(kind=EvidenceKind.MANUAL_CHUNK, citation_id="M1", payload={"text": "a"})
    e2 = EvidenceItem(kind=EvidenceKind.MANUAL_CHUNK, citation_id="M1", payload={"text": "b"})
    e3 = EvidenceItem(kind=EvidenceKind.LIVE_TAG, citation_id="", payload={})
    v = validate_context(_ctx(evidence=[e1, e2, e3]))
    assert "duplicate_citation_id:M1" in v
    assert any(x.startswith("evidence_missing_citation_id") for x in v)


def test_contradiction_must_reference_known_citations() -> None:
    e1 = EvidenceItem(kind=EvidenceKind.MANUAL_CHUNK, citation_id="M1", payload={"text": "a"})
    c = Contradiction(a_citation="M1", b_citation="D9", description="manual vs pack")
    v = validate_context(_ctx(evidence=[e1], contradictions=[c]))
    assert any(x.startswith("contradiction_cites_unknown_evidence") for x in v)


def test_prompt_block_is_deterministic_and_ordered() -> None:
    e_b = EvidenceItem(
        kind=EvidenceKind.DRIVE_PACK_FACT,
        citation_id="D1",
        payload={"claim": "F12 is HW OverCurrent"},
    )
    e_a = EvidenceItem(
        kind=EvidenceKind.MANUAL_CHUNK, citation_id="M1", payload={"text": "chunk text"}
    )
    ctx1 = _ctx(evidence=[e_b, e_a], unknowns=["live DC bus value"])
    ctx2 = _ctx(evidence=[e_a, e_b], unknowns=["live DC bus value"])
    b1, b2 = to_prompt_block(ctx1), to_prompt_block(ctx2)
    assert b1 == b2, "rendering must not depend on evidence insertion order"
    assert b1.index("[D1]") < b1.index("[M1]") or b1.index("[M1]") < b1.index("[D1]")
    assert "[unknown: live DC bus value]" in b1
    assert b1.splitlines()[0] == "[task_mode: general_troubleshooting]"


def test_recall_chunk_adapter_handles_both_dialects() -> None:
    py_chunk = {"content": "python text", "source_url": "u1", "chunk_index": 3, "similarity": 0.8}
    ts_chunk = {"text": "ts text", "sourceUrl": "u2", "chunkIndex": 7, "verified": True}
    items = evidence_from_recall_chunks([py_chunk, ts_chunk])
    assert items[0].payload["text"] == "python text"
    assert items[0].source_locator == "u1#chunk3"
    assert items[1].payload["text"] == "ts text"
    assert items[1].trust == "verified"
    assert [i.citation_id for i in items] == ["M1", "M2"]


def test_machine_packet_adapter_maps_freshness_and_drops() -> None:
    packet = {
        "machine_state": "faulted",
        "freshness_summary": {"live": 4, "stale": 1},
        "live_tags": [
            {
                "tag_path": "conv.motor.current",
                "value": 3.2,
                "quality": "good",
                "freshness": "live",
            },
        ],
        "dropped_tag_count": 6,
        "active_conditions": ["A3"],
    }
    ov = live_overlay_from_machine_packet(packet)
    assert ov.machine_state == "faulted"
    assert ov.tags[0].freshness == Freshness.LIVE
    assert ov.dropped_tag_count == 6
    block = to_prompt_block(_ctx(live=ov))
    assert "6 additional live tags not shown" in block


def test_uns_context_and_drive_pack_and_kg_adapters() -> None:
    ident = asset_from_uns_context(
        {
            "manufacturer": "automationdirect",
            "model": "gs10",
            "confidence": "high",
            "source": "direct_connection",
        }
    )
    assert isinstance(ident, AssetIdentity) and ident.source == "direct_connection"
    d = evidence_from_drive_pack_answer(
        {"citations": [{"claim": "CE10 is comm loss", "ref": "p4-188"}]}, "durapulse_gs10"
    )
    assert d[0].source_locator == "pack:durapulse_gs10#p4-188"
    g = evidence_from_kg_context(
        [
            {
                "summary": "cv_101 -> HAS_DOCUMENT -> manual",
                "approval_state": "verified",
                "id": "rel-1",
            }
        ]
    )
    assert g[0].trust == "verified" and g[0].citation_id == "G1"
