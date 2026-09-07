"""Executable semantics of the peer-network contract (FLEET-PEER-NETWORK-001, Codex packet):

canonical resource keys + overlap, the claim race ordered by server-stamped creation time
(never by self-reported `claimed_at`), lease validity per state, handoff, scope expansion,
real date-time format checking, patterned identities, per-session capabilities and per-kind
event payload proofs. Every rejection here is a mutation that would otherwise pass silently.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import jsonschema
import pytest
import rfc3339_validator  # noqa: F401 — FormatChecker needs it to reject bad date-times; hard import
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]


def _load_peer_network_tools():
    """Load tools/peer_network by FILE PATH. `tools` is a bare namespace package that resolves to
    whichever tools/ directory is first on sys.path under pytest (see the `runner` collision,
    #3089), so a name import here would be a latent false-red/false-green; the path is exact."""
    import importlib
    import importlib.util

    pkg_dir = ROOT / "tools" / "peer_network"
    spec = importlib.util.spec_from_file_location(
        "peer_network_tools", pkg_dir / "__init__.py", submodule_search_locations=[str(pkg_dir)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["peer_network_tools"] = module
    spec.loader.exec_module(module)
    return importlib.import_module("peer_network_tools.claims"), importlib.import_module(
        "peer_network_tools.resource_keys"
    )


_claims, _keys = _load_peer_network_tools()
Claim = _claims.Claim
accept_handoff = _claims.accept_handoff
may_edit = _claims.may_edit
may_push = _claims.may_push
resolve_race = _claims.resolve_race
scope_expansion = _claims.scope_expansion
InvalidResourceKey = _keys.InvalidResourceKey
canonicalize = _keys.canonicalize
covers = _keys.covers
keys_conflict = _keys.keys_conflict
overlaps = _keys.overlaps

SCHEMAS = ROOT / "docs" / "peer-network" / "schemas"


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(_schema(name), format_checker=Draft202012Validator.FORMAT_CHECKER)


# ---------------------------------------------------------------- resource keys


@pytest.mark.parametrize(
    "canonical",
    [
        "docs/..hidden/x",  # a name that merely STARTS with dots is a real segment, not traversal
        "docs/a/..b/c",
        "packages/factorylm-ui",
        "migration:next",
        "root:CLAUDE.md",
        "docs/peer-network",
        "deployment/network.yml",
    ],
)
def test_canonicalize_accepts_already_canonical_keys_unchanged(canonical: str) -> None:
    # An already-canonical key is returned verbatim — canonicalize validates, it does not repair.
    assert canonicalize(canonical) == canonical


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        # F1 (Codex HOLD): noncanonical raw forms the schema rejects — the resolver used to
        # silently normalise these, letting a claim mean two things across the race. Now rejected.
        " docs/peer-network/ ",  # surrounding whitespace + trailing slash
        " docs/x",  # leading whitespace (Codex probe)
        "docs/x ",  # trailing whitespace
        "docs//peer-network///schemas",  # duplicate slashes
        "docs//x",  # duplicate slash (Codex probe)
        "docs/x/",  # trailing slash (Codex probe)
        # traversal / free text / unknown families (unchanged)
        "docs/a/./b",
        "docs/a/b/..",
        "docs/../packages/factorylm-ui",
        "docs/./x",
        "packages/factorylm-ui/src",  # packages are claimed whole, never by sub-path
        "some free text",
        "root:README.md",
        "environment:qa",
    ],
)
def test_canonicalize_rejects_noncanonical_traversal_free_text_and_unknown_families(
    bad: str,
) -> None:
    with pytest.raises(InvalidResourceKey):
        canonicalize(bad)


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("docs/peer-network", "docs/peer-network/schemas/x.json", True),
        ("docs/peer-network/schemas/x.json", "docs/peer-network", True),  # symmetric
        ("docs/peer-network", "docs/peer-network", True),
        ("docs/peer-network", "docs/peer-networking", False),  # segment, not prefix
        ("docs/peer-network", "tests/peer_network", False),
        ("packages/factorylm-ui", "packages/factorylm-theme", False),
        ("mira-mobile", "mira-mobile", True),
        ("mira-mobile", "mira-hub", False),
        ("migration:next", "migration:next", True),
        ("environment:staging", "environment:prod", False),
    ],
)
def test_overlap_is_equality_or_path_ancestry(a: str, b: str, expected: bool) -> None:
    assert overlaps(a, b) is expected


def test_keys_conflict_lists_every_overlapping_pair() -> None:
    assert keys_conflict(
        ["docs/peer-network", "mira-mobile"], ["docs/peer-network/x", "mira-hub"]
    ) == [("docs/peer-network", "docs/peer-network/x")]
    assert keys_conflict(["packages/factorylm-ui"], ["packages/factorylm-theme"]) == []


# ---------------------------------------------------------------- claims


def _claim(
    session: str,
    created: str,
    event_id: int,
    *,
    claimed_at: str = "2026-09-07T01:00:00Z",
    keys=("docs/peer-network",),
    status="ACTIVE",
    generation=1,
) -> Claim:
    return Claim(
        "FLEET-PEER-NETWORK-001",
        session,
        tuple(keys),
        created,
        event_id,
        claimed_at,
        status,
        generation,
    )


def test_race_is_won_by_server_creation_time_not_by_backdated_claimed_at() -> None:
    honest = _claim("s-honest", "2026-09-07T01:00:00Z", 100, claimed_at="2026-09-07T01:00:00Z")
    backdater = _claim(
        "s-backdater", "2026-09-07T01:00:30Z", 101, claimed_at="2026-09-01T00:00:00Z"
    )
    assert resolve_race(backdater, [honest]).session_uuid == "s-honest"
    assert resolve_race(honest, [backdater]).session_uuid == "s-honest"


def test_race_tie_on_creation_time_breaks_on_server_event_id() -> None:
    a = _claim("s-a", "2026-09-07T01:00:00Z", 200)
    b = _claim("s-b", "2026-09-07T01:00:00Z", 199)
    assert resolve_race(a, [b]).session_uuid == "s-b"


def test_race_ignores_claims_that_no_longer_hold_a_lease() -> None:
    released = _claim("s-early", "2026-09-07T00:00:00Z", 1, status="RELEASED")
    at_risk = _claim("s-risk", "2026-09-07T00:00:01Z", 2, status="LEASE_AT_RISK")
    live = _claim("s-live", "2026-09-07T00:00:02Z", 3)
    assert resolve_race(live, [released, at_risk]).session_uuid == "s-live"
    assert resolve_race(released, [live]) is None  # a dead lease has no race to win


@pytest.mark.parametrize(
    ("status", "edit", "push"),
    [
        ("ACTIVE", True, True),
        ("BLOCKED", True, False),
        ("LEASE_AT_RISK", False, False),
        ("RELEASED", False, False),
        ("COMPLETE", False, False),
    ],
)
def test_lease_semantics_per_state(status: str, edit: bool, push: bool) -> None:
    c = _claim("s", "2026-09-07T01:00:00Z", 1, status=status)
    assert may_edit(c) is edit
    assert may_push(c) is push


def test_handoff_keeps_mission_and_keys_and_increments_generation() -> None:
    c = _claim("s-old", "2026-09-07T01:00:00Z", 1, generation=3)
    resumed = accept_handoff(c, "s-new")
    assert (
        resumed.mission_id,
        resumed.resource_keys,
        resumed.generation,
        resumed.session_uuid,
    ) == (
        c.mission_id,
        c.resource_keys,
        4,
        "s-new",
    )
    with pytest.raises(ValueError):
        accept_handoff(_claim("s", "2026-09-07T01:00:00Z", 1, status="RELEASED"), "s-new")


def test_resume_from_a_blocked_lease_keeps_the_claim_and_the_block() -> None:
    """BLOCKED holds the lease, so a handoff (context exhaustion mid-gate) resumes the SAME claim
    in the same state: the new session inherits the block, it does not get a fresh ACTIVE lease
    and it does not lose the queue position (created_at/event_id are unchanged)."""
    blocked = _claim("s-old", "2026-09-07T01:00:00Z", 7, status="BLOCKED", generation=2)
    resumed = accept_handoff(blocked, "s-new")
    assert resumed.status == "BLOCKED"
    assert (resumed.created_at, resumed.event_id, resumed.generation) == (
        "2026-09-07T01:00:00Z",
        7,
        3,
    )
    assert may_edit(resumed) and not may_push(resumed)
    later = _claim("s-later", "2026-09-07T01:00:01Z", 8)
    assert resolve_race(later, [resumed]).session_uuid == "s-new"


def test_disjoint_claims_are_not_in_the_same_race_so_both_win() -> None:
    a = _claim("s-a", "2026-09-07T01:00:00Z", 1, keys=("docs/peer-network",))
    b = _claim("s-b", "2026-09-07T01:00:05Z", 2, keys=("mira-mobile",))
    assert resolve_race(a, [b]).session_uuid == "s-a"
    assert (
        resolve_race(b, [a]).session_uuid == "s-b"
    )  # later, but disjoint: still wins its own race


def test_overlapping_claims_share_one_race_even_across_parent_and_child_keys() -> None:
    parent = _claim("s-parent", "2026-09-07T01:00:00Z", 1, keys=("docs/peer-network",))
    child = _claim("s-child", "2026-09-07T01:00:05Z", 2, keys=("docs/peer-network/schemas/x.json",))
    assert resolve_race(child, [parent]).session_uuid == "s-parent"
    assert resolve_race(parent, [child]).session_uuid == "s-parent"


def test_child_after_parent_is_covered_but_parent_after_child_needs_a_new_claim() -> None:
    holds_parent = _claim("s", "2026-09-07T01:00:00Z", 1, keys=("docs/peer-network",))
    assert scope_expansion(holds_parent, ["docs/peer-network/schemas/x.json"]) == []
    holds_child = _claim("s", "2026-09-07T01:00:00Z", 1, keys=("docs/peer-network/schemas",))
    assert scope_expansion(holds_child, ["docs/peer-network"]) == ["docs/peer-network"]
    assert scope_expansion(holds_child, ["docs/peer-network/schemas"]) == []  # equal is covered
    assert covers("docs/peer-network", "docs/peer-network/x") and not covers(
        "docs/peer-network/x", "docs/peer-network"
    )


def test_scope_expansion_names_only_the_keys_a_new_claim_must_cover() -> None:
    c = _claim("s", "2026-09-07T01:00:00Z", 1, keys=("docs/peer-network", "mira-mobile"))
    assert scope_expansion(
        c, ["docs/peer-network/schemas/x.json", "mira-mobile", "tests/peer_network", "mira-hub"]
    ) == [
        "tests/peer_network",
        "mira-hub",
    ]
    with pytest.raises(InvalidResourceKey):
        scope_expansion(c, ["docs/../mira-hub"])


# ---------------------------------------------------------------- schema proofs

SESSION_OK = {
    "session_uuid": "sess-7f3a9c2e",
    "provider": "claude",
    "node_id": "charlie",
    "mission_id": "FLEET-PEER-NETWORK-001",
    "state": "working",
    "context_budget": {"used_pct": 12.5, "turns": 40},
    "last_heartbeat": "2026-09-07T01:00:00Z",
    "capabilities": ["bash", "git", "gh", "write", "worktree"],
}


def _session_schema_fields() -> dict:
    return _schema("session")["properties"]


@pytest.fixture
def session_doc() -> dict:
    # Fill any schema-required field this fixture doesn't name with a permissive value so a
    # rejection can only come from the field under test.
    doc = dict(SESSION_OK)
    props = _session_schema_fields()
    for key in _schema("session")["required"]:
        if key not in doc:
            doc[key] = {
                "string": "x",
                "object": {},
                "array": [],
                "integer": 1,
                "boolean": True,
            }.get(
                props[key].get("type") if isinstance(props[key].get("type"), str) else "string", "x"
            )
    return doc


def test_format_checker_actually_rejects_a_bad_date_time(session_doc: dict) -> None:
    """Without rfc3339-validator the `date-time` format is a no-op and this passes silently."""
    _validator("session").validate(session_doc)
    with pytest.raises(jsonschema.ValidationError, match="date-time"):
        _validator("session").validate({**session_doc, "last_heartbeat": "not-a-date"})


def test_session_carries_its_own_capabilities(session_doc: dict) -> None:
    schema = _schema("session")
    assert "capabilities" in schema["required"]
    assert (
        schema["properties"]["capabilities"]["items"]["enum"]
        == _schema("node")["properties"]["capabilities"]["items"]["enum"]
    )
    v = _validator("session")
    bad = dict(session_doc)
    del bad["capabilities"]
    with pytest.raises(jsonschema.ValidationError, match="capabilities"):
        v.validate(bad)
    with pytest.raises(jsonschema.ValidationError):
        v.validate({**session_doc, "capabilities": []})
    with pytest.raises(jsonschema.ValidationError):
        v.validate({**session_doc, "capabilities": ["telepathy"]})


EVENT_OK = {
    "event_id": "evt-000000001",
    "idempotency_key": "idem-7f3a9c2e",
    "ts": "2026-09-07T01:00:00Z",
    "kind": "heartbeat",
    "mission_id": "FLEET-PEER-NETWORK-001",
    "session_uuid": "sess-7f3a9c2e",
    "payload": {"lease_expires_at": "2026-09-07T01:30:00Z"},
}


@pytest.mark.parametrize("field", ["event_id", "idempotency_key", "session_uuid", "mission_id"])
@pytest.mark.parametrize("bad", ["", "   ", "x", "has space here", "short"])
def test_event_identities_are_patterned_not_prose(field: str, bad: str) -> None:
    v = _validator("event")
    v.validate(EVENT_OK)
    with pytest.raises(jsonschema.ValidationError, match=field):
        v.validate({**EVENT_OK, field: bad})


def test_claim_and_artifact_identities_are_patterned() -> None:
    for name, field in (
        ("claim", "session_uuid"),
        ("claim", "mission_id"),
        ("artifact", "mission_id"),
        ("session", "session_uuid"),
        ("session", "mission_id"),
    ):
        assert "pattern" in _schema(name)["properties"][field], f"{name}.{field} has no pattern"


def test_every_event_kind_has_a_fail_closed_payload_proof() -> None:
    schema = _schema("event")
    kinds = set(schema["properties"]["kind"]["enum"])
    covered: set[str] = set()
    for clause in schema["allOf"]:
        k = clause["if"]["properties"]["kind"]
        if "payload" not in clause["then"]["properties"]:
            continue  # the mission-bound clause constrains mission_id, not the payload
        covered |= set(k.get("enum", [k["const"]] if "const" in k else []))
        payload = clause["then"]["properties"]["payload"]
        assert payload.get("required"), f"{k}: a payload proof must REQUIRE something"
        for req in payload["required"]:
            spec = payload["properties"][req]
            assert any(
                key in spec
                for key in ("pattern", "enum", "format", "minLength", "minItems", "minimum", "type")
            ), (req, spec)
    assert covered == kinds, sorted(kinds - covered)


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("claim_work", {"resource_keys": [], "base_sha": "f" * 40, "branch": "b", "generation": 1}),
        (
            "claim_work",
            {"resource_keys": ["free text"], "base_sha": "f" * 40, "branch": "b", "generation": 1},
        ),
        (
            "claim_work",
            {
                "resource_keys": ["docs/peer-network"],
                "base_sha": "short",
                "branch": "b",
                "generation": 1,
            },
        ),
        (
            "claim_work",
            {"resource_keys": ["docs/peer-network"], "base_sha": "f" * 40, "branch": "b"},
        ),
        ("renew_claim", {"lease_expires_at": "2026-09-07T01:30:00Z", "generation": 0}),
        ("release_claim", {"status": "ACTIVE"}),
        ("join_network", {"node_id": "mars", "capabilities": ["bash"]}),
        ("release", {"version": "latest", "sha": "f" * 40}),
        ("submit_checkpoint", {}),
        ("submit_result", {}),
        ("submit_result", {"sha": "deadbeef"}),
        ("submit_result", {"sha": "f" * 40, "verdict": "PASS"}),  # a result is not a verdict
        ("heartbeat", {"lease_expires_at": "soon"}),
    ],
)
def test_per_kind_payload_rejections(kind: str, payload: dict) -> None:
    v = _validator("event")
    with pytest.raises(jsonschema.ValidationError):
        v.validate({**EVENT_OK, "kind": kind, "payload": payload})
