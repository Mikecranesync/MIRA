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
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

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
ChangedFile = _guard.ChangedFile
GuardPolicy = _guard.GuardPolicy
GuardPolicyError = _guard.GuardPolicyError
GuardResult = _guard.GuardResult
changed_files_between = _guard.changed_files_between
evaluate = _guard.evaluate
load_changed_files = _guard.load_changed_files
load_guard_policy = _guard.load_guard_policy
path_is_guarded = _guard.path_is_guarded


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
        "mira-hub/src/components/equipment/__brand_new_sibling__.tsx",
        "mira-mobile/src/screens/__brand_new_sibling__.tsx",
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
    assert ".github/workflows/ui-lifecycle-guard.yml" in CONTROL_PATTERNS


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
    assert any("Reason" in f for f in result.missing_fields)


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
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=_VALID_BODY, policy=_POLICY)
    assert result.allowed is True
    assert result.missing_fields == ()


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
        "mira-web/public/mira-chat.js",
        "mira-web/public/mira-chat.css",
        "mira-hub/src/app/(hub)/**",
        "mira-hub/src/components/layout/**",
        "mira-hub/src/components/equipment/**",
        "mira-mobile/src/App.tsx",
        "mira-mobile/src/nav.ts",
        "mira-mobile/src/screens/**",
    }
    assert expected <= set(policy.guarded_paths)
