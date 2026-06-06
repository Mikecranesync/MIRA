"""Tests for the Phase-7 flaky-input detector + Phase-8 KG proposal loop.

detect_flaky is pure over plain event lists; an InMemoryFlakyStore exercises the
FlakyInputDetector + the proposal bridge without a live NeonDB.

Covered behaviours (PLAN.md P7 + P8):
  - stable input → no alert
  - chattering input → alert with the REAL contributing event ids as evidence
  - simulated data → alert marked simulated
  - proposal created (status='proposed') but NEVER verified
  - alert WITHOUT entity ids → alert only, no dangling proposal
  - bad-quality readings don't inflate the transition count
  - stable-peer isolation raises confidence; a co-chattering peer lowers it
  - back-link: flaky alert gets its ai_suggestion_id
"""

from __future__ import annotations

import json
from pathlib import Path

from flaky_detector import (
    HIGH,
    LOW,
    REL_HAS_SIGNAL,
    FlakyInputDetector,
    FlakyRule,
    TagEvent,
    build_proposal_spec,
    detect_flaky,
    load_rules,
)

TENANT = "t-1"
RULES_JSON = Path(__file__).parent.parent / "config" / "flaky_rules.json"


def _chatter(tag, n, *, start=0.0, step=1.0, simulated=False, quality="good", base_id="e"):
    """n transitions = n+1 readings alternating false/true."""
    out = []
    for i in range(n + 1):
        out.append(
            TagEvent(
                event_id=f"{base_id}{i}",
                tag_path=tag,
                value="true" if i % 2 else "false",
                value_type="bool",
                quality=quality,
                event_timestamp=start + i * step,
                simulated=simulated,
                uns_path="enterprise.home_garage.site.lake_wales.area.conveyor_lab"
                ".line.line_1.work_cell.conveyor_cell.equipment.conveyor_1.datapoint.pe_101",
            )
        )
    return out


def _stable(tag, *, n=5, value="true", base_id="s"):
    return [
        TagEvent(
            event_id=f"{base_id}{i}",
            tag_path=tag,
            value=value,
            value_type="bool",
            quality="good",
            event_timestamp=float(i),
        )
        for i in range(n)
    ]


# ── seed config loads ────────────────────────────────────────────────────────


def test_rules_config_loads():
    rules = load_rules(json.loads(RULES_JSON.read_text()))
    assert {r.tag_path for r in rules} == {
        "sensors/pe101/debounced",
        "sensors/pe102/debounced",
        "sensors/px101/debounced",
    }


# ── stable input → no alert ──────────────────────────────────────────────────


def test_stable_input_no_alert():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)
    findings = detect_flaky({"PE-101": _stable("PE-101")}, [rule], tenant_id=TENANT)
    assert findings == []


# ── chattering input → alert with real evidence ──────────────────────────────


def test_chattering_input_alerts_with_evidence():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)
    events = _chatter("PE-101", 8)  # 8 transitions > 6
    findings = detect_flaky({"PE-101": events}, [rule], tenant_id=TENANT)
    assert len(findings) == 1
    f = findings[0]
    assert f.transition_count == 8
    # Evidence ids are REAL event ids from the input list (not fabricated).
    real_ids = {e.event_id for e in events}
    assert f.evidence_event_ids
    assert set(f.evidence_event_ids) <= real_ids


def test_bad_quality_does_not_inflate_count():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)
    events = _chatter("PE-101", 8)
    # Corrupt half the readings to bad quality — fewer trustworthy transitions.
    for e in events[::2]:
        e.quality = "bad"
    findings = detect_flaky({"PE-101": events}, [rule], tenant_id=TENANT)
    # With every other reading dropped, the surviving same-value run yields no
    # 6+ transitions → no alert.
    assert findings == []


# ── simulated provenance ─────────────────────────────────────────────────────


def test_simulated_input_marked_simulated():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)
    events = _chatter("PE-101", 8, simulated=True)
    findings = detect_flaky({"PE-101": events}, [rule], tenant_id=TENANT)
    assert findings and findings[0].simulated is True


def test_real_input_not_marked_simulated():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)
    findings = detect_flaky({"PE-101": _chatter("PE-101", 8)}, [rule], tenant_id=TENANT)
    assert findings and findings[0].simulated is False


# ── peer isolation affects confidence ────────────────────────────────────────


def test_isolated_flicker_high_confidence():
    rule = FlakyRule(
        tag_path="PE-101", transition_threshold=6, stable_peers=["PE-102"], peer_stable_max=1
    )
    events = {"PE-101": _chatter("PE-101", 14), "PE-102": _stable("PE-102")}
    findings = detect_flaky(events, [rule], tenant_id=TENANT)
    assert findings and findings[0].confidence == HIGH
    assert findings[0].stable_peers[0].stable is True


def test_co_chattering_peer_lowers_confidence():
    rule = FlakyRule(
        tag_path="PE-101", transition_threshold=6, stable_peers=["PE-102"], peer_stable_max=1
    )
    events = {
        "PE-101": _chatter("PE-101", 8),
        "PE-102": _chatter("PE-102", 8, base_id="p"),  # peer also moving → not isolated
    }
    findings = detect_flaky(events, [rule], tenant_id=TENANT)
    assert findings and findings[0].confidence == LOW
    assert findings[0].stable_peers[0].stable is False


# ── proposal bridge (Phase 8) ────────────────────────────────────────────────


def test_proposal_built_only_with_entity_ids():
    rule_no_ids = FlakyRule(tag_path="PE-101", transition_threshold=6)
    f = detect_flaky({"PE-101": _chatter("PE-101", 8)}, [rule_no_ids], tenant_id=TENANT)[0]
    assert build_proposal_spec(f) is None  # alert-only

    rule_ids = FlakyRule(
        tag_path="PE-101",
        transition_threshold=6,
        signal_entity_id="11111111-1111-1111-1111-111111111111",
        equipment_entity_id="22222222-2222-2222-2222-222222222222",
    )
    f2 = detect_flaky({"PE-101": _chatter("PE-101", 8)}, [rule_ids], tenant_id=TENANT)[0]
    spec = build_proposal_spec(f2)
    assert spec is not None
    assert spec.relationship_type == REL_HAS_SIGNAL
    assert spec.evidence_event_ids  # carries real evidence


def test_self_loop_proposal_rejected():
    same = "33333333-3333-3333-3333-333333333333"
    rule = FlakyRule(
        tag_path="PE-101", transition_threshold=6, signal_entity_id=same, equipment_entity_id=same
    )
    f = detect_flaky({"PE-101": _chatter("PE-101", 8)}, [rule], tenant_id=TENANT)[0]
    assert build_proposal_spec(f) is None  # no_self_loop


# ── detector + in-memory store: alert + proposal, NEVER verified ─────────────


class InMemoryFlakyStore:
    def __init__(self, events):
        self._events = events
        self.alerts = []
        self.proposals = []
        self.evidence = []
        self.suggestions = []

    def load_events(self, tenant_id, tag_paths, since_ts):
        return {t: self._events.get(t, []) for t in tag_paths}

    def persist_finding(self, finding, proposal):
        from flaky_detector import PersistResult

        aid = f"alert-{len(self.alerts) + 1}"
        self.alerts.append(
            {"alert_id": aid, "tag": finding.tag_path, "status": "open",
             "simulated": finding.simulated, "evidence": finding.evidence_event_ids,
             "ai_suggestion_id": None}
        )
        res = PersistResult(alert_id=aid)
        if proposal is not None:
            pid = f"prop-{len(self.proposals) + 1}"
            # Proposal is ALWAYS proposed — the store NEVER writes 'verified'.
            self.proposals.append({"id": pid, "status": "proposed", "type": proposal.relationship_type})
            for eid in [*proposal.evidence_event_ids, aid]:
                self.evidence.append({"proposal_id": pid, "source_id": eid, "type": "live_data"})
            sid = f"sugg-{len(self.suggestions) + 1}"
            self.suggestions.append({"id": sid, "type": "kg_edge", "status": "pending"})
            self.alerts[-1]["ai_suggestion_id"] = sid
            res.proposal_id = pid
            res.suggestion_id = sid
            res.evidence_rows = len(proposal.evidence_event_ids) + 1
        return res


def test_detector_run_creates_alert_and_unverified_proposal():
    rule = FlakyRule(
        tag_path="PE-101",
        transition_threshold=6,
        signal_entity_id="11111111-1111-1111-1111-111111111111",
        equipment_entity_id="22222222-2222-2222-2222-222222222222",
    )
    store = InMemoryFlakyStore({"PE-101": _chatter("PE-101", 10)})
    detector = FlakyInputDetector(store)
    results = detector.run([rule], tenant_id=TENANT, now_ts=1000.0)

    assert len(results) == 1
    assert store.alerts[0]["status"] == "open"
    # Phase 8: a proposal was opened, and it is NOT verified.
    assert store.proposals and store.proposals[0]["status"] == "proposed"
    assert all(p["status"] != "verified" for p in store.proposals)
    # Evidence references real event ids + the alert.
    assert store.evidence
    # Back-link wired.
    assert store.alerts[0]["ai_suggestion_id"] == store.suggestions[0]["id"]


def test_detector_alert_only_when_no_entities():
    rule = FlakyRule(tag_path="PE-101", transition_threshold=6)  # no entity ids
    store = InMemoryFlakyStore({"PE-101": _chatter("PE-101", 10)})
    detector = FlakyInputDetector(store)
    results = detector.run([rule], tenant_id=TENANT, now_ts=1000.0)
    assert len(results) == 1
    assert store.alerts and not store.proposals  # alert without dangling proposal


def test_detector_requires_tenant():
    store = InMemoryFlakyStore({})
    try:
        FlakyInputDetector(store).run([FlakyRule(tag_path="X")], tenant_id="", now_ts=0.0)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "tenant" in str(exc)
