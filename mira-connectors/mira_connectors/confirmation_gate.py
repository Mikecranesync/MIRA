"""Connector confirmation gate (Phase 6).

When a connector imports + normalizes records, MIRA must NOT silently write them into
the knowledge graph. Per TOO Invariant #4 ("LLM/import-generated edges enter as
``proposed``; promotion to ``verified`` is a human action") and Invariant #7
("confirmation over guessing"), every connector-originated mapping becomes a *proposal* a
technician confirms, corrects, or rejects.

This service implements that gate on top of MIRA's **existing** tables — no new tables:

- proposed asset / location / tag mappings → ``ai_suggestions`` rows (type ``kg_entity``),
  ``proposed_by = 'import:<provider>'``
- proposed relationships → ``relationship_proposals`` + ``relationship_evidence`` rows
  (``created_by = 'import'``), surfaced via an ``ai_suggestions`` row of type ``kg_edge``

Status transitions follow **ADR-0017** exactly:

| Action | ai_suggestions | relationship_proposals | kg_*               |
|--------|----------------|------------------------|--------------------|
| import proposes        | pending     | proposed   | (none yet)            |
| technician confirms    | accepted    | verified   | write/upsert kg_ row  |
| technician corrects    | superseded  | deprecated | (new proposal → verified) |
| technician rejects     | rejected    | rejected   | (no write)            |

On confirm of an edge the gate mirrors the Hub ``/api/proposals/[id]/decide`` route:
``relationship_proposals.status = verified`` THEN UPSERT into ``kg_relationships`` (dedupe
on tenant+source+target+type). It also writes a ``relationship_evidence`` row of type
``human_observation`` carrying the technician's confirmation — that is how "confidence
*after* confirmation" is recorded; the connector's original confidence is preserved in
``extracted_data.confidence_prior`` and never overwritten.

NOTE on the ADR-0017 helpers: ``mira_bots/shared/proposal_transition.py`` and
``mira-hub/lib/proposal-transition.ts`` do not exist yet (master-plan Phase 3 / Agent 4
owns them). Until they land, this gate's transition logic is connector-local. When they
land, ``PostgresProposalStore`` should delegate its status writes to the Python helper.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalRecord,
    CanonicalRelationship,
    RecordType,
)
from mira_connectors.store import (
    EvidenceRow,
    KgEntityRow,
    KgRelationshipRow,
    ProposalRow,
    ProposalStore,
    SuggestionRow,
    _now,
)

# Confidence that a technician's explicit confirmation adds (relationship_evidence row).
_CONFIRMATION_CONTRIBUTION = 0.4

# RecordType → (ai_suggestions entity_type label, ref_kind used by edges)
_ENTITY_KIND = {
    RecordType.ASSET: "asset",
    RecordType.LOCATION: "location",
    RecordType.TAG: "tag",
    RecordType.DOCUMENT: "document",
    RecordType.FAILURE_CODE: "failure_code",
    RecordType.PART: "part",
}


@dataclass
class ProposeResult:
    entity_suggestion_ids: list[str] = field(default_factory=list)
    edge_suggestion_ids: list[str] = field(default_factory=list)
    conflict_groups: list[list[str]] = field(default_factory=list)


@dataclass
class ConfirmResult:
    ok: bool
    suggestion_id: Optional[str] = None
    entity_id: Optional[str] = None
    relationship_proposal_id: Optional[str] = None
    kg_relationship_id: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class CorrectResult:
    ok: bool
    superseded_suggestion_id: Optional[str] = None
    new_suggestion_id: Optional[str] = None
    confirm: Optional[ConfirmResult] = None
    reason: Optional[str] = None


@dataclass
class RejectResult:
    ok: bool
    suggestion_id: Optional[str] = None
    reason: Optional[str] = None


class ConnectorConfirmationGate:
    """Routes connector-originated mappings through human confirmation into the graph."""

    def __init__(self, store: ProposalStore) -> None:
        self.store = store

    # ── propose ─────────────────────────────────────────────────────────────
    def propose(
        self,
        *,
        tenant_id: str,
        provider: str,
        entities: Optional[list[CanonicalRecord]] = None,
        relationships: Optional[list[CanonicalRelationship]] = None,
    ) -> ProposeResult:
        """Turn normalized records + derived relationships into pending proposals."""
        proposed_by = f"import:{provider}"
        result = ProposeResult()

        for rec in entities or []:
            sug = self._entity_suggestion(tenant_id, proposed_by, rec)
            result.entity_suggestion_ids.append(self.store.insert_suggestion(sug))

        result.conflict_groups = self._mark_conflicts(tenant_id)

        for rel in relationships or []:
            result.edge_suggestion_ids.append(self._propose_edge(tenant_id, proposed_by, rel))

        return result

    def _entity_suggestion(
        self, tenant_id: str, proposed_by: str, rec: CanonicalRecord
    ) -> SuggestionRow:
        ref_kind = _ENTITY_KIND.get(rec.record_type, "entity")
        conflict_key = self._conflict_key(rec)
        properties: dict[str, Any] = dict(getattr(rec, "attributes", {}) or {})
        properties.update(
            {
                "source_system": rec.source_system,
                "source_record_id": rec.source_record_id,
                "ref_kind": ref_kind,
                "natural_key": f"{ref_kind}:{rec.source_record_id}",
            }
        )
        if isinstance(rec, CanonicalAsset):
            properties.update(
                {"manufacturer": rec.manufacturer, "model": rec.model, "serial": rec.serial}
            )
        extracted = {
            "entity_type": ref_kind,
            "uns_path": rec.proposed_uns_path,  # candidate — uns.py canonicalizes on confirm
            "name": getattr(rec, "name", None) or getattr(rec, "tag_id", rec.source_record_id),
            "source_system": rec.source_system,
            "source_record_id": rec.source_record_id,
            "ref_kind": ref_kind,
            "properties": properties,
            "confidence_prior": rec.confidence,  # preserved; never overwritten on confirm
            "conflict_key": conflict_key,
        }
        risk = "safety_critical" if getattr(rec, "criticality", None) == "safety_critical" else "low"
        return SuggestionRow(
            tenant_id=tenant_id,
            suggestion_type="kg_entity",
            extracted_data=extracted,
            proposed_by=proposed_by,
            confidence=rec.confidence,
            risk_level=risk,
            source_kind="manifest_row",
            title=f"Propose {ref_kind} {extracted['name']} at {rec.proposed_uns_path or '(unresolved)'}",
            body=f"Imported from {rec.source_system} record {rec.source_record_id}.",
        )

    @staticmethod
    def _conflict_key(rec: CanonicalRecord) -> str:
        # Two systems describing the same physical device should collide here.
        serial = getattr(rec, "serial", None)
        if serial:
            return f"serial:{serial}"
        return f"{rec.source_system}:{rec.source_record_id}"

    def _mark_conflicts(self, tenant_id: str) -> list[list[str]]:
        """Group pending kg_entity suggestions by conflict_key; flag groups whose members
        propose DIFFERENT uns_paths. Conflicting mappings are preserved (not auto-rejected)
        so a human resolves them."""
        pending = self.store.list_suggestions(
            tenant_id, status="pending", suggestion_type="kg_entity"
        )
        groups: dict[str, list[SuggestionRow]] = {}
        for s in pending:
            key = s.extracted_data.get("conflict_key")
            if key:
                groups.setdefault(key, []).append(s)

        conflict_groups: list[list[str]] = []
        for key, members in groups.items():
            paths = {m.extracted_data.get("uns_path") for m in members}
            if len(members) > 1 and len(paths) > 1:
                group_id = members[0].id
                for m in members:
                    if m.extracted_data.get("conflict_group") != group_id:
                        m.extracted_data["conflict_group"] = group_id
                        self.store.update_suggestion(
                            m.id, extracted_data=m.extracted_data, _tenant_id=tenant_id
                        )
                conflict_groups.append([m.id for m in members])
        return conflict_groups

    def _propose_edge(
        self, tenant_id: str, proposed_by: str, rel: CanonicalRelationship
    ) -> str:
        evidence_dicts = [
            {
                "evidence_type": ev.evidence_type,
                "source_description": ev.source_description,
                "page_or_location": ev.page_or_location,
                "excerpt": ev.excerpt,
                "confidence_contribution": ev.confidence_contribution,
            }
            for ev in rel.evidence
        ]
        extracted: dict[str, Any] = {
            "relationship_type": rel.relationship_type,
            "source_ref": rel.source_ref,
            "source_ref_kind": rel.source_ref_kind,
            "target_ref": rel.target_ref,
            "target_ref_kind": rel.target_ref_kind,
            "confidence_prior": rel.confidence,
            "evidence": evidence_dicts,
            "reasoning": rel.reasoning,
        }

        src = self.store.resolve_entity(tenant_id, rel.source_ref, rel.source_ref_kind)
        tgt = self.store.resolve_entity(tenant_id, rel.target_ref, rel.target_ref_kind)
        if src and tgt:
            proposal_id = self._create_proposal(tenant_id, rel, src, tgt)
            extracted["relationship_proposal_id"] = proposal_id
        else:
            extracted["needs_resolution"] = True
            extracted["unresolved"] = [
                r for r, got in ((rel.source_ref, src), (rel.target_ref, tgt)) if not got
            ]

        sug = SuggestionRow(
            tenant_id=tenant_id,
            suggestion_type="kg_edge",
            extracted_data=extracted,
            proposed_by=proposed_by,
            confidence=rel.confidence,
            risk_level=rel.risk_level,
            source_kind="manifest_row",
            title=f"Propose {rel.relationship_type}: {rel.source_ref} → {rel.target_ref}",
            body=rel.reasoning or "",
        )
        return self.store.insert_suggestion(sug)

    def _create_proposal(
        self, tenant_id: str, rel: CanonicalRelationship, src_id: str, tgt_id: str
    ) -> str:
        proposal = ProposalRow(
            tenant_id=tenant_id,
            source_entity_id=src_id,
            source_entity_type=rel.source_ref_kind,
            target_entity_id=tgt_id,
            target_entity_type=rel.target_ref_kind,
            relationship_type=rel.relationship_type,
            confidence=rel.confidence,
            status="proposed",
            created_by="import",  # ADR-0017 / mig 018 vocab
            risk_level=rel.risk_level,
            requires_human_review=True,  # Invariant #4 — humans promote
            reasoning=rel.reasoning,
        )
        proposal_id = self.store.insert_proposal(proposal)
        for ev in rel.evidence:
            self.store.insert_evidence(
                EvidenceRow(
                    proposal_id=proposal_id,
                    evidence_type=ev.evidence_type,
                    source_description=ev.source_description,
                    page_or_location=ev.page_or_location,
                    excerpt=ev.excerpt,
                    confidence_contribution=ev.confidence_contribution,
                )
            )
        return proposal_id

    # ── confirm ───────────────────────────────────────────────────────────
    def confirm(
        self, tenant_id: str, suggestion_id: str, *, reviewed_by: str, note: Optional[str] = None
    ) -> ConfirmResult:
        sug = self.store.get_suggestion(tenant_id, suggestion_id)
        if sug is None:
            return ConfirmResult(ok=False, reason="not_found")
        if sug.status != "pending":
            return ConfirmResult(ok=False, reason=f"wrong_state:{sug.status}")
        reviewer = f"human:{reviewed_by}"

        if sug.suggestion_type == "kg_entity":
            entity_id = self._materialize_entity(tenant_id, sug)
            self.store.update_suggestion(
                sug.id, status="accepted", reviewed_by=reviewer, reviewed_at=_now(),
                review_note=note, _tenant_id=tenant_id,
            )
            return ConfirmResult(ok=True, suggestion_id=sug.id, entity_id=entity_id)

        if sug.suggestion_type == "kg_edge":
            return self._confirm_edge(tenant_id, sug, reviewer, note)

        return ConfirmResult(ok=False, reason=f"unsupported_type:{sug.suggestion_type}")

    def _materialize_entity(self, tenant_id: str, sug: SuggestionRow) -> str:
        ed = sug.extracted_data
        row = KgEntityRow(
            tenant_id=tenant_id,
            uns_path=ed.get("uns_path"),
            entity_type=ed.get("entity_type", "entity"),
            name=ed.get("name", sug.id),
            properties=ed.get("properties", {}),
            approval_state="verified",
            proposed_by=sug.proposed_by,
        )
        return self.store.create_entity(row)

    def _confirm_edge(
        self, tenant_id: str, sug: SuggestionRow, reviewer: str, note: Optional[str]
    ) -> ConfirmResult:
        ed = sug.extracted_data
        proposal_id = ed.get("relationship_proposal_id")

        if not proposal_id:
            # Was unresolved at propose time — try to resolve the endpoints now (the
            # entities may have been confirmed since).
            proposal_id = self._resolve_and_create_proposal(tenant_id, sug)
            if not proposal_id:
                return ConfirmResult(
                    ok=False, suggestion_id=sug.id, reason="endpoints_unresolved"
                )
            ed["relationship_proposal_id"] = proposal_id
            self.store.update_suggestion(sug.id, extracted_data=ed, _tenant_id=tenant_id)

        proposal = self.store.get_proposal(proposal_id)
        if proposal is None:
            return ConfirmResult(ok=False, suggestion_id=sug.id, reason="proposal_missing")

        # ADR-0017: proposal → verified
        self.store.update_proposal(
            proposal_id, status="verified", reviewed_by=reviewer, reviewed_at=_now(),
            _tenant_id=tenant_id,
        )
        # Confidence AFTER confirmation: a human_observation evidence row (the prior stays
        # in extracted_data.confidence_prior and on the proposal's own confidence column).
        self.store.insert_evidence(
            EvidenceRow(
                proposal_id=proposal_id,
                evidence_type="human_observation",
                source_description=f"Technician confirmation by {reviewer}",
                excerpt=note,
                confidence_contribution=_CONFIRMATION_CONTRIBUTION,
            )
        )
        # Materialize into kg_relationships (mirrors the Hub decide route).
        kg_rel_id = self.store.upsert_relationship(
            KgRelationshipRow(
                tenant_id=tenant_id,
                source_id=proposal.source_entity_id,
                target_id=proposal.target_entity_id,
                relationship_type=proposal.relationship_type,
                confidence=proposal.confidence,
                approval_state="verified",
                proposed_by=proposal.created_by,
                evidence_summary=proposal.reasoning,
            )
        )
        self.store.update_suggestion(
            sug.id, status="accepted", reviewed_by=reviewer, reviewed_at=_now(),
            review_note=note, _tenant_id=tenant_id,
        )
        return ConfirmResult(
            ok=True, suggestion_id=sug.id, relationship_proposal_id=proposal_id,
            kg_relationship_id=kg_rel_id,
        )

    def _resolve_and_create_proposal(self, tenant_id: str, sug: SuggestionRow) -> Optional[str]:
        ed = sug.extracted_data
        src = self.store.resolve_entity(tenant_id, ed["source_ref"], ed["source_ref_kind"])
        tgt = self.store.resolve_entity(tenant_id, ed["target_ref"], ed["target_ref_kind"])
        if not (src and tgt):
            return None
        proposal = ProposalRow(
            tenant_id=tenant_id,
            source_entity_id=src,
            source_entity_type=ed["source_ref_kind"],
            target_entity_id=tgt,
            target_entity_type=ed["target_ref_kind"],
            relationship_type=ed["relationship_type"],
            confidence=ed.get("confidence_prior", 0.5),
            status="proposed",
            created_by="import",
            requires_human_review=True,
            reasoning=ed.get("reasoning"),
        )
        proposal_id = self.store.insert_proposal(proposal)
        for ev in ed.get("evidence", []):
            self.store.insert_evidence(
                EvidenceRow(
                    proposal_id=proposal_id,
                    evidence_type=ev["evidence_type"],
                    source_description=ev["source_description"],
                    page_or_location=ev.get("page_or_location"),
                    excerpt=ev.get("excerpt"),
                    confidence_contribution=ev.get("confidence_contribution", 0.0),
                )
            )
        return proposal_id

    # ── correct ───────────────────────────────────────────────────────────
    def correct(
        self,
        tenant_id: str,
        suggestion_id: str,
        *,
        reviewed_by: str,
        corrections: dict[str, Any],
        note: Optional[str] = None,
    ) -> CorrectResult:
        """Technician corrects a proposal (e.g. "it's TB2-15, not TB2-14").

        ADR-0017: the original is *superseded* (and its proposal *deprecated*) — preserved,
        not deleted, so the conflicting mapping stays auditable. A new human-authored
        suggestion carrying the corrections is created and immediately confirmed.
        """
        sug = self.store.get_suggestion(tenant_id, suggestion_id)
        if sug is None:
            return CorrectResult(ok=False, reason="not_found")
        if sug.status != "pending":
            return CorrectResult(ok=False, reason=f"wrong_state:{sug.status}")
        reviewer = f"human:{reviewed_by}"

        # Supersede the original (kept for review).
        self.store.update_suggestion(
            sug.id, status="superseded", reviewed_by=reviewer, reviewed_at=_now(),
            review_note=note or "corrected", _tenant_id=tenant_id,
        )
        old_proposal_id = sug.extracted_data.get("relationship_proposal_id")
        if old_proposal_id:
            self.store.update_proposal(
                old_proposal_id, status="deprecated", reviewed_by=reviewer, reviewed_at=_now(),
                _tenant_id=tenant_id,
            )

        # Build the corrected suggestion. Drop the stale proposal link so a fresh proposal
        # is created against the corrected endpoints on confirm.
        new_ed = {**sug.extracted_data, **corrections}
        new_ed.pop("relationship_proposal_id", None)
        new_ed.pop("needs_resolution", None)
        new_ed.pop("unresolved", None)
        new_ed["corrected_from"] = sug.id
        new_sug = SuggestionRow(
            tenant_id=tenant_id,
            suggestion_type=sug.suggestion_type,
            extracted_data=new_ed,
            proposed_by=f"human:{reviewed_by}",
            confidence=sug.confidence,
            risk_level=sug.risk_level,
            source_kind="manual_entry",
            title=f"[corrected] {sug.title or ''}".strip(),
            body=f"Correction of {sug.id} by {reviewer}.",
        )
        new_id = self.store.insert_suggestion(new_sug)

        confirm = self.confirm(tenant_id, new_id, reviewed_by=reviewed_by, note=f"correction of {sug.id}")
        return CorrectResult(
            ok=confirm.ok, superseded_suggestion_id=sug.id, new_suggestion_id=new_id,
            confirm=confirm, reason=confirm.reason,
        )

    # ── reject ──────────────────────────────────────────────────────────────
    def reject(
        self, tenant_id: str, suggestion_id: str, *, reviewed_by: str, note: Optional[str] = None
    ) -> RejectResult:
        sug = self.store.get_suggestion(tenant_id, suggestion_id)
        if sug is None:
            return RejectResult(ok=False, reason="not_found")
        if sug.status != "pending":
            return RejectResult(ok=False, reason=f"wrong_state:{sug.status}")
        reviewer = f"human:{reviewed_by}"
        self.store.update_suggestion(
            sug.id, status="rejected", reviewed_by=reviewer, reviewed_at=_now(),
            review_note=note, _tenant_id=tenant_id,
        )
        proposal_id = sug.extracted_data.get("relationship_proposal_id")
        if proposal_id:
            self.store.update_proposal(
                proposal_id, status="rejected", reviewed_by=reviewer, reviewed_at=_now(),
                _tenant_id=tenant_id,
            )
        return RejectResult(ok=True, suggestion_id=sug.id)

    # ── queries ───────────────────────────────────────────────────────────
    def pending(
        self, tenant_id: str, *, suggestion_type: Optional[str] = None
    ) -> list[SuggestionRow]:
        return self.store.list_suggestions(
            tenant_id, status="pending", suggestion_type=suggestion_type
        )
