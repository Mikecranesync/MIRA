"""Negative controls for the evidence-provenance checks.

Every rule here is asserted in BOTH directions: a record that should trip it,
and a record that should not. A linter that has only ever been shown passing
input is indistinguishable from one that returns an empty list, and that is the
exact failure class this module was written to catch.
"""

from __future__ import annotations

import datetime as _dt
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import evidence_provenance as ep  # noqa: E402

TODAY = _dt.date(2026, 9, 24)
ENFORCED = _dt.date(2026, 9, 1)

# A commit that genuinely exists in this repository, resolved at run time so the
# test cannot rot into asserting against a hardcoded SHA that was rebased away.
import subprocess  # noqa: E402

REAL_SHA = subprocess.run(
    ["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True
).stdout.strip()


def _prov(**over):
    base = {
        "commit_sha": REAL_SHA,
        "environment": "ci",
        "observed_at": "2026-09-24",
        "outcome": "pass",
        "falsified_by": "Revert the guard and the control must go red.",
        "observation": {
            "positive_control": "tools/evidence_provenance.py",
            "negative_control": "tools/capability_closure.py",
        },
    }
    base.update(over)
    return base


def _item(**over):
    it = {
        "path": "tools/evidence_provenance.py",
        "observed_at": "2026-09-24",
        "provenance": _prov(),
    }
    it.update(over)
    return it


def _rules(item, *, enabled=True, code_paths=None):
    return {
        f.rule
        for f in ep.check_evidence_item(
            "cap",
            item,
            root=ROOT,
            enabled=enabled,
            enforced_from=ENFORCED,
            code_paths=code_paths or [],
        )
    }


# --------------------------------------------------------------------------
# positive control: a complete record trips nothing
# --------------------------------------------------------------------------
def test_complete_record_is_clean():
    assert _rules(_item()) == set(), "a fully-specified evidence record must pass"


# --------------------------------------------------------------------------
# each rule, negative control
# --------------------------------------------------------------------------
def test_missing_provenance_on_enabled_state_is_caught():
    item = {"path": "tools/evidence_provenance.py", "observed_at": "2026-09-24"}
    assert "provenance_missing" in _rules(item, enabled=True)


def test_missing_provenance_is_not_charged_to_a_disabled_capability():
    item = {"path": "tools/evidence_provenance.py", "observed_at": "2026-09-24"}
    assert _rules(item, enabled=False) == set()


def test_pre_cutover_evidence_is_not_retroactively_failed():
    item = {"path": "tools/evidence_provenance.py", "observed_at": "2026-08-01"}
    assert _rules(item, enabled=True) == set(), "records older than the cutover must not fail"


def test_fabricated_sha_is_caught(monkeypatch):
    # Pinned to complete history on purpose. On CI's shallow checkout the
    # question "does this commit exist?" is unanswerable, and the module
    # correctly declines to answer it — so asserting the FINDING here without
    # pinning would be asserting the environment, not the rule.
    monkeypatch.setattr(ep, "history_is_complete", lambda root: True)
    assert "provenance_sha_unknown" in _rules(
        _item(provenance=_prov(commit_sha="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))
    )


def test_missing_sha_is_caught():
    r = _rules(_item(provenance=_prov(commit_sha="")))
    assert "provenance_sha_missing" in r


def test_invalid_environment_is_caught():
    assert "provenance_env_invalid" in _rules(_item(provenance=_prov(environment="prod-ish")))


def test_emulator_and_device_are_distinct_environments():
    # Collapsing these is how emulator evidence silently satisfies a
    # physical-device requirement.
    assert "emulator" in ep.VALID_ENVIRONMENTS and "device" in ep.VALID_ENVIRONMENTS
    assert _rules(_item(provenance=_prov(environment="device"))) == set()


def test_absent_falsifier_is_caught():
    assert "provenance_no_falsifier" in _rules(_item(provenance=_prov(falsified_by="  ")))


def test_observation_without_controls_is_caught():
    assert "observation_unproven" in _rules(_item(provenance=_prov(observation={})))


def test_observation_with_only_a_positive_control_is_caught():
    assert "observation_unproven" in _rules(
        _item(provenance=_prov(observation={"positive_control": "tools/capability_closure.py"}))
    )


def test_control_pointing_at_a_nonexistent_file_is_caught():
    assert "observation_control_missing" in _rules(
        _item(
            provenance=_prov(
                observation={
                    "positive_control": "tools/does_not_exist.py",
                    "negative_control": "tools/capability_closure.py",
                }
            )
        )
    )


def test_control_may_name_a_test_within_a_file():
    assert (
        _rules(
            _item(
                provenance=_prov(
                    observation={
                        "positive_control": "tests/test_evidence_provenance.py::test_complete_record_is_clean",
                        "negative_control": "tests/test_evidence_provenance.py::test_fabricated_sha_is_caught",
                    }
                )
            )
        )
        == set()
    )


def test_inconclusive_cannot_prove_an_enabled_capability():
    r = _rules(_item(provenance=_prov(outcome="inconclusive")), enabled=True)
    assert "evidence_inconclusive_as_proof" in r


def test_inconclusive_is_not_a_product_failure_on_a_disabled_capability():
    r = _rules(_item(provenance=_prov(outcome="inconclusive")), enabled=False)
    assert "evidence_inconclusive_as_proof" not in r


def test_unknown_outcome_is_caught():
    assert "provenance_outcome_invalid" in _rules(_item(provenance=_prov(outcome="probably")))


def test_evidence_goes_stale_when_declared_code_moves(monkeypatch):
    """The RULE, not the repository's history.

    The first version of this test derived a real old commit with
    `rev-list --max-parents=0`. That works in a full worktree and returns
    nothing useful on CI's shallow `refs/pull/N/merge` checkout, so it failed
    for a reason that had nothing to do with the rule under test — the same
    observation-vs-subject confusion this whole module is about. Driving the
    git seam directly makes the assertion deterministic everywhere.
    """
    monkeypatch.setattr(ep, "paths_changed_since", lambda root, sha, paths: ["tools/x.py"])
    r = _rules(_item(), code_paths=["tools/capability_closure.py"])
    assert "evidence_stale_for_code" in r


def test_staleness_is_not_reported_when_nothing_moved(monkeypatch):
    monkeypatch.setattr(ep, "paths_changed_since", lambda root, sha, paths: [])
    assert "evidence_stale_for_code" not in _rules(_item(), code_paths=["tools/capability_closure.py"])


def test_evidence_at_head_is_not_stale():
    r = _rules(_item(), code_paths=["tools/capability_closure.py"])
    assert "evidence_stale_for_code" not in r


# --------------------------------------------------------------------------
# the checks must be reachable through the ONE validator, not just directly
# --------------------------------------------------------------------------
def test_registry_level_entry_point_reports_findings():
    registry = {
        "meta": {"provenance_enforced_from": "2026-09-01"},
        "capabilities": [
            {
                "id": "demo",
                "state": "production_enabled",
                "evidence": [{"path": "tools/evidence_provenance.py", "observed_at": "2026-09-24"}],
            }
        ],
    }
    rules = {f.rule for f in ep.check_registry(registry, ROOT)}
    assert "provenance_missing" in rules


def test_registry_without_a_cutover_date_enforces_nothing_new():
    registry = {
        "capabilities": [
            {
                "id": "demo",
                "state": "production_enabled",
                "evidence": [{"path": "tools/evidence_provenance.py", "observed_at": "2026-09-24"}],
            }
        ]
    }
    assert ep.check_registry(registry, ROOT) == []


def test_fabricated_sha_check_fails_open_when_git_is_unavailable(monkeypatch):
    # A missing git binary is an environment fault. Reporting it as "this SHA is
    # fake" would be precisely the product-vs-observation confusion these checks
    # exist to prevent, so commit_exists must fail OPEN.
    def boom(*a, **k):
        raise OSError("no git here")

    monkeypatch.setattr(ep.subprocess, "run", boom)
    assert ep.commit_exists(ROOT, "abcdef1234567") is True


# --------------------------------------------------------------------------
# the shallow-clone blind spot that failed this module's own first CI run
# --------------------------------------------------------------------------
def test_shallow_clone_cannot_conclude_a_sha_is_fake(monkeypatch):
    """CI checks out refs/pull/N/merge with fetch-depth 1.

    There, `cat-file -e` reports "no such object" for a commit that is real on
    the branch — it was simply never fetched. Calling that a fabricated SHA is
    the product-vs-observation confusion this module exists to prevent, and it
    is exactly how the first version of this check turned a valid record red.
    """
    monkeypatch.setattr(ep, "history_is_complete", lambda root: False)
    assert ep.commit_exists(ROOT, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef") is True


def test_complete_history_still_rejects_a_fabricated_sha(monkeypatch):
    # The positive half: the fail-open above must not disable the check where
    # the question CAN be answered.
    monkeypatch.setattr(ep, "history_is_complete", lambda root: True)
    assert ep.commit_exists(ROOT, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef") is False


def test_shallow_clone_does_not_report_false_staleness(monkeypatch):
    monkeypatch.setattr(ep, "history_is_complete", lambda root: False)
    assert ep.paths_changed_since(ROOT, "HEAD~1", ["tools/capability_closure.py"]) == []


def test_shallow_detection_actually_detects(tmp_path):
    """The detector must DISCRIMINATE, not report a constant.

    Asserting `history_is_complete(ROOT) is True` looked like a control and was
    really an assertion about the checkout — it passed in a worktree and failed
    on CI's shallow clone. Cloning one here tests the detector itself, which is
    what the fail-open depends on: if this always returned False, every SHA
    check would be silently disabled everywhere.
    """
    shallow = tmp_path / "shallow"
    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--quiet", f"file://{ROOT}/.git", str(shallow)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:  # cloning unavailable in this sandbox
        return
    assert ep.history_is_complete(shallow) is False, "a shallow clone must be detected"
    assert subprocess.run(
        ["git", "-C", str(shallow), "rev-parse", "--is-shallow-repository"],
        capture_output=True, text=True,
    ).stdout.strip() == "true"


def test_failed_evidence_cannot_prove_an_enabled_capability():
    assert "evidence_failed_as_proof" in _rules(_item(provenance=_prov(outcome="fail")))
    assert _rules(_item(provenance=_prov(outcome="fail")), enabled=False) == set()


def test_undated_enabled_evidence_cannot_bypass_cutover():
    assert "provenance_date_missing" in _rules({"path": "tests/test_evidence_provenance.py"})
    assert _rules({"path": "tests/test_evidence_provenance.py", "recorded_at": "2026-08-01"}) == set()


def test_named_controls_must_exist_in_the_python_file():
    assert "observation_control_missing" in _rules(_item(provenance=_prov(observation={
        "positive_control": "tests/test_evidence_provenance.py::test_does_not_exist",
        "negative_control": "tests/test_evidence_provenance.py::test_also_missing",
    })))
