"""Control-first adversarial checks for FLEET-PEER-NETWORK-001 Slice A (Codex final audit +
devops measurement, 2026-09-07).

RULE OF THIS FILE: every negative assertion is paired with a positive control that proves the
document reaches the field under test. The control is asserted FIRST; if it fails, the row is
disqualified — a rejected control would otherwise make every variant beneath it "reject" for the
wrong reason (devops' near-miss on human_gate: two wrong conclusions in opposite directions).
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import sys
from pathlib import Path

import jsonschema
import pytest
import rfc3339_validator  # noqa: F401 — the date-time format check needs it; hard import
import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "docs" / "peer-network" / "schemas"


def _load(name: str):
    pkg_dir = ROOT / "tools" / "peer_network"
    if "peer_network_tools" not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            "peer_network_tools", pkg_dir / "__init__.py", submodule_search_locations=[str(pkg_dir)]
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["peer_network_tools"] = module
        spec.loader.exec_module(module)
    return importlib.import_module(f"peer_network_tools.{name}")


def _v(name: str) -> Draft202012Validator:
    return Draft202012Validator(
        json.loads((SCHEMAS / f"{name}.schema.json").read_text()),
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


def _control(name: str, doc: dict) -> None:
    """Positive control: the document as given MUST validate, or the row is disqualified."""
    try:
        _v(name).validate(doc)
    except jsonschema.ValidationError as exc:
        pytest.fail(f"CONTROL INVALID for {name}: {exc.message} — the row proves nothing")


def _rejects(name: str, doc: dict, match: str | None = None) -> None:
    ctx = (
        pytest.raises(jsonschema.ValidationError, match=match)
        if match
        else pytest.raises(jsonschema.ValidationError)
    )
    with ctx:
        _v(name).validate(doc)


SHA = "f5f994a78d6d2f2e9393381662804f375dc59209"
TS = "2026-09-07T03:00:00Z"

CLAIM = {
    "mission_id": "FLEET-PEER-NETWORK-001",
    "session_uuid": "sess-7f3a9c2e",
    "base_sha": SHA,
    "branch": "feat/fleet-peer-network-001a-contract",
    "worktree": "/Users/charlienode/MIRA-worktrees/fleet-peer-network-001a",
    "resource_keys": ["docs/peer-network", "tests/peer_network"],
    "lease_expires_at": TS,
    "generation": 1,
    "status": "ACTIVE",
    "claimed_at": TS,
    "created_at": TS,
    "event_id": 3391118801,
}


def _event(kind: str, payload: dict, mission: str | None = "FLEET-PEER-NETWORK-001") -> dict:
    return {
        "event_id": "evt-000000001",
        "idempotency_key": "idem-7f3a9c2e",
        "ts": TS,
        "kind": kind,
        "mission_id": mission,
        "session_uuid": "sess-7f3a9c2e",
        "payload": payload,
    }


# ------------------------------------------------------------- resource keys: schema AND helper


@pytest.mark.parametrize(
    "bad",
    [
        "docs//peer-network",
        "docs/peer-network/",
        "docs/./x",
        "docs/x/..",
        "docs/../packages/x",
        " docs/x",
        "docs/x ",
        "docs/a/b//c",
    ],
)
def test_noncanonical_keys_are_rejected_by_the_schema_itself_and_by_the_helper(bad: str) -> None:
    _control("claim", CLAIM)
    _rejects("claim", {**CLAIM, "resource_keys": [bad]})
    _control(
        "event",
        _event(
            "claim_work",
            {
                "resource_keys": ["docs/peer-network"],
                "base_sha": SHA,
                "branch": "feat/x",
                "generation": 1,
            },
        ),
    )
    _rejects(
        "event",
        _event(
            "claim_work",
            {"resource_keys": [bad], "base_sha": SHA, "branch": "feat/x", "generation": 1},
        ),
    )
    keys = _load("resource_keys")
    # The helper normalises slashes/whitespace (so those become canonical) but MUST refuse dot segments;
    # either way it never returns the noncanonical string unchanged.
    try:
        assert keys.canonicalize(bad) != bad
    except keys.InvalidResourceKey:
        pass


@pytest.mark.parametrize(
    "good", ["docs/..hidden/x", "docs/a/..b/c", "tools/peer_network", "root:AGENTS.md"]
)
def test_canonical_keys_that_merely_contain_dots_are_accepted(good: str) -> None:
    _control("claim", {**CLAIM, "resource_keys": [good]})
    assert _load("resource_keys").canonicalize(good) == good


# ------------------------------------------------------------- claim: ordering fields + nonblank locations


def test_claim_carries_and_validates_the_immutable_ordering_fields() -> None:
    _control("claim", CLAIM)
    for missing in ("created_at", "event_id"):
        doc = dict(CLAIM)
        del doc[missing]
        _rejects("claim", doc, match=missing)
    _rejects("claim", {**CLAIM, "created_at": "not-a-date"}, match="date-time")
    _rejects("claim", {**CLAIM, "event_id": 0})
    _rejects("claim", {**CLAIM, "event_id": "3391118801"})


@pytest.mark.parametrize("field", ["branch", "worktree"])
@pytest.mark.parametrize("blank", ["", " ", "   ", "\t"])
def test_claim_branch_and_worktree_reject_blank_and_whitespace(field: str, blank: str) -> None:
    _control("claim", CLAIM)
    _rejects("claim", {**CLAIM, field: blank}, match=field)


# ------------------------------------------------------------- human gate + standing authorization


GATE = {
    "gate_id": "gate-merge-3653",
    "kind": "merge",
    "mission_id": "FLEET-PEER-NETWORK-001",
    "state": "approved",
    "requested_at": TS,
    "decided_by": "mike",
    "decided_at": TS,
    "decision_ref": "https://github.com/Mikecranesync/MIRA/pull/3653#issuecomment-1",
}


@pytest.mark.parametrize("blank", ["", " ", "   "])
@pytest.mark.parametrize("field", ["decided_by", "gate_id", "decision_ref"])
def test_human_gate_authority_values_are_nonblank(field: str, blank: str) -> None:
    _control("human_gate", GATE)
    _rejects("human_gate", {**GATE, field: blank}, match=field)


def test_a_decided_gate_needs_outcome_decider_time_and_provenance() -> None:
    _control("human_gate", GATE)
    for missing in ("decided_by", "decided_at", "decision_ref"):
        doc = dict(GATE)
        del doc[missing]
        _rejects("human_gate", doc, match=missing)
    _rejects("human_gate", {**GATE, "state": "maybe"})
    pending = {
        k: v for k, v in GATE.items() if k not in ("decided_by", "decided_at", "decision_ref")
    }
    _control("human_gate", {**pending, "state": "open"})


WORK_ITEM = {
    "mission_id": "FLEET-PEER-NETWORK-001",
    "goal": "Contract + onboarding",
    "priority": 1,
    "dependencies": [],
    "acceptance_gates": [],
    "status": "proposed",
    "authorization": {"standing": True, "granted_by": "mike"},
}


@pytest.mark.parametrize("blank", ["", " ", "   "])
def test_standing_authorization_grantor_is_nonblank(blank: str) -> None:
    _control("work_item", WORK_ITEM)
    _rejects(
        "work_item",
        {**WORK_ITEM, "authorization": {"standing": True, "granted_by": blank}},
        match="granted_by",
    )


# ------------------------------------------------------------- artifacts + verdict provenance


ARTIFACT = {
    "mission_id": "FLEET-PEER-NETWORK-001",
    "kind": "verdict",
    "sha": SHA,
    "ref": "PR #3653",
    "recorded_at": TS,
    "verdict": "HOLD",
    "reviewer": "codex-ui-review",
}


def test_verdict_artifacts_require_verdict_and_reviewer_while_other_kinds_do_not() -> None:
    _control("artifact", ARTIFACT)
    for missing in ("verdict", "reviewer"):
        doc = dict(ARTIFACT)
        del doc[missing]
        _rejects("artifact", doc, match=missing)
    _rejects("artifact", {**ARTIFACT, "reviewer": "  "}, match="reviewer")
    plain = {k: v for k, v in ARTIFACT.items() if k not in ("verdict", "reviewer")}
    _control("artifact", {**plain, "kind": "commit"})


VALID_PAYLOADS: dict[str, dict] = {
    "join_network": {"node_id": "charlie", "capabilities": ["bash", "git"]},
    "heartbeat": {"lease_expires_at": TS},
    "fleet_status": {"nodes": []},
    "request_work": {"capabilities": ["bash"]},
    "claim_work": {
        "resource_keys": ["docs/peer-network"],
        "base_sha": SHA,
        "branch": "feat/x",
        "generation": 1,
    },
    "renew_claim": {"lease_expires_at": TS, "generation": 1},
    "release_claim": {"status": "RELEASED", "generation": 1},
    "submit_checkpoint": {"sha": SHA, "generation": 1},
    "request_handoff": {
        "handoff_ref": "docs/missions/FLEET-PEER-NETWORK-001/HANDOFF.md",
        "generation": 1,
    },
    "accept_handoff": {"generation": 2},
    "submit_result": {"sha": SHA, "generation": 1},
    "request_review": {"sha": SHA},
    "submit_verdict": {"sha": SHA, "verdict": "HOLD", "reviewer": "codex-ui-review"},
    "leave_network": {"reason": "context exhausted"},
    "human_gate": {
        "gate": "merge",
        "decided_by": "mike",
        "outcome": "approved",
        "decided_at": TS,
        "decision_ref": "https://github.com/Mikecranesync/MIRA/pull/3653#issuecomment-1",
    },
    "commit": {"sha": SHA},
    "release": {"version": "1.1.7", "sha": SHA},
}
MISSION_BOUND = {
    "claim_work",
    "renew_claim",
    "release_claim",
    "submit_checkpoint",
    "request_handoff",
    "accept_handoff",
    "submit_result",
    "request_review",
    "submit_verdict",
    "human_gate",
    "commit",
    "release",
}
LEASE_OPS = {
    "claim_work",
    "renew_claim",
    "release_claim",
    "submit_checkpoint",
    "request_handoff",
    "accept_handoff",
    "submit_result",
}


def test_valid_payload_table_covers_every_kind() -> None:
    kinds = set(
        json.loads((SCHEMAS / "event.schema.json").read_text())["properties"]["kind"]["enum"]
    )
    assert set(VALID_PAYLOADS) == kinds


@pytest.mark.parametrize("kind", sorted(VALID_PAYLOADS))
def test_null_mission_id_is_rejected_for_mission_bound_kinds_and_allowed_only_where_permitted(
    kind: str,
) -> None:
    _control("event", _event(kind, VALID_PAYLOADS[kind]))
    doc = _event(kind, VALID_PAYLOADS[kind], mission=None)
    if kind in MISSION_BOUND:
        _rejects("event", doc, match="mission_id|None is not of type")
    else:
        _control("event", doc)


@pytest.mark.parametrize("kind", sorted(LEASE_OPS))
def test_every_lease_operation_carries_generation(kind: str) -> None:
    _control("event", _event(kind, VALID_PAYLOADS[kind]))
    without = {k: v for k, v in VALID_PAYLOADS[kind].items() if k != "generation"}
    _rejects("event", _event(kind, without), match="generation")
    _rejects("event", _event(kind, {**VALID_PAYLOADS[kind], "generation": 0}))


def test_submit_verdict_carries_reviewer_provenance() -> None:
    _control("event", _event("submit_verdict", VALID_PAYLOADS["submit_verdict"]))
    _rejects("event", _event("submit_verdict", {"sha": SHA, "verdict": "HOLD"}), match="reviewer")
    _rejects(
        "event",
        _event("submit_verdict", {"sha": SHA, "verdict": "HOLD", "reviewer": " "}),
        match="reviewer",
    )


def test_human_gate_event_carries_outcome_time_and_provenance_with_nonblank_decider() -> None:
    _control("event", _event("human_gate", VALID_PAYLOADS["human_gate"]))
    for missing in ("outcome", "decided_at", "decision_ref"):
        partial = {k: v for k, v in VALID_PAYLOADS["human_gate"].items() if k != missing}
        _rejects("event", _event("human_gate", partial), match=missing)
    _rejects(
        "event",
        _event("human_gate", {**VALID_PAYLOADS["human_gate"], "decided_by": "   "}),
        match="decided_by",
    )


# ------------------------------------------------------------- capabilities ⊆ node inventory


def _node_caps(node_id: str) -> list[str]:
    net = yaml.safe_load((ROOT / "deployment" / "network.yml").read_text())
    nodes = net["nodes"].values() if isinstance(net.get("nodes"), dict) else net["nodes"]
    for node in nodes:
        pn = node.get("peer_network", {})
        if pn.get("node_id") == node_id:
            return list(pn["capabilities"])
    raise AssertionError(f"node {node_id} not in deployment/network.yml")


def test_session_capabilities_must_be_a_subset_of_the_node_inventory() -> None:
    caps = _load("capabilities")
    assert "adb" in _node_caps("charlie") and "adb" not in _node_caps(
        "travel"
    )  # control on the inventory itself
    assert caps.effective_capabilities(["bash", "adb"], _node_caps("charlie")) == ["adb", "bash"]
    assert caps.effective_capabilities(["bash"], _node_caps("travel")) == [
        "bash"
    ]  # less than the node is fine
    with pytest.raises(caps.CapabilityNotOnNode, match="adb"):
        caps.effective_capabilities(["bash", "adb"], _node_caps("travel"))
    with pytest.raises(caps.CapabilityNotOnNode, match="docker"):
        caps.effective_capabilities(["docker"], _node_caps("plc"))
