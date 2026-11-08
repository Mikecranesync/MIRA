"""CI must use the declared Bun toolchain, not resolve a different latest."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
JOBS = (
    "mira-hub-unit",
    "mobile-unit-tests",
    "mira-web-pack-tests",
    "turn-lifecycle-reconciliation",
    "notebook-event-outbox-pg",
)


def assert_declared_toolchain(step: dict) -> None:
    inputs = step.get("with", {})
    assert inputs.get("bun-version-file") == "package.json"
    # Explicit version wins over the file in setup-bun, even if both exist.
    assert "bun-version" not in inputs
    assert "bun-download-url" not in inputs
    assert step.get("continue-on-error") in (None, False)


@pytest.mark.parametrize("job", JOBS)
def test_ci_uses_the_declared_bun_toolchain(job: str) -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text())
    setups = [
        step
        for step in workflow["jobs"][job]["steps"]
        if str(step.get("uses", "")).startswith("oven-sh/setup-bun@")
    ]
    assert len(setups) == 1
    assert_declared_toolchain(setups[0])


def test_package_manager_is_an_exact_bun_release() -> None:
    manager = json.loads((ROOT / "package.json").read_text())["packageManager"]
    assert re.fullmatch(r"bun@\d+\.\d+\.\d+", manager)


@pytest.mark.parametrize("job", JOBS)
def test_toolchain_inputs_trigger_their_consumers(job: str) -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text())
    filters = [
        yaml.safe_load(step["with"]["filters"])
        for step in workflow["jobs"][job]["steps"]
        if str(step.get("uses", "")).startswith("dorny/paths-filter@")
    ]
    assert len(filters) == 1
    patterns = [pattern for group in filters[0].values() for pattern in group]
    assert "package.json" in patterns
    assert ".github/workflows/ci.yml" in patterns


@pytest.mark.parametrize(
    "inputs",
    [
        {},
        {"bun-version": "latest"},
        {"bun-version-file": "package.json", "bun-version": "latest"},
        {"bun-version-file": "package.json", "bun-download-url": "https://test.invalid/bun.zip"},
    ],
)
def test_floating_or_overridden_toolchains_are_rejected(inputs: dict) -> None:
    with pytest.raises(AssertionError):
        assert_declared_toolchain({"with": inputs})


def test_toolchain_contract_is_executed_by_architecture_check() -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text())
    jobs = [job for job in workflow["jobs"].values() if job.get("name") == "Architecture Check"]
    assert len(jobs) == 1
    commands = "\n".join(step.get("run", "") for step in jobs[0]["steps"])
    assert "pytest tests/test_ci_bun_toolchain.py" in commands


@pytest.mark.parametrize("suite", ["cv101-catalog-scope", "cv101-photo-recall"])
def test_cv101_sql_regressions_are_triggered_executed_and_required(suite: str) -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text())
    job = workflow["jobs"]["turn-lifecycle-reconciliation"]
    short = f"src/capabilities/__tests__/{suite}.integration.test.ts"
    filters = next(
        yaml.safe_load(step["with"]["filters"])
        for step in job["steps"]
        if str(step.get("uses", "")).startswith("dorny/paths-filter@")
    )
    assert f"mira-hub/{short}" in filters["lifecycle"]
    script = next(
        step["run"]
        for step in job["steps"]
        if step.get("name") == "Reconciliation suite (must RUN, not skip)"
    )
    assert any(line.strip().rstrip("\\").rstrip() == short for line in script.splitlines())
    escaped = short.replace(".", r"\.")
    assert any("grep -qE" in line and escaped in line for line in script.splitlines())
