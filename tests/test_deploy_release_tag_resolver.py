"""Workflow-contract tests for the deploy-time release-tag resolver (#3055).

Two layers:
  1. BEHAVIORAL — run .github/scripts/resolve_release_tag.sh against a fake `git`
     on PATH, covering the positive (tag present / appears late), negative
     (fail-closed), and hotfix-fallback paths.
  2. STATIC — assert deploy-vps.yml wires the resolver correctly and no longer
     deploys a moving ref.

Run: pytest tests/test_deploy_release_tag_resolver.py -q
"""

import base64
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

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

_FAKE_SSH = """#!/usr/bin/env bash
printf '%s\n' "$@" > "$SSH_CALL_FILE"
cat > "$SSH_STDIN_FILE"
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


def _deploy_script(text: str | None = None) -> str:
    workflow = yaml.safe_load(text if text is not None else DEPLOY_YML.read_text())
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("name") == "Deploy":
                return step["run"]
    raise AssertionError("Deploy step missing from deploy-vps.yml")


def _run_deploy_boundary(
    tmp_path: Path,
    *,
    services: str | None = "mira-hub mira-pipeline",
    sha: str | None = SHA,
    allow_fallback: str | None = "0",
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    """Run the real local deploy shell with ssh replaced by an inert recorder."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ssh = bin_dir / "ssh"
    ssh.write_text(_FAKE_SSH)
    ssh.chmod(0o755)
    ssh_call = tmp_path / "ssh-call"
    ssh_stdin = tmp_path / "ssh-stdin"
    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["SSH_CALL_FILE"] = str(ssh_call)
    env["SSH_STDIN_FILE"] = str(ssh_stdin)
    for key, value in (
        ("SERVICES", services),
        ("DEPLOY_SHA", sha),
        ("ALLOW_MOVING_FALLBACK", allow_fallback),
    ):
        env.pop(key, None)
        if value is not None:
            env[key] = value
    result = subprocess.run(
        ["bash", "-c", _deploy_script()],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result, ssh_call, ssh_stdin


def _assert_resolver_object_contract(script: str) -> None:
    fetched = re.search(
        r'git show "\$\{DEPLOY_SHA\}:\.github/scripts/resolve_release_tag\.sh"'
        r"\s*>\s*(?P<path>[^\s\\]+)",
        script,
    )
    assert fetched, "resolver bytes must be fetched from the exact deployed SHA"
    executed = re.search(r"\bbash\s+(?P<path>[^\s)]+)\)\"", script)
    assert executed, "fetched resolver must be executed explicitly"
    assert fetched.group("path") == executed.group("path"), (
        "the path populated by git show must be the exact path passed to bash"
    )
    assert fetched.start() < executed.start(), (
        "resolver cannot execute before its bytes are fetched"
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
    script = _deploy_script(text)
    assert "DEPLOY_SHA:" in text and "workflow_run.head_sha" in text
    assert "DEPLOY_SHA='$DEPLOY_SHA'" not in text, (
        "do not interpolate the deploy SHA into an environment assignment"
    )
    _assert_resolver_object_contract(script)


def test_validated_inputs_are_the_only_values_forwarded_to_ssh(tmp_path):
    result, ssh_call, ssh_stdin = _run_deploy_boundary(tmp_path)

    assert result.returncode == 0, result.stderr
    encoded_services = base64.b64encode(b"mira-hub mira-pipeline").decode()
    assert ssh_call.read_text().splitlines()[-1] == (f"bash -s -- '{encoded_services}' '{SHA}' '0'")
    remote_script = ssh_stdin.read_text()
    assert 'SERVICES="$(printf \'%s\' "$1" | base64 -d)"' in remote_script
    assert 'DEPLOY_SHA="$2"' in remote_script
    assert 'ALLOW_MOVING_FALLBACK="$3"' in remote_script


@pytest.mark.parametrize(
    ("services", "sha", "allow_fallback", "description"),
    [
        (None, SHA, "0", "missing services"),
        ("mira-hub", None, "0", "missing deploy SHA"),
        ("mira-hub", SHA, None, "missing fallback flag"),
        ("unknown-service", SHA, "0", "unknown service"),
        ("mira-hub;id", SHA, "0", "shell-shaped service"),
        ("mira-hub", "main", "0", "moving deploy ref"),
        ("mira-hub", "A" * 40, "0", "noncanonical deploy SHA"),
        ("mira-hub", f"{SHA};id", "0", "shell-shaped deploy SHA"),
        ("mira-hub", SHA, "2", "out-of-range fallback flag"),
        ("mira-hub", SHA, "0;id", "shell-shaped fallback flag"),
    ],
)
def test_invalid_inputs_fail_before_ssh(
    tmp_path: Path,
    services: str | None,
    sha: str | None,
    allow_fallback: str | None,
    description: str,
):
    result, ssh_call, _ = _run_deploy_boundary(
        tmp_path,
        services=services,
        sha=sha,
        allow_fallback=allow_fallback,
    )

    assert result.returncode != 0, f"deploy accepted {description}"
    assert not ssh_call.exists(), f"deploy reached ssh before rejecting {description}"


def test_injection_shaped_service_is_data_and_never_executes(tmp_path):
    marker = tmp_path / "injected"
    services = f"mira-hub $(touch {marker})"

    result, ssh_call, _ = _run_deploy_boundary(tmp_path, services=services)

    assert result.returncode != 0
    assert not ssh_call.exists()
    assert not marker.exists()


def test_resolver_fetch_and_execution_paths_cannot_diverge():
    script = _deploy_script()
    _assert_resolver_object_contract(script)

    mutations = (
        script.replace(
            "bash /tmp/resolve_release_tag.sh)",
            "bash .github/scripts/resolve_release_tag.sh)",
            1,
        ),
        script.replace(
            'git show "${DEPLOY_SHA}:.github/scripts/resolve_release_tag.sh"',
            'git show "origin/main:.github/scripts/resolve_release_tag.sh"',
            1,
        ),
    )
    for mutated in mutations:
        with pytest.raises(AssertionError):
            _assert_resolver_object_contract(mutated)


def test_deploy_workflow_fails_closed_on_missing_sha_or_script():
    text = DEPLOY_YML.read_text()
    assert "not present after fetch" in text, "missing DEPLOY_SHA must fail closed"
    assert "failing closed" in text, "missing resolver script must fail closed"
