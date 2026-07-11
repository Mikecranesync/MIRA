"""Tests for shared.visual.equipment.answer_equipment — pack-fact lookups,
tenant manual retrieval, citation propagation, and the no-invention /
safety-preservation guarantees. Hermetic: InMemoryVisualStore + fake
retrievers, no DB, no LLM, no network.

Covers spec test areas 1 (evidence-state transitions, answer_equipment
slice), 2 (append-only), 6 (citation propagation), 7 (no unsupported
claims), 9 (graceful dependency failure), plus fixtures (9) tenant-owned
manual citation, (10) cross-tenant retrieval assertion, (11) safety-critical
question without evidence.
"""

from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.visual.equipment import (  # noqa: E402
    EquipmentResolution,
    PackCandidate,
    answer_equipment,
    resolve_equipment,
)
from shared.visual.evidence_state import EvidenceState  # noqa: E402
from shared.visual.store import InMemoryVisualStore  # noqa: E402

import pytest  # noqa: E402


def _resolved_gs10() -> EquipmentResolution:
    resolution = resolve_equipment(
        nameplate={"manufacturer": "AutomationDirect", "model": "GS11N-10P2"}
    )
    assert resolution.status == "RESOLVED" and resolution.pack_id == "durapulse_gs10"
    return resolution


def _resolved_pf525() -> EquipmentResolution:
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 525"})
    assert resolution.status == "RESOLVED" and resolution.pack_id == "powerflex_525"
    return resolution


async def _new_session(store: InMemoryVisualStore, tenant_id: str) -> str:
    session_id = await store.create_session(tenant_id, title="equipment test session")
    assert session_id
    return session_id


# ── pack-fact lookups: fault codes, parameters, envelope (deterministic) ───


@pytest.mark.asyncio
async def test_fault_code_question_yields_documented_claim_with_pack_citation():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean on my drive?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented, f"expected a DOCUMENTED claim, got claims={envelope.claims}"
    assert any("CE10" in c.text and "modbus timeout" in c.text.lower() for c in documented)
    assert any(c.doc_citations for c in documented)
    citation = next(c for c in documented if c.doc_citations).doc_citations[0]
    assert citation["doc"] == "durapulse_gs10 pack"
    assert citation["page"] == "fault_codes"


@pytest.mark.asyncio
async def test_powerflex_fault_code_question_uses_f_number_convention():
    """PowerFlex packs document codes as F002..F127 (zero-padded) WITHOUT
    embedding that in the meaning string (unlike GS10's 'CE10 modbus
    timeout') -- confirmed by reading the real pack.json provenance.sources
    excerpts (e.g. 'F007 Motor Overload'). Proves the F-number convention
    path, not just the embedded-mnemonic path."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does F007 mean?",
        _resolved_pf525(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented
    assert any("Motor Overload" in c.text for c in documented)


@pytest.mark.asyncio
async def test_parameter_id_question_yields_documented_claim_with_manual_citation():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what is P09.03 on the GS10?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented, f"expected a DOCUMENTED claim, got claims={envelope.claims}"
    assert any("P09.03" in c.text for c in documented)
    citation = next(c for c in documented if c.doc_citations).doc_citations[0]
    # The REAL pack-embedded citation (page-cited manual excerpt), not a
    # synthetic "<pack_id> pack" placeholder -- P09.03 carries a real
    # source_citation in durapulse_gs10/pack.json.
    assert citation["doc"] == "DURApulse GS10 AC Drive User Manual (1st Ed., Rev B)"
    assert citation["page"] == "4-188"


@pytest.mark.asyncio
async def test_envelope_question_only_reports_populated_band_fields():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what's the normal dc bus voltage?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented
    assert any("320" in c.text for c in documented)  # durapulse_gs10 dc_bus.nominal == 320.0


@pytest.mark.asyncio
async def test_envelope_question_never_guesses_an_unpopulated_band():
    """powerflex_525's envelope is entirely empty in the shipped pack ({}) --
    asking about current must NEVER fabricate a rating."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what's the rated current?",
        _resolved_pf525(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert all(c.evidence_state != EvidenceState.DOCUMENTED for c in envelope.claims)
    assert any(c.evidence_state == EvidenceState.NEEDS_CONTEXT for c in envelope.claims)


# ── (7) no unsupported claims ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_question_with_no_matching_fact_yields_needs_context_no_invention():
    """(11) 'what wire gauge?' -- no matching fault code, parameter, or
    envelope band, and no manual citation. Must refuse honestly, never
    invent a gauge/terminal/rating."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what wire gauge should I use?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert len(envelope.claims) == 1
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert envelope.next_best_evidence
    lowered = envelope.claims[0].text.lower()
    assert "awg" not in lowered and "gauge" not in lowered


@pytest.mark.asyncio
async def test_unknown_fault_code_not_in_pack_is_not_invented():
    """A fault-code-shaped token the pack does NOT define (e.g. F999) must
    not produce a fabricated meaning."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does F999 mean?",
        _resolved_pf525(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert all(c.evidence_state != EvidenceState.DOCUMENTED for c in envelope.claims)


# ── unresolved identity: refuse equipment specifics, never invent ──────────


@pytest.mark.asyncio
async def test_conflicting_identity_refuses_equipment_question_with_specific_ask():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    resolution = resolve_equipment(drive_name="GS10", nameplate={"model": "PowerFlex 525"})
    assert resolution.status == "CONFLICTING"

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        resolution,
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert len(envelope.claims) == 1
    claim = envelope.claims[0]
    assert claim.evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "disagree" in claim.text  # the SPECIFIC ask, not a generic bounce
    assert envelope.next_best_evidence == resolution.needs_context


@pytest.mark.asyncio
async def test_ambiguous_identity_refuses_with_specific_ask():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    resolution = resolve_equipment(nameplate={"model": "PowerFlex 40 or PowerFlex 525"})
    assert resolution.status == "AMBIGUOUS"

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does F007 mean?",
        resolution,
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT
    assert "catalog/part number" in envelope.claims[0].text


@pytest.mark.asyncio
async def test_none_identity_refuses_equipment_question():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    resolution = resolve_equipment()
    assert resolution.status == "NONE"

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does F007 mean?",
        resolution,
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT


@pytest.mark.asyncio
async def test_unresolved_identity_safety_question_still_short_circuits():
    """(11) 'is it safe to touch?' on an UNRESOLVED session -- the safety
    short-circuit must fire regardless of equipment identity (a photo can
    never establish a safe/de-energized state either way)."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    resolution = resolve_equipment()  # NONE -- nothing identified yet
    assert resolution.status == "NONE"

    envelope = await answer_equipment(
        session_id,
        tenant,
        "is it safe to touch?",
        resolution,
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert envelope.safety_notes
    assert any(c.safety_flag for c in envelope.claims)
    for c in envelope.claims:
        assert "it is safe" not in c.text.lower()


@pytest.mark.asyncio
async def test_resolved_identity_safety_question_also_short_circuits():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "is it safe to touch?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )

    assert envelope.safety_notes
    assert any(c.safety_flag for c in envelope.claims)
    assert all(c.evidence_state != EvidenceState.DOCUMENTED for c in envelope.claims)


# ── (9) / (10) tenant manuals: citation propagation + tenant threading ─────


@pytest.mark.asyncio
async def test_tenant_manual_citation_is_cited_in_the_answer():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    tenant_citation = {
        "doc": "Acme Plant GS10 Install Notes",
        "page": 3,
        "excerpt": "keypad displays CE10 when the modbus link drops for more than 5 seconds",
    }

    def fake_retriever(question: str, tenant_id: str, manufacturer: str | None):
        return [tenant_citation]

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=fake_retriever,
        llm=None,
    )

    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented
    assert any(tenant_citation in c.doc_citations for c in documented)


@pytest.mark.asyncio
async def test_retriever_is_always_called_with_the_sessions_own_tenant_id():
    """(10) the ONLY tenant guard on this path is threading the session's own
    tenant_id into the retriever call -- prove it is never substituted."""
    store = InMemoryVisualStore()
    session_tenant = str(uuid.uuid4())
    other_tenant = str(uuid.uuid4())
    session_id = await _new_session(store, session_tenant)

    seen: dict[str, str] = {}

    def capturing_retriever(question: str, tenant_id: str, manufacturer: str | None):
        seen["tenant_id"] = tenant_id
        assert tenant_id != other_tenant
        return []

    await answer_equipment(
        session_id,
        session_tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=capturing_retriever,
        llm=None,
    )

    assert seen["tenant_id"] == session_tenant


@pytest.mark.asyncio
async def test_retriever_receives_the_resolved_packs_manufacturer():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    seen: dict[str, str | None] = {}

    def capturing_retriever(question: str, tenant_id: str, manufacturer: str | None):
        seen["manufacturer"] = manufacturer
        return []

    await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=capturing_retriever,
        llm=None,
    )
    assert seen["manufacturer"] == "AutomationDirect"


@pytest.mark.asyncio
async def test_async_retriever_is_supported_via_maybe_await():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    async def async_retriever(question: str, tenant_id: str, manufacturer: str | None):
        return [{"doc": "async manual", "page": 1, "excerpt": "CE10 modbus timeout details"}]

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=async_retriever,
        llm=None,
    )
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert any(any(cit.get("doc") == "async manual" for cit in c.doc_citations) for c in documented)


# ── (9) graceful dependency failure ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_raising_retriever_degrades_to_needs_context_never_crashes():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    def exploding_retriever(question: str, tenant_id: str, manufacturer: str | None):
        raise RuntimeError("neon_recall unreachable")

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what wire gauge should I use?",
        _resolved_gs10(),
        store=store,
        retriever=exploding_retriever,
        llm=None,
    )
    # No fault/param/envelope fact matched AND the retriever blew up ->
    # honest NEEDS_CONTEXT, not a crash.
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT


@pytest.mark.asyncio
async def test_async_raising_retriever_also_degrades_gracefully():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    async def exploding_async_retriever(question: str, tenant_id: str, manufacturer: str | None):
        raise RuntimeError("embed sidecar down")

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=exploding_async_retriever,
        llm=None,
    )
    # The pack fact itself (CE10) still resolves deterministically even
    # though the manual retriever failed -- retrieval failure must not take
    # down the whole answer.
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented


@pytest.mark.asyncio
async def test_missing_pack_on_answer_degrades_to_needs_context():
    """resolution.pack_id names a pack that no longer loads (removed/corrupt
    between resolve and answer) -- must degrade, never raise."""
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)
    bogus = EquipmentResolution(
        status="RESOLVED",
        pack_id="not_a_real_pack_id",
        candidates=[PackCandidate(pack_id="not_a_real_pack_id", confidence="high", source="test")],
        evidence=[],
        reason="test",
        needs_context=None,
    )

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        bogus,
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )
    assert envelope.claims[0].evidence_state == EvidenceState.NEEDS_CONTEXT


@pytest.mark.asyncio
async def test_default_retriever_used_when_none_injected_does_not_crash(monkeypatch):
    """No retriever injected at all -- default_manual_retriever runs. Force a
    FAST, deterministic failure (no NEON_DATABASE_URL, an immediately-refusing
    Ollama URL) so this stays hermetic and fast rather than depending on
    ambient network/timeout behavior -- it must still degrade to [] and never
    raise or hang."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:1")  # refuses instantly, no listener

    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    envelope = await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        llm=None,
    )
    # The pack fact (CE10, deterministic, no retriever needed) still answers.
    documented = [c for c in envelope.claims if c.evidence_state == EvidenceState.DOCUMENTED]
    assert documented


# ── (2) append-only: repeated questions accumulate observations, don't overwrite ──


@pytest.mark.asyncio
async def test_repeated_questions_append_not_overwrite_the_ledger():
    store = InMemoryVisualStore()
    tenant = str(uuid.uuid4())
    session_id = await _new_session(store, tenant)

    await answer_equipment(
        session_id,
        tenant,
        "what does CE10 mean?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )
    first_count = len(await store.load_observations(session_id, tenant))

    await answer_equipment(
        session_id,
        tenant,
        "what is P09.03?",
        _resolved_gs10(),
        store=store,
        retriever=lambda q, t, m: [],
        llm=None,
    )
    second_count = len(await store.load_observations(session_id, tenant))

    assert second_count > first_count, "the second question's facts must be appended, not replace"
    # And the FIRST fact is still present/answerable.
    ce10_observations = [
        o
        for o in await store.load_observations(session_id, tenant)
        if "CE10" in (o.raw_value or "")
    ]
    assert ce10_observations
