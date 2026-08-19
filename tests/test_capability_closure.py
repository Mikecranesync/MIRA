"""Capability-closure validator — rule tests with negative fixtures.

Every rule below is paired with a fixture that REMOVES the required information
and asserts the validator fails. A validator only tested on a passing registry
proves nothing: this repo has shipped a false-green guard before (CU-03's first
SELECT-column test passed against a deliberately broken query), so each check
here has to demonstrate it can go red.

The flagship rule is `enabled_but_unplumbed`. It exists because on 2026-08-19
`MIRA_ENFORCE_APPROVED_RETRIEVAL` was found set to `'true'` in `factorylm/prd`
while no compose file forwarded it into any container, so the code read its
`"false"` default and the approved-context gate was configured ON and enforced
OFF (#3328).
"""

from __future__ import annotations

import datetime as _dt
import importlib.util
import sys
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "capability_closure", _ROOT / "tools" / "capability_closure.py"
)
assert _SPEC is not None and _SPEC.loader is not None
cc = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("capability_closure", cc)
_SPEC.loader.exec_module(cc)

REGISTRY = _ROOT / "docs" / "architecture" / "convergence" / "CAPABILITY_CLOSURE.yaml"


def _registry() -> dict:
    return yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))


def _cap(**over) -> dict:
    """A minimal complete capability record; override to break one thing."""
    base = {
        "id": "fixture_cap",
        "purpose": "does a thing",
        "state": "deployed_disabled",
        "owner": "someone",
        "environments": {"dev": "unset", "staging": "unset", "production": "unset"},
        "evidence": [],
        "reason": "not ready",
        "promotion_criteria": ["prove it"],
        "review_by": "2099-01-01",
    }
    base.update(over)
    return base


def _rules(findings) -> set[str]:
    return {f.rule for f in findings}


# --------------------------------------------------------------------------
# the real registry
# --------------------------------------------------------------------------
def test_the_committed_registry_parses_and_has_capabilities():
    reg = _registry()
    assert reg["capabilities"], "registry has no capabilities"
    assert reg["meta"]["observed_on"], "flag observations must be dated"


def test_the_committed_registry_has_no_unacknowledged_findings():
    """The registry must be clean apart from defects that are filed and tracked."""
    findings = cc.validate(_registry(), _ROOT)
    blocking = [f for f in findings if not f.acknowledged]
    assert not blocking, "unacknowledged findings:\n" + "\n".join(str(f) for f in blocking)


def test_every_gate_flag_in_code_is_accounted_for():
    """A new flag cannot stay anonymous — the whole inventory decays otherwise."""
    missing = cc.discover_unregistered(_registry(), _ROOT)
    assert not missing, f"gate flags in code but not in the registry: {missing}"


# --------------------------------------------------------------------------
# required fields
# --------------------------------------------------------------------------
@pytest.mark.parametrize("field", ["purpose", "state", "owner", "environments", "evidence"])
def test_missing_required_field_fails(field):
    cap = _cap()
    del cap[field]
    findings = cc.check_required_fields(cap)
    assert "required_field" in _rules(findings) or "owner" in _rules(findings)


def test_unknown_state_fails():
    assert "state_vocabulary" in _rules(cc.check_required_fields(_cap(state="vibes")))


def test_missing_owner_needs_an_explicit_owner_missing_blocker():
    assert "owner" in _rules(cc.check_required_fields(_cap(owner=None)))
    # ...and naming the reason clears it
    assert "owner" not in _rules(
        cc.check_required_fields(_cap(owner=None, owner_missing="blocked on ADR"))
    )


# --------------------------------------------------------------------------
# a disabled capability must carry a decision
# --------------------------------------------------------------------------
@pytest.mark.parametrize("field", ["reason", "promotion_criteria", "review_by"])
def test_off_everywhere_without_a_decision_fails(field):
    cap = _cap()
    del cap[field]
    assert "disabled_without_decision" in _rules(cc.check_disabled_has_a_decision(cap))


def test_off_everywhere_with_a_full_decision_passes():
    assert cc.check_disabled_has_a_decision(_cap()) == []


def test_retired_needs_only_a_reason():
    cap = _cap(state="retired")
    del cap["promotion_criteria"]
    del cap["review_by"]
    assert cc.check_disabled_has_a_decision(cap) == []


def test_an_enabled_capability_is_not_asked_for_promotion_criteria():
    cap = _cap(environments={"production": "1"})
    del cap["reason"]
    assert cc.check_disabled_has_a_decision(cap) == []


# --------------------------------------------------------------------------
# THE #3328 RULE
# --------------------------------------------------------------------------
def test_enabled_flag_not_forwarded_by_compose_fails():
    """The exact #3328 shape: set in an environment, reaching no container."""
    cap = _cap(feature_flag="TOTALLY_UNPLUMBED_FLAG", environments={"production": "true"})
    findings = cc.check_enabled_flags_are_plumbed(cap, plumbed=set())
    assert "enabled_but_unplumbed" in _rules(findings)
    assert "#3328" in findings[0].message


def test_enabled_flag_that_is_forwarded_passes():
    cap = _cap(feature_flag="PLUMBED_FLAG", environments={"production": "true"})
    assert cc.check_enabled_flags_are_plumbed(cap, plumbed={"PLUMBED_FLAG"}) == []


def test_disabled_flag_is_not_required_to_be_plumbed():
    """An off flag need not be wired — only a claimed-on one must be."""
    cap = _cap(feature_flag="OFF_FLAG", environments={"production": "unset"})
    assert cc.check_enabled_flags_are_plumbed(cap, plumbed=set()) == []


def test_the_real_registry_still_exhibits_the_3328_defect():
    """Guard against the registry being 'fixed' by editing it instead of the plumbing.

    While #3328 is open, the approved-context capability MUST still produce this
    finding. If someone quietly flips the recorded environment value to make the
    validator green, this test goes red and says why.
    """
    findings = cc.validate(_registry(), _ROOT)
    hits = [
        f
        for f in findings
        if f.rule == "enabled_but_unplumbed" and f.cap == "approved_context_retrieval"
    ]
    assert hits, (
        "approved_context_retrieval no longer reports enabled_but_unplumbed. If "
        "#3328 was fixed by adding the variable to the consuming services' compose "
        "environment blocks, delete this test and the acknowledgement. If it was "
        "'fixed' by editing the registry, put it back."
    )
    assert hits[0].acknowledged, "the finding must be acknowledged (filed as #3328), not silent"


# --------------------------------------------------------------------------
# acknowledgement cannot be a silent suppressor
# --------------------------------------------------------------------------
def test_acknowledgement_requires_a_blocker():
    cap = _cap(acknowledged_rules=["enabled_but_unplumbed"])
    assert "acknowledgement_without_blocker" in _rules(cc.check_required_fields(cap))


def test_acknowledgement_is_per_rule_not_per_capability():
    """Acknowledging one rule must not silence a different one."""
    reg = {
        "capabilities": [
            _cap(
                id="c",
                feature_flag="UNPLUMBED",
                environments={"production": "1"},
                blocker="tracked in #9999",
                acknowledged_rules=["enabled_but_unplumbed"],
                rollback=None,  # triggers production_no_rollback
            )
        ]
    }
    findings = cc.validate(reg, _ROOT)
    by_rule = {f.rule: f.acknowledged for f in findings}
    assert by_rule.get("enabled_but_unplumbed") is True
    assert by_rule.get("production_no_rollback") is False, (
        "an unrelated rule was silenced by the acknowledgement"
    )


# --------------------------------------------------------------------------
# production claims
# --------------------------------------------------------------------------
def test_production_enabled_without_rollback_fails():
    cap = _cap(environments={"production": "1"}, evidence=[{"path": "README.md"}])
    assert "production_no_rollback" in _rules(cc.check_production_has_rollback(cap))


def test_production_enabled_without_evidence_fails():
    """Enabled is not proven — the distinction this whole registry exists for."""
    cap = _cap(environments={"production": "1"}, rollback="flip the flag", evidence=[])
    assert "production_no_evidence" in _rules(cc.check_production_has_rollback(cap))


# --------------------------------------------------------------------------
# repository cross-checks
# --------------------------------------------------------------------------
def test_ci_job_that_does_not_exist_fails():
    cap = _cap(ci_jobs=["no-such-job"])
    assert "ci_job_missing" in _rules(cc.check_ci_jobs_exist(cap, {"real-job"}, set()))


def test_claiming_a_required_check_that_does_not_gate_fails():
    """A job that runs but cannot fail the merge is not a guard."""
    cap = _cap(required_checks=["visible-but-ungated"])
    findings = cc.check_ci_jobs_exist(cap, {"visible-but-ungated"}, gated={"other"})
    assert "required_check_false" in _rules(findings)


def test_missing_evidence_path_fails():
    cap = _cap(evidence=[{"path": "docs/does-not-exist-xyz.md"}])
    assert "evidence_missing" in _rules(cc.check_evidence_paths_exist(cap, _ROOT))


def test_evidence_url_is_not_checked_on_disk():
    cap = _cap(evidence=[{"path": "https://example.com/run"}])
    assert cc.check_evidence_paths_exist(cap, _ROOT) == []


def test_expired_review_date_fails():
    cap = _cap(review_by="2000-01-01")
    assert "review_expired" in _rules(cc.check_review_not_expired(cap, _dt.date(2026, 1, 1)))


def test_malformed_review_date_fails():
    cap = _cap(review_by="soon")
    assert "review_by_malformed" in _rules(cc.check_review_not_expired(cap, _dt.date.today()))


def test_flag_absent_from_code_fails():
    cap = _cap(feature_flag="GHOST_FLAG_ENABLED")
    assert "flag_not_in_code" in _rules(cc.check_flag_exists_in_code(cap, {"REAL_ENABLED": "0"}))


# --------------------------------------------------------------------------
# the scanners themselves
# --------------------------------------------------------------------------
def test_code_scan_finds_indirectly_bound_flags():
    """`_FLAG_ENV = "MIRA_CONTEXT_CONTRACT"` must be discoverable.

    A literal-only `os.getenv` match missed this one, which under-reports the
    inventory — the failure mode that makes a registry quietly incomplete.
    """
    flags = cc.code_flag_defaults(_ROOT)
    assert "MIRA_CONTEXT_CONTRACT" in flags


def test_code_scan_finds_directly_read_flags():
    flags = cc.code_flag_defaults(_ROOT)
    assert "MIRA_ENFORCE_APPROVED_RETRIEVAL" in flags
    assert flags["MIRA_ENFORCE_APPROVED_RETRIEVAL"] == "false"


def test_ci_gate_needs_are_discoverable():
    """If this returns nothing, `required_check_false` silently stops working."""
    gated = cc.ci_gate_needs(_ROOT)
    assert gated, "could not parse ci-gate needs — the required-check rule is inert"
    assert "test-unit" in gated
