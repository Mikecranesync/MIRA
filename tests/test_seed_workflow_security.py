"""Security contract for production-capable SQL seed workflows."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SECURITY_TOOLS = ROOT / "tools" / "qa" / "security"
sys.path.insert(0, str(SECURITY_TOOLS))

from seed_workflow_guard import (  # noqa: E402
    SeedGuardError,
    destructive_seed_findings,
    resolve_seed,
)

WORKFLOWS = (
    ROOT / ".github" / "workflows" / "apply-seeds.yml",
    ROOT / ".github" / "workflows" / "apply-tag-scaling.yml",
    ROOT / ".github" / "workflows" / "apply-approved-tags.yml",
)


@pytest.mark.parametrize(
    "name",
    ("../../tests/seeds/evil", "subdir/name", "a;whoami", "$(whoami)", "..", ""),
)
def test_resolver_rejects_non_basename_inputs(tmp_path: Path, name: str):
    with pytest.raises(SeedGuardError):
        resolve_seed(tmp_path, name)


def test_resolver_accepts_regular_seed_inside_root(tmp_path: Path):
    seed = tmp_path / "approved_tags_conveyor.sql"
    seed.write_text("SELECT 1;\n", encoding="utf-8")

    assert resolve_seed(tmp_path, "approved_tags_conveyor") == seed.resolve()


def test_resolver_rejects_symlink_escape(tmp_path: Path):
    seed_dir = tmp_path / "seeds"
    seed_dir.mkdir()
    outside = tmp_path / "outside.sql"
    outside.write_text("SELECT 1;\n", encoding="utf-8")
    link = seed_dir / "escaped.sql"
    try:
        link.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    with pytest.raises(SeedGuardError, match="outside"):
        resolve_seed(seed_dir, "escaped")


@pytest.mark.parametrize(
    ("statement", "expected"),
    (
        ("DROP TABLE knowledge_entries;", "DROP TABLE"),
        ("DROP/**/TABLE knowledge_entries;", "DROP TABLE"),
        ("TRUNCATE knowledge_entries;", "TRUNCATE"),
        ("DELETE FROM knowledge_entries;", "DELETE FROM"),
    ),
)
def test_destructive_sql_is_rejected_but_comments_are_ignored(
    tmp_path: Path, statement: str, expected: str
):
    (tmp_path / "safe.sql").write_text(
        "-- DROP TABLE mentioned in a runbook\nSELECT 1;\n", encoding="utf-8"
    )
    (tmp_path / "unsafe.sql").write_text(
        f"BEGIN;\n{statement}\nCOMMIT;\n", encoding="utf-8"
    )

    findings = destructive_seed_findings(tmp_path)

    assert len(findings) == 1
    assert "unsafe.sql" in findings[0]
    assert expected in findings[0]


def test_repo_seed_directory_contains_no_destructive_sql():
    assert destructive_seed_findings(ROOT / "tools" / "seeds") == []


def test_dispatch_inputs_are_not_interpolated_into_shell_source():
    findings: list[str] = []
    for workflow_path in WORKFLOWS:
        workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
        for job_name, job in workflow["jobs"].items():
            for step in job.get("steps", []):
                run = step.get("run")
                if run and "${{ inputs." in run:
                    findings.append(
                        f"{workflow_path.name}:{job_name}:{step.get('name', '<unnamed>')}"
                    )

    assert findings == [], (
        "Dispatch inputs must enter shell steps through env, never expression "
        f"interpolation: {findings}"
    )


def test_all_seed_workflows_use_the_shared_containment_guard():
    missing = [
        path.name
        for path in WORKFLOWS
        if "seed_workflow_guard.py resolve" not in path.read_text(encoding="utf-8")
    ]

    assert missing == [], f"Workflows bypassing the shared seed resolver: {missing}"
