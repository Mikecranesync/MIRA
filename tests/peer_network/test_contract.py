"""Static contract checks for FLEET-PEER-NETWORK-001 Slice A.

Run locally: ``pytest tests/peer_network -q``. In CI it runs in its own always-run ``peer-contract``
job of ``.github/workflows/ci.yml`` (no ``changes:`` filter, ``fetch-depth: 0``, in ``ci-gate``'s
``needs:``); the ``tests/`` sweep in ``test-eval-offline`` is advisory: that job is not in
``ci-gate``'s ``needs:``, so a failure there cannot block a merge.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
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
    # A path-shaped key cannot traverse out of its root (Codex review: docs/../packages).
    for traversal in [
        "docs/../packages/x",
        "docs/./x",
        "docs/a/../b",
        "deployment/../mira-mobile",
        "docs/..",
    ]:
        assert not pattern.fullmatch(traversal), traversal
    # The keys THIS slice edits must be nameable by its own claim.
    for own in [
        "tests/peer_network",
        "tests/peer_network/test_contract.py",
        ".github/workflows/ci.yml",
        "docs/peer-network",
        "deployment/network.yml",
        "tools/peer_network",  # claim widened 2026-09-07 (Codex packet: executable race + key semantics)
        "tools/peer_network/claims.py",
    ]:
        assert pattern.fullmatch(own), own


def _norm(text: str) -> str:
    """Collapse all whitespace so a re-wrapped sentence cannot fail a phrase assertion."""
    return re.sub(r"\s+", " ", text)


def test_start_here_names_every_operation_schema_and_law() -> None:
    text = _norm((PEER / "START_HERE.md").read_text())
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
    raw = (PEER / "START_HERE.md").read_text()
    for n in range(1, 13):
        assert re.search(rf"^{n}\. ", raw, re.M), f"law {n} missing"
    assert "Do not add new files under `.fleet/`" in text
    assert "Available is not equipped" in text
    assert "not a permission" in text  # P4
    assert (
        "earliest GitHub creation time" in text and "60 seconds" in text
    )  # race: server-controlled key
    assert "never** the tiebreak" in text and "back-date" in text  # claimed_at is not the key
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


def test_every_peer_network_block_is_a_valid_node_record() -> None:
    """The metadata in network.yml must BE the node record the schema defines, not a lookalike
    (Codex review: five objects violated node.schema — no hostname / last_heartbeat / role)."""
    import jsonschema  # hard import: a missing validator is a red step, never a silent skip

    schema = _schema("node")
    nodes = yaml.safe_load((ROOT / "deployment" / "network.yml").read_text())["nodes"]
    for name, node in nodes.items():
        jsonschema.validate(node["peer_network"], schema)
        assert node["peer_network"]["hostname"] == node["hostname"], name


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


def test_a_decided_human_gate_names_its_decider_and_time() -> None:
    """An approved merge gate with no decided_by / decided_at validated (devops execution at
    cbacc99da1): the record that exists to prove a human decided could record no human."""
    import jsonschema

    schema = _schema("human_gate")
    base = {
        "gate_id": "g1",
        "kind": "merge",
        "mission_id": "FLEET-PEER-NETWORK-001",
        "requested_at": "2026-09-07T02:00:00Z",
    }
    jsonschema.validate({**base, "state": "open"}, schema)  # an open gate has no decider yet
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**base, "state": "approved"}, schema)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({**base, "state": "denied", "decided_by": "mike"}, schema)
    jsonschema.validate(
        {
            **base,
            "state": "approved",
            "decided_by": "mike",
            "decided_at": "2026-09-07T02:05:00Z",
            "decision_ref": "https://github.com/Mikecranesync/MIRA/pull/3653#issuecomment-1",
        },
        schema,
    )


def test_human_gate_rejects_blank_or_freetext_mission_id() -> None:
    """F6 (Codex HOLD): human_gate.mission_id had no pattern, so a blank/whitespace/free-text
    mission validated — a gate that records a human decision ON a mission with no mission. It is
    now patterned like claim + event mission_id. Positive control (a real mission ID validates)
    proves the pattern is the field under test, not an unrelated required-field failure."""
    import jsonschema

    schema = _schema("human_gate")
    base = {
        "gate_id": "g1",
        "kind": "merge",
        "state": "open",
        "requested_at": "2026-09-07T02:00:00Z",
    }
    for bad in ["", "   ", "not a mission", "fleet-peer-network-001"]:  # blank / ws / free / lower
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({**base, "mission_id": bad}, schema)
    jsonschema.validate(
        {**base, "mission_id": "FLEET-PEER-NETWORK-001"}, schema
    )  # positive control


FORBIDDEN_FOR_THIS_SLICE = re.compile(
    r"^(packages/factorylm-|apps/factorylm-ui-lab/|mira-mobile/|mira-hub/|mira-web/|CLAUDE\.md$|AGENTS\.md$)"
)


def _merge_base() -> str:
    """merge-base(HEAD, origin/main). A shallow checkout or a missing `origin/main` cannot compute
    it: that is a RED test naming the ANCESTRY (fetch-depth: 0 in the peer-contract job), never a
    skip and never a green — and never a message about a path."""
    import subprocess

    run = subprocess.run(
        ["git", "merge-base", "HEAD", "origin/main"], cwd=ROOT, capture_output=True, text=True
    )
    if run.returncode != 0 or not run.stdout.strip():
        pytest.fail(
            "cannot compute merge-base(HEAD, origin/main): shallow checkout or origin/main "
            "missing — this guard needs full history (ci.yml peer-contract: fetch-depth: 0). "
            f"git said: {run.stderr.strip()!r}"
        )
    return run.stdout.strip()


def _changed_files(diff_filter: str) -> list[str]:
    """Executable changed-path enforcement over the real diff, base...HEAD. Renames and copies
    are reported by their NEW path (that is the path being introduced)."""
    import subprocess

    out = subprocess.run(
        [
            "git",
            "diff",
            "--name-only",
            "-M",
            "-C",
            f"--diff-filter={diff_filter}",
            f"{_merge_base()}...HEAD",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if line]


def _violations(files: list[str]) -> list[str]:
    return [f for f in files if FORBIDDEN_FOR_THIS_SLICE.match(f) or f.startswith(".fleet/")]


# The `.fleet/` files tracked at the mission's base SHA f5f994a78d (13). START_HERE grandfathers
# exactly these for the FLM-UI-4000 lanes that still write them; nothing else may ever appear
# under `.fleet/` — not by add, modify-into-existence, rename or copy.
GRANDFATHERED_FLEET = frozenset(
    {
        ".fleet/CORRECTIONS-002.md",
        ".fleet/CORRECTIONS.md",
        ".fleet/HANDOFF.md",
        ".fleet/REVIEW-FINAL-004.md",
        ".fleet/REVIEW-FINAL-005.md",
        ".fleet/REVIEW-FINAL-006.md",
        ".fleet/REVIEW-FINAL-007.md",
        ".fleet/REVIEW-FINAL-008.md",
        ".fleet/REVIEW-FINAL-009.md",
        ".fleet/REVIEW-FINAL-011.md",
        ".fleet/REVIEW-FINAL-012.md",
        ".fleet/REVIEW-FINAL.md",
        ".fleet/TASK.md",
    }
)


# Exact grandfather policy (Codex audit of 0859907d7): only these seven open PRs may touch
# `.fleet/`, each ONLY at its own recorded paths (gh pr view --json files, 2026-09-07). Any other
# branch may not add, modify, delete, rename or copy anything under `.fleet/`; a grandfathered
# branch touching a path outside its allowance fails the same way. Keyed by head branch name —
# the durable identity of a PR's line of work (GITHUB_HEAD_REF in CI).
FLEET_ALLOWANCES: dict[str, frozenset[str]] = {
    "feat/fleet-gateway-mcp-v1": frozenset({".fleet/BOOTSTRAP-001-HANDOFF.md"}),  # #3533
    "fleet/FLEET-PRD-P1-PROTECTED-INVENTORY-001": frozenset(  # #3549
        {
            ".fleet/FLEET-PRD-P1-PROTECTED-INVENTORY-001.CHARLIE-REVIEW.md",
            ".fleet/FLEET-PRD-P1-PROTECTED-INVENTORY-001.md",
        }
    ),
    "fleet/FLEET-PRD-P1-CLAUDE-PROTECTED-001": frozenset(
        {".fleet/FLEET-PRD-P1-CLAUDE-PROTECTED-001.md"}
    ),  # #3550
    "fleet/FLEET-PRD-P1-FAILCLOSED-REFUSE-STOP-001": frozenset(
        {".fleet/BOOTSTRAP-001-HANDOFF.md"}
    ),  # #3551
    "fleet/FLEET-PRD-P1-CHARLIE-ROUTING-001": frozenset(
        {".fleet/FLEET-PRD-P1-CHARLIE-ROUTING-001.md"}
    ),  # #3552
    "review/FLEET-PRD-P1-MULTI-NODE-ROUTING-001": frozenset(  # #3554
        {
            ".fleet/BOOTSTRAP-001-HANDOFF.md",
            ".fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001.REVIEW.md",
            ".fleet/FLEET-PRD-P1-MULTI-NODE-ROUTING-001.md",
        }
    ),
    "fleet/FLEET-ALPHA-NODE-001": frozenset({".fleet/BOOTSTRAP-001-HANDOFF.md"}),  # #3558
}


def _head_branch() -> str:
    import os
    import subprocess

    if os.environ.get("GITHUB_HEAD_REF"):
        return os.environ["GITHUB_HEAD_REF"]
    return subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _fleet_changes() -> list[tuple[str, str]]:
    """(status, path) for every change under .fleet/, base...HEAD; a rename/copy yields both the
    old path (as D) and the new path (as R/C) so neither side can slip past."""
    import subprocess

    out = subprocess.run(
        ["git", "diff", "--name-status", "-M", "-C", f"{_merge_base()}...HEAD", "--", ".fleet"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    changes: list[tuple[str, str]] = []
    for line in out.splitlines():
        parts = line.split("\t")
        status = parts[0][0]
        if status in ("R", "C"):
            changes.append(("D" if status == "R" else "M", parts[1]))
            changes.append((status, parts[2]))
        else:
            changes.append((status, parts[1]))
    return changes


def _fleet_policy_violations(branch: str, changes: list[tuple[str, str]]) -> list[str]:
    allowed = FLEET_ALLOWANCES.get(branch, frozenset())
    return sorted(
        {
            f"{status} {path}"
            for status, path in changes
            if path.startswith(".fleet/") and path not in allowed
        }
    )


def test_fleet_policy_is_exact_branch_plus_path_and_fails_closed_elsewhere() -> None:
    assert _fleet_policy_violations(_head_branch(), _fleet_changes()) == []
    p = ".fleet/BOOTSTRAP-001-HANDOFF.md"
    ok_branch = "fleet/FLEET-ALPHA-NODE-001"
    # allowed branch, its exact path, every change type: permitted
    for status in ("A", "M", "D", "R", "C"):
        assert _fleet_policy_violations(ok_branch, [(status, p)]) == []
    # allowed branch, an extra path (even a grandfathered filename): violation
    assert _fleet_policy_violations(ok_branch, [("M", ".fleet/TASK.md")]) == ["M .fleet/TASK.md"]
    assert _fleet_policy_violations(ok_branch, [("A", ".fleet/NEW.md")]) == ["A .fleet/NEW.md"]
    # wrong branch (another grandfathered PR's path): violation
    assert _fleet_policy_violations("fleet/FLEET-PRD-P1-CLAUDE-PROTECTED-001", [("M", p)]) == [
        f"M {p}"
    ]
    # any non-grandfathered branch: modification, add, delete, rename, copy all fail
    for status in ("A", "M", "D", "R", "C"):
        assert _fleet_policy_violations("feat/anything-else", [(status, ".fleet/TASK.md")]) == [
            f"{status} .fleet/TASK.md"
        ]
    # this very branch is not grandfathered
    assert (
        _fleet_policy_violations("feat/fleet-peer-network-001a-contract", [("M", ".fleet/TASK.md")])
        != []
    )
    # paths outside .fleet are not this policy's business
    assert _fleet_policy_violations("feat/anything-else", [("M", "docs/x.md")]) == []


def _fleet_violations(tracked_at_head: list[str], introduced: list[str]) -> list[str]:
    """Any `.fleet/` path at HEAD outside the grandfathered set, plus any `.fleet/` path this
    branch adds/renames/copies into being (A/R/C) — modifications of grandfathered files are the
    only permitted `.fleet/` change on any branch, and Slice A makes none at all."""
    at_head = [
        f for f in tracked_at_head if f.startswith(".fleet/") and f not in GRANDFATHERED_FLEET
    ]
    added = [f for f in introduced if f.startswith(".fleet/") and f not in GRANDFATHERED_FLEET]
    return sorted(set(at_head) | set(added))


def test_fleet_directory_is_frozen_to_the_grandfathered_set() -> None:
    import subprocess

    tracked = subprocess.run(
        ["git", "ls-files", "--", ".fleet"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.split()
    assert set(tracked) <= GRANDFATHERED_FLEET, sorted(set(tracked) - GRANDFATHERED_FLEET)
    assert _fleet_violations(tracked, _changed_files("ARC")) == []
    # positive controls through the SAME matcher: add, rename-in, copy-in, and a stray at HEAD
    assert _fleet_violations(
        [".fleet/TASK.md", ".fleet/STRAY.md"], [".fleet/NEW.md", ".fleet/TASK.md"]
    ) == [".fleet/NEW.md", ".fleet/STRAY.md"]


def test_this_branch_touches_no_product_root_or_fleet_paths() -> None:
    """Acceptance #11 as an executable check on the real diff, with a positive control through
    the SAME matcher so a clean result cannot come from a broken one.

    F3 (Codex HOLD): the filter is ACMRD, not ACMR — including D, so DELETING a protected product
    file is a violation too (Slice A must not touch product paths in any way, removal included)."""
    added_or_changed = _changed_files("ACMRD")
    assert added_or_changed, "no changed files — the diff base is wrong"
    assert _violations(added_or_changed) == [], _violations(added_or_changed)
    assert _violations([".fleet/NEW.md", "packages/factorylm-ui/src/x.ts", "CLAUDE.md"]) == [
        ".fleet/NEW.md",
        "packages/factorylm-ui/src/x.ts",
        "CLAUDE.md",
    ]


def test_product_deletion_is_caught_by_the_acceptance_11_filter(tmp_path) -> None:
    """F3 (Codex HOLD): prove, hermetically, that DELETING a protected product file is caught.

    The old filter ACMR omits D, so a product-file deletion slipped through acceptance #11. In a
    throwaway repo (no origin/main, so we call git directly rather than _changed_files) we delete
    `mira-mobile/app.ts` and assert: the ACMRD filter surfaces the deletion, the old ACMR filter
    MISSES it (proving the mutation ACMRD->ACMR would land), and _violations flags the deleted path.
    """
    import subprocess

    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True
        ).stdout.strip()

    git("init", "-q")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    victim = tmp_path / "mira-mobile" / "app.ts"
    victim.parent.mkdir(parents=True)
    victim.write_text("x")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "keep.md").write_text("k")
    git("add", "-A")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    victim.unlink()
    git("commit", "-aqm", "delete a protected product file")

    def changed(diff_filter: str) -> list[str]:
        out = subprocess.run(
            [
                "git",
                "diff",
                "--name-only",
                "-M",
                "-C",
                f"--diff-filter={diff_filter}",
                f"{base}...HEAD",
            ],
            cwd=tmp_path,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        return [line for line in out.splitlines() if line]

    assert "mira-mobile/app.ts" in changed("ACMRD")  # fixed filter surfaces the deletion
    assert "mira-mobile/app.ts" not in changed("ACMR")  # old filter missed it — mutation lands
    assert _violations(changed("ACMRD")) == ["mira-mobile/app.ts"]  # and the matcher flags it


def test_mission_directory_convention() -> None:
    mission = ROOT / "docs" / "missions" / "FLEET-PEER-NETWORK-001"
    for f in ("MISSION.md", "HANDOFF.md", "CLAIMS.md"):
        assert (mission / f).exists(), f
    readme = (ROOT / "docs" / "missions" / "README.md").read_text()
    assert "Do not add new files under `.fleet/`" in readme


def _job(ci: str, name: str) -> str:
    start = ci.index(f"\n  {name}:\n")
    m = re.search(r"\n  [a-z][a-z0-9-]*:\n", ci[start + 1 :])
    return ci[start : start + 1 + m.start()] if m else ci[start:]


def test_ci_contract_job_always_runs_with_full_history_and_gates_the_merge() -> None:
    """The suite runs in its OWN job with no `changes` conditional (a skipped job reports Success,
    and the filter negates docs/**), checks out full history (the changed-path guard needs
    merge-base), installs the pinned requirements, and sits in ci-gate's needs — a check that
    runs but cannot fail the merge is not a guard (ci.yml:453). Mutation-verified 2026-09-07:
    removing the job, adding `if:`, dropping fetch-depth, or dropping it from needs each turns
    this test red by name."""
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    job = _job(ci, "peer-contract")
    header = job[: job.index("    steps:")]
    assert not re.search(r"^\s+if:", header, re.M), "peer-contract must not be conditional"
    assert not re.search(r"^\s+needs:", header, re.M), "peer-contract must not wait on `changes`"
    checkout = job[job.index("actions/checkout@") : job.index("actions/setup-python@")]
    assert re.search(r"fetch-depth:\s*0\b", checkout), "changed-path guard needs full history"
    assert "pip install -r tests/peer_network/requirements.txt" in job
    assert re.search(r"run:\s*pytest tests/peer_network/? -v", job)
    gate = ci[ci.index("\n  ci-gate:") :]
    needs = gate[: gate.index("steps:")]
    assert re.search(r"^\s+- peer-contract$", needs, re.M), "peer-contract is not in ci-gate.needs"
    unit = _job(ci, "test-unit")
    assert "tests/peer_network" not in unit, (
        "the suite must not ALSO live behind the changes filter"
    )


def test_ci_gate_reads_the_contract_result_and_fails_closed_on_it() -> None:
    """ci-gate is `if: always()`: a job in `needs` only makes the gate WAIT. The gate reads each
    result through env + require_success; without both, peer-contract can be red while CI Gate
    is green (Codex audit of 0859907d7 — the exact trap ci.yml documents for capability-closure)."""
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    gate = _job(ci, "ci-gate")
    assert re.search(
        r"^\s+PEER_CONTRACT_RESULT:\s*\$\{\{\s*needs\.peer-contract\.result\s*\}\}$", gate, re.M
    ), "ci-gate does not export needs.peer-contract.result"
    assert re.search(
        r"^\s+require_success\s+peer-contract\s+\"\$PEER_CONTRACT_RESULT\"", gate, re.M
    ), "ci-gate never calls require_success on PEER_CONTRACT_RESULT"


def test_suite_dependencies_are_pinned_exactly() -> None:
    reqs = [
        line.strip()
        for line in (ROOT / "tests" / "peer_network" / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    assert reqs, "empty requirements"
    for req in reqs:
        assert re.fullmatch(r"[A-Za-z0-9_.-]+==\d+(\.\d+)+", req), f"not an exact pin: {req}"
    names = {r.split("==")[0].lower() for r in reqs}
    assert {"pytest", "pyyaml", "jsonschema", "rfc3339-validator"} <= names, names
