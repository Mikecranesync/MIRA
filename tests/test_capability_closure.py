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
import json
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
_RERANK = "notebook_cross_encoder_rerank"
_ARTIFACT = "docs/evals/retrieval-eval/replays/notebook_cross_encoder_rerank-c6f15b8d3.json"
# The losses computed from that committed artifact (baseline hit, treatment miss).
_LOSSES = ["b3cde37e", "bef709ed", "c51364b4"]
_DECISION = "https://github.com/Mikecranesync/MIRA/issues/5138"
_CASE_SET = "notebook_failing_turns_5127"
_SETTINGS = {
    "NOTEBOOK_RERANK_TIMEOUT_MS": "4000",
    "NOTEBOOK_RERANK_POOL": "unset",
    "RERANKER_MODEL": "fp32",
}


def _evidence(**over) -> dict:
    base = {
        "baseline": "production path",
        "treatment": "flag on",
        "baseline_revision": _REV,
        "treatment_revision": _REV,
        "independent": True,
        "replayed_by": "independent replay",
        "replay": "https://github.com/Mikecranesync/MIRA/issues/5138#issuecomment-6597399064",
        "artifact": _ARTIFACT,
        "case_set": _CASE_SET,
        "treatment_settings": dict(_SETTINGS),
        "losses": [{"case": c, "disposition": "open"} for c in _LOSSES],
    }
    base.update(over)
    return base


def _experiment(env: str = "staging", **evidence_over) -> dict:
    envs = {"dev": "unset", "staging": "unset", "production": "unset"}
    envs[env] = "1"
    state = "production_enabled" if env == "production" else "staging_enabled"
    return _cap(
        id=_RERANK,
        state=state,
        environments=envs,
        owner="Owner",
        retrieval_experiment=True,
        retrieval_flag="NOTEBOOK_RERANK",
        promotion_evidence=_evidence(**evidence_over),
    )


def _accepted(case: str) -> dict:
    return {"case": case, "disposition": "accepted", "decided_by": "Owner", "decision": _DECISION}


def _with_first(first: dict) -> list:
    """`first` for the first loss; every other loss owner-accepted, so it alone decides."""
    return [first] + [_accepted(c) for c in _LOSSES[1:]]


def _registry_with(cap: dict, registry: dict | None = None) -> dict:
    """The committed registry with `cap` in place of its record of the same id."""
    reg = registry if registry is not None else _registry()
    caps = [c for c in reg["capabilities"] if c.get("id") != cap.get("id")]
    return dict(reg, capabilities=caps + [cap])


def _promo(cap: dict, registry: dict | None = None) -> list:
    return [
        f
        for f in cc.check_retrieval_promotion_evidence(cap, _ROOT, _registry_with(cap, registry))
        if f.rule == "retrieval_promotion_evidence"
    ]


def _says(cap: dict, text: str) -> bool:
    return any(text in f.message for f in _promo(cap))


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
    assert _says(
        _experiment("staging", treatment_revision="dd2cc10fbb95e150c229cba0ee13d0edf666859c"),
        "same revision",
    )


def test_replay_at_a_revision_that_is_not_a_commit_fails(monkeypatch):
    """Two equal hex strings are not a replay: the revision must exist (#5169 r1 F2).

    On a shallow clone (the Eval Offline job) "does this commit exist?" cannot be
    answered and the helper declines to, so pin full history: asserting the
    finding without it would assert the environment, not the rule.
    """
    monkeypatch.setattr(cc.evidence_provenance, "history_is_complete", lambda root: True)
    assert _says(
        _experiment("staging", baseline_revision="deadbeef0", treatment_revision="deadbeef0"),
        "is not a commit here",
    )


def test_replay_reference_must_be_a_mira_issue_or_pr_link():
    """The optional discussion link is still not free text (#5169 r1 F2)."""
    assert _says(_experiment("staging", replay="not a link"), "is not a MIRA issue or PR link")
    assert _says(
        _experiment("staging", replay="https://example.invalid/replay"),
        "is not a MIRA issue or PR link",
    )


def test_an_unrelated_mira_link_is_not_the_evidence():
    """Control: the link is discussion metadata; the committed artifact is the evidence."""
    assert (
        _promo(_experiment("staging", replay="https://github.com/Mikecranesync/MIRA/issues/1"))
        == []
    )


def test_replay_needs_a_committed_artifact():
    """A link alone, real or not, is not a replay (#5169 r2 F1)."""
    assert _says(_experiment("staging", artifact=""), "`promotion_evidence.artifact` is empty")
    assert _says(
        _experiment("staging", artifact="docs/evals/retrieval-eval/replays/missing.json"),
        "is not a file in this repository",
    )
    assert _says(
        _experiment("staging", artifact="../outside.json"), "is not a file in this repository"
    )
    # A real file outside the repository is still refused (precondition: it exists).
    assert Path("/etc/hosts").is_file()
    assert _says(_experiment("staging", artifact="/etc/hosts"), "is not a file in this repository")


def test_replay_artifact_must_match_the_record():
    lexical = "docs/evals/retrieval-eval/replays/notebook_lexical_idf-dd2cc10fb.json"
    assert _says(_experiment("staging", artifact=lexical), "is for 'notebook_lexical_idf'")
    other = "dd2cc10fbb95e150c229cba0ee13d0edf666859c"
    assert _says(
        _experiment("staging", baseline_revision=other, treatment_revision=other),
        "is not the replay revision",
    )


def test_a_loss_left_off_the_list_fails():
    """The listed losses must equal the artifact's: an omitted loss is caught."""
    cap = _experiment("staging", losses=[{"case": c, "disposition": "open"} for c in _LOSSES[1:]])
    assert _says(cap, f"loses {_LOSSES[0]}, which `losses` does not list")


def test_a_listed_case_the_artifact_does_not_lose_fails():
    losses = [{"case": c, "disposition": "open"} for c in _LOSSES + ["6eb70402"]]
    assert _says(_experiment("staging", losses=losses), "listed loss 6eb70402 is not a loss")


def test_replay_not_independent_fails():
    assert _says(_experiment("staging", independent=False), "independent")


def test_losses_must_be_listed_explicitly():
    assert _says(_experiment("staging", losses=None), "must list every lost case")


def test_loss_without_case_or_known_disposition_fails():
    waived = [{"case": _LOSSES[0], "disposition": "waived"}] + _with_first({})[1:]
    assert _says(_experiment("staging", losses=waived), "needs a `case` and a disposition")
    no_case = [{"disposition": "open"}] + [{"case": c, "disposition": "open"} for c in _LOSSES]
    assert _says(_experiment("staging", losses=no_case), "needs a `case` and a disposition")


def test_production_with_an_open_loss_fails():
    assert _says(_experiment("production"), "still open")


def test_production_with_every_loss_dispositioned_passes():
    """Control for the rule above: owner-accepted losses may ship."""
    accepted = {
        "case": _LOSSES[0],
        "disposition": "accepted",
        "decided_by": "Owner",
        "decision": _DECISION,
    }
    assert _promo(_experiment("production", losses=_with_first(accepted))) == []


def test_loss_accepted_by_someone_other_than_the_owner_fails():
    accepted = {
        "case": _LOSSES[0],
        "disposition": "accepted",
        "decided_by": "Implementer",
        "decision": _DECISION,
    }
    assert _says(_experiment("production", losses=_with_first(accepted)), "accepted without")


def test_ownerless_record_cannot_accept_a_loss():
    """No owner, no decided_by: None == None must not count as an owner decision (#5169 r2 F2)."""
    cap = _experiment(
        "production",
        losses=_with_first({"case": _LOSSES[0], "disposition": "accepted", "decision": _DECISION}),
    )
    cap.update(owner=None, owner_missing="no owner assigned yet")
    assert _says(cap, "accepted without")
    named = _experiment(
        "production",
        losses=_with_first(
            {"case": _LOSSES[0], "disposition": "accepted", "decided_by": "", "decision": _DECISION}
        ),
    )
    named["owner"] = ""
    assert _says(named, "accepted without")


def test_loss_accepted_without_a_linked_decision_fails():
    accepted = {"case": _LOSSES[0], "disposition": "accepted", "decided_by": "Owner"}
    assert _says(_experiment("production", losses=_with_first(accepted)), "accepted without")


def test_loss_accepted_with_a_non_durable_decision_link_fails():
    accepted = {
        "case": _LOSSES[0],
        "disposition": "accepted",
        "decided_by": "Owner",
        "decision": "https://example.invalid/d",
    }
    assert _says(_experiment("production", losses=_with_first(accepted)), "accepted without")


def test_a_loss_cannot_be_marked_fixed():
    """`fixed` with any ref is not evidence of a fix (#5169 r3 F2)."""
    for ref in ("anything", "#1", _DECISION):
        fixed = {"case": _LOSSES[0], "disposition": "fixed", "ref": ref}
        assert _says(_experiment("production", losses=_with_first(fixed)), "is marked fixed")


@pytest.fixture
def forge():
    """Write a modified copy of the committed rerank artifact inside the repo
    (the rule refuses files outside it) and remove it afterwards."""
    folder = _ROOT / "tests" / ".forged_replays"
    made: list[Path] = []

    def _forge(mutate) -> str:
        data = json.loads((_ROOT / _ARTIFACT).read_text(encoding="utf-8"))
        mutate(data)
        folder.mkdir(exist_ok=True)
        path = folder / f"forged_{len(made)}.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        made.append(path)
        return str(path.relative_to(_ROOT))

    yield _forge
    for path in made:
        path.unlink(missing_ok=True)
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()


def test_a_fix_is_a_newer_replay_in_which_the_case_no_longer_loses(forge):
    """Control for the rule above: the replay, not the list, retires a loss."""

    def fixed_first(d):
        d["cases"][_LOSSES[0]]["treatment_hit"] = True

    artifact = forge(fixed_first)
    rest = [_accepted(c) for c in _LOSSES[1:]]
    assert _promo(_experiment("production", artifact=artifact, losses=rest)) == []
    still_listed = [_accepted(_LOSSES[0])] + rest
    assert _says(
        _experiment("production", artifact=artifact, losses=still_listed),
        f"listed loss {_LOSSES[0]} is not a loss",
    )


def test_a_truncated_replay_cannot_pass(forge):
    """A proper subset of the case set with `losses: []` was green at r3 (#5169 r3 F1)."""
    keep = next(c for c in sorted(_registry_case_ids()) if c not in _LOSSES)

    def truncate(d):
        d["cases"] = {keep: d["cases"][keep]}

    cap = _experiment("production", artifact=forge(truncate), losses=[])
    assert _says(cap, "is missing cases of its case set")


def test_a_replay_with_cases_outside_its_set_fails(forge):
    def add(d):
        d["cases"]["0000aaaa"] = {"baseline_hit": False, "treatment_hit": False}

    assert _says(_experiment("staging", artifact=forge(add)), "cases outside its case set")


def _registry_case_ids() -> set[str]:
    entry = _registry()["retrieval_case_sets"][_CASE_SET]
    return set(json.loads((_ROOT / entry["path"]).read_text(encoding="utf-8"))["cases"])


def test_the_committed_artifact_matches_its_case_set_and_derived_arms():
    """Control for the configuration tests below."""
    assert _promo(_experiment("staging")) == []


@pytest.mark.parametrize(
    ("arm", "flag", "value", "expect"),
    [
        ("baseline", "NOTEBOOK_HYBRID_RETRIEVAL", "1", "must be off"),
        ("baseline", "NOTEBOOK_RERANK", "1", "must be off"),
        ("treatment", "NOTEBOOK_LEXICAL_V2", "1", "must be off"),
        ("treatment", "NOTEBOOK_RERANK", "0", "must be on"),
        ("treatment", "NOTEBOOK_RERANK", "maybe", "must be on"),
    ],
)
def test_a_replay_of_another_configuration_fails(forge, arm, flag, value, expect):
    """Wrong baseline or treatment arms cannot stand in for the real ones (#5169 r3 F1)."""

    def change(d):
        d[arm]["flags"][flag] = value

    assert _says(_experiment("staging", artifact=forge(change)), f"{arm} ran {flag}")
    assert _says(_experiment("staging", artifact=forge(change)), expect)


def test_a_replay_must_declare_every_experiment_flag(forge):
    def drop(d):
        d["baseline"]["flags"].pop("NOTEBOOK_QUERY_REWRITE")

    assert _says(_experiment("staging", artifact=forge(drop)), "are not the registered")


def test_treatment_settings_must_match_the_record(forge):
    def faster(d):
        d["treatment"]["settings"]["NOTEBOOK_RERANK_TIMEOUT_MS"] = "200"

    assert _says(_experiment("staging", artifact=forge(faster)), "treatment settings")
    other = dict(_SETTINGS, NOTEBOOK_RERANK_TIMEOUT_MS="200")
    assert _says(_experiment("staging", treatment_settings=other), "treatment settings")

    def baseline_settings(d):
        d["baseline"]["settings"] = {"NOTEBOOK_RERANK_TIMEOUT_MS": "4000"}

    assert _says(_experiment("staging", artifact=forge(baseline_settings)), "baseline settings")


def test_the_baseline_is_the_registrys_production_state():
    """Were hybrid on in production, a replay with hybrid off is not the production path."""
    reg = _registry()
    for c in reg["capabilities"]:
        if c["id"] == "notebook_hybrid_retrieval":
            c["environments"] = dict(c["environments"], production="1")
    assert any("must be on" in f.message for f in _promo(_experiment("staging"), reg))
    assert _promo(_experiment("staging")) == []


def test_case_set_must_be_registered_and_match_its_pin():
    assert _says(_experiment("staging", case_set="unknown_set"), "is not in `retrieval_case_sets`")
    reg = _registry()
    entry = reg["retrieval_case_sets"][_CASE_SET]
    entry["sha256"] = "0" * 64
    assert any("pinned sha256" in f.message for f in _promo(_experiment("staging"), reg))
    reg = _registry()
    reg["retrieval_case_sets"][_CASE_SET]["count"] = 30
    assert any("not its count" in f.message for f in _promo(_experiment("staging"), reg))


def test_artifact_must_name_the_records_case_set(forge):
    def rename(d):
        d["case_set"] = "another_set"

    assert _says(_experiment("staging", artifact=forge(rename)), "is not the record's")


def test_retrieval_flag_must_be_one_the_hub_reads():
    cap = _experiment("staging")
    cap["retrieval_flag"] = "NOTEBOOK_INVENTED_FLAG"
    assert _says(cap, "does not read")
    cap.pop("retrieval_flag")
    assert _promo(cap)


def test_hub_env_reads_sees_dotted_and_bracket_access(tmp_path):
    src = tmp_path / "mira-hub" / "src" / "lib"
    src.mkdir(parents=True)
    (src / "a.ts").write_text('x = process.env.NOTEBOOK_A; y = process.env["NOTEBOOK_B"];')
    tests = src / "__tests__"
    tests.mkdir()
    (tests / "t.ts").write_text("process.env.NOTEBOOK_TEST_ONLY")
    assert cc.hub_env_reads(tmp_path) == {"NOTEBOOK_A", "NOTEBOOK_B"}
    assert {"NOTEBOOK_RERANK", "NOTEBOOK_HYBRID_RETRIEVAL"} <= cc.hub_env_reads(_ROOT)


def test_validate_runs_the_provenance_check():
    """Unhooking evidence_provenance.check_registry from validate() must go red.

    Before #5169 this wiring was covered only by the committed-registry test,
    and only while some record had a provenance finding: replacing the call with
    a no-op left every suite green.
    """
    item = {
        "path": "tools/evidence_provenance.py",
        "observed_at": "2026-09-24",
        "provenance": {
            "commit_sha": "",
            "environment": "ci",
            "observed_at": "2026-09-24",
            "outcome": "pass",
            "falsified_by": "Revert the guard and the control must go red.",
        },
    }
    cap = _cap(state="staging_enabled", environments={"staging": "1"}, evidence=[item])
    reg = {"meta": {"provenance_enforced_from": "2026-09-01"}, "capabilities": [cap]}
    direct = {f.rule for f in cc.evidence_provenance.check_registry(reg, _ROOT)}
    assert "provenance_sha_missing" in direct, "precondition: the fixture has the finding"
    assert "provenance_sha_missing" in {f.rule for f in cc.validate(reg, _ROOT)}


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
