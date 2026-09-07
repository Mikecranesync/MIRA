"""Tests for the FactoryLM Unified UI Cutover legacy-presentation lifecycle guard.

FACTORYLM-UNIFIED-UI-CUTOVER-001. Charter:
docs/architecture/convergence/UNIFIED_UI_CUTOVER.md. Governance plan:
docs/superpowers/plans/2026-09-06-factorylm-unified-ui-cutover-governance.md.

This module proves `tools/ui_surface_lifecycle_guard.py` fails closed on every
addition/modification/deletion/rename-in/rename-out of a guarded legacy
presentation path or a control-plane file, and only opens for an EXACT,
substantive `legacy-ui-exception` label + PR-body section — never on
placeholder/blank/fenced/HTML-comment text standing in for one.

Written test-first (RED before GREEN): at the moment this file is added,
`tools/ui_surface_lifecycle_guard.py` does not exist, so collection fails.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
REAL_REGISTRY = REPO_ROOT / "docs" / "architecture" / "convergence" / "REGISTRY.yaml"

# Load by file path, not `import tools.ui_surface_lifecycle_guard` — `tests/conftest.py`
# inserts `mira-bots/` at the front of sys.path, and `mira-bots/tools/__init__.py` makes
# `mira-bots/tools` a REGULAR package that shadows the top-level `tools/` namespace
# package for the whole session (the same collision documented for `tools.runner` /
# `tools.learning_ingester`; see `tests/test_capability_closure.py` for the precedent).
_SPEC = importlib.util.spec_from_file_location(
    "ui_surface_lifecycle_guard", REPO_ROOT / "tools" / "ui_surface_lifecycle_guard.py"
)
assert _SPEC is not None and _SPEC.loader is not None
_guard = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("ui_surface_lifecycle_guard", _guard)
_SPEC.loader.exec_module(_guard)

CONTROL_PATTERNS = _guard.CONTROL_PATTERNS
MAX_EXPECTED_CHANGE_COUNT = _guard.MAX_EXPECTED_CHANGE_COUNT
PUBLIC_STATIC_GUARDED_ROOTS = _guard.PUBLIC_STATIC_GUARDED_ROOTS
HUB_PRESERVED_LIB_PATHS = _guard._HUB_PRESERVED_LIB_PATHS
WEB_PRESERVED_LIB_PATHS = _guard._WEB_PRESERVED_LIB_PATHS
ChangedFile = _guard.ChangedFile
GuardPolicy = _guard.GuardPolicy
GuardPolicyError = _guard.GuardPolicyError
GuardResult = _guard.GuardResult
_build_arg_parser = _guard._build_arg_parser
changed_files_between = _guard.changed_files_between
evaluate = _guard.evaluate
load_changed_files = _guard.load_changed_files
load_exception_approval = _guard.load_exception_approval
load_guard_policy = _guard.load_guard_policy
main = _guard.main
path_is_guarded = _guard.path_is_guarded
read_expected_change_count = _guard.read_expected_change_count
validate_expected_change_count = _guard.validate_expected_change_count


def _policy(*guarded_paths: str) -> GuardPolicy:
    """A bare policy for pure fixture tests (no CONTROL_PATTERNS injected —
    that only happens inside load_guard_policy, per the module's contract)."""
    return GuardPolicy(guarded_paths=tuple(guarded_paths))


# ---------------------------------------------------------------------------
# Dataclasses are immutable value objects
# ---------------------------------------------------------------------------


def test_changed_file_is_frozen_and_defaults_previous_path_to_none():
    cf = ChangedFile(status="modified", path="a/b.ts")
    assert cf.previous_path is None
    with pytest.raises(Exception):
        cf.status = "added"  # type: ignore[misc]


def test_guard_result_is_frozen():
    gr = GuardResult(allowed=True, guarded_paths=(), missing_fields=(), message="ok")
    with pytest.raises(Exception):
        gr.allowed = False  # type: ignore[misc]


def test_guard_policy_is_frozen():
    gp = _policy("legacy/tree/**")
    with pytest.raises(Exception):
        gp.guarded_paths = ()  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Literal-fixture outcomes: modification / addition / deletion / rename-in /
# rename-out under a guarded tree all fail without an exception.
# ---------------------------------------------------------------------------


def test_modification_under_guarded_tree_fails_without_exception():
    policy = _policy("legacy/tree/**")
    changes = [ChangedFile(status="modified", path="legacy/tree/a.ts")]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert "legacy/tree/a.ts" in result.guarded_paths


def test_addition_under_guarded_tree_fails_without_exception():
    policy = _policy("legacy/tree/**")
    changes = [ChangedFile(status="added", path="legacy/tree/new.ts")]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert "legacy/tree/new.ts" in result.guarded_paths


def test_deletion_under_guarded_tree_fails_without_exception():
    policy = _policy("legacy/tree/**")
    changes = [ChangedFile(status="removed", path="legacy/tree/gone.ts")]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert "legacy/tree/gone.ts" in result.guarded_paths


def test_rename_in_to_guarded_tree_fails_without_exception():
    policy = _policy("legacy/tree/**")
    changes = [
        ChangedFile(status="renamed", path="legacy/tree/dst.ts", previous_path="canonical/src.ts")
    ]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert "legacy/tree/dst.ts" in result.guarded_paths


def test_rename_out_of_guarded_tree_fails_without_exception():
    policy = _policy("legacy/tree/**")
    changes = [
        ChangedFile(status="renamed", path="canonical/dst.ts", previous_path="legacy/tree/src.ts")
    ]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert "legacy/tree/src.ts" in result.guarded_paths


def test_unrelated_canonical_package_change_passes():
    policy = _policy("legacy/tree/**")
    changes = [ChangedFile(status="modified", path="packages/factorylm-ui/src/Shell.tsx")]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is True
    assert result.guarded_paths == ()
    assert result.missing_fields == ()


def test_sibling_file_newly_created_under_each_guarded_directory_is_caught():
    real_policy = load_guard_policy(REAL_REGISTRY)
    siblings = [
        "mira-web/src/views/__brand_new_sibling__.ts",
        "mira-web/src/routes/__brand_new_sibling__.ts",
        "mira-hub/src/components/__brand_new_sibling__.tsx",
        "mira-hub/src/app/dashboard-copy/page.tsx",
        "mira-mobile/src/widgets/__brand_new_sibling__.tsx",
    ]
    for sib in siblings:
        assert path_is_guarded(sib, real_policy), f"expected {sib} to be guarded"
        changes = [ChangedFile(status="added", path=sib)]
        result = evaluate(changes, labels=set(), pr_body="", policy=real_policy)
        assert result.allowed is False, f"expected {sib} to be blocked without an exception"


# ---------------------------------------------------------------------------
# git-derived changes: deletion + both rename directions from a REAL temp repo
# ---------------------------------------------------------------------------


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=str(cwd), check=True, capture_output=True, text=True)


def _init_repo_with_rename_and_delete_history(tmp_path: Path) -> tuple[Path, str, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "init", "-q"], repo)
    _run(["git", "config", "user.email", "test@example.com"], repo)
    _run(["git", "config", "user.name", "Test"], repo)

    (repo / "legacy" / "tree").mkdir(parents=True)
    (repo / "canonical").mkdir(parents=True)
    (repo / "legacy" / "tree" / "a.ts").write_text("line1\nline2\nline3\nline4\nline5\n")
    (repo / "canonical" / "src.ts").write_text("lineA\nlineB\nlineC\nlineD\nlineE\n")
    (repo / "todelete.ts").write_text("x\n")
    _run(["git", "add", "-A"], repo)
    _run(["git", "commit", "-qm", "base"], repo)
    base = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(repo), capture_output=True, text=True, check=True
    ).stdout.strip()

    # rename-out of the guarded tree, rename-in to the guarded tree, and a delete.
    _run(["git", "mv", "legacy/tree/a.ts", "canonical/a_moved.ts"], repo)
    _run(["git", "mv", "canonical/src.ts", "legacy/tree/dst.ts"], repo)
    _run(["git", "rm", "-q", "todelete.ts"], repo)
    _run(["git", "commit", "-qm", "rename + delete"], repo)
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(repo), capture_output=True, text=True, check=True
    ).stdout.strip()
    return repo, base, head


def test_changed_files_between_derives_delete_and_both_rename_directions(tmp_path):
    repo, base, head = _init_repo_with_rename_and_delete_history(tmp_path)
    changes = changed_files_between(repo, base, head)
    by_path = {c.path: c for c in changes}

    assert "todelete.ts" in by_path
    assert by_path["todelete.ts"].status == "removed"
    assert by_path["todelete.ts"].previous_path is None

    assert "canonical/a_moved.ts" in by_path
    assert by_path["canonical/a_moved.ts"].status == "renamed"
    assert by_path["canonical/a_moved.ts"].previous_path == "legacy/tree/a.ts"

    assert "legacy/tree/dst.ts" in by_path
    assert by_path["legacy/tree/dst.ts"].status == "renamed"
    assert by_path["legacy/tree/dst.ts"].previous_path == "canonical/src.ts"


def test_git_derived_delete_and_renames_fail_without_exception(tmp_path):
    repo, base, head = _init_repo_with_rename_and_delete_history(tmp_path)
    changes = changed_files_between(repo, base, head)
    policy = _policy("legacy/tree/**")
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    # rename-out (legacy/tree/a.ts -> canonical/a_moved.ts) and rename-in
    # (canonical/src.ts -> legacy/tree/dst.ts) must both be caught.
    assert "legacy/tree/a.ts" in result.guarded_paths
    assert "legacy/tree/dst.ts" in result.guarded_paths
    # the plain delete outside any guarded tree must not be flagged.
    assert "todelete.ts" not in result.guarded_paths


# ---------------------------------------------------------------------------
# Immutable tree evidence — path-only pull-file metadata cannot reveal a
# symlink, chmod, gitlink, or file/directory substitution.  The guard must use
# base/head tree entries and fail closed even when the changed pathname itself
# would otherwise be an open capability/canonical seam.
# ---------------------------------------------------------------------------


def _init_empty_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "init", "-q"], repo)
    _run(["git", "config", "user.email", "test@example.com"], repo)
    _run(["git", "config", "user.name", "Test"], repo)
    _run(["git", "config", "core.fileMode", "true"], repo)
    return repo


def _commit_and_sha(repo: Path, message: str) -> str:
    _run(["git", "add", "-A"], repo)
    _run(["git", "commit", "-qm", message], repo)
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(repo),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_git_derived_open_path_symlink_into_frozen_tree_fails_closed(tmp_path):
    repo = _init_empty_repo(tmp_path)
    frozen = repo / "mira-web" / "src" / "views" / "home.ts"
    frozen.parent.mkdir(parents=True)
    frozen.write_text("export const frozen = true;\n")
    base = _commit_and_sha(repo, "base frozen presentation")

    link = repo / "mira-web" / "src" / "capabilities" / "view-data.ts"
    link.parent.mkdir(parents=True)
    link.symlink_to("../views/home.ts")
    head = _commit_and_sha(repo, "add capability-shaped symlink")

    policy = load_guard_policy(REAL_REGISTRY)
    relative_link = "mira-web/src/capabilities/view-data.ts"
    assert not path_is_guarded(relative_link, policy), "the path alone is an open capability seam"

    changes = changed_files_between(repo, base, head)
    change = next(change for change in changes if change.path == relative_link)
    assert change.tree_evidence_complete is True
    assert change.old_mode is None
    assert change.new_mode == "120000"
    assert change.new_type == "blob"

    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert relative_link in result.guarded_paths


def test_git_derived_chmod_on_otherwise_open_path_fails_closed(tmp_path):
    repo = _init_empty_repo(tmp_path)
    script = repo / "scripts" / "audit-helper.sh"
    script.parent.mkdir(parents=True)
    script.write_text("#!/bin/sh\nexit 0\n")
    script.chmod(0o644)
    base = _commit_and_sha(repo, "base non-executable helper")

    script.chmod(0o755)
    head = _commit_and_sha(repo, "make helper executable")

    path = "scripts/audit-helper.sh"
    policy = load_guard_policy(REAL_REGISTRY)
    assert not path_is_guarded(path, policy)
    changes = changed_files_between(repo, base, head)
    change = next(change for change in changes if change.path == path)
    assert (change.old_mode, change.new_mode) == ("100644", "100755")

    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert path in result.guarded_paths


def test_git_derived_file_to_directory_substitution_fails_closed(tmp_path):
    repo = _init_empty_repo(tmp_path)
    substituted = repo / "scripts" / "audit-fixture"
    substituted.parent.mkdir(parents=True)
    substituted.write_text("ordinary file\n")
    base = _commit_and_sha(repo, "base ordinary file")

    substituted.unlink()
    substituted.mkdir()
    (substituted / "child.txt").write_text("replacement directory\n")
    head = _commit_and_sha(repo, "substitute a directory")

    path = "scripts/audit-fixture"
    policy = load_guard_policy(REAL_REGISTRY)
    assert not path_is_guarded(path, policy)
    changes = changed_files_between(repo, base, head)
    change = next(change for change in changes if change.path == path)
    assert (change.old_mode, change.old_type) == ("100644", "blob")
    assert (change.new_mode, change.new_type) == ("040000", "tree")

    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False
    assert path in result.guarded_paths


def test_git_tree_evidence_uses_three_dot_merge_base_not_base_branch_tip(tmp_path):
    repo = _init_empty_repo(tmp_path)
    script = repo / "scripts" / "audit-helper.sh"
    script.parent.mkdir(parents=True)
    script.write_text("base\n")
    script.chmod(0o644)
    merge_base = _commit_and_sha(repo, "shared base")
    base_branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=str(repo),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    _run(["git", "checkout", "-qb", "feature", merge_base], repo)
    script.write_text("feature content\n")
    head = _commit_and_sha(repo, "feature content change")

    _run(["git", "checkout", "-q", base_branch], repo)
    script.chmod(0o755)
    base_tip = _commit_and_sha(repo, "unrelated base chmod")

    changes = changed_files_between(repo, base_tip, head)
    change = next(change for change in changes if change.path == "scripts/audit-helper.sh")
    assert (change.old_mode, change.new_mode) == ("100644", "100644")
    result = evaluate(changes, labels=set(), pr_body="", policy=load_guard_policy(REAL_REGISTRY))
    assert result.allowed is True


# ---------------------------------------------------------------------------
# CONTROL_PATTERNS are guarded even if the head revision changed policy —
# because they are code-owned constants, never sourced from the registry file.
# ---------------------------------------------------------------------------


def test_control_patterns_are_hardcoded_constants_not_from_the_registry():
    assert "docs/architecture/convergence/REGISTRY.yaml" in CONTROL_PATTERNS
    assert "docs/architecture/convergence/UNIFIED_UI_CUTOVER.md" in CONTROL_PATTERNS
    assert "tools/ui_surface_lifecycle_guard.py" in CONTROL_PATTERNS
    assert "tests/test_ui_surface_lifecycle_guard.py" in CONTROL_PATTERNS
    assert ".claude/rules/factorylm-unified-ui-cutover.md" in CONTROL_PATTERNS
    assert ".claude/workflows/flm-ui-map.js" in CONTROL_PATTERNS
    assert ".claude/workflows/flm-ui-slice.js" in CONTROL_PATTERNS
    assert ".claude/workflows/flm-ui-verify.js" in CONTROL_PATTERNS
    assert ".github/workflows/**" in CONTROL_PATTERNS


def test_ota_handset_evidence_validator_is_guarded_but_receipts_remain_open():
    """Validation policy is trusted code; immutable handset facts are review input."""
    policy = load_guard_policy(REAL_REGISTRY)

    assert "tools/ota_handset_evidence.py" in CONTROL_PATTERNS
    assert path_is_guarded("tools/ota_handset_evidence.py", policy)
    assert not path_is_guarded("tests/test_ota_handset_evidence.py", policy)
    assert not path_is_guarded("docs/release/evidence/ota/README.md", policy)
    assert not path_is_guarded(
        "docs/release/evidence/ota/0123456789abcdef.json",
        policy,
    )


@pytest.mark.parametrize(
    "control_path",
    [
        "conftest.py",
        "tests/conftest.py",
        "pyproject.toml",
        "pytest.ini",
        "setup.cfg",
        "tox.ini",
        "tools/yaml.py",
        "tools/markdown_it.py",
        "pip.py",
        "sitecustomize.py",
        "usercustomize.py",
    ],
)
def test_transitive_trusted_base_inputs_are_control_patterns(control_path):
    """A precursor PR cannot plant code/config that a later guard executes."""
    policy = load_guard_policy(REAL_REGISTRY)

    assert control_path in CONTROL_PATTERNS
    assert path_is_guarded(control_path, policy)
    result = evaluate(
        [ChangedFile(status="added", path=control_path)],
        labels=set(),
        pr_body="",
        policy=policy,
    )
    assert result.allowed is False


def test_pip_package_shadow_is_a_control_pattern():
    """The pre-evaluation installer cannot import a PR-controlled pip package."""
    policy = load_guard_policy(REAL_REGISTRY)
    shadow = "pip/__init__.py"

    assert "pip/**" in CONTROL_PATTERNS
    assert path_is_guarded(shadow, policy)
    result = evaluate(
        [ChangedFile(status="added", path=shadow)],
        labels=set(),
        pr_body="",
        policy=policy,
    )
    assert result.allowed is False


def test_arbitrary_github_workflow_is_guarded_without_exception():
    """A PR-head workflow cannot be allowed to spoof a trusted status name."""
    real_policy = load_guard_policy(REAL_REGISTRY)
    spoof = ".github/workflows/spoof-legacy-ui-status.yml"

    assert path_is_guarded(spoof, real_policy)
    result = evaluate(
        [ChangedFile(status="added", path=spoof)],
        labels=set(),
        pr_body="",
        policy=real_policy,
    )

    assert result.allowed is False
    assert spoof in result.guarded_paths


def test_control_patterns_stay_guarded_even_if_registry_has_no_legacy_entries(tmp_path):
    stripped_registry = tmp_path / "REGISTRY.yaml"
    stripped_registry.write_text(
        textwrap.dedent(
            """
            some-module:
              repo: MIRA
              path: some-module/
              tags: ["type:engine", "domain:platform"]
              status: CANONICAL
            """
        )
    )
    policy = load_guard_policy(stripped_registry)
    for control_path in CONTROL_PATTERNS:
        assert path_is_guarded(control_path, policy), (
            f"{control_path} must stay guarded even when the (simulated tampered) "
            "head revision's registry carries no legacy entries at all"
        )
    changes = [ChangedFile(status="modified", path="tools/ui_surface_lifecycle_guard.py")]
    result = evaluate(changes, labels=set(), pr_body="", policy=policy)
    assert result.allowed is False


# ---------------------------------------------------------------------------
# Exception body/label parsing
# ---------------------------------------------------------------------------

_TOUCH = [ChangedFile(status="modified", path="legacy/tree/a.ts")]
_POLICY = _policy("legacy/tree/**")

_VALID_BODY = textwrap.dedent(
    """
    Some PR description text.

    ## Legacy UI exception

    Reason: severity-1 production repair for a broken rollback path
    Canonical replacement impact: none, this only touches the recovery route
    Rollback: revert this commit; the legacy route is otherwise untouched
    """
)


def test_valid_label_without_body_fails():
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body="", policy=_POLICY)
    assert result.allowed is False


def test_valid_body_without_label_fails():
    result = evaluate(_TOUCH, labels=set(), pr_body=_VALID_BODY, policy=_POLICY)
    assert result.allowed is False


def test_missing_fields_in_section_fail():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: a real reason for this exception
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Canonical replacement impact" in f for f in result.missing_fields)
    assert any("Rollback" in f for f in result.missing_fields)


def test_blank_fields_fail():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason:
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


@pytest.mark.parametrize(
    "placeholder", ["N/A", "n/a", "NA", "None", "not applicable", "TBD", "todo"]
)
def test_na_style_placeholder_values_fail(placeholder):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {placeholder}
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


def test_angle_bracket_placeholder_values_fail():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: <why the change cannot be made in the canonical shell or adapter>
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("unsafe or non-comment HTML" in f for f in result.missing_fields)


def test_html_comment_only_values_fail():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: <!-- explain why here -->
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


def test_duplicate_exception_sections_fail():
    body = _VALID_BODY + "\n" + _VALID_BODY
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("duplicate" in f.lower() for f in result.missing_fields)


def test_complete_block_inside_fenced_code_block_fails():
    body = "```markdown\n" + _VALID_BODY + "\n```\n"
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False


def test_exactly_one_live_section_with_substantive_values_passes():
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=_VALID_BODY,
        policy=_POLICY,
        exception_approval_valid=True,
    )
    assert result.allowed is True


def test_exception_fields_ignore_later_work_claim_fields():
    body = _VALID_BODY + textwrap.dedent(
        """

        [WORK-CLAIM]
        Slice: unified UI cutover governance
        Status: ACTIVE
        Rollback: revert the work-claim implementation
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is True


@pytest.mark.parametrize("boundary", ["   # Other", "   ## Other", "   [WORK-CLAIM]"])
def test_indented_top_level_boundary_cannot_supply_exception_fields(boundary):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: severity-1 production repair for a broken rollback path
        Canonical replacement impact: none, this only touches the recovery route

        {boundary}
        Rollback: this belongs to a different top-level block
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:Rollback:" in result.missing_fields


@pytest.mark.parametrize(
    "boundary",
    [f"{' ' * indent}{marker}" for indent in range(4) for marker in ("#", "##")],
)
def test_bare_commonmark_atx_boundary_cannot_supply_exception_fields(boundary):
    body = (
        textwrap.dedent(
            """
        ## Legacy UI exception

        Reason: severity-1 production repair for a broken rollback path
        Canonical replacement impact: none, this only touches the recovery route
        """
        )
        + f"\n{boundary}\nRollback: this belongs to a different top-level section\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:Rollback:" in result.missing_fields


@pytest.mark.parametrize("underline", ["===", "---", "   ===", "   ---"])
def test_setext_heading_boundary_cannot_supply_exception_fields(underline):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: severity-1 production repair for a broken rollback path
        Canonical replacement impact: none, this only touches the recovery route

        Other section
        {underline}
        Rollback: this belongs to the Setext-heading section
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:Rollback:" in result.missing_fields


@pytest.mark.parametrize("pseudo_boundary", ["    ## Other", "    [WORK-CLAIM]", "    ==="])
def test_four_space_indented_pseudo_boundary_stays_inside_exception(pseudo_boundary):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: severity-1 production repair for a broken rollback path
        Canonical replacement impact: none, this only touches the recovery route

        {pseudo_boundary}
        Rollback: this remains part of the exception section
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is True


def test_commonmark_indented_exception_heading_is_live():
    body = _VALID_BODY.replace("## Legacy UI exception", "   ## Legacy UI exception")

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is True


def test_valid_label_and_body_without_fresh_bound_approval_fail():
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=_VALID_BODY,
        policy=_POLICY,
    )

    assert result.allowed is False
    assert "approval:fresh legacy-ui-exception label bound to current head/body" in (
        result.missing_fields
    )


def _write_exception_approval_files(
    tmp_path: Path,
    *,
    event_body: str = _VALID_BODY,
    current_body: str = _VALID_BODY,
    event_head: str = "a" * 40,
    current_head: str = "a" * 40,
    action: str = "labeled",
    event_label: str = "legacy-ui-exception",
    sender_type: str = "User",
    permission: str = "write",
    role_name: str = "maintain",
    permission_login: str = "maintainer",
) -> tuple[Path, Path, Path]:
    event = {
        "action": action,
        "number": 123,
        "label": {"name": event_label},
        "sender": {"login": "maintainer", "type": sender_type},
        "repository": {"full_name": "Factory/MIRA"},
        "pull_request": {
            "number": 123,
            "body": event_body,
            "head": {"sha": event_head},
        },
    }
    current = {
        "number": 123,
        "body": current_body,
        "head": {"sha": current_head},
        "base": {"repo": {"full_name": "Factory/MIRA"}},
        "labels": [{"name": "legacy-ui-exception"}],
    }
    event_path = tmp_path / "event.json"
    pull_path = tmp_path / "current-pr.json"
    permission_path = tmp_path / "approver-permission.json"
    event_path.write_text(json.dumps(event))
    pull_path.write_text(json.dumps(current))
    permission_path.write_text(
        json.dumps(
            {
                "permission": permission,
                "role_name": role_name,
                "user": {"login": permission_login},
            }
        )
    )
    return event_path, pull_path, permission_path


def test_fresh_user_label_event_bound_to_current_head_and_body_is_valid(tmp_path):
    event_path, pull_path, permission_path = _write_exception_approval_files(tmp_path)

    approval = load_exception_approval(event_path, pull_path, permission_path)

    assert approval.valid is True
    assert approval.approver == "maintainer"


@pytest.mark.parametrize(
    "overrides",
    [
        {"current_body": _VALID_BODY + "\nchanged after approval"},
        {"current_head": "b" * 40},
        {"action": "edited"},
        {"event_label": "some-other-label"},
        {"sender_type": "Bot"},
    ],
)
def test_exception_approval_invalidates_on_body_head_event_or_actor_change(tmp_path, overrides):
    event_path, pull_path, permission_path = _write_exception_approval_files(tmp_path, **overrides)

    approval = load_exception_approval(event_path, pull_path, permission_path)

    assert approval.valid is False


@pytest.mark.parametrize(
    ("permission", "role_name"),
    [
        ("write", "write"),
        ("read", "triage"),
        ("read", "read"),
        ("none", "none"),
        ("write", "custom-release-role"),
    ],
)
def test_exception_approval_rejects_actor_without_maintain_or_admin_permission(
    tmp_path, permission, role_name
):
    event_path, pull_path, permission_path = _write_exception_approval_files(
        tmp_path, permission=permission, role_name=role_name
    )

    approval = load_exception_approval(event_path, pull_path, permission_path)

    assert approval.valid is False
    assert "maintain or admin" in approval.reason


def test_exception_approval_accepts_admin_legacy_permission(tmp_path):
    event_path, pull_path, permission_path = _write_exception_approval_files(
        tmp_path, permission="admin", role_name="admin"
    )

    approval = load_exception_approval(event_path, pull_path, permission_path)

    assert approval.valid is True


def test_exception_approval_rejects_permission_record_for_different_actor(tmp_path):
    event_path, pull_path, permission_path = _write_exception_approval_files(
        tmp_path, permission_login="someone-else"
    )

    approval = load_exception_approval(event_path, pull_path, permission_path)

    assert approval.valid is False
    assert "permission record actor mismatches" in approval.reason


# ---------------------------------------------------------------------------
# Codex remediation finding #2 — harden rendered exception-body parsing:
#   * closed/unclosed backtick and tilde fences must never expose code as a
#     live exception section;
#   * a closed/unclosed HTML comment must never supply attestation text;
#   * placeholder detection must catch phrase VARIANTS ("TODO fill later",
#     "TBD later", "N/A because...", "placeholder") anchored at the START of
#     the value, and punctuation-only values, WITHOUT rejecting a substantive
#     value that merely mentions one of those words mid-sentence;
#   * a duplicated field label within one section is ambiguous and must fail
#     closed rather than silently using the first match.
# ---------------------------------------------------------------------------
def test_unclosed_fenced_code_block_swallows_everything_after_it():
    # An unclosed ``` fence run through EOF must drop the real exception
    # section that follows it — never leave it scannable, but also never
    # leave it silently un-stripped as literal ``` text in the visible body.
    body = "```markdown\nsome pasted diff\n" + _VALID_BODY
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Legacy UI exception section" in f for f in result.missing_fields)


def test_tilde_fenced_code_block_is_stripped_like_backticks():
    body = "~~~markdown\n" + _VALID_BODY + "\n~~~\n"
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False


@pytest.mark.parametrize(
    "body",
    [
        textwrap.dedent(
            """
            - ```markdown
              ## Legacy UI exception
            Reason: severity one repair for a broken rollback path
            Canonical replacement impact: canonical shell remains fully unaffected
            Rollback: revert the emergency repair commit cleanly
            """
        ),
        textwrap.dedent(
            """
            1. ~~~markdown
               ## Legacy UI exception
               ~~~
            Reason: severity one repair for a broken rollback path
            Canonical replacement impact: canonical shell remains fully unaffected
            Rollback: revert the emergency repair commit cleanly
            """
        ),
        textwrap.dedent(
            """
            - ```markdown
              decoy
            - ```
              ## Legacy UI exception
            Reason: severity one repair for a broken rollback path
            Canonical replacement impact: canonical shell remains fully unaffected
            Rollback: revert the emergency repair commit cleanly
            """
        ),
    ],
    ids=(
        "unclosed-unordered-list-fence",
        "closed-ordered-list-fence",
        "sibling-list-fence-is-not-a-closer",
    ),
)
def test_list_contained_fence_cannot_supply_exception_heading(body):
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    expected = (
        "body:renderer-specific markup invalidates Legacy UI exception"
        if "~" in body
        else "body:## Legacy UI exception section"
    )
    assert expected in result.missing_fields


@pytest.mark.parametrize(
    "body",
    [
        "```markdown\npasted context\n> ```\n" + _VALID_BODY + "\n```\n",
        "> ```markdown\n> pasted context\n```\n" + _VALID_BODY + "\n```\n",
    ],
    ids=("top-level-to-blockquote", "blockquote-to-top-level"),
)
def test_container_transition_cannot_close_fence_and_expose_exception(body):
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:## Legacy UI exception section" in result.missing_fields


def test_closed_top_level_fence_before_live_exception_still_passes():
    body = "```markdown\npasted context\n```\n" + _VALID_BODY

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is True


@pytest.mark.parametrize(
    "open_tag,close_tag",
    [
        ("<pre>", "</pre>"),
        ("<script>", "</script>"),
        ("<div>", "</div>"),
        ("<details>", "</details>"),
    ],
)
def test_raw_html_block_cannot_supply_exception_heading(open_tag, close_tag):
    body = (
        f"{open_tag}\n## Legacy UI exception\n{close_tag}\n"
        "Reason: severity one repair for a broken rollback path\n"
        "Canonical replacement impact: canonical shell remains fully unaffected\n"
        "Rollback: revert the emergency repair commit cleanly\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_raw_html_block_cannot_supply_exception_fields():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        <div>
        Reason: severity one repair for a broken rollback path
        Canonical replacement impact: canonical shell remains fully unaffected
        Rollback: revert the emergency repair commit cleanly
        </div>
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


@pytest.mark.parametrize("tag", ["details", "div", "blockquote", "section"])
def test_blank_line_html_container_cannot_wrap_exception_section(tag):
    body = (
        f"<{tag}>\n\n"
        "## Legacy UI exception\n\n"
        "Reason: severity one repair for a broken rollback path\n"
        "Canonical replacement impact: canonical shell remains fully unaffected\n"
        "Rollback: revert the emergency repair commit cleanly\n\n"
        f"</{tag}>\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_non_comment_inline_html_invalidates_exception_body():
    body = _VALID_BODY.replace(
        "Reason: severity-1 production repair for a broken rollback path",
        "Reason: <span>severity-1 production repair for a broken rollback path</span>",
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_standalone_html_comment_before_live_exception_is_allowed():
    body = "<!-- reviewer context only -->\n\n" + _VALID_BODY

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is True


@pytest.mark.parametrize(
    "prefix",
    ["<!-- --!><details><!-- -->", "<!--><details>x-->"],
    ids=("abrupt-comment-close", "bogus-comment-close"),
)
def test_malformed_html_comment_cannot_open_hidden_container(prefix):
    body = prefix + "\n\n" + _VALID_BODY + "\n\n</details>\n"

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_overlapping_html_comment_delimiters_are_not_a_valid_empty_comment():
    body = "<!--->\n\n" + _VALID_BODY

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:unsafe or non-comment HTML invalidates Legacy UI exception" in (
        result.missing_fields
    )


@pytest.mark.parametrize(
    "nested_heading",
    ["- item\n  ## Legacy UI exception", "> ## Legacy UI exception"],
    ids=("list", "blockquote"),
)
def test_nested_heading_is_not_a_top_level_exception_section(nested_heading):
    body = (
        nested_heading
        + "\nReason: severity one repair for a broken rollback path\n"
        + "Canonical replacement impact: canonical shell remains fully unaffected\n"
        + "Rollback: revert the emergency repair commit cleanly\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:## Legacy UI exception section" in result.missing_fields


@pytest.mark.parametrize("separator", ["\u2028", "\u2029", "\u0085", "\v", "\f"])
def test_non_commonmark_line_separator_cannot_shift_exception_heading_lookup(separator):
    body = (
        f"prefix{separator}## Legacy UI exception\n"
        "## Other heading\n"
        "Reason: severity one repair for a broken rollback path\n"
        "Canonical replacement impact: canonical shell remains fully unaffected\n"
        "Rollback: revert the emergency repair commit cleanly\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:## Legacy UI exception section" in result.missing_fields


def test_gfm_table_cannot_supply_top_level_exception_fields():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: severity one repair for a broken rollback path | note
        --- | ---
        Canonical replacement impact: canonical shell remains fully unaffected | note
        Rollback: revert the emergency repair commit cleanly | note
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


def test_struck_through_text_cannot_supply_exception_field_value():
    body = _VALID_BODY.replace(
        "Reason: severity-1 production repair for a broken rollback path",
        "Reason: ~~severity-1 production repair for a broken rollback path~~",
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:renderer-specific markup invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_github_single_tilde_struck_text_cannot_supply_exception_field_values():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: ~severity one repair for a broken rollback path~
        Canonical replacement impact: ~canonical shell remains fully unaffected~
        Rollback: ~revert the emergency repair commit cleanly~
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:renderer-specific markup invalidates Legacy UI exception" in (
        result.missing_fields
    )


def test_github_single_tilde_wrapper_cannot_strike_entire_attestation_paragraph():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        ~concealed attestation begins
        Reason: severity one repair for a broken rollback path
        Canonical replacement impact: canonical shell remains fully unaffected
        Rollback: revert the emergency repair commit cleanly
        concealed attestation ends~
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert "body:renderer-specific markup invalidates Legacy UI exception" in (
        result.missing_fields
    )


@pytest.mark.parametrize(
    "body",
    [
        textwrap.dedent(
            """
            ## Legacy UI exception

            [^attest]:
                Reason: severity one repair for a broken rollback path
                Canonical replacement impact: canonical shell remains fully unaffected
                Rollback: revert the emergency repair commit cleanly
            """
        ),
        textwrap.dedent(
            """
            ## Legacy UI exception

            [review the attestation][^long-hyphenated-attestation-reference]

            [^long-hyphenated-attestation-reference]:
                Reason: severity one repair for a broken rollback path
                Canonical replacement impact: canonical shell remains fully unaffected
                Rollback: revert the emergency repair commit cleanly
            """
        ),
        _VALID_BODY + "\n\nReview details[^x]\n\n[^x]: https://example.com\n",
        _VALID_BODY + "\n\n[^x]: one\n",
    ],
    ids=(
        "unreferenced-footnote-field-container",
        "referenced-footnote-field-container",
        "standard-reference-footnote",
        "consumed-unreferenced-footnote-definition",
    ),
)
def test_github_footnote_container_cannot_supply_exception_fields(body):
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert any("renderer-specific markup" in f for f in result.missing_fields)


@pytest.mark.parametrize(
    "body",
    [
        textwrap.dedent(
            r"""
            ## Legacy UI exception

            $$
            Reason: severity one repair for a broken rollback path
            Canonical replacement impact: canonical shell remains fully unaffected
            Rollback: revert the emergency repair commit cleanly
            $$
            """
        ),
        textwrap.dedent(
            r"""
            ## Legacy UI exception

            Reason: $\phantom{severity one repair for a broken rollback path}$
            Canonical replacement impact: $\phantom{canonical shell remains fully unaffected}$
            Rollback: $\phantom{revert the emergency repair commit cleanly}$
            """
        ),
        textwrap.dedent(
            r"""
            ## Legacy UI exception

            Reason: $`\phantom{severity one repair for a broken rollback path}`$
            Canonical replacement impact: $`\phantom{canonical shell remains fully unaffected}`$
            Rollback: $`\phantom{revert the emergency repair commit cleanly}`$
            """
        ),
        _VALID_BODY + "\n\n<!-- $$ -->\n",
    ],
    ids=(
        "display-math",
        "inline-math",
        "backtick-delimited-inline-math",
        "math-delimiter-inside-comment",
    ),
)
def test_github_math_container_cannot_hide_exception_fields(body):
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert any("renderer-specific markup" in f for f in result.missing_fields)


@pytest.mark.parametrize(
    "value_template",
    [":{alias}:", ":{alias}:x", "_:{alias}:_"],
    ids=("bare", "adjacent-letter", "markdown-underscore-delimiter"),
)
def test_github_emoji_aliases_are_not_substantive_field_values(value_template):
    reason = value_template.format(alias="heavy_check_mark")
    impact = value_template.format(alias="white_check_mark")
    rollback = value_template.format(alias="leftwards_arrow_with_hook")
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {reason}
        Canonical replacement impact: {impact}
        Rollback: {rollback}
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


@pytest.mark.parametrize("filler", ["\u115f", "\u1160", "\u3164", "\uffa0"])
def test_invisible_unicode_fillers_are_not_substantive_field_values(filler):
    invisible_value = (filler * 4 + " ") * 3
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {invisible_value}
        Canonical replacement impact: {invisible_value}
        Rollback: {invisible_value}
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


@pytest.mark.parametrize("overlay", ["\u0335", "\u0336", "\u0337", "\u0338"])
def test_unicode_combining_overlays_cannot_visually_strike_field_values(overlay):
    def crossed_out(value):
        return "".join(char + overlay if char.isalnum() else char for char in value)

    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {crossed_out("severity one repair for a broken rollback path")}
        Canonical replacement impact: {crossed_out("canonical shell remains fully unaffected")}
        Rollback: {crossed_out("revert the emergency repair commit cleanly")}
        """
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


@pytest.mark.parametrize("separator", ["\u2028", "\u2029", "\u0085", "\v", "\f"])
def test_non_commonmark_separator_cannot_manufacture_field_lines_before_work_claim(
    separator,
):
    body = (
        "## Legacy UI exception\n\n"
        "Reason: severity one repair for a broken rollback path"
        f"{separator}Canonical replacement impact: canonical shell remains fully unaffected"
        f"{separator}Rollback: revert the emergency repair commit cleanly"
        f"{separator}[WORK-CLAIM]\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert {
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }.issubset(result.missing_fields)


@pytest.mark.parametrize("line_feed_entity", ["&#10;", "&#xA;", "&NewLine;"])
def test_character_reference_line_feed_cannot_manufacture_field_or_work_claim_lines(
    line_feed_entity,
):
    body = (
        "## Legacy UI exception\n\n"
        "Reason: severity one repair for a broken rollback path"
        f"{line_feed_entity}Canonical replacement impact: canonical shell remains fully unaffected"
        f"{line_feed_entity}Rollback: revert the emergency repair commit cleanly"
        f"{line_feed_entity}[WORK-CLAIM]\n"
        "Reason: contradictory visible followup must not be hidden\n"
    )

    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )

    assert result.allowed is False
    assert {
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }.issubset(result.missing_fields)


def test_unclosed_html_comment_swallows_everything_after_it():
    body = "<!-- pasted context, never closed\n" + _VALID_BODY
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("unsafe or non-comment HTML" in f for f in result.missing_fields)


@pytest.mark.parametrize(
    "placeholder_value",
    [
        "TODO fill later",
        "TBD later",
        "N/A because this is a rollback",
        "placeholder",
        "fill in later",
    ],
)
def test_placeholder_phrase_variants_fail(placeholder_value):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {placeholder_value}
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


@pytest.mark.parametrize("punctuation_value", ["...", "---", "***", "___"])
def test_punctuation_only_values_fail(punctuation_value):
    body = textwrap.dedent(
        f"""
        ## Legacy UI exception

        Reason: {punctuation_value}
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


def test_one_character_exception_values_fail_as_non_substantive():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: x
        Canonical replacement impact: x
        Rollback: x
        """
    )

    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)

    assert result.allowed is False
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


def test_long_single_token_exception_value_fails_as_non_substantive():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: xxxxxxxxxxxxxxxxxxxxxxxxx
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )

    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)

    assert result.allowed is False
    assert any("Reason" in field for field in result.missing_fields)


def test_value_mentioning_placeholder_word_midsentence_is_still_substantive():
    # A real, substantive value must not be rejected just because it CONTAINS
    # a placeholder-vocabulary word away from the start of the value.
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: the TODO comment in home.ts was hiding a null deref
        Canonical replacement impact: none, this only touches the recovery route
        Rollback: revert this commit; the legacy route is otherwise untouched
        """
    )
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )
    assert result.allowed is True


def test_duplicate_field_label_within_one_section_is_ambiguous_and_fails():
    body = textwrap.dedent(
        """
        ## Legacy UI exception

        Reason: a real reason for this exception
        Reason: a second, contradicting reason
        Canonical replacement impact: something real happens here
        Rollback: revert the commit
        """
    )
    # Exercise the parser after the approval gate has been satisfied so this
    # cannot pass merely because the approval precondition failed first.
    result = evaluate(
        _TOUCH,
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=_POLICY,
        exception_approval_valid=True,
    )
    assert result.allowed is False
    assert any("Reason" in f for f in result.missing_fields)


# ---------------------------------------------------------------------------
# Registry / policy validation — fail closed, never silently weaken protection
# ---------------------------------------------------------------------------


def _write_registry(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "REGISTRY.yaml"
    p.write_text(textwrap.dedent(body))
    return p


def test_duplicate_yaml_keys_raise_policy_error(tmp_path):
    p = _write_registry(
        tmp_path,
        """
        mod-a:
          repo: MIRA
          path: a/
          status: CANONICAL
        mod-a:
          repo: MIRA
          path: a2/
          status: CANONICAL
        """,
    )
    with pytest.raises(GuardPolicyError):
        load_guard_policy(p)


def test_scalar_guarded_paths_raises_policy_error(tmp_path):
    p = _write_registry(
        tmp_path,
        """
        legacy-mod:
          repo: MIRA
          path: legacy/
          status: LEGACY
          change_policy: exception_only
          deletion_safe: false
          canonical_replacement: packages/factorylm-ui/
          guarded_paths: legacy/tree/**
        """,
    )
    with pytest.raises(GuardPolicyError):
        load_guard_policy(p)


def test_empty_guarded_paths_list_raises_policy_error(tmp_path):
    p = _write_registry(
        tmp_path,
        """
        legacy-mod:
          repo: MIRA
          path: legacy/
          status: LEGACY
          change_policy: exception_only
          deletion_safe: false
          canonical_replacement: packages/factorylm-ui/
          guarded_paths: []
        """,
    )
    with pytest.raises(GuardPolicyError):
        load_guard_policy(p)


def test_non_string_guarded_path_raises_policy_error(tmp_path):
    p = _write_registry(
        tmp_path,
        """
        legacy-mod:
          repo: MIRA
          path: legacy/
          status: LEGACY
          change_policy: exception_only
          deletion_safe: false
          canonical_replacement: packages/factorylm-ui/
          guarded_paths:
            - 12345
        """,
    )
    with pytest.raises(GuardPolicyError):
        load_guard_policy(p)


@pytest.mark.parametrize(
    "bad_path",
    [
        "/absolute/path/**",
        "legacy\\tree\\**",
        "legacy/../tree/**",
        "legacy/*/tree/**",
        "legacy/**/tree",
        "**",
        "legacy/tree/*",
    ],
)
def test_bad_guarded_path_forms_raise_policy_error(tmp_path, bad_path):
    p = _write_registry(
        tmp_path,
        f"""
        legacy-mod:
          repo: MIRA
          path: legacy/
          status: LEGACY
          change_policy: exception_only
          deletion_safe: false
          canonical_replacement: packages/factorylm-ui/
          guarded_paths:
            - "{bad_path}"
        """,
    )
    with pytest.raises(GuardPolicyError):
        load_guard_policy(p)


def test_valid_terminal_glob_and_exact_paths_load_cleanly(tmp_path):
    p = _write_registry(
        tmp_path,
        """
        legacy-mod:
          repo: MIRA
          path: legacy/
          status: LEGACY
          change_policy: exception_only
          deletion_safe: false
          canonical_replacement: packages/factorylm-ui/
          guarded_paths:
            - legacy/tree/**
            - legacy/exact-file.js
        """,
    )
    policy = load_guard_policy(p)
    assert "legacy/tree/**" in policy.guarded_paths
    assert "legacy/exact-file.js" in policy.guarded_paths
    assert path_is_guarded("legacy/tree/nested/new.ts", policy)
    assert path_is_guarded("legacy/exact-file.js", policy)
    assert not path_is_guarded("legacy/exact-file.js.bak", policy)
    assert not path_is_guarded("legacy2/tree/new.ts", policy)


# ---------------------------------------------------------------------------
# GitHub JSON-lines changed-file input
# ---------------------------------------------------------------------------


def test_load_changed_files_accepts_added_modified_removed_renamed(tmp_path):
    p = tmp_path / "changes.jsonl"
    p.write_text(
        "\n".join(
            [
                '{"filename": "a.ts", "status": "added"}',
                '{"filename": "b.ts", "status": "modified"}',
                '{"filename": "c.ts", "status": "removed"}',
                '{"filename": "d.ts", "status": "renamed", "previous_filename": "old_d.ts"}',
            ]
        )
    )
    changes = load_changed_files(p)
    by_path = {c.path: c for c in changes}
    assert by_path["a.ts"].status == "added"
    assert by_path["b.ts"].status == "modified"
    assert by_path["c.ts"].status == "removed"
    assert by_path["d.ts"].status == "renamed"
    assert by_path["d.ts"].previous_path == "old_d.ts"


@pytest.mark.parametrize(
    "line",
    [
        '{"filename": "a.ts", "status": "copied"}',
        '{"filename": "a.ts", "status": "changed"}',
        '{"filename": "a.ts"}',
        '{"status": "added"}',
        '{"filename": "a.ts", "status": "renamed"}',
        "not json at all",
        "[]",
    ],
)
def test_load_changed_files_rejects_unknown_or_missing_fields(tmp_path, line):
    p = tmp_path / "changes.jsonl"
    p.write_text(line)
    with pytest.raises(GuardPolicyError):
        load_changed_files(p)


# ---------------------------------------------------------------------------
# The real registry supplies the public / Hub / mobile directory patterns
# ---------------------------------------------------------------------------


def test_real_registry_supplies_public_hub_mobile_guarded_patterns():
    policy = load_guard_policy(REAL_REGISTRY)
    expected = {
        "mira-web/src/views/**",
        "mira-web/src/routes/**",
        "mira-web/src/server.ts",
        "compose.yaml",
        "docker-compose.override.yml",
        "nginx-oracle.conf",
        "nginx-oracle-v2.conf",
        "nginx-phase2-live.conf",
        "oracle-bootstrap.sh",
        "oracle-deploy.sh",
        "scripts/apply-apex-login-redirects.sh",
        "mira-web/package.json",
        "mira-web/server.js",
        "mira-web/public/**",
        "mira-hub/src/app/**",
        "mira-hub/next.config.ts",
        "mira-hub/package.json",
        "mira-hub/src/components/**",
        "mira-hub/src/providers/**",
        "mira-hub/src/messages/**",
        "mira-hub/public/**",
        "mira-mobile/index.html",
        "mira-mobile/android/**",
        "mira-mobile/capacitor.config.ts",
        "deployment/well-known/apple-app-site-association",
        "deployment/well-known/assetlinks.json",
        "mira-mobile/ios/**",
        "mira-mobile/package.json",
        "mira-mobile/scripts/native-fingerprint.mjs",
        "mira-mobile/scripts/ota-package.mjs",
        "mira-mobile/scripts/ota-provenance.mjs",
        "tools/migration_drift.py",
        "tools/migration-drift-requirements.txt",
        "mira-mobile/src/**",
        "mira-mobile/vite.config.ts",
    }
    assert expected <= set(policy.guarded_paths)


@pytest.mark.parametrize(
    "path",
    [
        "mira-hub/src/components/AssetChat.tsx",
        "mira-hub/src/components/namespace/NodeChat.tsx",
        "mira-hub/src/components/AssetChatV2.tsx",
        "mira-hub/src/components/chat/NewLegacyPanel.tsx",
        "mira-hub/src/components/equipment/notebook-chat-utils.ts",
        "mira-hub/src/components/layout/sign-out-action.ts",
        "mira-hub/src/components/nested/arbitrary-name.ts",
        "mira-hub/src/app/layout.tsx",
        "mira-hub/src/app/globals.css",
        "mira-hub/src/app/login/page.tsx",
        "mira-hub/src/app/dashboard-copy/page.tsx",
        "mira-hub/src/providers/theme-provider.tsx",
        "mira-hub/src/providers/access-control.ts",
        "mira-hub/src/providers/auth-provider.ts",
        "mira-hub/src/providers/data-provider.ts",
        "mira-hub/src/providers/arbitrary-name.ts",
        "mira-hub/src/messages/en.json",
        "mira-hub/public/new-shell.js",
        "mira-hub/src/lib/command-center-view.ts",
        "mira-hub/src/lib/plc-import-view.ts",
        "mira-hub/src/lib/knowledge-graph/graph-view.ts",
        "mira-hub/src/lib/parts-data.ts",
        "mira-hub/src/lib/documents-data.ts",
        "mira-hub/src/lib/workorders-data.ts",
        "mira-hub/src/lib/anomaly-titles.ts",
        "mira-hub/src/lib/notebook-asset-card.ts",
        "mira-hub/src/lib/notebook-delete.ts",
        "mira-hub/src/lib/doc-chat-link.ts",
        "mira-hub/src/lib/onboarding-flow.ts",
        "mira-hub/src/lib/knowledge-graph/canonical-relationship-type.ts",
        "mira-hub/src/lib/commissioning.ts",
        "mira-hub/src/lib/capabilities.ts",
        "mira-hub/src/lib/hub/status.ts",
        "mira-hub/src/lib/visual/reducer.ts",
        "mira-hub/src/lib/visual/viewport.ts",
        "mira-hub/src/lib/connections.ts",
        "mira-hub/src/lib/utils.ts",
        "mira-hub/src/lib/gs10-display.ts",
        "mira-hub/src/lib/health-score.ts",
        "mira-hub/src/lib/document-readiness.ts",
        "mira-hub/src/lib/notebook-followups.ts",
        "mira-hub/src/lib/arbitrary-name.ts",
        "mira-hub/src/middleware.ts",
        "mira-hub/src/auth.ts",
        "mira-hub/src/app/api/me/route.ts",
        "mira-hub/src/app/api/mobile/live-update/manifest/route.ts",
        "mira-hub/src/capabilities/NewLegacyPanel.tsx",
        "mira-hub/src/capabilities/nested/legacy-dashboard.html",
        "mira-hub/src/capabilities/nested/legacy-dashboard.js",
        "mira-hub/src/capabilities/nested/legacy-dashboard.svg",
        "mira-hub/src/capabilities/nested/LegacyDashboard.vue",
        "mira-hub/src/widgets/nested/legacy-navigation.ts",
        "mira-hub/src/widgets/nested/legacy-dashboard.html",
        "mira-hub/src/widgets/nested/legacy-dashboard.js",
        "mira-hub/src/widgets/nested/legacy-dashboard.svg",
        "mira-hub/src/lib/nested/NewLegacyPanel.tsx",
        "mira-hub/src/lib/nested/new-dashboard.css",
        "mira-web/src/lib/feature-renderer.ts",
        "mira-web/src/lib/mailer.ts",
        "mira-web/src/lib/blog-renderer.ts",
        "mira-web/src/lib/drive-commander-renderer.ts",
        "mira-web/src/lib/drive-pack-data.ts",
        "mira-web/src/lib/new-dashboard-renderer.ts",
        "mira-web/src/lib/new-dashboard-data.ts",
        "mira-web/src/lib/nested/NewLegacyPanel.tsx",
        "mira-web/src/lib/nested/new-dashboard.css",
        "mira-web/src/lib/blog-db.ts",
        "mira-web/src/lib/hub-handoff.ts",
        "mira-web/src/lib/qr-pdf.ts",
        "mira-web/src/lib/sitemap.ts",
        "mira-web/src/lib/trailing-slash.ts",
        "mira-web/src/lib/arbitrary-name.ts",
        "mira-web/src/capabilities/NewLegacyPanel.tsx",
        "mira-web/src/capabilities/nested/legacy-dashboard.html",
        "mira-web/src/capabilities/nested/legacy-dashboard.js",
        "mira-web/src/capabilities/nested/legacy-dashboard.svg",
        "mira-web/src/capabilities/nested/LegacyDashboard.vue",
        "mira-web/src/seed/NewLegacyPanel.tsx",
        "mira-web/src/seed/legacy-dashboard.html",
        "mira-web/src/seed/legacy-dashboard.js",
        "mira-web/src/seed/legacy-dashboard.svg",
        "mira-web/src/routes/printsense.ts",
        "mira-web/src/routes/new-old-site.ts",
        "mira-web/src/routes/m.ts",
        "mira-web/src/server.ts",
        "mira-mobile/index.html",
        "mira-mobile/src/main.tsx",
        "mira-mobile/src/LegacyAppV2.tsx",
        "mira-mobile/src/app.css",
        "mira-mobile/src/api/NewLegacyPanel.tsx",
        "mira-mobile/src/api/legacy-dashboard.html",
        "mira-mobile/src/api/legacy-dashboard.js",
        "mira-mobile/src/api/legacy-dashboard.svg",
        "mira-mobile/src/api/LegacyDashboard.vue",
        "mira-mobile/src/lib/api-error-copy.ts",
        "mira-mobile/src/lib/chat-transport-presentation.ts",
        "mira-mobile/src/lib/resource-copy.ts",
        "mira-mobile/src/lib/sse.ts",
        "mira-mobile/src/lib/live-update.ts",
        "mira-mobile/src/chat-adapter/runtime.tsx",
        "mira-mobile/src/chat-adapter/turns-to-parts.ts",
        "mira-mobile/src/chat-adapter/NewLegacyPanel.tsx",
        "mira-mobile/src/lib/NewLegacyPanel.tsx",
        "mira-mobile/src/lib/attach-selection.ts",
        "mira-mobile/src/lib/chat-copy.ts",
        "mira-mobile/src/lib/chat-ui-pref.ts",
        "mira-mobile/src/lib/citation-marks.ts",
        "mira-mobile/src/lib/composer.ts",
        "mira-mobile/src/lib/nameplate-flow.ts",
        "mira-mobile/src/lib/notebook-asset-card.ts",
        "mira-mobile/src/lib/notebook-delete.ts",
        "mira-mobile/src/lib/remark-citation-marks.ts",
        "mira-mobile/src/lib/replay.ts",
        "mira-mobile/src/lib/scan-landing.ts",
        "mira-mobile/src/lib/sensor-read.ts",
        "mira-mobile/src/lib/sensor.ts",
        "mira-mobile/src/lib/transient-layer.ts",
        "mira-mobile/src/lib/new-transport-helper.ts",
        "mira-mobile/src/widgets/NewLegacyPanel.tsx",
        "mira-mobile/src/widgets/legacy-navigation.ts",
        "mira-mobile/src/widgets/legacy-dashboard.html",
        "mira-mobile/src/widgets/legacy-dashboard.js",
        "mira-mobile/src/widgets/legacy-dashboard.svg",
        "mira-mobile/src/styles/new-shell.css",
    ],
)
def test_real_and_sibling_legacy_presentation_surfaces_fail_closed(path):
    policy = load_guard_policy(REAL_REGISTRY)

    assert path_is_guarded(path, policy), f"expected {path} to be guarded"
    result = evaluate(
        [ChangedFile(status="added", path=path)], labels=set(), pr_body="", policy=policy
    )
    assert result.allowed is False


@pytest.mark.parametrize(
    "path",
    [
        "mira-web/Dockerfile",
        "mira-web/bun.lock",
        "mira-web/docker-compose.yml",
        "mira-web/package-lock.json",
        "mira-web/package.json",
        "mira-web/server.js",
        "mira-web/tsconfig.json",
        "mira-web/alternate-entry.ts",
        "mira-web/emails/feature.html",
        "mira-web/app/page.tsx",
        "mira-hub/Dockerfile",
        "mira-hub/bun.lock",
        "mira-hub/next.config.ts",
        "mira-hub/package-lock.json",
        "mira-hub/package.json",
        "mira-hub/postcss.config.mjs",
        "mira-hub/tsconfig.json",
        "mira-hub/alternate-entry.tsx",
        "mira-hub/app/page.tsx",
        "mira-hub/pages/index.tsx",
        "mira-mobile/bun.lock",
        "mira-mobile/capacitor.config.ts",
        "mira-mobile/package-lock.json",
        "mira-mobile/package.json",
        "mira-mobile/tsconfig.json",
        "mira-mobile/vite.config.ts",
        "mira-mobile/alternate-entry.ts",
        "mira-mobile/public/alternate-index.js",
        "mira-mobile/scripts/ota-deploy.mjs",
        "mira-mobile/scripts/ota-guard.mjs",
        "mira-mobile/scripts/native-fingerprint.mjs",
        "mira-mobile/scripts/ota-publish.mjs",
        "mira-mobile/scripts/ota-rollback.mjs",
        "mira-mobile/src/api/resources.ts",
        "mira-mobile/android/app/src/main/AndroidManifest.xml",
        "mira-mobile/android/app/src/main/java/com/factorylm/mira/MainActivity.java",
        "mira-mobile/android/app/src/main/res/layout/activity_main.xml",
        "mira-mobile/android/app/src/main/assets/help/README.md",
        "mira-mobile/android/build.gradle",
        "mira-mobile/ios/App/App/AppDelegate.swift",
        "mira-mobile/ios/App/App/Info.plist",
        "mira-mobile/ios/App/App/README.md",
        "mira-mobile/ios/App/App/IDEWorkspaceChecks.plist",
        "deployment/well-known/apple-app-site-association",
        "deployment/well-known/assetlinks.json",
        "docker-compose.hub.yml",
        "docker-compose.saas.yml",
        "docker-compose.staging-vps.yml",
        "compose.yaml",
        "compose.yml",
        "compose.override.yaml",
        "compose.override.yml",
        "compose.production.yml",
        "compose.canary.yaml",
        "composecustomer.yml",
        "docker-compose.yaml",
        "docker-compose.yml",
        "docker-compose.override.yaml",
        "docker-compose.override.yml",
        "docker-compose.production.yml",
        "docker-compose.canary.yaml",
        "docker-composecustomer.yaml",
        "deployment/nginx-app-factorylm.conf",
        "deployment/nginx-factorylm-marketing.conf",
        "deployment/nginx-stg-factorylm.conf",
        "deployment/nginx-updates-factorylm.conf",
        "deployment/nginx-new-ui.conf",
        "deployment/ota-download/index.html",
        "deployment/new-ui/index.html",
        "deployment/new-ui/index.mjs",
        "deployment/new-ui/bootstrap.cjs",
        "deployment/new-ui/App.vue",
        "deployment/new-ui/manifest.json",
        "deployment/new-ui/site.webmanifest",
        "deployment/new-ui/assets/logo.png",
        "deployment/new-ui/Dockerfile",
        "deployment/new-ui/deploy.sh",
        "nginx-new-ui.conf",
        "app-nginx.conf",
        "factorylm.conf",
        "site.conf",
        "nginx-oracle.conf",
        "nginx-oracle-v2.conf",
        "nginx-phase2-live.conf",
        "oracle-deploy.sh",
        "scripts/apply-apex-login-redirects.sh",
        "scripts/apply-new-ui-redirects.sh",
        "scripts/redirect-new-ui.sh",
        "scripts/switch-ui-mount.sh",
        "future-ui-deploy.sh",
        "future-ui-mount.sh",
        "scripts/host_perm_setup.sh",
        "scripts/install_crons.sh",
        "tools/predeploy_log_capture.sh",
        "tools/agent-dashboard.html",
        "docs/preview/pricing.html",
        "agent-dashboard.html",
        "preview/index.html",
        "preview/pricing.html",
        "well-known/assetlinks.json",
        "well-known/apple-app-site-association",
        "mira-mobile/store/play/screenshots/new.png",
        ".github/scripts/resolve_release_tag.sh",
        ".claude/settings.json",
        ".claude/settings.local.json",
        "tools/hooks/prod-guard.sh",
        "tools/migration_drift.py",
        "tools/migration-drift-requirements.txt",
    ],
)
def test_legacy_surface_build_mount_and_alternate_entry_controls_fail_closed(path):
    policy = load_guard_policy(REAL_REGISTRY)

    assert path_is_guarded(path, policy), f"expected build/mount control {path} to be guarded"
    result = evaluate(
        [ChangedFile(status="modified", path=path)], labels=set(), pr_body="", policy=policy
    )
    assert result.allowed is False


@pytest.mark.parametrize(
    "path",
    [
        "mira-web/CHANGELOG.md",
        "mira-hub/README.md",
        "mira-hub/eslint.config.mjs",
        "mira-hub/playwright.config.ts",
        "mira-hub/vitest.config.ts",
        "mira-hub/docs/new-ui-review.md",
        "mira-hub/tests/e2e/new-ui.spec.ts",
        "mira-hub/tools/capture-new-ui.ts",
        "mira-mobile/README.md",
        "mira-mobile/qa-e-live-citation.png",
        "mira-mobile/android/.gitignore",
        "mira-mobile/android/app/.gitignore",
        "mira-mobile/android/app/src/test/java/com/factorylm/mira/ExampleUnitTest.java",
        "mira-mobile/android/app/src/androidTest/java/com/factorylm/mira/ExampleInstrumentedTest.java",
        "mira-mobile/android/app/src/testFixtures/java/com/factorylm/mira/TestFixture.java",
        "mira-mobile/android/app/src/testDebug/java/com/factorylm/mira/DebugUnitTest.java",
        "mira-mobile/android/app/src/androidTestRelease/java/com/factorylm/mira/ReleaseDeviceTest.java",
        "mira-mobile/ios/App/CapApp-SPM/.gitignore",
        "mira-mobile/ios/App/CapApp-SPM/README.md",
        "mira-mobile/ios/App/AppTests/AppTests.swift",
        "mira-mobile/ios/App/AppUITests/AppUITests.swift",
        "mira-mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist",
        "mira-mobile/ios/.gitignore",
        "mira-web/scripts/verify-deployment.ts",
        "mira-hub/db/migrations/086_notebook_turn_owner.sql",
        "mira-hub/scripts/cmms-sync-worker.ts",
        "mira-mobile/scripts/__tests__/ota-manifest-checksum.test.mjs",
        "mira-mobile/tools/gen-android-assets.mjs",
        "deployment/deploy.sh",
        "deployment/well-known/README.md",
    ],
)
def test_module_root_docs_test_configs_and_review_evidence_remain_unguarded(path):
    policy = load_guard_policy(REAL_REGISTRY)

    assert not path_is_guarded(path, policy), f"expected non-runtime artifact {path} to stay open"


@pytest.mark.parametrize(
    "path",
    [
        "mira-web/src/views/__tests__/runtime-imported.test.ts",
        "mira-web/src/routes/runtime-imported.spec.ts",
        "mira-hub/src/components/__tests__/RuntimeImported.test.tsx",
        "mira-hub/src/app/runtime-imported.spec.tsx",
        "mira-hub/src/lib/runtime-imported.test.ts",
        "mira-mobile/src/screens/__tests__/RuntimeImported.test.tsx",
        "mira-mobile/src/lib/runtime-imported.spec.ts",
        "mira-mobile/src/runtime-imported.test.ts",
    ],
)
def test_test_shaped_names_inside_legacy_source_cannot_escape_classification(path):
    """Bundlers resolve imports by path, not by whether the name says test."""
    policy = load_guard_policy(REAL_REGISTRY)

    assert path_is_guarded(path, policy), f"runtime-capable source path {path} must be guarded"
    result = evaluate(
        [ChangedFile(status="modified", path=path)], labels=set(), pr_body="", policy=policy
    )
    assert result.allowed is False


@pytest.mark.parametrize(
    "path",
    [
        "mira-web/tests/runtime-imported.test.ts",
        "mira-hub/tests/runtime-imported.spec.ts",
        "mira-mobile/tests/__tests__/runtime-imported.test.ts",
        "mira-mobile/android/app/src/test/java/com/factorylm/mira/RuntimeImportedTest.java",
        "mira-mobile/ios/App/AppTests/RuntimeImportedTests.swift",
    ],
)
def test_only_explicit_out_of_source_or_native_test_roots_are_exempt(path):
    policy = load_guard_policy(REAL_REGISTRY)

    assert not path_is_guarded(path, policy), f"explicit non-production test root {path} stays open"


@pytest.mark.parametrize(
    "path",
    [
        "mira-mobile/android/.gitignore",
        "mira-mobile/android/app/.gitignore",
        "mira-mobile/ios/App/CapApp-SPM/.gitignore",
        "mira-mobile/ios/App/CapApp-SPM/README.md",
        "mira-mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist",
        "mira-mobile/ios/.gitignore",
    ],
)
def test_exact_native_nonruntime_exceptions_are_tracked_files(path):
    assert (REPO_ROOT / path).is_file(), f"remove stale exact exception for {path}"


@pytest.mark.parametrize(
    "path",
    [
        "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts",
        "mira-hub/src/app/(hub)/api/auth/magic-link/route.ts",
        "mira-hub/src/lib/notebook-chat-types.ts",
        "mira-hub/src/lib/data-schema.ts",
        "mira-hub/src/lib/display-registration.ts",
        "mira-hub/src/lib/drive-pack-suggestion.ts",
        "mira-hub/src/lib/drive-packs/loader.ts",
        "mira-hub/src/lib/review-queue.ts",
        "mira-hub/src/lib/tenant-context.ts",
        "mira-hub/src/capabilities/new-service.ts",
        "mira-hub/src/capabilities/schema.json",
        "mira-web/src/routes/inbox.ts",
        "mira-web/src/routes/mfa.ts",
        "mira-web/src/routes/probe-state.ts",
        "mira-web/src/lib/account-deletion.ts",
        "mira-web/src/lib/activation.ts",
        "mira-web/src/lib/atlas.ts",
        "mira-web/src/lib/audit.ts",
        "mira-web/src/lib/auth.ts",
        "mira-web/src/lib/connect.ts",
        "mira-web/src/lib/cookie-session.ts",
        "mira-web/src/lib/crypto.ts",
        "mira-web/src/lib/csv-import.ts",
        "mira-web/src/lib/dc-pro-activation.ts",
        "mira-web/src/lib/drip.ts",
        "mira-web/src/lib/hub-provisioning-queue.ts",
        "mira-web/src/lib/hub-user-activation.ts",
        "mira-web/src/lib/magic-link.ts",
        "mira-web/src/lib/mfa.ts",
        "mira-web/src/lib/posthog-server.ts",
        "mira-web/src/lib/qr-tracker.ts",
        "mira-web/src/lib/quota.ts",
        "mira-web/src/lib/stripe.ts",
        "mira-web/src/lib/mira-chat.ts",
        "mira-web/src/lib/qr-generate.ts",
        "mira-web/src/capabilities/new-service.ts",
        "mira-web/src/capabilities/schema.json",
        "mira-mobile/src/api/client.ts",
        "mira-mobile/src/api/schema.json",
        "mira-mobile/src/chat-adapter/contract.ts",
        "mira-mobile/src/lib/native-pick.ts",
        "mira-mobile/src/lib/offline-queue.ts",
        "mira-mobile/src/lib/open-with.ts",
        "mira-mobile/src/lib/resume-guard.ts",
        "mira-mobile/src/lib/tags.ts",
        "mira-mobile/src/unified/to-interaction.ts",
        "mira-mobile/src/unified/unified.css",
        "mira-mobile/src/unified/NewCanonicalPanel.tsx",
        "mira-mobile/src/screens/UnifiedChat.tsx",
        "mira-mobile/src/screens/UnifiedRoot.tsx",
        "mira-mobile/src/factorylm-ui/NewAdapter.tsx",
    ],
)
def test_preserved_capability_and_canonical_adapter_paths_remain_unguarded(path):
    policy = load_guard_policy(REAL_REGISTRY)

    assert not path_is_guarded(path, policy), f"expected {path} to remain a capability seam"


@pytest.mark.parametrize(
    ("relative_root", "presentation_suffixes"),
    [
        ("mira-web/src/lib", ("-renderer.ts", "-view.ts", "-data.ts")),
        ("mira-hub/src/lib", ("-view.ts", "-data.ts", "-titles.ts", "-card.ts")),
    ],
)
def test_every_existing_presentation_shaped_lib_file_is_guarded_non_vacuously(
    relative_root, presentation_suffixes
):
    policy = load_guard_policy(REAL_REGISTRY)
    root = REPO_ROOT / relative_root
    candidates = sorted(
        path.relative_to(REPO_ROOT).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name.lower().endswith(presentation_suffixes)
    )

    assert candidates, f"expected presentation-shaped fixtures below {relative_root}"
    assert all(path_is_guarded(path, policy) for path in candidates), candidates


def test_audited_capability_allowlists_only_name_real_unguarded_files():
    policy = load_guard_policy(REAL_REGISTRY)

    for paths in (WEB_PRESERVED_LIB_PATHS, HUB_PRESERVED_LIB_PATHS):
        assert paths
        for relative_path in paths:
            assert (REPO_ROOT / relative_path).is_file(), relative_path
            assert not path_is_guarded(relative_path, policy), relative_path


def test_existing_production_lib_files_are_fully_partitioned():
    policy = load_guard_policy(REAL_REGISTRY)

    for relative_root, preserved_paths in (
        ("mira-web/src/lib", WEB_PRESERVED_LIB_PATHS),
        ("mira-hub/src/lib", HUB_PRESERVED_LIB_PATHS),
    ):
        production_files = sorted(
            path.relative_to(REPO_ROOT).as_posix()
            for path in (REPO_ROOT / relative_root).rglob("*")
            if path.is_file()
        )

        assert production_files, f"expected production files below {relative_root}"
        assert all(
            path in preserved_paths or path_is_guarded(path, policy) for path in production_files
        ), production_files


# ---------------------------------------------------------------------------
# Public-static sibling bypass fix — every file under a legacy public tree is
# presentation material. Executable files, manifests, documents, images,
# icons, and fonts all affect the shipped old experience and are guarded.
# ---------------------------------------------------------------------------


def test_public_static_guarded_root_is_exposed_as_a_constant():
    assert "mira-web/public/" in PUBLIC_STATIC_GUARDED_ROOTS
    assert "mira-hub/public/" in PUBLIC_STATIC_GUARDED_ROOTS


@pytest.mark.parametrize(
    "path",
    [
        "mira-web/public/index.html",
        "mira-web/public/legacy.htm",
        "mira-web/public/app.css",
        "mira-web/public/bundle.js",
        "mira-web/public/module.mjs",
        "mira-web/public/icon.svg",
        "mira-web/public/assets/nested/deep/widget.js",
        "mira-web/public/FOO.JS",
        "mira-web/public/data.unknownext",
        "mira-web/public/no_extension_at_all",
        "mira-web/public/logo.png",
        "mira-web/public/manual.pdf",
        "mira-web/public/manifest.json",
        "mira-web/public/font.woff2",
        "mira-hub/public/new-shell.css",
    ],
)
def test_public_static_presentation_capable_additions_are_guarded(path):
    real_policy = load_guard_policy(REAL_REGISTRY)
    assert path_is_guarded(path, real_policy), f"expected {path} to be guarded"
    result = evaluate(
        [ChangedFile(status="added", path=path)], labels=set(), pr_body="", policy=real_policy
    )
    assert result.allowed is False


def test_public_static_active_deletion_is_guarded():
    real_policy = load_guard_policy(REAL_REGISTRY)
    result = evaluate(
        [ChangedFile(status="removed", path="mira-web/public/app.js")],
        labels=set(),
        pr_body="",
        policy=real_policy,
    )
    assert result.allowed is False


def test_public_static_both_rename_directions_are_guarded():
    real_policy = load_guard_policy(REAL_REGISTRY)
    rename_in = evaluate(
        [
            ChangedFile(
                status="renamed",
                path="mira-web/public/renamed-in.js",
                previous_path="scripts/build-only.js",
            )
        ],
        labels=set(),
        pr_body="",
        policy=real_policy,
    )
    assert rename_in.allowed is False

    rename_out = evaluate(
        [
            ChangedFile(
                status="renamed",
                path="scripts/build-only.js",
                previous_path="mira-web/public/renamed-out.js",
            )
        ],
        labels=set(),
        pr_body="",
        policy=real_policy,
    )
    assert rename_out.allowed is False


@pytest.mark.parametrize(
    "path",
    ["mira-web/public/sw.js", "mira-web/public/posthog-init.js"],
)
def test_public_static_executable_infrastructure_files_are_guarded(path):
    """Codex remediation finding #1: sw.js/posthog-init.js are executable
    JavaScript served to every visitor — they are a presentation surface like
    any other .js file under mira-web/public/, not inert infrastructure. The
    prior exact-path exemption left a live self-service bypass: dropping new
    logic into either file skipped the guard entirely. No exemption exists
    for these paths (or any other executable suffix) anymore."""
    real_policy = load_guard_policy(REAL_REGISTRY)
    assert path_is_guarded(path, real_policy), f"expected {path} to be guarded (executable JS)"
    result = evaluate(
        [ChangedFile(status="modified", path=path)], labels=set(), pr_body="", policy=real_policy
    )
    assert result.allowed is False


def test_public_static_unknown_suffix_fails_closed():
    real_policy = load_guard_policy(REAL_REGISTRY)
    assert path_is_guarded("mira-web/public/thing.zzz", real_policy)
    assert path_is_guarded("mira-web/public/thing", real_policy)


# ---------------------------------------------------------------------------
# GitHub pull-files truncation fix — the files endpoint silently caps out
# around 3000 entries; the guard must be told the PR's own authoritative
# `changed_files` count and refuse to evaluate an unverifiable diff.
# ---------------------------------------------------------------------------


def test_max_expected_change_count_constant_is_3000():
    assert MAX_EXPECTED_CHANGE_COUNT == 3000


def _write_changes_jsonl(tmp_path: Path, records: list[str]) -> Path:
    p = tmp_path / "changes.jsonl"
    p.write_text("\n".join(records))
    return p


def _write_git_tree(
    tmp_path: Path,
    name: str,
    entries: list[dict[str, str]],
    *,
    truncated: bool = False,
) -> Path:
    path = tmp_path / f"{name}-tree.json"
    path.write_text(
        json.dumps(
            {
                "sha": ("a" if name == "base" else "b") * 40,
                "truncated": truncated,
                "tree": entries,
            }
        )
    )
    return path


def test_load_changed_files_with_matching_expected_count_passes(tmp_path):
    p = _write_changes_jsonl(
        tmp_path,
        [
            '{"filename": "a.ts", "status": "added"}',
            '{"filename": "b.ts", "status": "modified"}',
        ],
    )
    changes = load_changed_files(p, expected_count=2)
    assert len(changes) == 2


def test_load_changed_files_attaches_immutable_github_tree_evidence(tmp_path):
    changes_path = _write_changes_jsonl(
        tmp_path,
        ['{"filename": "mira-web/src/capabilities/view-data.ts", "status": "added"}'],
    )
    base_tree = _write_git_tree(tmp_path, "base", [])
    head_tree = _write_git_tree(
        tmp_path,
        "head",
        [
            {
                "path": "mira-web/src/capabilities/view-data.ts",
                "mode": "120000",
                "type": "blob",
                "sha": "c" * 40,
            }
        ],
    )

    changes = load_changed_files(
        changes_path,
        expected_count=1,
        base_tree_json_file=base_tree,
        head_tree_json_file=head_tree,
    )

    assert changes == (
        ChangedFile(
            status="added",
            path="mira-web/src/capabilities/view-data.ts",
            old_mode=None,
            old_type=None,
            new_mode="120000",
            new_type="blob",
            tree_evidence_complete=True,
        ),
    )
    result = evaluate(changes, labels=set(), pr_body="", policy=load_guard_policy(REAL_REGISTRY))
    assert result.allowed is False


def test_load_changed_files_rejects_truncated_github_tree_evidence(tmp_path):
    changes_path = _write_changes_jsonl(
        tmp_path,
        ['{"filename": "mira-web/src/capabilities/data.ts", "status": "added"}'],
    )
    base_tree = _write_git_tree(tmp_path, "base", [], truncated=True)
    head_tree = _write_git_tree(
        tmp_path,
        "head",
        [
            {
                "path": "mira-web/src/capabilities/data.ts",
                "mode": "100644",
                "type": "blob",
                "sha": "c" * 40,
            }
        ],
    )

    with pytest.raises(GuardPolicyError, match="truncated"):
        load_changed_files(
            changes_path,
            expected_count=1,
            base_tree_json_file=base_tree,
            head_tree_json_file=head_tree,
        )


def test_load_changed_files_requires_both_tree_snapshots_or_neither(tmp_path):
    changes_path = _write_changes_jsonl(
        tmp_path,
        ['{"filename": "mira-web/src/capabilities/data.ts", "status": "added"}'],
    )
    base_tree = _write_git_tree(tmp_path, "base", [])

    with pytest.raises(GuardPolicyError, match="base and head tree"):
        load_changed_files(
            changes_path,
            expected_count=1,
            base_tree_json_file=base_tree,
        )


def test_load_changed_files_with_low_expected_count_mismatch_raises(tmp_path):
    p = _write_changes_jsonl(
        tmp_path,
        [
            '{"filename": "a.ts", "status": "added"}',
            '{"filename": "b.ts", "status": "modified"}',
        ],
    )
    with pytest.raises(GuardPolicyError):
        load_changed_files(p, expected_count=1)


def test_load_changed_files_with_high_expected_count_mismatch_raises(tmp_path):
    p = _write_changes_jsonl(
        tmp_path,
        [
            '{"filename": "a.ts", "status": "added"}',
        ],
    )
    with pytest.raises(GuardPolicyError):
        load_changed_files(p, expected_count=2)


def test_load_changed_files_rejects_duplicate_filename_records(tmp_path):
    p = _write_changes_jsonl(
        tmp_path,
        [
            '{"filename": "a.ts", "status": "added"}',
            '{"filename": "a.ts", "status": "modified"}',
        ],
    )
    with pytest.raises(GuardPolicyError):
        load_changed_files(p, expected_count=2)


@pytest.mark.parametrize("bad_count", [-1, 3001, 999999])
def test_validate_expected_change_count_rejects_out_of_range(bad_count):
    with pytest.raises(GuardPolicyError):
        validate_expected_change_count(bad_count)


def test_validate_expected_change_count_accepts_the_boundary():
    validate_expected_change_count(0)
    validate_expected_change_count(3000)


@pytest.mark.parametrize("bad_text", ["not-a-number", "", "1.5", "-1", "3001"])
def test_read_expected_change_count_rejects_malformed_or_out_of_range(tmp_path, bad_text):
    p = tmp_path / "count.txt"
    p.write_text(bad_text)
    with pytest.raises(GuardPolicyError):
        read_expected_change_count(p)


def test_read_expected_change_count_accepts_a_valid_integer(tmp_path):
    p = tmp_path / "count.txt"
    p.write_text("42\n")
    assert read_expected_change_count(p) == 42


def test_cli_requires_expected_change_count_file_with_changes_json_file(tmp_path):
    changes = _write_changes_jsonl(tmp_path, ['{"filename": "a.ts", "status": "added"}'])
    exit_code = main(["--changes-json-file", str(changes)])
    assert exit_code == 2


def test_cli_requires_immutable_base_and_head_trees_with_changes_json_file(tmp_path):
    changes = _write_changes_jsonl(tmp_path, ['{"filename": "a.ts", "status": "added"}'])
    count_file = tmp_path / "count.txt"
    count_file.write_text("1")
    exit_code = main(
        [
            "--changes-json-file",
            str(changes),
            "--expected-change-count-file",
            str(count_file),
        ]
    )
    assert exit_code == 2


def test_cli_accepts_changes_json_file_with_count_and_immutable_trees(tmp_path):
    changes = _write_changes_jsonl(tmp_path, ['{"filename": "a.ts", "status": "added"}'])
    count_file = tmp_path / "count.txt"
    count_file.write_text("1")
    base_tree = _write_git_tree(tmp_path, "base", [])
    head_tree = _write_git_tree(
        tmp_path,
        "head",
        [{"path": "a.ts", "mode": "100644", "type": "blob", "sha": "c" * 40}],
    )
    exit_code = main(
        [
            "--changes-json-file",
            str(changes),
            "--expected-change-count-file",
            str(count_file),
            "--base-tree-json-file",
            str(base_tree),
            "--head-tree-json-file",
            str(head_tree),
        ]
    )
    assert exit_code == 0


# ---------------------------------------------------------------------------
# --labels-file is the ONLY labels input the CLI accepts — no bare --labels.
# ---------------------------------------------------------------------------


def test_cli_has_no_bare_labels_flag():
    parser = _build_arg_parser()
    option_strings = {opt for action in parser._actions for opt in action.option_strings}
    assert "--labels-file" in option_strings
    assert "--labels" not in option_strings


# ---------------------------------------------------------------------------
# .github/pull_request_template.md is a control-plane file — editing it (or
# its own exception-section scaffold) is guarded exactly like the registry,
# the charter, the guard, its tests, the Claude rule, the three workflow
# files, and the trusted GitHub workflow itself.
# ---------------------------------------------------------------------------


def test_pull_request_template_is_a_control_pattern():
    assert ".github/pull_request_template.md" in CONTROL_PATTERNS
    assert "requirements/ui-lifecycle-guard.txt" in CONTROL_PATTERNS


@pytest.mark.parametrize("control_path", CONTROL_PATTERNS)
def test_every_control_pattern_is_guarded_without_exception(control_path):
    real_policy = load_guard_policy(REAL_REGISTRY)
    assert path_is_guarded(control_path, real_policy)
    result = evaluate(
        [ChangedFile(status="modified", path=control_path)],
        labels=set(),
        pr_body="",
        policy=real_policy,
    )
    assert result.allowed is False


# ---------------------------------------------------------------------------
# Trusted-base workflow structure — protects `.github/workflows/
# ui-lifecycle-guard.yml` from accidental drift away from the security
# properties the charter (§3.1) requires. The committed workflow is the
# runtime authority; these are guard rails, not a reimplementation of it.
#
# Codex remediation findings #3-#4 (2026-09-06) hardened this from a single
# `guard:` job with substring-only assertions to three jobs (`pending` ->
# `guard` -> `final-status`) with STRUCTURAL (parsed-YAML) assertions:
#   - trigger restricted to `branches: [main]` PLUS an explicit in-job
#     runtime assertion of `base.ref == 'main'` (defense in depth — the
#     trigger filter alone is a coarse net);
#   - every checkout step, across every job, uses the EXACT expression
#     `${{ github.event.pull_request.base.sha }}` as `ref`, never overrides
#     `repository`, and sets `persist-credentials: false` as a real boolean;
#   - permissions are scoped PER JOB, not once at the workflow level — the
#     `guard` job (which runs checked-out/base code) carries no
#     `statuses: write`; only `pending` and `final-status` do;
#   - `guard` fetches PR metadata (token-bearing) BEFORE checking out any
#     code or installing any dependency;
#   - `final-status` runs on a fresh runner (a separate job), `needs` both
#     `pending` and `guard`, is `if: always()`, and explicitly branches on
#     `needs.guard.result` rather than trusting an in-job `job.status` that a
#     multi-job split would otherwise no longer have visibility into.
# ---------------------------------------------------------------------------

WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ui-lifecycle-guard.yml"


def _workflow_text() -> str:
    assert WORKFLOW_PATH.exists(), f"expected {WORKFLOW_PATH} to exist (Task 3)"
    return WORKFLOW_PATH.read_text(encoding="utf-8")


def _workflow_doc() -> dict:
    return yaml.safe_load(_workflow_text())


def test_workflow_uses_pull_request_target():
    doc = _workflow_doc()
    assert "pull_request_target" in doc.get(True, doc.get("on", {}))


def test_workflow_restricts_trigger_to_main_branch():
    doc = _workflow_doc()
    on_block = doc.get(True, doc.get("on", {}))
    assert on_block["pull_request_target"]["branches"] == ["main"]


def test_workflow_lists_every_metadata_sensitive_event():
    doc = _workflow_doc()
    on_block = doc.get(True, doc.get("on", {}))
    types = set(on_block["pull_request_target"]["types"])
    required = {
        "opened",
        "reopened",
        "synchronize",
        "edited",
        "labeled",
        "unlabeled",
        "ready_for_review",
    }
    assert required <= types


def test_workflow_has_three_jobs_wired_pending_then_guard_then_final_status():
    doc = _workflow_doc()
    jobs = doc["jobs"]
    assert set(jobs) == {"pending", "guard", "final-status"}
    assert jobs["guard"].get("needs") in ("pending", ["pending"])
    assert set(
        jobs["final-status"]["needs"]
        if isinstance(jobs["final-status"]["needs"], list)
        else [jobs["final-status"]["needs"]]
    ) == {"pending", "guard"}


def test_workflow_every_checkout_step_uses_exact_base_sha_and_no_repository_override():
    doc = _workflow_doc()
    found_checkout = False
    for job_name, job in doc["jobs"].items():
        for step in job.get("steps", []):
            if step.get("uses", "").startswith("actions/checkout"):
                found_checkout = True
                with_block = step.get("with", {}) or {}
                assert with_block.get("ref") == "${{ github.event.pull_request.base.sha }}", (
                    f"job {job_name}: checkout ref must be the exact base.sha expression"
                )
                assert "repository" not in with_block, (
                    f"job {job_name}: checkout must not override the repository"
                )
                assert with_block.get("persist-credentials") is False, (
                    f"job {job_name}: persist-credentials must be the boolean false"
                )
    assert found_checkout, "expected at least one actions/checkout step across all jobs"


def test_workflow_never_references_head_sha_in_any_checkout():
    doc = _workflow_doc()
    for job in doc["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses", "").startswith("actions/checkout"):
                ref = step.get("with", {}).get("ref", "")
                assert "head" not in ref, f"checkout step must not reference head: {step}"


def test_workflow_asserts_base_ref_is_main_at_runtime():
    doc = _workflow_doc()
    guard_steps = doc["jobs"]["guard"]["steps"]
    assertion_steps = [
        s for s in guard_steps if "base.ref" in s.get("run", "") and "main" in s.get("run", "")
    ]
    assert assertion_steps, "expected an explicit runtime assertion that base.ref == main"
    assert any("exit 1" in s["run"] for s in assertion_steps), (
        "the base.ref assertion must actually fail the job on mismatch"
    )


def test_workflow_guard_job_fetches_metadata_before_checkout_and_dependency_install():
    doc = _workflow_doc()
    steps = doc["jobs"]["guard"]["steps"]
    metadata_idx = next(
        i
        for i, s in enumerate(steps)
        if "gh api" in s.get("run", "") and "pulls" in s.get("run", "")
    )
    checkout_idx = next(
        i for i, s in enumerate(steps) if s.get("uses", "").startswith("actions/checkout")
    )
    install_idx = next(i for i, s in enumerate(steps) if "pip install" in s.get("run", ""))
    assert metadata_idx < checkout_idx, "metadata must be fetched before checking out base code"
    assert metadata_idx < install_idx, "metadata must be fetched before installing dependencies"


def test_workflow_fetches_immutable_tree_evidence_without_changing_pull_files_contract():
    doc = _workflow_doc()
    steps = doc["jobs"]["guard"]["steps"]
    metadata_step = next(
        step
        for step in steps
        if "gh api" in step.get("run", "") and "pulls/$PR_NUMBER" in step.get("run", "")
    )
    metadata_run = metadata_step["run"]

    assert 'gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files?per_page=100"' in metadata_run
    assert "--jq '.[] | {filename, status, previous_filename}'" in metadata_run
    assert "compare/$BASE_SHA...$HEAD_SHA" in metadata_run
    assert "merge_base_commit.sha" in metadata_run
    assert "git/trees/$MERGE_BASE_SHA?recursive=1" in metadata_run
    assert "git/trees/$HEAD_SHA?recursive=1" in metadata_run
    assert "jq -r '.base.sha' \"$RUNNER_TEMP/current-pull.json\"" in metadata_run
    assert "jq -r '.head.sha' \"$RUNNER_TEMP/current-pull.json\"" in metadata_run

    eval_step = next(
        step for step in steps if "tools/ui_surface_lifecycle_guard.py" in step.get("run", "")
    )
    assert '--base-tree-json-file "$RUNNER_TEMP/base-tree.json"' in eval_step["run"]
    assert '--head-tree-json-file "$RUNNER_TEMP/head-tree.json"' in eval_step["run"]


def test_workflow_isolates_dependency_installer_from_repository_python_hooks():
    doc = _workflow_doc()
    steps = doc["jobs"]["guard"]["steps"]
    install_step = next(step for step in steps if "pip install" in step.get("run", ""))

    assert "python3 -I -m pip install" in install_step["run"]


def test_workflow_evaluates_before_tests_and_isolates_python_from_repo_hooks():
    doc = _workflow_doc()
    steps = doc["jobs"]["guard"]["steps"]
    eval_idx = next(
        i
        for i, step in enumerate(steps)
        if "tools/ui_surface_lifecycle_guard.py" in step.get("run", "")
    )
    test_idx = next(i for i, step in enumerate(steps) if "pytest" in step.get("run", ""))
    eval_step = steps[eval_idx]
    test_step = steps[test_idx]

    assert eval_idx < test_idx, "repository tests must not mutate the artifact before evaluation"
    assert "python3 -I tools/ui_surface_lifecycle_guard.py" in eval_step["run"]
    assert "python3 -I -m pytest" in test_step["run"]
    assert "-c /dev/null" in test_step["run"]
    assert "--noconftest" in test_step["run"]
    assert "--import-mode=importlib" in test_step["run"]
    assert test_step.get("env", {}).get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1"


def test_workflow_separates_token_bearing_metadata_step_from_evaluation_step():
    doc = _workflow_doc()
    steps = doc["jobs"]["guard"]["steps"]
    eval_steps = [s for s in steps if "tools/ui_surface_lifecycle_guard.py" in s.get("run", "")]
    assert len(eval_steps) == 1
    eval_step = eval_steps[0]
    assert "GH_TOKEN" not in (eval_step.get("env") or {})

    metadata_steps = [
        s for s in steps if "gh api" in s.get("run", "") and "pulls" in s.get("run", "")
    ]
    assert metadata_steps, "expected a metadata-fetch step calling gh api against pulls"
    for s in metadata_steps:
        assert "GH_TOKEN" in (s.get("env") or {})


def test_workflow_publishes_the_exact_status_context():
    text = _workflow_text()
    assert "Legacy UI Lifecycle Guard" in text
    doc = _workflow_doc()
    assert doc["env"]["STATUS_CONTEXT"] == "Legacy UI Lifecycle Guard"


def test_charter_does_not_claim_github_actions_app_id_identifies_a_workflow():
    charter = (
        REPO_ROOT / "docs" / "architecture" / "convergence" / "UNIFIED_UI_CUTOVER.md"
    ).read_text(encoding="utf-8")
    focused_rule = (REPO_ROOT / ".claude" / "rules" / "factorylm-unified-ui-cutover.md").read_text(
        encoding="utf-8"
    )

    for text in (charter, focused_rule):
        assert "does not identify a workflow file" in text
        assert "separate GitHub App" in text
        assert "required-workflow" in text
        assert "app_id` is what actually prevents" not in text


def test_workflow_and_hot_cache_do_not_claim_advisory_status_becomes_required():
    workflow = _workflow_text()
    hot_cache = (REPO_ROOT / "wiki" / "hot.md").read_text(encoding="utf-8")

    assert "becomes a required check" not in workflow
    assert "becomes a required `main` check" not in hot_cache
    for text in (workflow, hot_cache):
        assert "#3657" in text
        assert "advisory" in text


def test_governance_plan_runnable_guard_contract_matches_hardened_workflow():
    plan = (
        REPO_ROOT
        / "docs"
        / "superpowers"
        / "plans"
        / "2026-09-06-factorylm-unified-ui-cutover-governance.md"
    ).read_text(encoding="utf-8")

    assert ".github/workflows/**" in plan
    assert "--approver-permission-json-file" in plan
    assert "collaborators/$APPROVER_LOGIN/permission" in plan
    assert "`pending` -> `guard` -> `final-status`" in plan


def test_workflow_fetches_expected_change_count_and_passes_it_to_the_guard():
    text = _workflow_text()
    assert ".changed_files" in text
    assert "expected-change-count" in text
    assert "--expected-change-count-file" in text


def test_workflow_binds_exception_to_event_and_current_pull_snapshot():
    text = _workflow_text()

    assert "current-pull.json" in text
    assert '--event-json-file "$GITHUB_EVENT_PATH"' in text
    assert '--current-pull-json-file "$RUNNER_TEMP/current-pull.json"' in text
    assert "collaborators/$APPROVER_LOGIN/permission" in text
    assert '--approver-permission-json-file "$RUNNER_TEMP/approver-permission.json"' in text


def test_workflow_derives_labels_from_the_same_current_pull_snapshot():
    doc = _workflow_doc()
    guard = doc["jobs"]["guard"]
    metadata_step = next(
        step
        for step in guard["steps"]
        if "current-pull.json" in step.get("run", "") and "gh api" in step.get("run", "")
    )
    run = metadata_step["run"]

    assert "jq -r '.labels[].name' \"$RUNNER_TEMP/current-pull.json\"" in run
    assert "/issues/" not in run
    assert guard["permissions"] == {"contents": "read", "pull-requests": "read"}


def test_workflow_actions_are_pinned_to_full_commit_shas():
    doc = _workflow_doc()
    action_uses = [
        step["uses"]
        for job in doc["jobs"].values()
        for step in job.get("steps", [])
        if step.get("uses", "").startswith(("actions/checkout@", "actions/setup-python@"))
    ]

    assert action_uses
    for use in action_uses:
        assert re.fullmatch(r"actions/(?:checkout|setup-python)@[0-9a-f]{40}", use), use


def test_workflow_installs_hash_locked_guard_dependencies():
    text = _workflow_text()
    requirements = REPO_ROOT / "requirements" / "ui-lifecycle-guard.txt"

    assert "pip install" in text
    assert "--require-hashes" in text
    assert "requirements/ui-lifecycle-guard.txt" in text
    assert requirements.exists()
    requirement_text = requirements.read_text()
    approved_packages = {
        "markdown-it-py",
        "mdurl",
        "pyyaml",
        "pytest",
        "iniconfig",
        "packaging",
        "pluggy",
    }
    locked_packages = {
        package.lower() for package in re.findall(r"(?im)^([a-z0-9_-]+)==[^\s]+", requirement_text)
    }
    assert locked_packages == approved_packages
    for package in approved_packages:
        assert re.search(rf"(?im)^{package}==[^\s]+", requirement_text), package
    assert re.search(r"(?im)^pytest==8\.2\.2\s", requirement_text)
    assert not re.search(r"(?im)^pygments==", requirement_text)
    assert requirement_text.count("--hash=sha256:") == len(approved_packages)


def test_pull_request_template_names_full_guard_control_plane():
    text = (REPO_ROOT / ".github" / "pull_request_template.md").read_text()
    assert re.search(r"every GitHub Actions\s+workflow", text)
    assert "requirements/ui-lifecycle-guard.txt" in text


def test_workflow_uses_labels_file_never_bare_labels_flag():
    text = _workflow_text()
    assert "--labels-file" in text
    assert "--labels " not in text and not text.rstrip().endswith("--labels")


def test_workflow_top_level_permissions_are_empty():
    doc = _workflow_doc()
    assert doc["permissions"] == {}, "permissions must be scoped per-job, not at workflow level"


def test_workflow_pending_job_has_only_statuses_write():
    doc = _workflow_doc()
    assert doc["jobs"]["pending"]["permissions"] == {"statuses": "write"}


def test_workflow_guard_job_never_grants_statuses_write():
    doc = _workflow_doc()
    perms = doc["jobs"]["guard"]["permissions"]
    assert "statuses" not in perms, (
        "the job that runs checked-out code must not hold statuses:write"
    )
    assert perms.get("contents") == "read"


def test_workflow_final_status_job_has_statuses_write():
    doc = _workflow_doc()
    assert doc["jobs"]["final-status"]["permissions"] == {"statuses": "write"}


def test_workflow_final_status_job_is_always_and_checks_guard_result():
    doc = _workflow_doc()
    final_job = doc["jobs"]["final-status"]
    assert final_job["if"] == "always()"
    steps_text = " ".join(
        s.get("run", "") + " " + " ".join(str(v) for v in (s.get("env") or {}).values())
        for s in final_job.get("steps", [])
    )
    assert "needs.guard.result" in steps_text


def test_workflow_posts_pending_then_a_final_success_or_failure_status():
    text = _workflow_text()
    assert "state=pending" in text
    assert "if: always()" in text


# ---------------------------------------------------------------------------
# The committed PR template's exception scaffold must itself fail closed —
# blank fields + explanatory HTML comments only, never a prefilled N/A or
# placeholder that could satisfy the parser by accident.
# ---------------------------------------------------------------------------


def test_pr_template_has_exactly_one_blank_exception_section_that_fails_closed():
    template_path = REPO_ROOT / ".github" / "pull_request_template.md"
    assert template_path.exists()
    body = template_path.read_text(encoding="utf-8")
    assert body.count("## Legacy UI exception") == 1

    real_policy = load_guard_policy(REAL_REGISTRY)
    result = evaluate(
        [ChangedFile(status="modified", path="mira-web/src/views/home.ts")],
        labels={"legacy-ui-exception"},
        pr_body=body,
        policy=real_policy,
    )
    assert result.allowed is False, "the blank template scaffold must not itself satisfy the guard"


def test_pr_template_exception_section_passes_once_filled_with_substantive_text():
    template_path = REPO_ROOT / ".github" / "pull_request_template.md"
    body = template_path.read_text(encoding="utf-8")
    filled = body.replace(
        "Reason:\nCanonical replacement impact:\nRollback:",
        "Reason: severity-1 rollback repair\n"
        "Canonical replacement impact: no change to the canonical shell, legacy hotfix only\n"
        "Rollback: revert this commit",
    )
    assert filled != body, "expected the blank scaffold text to be present and replaceable"

    real_policy = load_guard_policy(REAL_REGISTRY)
    result = evaluate(
        [ChangedFile(status="modified", path="mira-web/src/views/home.ts")],
        labels={"legacy-ui-exception"},
        pr_body=filled,
        policy=real_policy,
        exception_approval_valid=True,
    )
    assert result.allowed is True


def test_mobile_release_tests_are_isolated_from_production_signing_workspace():
    """PR-controlled tests must never share a workspace with release secrets."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "mobile-release-distribute.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    jobs = workflow["jobs"]

    verify_job = jobs["verify-mobile"]
    build_job = jobs["build-unsigned-native"]
    sign_job = jobs["sign-native"]
    verify_text = json.dumps(verify_job)
    build_text = json.dumps(build_job)
    sign_text = json.dumps(sign_job)

    assert "environment" not in verify_job
    assert "${{ secrets." not in verify_text
    assert "bun run test" in verify_text
    assert "environment" not in build_job
    assert "${{ secrets." not in build_text
    assert build_job["needs"] == "verify-mobile"
    assert "bun run test" not in build_text
    assert sign_job["environment"] == "production"
    assert sign_job["needs"] == "build-unsigned-native"
    assert "bun run test" not in sign_text
    assert "bun install" not in sign_text
    assert "gradlew" not in sign_text

    checkout = next(
        step for step in build_job["steps"] if step.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    assert checkout["with"]["persist-credentials"] is False
    assert not any(
        step.get("uses", "").startswith("actions/checkout@") for step in sign_job["steps"]
    )


def test_ota_build_is_isolated_from_production_signing_workspace():
    """Build, signing, and publication must use separate secret boundaries."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    jobs = workflow["jobs"]
    build_job = jobs["build-ota"]
    sign_job = jobs["sign-ota"]
    publish_job = jobs["publish-canary"]
    build_text = json.dumps(build_job)
    sign_text = json.dumps(sign_job)
    publish_text = json.dumps(publish_job)

    assert "environment" not in build_job
    assert "${{ secrets." not in build_text
    assert "bun run build" in build_text
    assert sign_job["environment"] == "ota-signing"
    assert sign_job["needs"] == "build-ota"
    assert set(re.findall(r"secrets\.([A-Z0-9_]+)", sign_text)) == {"OTA_SIGNING_DOPPLER_TOKEN"}
    assert "bun run build" not in sign_text
    assert "bun install" not in sign_text
    assert "actions/download-artifact@" in sign_text
    assert not any(
        step.get("uses", "").startswith("actions/checkout@") for step in sign_job["steps"]
    )
    assert "node scripts/" not in sign_text
    assert "dopplerhq/cli-action@" not in sign_text
    assert "doppler_3.76.5_linux_amd64.tar.gz" in sign_text
    assert "1b2f412d984920d665daf233ab6c15b364df9339b5c5b5224d5e8ee4e0a70154" in sign_text
    assert "sha256sum -c" in sign_text
    assert "cli.doppler.com/install.sh" not in sign_text
    assert "doppler run" not in sign_text
    verify_builder = next(
        step for step in sign_job["steps"] if step.get("name") == "Verify exact builder artifact"
    )
    assert verify_builder["env"]["EXPECTED_RELEASE_SHA"] == "${{ github.sha }}"

    digest_index = next(
        index
        for index, step in enumerate(sign_job["steps"])
        if step.get("name") == "Verify exact builder artifact"
    )
    secret_index = next(
        index
        for index, step in enumerate(sign_job["steps"])
        if "OTA_SIGNING_DOPPLER_TOKEN" in json.dumps(step)
    )
    assert digest_index < secret_index
    assert "bundle_sha256" in build_job["outputs"]
    assert "sha256sum -c" in sign_job["steps"][digest_index]["run"]

    assert publish_job["environment"] == "ota-canary"
    assert publish_job["needs"] == "sign-ota"
    assert set(re.findall(r"secrets\.([A-Z0-9_]+)", publish_text)) == {"OTA_CANARY_SSH_KEY"}
    assert "bun run build" not in publish_text
    assert "bun install" not in publish_text
    assert "actions/download-artifact@" in publish_text
    assert "OTA_SIGNING_PRIVATE_KEY" not in publish_text
    assert "doppler" not in publish_text.lower()
    assert not any(
        step.get("uses", "").startswith("actions/checkout@") for step in publish_job["steps"]
    )
    assert "node scripts/" not in publish_text


def test_ota_secret_jobs_do_not_execute_release_head_repository_code():
    """Signing and VPS credentials may meet only static workflow logic and data."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]

    for job_name in (
        "sign-ota",
        "sign-pointer",
        "publish-canary",
        "stage-canary",
        "promote-production",
    ):
        job = jobs[job_name]
        text = json.dumps(job)
        assert not any(
            step.get("uses", "").startswith("actions/checkout@") for step in job["steps"]
        ), f"{job_name} must not check out release-head code"
        assert "node scripts/" not in text
        assert "mira-mobile/scripts/" not in text


def test_ota_secret_jobs_have_one_non_root_channel_capability_each():
    """A routine release credential must not cross a signing/channel boundary."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    jobs = workflow["jobs"]
    expected = {
        "sign-ota": ("ota-signing", {"OTA_SIGNING_DOPPLER_TOKEN"}),
        "sign-pointer": ("ota-signing", {"OTA_SIGNING_DOPPLER_TOKEN"}),
        "publish-canary": ("ota-canary", {"OTA_CANARY_SSH_KEY"}),
        "stage-canary": ("ota-canary", {"OTA_CANARY_SSH_KEY"}),
        "promote-production": ("ota-production", {"OTA_PRODUCTION_SSH_KEY"}),
    }

    for job_name, (environment, secrets) in expected.items():
        job = jobs[job_name]
        text = json.dumps(job)
        assert job["environment"] == environment
        assert set(re.findall(r"secrets\.([A-Z0-9_]+)", text)) == secrets
        assert "User root" not in text
        assert " root@" not in text

    workflow_text = json.dumps(workflow)
    assert "VPS_SSH_KEY" not in workflow_text
    assert "secrets.DOPPLER_TOKEN" not in workflow_text
    assert "inputs.mode == 'provision'" not in workflow_text
    assert "--config ota_signing" in json.dumps(jobs["sign-ota"])
    assert "--config ota_signing" in json.dumps(jobs["sign-pointer"])


def test_ota_handoffs_and_remote_pointer_flips_are_digest_bound():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]

    assert "signed_payload_sha256" in jobs["sign-ota"]["outputs"]
    assert "pointer_payload_sha256" in jobs["sign-pointer"]["outputs"]
    for job_name in ("publish-canary", "stage-canary", "promote-production"):
        text = json.dumps(jobs[job_name])
        assert "sha256sum -c" in text
        assert "mv -f" in text
        assert "flock" in text

    publish_text = json.dumps(jobs["publish-canary"])
    stage_text = json.dumps(jobs["stage-canary"])
    promote_text = json.dumps(jobs["promote-production"])
    assert ".ota-pointer.lock" in publish_text
    assert ".ota-pointer.lock" in stage_text
    assert ".ota-pointer.lock" in promote_text
    assert "canary manifest changed under production lock" in promote_text
    assert "manifest.production.json" in promote_text


def test_ota_remote_pointer_flips_authenticate_monotonic_state_and_use_cas():
    """Every public pointer update must bind preflight state to the locked flip."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]

    for job_name in ("publish-canary", "stage-canary", "promote-production"):
        text = json.dumps(jobs[job_name])
        assert "LIVE_POINTER_HTTP_STATUS" in text
        assert "EXPECTED_LIVE_POINTER_SHA256" in text
        assert "invalid authenticated live pointer" in text
        assert "pointer transition is not monotonic" in text
        assert "live manifest changed after authenticated preflight" in text
        assert "expected_live=" in text

    promote_text = json.dumps(jobs["promote-production"])
    assert "manifest.production.preflight.json" in promote_text
    assert "manifest.canary.live.json" in promote_text


def test_ota_release_rejects_stale_main_reruns_at_each_release_boundary():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]

    for job_name in ("build-ota", "prepare-pointer", "verify-handset-evidence"):
        text = "\n".join(step.get("run", "") for step in jobs[job_name]["steps"])
        assert "refs/remotes/origin/main" in text
        assert '"$GITHUB_SHA" = "$CURRENT_MAIN_SHA"' in text

    for job_name in (
        "sign-ota",
        "publish-canary",
        "sign-pointer",
        "stage-canary",
        "promote-production",
    ):
        text = "\n".join(step.get("run", "") for step in jobs[job_name]["steps"])
        assert "git/ref/heads/main" in text
        assert '"$GITHUB_SHA" = "$CURRENT_MAIN_SHA"' in text


def test_ota_build_rechecks_native_inputs_and_fingerprints_immutable_head():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    build = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]["build-ota"]
    build_text = json.dumps(build)

    assert build_text.count("node scripts/ota-guard.mjs") >= 2
    assert "git diff HEAD --quiet" in build_text
    assert "git ls-files --others --exclude-standard" in build_text
    assert "nativeFingerprintAtRef" in build_text


def test_ota_pointer_source_and_signer_are_bound_to_reviewed_exact_outputs():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]
    prepare_text = "\n".join(step.get("run", "") for step in jobs["prepare-pointer"]["steps"])
    signer = jobs["sign-pointer"]

    assert 'git merge-base --is-ancestor "$RELEASE_SHA" "$GITHUB_SHA"' in prepare_text
    assert "metadata.bundleId" in prepare_text
    assert "`${version}-${sha.slice(0, 8)}`" in prepare_text

    expected_bindings = {
        "EXPECTED_ARTIFACT_SHA256": "${{ needs.prepare-pointer.outputs.artifact_sha256 }}",
        "EXPECTED_BUNDLE_ID": "${{ needs.prepare-pointer.outputs.bundle_id }}",
        "EXPECTED_NATIVE_FINGERPRINT": "${{ needs.prepare-pointer.outputs.native_fingerprint }}",
        "EXPECTED_RELEASE_SHA": "${{ needs.prepare-pointer.outputs.release_sha }}",
        "EXPECTED_CANARY_MANIFEST_SHA256": "${{ needs.prepare-pointer.outputs.canary_manifest_sha256 }}",
        "EXPECTED_POINTER_CHANGED_AT": "${{ needs.prepare-pointer.outputs.pointer_changed_at }}",
    }
    for step_name in (
        "Verify exact pointer input",
        "Fetch isolated key, drop token, and sign pointer",
    ):
        step = next(step for step in signer["steps"] if step.get("name") == step_name)
        for name, expression in expected_bindings.items():
            assert step["env"][name] == expression
        step_text = json.dumps(step)
        for name in expected_bindings:
            assert name in step_text
        assert "expectedHandoff" in step_text
        assert "metadata mismatch" in step_text


def test_ota_artifacts_survive_human_environment_review_window():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    jobs = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))["jobs"]

    uploads = [
        step
        for job in jobs.values()
        for step in job.get("steps", [])
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    assert uploads
    assert all(step["with"]["retention-days"] >= 7 for step in uploads)


def test_ota_production_promotion_requires_protected_human_and_handset_evidence():
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    dispatch = workflow[True]["workflow_dispatch"]["inputs"]
    jobs = workflow["jobs"]

    assert "evidence_commit_sha" in dispatch
    authorize = jobs["verify-handset-evidence"]
    authorize_text = json.dumps(authorize)
    assert "docs/release/evidence/ota/" in authorize_text
    assert "git merge-base --is-ancestor" in authorize_text
    assert "/environments/ota-production" in authorize_text
    assert "required_reviewers" in authorize_text
    assert "prevent_self_review" in authorize_text
    assert "can_admins_bypass" in authorize_text
    assert "protected_branches" in authorize_text
    for field in (
        "artifactSha256",
        "bundleId",
        "nativeFingerprint",
        "releaseSha",
        "canaryManifestSha256",
        "com.android.vending",
        "playSigningCertSha256",
        "updateReady",
        "restartCompleted",
        "aboutBundleIdVerified",
    ):
        assert field in authorize_text

    assert jobs["sign-pointer"]["environment"] == "ota-signing"
    assert set(jobs["sign-pointer"]["needs"]) == {
        "prepare-pointer",
        "verify-handset-evidence",
    }
    promote = jobs["promote-production"]
    assert promote["environment"] == "ota-production"
    assert set(promote["needs"]) == {"sign-pointer", "verify-handset-evidence"}


def test_ota_artifact_id_downloads_extract_into_the_requested_directory():
    """ID-based downloads must not introduce an unexpected artifact-name directory."""
    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    downloads = [
        (job_name, step)
        for job_name, job in workflow["jobs"].items()
        for step in job.get("steps", [])
        if step.get("uses", "").startswith("actions/download-artifact@")
        and "artifact-ids" in step.get("with", {})
    ]

    assert {job_name for job_name, _step in downloads} == {
        "sign-ota",
        "publish-canary",
        "sign-pointer",
        "stage-canary",
        "promote-production",
    }
    for job_name, step in downloads:
        assert step["with"].get("merge-multiple") is True, (
            f"ota-release.yml:{job_name}:{step.get('name', '<unnamed>')} must "
            "extract the selected artifact directly into its declared path"
        )


@pytest.mark.parametrize(
    "workflow_name",
    ["mobile-release-distribute.yml", "ota-release.yml"],
)
def test_mobile_release_shells_never_interpolate_dispatch_inputs(workflow_name):
    workflow_path = REPO_ROOT / ".github" / "workflows" / workflow_name
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    for job_name, job in workflow["jobs"].items():
        for step in job.get("steps", []):
            assert "${{ inputs." not in step.get("run", ""), (
                f"{workflow_name}:{job_name}:{step.get('name', '<unnamed>')} must pass dispatch "
                "input through env instead of parsing it as shell source"
            )


@pytest.mark.parametrize(
    ("workflow_name", "job_names"),
    [
        (
            "mobile-release-distribute.yml",
            (
                "build-unsigned-native",
                "sign-native",
                "firebase-distribute",
                "publish-download",
                "report",
            ),
        ),
        (
            "ota-release.yml",
            ("publish-canary", "stage-canary", "promote-production"),
        ),
    ],
)
def test_production_mobile_release_jobs_refuse_non_main_refs(workflow_name, job_names):
    workflow_path = REPO_ROOT / ".github" / "workflows" / workflow_name
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    for job_name in job_names:
        condition = str(workflow["jobs"][job_name].get("if", ""))
        assert "github.ref == 'refs/heads/main'" in condition


@pytest.mark.parametrize(
    "workflow_name",
    [
        "deploy-nginx-staging-passthrough.yml",
        "deploy-nginx-stg.yml",
        "deploy-staging.yml",
        "deploy-vps.yml",
        "mobile-release-distribute.yml",
        "nginx-sites-enabled-hygiene.yml",
        "ota-release.yml",
        "printsense-production-activation.yml",
        "printsense-staging-e2e.yml",
        "vps-cleanup.yml",
        "vps-install-amux.yml",
    ],
)
def test_production_release_actions_are_pinned_to_full_commit_shas(workflow_name):
    workflow_path = REPO_ROOT / ".github" / "workflows" / workflow_name
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    for job_name, job in workflow["jobs"].items():
        for step in job.get("steps", []):
            action = step.get("uses")
            if action is None:
                continue
            assert re.fullmatch(r"[^@]+@[0-9a-f]{40}", action), (
                f"{workflow_name}:{job_name}:{step.get('name', '<unnamed>')} "
                f"must pin {action!r} to a full commit SHA"
            )


def test_mobile_release_tool_versions_are_immutable():
    for workflow_name in ("mobile-release-distribute.yml", "ota-release.yml"):
        text = (REPO_ROOT / ".github" / "workflows" / workflow_name).read_text(encoding="utf-8")
        assert "bun-version: latest" not in text
    mobile_release = (
        REPO_ROOT / ".github" / "workflows" / "mobile-release-distribute.yml"
    ).read_text(encoding="utf-8")
    assert "https://firebase.tools/bin/linux/v15.29.0" in mobile_release
    assert "ef0998b3c1eeedf2a7b02b23bbe2b98a84a855855ea73d85d4498af432531ded" in mobile_release
    assert "sha256sum -c" in mobile_release
    assert "npx --yes firebase-tools" not in mobile_release


def test_production_deploy_manual_path_is_main_only_and_services_are_data():
    path = REPO_ROOT / ".github" / "workflows" / "deploy-vps.yml"
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    deploy = workflow["jobs"]["deploy"]
    condition = str(deploy.get("if", ""))
    assert "github.ref == 'refs/heads/main'" in condition

    deploy_step = next(step for step in deploy["steps"] if step.get("name") == "Deploy")
    run = deploy_step["run"]
    assert "SERVICES='$SERVICES'" not in run
    assert "SERVICES_B64" in run
    assert "ALLOWED_SERVICES" in run


# ---------------------------------------------------------------------------
# Native mobile release isolation. Release secrets live only on fresh runners
# that consume immutable artifacts; repository build code never shares those
# runners or credentials.
# ---------------------------------------------------------------------------


def _native_release_workflow() -> dict:
    path = REPO_ROOT / ".github" / "workflows" / "mobile-release-distribute.yml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _native_job_commands(job: dict) -> str:
    return "\n".join(step.get("run", "") for step in job.get("steps", []))


def _native_job_secret_refs(job: dict) -> set[str]:
    return set(
        re.findall(
            r"\$\{\{\s*secrets\.([A-Z0-9_]+)\s*}}",
            json.dumps(job),
        )
    )


@pytest.mark.parametrize(
    ("workflow_name", "job_name"),
    [
        ("deploy-nginx-staging-passthrough.yml", "deploy-nginx"),
        ("deploy-nginx-stg.yml", "deploy-nginx"),
        ("nginx-sites-enabled-hygiene.yml", "hygiene"),
        ("vps-cleanup.yml", "cleanup"),
    ],
)
def test_main_controller_ssh_jobs_reject_stale_sources_before_credentials(workflow_name, job_name):
    path = REPO_ROOT / ".github" / "workflows" / workflow_name
    job = yaml.safe_load(path.read_text(encoding="utf-8"))["jobs"][job_name]
    assert "github.ref == 'refs/heads/main'" in str(job.get("if", ""))

    checkout = next(
        step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    assert checkout["with"]["persist-credentials"] is False

    source_index = next(
        index
        for index, step in enumerate(job["steps"])
        if step.get("name") == "Require the exact current main source"
    )
    commands = job["steps"][source_index]["run"]
    assert "git fetch --no-tags origin main" in commands
    assert 'CURRENT_MAIN="$(git rev-parse origin/main)"' in commands
    assert 'CHECKED_OUT="$(git rev-parse HEAD)"' in commands
    assert '[[ "$CHECKED_OUT" == "$CURRENT_MAIN" ]]' in commands
    secret_index = next(
        index for index, step in enumerate(job["steps"]) if _native_job_secret_refs({"step": step})
    )
    assert source_index < secret_index


def test_native_unsigned_build_is_exact_sha_and_secret_free():
    """A Bun/Capacitor/Gradle mutation must not reach a production credential."""
    jobs = _native_release_workflow()["jobs"]
    verify = jobs["verify-mobile"]
    build = jobs["build-unsigned-native"]
    build_text = json.dumps(build)

    for job in (verify, build):
        assert "environment" not in job
        assert _native_job_secret_refs(job) == set()

    assert build["needs"] == "verify-mobile"
    assert "bun install --frozen-lockfile" in build_text
    assert "bun run build" in build_text
    assert "capacitor sync android" in build_text
    assert "assembleRelease bundleRelease" in build_text
    assert "app-release-unsigned.apk" in build_text
    assert "app-release.aab" in build_text
    assert "21.0.12+8.0" in build_text
    assert 'cmdline-tools-version": "12266719' in build_text
    assert "build-tools;35.0.0" in build_text
    assert "7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172" in build_text
    assert "ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7cb" in build_text

    checkout = next(
        step for step in build["steps"] if step.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"] == {
        "ref": "${{ github.sha }}",
        "persist-credentials": False,
    }

    wrapper = (
        REPO_ROOT / "mira-mobile" / "android" / "gradle" / "wrapper" / "gradle-wrapper.properties"
    ).read_text(encoding="utf-8")
    expected_distribution_hash = (
        "distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7cb"
    )
    assert wrapper.splitlines().count(expected_distribution_hash) == 1
    wrapper_step = next(
        step for step in build["steps"] if step.get("name") == "Verify the pinned Gradle wrapper"
    )
    assert "distributionSha256Sum=" in wrapper_step["run"]
    assert ">>" not in wrapper_step["run"]


def test_native_secret_jobs_never_execute_repository_build_code():
    """Signing, Firebase, and SSH credentials must never coexist with repo builds."""
    jobs = _native_release_workflow()["jobs"]
    expected_secrets = {
        "sign-native": {"DOPPLER_TOKEN"},
        "firebase-distribute": {"DOPPLER_TOKEN"},
        "publish-download": {"VPS_SSH_KEY"},
    }

    for job_name, secret_names in expected_secrets.items():
        job = jobs[job_name]
        commands = _native_job_commands(job)
        assert job["environment"] == "production"
        assert _native_job_secret_refs(job) == secret_names
        assert not re.search(r"(^|\s)(bun|npm|npx|node)(\s|$)", commands)
        assert "gradlew" not in commands
        assert "capacitor" not in commands.lower()
        assert "vite" not in commands.lower()


def test_native_release_rejects_stale_main_before_each_credential():
    jobs = _native_release_workflow()["jobs"]
    credential_steps = {
        "sign-native": "Sign and verify native artifacts",
        "firebase-distribute": "Distribute signed APK to Firebase testers",
        "publish-download": "Publish direct-install download",
    }

    for job_name, credential_name in credential_steps.items():
        steps = jobs[job_name]["steps"]
        gate_index = next(
            index
            for index, step in enumerate(steps)
            if step.get("name") == "Require the exact current main source"
        )
        credential_index = next(
            index for index, step in enumerate(steps) if step.get("name") == credential_name
        )
        gate = steps[gate_index]

        assert gate_index + 1 == credential_index
        assert gate["env"] == {"GH_TOKEN": "${{ github.token }}"}
        assert "repos/$GITHUB_REPOSITORY/git/ref/heads/main" in gate["run"]
        assert '"$GITHUB_SHA" = "$CURRENT_MAIN_SHA"' in gate["run"]
        assert _native_job_secret_refs({"step": gate}) == set()


def test_native_signing_runner_consumes_only_unsigned_artifacts_and_pins_cert():
    """A release must be signed by the documented upload certificate, not any CN."""
    job = _native_release_workflow()["jobs"]["sign-native"]
    job_text = json.dumps(job)
    commands = _native_job_commands(job)

    assert job["needs"] == "build-unsigned-native"
    assert not any(step.get("uses", "").startswith("actions/checkout@") for step in job["steps"])
    assert "actions/download-artifact@" in job_text
    assert "native-unsigned-${{ github.sha }}" in job_text
    assert "actions/setup-java@" in job_text
    assert "android-actions/setup-android@" in job_text
    for tool in ("zipalign", "apksigner", "jarsigner", "keytool"):
        assert tool in commands
    assert "2395b96050c510a5c787465b83256f381b1ff5e4833d2fa88db73579293f92a9" in commands.lower()
    assert 'rm -rf "$SIGNING_DIR"' in commands


def test_firebase_distribution_uses_verified_standalone_binary():
    """A mutable npm/npx Firebase install must not execute beside its credential."""
    job = _native_release_workflow()["jobs"]["firebase-distribute"]
    job_text = json.dumps(job)
    commands = _native_job_commands(job)

    assert job["needs"] == "sign-native"
    assert not any(step.get("uses", "").startswith("actions/checkout@") for step in job["steps"])
    assert "app-release-apk-${{ github.sha }}" in job_text
    assert "https://firebase.tools/bin/linux/v15.29.0" in commands
    assert "ef0998b3c1eeedf2a7b02b23bbe2b98a84a855855ea73d85d4498af432531ded" in commands
    assert "sha256sum -c" in commands
    assert not re.search(r"(^|\s)(npm|npx)(\s|$)", commands)

    validation_index = next(
        index
        for index, step in enumerate(job["steps"])
        if step.get("name") == "Validate distribution inputs"
    )
    secret_index = next(
        index for index, step in enumerate(job["steps"]) if _native_job_secret_refs({"step": step})
    )
    assert validation_index < secret_index


def test_direct_download_uses_governed_metadata_and_pinned_ssh_trust():
    """Production publication must not trust a live ssh-keyscan or disable checking."""
    job = _native_release_workflow()["jobs"]["publish-download"]
    job_text = json.dumps(job)
    commands = _native_job_commands(job)

    assert job["needs"] == "sign-native"
    assert "app-release-apk-${{ github.sha }}" in job_text
    checkout = next(
        step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")
    )
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    assert checkout["with"]["persist-credentials"] is False
    assert "deployment/ota-download/index.html" in json.dumps(checkout["with"])
    assert "mira-mobile/android/app/build.gradle" in json.dumps(checkout["with"])
    assert "deployment/known_hosts.factorylm-prod" in json.dumps(checkout["with"])
    assert "deployment/known_hosts.factorylm-prod" in commands
    assert "UserKnownHostsFile=" in commands
    assert "StrictHostKeyChecking=yes" in commands
    assert "ssh-keyscan" not in commands
    assert "StrictHostKeyChecking=no" not in commands

    payload_index = next(
        index
        for index, step in enumerate(job["steps"])
        if step.get("name") == "Prepare and validate release payload"
    )
    secret_index = next(
        index for index, step in enumerate(job["steps"]) if _native_job_secret_refs({"step": step})
    )
    assert payload_index < secret_index


def test_direct_download_is_content_addressed_and_updates_pointers_atomically():
    job = _native_release_workflow()["jobs"]["publish-download"]
    prepare = next(
        step for step in job["steps"] if step.get("name") == "Prepare and validate release payload"
    )["run"]
    publish = next(
        step for step in job["steps"] if step.get("name") == "Publish direct-install download"
    )["run"]

    assert 'FILE="factorylm-${VERSION_NAME}-vc${VERSION_CODE}-${APK_SHA256}.apk"' in prepare
    assert "flock" in publish
    assert "install_immutable" in publish
    assert 'mv -f "$incoming/latest.apk" "$root/latest.apk"' in publish
    assert 'mv -f "$incoming/latest.json" "$root/latest.json"' in publish
    assert publish.index('mv -f "$incoming/latest.apk" "$root/latest.apk"') < publish.index(
        'mv -f "$incoming/latest.json" "$root/latest.json"'
    )
    assert '"$TARGET:/srv/factorylm/ota/app/$RELEASE_FILE"' not in publish


def test_prod_migration_drift_isolated_from_vps_credentials_and_dependency_hooks():
    """The DB gate gets only the DB URL; deploy SSH secrets stay in a fresh job."""
    path = REPO_ROOT / ".github" / "workflows" / "deploy-vps.yml"
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    jobs = workflow["jobs"]
    drift = jobs["migration-drift"]
    deploy = jobs["deploy"]
    drift_text = json.dumps(drift)
    deploy_text = json.dumps(deploy)

    assert drift["environment"] == "production"
    assert deploy["needs"] == ["authorize-source", "migration-drift"]
    assert "VPS_SSH_KEY" not in drift_text
    assert "ssh " not in drift_text
    assert "scp " not in drift_text
    assert "migration_drift.py" not in deploy_text
    assert "psycopg2" not in deploy_text

    dependency_step = next(
        step for step in drift["steps"] if "--require-hashes" in step.get("run", "")
    )
    assert "--only-binary=:all:" in dependency_step["run"]
    assert "tools/migration-drift-requirements.txt" in dependency_step["run"]

    fetch_step = next(step for step in drift["steps"] if "DOPPLER_TOKEN" in step.get("env", {}))
    assert set(fetch_step["env"]) == {"DOPPLER_TOKEN"}
    assert "migration_drift.py" not in fetch_step["run"]
    assert "prod-db-url" in fetch_step["run"]

    verify_step = next(
        step for step in drift["steps"] if "migration_drift.py" in step.get("run", "")
    )
    assert "DOPPLER_TOKEN" not in json.dumps(verify_step)
    assert "env -i" in verify_step["run"]
    assert "python3 -I tools/migration_drift.py" in verify_step["run"]


def test_prod_source_authorization_precedes_all_environment_credentials():
    """No production environment job may start before source and gate authorization."""
    path = REPO_ROOT / ".github" / "workflows" / "deploy-vps.yml"
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    jobs = workflow["jobs"]
    authorize = jobs["authorize-source"]
    authorize_text = json.dumps(authorize)
    authorize_commands = _native_job_commands(authorize)

    assert "environment" not in authorize
    assert "DOPPLER_TOKEN" not in authorize_text
    assert "VPS_SSH_KEY" not in authorize_text
    assert "github.event.workflow_run.event == 'push'" in authorize["if"]
    assert "github.event.workflow_run.head_branch == 'main'" in authorize["if"]
    assert (
        "github.event.workflow_run.head_repository.full_name == github.repository"
        in authorize["if"]
    )
    assert "git fetch --no-tags origin main" in authorize_commands
    assert '[[ "$CHECKED_OUT" == "$CURRENT_MAIN" ]]' in authorize_commands
    assert "skip_staging_gate=true requires a non-empty skip_reason" in authorize_commands
    assert "skip_drift_check=true requires a non-empty skip_reason" in authorize_commands
    assert "/commits/$DEPLOY_SHA/pulls" in authorize_commands
    assert '--workflow "Staging Gate"' in authorize_commands
    assert "completed:success" in authorize_commands

    assert jobs["migration-drift"]["needs"] == "authorize-source"
    assert jobs["deploy"]["needs"] == ["authorize-source", "migration-drift"]


def test_prod_deploy_jobs_reject_stale_or_non_push_main_sources_before_credentials():
    """A rerun of an old/manual Smoke Test must not deploy stale repository code."""
    path = REPO_ROOT / ".github" / "workflows" / "deploy-vps.yml"
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))

    for job_name in ("migration-drift", "deploy"):
        job = workflow["jobs"][job_name]
        condition = job["if"]
        assert "github.event.workflow_run.event == 'push'" in condition
        assert "github.event.workflow_run.head_branch == 'main'" in condition
        assert (
            "github.event.workflow_run.head_repository.full_name == github.repository" in condition
        )

        steps = job["steps"]
        source_index = next(
            index
            for index, step in enumerate(steps)
            if step.get("name") == "Require the exact current main source"
        )
        source_step = steps[source_index]
        source_commands = source_step["run"]
        assert "git fetch --no-tags origin main" in source_commands
        assert 'CURRENT_MAIN="$(git rev-parse origin/main)"' in source_commands
        assert 'CHECKED_OUT="$(git rev-parse HEAD)"' in source_commands
        assert '[[ "$CHECKED_OUT" == "$CURRENT_MAIN" ]]' in source_commands

        first_secret_index = next(
            (index for index, step in enumerate(steps) if _native_job_secret_refs({"step": step})),
            len(steps),
        )
        assert source_index < first_secret_index


def test_prod_migration_driver_is_exactly_pinned_and_hash_locked():
    path = REPO_ROOT / "tools" / "migration-drift-requirements.txt"
    lines = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    assert lines == [
        "asyncpg==0.31.0 "
        "--hash=sha256:aad7a33913fb8bcb5454313377cc330fbb19a0cd5faa7272407d8a0c4257b671"
    ]


def test_license_ci_installs_and_allowlists_the_isolated_migration_driver():
    """Catches the production-only dependency escaping the Apache/MIT license gate."""
    workflow = yaml.safe_load(
        (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    )
    job = workflow["jobs"]["license-check"]
    setup = next(step for step in job["steps"] if "cache-dependency-path" in step.get("with", {}))
    install = next(
        step for step in job["steps"] if step.get("name") == "Install pip-licenses and project deps"
    )
    allowlist = next(
        step
        for step in job["steps"]
        if step.get("name") == "Check production migration-driver license"
    )

    assert "tools/migration-drift-requirements.txt" in setup["with"]["cache-dependency-path"]
    assert "-r tools/migration-drift-requirements.txt" in install["run"]
    assert "--packages asyncpg" in allowlist["run"]
    assert '--allow-only="Apache-2.0;MIT"' in allowlist["run"]


@pytest.mark.parametrize(
    "workflow_name",
    [
        "deploy-nginx-staging-passthrough.yml",
        "deploy-nginx-stg.yml",
        "deploy-staging.yml",
        "deploy-vps.yml",
        "mobile-release-distribute.yml",
        "nginx-sites-enabled-hygiene.yml",
        "ota-release.yml",
        "printsense-production-activation.yml",
        "printsense-staging-e2e.yml",
        "vps-cleanup.yml",
    ],
)
def test_production_ssh_uses_committed_host_identity(workflow_name):
    text = (REPO_ROOT / ".github" / "workflows" / workflow_name).read_text(encoding="utf-8")
    assert "ssh-keyscan" not in text
    assert "StrictHostKeyChecking=no" not in text
    assert "StrictHostKeyChecking no" not in text
    assert "deployment/known_hosts.factorylm-prod" in text
    assert "StrictHostKeyChecking=yes" in text


def test_factorylm_prod_host_identity_is_committed_and_guarded():
    host_key = (REPO_ROOT / "deployment" / "known_hosts.factorylm-prod").read_text(encoding="utf-8")
    assert host_key == (
        "165.245.138.91 ssh-ed25519 "
        "AAAAC3NzaC1lZDI1NTE5AAAAIOx9AwtJJMamqcrrAyrea9+7Hmqo4o9IO3QZHI50EUqR\n"
    )
    policy = load_guard_policy(REAL_REGISTRY)
    assert path_is_guarded("deployment/known_hosts.factorylm-prod", policy)
    assert path_is_guarded("tools/migration_drift.py", policy)
    assert path_is_guarded("tools/migration-drift-requirements.txt", policy)


def test_canonical_mobile_updates_focus_uses_visible_accent_token():
    css = (REPO_ROOT / "mira-mobile" / "src" / "unified" / "unified.css").read_text(
        encoding="utf-8"
    )
    assert (
        ".unified-updates button:focus-visible { outline: 3px solid "
        "var(--fl-workspace-accent); outline-offset: 2px; }"
    ) in css
    assert (
        ".unified-updates button:focus-visible { outline: 3px solid var(--fl-workspace-accent-tint)"
    ) not in css


def test_ota_secret_jobs_embed_the_exact_committed_host_identity():
    import base64

    workflow_path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    embedded = base64.b64decode(workflow["env"]["OTA_KNOWN_HOSTS_B64"])
    committed = (REPO_ROOT / "deployment" / "known_hosts.factorylm-prod").read_bytes()
    assert embedded == committed


def test_ota_workflow_enforces_canary_first_promotion():
    path = REPO_ROOT / ".github" / "workflows" / "ota-release.yml"
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    dispatch = workflow[True]["workflow_dispatch"]["inputs"]
    assert dispatch["channel"]["options"] == ["canary"]
    assert "stage-canary" in dispatch["mode"]["options"]

    build = workflow["jobs"]["build-ota"]
    input_step = next(step for step in build["steps"] if step.get("name") == "Inputs")
    assert '"$CHANNEL_INPUT" = "canary"' in input_step["run"]

    sign_pointer = workflow["jobs"]["sign-pointer"]
    sign_pointer_text = json.dumps(sign_pointer)
    assert "inputs.mode == 'stage-canary'" in str(sign_pointer["if"])
    assert "inputs.mode == 'promote'" in str(sign_pointer["if"])
    assert "manifest.canary.json" in sign_pointer_text

    stage = workflow["jobs"]["stage-canary"]
    assert "inputs.mode == 'stage-canary'" in str(stage["if"])
    assert stage["needs"] == "sign-pointer"

    promote = workflow["jobs"]["promote-production"]
    promote_text = json.dumps(promote)
    assert "inputs.mode == 'promote'" in str(promote["if"])
    assert set(promote["needs"]) == {"sign-pointer", "verify-handset-evidence"}
    assert "manifest.canary.json" in promote_text
    assert "canary manifest changed" in promote_text.lower()
    assert "canary" in promote_text
