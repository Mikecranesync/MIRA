"""Workflow-contract tests for the deploy-time release-tag resolver (#3055).

Two layers:
  1. BEHAVIORAL — run .github/scripts/resolve_release_tag.sh against a fake `git`
     on PATH, covering the positive (tag present / appears late), negative
     (fail-closed), and hotfix-fallback paths.
  2. STATIC — assert deploy-vps.yml wires the resolver correctly and no longer
     deploys a moving ref.

Run: pytest tests/test_deploy_release_tag_resolver.py -q
"""

import os
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RESOLVER = REPO / ".github" / "scripts" / "resolve_release_tag.sh"
DEPLOY_YML = REPO / ".github" / "workflows" / "deploy-vps.yml"
SHA = "a" * 40  # a well-formed immutable commit hash

_FAKE_GIT = """#!/usr/bin/env bash
# Fake `git` for the resolver tests. Only implements what the resolver calls.
case "$1" in
  fetch) exit 0 ;;
  tag)
    # git tag --points-at <sha> --list 'v[0-9]*'
    n=0; [ -f "$FAKE_ATTEMPTS_FILE" ] && n=$(cat "$FAKE_ATTEMPTS_FILE")
    n=$((n + 1)); echo "$n" > "$FAKE_ATTEMPTS_FILE"
    if [ "$n" -ge "${FAKE_TAG_AFTER:-1}" ] && [ -n "${FAKE_TAG_OUTPUT:-}" ]; then
      printf '%b\\n' "$FAKE_TAG_OUTPUT"
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
"""


def _run(tmp_path, *, sha=SHA, allow_fallback="0", tag_output="", tag_after="1", attempts="3"):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    git = bin_dir / "git"
    git.write_text(_FAKE_GIT)
    git.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env.update(
        DEPLOY_SHA=sha,
        ALLOW_MOVING_FALLBACK=allow_fallback,
        TAG_WAIT_ATTEMPTS=attempts,
        TAG_WAIT_SECONDS="0",  # no real sleeping in tests
        FAKE_TAG_OUTPUT=tag_output,
        FAKE_TAG_AFTER=tag_after,
        FAKE_ATTEMPTS_FILE=str(tmp_path / "attempts"),
    )
    return subprocess.run(
        ["bash", str(RESOLVER)], env=env, capture_output=True, text=True, timeout=30
    )


# ── behavioral: positive paths ────────────────────────────────────────────────


def test_tag_present_immediately(tmp_path):
    r = _run(tmp_path, tag_output="v1.2.3", tag_after="1")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "v1.2.3"


def test_tag_appears_after_a_few_attempts(tmp_path):
    r = _run(tmp_path, tag_output="v1.2.3", tag_after="3", attempts="5")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "v1.2.3"


def test_multiple_tags_at_sha_picks_highest_semver(tmp_path):
    r = _run(tmp_path, tag_output="v1.2.0\\nv1.10.0\\nv1.9.0", tag_after="1")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "v1.10.0"


# ── behavioral: negative / fail-closed ────────────────────────────────────────


def test_no_tag_fails_closed_on_normal_path(tmp_path):
    r = _run(tmp_path, tag_output="", allow_fallback="0", attempts="2")
    assert r.returncode == 1, "must fail closed rather than deploy a moving/untagged ref"
    assert r.stdout.strip() == ""


def test_no_tag_hotfix_fallback_returns_empty_for_pinned_sha(tmp_path):
    r = _run(tmp_path, tag_output="", allow_fallback="1", attempts="2")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == ""  # empty ⇒ caller checks out the pinned DEPLOY_SHA


def test_non_hex_deploy_sha_is_rejected(tmp_path):
    # A branch name (moving ref) must never be accepted as the anchor.
    r = _run(tmp_path, sha="main", tag_output="v1.2.3")
    assert r.returncode == 1, "a non-commit-hash anchor must be refused"


def test_empty_deploy_sha_is_rejected(tmp_path):
    r = _run(tmp_path, sha="", tag_output="v1.2.3")
    assert r.returncode == 1


# ── static workflow contract ──────────────────────────────────────────────────


def test_resolver_script_exists_and_is_executable():
    assert RESOLVER.exists(), "resolver script missing"
    assert os.access(RESOLVER, os.X_OK), "resolver script must be executable"


def test_deploy_workflow_never_resets_to_moving_main():
    text = DEPLOY_YML.read_text()
    assert "git reset --hard origin/main" not in text, (
        "deploy must not reset to a moving origin/main (#3055)"
    )


def test_deploy_workflow_anchors_on_deploy_sha_and_uses_resolver():
    text = DEPLOY_YML.read_text()
    assert "DEPLOY_SHA:" in text and "workflow_run.head_sha" in text
    assert "DEPLOY_SHA='$DEPLOY_SHA'" in text, "DEPLOY_SHA must be passed into the VPS heredoc"
    assert "resolve_release_tag.sh" in text, "deploy must invoke the resolver"
    assert 'git show "${DEPLOY_SHA}:.github/scripts/resolve_release_tag.sh"' in text, (
        "resolver must run from the object at the deployed SHA"
    )


def test_deploy_workflow_fails_closed_on_missing_sha_or_script():
    text = DEPLOY_YML.read_text()
    assert "not present after fetch" in text, "missing DEPLOY_SHA must fail closed"
    assert "failing closed" in text, "missing resolver script must fail closed"
