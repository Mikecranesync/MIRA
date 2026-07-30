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


# --------------------------------------------------------------------------
# Spine PR B — the four missing evidence adapters + document coordinates.
# --------------------------------------------------------------------------


def test_historian_window_adapter_fail_closed_and_deterministic() -> None:
    from materialized_evidence.context_contract import evidence_from_historian_window

    rows = [
        {
            "tag_path": "plant.line1.gs10.dc_bus",
            "window_start": "2026-07-29T00:00:00Z",
            "window_end": "2026-07-29T01:00:00Z",
            "summary": "DC bus mean 320.1 V, sd 0.8",
        },
        {"tag_path": "", "start": "a", "end": "b", "summary": "no tag -> dropped"},
        {"tag_path": "x.y", "window_start": "2026-07-29T00:00:00Z", "summary": "no end -> dropped"},
    ]
    items = evidence_from_historian_window(rows)
    assert [i.citation_id for i in items] == ["H1"]
    assert items[0].kind == EvidenceKind.HISTORIAN_WINDOW
    # History is stale by definition unless the producer says otherwise.
    assert items[0].freshness == Freshness.STALE
    assert items[0].payload["window"] == {
        "start": "2026-07-29T00:00:00Z",
        "end": "2026-07-29T01:00:00Z",
    }
    assert items[0].document_lineage_key is None
    # Deterministic: same input, byte-identical rendering.
    ctx = _ctx(evidence=items)
    assert to_prompt_block(ctx) == to_prompt_block(
        _ctx(evidence=evidence_from_historian_window(rows))
    )
    live = evidence_from_historian_window(
        [{"tag_path": "x.y", "start": "s", "end": "e", "summary": "z", "freshness": "live"}]
    )
    assert live[0].freshness == Freshness.LIVE


def test_work_order_adapter_fail_closed_on_missing_id() -> None:
    from materialized_evidence.context_contract import evidence_from_work_orders

    items = evidence_from_work_orders(
        [
            {"id": 4711, "title": "Replace GS10 fan", "status": "completed", "description": "done"},
            {"title": "no id -> dropped", "status": "open"},
            {"wo_number": "WO-9", "summary": "alt id keys work"},
            # Falsy-but-valid id 0 is a real anchor, and takes precedence over
            # later id keys (adversarial-review finding).
            {"id": 0, "wo_number": "WO-SHADOW", "title": "id zero kept"},
        ]
    )
    assert [i.citation_id for i in items] == ["W1", "W2", "W3"]
    assert items[0].kind == EvidenceKind.WORK_ORDER
    assert items[0].source_locator == "wo:4711"
    assert items[0].trust == "verified"
    assert "Replace GS10 fan" in items[0].payload["text"]
    assert items[1].source_locator == "wo:WO-9"
    assert items[2].source_locator == "wo:0"
    # System-of-record default is producer-adjustable (e.g. drafts/imports).
    draft = evidence_from_work_orders([{"id": 1, "title": "t", "trust": "candidate"}])
    assert draft[0].trust == "candidate"


def test_prior_decision_adapter_is_never_verified() -> None:
    from materialized_evidence.context_contract import evidence_from_prior_decisions

    items = evidence_from_prior_decisions(
        [
            {
                "id": "dt-1",
                "summary": "Suspected CE10 comm fault from RS-485 contention",
                "outcome": "confirmed",
                "groundedness": 4,
                # A past answer cannot promote itself, even if the row claims to:
                "trust": "verified",
            },
            {"id": "dt-2", "summary": ""},  # no content -> dropped
            {"summary": "no id -> dropped"},
        ]
    )
    assert [i.citation_id for i in items] == ["R1"]
    assert items[0].kind == EvidenceKind.PRIOR_DECISION
    assert items[0].trust == "candidate"
    assert items[0].confidence == 4
    assert items[0].source_locator == "decision:dt-1"


def test_prior_decision_adapter_consumes_real_decision_traces_shape() -> None:
    """Migration 032 rows store content in `recommendation` and time in `ts`
    (no summary/decision/created_at columns) — the adapter must accept them
    (adversarial-review finding: the first cut dropped 100% of real rows)."""
    from datetime import datetime, timezone

    from materialized_evidence.context_contract import evidence_from_prior_decisions

    row = {
        "id": "dt-real",
        "recommendation": "Check RS-485 termination at TB2",
        "ts": datetime(2026, 7, 29, tzinfo=timezone.utc),
        "groundedness": None,  # NULL column must not mask confidence
        "confidence": 0.8,
    }
    (item,) = evidence_from_prior_decisions([row])
    assert item.payload["summary"] == "Check RS-485 termination at TB2"
    assert item.confidence == 0.8
    # datetime is coerced to str so TechnicianContext.to_dict() stays
    # JSON-serializable end to end.
    assert isinstance(item.observed_at, str)
    import json as _json

    _json.dumps(_ctx(evidence=[item]).to_dict())


def test_technician_correction_adapter_immutability_anchor_and_rights() -> None:
    from materialized_evidence.context_contract import evidence_from_technician_corrections

    items = evidence_from_technician_corrections(
        [
            {
                "event_id": "ce-1",
                "occurred_at": "2026-07-29T12:00:00Z",
                "correction": "That terminal is TB2-4, not TB2-3",
                "corrected_claim": "terminal TB2-3",
                # Trust clamp: an event arriving pre-promoted must NOT render
                # as verified (never-auto-verify law; mirrors PRIOR_DECISION).
                "trust": "verified",
            },
            {"event_id": "ce-2", "correction": "no timestamp -> dropped"},
            {"occurred_at": "2026-07-29T12:01:00Z", "correction": "no id -> dropped"},
            {"event_id": "ce-3", "occurred_at": "2026-07-29T12:02:00Z", "correction": ""},
        ]
    )
    assert [i.citation_id for i in items] == ["T1"]
    assert items[0].kind == EvidenceKind.TECHNICIAN_CORRECTION
    assert items[0].source_locator == "correction:ce-1"
    assert items[0].observed_at == "2026-07-29T12:00:00Z"
    assert items[0].payload["corrects"] == "terminal TB2-3"
    # Rights fail-closed: runtime evidence only, never a corpus lineage.
    assert items[0].document_lineage_key is None
    assert items[0].trust == "candidate"


def test_technician_correction_adapter_consumes_correction_event_v1() -> None:
    """The canonical immutable event (correction-event.v1 schema) adapts as-is
    (adversarial-review finding: the first cut matched none of its keys)."""
    from materialized_evidence.context_contract import evidence_from_technician_corrections

    v1 = {
        "schema": "factorylm.clf.correction-event.v1",
        "correction_id": "corr-42",
        "run_id": "run-7",
        "at": "2026-07-29T13:00:00Z",
        "actor": "reviewer-mike",
        "action": "edit",
        "corrected_answer": "F12 means hardware overcurrent, not overvoltage",
        "prior_correction_id": None,
        "immutable": True,
    }
    accept_only = {**v1, "correction_id": "corr-43", "action": "accept", "corrected_answer": None}
    items = evidence_from_technician_corrections([v1, accept_only])
    # The accept event has no citable text -> dropped fail-closed.
    assert [i.citation_id for i in items] == ["T1"]
    assert items[0].source_locator == "correction:corr-42"
    assert items[0].payload["corrects_run_id"] == "run-7"
    assert items[0].payload["action"] == "edit"


def test_technician_correction_hash_is_tamper_evident() -> None:
    from materialized_evidence.context_contract import evidence_from_technician_corrections

    ev = {"correction_id": "c1", "at": "2026-07-29T13:00:00Z", "corrected_answer": "use TB2-4"}
    (a,) = evidence_from_technician_corrections([ev])
    (b,) = evidence_from_technician_corrections([dict(ev)])
    assert a.evidence_hash and a.evidence_hash == b.evidence_hash
    (tampered,) = evidence_from_technician_corrections(
        {**ev, "corrected_answer": "use TB2-3"} for _ in (0,)
    )
    assert tampered.evidence_hash != a.evidence_hash


def test_technician_correction_sanitized_text_passes_through_verbatim() -> None:
    """Sanitization posture (ledger §8.8): producers feed the PII-sanitized
    capture stream; the adapter must carry redaction placeholders byte-
    identically — never de-redact, never rewrite."""
    from materialized_evidence.context_contract import evidence_from_technician_corrections

    sanitized = "Drive at [IP] serial [SN] faulted; correct fix was replacing fan"
    (item,) = evidence_from_technician_corrections(
        [{"correction_id": "c9", "at": "2026-07-29T14:00:00Z", "corrected_answer": sanitized}]
    )
    assert item.payload["text"] == sanitized
    block = to_prompt_block(_ctx(evidence=[item]))
    assert "[IP]" in block and "[SN]" in block


def test_document_coordinates_flow_from_recall_chunks() -> None:
    chunk = {
        "content": "Tighten terminal torque to 1.2 Nm",
        "source_url": "u1",
        "chunk_index": 2,
        "metadata": {
            "page_num": 37,
            "section": "3.2 Wiring",
            "document_lineage_key": "automationdirect:gs10-um",
        },
    }
    (item,) = evidence_from_recall_chunks([chunk])
    assert item.page == 37
    assert item.section == "3.2 Wiring"
    assert item.document_lineage_key == "automationdirect:gs10-um"
    block = to_prompt_block(_ctx(evidence=[item]))
    assert "page 37" in block
    assert "section 3.2 Wiring" in block
    d = item.to_dict()
    assert d["page"] == 37 and d["section"] == "3.2 Wiring" and d["bbox"] is None


def test_recall_chunk_page_never_read_from_source_page_misstamp() -> None:
    """The legacy corpus stamps `source_page` with the CHUNK ORDINAL, not a
    PDF page (#2910/#2968; rag_worker "p. 47 when we mean chunk 47" law,
    manual-rag.ts displayPage guard). A mis-stamp is exactly `source_page ==
    chunk_index`, and it must yield NO page. `page_num` / `metadata.page_num`
    take precedence over `source_page` either way, and a present-but-None
    page_num falls through to metadata."""
    misstamped = {
        "content": "x",
        "source_url": "u",
        "chunk_index": 173,
        "source_page": 173,  # ordinal masquerading as a page
        "metadata": {},
    }
    (item,) = evidence_from_recall_chunks([misstamped])
    assert item.page is None
    assert "page" not in to_prompt_block(_ctx(evidence=[item]))
    real = {
        "content": "y",
        "source_url": "u",
        "chunk_index": 5,
        "source_page": 1254,  # not consulted: metadata.page_num wins by precedence
        "page_num": None,  # present-but-None must not mask metadata
        "metadata": {"page_num": 12},
    }
    (item2,) = evidence_from_recall_chunks([real])
    assert item2.page == 12


def test_recall_chunk_recovers_real_page_from_hub_source_page() -> None:
    """A Hub-shaped chunk carries no `page_num` at all — its coordinates are
    `sourcePage` + `chunkIndex`. Refusing `source_page` unconditionally dropped
    the real OEM page off every crawler-sourced row (100% of the Hub corpus that
    HAS a real page), which is exactly the coordinate loss this contract exists
    to prevent. The mis-stamp test is the Hub's own: real page iff sp != cidx
    (manual-rag.ts displayPage; staging: legacy 100% sp==cidx, crawler copy
    sp!=cidx for 1067/1069)."""
    # camelCase Hub dialect, genuine page.
    (item,) = evidence_from_recall_chunks(
        [{"text": "t", "sourceUrl": "u", "sourcePage": 42, "chunkIndex": 7}]
    )
    assert item.page == 42
    assert item.source_locator == "u#chunk7"
    assert "page 42" in to_prompt_block(_ctx(evidence=[item]))

    # snake_case dialect, genuine page.
    (item2,) = evidence_from_recall_chunks(
        [{"content": "t", "source_url": "u", "source_page": 42, "chunk_index": 7}]
    )
    assert item2.page == 42

    # Numeric string (the Hub does Number(r.source_page); drivers vary).
    (item3,) = evidence_from_recall_chunks(
        [{"content": "t", "source_url": "u", "sourcePage": "42", "chunkIndex": "7"}]
    )
    assert item3.page == 42

    # Non-numeric source_page is not a page. Fail closed.
    (item4,) = evidence_from_recall_chunks(
        [{"content": "t", "source_url": "u", "sourcePage": "front-matter", "chunkIndex": 2}]
    )
    assert item4.page is None


def test_recall_chunk_null_chunk_index_does_not_render_literal_none() -> None:
    """Hub node rows carry `page_start` with `chunkIndex: null` (manual-rag.ts
    displayPage docstring). `dict.get(k, default)` returns the STORED None for a
    present-but-null key, so the default never fired and the locator rendered
    the literal string "#chunkNone". No ordinal means no fragment — substituting
    the loop counter would invent a coordinate the producer never gave."""
    for key in ("chunkIndex", "chunk_index"):
        (item,) = evidence_from_recall_chunks(
            [{"content": "t", "source_url": "u", key: None, "source_page": 12}]
        )
        assert "None" not in item.source_locator, f"{key}: {item.source_locator}"
        assert item.source_locator == "u"
        # displayPage returns sourcePage when chunkIndex is null — so does this.
        assert item.page == 12

    # Absent entirely (not just null) behaves the same way.
    (item2,) = evidence_from_recall_chunks([{"content": "t", "source_url": "u"}])
    assert item2.source_locator == "u"

    # A real 0 ordinal is falsy but valid — it must still render.
    (item3,) = evidence_from_recall_chunks([{"content": "t", "source_url": "u", "chunk_index": 0}])
    assert item3.source_locator == "u#chunk0"


def test_printsense_bbox_positive_path() -> None:
    from materialized_evidence.context_contract import evidence_from_printsense_graph

    (item,) = evidence_from_printsense_graph(
        [{"tag": "-K1", "type": "contactor", "bbox": [10, 20, 110, 80]}], sheet="E-003"
    )
    assert item.bbox == [10.0, 20.0, 110.0, 80.0]
    assert item.to_dict()["bbox"] == [10.0, 20.0, 110.0, 80.0]
    # Malformed geometry is carried as None, never guessed.
    (bad,) = evidence_from_printsense_graph([{"tag": "-K2", "bbox": [1, 2]}])
    assert bad.bbox is None


def test_coordinate_fields_never_synthesized_and_legacy_rendering_unchanged() -> None:
    # No coordinates / no lineage on the chunk -> all None; the lineage key is
    # an explicit producer-side join, never derived from manufacturer/url.
    (item,) = evidence_from_recall_chunks(
        [{"content": "plain", "source_url": "u", "chunk_index": 1, "manufacturer": "Yaskawa"}]
    )
    assert item.page is None and item.section is None and item.document_lineage_key is None
    line = [ln for ln in to_prompt_block(_ctx(evidence=[item])).splitlines() if "[M1]" in ln][0]
    assert line == "Evidence [M1] (manual_chunk, candidate): plain"


def test_all_adapter_citation_prefixes_are_disjoint() -> None:
    from materialized_evidence.context_contract import (
        evidence_from_historian_window,
        evidence_from_prior_decisions,
        evidence_from_technician_corrections,
        evidence_from_work_orders,
    )

    def build() -> list[EvidenceItem]:
        return (
            evidence_from_recall_chunks([{"content": "m", "source_url": "u", "chunk_index": 1}])
            + evidence_from_historian_window(
                [{"tag_path": "t", "start": "s", "end": "e", "summary": "h"}]
            )
            + evidence_from_work_orders([{"id": 1, "title": "w"}])
            + evidence_from_prior_decisions([{"id": "d", "summary": "p"}])
            + evidence_from_technician_corrections(
                [{"event_id": "c", "occurred_at": "now", "correction": "x"}]
            )
        )

    evidence = build()
    ctx = _ctx(evidence=evidence)
    assert validate_context(ctx) == []
    ids = [e.citation_id for e in evidence]
    assert len(ids) == len(set(ids)) == 5
    # Determinism across ALL four new adapters: rebuilding from the same
    # inputs renders byte-identically.
    assert to_prompt_block(ctx) == to_prompt_block(_ctx(evidence=build()))
