"""Guards for Hub unit-source filters and required PDF/SQL contract execution.

Regression context (#3108): ``mira-hub/src/lib/safety-phrases.ts`` is a
transcription of ``mira-bots/shared/guardrails.py`` ``SAFETY_KEYWORDS``, and
``mira-hub/src/lib/safety-phrases.test.ts`` is a parity guard that fails on any
drift. But the ``Hub Unit Tests`` job in ``ci.yml`` is path-gated
(``dorny/paths-filter``), so a PR that adds a keyword to guardrails.py
*without* touching mira-hub never runs the parity test — the drift ships
silently. That is exactly how #3108's 8-phrase gap reached main.

Same class (#5166): ``notebook-retrieval-flag-guard.test.ts`` reads
``docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`` and fails if
``notebook_lexical_idf`` is recorded on in staging while it still skips
production lexical passes. A registry-only PR must still run Hub Unit Tests
or that guard never fires.

This contract fails loudly if the ``hub`` filter ever stops watching those
outside sources.

pytest + pyyaml only (matches the Architecture Check CI job's deps).
"""

from __future__ import annotations

from pathlib import Path
import json
import re
import subprocess
import sys

import pytest
import yaml

_ROOT = Path(__file__).resolve().parent.parent
_CI = _ROOT / ".github" / "workflows" / "ci.yml"

# The file whose edits must trigger the hub vitest suite (the parity guard's
# source of truth). Kept as a repo-relative POSIX path — matches the filter glob.
_GUARDRAILS = "mira-bots/shared/guardrails.py"
_HUB_GLOB = "mira-hub/**"
_CI_GLOB = ".github/workflows/ci.yml"
_CAPABILITY_CLOSURE = "docs/architecture/convergence/CAPABILITY_CLOSURE.yaml"
_FLAG_GUARD = (
    _ROOT / "mira-hub" / "src" / "lib" / "__tests__" / "notebook-retrieval-flag-guard.test.ts"
)

def _hub_filter_patterns() -> list[str]:
    """Return the glob list of the Hub Unit Tests job's ``hub`` paths-filter.

    Parses ci.yml, finds the job whose name is ``Hub Unit Tests``, and reads the
    ``filters`` YAML block passed to ``dorny/paths-filter`` (it is a literal YAML
    string inside the step's ``with.filters``)."""
    workflow = yaml.safe_load(_CI.read_text(encoding="utf-8"))
    jobs = workflow.get("jobs", {})
    hub_jobs = [j for j in jobs.values() if j.get("name") == "Hub Unit Tests"]
    assert hub_jobs, (
        "no job named 'Hub Unit Tests' in ci.yml — did the job rename? "
        "Update this contract to match."
    )
    for step in hub_jobs[0].get("steps", []):
        uses = str(step.get("uses", ""))
        if uses.startswith("dorny/paths-filter"):
            filters_raw = step.get("with", {}).get("filters", "")
            filters = yaml.safe_load(filters_raw) or {}
            assert "hub" in filters, (
                "the paths-filter step has no 'hub' filter — Hub Unit Tests "
                "path-gating changed shape; update this contract."
            )
            return list(filters["hub"])
    raise AssertionError("Hub Unit Tests job has no dorny/paths-filter step — path-gating removed?")


def test_hub_filter_watches_mira_hub():
    """Sanity: the filter still watches the hub tree itself."""
    assert _HUB_GLOB in _hub_filter_patterns(), (
        f"the Hub Unit Tests filter no longer watches '{_HUB_GLOB}'."
    )


def test_hub_filter_watches_guardrails_source_of_truth():
    """The filter MUST watch guardrails.py so the safety-parity test runs on any
    SAFETY_KEYWORDS change (#3108)."""
    patterns = _hub_filter_patterns()
    assert _GUARDRAILS in patterns, (
        f"the Hub Unit Tests path filter must include '{_GUARDRAILS}' so the "
        "safety-phrase parity test (safety-phrases.test.ts) runs when the "
        "SAFETY_KEYWORDS source of truth changes. Without it, a keyword added "
        "to guardrails.py drifts the hub copy undetected (#3108). "
        f"Current hub filter: {patterns}"
    )


def test_hub_filter_watches_capability_closure_registry():
    """A registry-only diff must still run Hub Unit Tests (#5166).

    ``notebook-retrieval-flag-guard.test.ts`` lives under ``mira-hub/**``, so
    once this path is in the filter the required job actually executes the
    guard. That guard fails if staging ``notebook_lexical_idf`` is set back
    to ``1`` while the flag still skips production lexical passes.
    """
    patterns = _hub_filter_patterns()
    assert _CAPABILITY_CLOSURE in patterns, (
        f"the Hub Unit Tests path filter must include '{_CAPABILITY_CLOSURE}' "
        "so notebook-retrieval-flag-guard.test.ts runs on a registry-only "
        "edit. Without it, recording notebook_lexical_idf on in staging "
        f"skips the guard (#5166). Current hub filter: {patterns}"
    )
    assert _FLAG_GUARD.is_file(), (
        "notebook-retrieval-flag-guard.test.ts must stay under mira-hub/** "
        "so a hub-filter hit actually runs it."
    )


def test_hub_filter_watches_its_own_workflow():
    assert _CI_GLOB in _hub_filter_patterns(), (
        "CI edits must execute the Hub suite and its executable guard control."
    )


def test_guard_negative_control_runs_with_the_actual_hub_suite():
    """Selection is a YAML contract; assertion semantics are tested by executing Vitest."""
    workflow = yaml.safe_load(_CI.read_text(encoding="utf-8"))
    hub = workflow["jobs"]["mira-hub-unit"]
    assert "if" not in hub, "The Hub job itself must not skip a registry-only PR."
    steps = hub["steps"]
    suite_index = next(
        i for i, step in enumerate(steps) if step.get("name") == "Run vitest unit suite"
    )
    control_index = next(
        i
        for i, step in enumerate(steps)
        if step.get("name") == "Prove retrieval flag guard rejects enabled bypasses"
    )
    suite, control = steps[suite_index], steps[control_index]
    assert control_index > suite_index
    assert suite["if"] == control["if"] == "steps.changes.outputs.hub == 'true'"
    assert suite["working-directory"] == control["working-directory"] == "mira-hub"
    gate = workflow["jobs"]["ci-gate"]
    assert "mira-hub-unit" in gate["needs"]


_PIPELINE_FILE = "src/lib/__tests__/t2108-doc-chat.integration.test.ts"
_PIPELINE_CASES = [
    "baseline", "rename", "unrelated", "order", "wrong-model",
    "foreign-tenant", "page-anchor", "blank",
]


def _pdf_pipeline_step():
    jobs = yaml.safe_load(_CI.read_text(encoding="utf-8"))["jobs"]
    steps = jobs["turn-lifecycle-reconciliation"]["steps"]
    found = [s for s in steps if s.get("name") == "PDF pipeline contract (must execute all eight)"]
    assert len(found) == 1, "Real PDF/SQL contract needs a positive execution-proof step"
    return found[0]


def test_pdf_pipeline_is_wired_into_the_required_gate():
    jobs = yaml.safe_load(_CI.read_text(encoding="utf-8"))["jobs"]
    step = _pdf_pipeline_step()
    assert step["if"] == "steps.changes.outputs.lifecycle == 'true'"
    assert step["working-directory"] == "mira-hub"
    assert not step.get("continue-on-error", False)
    assert _PIPELINE_FILE in step["run"]
    assert "-t 'PDF pipeline contract'" in step["run"]
    assert "--reporter=json" in step["run"] and "--outputFile=" in step["run"]
    gate = next(j for j in jobs.values() if j.get("name") == "CI Gate")
    assert "turn-lifecycle-reconciliation" in gate["needs"]
    evaluation = next(s for s in gate["steps"] if s.get("name") == "Evaluate gate (fail-closed)")
    assert evaluation["env"]["LIFECYCLE_RECON_RESULT"] == "${{ needs.turn-lifecycle-reconciliation.result }}"
    assert re.search(r'^require_success\s+turn-lifecycle-reconciliation\s+"\$LIFECYCLE_RECON_RESULT"$', evaluation["run"], re.M)


def test_pdf_pipeline_filter_covers_the_connected_sources():
    jobs = yaml.safe_load(_CI.read_text(encoding="utf-8"))["jobs"]
    steps = jobs["turn-lifecycle-reconciliation"]["steps"]
    filter_step = next(s for s in steps if str(s.get("uses", "")).startswith("dorny/paths-filter"))
    watched = yaml.safe_load(filter_step["with"]["filters"])["lifecycle"]
    for path in [
        "mira-hub/src/lib/**", "mira-hub/src/capabilities/**", "mira-hub/package.json",
        "mira-hub/bun.lock*", "mira-hub/vitest.integration.config.ts", "mira-hub/tsconfig.json",
        ".github/workflows/ci.yml", "tests/test_hub_unit_filter_contract.py",
    ]:
        assert path in watched, f"PDF pipeline input is not watched: {path}"


def _pdf_report(legacy=False):
    assertions = [
        {"title": f"[pipeline:{case}]", "status": "passed", "failureMessages": []}
        for case in _PIPELINE_CASES
    ]
    if legacy:
        assertions.append({"title": "original-manual audit", "status": "pending", "failureMessages": []})
    return {
        "success": True, "numTotalTests": len(assertions), "numPassedTests": 8,
        "numFailedTests": 0, "numPendingTests": int(legacy), "numTodoTests": 0,
        "testResults": [{"name": f"/checkout/mira-hub/{_PIPELINE_FILE}", "status": "passed", "assertionResults": assertions}],
    }


def _run_pdf_report_guard(tmp_path, report, raw=None):
    # Execute the actual workflow guard, never a test-side reimplementation.
    code = _pdf_pipeline_step()["run"].split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    path = tmp_path / "report.json"
    if report is not None:
        path.write_text(json.dumps(report) if raw is None else raw, encoding="utf-8")
    return subprocess.run([sys.executable, "-I", "-c", code, str(path)], capture_output=True, text=True)


@pytest.mark.parametrize("legacy", [False, True])
def test_pdf_report_accepts_all_required_cases_and_separates_legacy(tmp_path, legacy):
    result = _run_pdf_report_guard(tmp_path, _pdf_report(legacy))
    assert result.returncode == 0, result.stderr
    assert "8/8" in result.stdout


@pytest.mark.parametrize("mode", [
    "missing-report", "invalid-json", "zero", "wrong-file", "missing-file", "duplicate-file",
    "missing-case", "duplicate-case", "unknown-case", "skipped-case", "failed-case",
    "failure-message", "bad-count", "unsuccessful-run", "failed-file", "legacy-pass",
])
def test_pdf_report_rejects_incomplete_execution(tmp_path, mode):
    report = _pdf_report()
    file = report["testResults"][0]
    cases = file["assertionResults"]
    raw = None
    if mode == "missing-report":
        report = None
    elif mode == "invalid-json":
        raw = '{"success":'
    elif mode == "zero":
        cases.clear()
        report.update(numTotalTests=0, numPassedTests=0)
    elif mode == "wrong-file":
        file["name"] = "/another.test.ts"
    elif mode == "missing-file":
        report["testResults"] = []
    elif mode == "duplicate-file":
        report["testResults"].append(file.copy())
    elif mode == "missing-case":
        cases.pop()
        report.update(numTotalTests=7, numPassedTests=7)
    elif mode == "duplicate-case":
        cases[0] = cases[1].copy()
    elif mode == "unknown-case":
        cases[0]["title"] = "[pipeline:unexpected]"
    elif mode == "skipped-case":
        cases[0]["status"] = "pending"
        report.update(numPassedTests=7, numPendingTests=1)
    elif mode == "failed-case":
        cases[0]["status"] = "failed"
        report.update(numPassedTests=7, numFailedTests=1, success=False)
    elif mode == "failure-message":
        cases[0]["failureMessages"] = ["assertion failed"]
    elif mode == "bad-count":
        report["numTotalTests"] = 99
    elif mode == "unsuccessful-run":
        report["success"] = False
    elif mode == "failed-file":
        file["status"] = "failed"
    elif mode == "legacy-pass":
        cases[0]["title"] = "passing original-manual expected-miss assertion"
    result = _run_pdf_report_guard(tmp_path, report, raw)
    assert result.returncode != 0, f"guard accepted {mode}"
    assert "PDF pipeline contract:" in result.stderr
