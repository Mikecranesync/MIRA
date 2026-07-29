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


def test_forbidden_actions_superset_of_agent_registry_write_verbs() -> None:
    """The REAL lockstep test (2026-07-29 review): parse agent_registry's
    source and prove every one of its write verbs is caught by the contract
    validator — no cross-package runtime import."""
    import ast
    from pathlib import Path

    src = Path("mira-bots/shared/observe/agent_registry.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    verbs: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if getattr(t, "id", "") == "_WRITE_VERBS":
                    verbs = [ast.literal_eval(e) for e in node.value.elts]
    assert verbs, "could not locate _WRITE_VERBS in agent_registry.py"
    from materialized_evidence.context_contract import FORBIDDEN_ACTION_SUBSTRINGS

    for verb in verbs:
        assert any(bad in verb for bad in FORBIDDEN_ACTION_SUBSTRINGS), (
            f"agent_registry write verb {verb!r} would pass the contract validator"
        )
    # and the concrete bypasses from the adversarial review stay closed
    for bad in ("stop_machine", "close_work_order", "submit_work_order", "control_drive"):
        v = validate_context(_ctx(allowed_actions=[bad]))
        assert any(x.startswith("forbidden_action") for x in v), bad


def test_machine_packet_adapter_real_ts_shape() -> None:
    """Adversarial-review repro: nested machine_state object + `freshness`
    field name + unexpected freshness string must all be handled."""
    from materialized_evidence.context_contract import live_overlay_from_machine_packet

    packet = {
        "machine_state": {"state": "running", "since": "2026-07-29T00:00:00Z", "fresh": True},
        "freshness": {"live": 3, "stale": 0, "simulated": 1, "unknown": 0},
        "live_tags": [{"tag_path": "a.b", "value": 1, "quality": "good", "freshness": "fresh"}],
    }
    ov = live_overlay_from_machine_packet(packet)
    assert ov.machine_state == "running"
    assert ov.state_since == "2026-07-29T00:00:00Z"
    assert ov.freshness_summary == {"live": 3, "stale": 0, "simulated": 1, "unknown": 0}
    assert ov.tags[0].freshness == Freshness.UNKNOWN  # "fresh" is not a known value


def test_printsense_and_ontology_adapters() -> None:
    from materialized_evidence.context_contract import (
        evidence_from_ontology_validation,
        evidence_from_printsense_graph,
    )

    p = evidence_from_printsense_graph(
        [{"tag": "-K1", "type": "contactor", "detail": "main contactor", "trust": "verified"}],
        sheet="E-003",
    )
    assert p[0].kind == EvidenceKind.PRINT_OBSERVATION
    assert p[0].source_locator == "sheet:E-003#-K1"
    o = evidence_from_ontology_validation(
        [{"shape": "ApproverIsNotProposerShape", "conforms": False, "message": "self-approval"}]
    )
    assert o[0].trust == "rejected"
    assert "VIOLATION" in o[0].payload["summary"]
    ok = evidence_from_ontology_validation([{"shape": "S", "conforms": True}])
    assert ok[0].trust == "verified"
