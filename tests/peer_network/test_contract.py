"""Static contract checks for FLEET-PEER-NETWORK-001 Slice A.

Run locally: ``pytest tests/peer_network -q``. In CI it runs as a named step inside the gated
``test-unit`` job of ``.github/workflows/ci.yml`` (the ``tests/`` sweep in ``test-eval-offline``
is advisory: that job is not in ``ci-gate``'s ``needs:``, so a failure there cannot block a merge).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
PEER = ROOT / "docs" / "peer-network"
SCHEMAS = PEER / "schemas"
EXPECTED_SCHEMAS = {"node", "session", "work_item", "claim", "event", "artifact", "human_gate"}
OPERATIONS = [
    "join_network",
    "heartbeat",
    "fleet_status",
    "request_work",
    "claim_work",
    "renew_claim",
    "release_claim",
    "submit_checkpoint",
    "request_handoff",
    "accept_handoff",
    "submit_result",
    "request_review",
    "submit_verdict",
    "leave_network",
]
POINTER = "docs/peer-network/START_HERE.md"


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def test_every_prd_record_has_a_versioned_schema() -> None:
    present = {p.name.removesuffix(".schema.json") for p in SCHEMAS.glob("*.schema.json")}
    assert present == EXPECTED_SCHEMAS
    for name in EXPECTED_SCHEMAS:
        doc = _schema(name)
        assert doc["$schema"].startswith("https://json-schema.org/draft/2020-12"), name
        assert re.fullmatch(r"\d+\.\d+\.\d+", doc["version"]), name
        assert doc["version"] in doc["$id"], f"{name}: $id must carry the version"
        assert doc["type"] == "object" and doc["additionalProperties"] is False, name
        missing = set(doc["required"]) - set(doc["properties"])
        assert not missing, f"{name}: required but undefined: {missing}"


def test_schemas_encode_the_laws() -> None:
    claim = _schema("claim")
    assert claim["properties"]["base_sha"]["pattern"] == "^[0-9a-f]{40}$"  # law 8
    assert claim["properties"]["resource_keys"]["minItems"] == 1  # law 2 / §7
    assert claim["properties"]["generation"]["minimum"] == 1  # handoff generations
    artifact = _schema("artifact")
    assert artifact["properties"]["sha"]["pattern"] == "^[0-9a-f]{40}$"  # law 8
    event = _schema("event")
    assert "idempotency_key" in event["required"]  # §9 fail-closed
    assert set(OPERATIONS) <= set(event["properties"]["kind"]["enum"])  # §9 operations
    node = _schema("node")
    assert set(node["properties"]["node_id"]["enum"]) >= {
        "alpha",
        "bravo",
        "charlie",
        "travel",
        "plc",
    }
    assert (
        "read-only" in node["properties"]["capabilities"]["items"]["enum"]
    )  # available ≠ equipped
    gate = _schema("human_gate")
    assert set(gate["properties"]["kind"]["enum"]) == {
        "merge",
        "deploy_production",
        "architecture",
        "secret",
        "protected_infrastructure",
        "physical_test",
    }  # law 12


def test_resource_key_pattern_accepts_canonical_keys_and_rejects_free_text() -> None:
    pattern = re.compile(_schema("claim")["properties"]["resource_keys"]["items"]["pattern"])
    for key in [
        "packages/factorylm-ui",
        "mira-mobile",
        "migration:next",
        "device:pixel9a",
        "environment:staging",
        "root:CLAUDE.md",
        "docs/peer-network",
        "deployment/network.yml",
    ]:
        assert pattern.fullmatch(key), key
    for bad in ["the UI", "packages/", "environment:qa", "root:README.md", "mira_mobile"]:
        assert not pattern.fullmatch(bad), bad


def test_start_here_names_every_operation_schema_and_law() -> None:
    text = (PEER / "START_HERE.md").read_text()
    for op in OPERATIONS:
        assert (
            f"`{op}`" in text
            or f"({op}" in text
            or f"`{op}`" in (SCHEMAS / "README.md").read_text()
        ), op
    for name in EXPECTED_SCHEMAS:
        assert (
            f"{name}.schema.json" in text
            or f"{name}.schema.json" in (SCHEMAS / "README.md").read_text()
        ), name
    for n in range(1, 13):
        assert re.search(rf"^{n}\. ", text, re.M), f"law {n} missing"
    assert "Do not add new files under `.fleet/`" in text
    assert "Available is not equipped" in text
    assert "not a permission" in text  # P4
    assert "earliest `claimed_at`" in text and "60 seconds" in text  # P2
    for exempt in ("#3549", "#3558", "#3533", "docs/pixel-acceptance-and-merge-plan"):  # P5
        assert exempt in text, exempt
    assert "needs a pattern or an enum" in text  # authority-field rule
    assert re.search(
        r"made to fail on the regression\s+it names", text
    )  # guard-verification rule (wraps)


def test_network_yml_represents_all_five_computers_without_changing_the_existing_three() -> None:
    data = yaml.safe_load((ROOT / "deployment" / "network.yml").read_text())
    nodes = data["nodes"]
    assert set(nodes) == {"alpha", "bravo", "charlie", "travel", "plc"}
    # Existing addressing untouched (metadata-only change).
    assert nodes["bravo"]["addresses"] == {"tailscale": "100.86.236.11", "lan": "192.168.1.11"}
    assert nodes["charlie"]["addresses"] == {"tailscale": "100.70.49.126", "lan": "192.168.1.12"}
    assert nodes["alpha"]["addresses"] == {"tailscale": "100.107.140.12", "lan": "192.168.4.28"}
    assert [c["from"] + "->" + c["to"] for c in data["connectivity"]] == [
        "alpha->bravo",
        "alpha->charlie",
        "bravo->charlie",
        "charlie->bravo",
    ]
    caps = set(_schema("node")["properties"]["capabilities"]["items"]["enum"])
    for name, node in nodes.items():
        meta = node["peer_network"]
        assert meta["node_id"] == name
        assert set(meta["capabilities"]) <= caps, name
        assert meta["availability"] in {"online", "offline", "unknown"}, name
    assert "read-only" in nodes["plc"]["peer_network"]["capabilities"]


def test_root_pointers_follow_the_status_gate_both_ways() -> None:
    """The pointer lands only after #3647 merges. Enforced in both directions:
    pending → the pointer must be ABSENT (it would collide with the #3626 claim);
    landed  → the pointer must be PRESENT in both root files (absence doesn't announce itself)."""
    status = (PEER / "pointers.status").read_text().strip()
    claude = (ROOT / "CLAUDE.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()
    if status.startswith("pending:"):
        assert POINTER not in claude and POINTER not in agents, (
            f"root pointer present while {status}: land it only after the blocking PR merges"
        )
    elif status == "landed":
        assert POINTER in claude and POINTER in agents, (
            "pointers.status is landed but a root file lacks the pointer"
        )
    else:
        raise AssertionError(f"unknown pointers.status: {status!r}")


def test_mission_directory_convention() -> None:
    mission = ROOT / "docs" / "missions" / "FLEET-PEER-NETWORK-001"
    for f in ("MISSION.md", "HANDOFF.md", "CLAIMS.md"):
        assert (mission / f).exists(), f
    readme = (ROOT / "docs" / "missions" / "README.md").read_text()
    assert "Do not add new files under `.fleet/`" in readme


def test_ci_runs_this_suite_inside_the_gated_unit_job() -> None:
    """A check that runs but cannot fail the merge is not a guard (ci.yml:453). The suite must be a
    named step in `test-unit`, which IS in `ci-gate`'s needs list."""
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    unit_start = ci.index("\n  test-unit:")
    unit_end = ci.index("\n  ", unit_start + 1)
    # find the next top-level job after test-unit
    m = re.search(r"\n  [a-z][a-z0-9-]*:\n", ci[unit_start + 1 :])
    unit_end = unit_start + 1 + m.start() if m else len(ci)
    unit_job = ci[unit_start:unit_end]
    assert "pytest tests/peer_network" in unit_job, "peer-network suite is not a step in test-unit"
    gate = ci[ci.index("\n  ci-gate:") :]
    needs = gate[: gate.index("steps:")]
    assert "test-unit" in needs
