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


def test_unified_ui_shell_records_the_merged_mobile_canary_truth():
    cap = next(c for c in _registry()["capabilities"] if c["id"] == "unified_ui_shell")

    # Staging default by owner exception (#4284, 2026-10-05) — the record must
    # say the charter's Gate 3 has NOT passed, so it is never read as that proof.
    assert cap["state"] == "staging_enabled"
    assert cap["environments"]["staging"] == "1"
    assert "Gate 3" in cap["owner_exception"] and "NOT been passed" in cap["owner_exception"]
    assert cap["environments"]["production"] == "unset"
    # One rollback field covering both delivery paths (Codex F3: a second key overwrote the first).
    assert "flm.chatui.v1" in cap["rollback"] and "deploy-staging.yml" in cap["rollback"]
    assert cap["environments"]["canary"] == "1"
    assert any("mira-mobile" in consumer for consumer in cap["consumers"])
    assert "factorylm-ui-lab.yml:shared-ui" in cap["ci_jobs"]
    assert "mobile-unit-tests" in cap["ci_jobs"]
    assert "Shared UI contract (bun 1.4.0)" in cap["required_checks"]
    assert cap["required_checks_observed_on"] == "2026-09-06"


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


def test_the_3328_defect_stays_fixed():
    """#3328 was fixed by plumbing (compose forwards the flag), not by editing the
    registry. The registry still records production: "true" as the intent, so if
    the compose lines are ever removed the enabled_but_unplumbed rule fires again
    — and it must fire UNACKNOWLEDGED, so it blocks rather than hides.
    """
    findings = cc.validate(_registry(), _ROOT)
    hits = [
        f
        for f in findings
        if f.rule == "enabled_but_unplumbed" and f.cap == "approved_context_retrieval"
    ]
    assert not hits, (
        "approved_context_retrieval reports enabled_but_unplumbed again — the "
        "compose forwarding added for #3328 was removed. Restore it; do not "
        "re-acknowledge the rule. Details: tests/test_approved_retrieval_plumbing.py"
    )


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


def test_separate_workflow_job_and_observed_required_check_are_validated(tmp_path):
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "factorylm-ui-lab.yml").write_text(
        "jobs:\n  shared-ui:\n    name: Shared UI contract (bun 1.4.0)\n",
        encoding="utf-8",
    )
    jobs, check_names = cc.workflow_job_inventory(tmp_path)
    cap = _cap(
        ci_jobs=["factorylm-ui-lab.yml:shared-ui"],
        required_checks=["Shared UI contract (bun 1.4.0)"],
        required_checks_observed_on="2026-09-06",
    )

    assert "factorylm-ui-lab.yml:shared-ui" in jobs
    assert "Shared UI contract (bun 1.4.0)" in check_names
    assert cc.check_ci_jobs_exist(cap, jobs, set(), check_names) == []


def test_external_required_check_needs_a_dated_live_observation():
    cap = _cap(required_checks=["Shared UI contract (bun 1.4.0)"])
    findings = cc.check_ci_jobs_exist(
        cap,
        jobs=set(),
        gated=set(),
        workflow_check_names={"Shared UI contract (bun 1.4.0)"},
    )

    assert "required_check_observation_missing" in _rules(findings)


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


# --------------------------------------------------------------------------
# retrieval experiments: promotion needs a same-revision replay and every loss (#5138)
# --------------------------------------------------------------------------
_REV = "c6f15b8d357722308ee2e4fc1ebb65483e679488"


def _evidence(**over) -> dict:
    base = {
        "baseline": "production path",
        "treatment": "flag on",
        "baseline_revision": _REV,
        "treatment_revision": _REV,
        "independent": True,
        "replayed_by": "independent replay",
        "replay": "https://github.com/Mikecranesync/MIRA/issues/5138#issuecomment-6597399064",
        "losses": [{"case": "c1", "disposition": "open"}],
    }
    base.update(over)
    return base


def _experiment(env: str = "staging", **evidence_over) -> dict:
    envs = {"dev": "unset", "staging": "unset", "production": "unset"}
    envs[env] = "1"
    state = "production_enabled" if env == "production" else "staging_enabled"
    return _cap(
        state=state,
        environments=envs,
        owner="Owner",
        retrieval_experiment=True,
        promotion_evidence=_evidence(**evidence_over),
    )


def _promo(cap: dict) -> list:
    return [
        f
        for f in cc.check_retrieval_promotion_evidence(cap, _ROOT)
        if f.rule == "retrieval_promotion_evidence"
    ]


def test_staging_experiment_with_complete_replay_and_open_losses_passes():
    """Control: staging may run while losses are still open."""
    assert _promo(_experiment("staging")) == []


def test_off_or_undeclared_experiment_needs_no_replay():
    off = _cap(retrieval_experiment=True)
    assert _promo(off) == []
    undeclared = _experiment("staging")
    undeclared.pop("retrieval_experiment")
    undeclared.pop("promotion_evidence")
    assert _promo(undeclared) == []


def test_enabled_experiment_without_replay_fails():
    cap = _experiment("staging")
    cap.pop("promotion_evidence")
    assert _promo(cap)


def test_replay_at_different_revisions_fails():
    assert _promo(
        _experiment("staging", treatment_revision="dd2cc10fbb95e150c229cba0ee13d0edf666859c")
    )


def test_replay_at_a_revision_that_is_not_a_commit_fails():
    """Two equal hex strings are not a replay: the revision must exist (#5169 F2)."""
    assert _promo(
        _experiment("staging", baseline_revision="deadbeef0", treatment_revision="deadbeef0")
    )


def test_replay_reference_must_be_a_mira_issue_or_pr_link():
    """Free text is not evidence of a replay (#5169 F2); control is the default fixture."""
    assert _promo(_experiment("staging", replay="not a link"))
    assert _promo(_experiment("staging", replay="https://example.invalid/replay"))


def test_replay_not_independent_fails():
    assert _promo(_experiment("staging", independent=False))


def test_losses_must_be_listed_explicitly():
    assert _promo(_experiment("staging", losses=None))


def test_loss_without_case_or_known_disposition_fails():
    assert _promo(_experiment("staging", losses=[{"case": "c1", "disposition": "waived"}]))
    assert _promo(_experiment("staging", losses=[{"disposition": "open"}]))


def test_production_with_an_open_loss_fails():
    assert _promo(_experiment("production"))


def test_production_with_every_loss_dispositioned_passes():
    """Control for the rule above: owner-accepted and fixed losses may ship."""
    losses = [
        {
            "case": "c1",
            "disposition": "accepted",
            "decided_by": "Owner",
            "decision": "https://github.com/Mikecranesync/MIRA/issues/5138",
        },
        {"case": "c2", "disposition": "fixed", "ref": "#1"},
    ]
    assert _promo(_experiment("production", losses=losses)) == []


def test_loss_accepted_by_someone_other_than_the_owner_fails():
    losses = [
        {
            "case": "c1",
            "disposition": "accepted",
            "decided_by": "Implementer",
            "decision": "https://github.com/Mikecranesync/MIRA/issues/5138",
        }
    ]
    assert _promo(_experiment("production", losses=losses))


def test_loss_accepted_without_a_linked_decision_fails():
    losses = [{"case": "c1", "disposition": "accepted", "decided_by": "Owner"}]
    assert _promo(_experiment("production", losses=losses))


def test_loss_accepted_with_a_non_durable_decision_link_fails():
    losses = [
        {
            "case": "c1",
            "disposition": "accepted",
            "decided_by": "Owner",
            "decision": "https://example.invalid/d",
        }
    ]
    assert _promo(_experiment("production", losses=losses))


def test_loss_fixed_without_a_ref_fails():
    assert _promo(_experiment("production", losses=[{"case": "c1", "disposition": "fixed"}]))


def test_registry_rerank_cannot_reach_production_with_its_open_losses():
    """The live HOLD: setting production on for the reranker must fail validation."""
    caps = {c["id"]: c for c in _registry()["capabilities"]}
    rerank = dict(caps["notebook_cross_encoder_rerank"])
    assert rerank["retrieval_experiment"] is True
    assert _promo(rerank) == []
    rerank["environments"] = dict(rerank["environments"], production="1")
    assert any("still open" in f.message for f in _promo(rerank))


def test_registry_retrieval_experiments_are_declared():
    caps = {c["id"]: c for c in _registry()["capabilities"]}
    for cid in (
        "notebook_lexical_idf",
        "notebook_query_rewrite",
        "notebook_hybrid_retrieval",
        "notebook_cross_encoder_rerank",
    ):
        assert caps[cid].get("retrieval_experiment") is True, cid


def test_validate_runs_the_promotion_rule():
    """The rule must be wired into validate(), not only callable on its own."""
    reg = _registry()
    for c in reg["capabilities"]:
        if c["id"] == "notebook_cross_encoder_rerank":
            c["environments"] = dict(c["environments"], production="1")
    findings = cc.validate(reg, _ROOT)
    assert any(
        f.rule == "retrieval_promotion_evidence" and f.cap == "notebook_cross_encoder_rerank"
        for f in findings
    )


def test_acknowledgement_cannot_silence_an_open_production_loss():
    """An open regression ships only fixed or owner-accepted, never acknowledged (#5169 F1)."""
    cap = _experiment("production")
    cap.update(blocker="tracked in #1", acknowledged_rules=["retrieval_promotion_evidence"])
    findings = [f for f in cc.validate({"capabilities": [cap]}, _ROOT) if f.cap == cap["id"]]
    promo = [f for f in findings if f.rule == "retrieval_promotion_evidence"]
    assert promo, "precondition: the open production loss must be reported"
    assert not any(f.acknowledged for f in promo)
