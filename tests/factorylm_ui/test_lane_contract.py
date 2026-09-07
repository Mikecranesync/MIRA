"""Baseline contract for the bounded FactoryLM UI verification lane.

The workflow-owned ``factorylm-ui-evidence`` profile always collects this
directory. Keeping a small protected baseline here makes the profile executable
before the first evidence-only slice and gives future lane tests a stable pytest
entrypoint without collecting the repository's unrelated Python suites.
"""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_PACKAGES = {
    "factorylm-theme": "@factorylm/theme",
    "factorylm-interaction": "@factorylm/interaction",
    "factorylm-ui": "@factorylm/ui",
}


def _package_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_canonical_shared_ui_packages_exist_with_expected_names() -> None:
    observed = {
        directory: _package_json(REPO_ROOT / "packages" / directory / "package.json")["name"]
        for directory in CANONICAL_PACKAGES
    }

    assert observed == CANONICAL_PACKAGES


def test_fixture_lab_exposes_the_workflow_owned_verification_scripts() -> None:
    manifest = _package_json(REPO_ROOT / "apps" / "factorylm-ui-lab" / "package.json")

    assert manifest["name"] == "factorylm-ui-lab"
    assert {"verify", "test:e2e"} <= manifest["scripts"].keys()
