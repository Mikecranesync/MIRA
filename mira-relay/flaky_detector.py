"""Flaky-input detector on the real tag_events stream (Phases 7 + 8).

Walker DT "pattern" step. Reads the raw tag_events stream (migration 033) for
configured digital input tags, counts transitions over a rolling window, and —
when an input chatters beyond threshold — records a `flaky_input_signals` alert
(migration 034) whose `evidence_event_ids` point at the ACTUAL tag_events rows
that triggered it. A chattering prox switch, an intermittent disconnect, a
brown-out: all surface here as evidence-grounded findings.

Phase 8 closes the loop: each real alert also opens a KG `relationship_proposals`
edge (status `proposed`, never `verified`) linking the flaky tag's signal entity
to its asset/component, with `relationship_evidence` rows pointing at the
tag_events + the flaky alert, bridged through an `ai_suggestions` row of type
`kg_edge` so the Hub /proposals reviewer queue surfaces it. The graph grows ONLY
after a human approves — the detector never auto-verifies (TOO invariant; ADR-0017).

Hard rules honored:
  - NEVER auto-verify. Proposals are written at status='proposed', created_by='rule'.
  - Alerts from simulated data are marked simulated (in metadata — migration 034
    has no `simulated` column; metadata is its free-form provenance bag).
  - Evidence is real: evidence_event_ids are tag_events.event_id values, never
    fabricated.
  - Alerts do NOT push to Slack — they land in the reviewer queue (alarm-fatigue
    avoidance, master plan Phase 9).

Design mirrors tag_ingest.py / tag_diff_logger.py: a pure detection function
(`detect_flaky`) over plain event lists, plus a store-agnostic `FlakyInputDetector`
that reads/writes through an injected `FlakyStore`. `NeonFlakyStore` is prod;
tests inject an in-memory store and verify the counting / peer / proposal logic
without a live NeonDB.

Runtime trigger (the worker/cron that calls run() against the live window) is a
documented Phase-9 follow-up — see PLAN.md / HANDOFF. This ships the detection +
proposal logic + store boundary + tests.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

logger = logging.getLogger("mira-relay.flaky_detector")

_GOOD_QUALITY = "good"

# Confidence bands (match the UNS-resolver / flaky_input_signals convention).
LOW, MEDIUM, HIGH = "low", "medium", "high"

# KG vocab (must match mig 018 controlled vocabulary).
REL_HAS_SIGNAL = "HAS_SIGNAL"
EVIDENCE_LIVE_DATA = "live_data"


# ── Inputs ───────────────────────────────────────────────────────────────────


@dataclass
class TagEvent:
    """One tag_events row, as the detector reads it."""

    event_id: str
    tag_path: str
    value: Optional[str]
    value_type: str
    quality: str
    event_timestamp: float
    simulated: bool = False
    uns_path: Optional[str] = None


@dataclass
class FlakyRule:
    """Detection rule for one digital input tag.

    transition_threshold : transitions in the window above which the input is
                           flagged.
    window_seconds       : the rolling window.
    stable_peers         : peer tag paths expected to stay stable; if a peer
                           also chatters the instability is NOT isolated, which
                           lowers confidence (or, if all peers move, suggests a
                           plant-wide event rather than a flaky input).
    peer_stable_max      : a peer with <= this many transitions counts "stable".
    equipment_entity_id  : the asset/component kg_entities.id this input belongs
                           to (proposal target). None → alert only, no proposal.
    signal_entity_id     : the signal's kg_entities.id (proposal source). None →
                           alert only, no proposal.
    risk_level           : proposal/suggestion risk tier.
    """

    tag_path: str
    transition_threshold: int = 6
    window_seconds: float = 60.0
    stable_peers: list[str] = field(default_factory=list)
    peer_stable_max: int = 1
    equipment_entity_id: Optional[str] = None
    signal_entity_id: Optional[str] = None
    risk_level: str = "medium"

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "FlakyRule":
        return cls(
            tag_path=raw["tag_path"],
            transition_threshold=int(raw.get("transition_threshold", 6)),
            window_seconds=float(raw.get("window_seconds", 60.0)),
            stable_peers=list(raw.get("stable_peers") or []),
            peer_stable_max=int(raw.get("peer_stable_max", 1)),
            equipment_entity_id=raw.get("equipment_entity_id"),
            signal_entity_id=raw.get("signal_entity_id"),
            risk_level=raw.get("risk_level", "medium"),
        )


def load_rules(raw: dict[str, Any]) -> list[FlakyRule]:
    return [FlakyRule.from_dict(r) for r in (raw.get("rules") or [])]


# ── Output ───────────────────────────────────────────────────────────────────


@dataclass
class PeerObservation:
    tag_path: str
    transition_count: int
    stable: bool


@dataclass
class FlakyFinding:
    tenant_id: str
    tag_path: str
    transition_count: int
    window_seconds: float
    evidence_event_ids: list[str]
    confidence: str
    simulated: bool
    uns_path: Optional[str] = None
    stable_peers: list[PeerObservation] = field(default_factory=list)
    rule: Optional[FlakyRule] = None

    @property
    def window_label(self) -> str:
        s = int(self.window_seconds)
        if s % 3600 == 0:
            return f"{s // 3600}h"
        if s % 60 == 0:
            return f"{s // 60}m"
        return f"{s}s"


# ── Value coercion + transition counting ─────────────────────────────────────


def _as_bool(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("true", "1", "on", "1.0"):
        return True
    if v in ("false", "0", "off", "0.0"):
        return False
    return None


def _count_transitions(events: list[TagEvent]) -> tuple[int, list[str]]:
    """Count 0↔1 transitions across good-quality readings (time-ordered).

    Returns (count, contributing_event_ids). A contributing event is one whose
    value differs from the previous good reading — i.e. the rows that prove the
    chatter.
    """
    ordered = sorted(events, key=lambda e: e.event_timestamp)
    prev: Optional[bool] = None
    prev_id: Optional[str] = None
    count = 0
    evidence: list[str] = []
    for e in ordered:
        if e.quality != _GOOD_QUALITY:
            continue
        b = _as_bool(e.value)
        if b is None:
            continue
        if prev is not None and b != prev:
            count += 1
            # Both endpoints of the transition are evidence.
            if prev_id and prev_id not in evidence:
                evidence.append(prev_id)
            evidence.append(e.event_id)
        prev = b
        prev_id = e.event_id
    return count, evidence


def _confidence(transition_count: int, threshold: int, peers: list[PeerObservation]) -> str:
    """Band the finding. Isolation (peers stable) raises confidence; peers also
    moving lowers it (could be a plant-wide event, not a flaky input)."""
    margin = transition_count - threshold
    peers_all_stable = bool(peers) and all(p.stable for p in peers)
    peers_any_moved = any(not p.stable for p in peers)

    if peers_any_moved:
        return LOW  # not isolated — suspect a shared cause
    if margin >= threshold or peers_all_stable:
        return HIGH
    if margin >= 0:
        return MEDIUM
    return LOW


# ── Core detection ───────────────────────────────────────────────────────────


def detect_flaky(
    events_by_tag: dict[str, list[TagEvent]],
    rules: list[FlakyRule],
    *,
    tenant_id: str,
) -> list[FlakyFinding]:
    """Pure detection: given windowed events per tag and the rules, return
    findings for tags whose transition count exceeds threshold.

    The caller is responsible for having already filtered events to the rule's
    window (NeonFlakyStore.load_events does this with `since`). Peer counts are
    computed from the same event map.
    """
    findings: list[FlakyFinding] = []
    for rule in rules:
        events = events_by_tag.get(rule.tag_path) or []
        count, evidence = _count_transitions(events)
        if count < rule.transition_threshold:
            continue

        peers: list[PeerObservation] = []
        for peer in rule.stable_peers:
            p_count, _ = _count_transitions(events_by_tag.get(peer) or [])
            peers.append(
                PeerObservation(
                    tag_path=peer,
                    transition_count=p_count,
                    stable=p_count <= rule.peer_stable_max,
                )
            )

        # Provenance: simulated iff ANY contributing reading is simulated. A
        # finding mixing sim + real is conservatively marked simulated so it is
        # never trusted as real evidence.
        simulated = any(
            e.simulated for e in events if e.event_id in set(evidence)
        )
        uns_path = next((e.uns_path for e in events if e.uns_path), None)

        findings.append(
            FlakyFinding(
                tenant_id=tenant_id,
                tag_path=rule.tag_path,
                transition_count=count,
                window_seconds=rule.window_seconds,
                evidence_event_ids=evidence,
                confidence=_confidence(count, rule.transition_threshold, peers),
                simulated=simulated,
                uns_path=uns_path,
                stable_peers=peers,
                rule=rule,
            )
        )
    return findings


# ── Proposal spec (Phase 8) ──────────────────────────────────────────────────


@dataclass
class ProposalSpec:
    """The KG edge a finding proposes. Built only when the rule supplies both
    entity ids — a dangling proposal (no real kg_entities) would not render in
    Hub /proposals (it LEFT JOINs kg_entities). status is ALWAYS 'proposed'."""

    tenant_id: str
    source_entity_id: str            # the signal entity (kg_entities.id)
    target_entity_id: str            # the asset/component entity (kg_entities.id)
    relationship_type: str
    confidence: float
    risk_level: str
    reasoning: str
    evidence_event_ids: list[str]
    simulated: bool


def build_proposal_spec(finding: FlakyFinding) -> Optional[ProposalSpec]:
    """Map a finding to a KG edge proposal, or None when the rule lacks the
    entity ids needed for a non-dangling proposal (alert-only path)."""
    rule = finding.rule
    if rule is None or not rule.signal_entity_id or not rule.equipment_entity_id:
        return None
    if rule.signal_entity_id == rule.equipment_entity_id:
        # mig 018 no_self_loop CHECK — never propose a self-edge.
        return None
    conf = {LOW: 0.3, MEDIUM: 0.55, HIGH: 0.8}[finding.confidence]
    reasoning = (
        f"Detected {finding.transition_count} transitions on {finding.tag_path} "
        f"within {finding.window_label} (threshold {rule.transition_threshold}). "
        f"Proposed flaky/unstable signal relationship for human review."
    )
    return ProposalSpec(
        tenant_id=finding.tenant_id,
        source_entity_id=rule.signal_entity_id,
        target_entity_id=rule.equipment_entity_id,
        relationship_type=REL_HAS_SIGNAL,
        confidence=conf,
        risk_level=rule.risk_level,
        reasoning=reasoning,
        evidence_event_ids=finding.evidence_event_ids,
        simulated=finding.simulated,
    )


# ── Store boundary ───────────────────────────────────────────────────────────


@dataclass
class PersistResult:
    alert_id: str
    proposal_id: Optional[str] = None
    suggestion_id: Optional[str] = None
    evidence_rows: int = 0


class FlakyStore(Protocol):
    """Persistence boundary. NeonFlakyStore is prod; tests inject in-memory."""

    def load_events(
        self, tenant_id: str, tag_paths: list[str], since_ts: float
    ) -> dict[str, list[TagEvent]]:
        """Return tag_events at/after since_ts, grouped by tag_path."""
        ...

    def persist_finding(
        self, finding: FlakyFinding, proposal: Optional[ProposalSpec]
    ) -> PersistResult:
        """Write the flaky alert (+ optional proposal/evidence/suggestion) in one
        transaction. The proposal, when present, is INSERT-only at
        status='proposed' — NEVER verified."""
        ...


class FlakyInputDetector:
    """Reads windowed tag_events, detects flaky inputs, records alerts +
    (Phase 8) opens KG proposals. Never auto-verifies."""

    def __init__(self, store: FlakyStore) -> None:
        self.store = store

    def run(
        self, rules: list[FlakyRule], *, tenant_id: str, now_ts: float
    ) -> list[PersistResult]:
        if not tenant_id:
            raise ValueError("tenant_required")
        if not rules:
            return []
        # Read enough history to cover the widest window, for every tag + peer.
        widest = max(r.window_seconds for r in rules)
        since = now_ts - widest
        tags = sorted(
            {r.tag_path for r in rules} | {p for r in rules for p in r.stable_peers}
        )
        events_by_tag = self.store.load_events(tenant_id, tags, since)

        results: list[PersistResult] = []
        for finding in detect_flaky(events_by_tag, rules, tenant_id=tenant_id):
            proposal = build_proposal_spec(finding)
            res = self.store.persist_finding(finding, proposal)
            results.append(res)
            logger.info(
                "FLAKY_ALERT tenant=%s tag=%s transitions=%d conf=%s simulated=%s "
                "proposal=%s",
                tenant_id,
                finding.tag_path,
                finding.transition_count,
                finding.confidence,
                finding.simulated,
                res.proposal_id or "none",
            )
        return results


# ──────────────────────────────────────────────────────────────────────────
# NeonFlakyStore — prod persistence (SQLAlchemy NullPool + RLS), same pattern
# as tag_ingest.NeonTagStore. The write is ONE transaction:
#   flaky_input_signals → relationship_proposals → relationship_evidence
#   → ai_suggestions → UPDATE flaky_input_signals.ai_suggestion_id
# All proposals are INSERT-only at status='proposed'. Lazy sqlalchemy import.
# ──────────────────────────────────────────────────────────────────────────


class NeonFlakyStore:
    def __init__(self, neon_url: str) -> None:
        self.neon_url = neon_url

    def _engine(self):
        from sqlalchemy import NullPool, create_engine

        return create_engine(
            self.neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    def load_events(
        self, tenant_id: str, tag_paths: list[str], since_ts: float
    ) -> dict[str, list[TagEvent]]:
        if not tag_paths:
            return {}
        from sqlalchemy import text

        engine = self._engine()
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            rows = conn.execute(
                text(
                    """
                    SELECT event_id::text AS event_id, tag_path, value, value_type,
                           quality, simulated, uns_path::text AS uns_path,
                           EXTRACT(EPOCH FROM event_timestamp) AS ts
                      FROM tag_events
                     WHERE tenant_id = :tid
                       AND tag_path = ANY(:tags)
                       AND event_timestamp >= to_timestamp(:since)
                     ORDER BY event_timestamp
                    """
                ),
                {"tid": tenant_id, "tags": tag_paths, "since": since_ts},
            ).mappings().all()
        out: dict[str, list[TagEvent]] = {}
        for r in rows:
            out.setdefault(r["tag_path"], []).append(
                TagEvent(
                    event_id=r["event_id"],
                    tag_path=r["tag_path"],
                    value=r["value"],
                    value_type=r["value_type"],
                    quality=r["quality"],
                    event_timestamp=float(r["ts"]),
                    simulated=bool(r["simulated"]),
                    uns_path=r["uns_path"],
                )
            )
        return out

    def persist_finding(
        self, finding: FlakyFinding, proposal: Optional[ProposalSpec]
    ) -> PersistResult:
        import json

        from sqlalchemy import text

        tid = finding.tenant_id
        with self._engine().begin() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tid})

            alert_id = conn.execute(
                text(
                    """
                    INSERT INTO flaky_input_signals
                        (tenant_id, uns_path, source_tag_path, detection_window,
                         transition_count, stable_peer_tags, confidence,
                         evidence_event_ids, status, metadata)
                    VALUES
                        (:tid, CAST(:uns AS LTREE), :tag, :window,
                         :tc, CAST(:peers AS JSONB), :conf,
                         CAST(:evidence AS JSONB), 'open', CAST(:meta AS JSONB))
                    RETURNING alert_id::text
                    """
                ),
                {
                    "tid": tid,
                    "uns": finding.uns_path,
                    "tag": finding.tag_path,
                    "window": finding.window_label,
                    "tc": finding.transition_count,
                    "peers": json.dumps(
                        [
                            {"tag_path": p.tag_path, "transitions": p.transition_count, "stable": p.stable}
                            for p in finding.stable_peers
                        ]
                    ),
                    "conf": finding.confidence,
                    "evidence": json.dumps(finding.evidence_event_ids),
                    # mig 034 has no `simulated` column — provenance lives in metadata.
                    "meta": json.dumps({"simulated": finding.simulated, "source": "flaky_input_detector"}),
                },
            ).scalar()

            result = PersistResult(alert_id=alert_id)
            if proposal is None:
                return result

            # Phase 8: open a KG edge proposal (status='proposed' — NEVER verified).
            proposal_id = conn.execute(
                text(
                    """
                    INSERT INTO relationship_proposals
                        (tenant_id, source_entity_id, source_entity_type,
                         target_entity_id, target_entity_type, relationship_type,
                         confidence, status, created_by, risk_level,
                         requires_human_review, reasoning)
                    VALUES
                        (:tid, CAST(:src AS UUID), 'signal',
                         CAST(:tgt AS UUID), 'equipment', :rtype,
                         :conf, 'proposed', 'rule', :risk, true, :reason)
                    RETURNING id::text
                    """
                ),
                {
                    "tid": tid,
                    "src": proposal.source_entity_id,
                    "tgt": proposal.target_entity_id,
                    "rtype": proposal.relationship_type,
                    "conf": proposal.confidence,
                    "risk": proposal.risk_level,
                    "reason": proposal.reasoning,
                },
            ).scalar()
            result.proposal_id = proposal_id

            # Evidence: one row per contributing tag_events row + one for the
            # flaky alert itself. evidence_type='live_data' (mig 018 vocab).
            ev_params = [
                {
                    "pid": proposal_id,
                    "etype": EVIDENCE_LIVE_DATA,
                    "sid": eid,
                    "desc": f"tag_events row proving transition on {finding.tag_path}",
                    "loc": f"tag_events.event_id={eid}",
                    "excerpt": None,
                    "contrib": 0.15,
                }
                for eid in proposal.evidence_event_ids
            ]
            ev_params.append(
                {
                    "pid": proposal_id,
                    "etype": EVIDENCE_LIVE_DATA,
                    "sid": alert_id,
                    "desc": f"flaky_input_signals alert ({finding.transition_count} transitions)",
                    "loc": f"flaky_input_signals.alert_id={alert_id}",
                    "excerpt": None,
                    "contrib": 0.25,
                }
            )
            conn.execute(
                text(
                    """
                    INSERT INTO relationship_evidence
                        (proposal_id, evidence_type, source_id, source_description,
                         page_or_location, excerpt, confidence_contribution)
                    VALUES
                        (CAST(:pid AS UUID), :etype, CAST(:sid AS UUID), :desc,
                         :loc, :excerpt, :contrib)
                    """
                ),
                ev_params,
            )
            result.evidence_rows = len(ev_params)

            # ai_suggestions header (type kg_edge) so Hub /proposals surfaces it.
            suggestion_id = conn.execute(
                text(
                    """
                    INSERT INTO ai_suggestions
                        (tenant_id, suggestion_type, source_kind, source_id,
                         extracted_data, confidence, status, risk_level,
                         proposed_by, title, body)
                    VALUES
                        (:tid, 'kg_edge', 'live_event', CAST(:sid AS UUID),
                         CAST(:data AS JSONB), :conf, 'pending', :risk,
                         'rule:flaky_input_detector', :title, :body)
                    RETURNING id::text
                    """
                ),
                {
                    "tid": tid,
                    "sid": (proposal.evidence_event_ids or [alert_id])[0],
                    "data": json.dumps(
                        {
                            "relationship_proposal_id": proposal_id,
                            "relationship_type": proposal.relationship_type,
                            "flaky_alert_id": alert_id,
                            "simulated": finding.simulated,
                        }
                    ),
                    "conf": proposal.confidence,
                    "risk": proposal.risk_level,
                    "title": f"Flaky signal: {finding.tag_path}",
                    "body": proposal.reasoning,
                },
            ).scalar()
            result.suggestion_id = suggestion_id

            # Back-link the alert to its reviewer-queue row.
            conn.execute(
                text(
                    "UPDATE flaky_input_signals SET ai_suggestion_id = CAST(:sid AS UUID), "
                    "updated_at = NOW() WHERE alert_id = CAST(:aid AS UUID)"
                ),
                {"sid": suggestion_id, "aid": alert_id},
            )
            return result
