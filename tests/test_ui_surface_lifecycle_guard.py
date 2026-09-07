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
    assert "body:## Legacy UI exception section" in result.missing_fields


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
    assert "body:Reason:" in result.missing_fields


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
    assert set(result.missing_fields) == {
        "body:Reason:",
        "body:Canonical replacement impact:",
        "body:Rollback:",
    }


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
    result = evaluate(_TOUCH, labels={"legacy-ui-exception"}, pr_body=body, policy=_POLICY)
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
        "mira-web/public/**",
        "mira-hub/src/app/**",
        "mira-hub/src/components/**",
        "mira-hub/src/providers/**",
        "mira-hub/src/messages/**",
        "mira-hub/public/**",
        "mira-mobile/index.html",
        "mira-mobile/src/**",
    }
    assert expected <= set(policy.guarded_paths)


@pytest.mark.parametrize(
    "path",
    [
        "mira-hub/src/components/AssetChat.tsx",
        "mira-hub/src/components/namespace/NodeChat.tsx",
        "mira-hub/src/components/AssetChatV2.tsx",
        "mira-hub/src/components/chat/NewLegacyPanel.tsx",
        "mira-hub/src/app/layout.tsx",
        "mira-hub/src/app/globals.css",
        "mira-hub/src/app/login/page.tsx",
        "mira-hub/src/app/dashboard-copy/page.tsx",
        "mira-hub/src/providers/theme-provider.tsx",
        "mira-hub/src/messages/en.json",
        "mira-hub/public/new-shell.js",
        "mira-web/src/lib/feature-renderer.ts",
        "mira-web/src/lib/blog-renderer.ts",
        "mira-web/src/lib/drive-commander-renderer.ts",
        "mira-web/src/lib/new-dashboard-renderer.ts",
        "mira-web/src/capabilities/NewLegacyPanel.tsx",
        "mira-web/src/seed/NewLegacyPanel.tsx",
        "mira-web/src/routes/printsense.ts",
        "mira-web/src/routes/new-old-site.ts",
        "mira-web/src/server.ts",
        "mira-mobile/index.html",
        "mira-mobile/src/main.tsx",
        "mira-mobile/src/LegacyAppV2.tsx",
        "mira-mobile/src/app.css",
        "mira-mobile/src/api/NewLegacyPanel.tsx",
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
        "mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts",
        "mira-hub/src/app/(hub)/api/auth/magic-link/route.ts",
        "mira-hub/src/components/equipment/notebook-chat-utils.ts",
        "mira-hub/src/lib/notebook-chat-types.ts",
        "mira-hub/src/providers/auth-provider.ts",
        "mira-web/src/routes/inbox.ts",
        "mira-web/src/routes/mfa.ts",
        "mira-web/src/routes/probe-state.ts",
        "mira-web/src/routes/m.ts",
        "mira-web/src/lib/auth.ts",
        "mira-web/src/lib/mira-chat.ts",
        "mira-web/src/capabilities/new-service.ts",
        "mira-mobile/src/api/client.ts",
        "mira-mobile/src/chat-adapter/runtime.tsx",
        "mira-mobile/src/lib/live-update.ts",
        "mira-mobile/src/lib/native-pick.ts",
        "mira-mobile/src/lib/offline-queue.ts",
        "mira-mobile/src/lib/open-with.ts",
        "mira-mobile/src/lib/resume-guard.ts",
        "mira-mobile/src/lib/sse.ts",
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


def test_cli_accepts_changes_json_file_with_expected_change_count_file(tmp_path):
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
    for package in (
        "markdown-it-py",
        "mdurl",
        "pyyaml",
        "pytest",
        "iniconfig",
        "packaging",
        "pluggy",
        "pygments",
    ):
        assert re.search(rf"(?im)^{package}==[^\s]+", requirement_text), package
    assert requirement_text.count("--hash=sha256:") >= 8


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
