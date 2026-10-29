"""Refusal contract for the isolated safety-build route (#4372, Mike decision 4).

The host script ``tools/isolated-route/isolated-route.sh`` is the mechanism; the
workflow ``.github/workflows/isolated-route.yml`` is a thin wrapper. Both must
refuse anything that is not an explicitly approved, non-main ``stg-combined/*``
tip. The script runs against a real local bare git remote and a fake ``docker``
/ ``curl`` on PATH, so every refusal is proven to fire before any docker call
that could mutate the host, and the accepted control proves the refusals are
not hardcoded.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parent.parent
_SCRIPT = _ROOT / "tools" / "isolated-route" / "isolated-route.sh"
_WORKFLOW = _ROOT / ".github" / "workflows" / "isolated-route.yml"

_FAKE_DOCKER = r"""#!/bin/sh
echo "docker $*" >> "$FAKE_LOG"
case "$1" in
  ps)
    case "$*" in
      *"--filter"*) ;;
      *"-aq"*) [ -n "$FAKE_OTHER_ID" ] && echo "$FAKE_OTHER_ID" ;;
      *"{{.Ports}}"*) [ -n "$FAKE_PORT_HOLDER" ] && echo "$FAKE_PORT_HOLDER" ;;
    esac ;;
  inspect)
    case "$*" in
      *"{{.Image}}"*) echo "sha256:fake" ;;
      *)
        n=$(cat "$FAKE_COUNTER" 2>/dev/null || echo 0)
        echo $((n + 1)) > "$FAKE_COUNTER"
        if [ -n "$FAKE_RESTARTING" ]; then echo "id1 /prod mira-saas c t$n"; else echo "id1 /prod mira-saas c t0"; fi ;;
    esac ;;
  image)
    case "$*" in *"{{.Id}}"*) echo "sha256:fake" ;; esac ;;
  run) cat > /dev/null ;;
esac
exit 0
"""

_FAKE_CURL = """#!/bin/sh
printf '{"gitSha":"%s"}' "$FAKE_SERVED_SHA"
"""


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"},
    ).stdout.strip()


@pytest.fixture(scope="module")
def remote(tmp_path_factory) -> dict:
    """A bare remote: main=M; stg-combined/t = C1 -> C2 (tip); other branch = P."""
    work = tmp_path_factory.mktemp("work")
    _git(work, "init", "-q", "-b", "main")
    (work / "f").write_text("m")
    _git(work, "add", "f")
    _git(work, "commit", "-qm", "main")
    m = _git(work, "rev-parse", "HEAD")
    _git(work, "checkout", "-qb", "stg-combined/t")
    for i in (1, 2):
        (work / "f").write_text(f"c{i}")
        _git(work, "commit", "-qam", f"c{i}")
    c2 = _git(work, "rev-parse", "HEAD")
    c1 = _git(work, "rev-parse", "HEAD~1")
    _git(work, "checkout", "-qb", "stg-combined/flag", c2)
    (work / "mira-hub" / "src").mkdir(parents=True)
    (work / "mira-hub" / "src" / "floors.ts").write_text('process.env.NOTEBOOK_SAFETY_FLOORS_MODE === "shadow";\n')
    (work / "mira-hub" / "scripts").mkdir()
    (work / "mira-hub" / "scripts" / "setup-integration-db.mjs").write_text("// fixture\n")
    (work / "mira-hub" / "db").mkdir()
    (work / "mira-hub" / "db" / "001.sql").write_text("-- fixture\n")
    _git(work, "add", "mira-hub")
    _git(work, "commit", "-qm", "flag")
    flag = _git(work, "rev-parse", "HEAD")
    _git(work, "checkout", "-qb", "bravo/pr", m)
    (work / "f").write_text("p")
    _git(work, "commit", "-qam", "p")
    p = _git(work, "rev-parse", "HEAD")
    bare = tmp_path_factory.mktemp("remote") / "r.git"
    _git(work, "clone", "-q", "--bare", str(work), str(bare))
    return {"url": str(bare), "main": m, "tip": c2, "not_tip": c1, "pr": p, "flag": flag}


def _run(tmp_path: Path, remote: dict, *args: str, **env_over: str) -> subprocess.CompletedProcess[str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, body in (("docker", _FAKE_DOCKER), ("curl", _FAKE_CURL)):
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("MIRA_ISO_", "FAKE_"))}
    env.update(
        PATH=f"{bin_dir}{os.pathsep}{env['PATH']}",
        MIRA_ISO_REMOTE=remote["url"],
        MIRA_ISO_ROOT=str(tmp_path / "mira-iso"),
        MIRA_ISO_APPROVED_SHA=remote["tip"],
        FAKE_LOG=str(tmp_path / "docker.log"),
        FAKE_COUNTER=str(tmp_path / "counter"),
        FAKE_SERVED_SHA=remote["tip"],
        FAKE_OTHER_ID="id1",
        MIRA_ISO_PORT="4699",
    )
    env.update(env_over)
    for k in [k for k, v in env.items() if v == "<unset>"]:
        del env[k]
    return subprocess.run(["bash", str(_SCRIPT), *args], env=env, capture_output=True, text=True, check=False)


def _docker_calls(tmp_path: Path) -> str:
    log = tmp_path / "docker.log"
    return log.read_text() if log.exists() else ""


def _assert_refused(result, needle: str, tmp_path: Path) -> None:
    assert result.returncode != 0, result.stdout
    assert "ISO-REFUSE: " in result.stderr and needle in result.stderr, result.stderr
    calls = _docker_calls(tmp_path)
    assert " build" not in calls and " up " not in calls, calls  # no host mutation


def test_control_accepts_approved_stg_combined_tip(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"])
    assert result.returncode == 0, result.stderr
    assert f"authorized {remote['tip']} = tip of stg-combined/t, not on main" in result.stdout
    receipt = json.loads(result.stdout.split("ISOLATED_ROUTE_RECEIPT_JSON=", 1)[1].splitlines()[0])
    assert receipt["schema"] == "factorylm.isolated-route-receipt/1"
    assert receipt["not_a_staging_receipt"] is True and receipt["sha"] == remote["tip"]
    calls = _docker_calls(tmp_path)
    assert "compose -p mira-iso" in calls and " build --pull iso-mira-hub" in calls
    env_file = (tmp_path / "mira-iso" / "run.env").read_text()
    assert "NEON_DATABASE_URL" not in env_file and "OPENAI" not in env_file  # no inherited secrets


def test_refuses_shadow_on_a_build_that_does_not_read_the_flag(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], "--floors", "shadow")
    _assert_refused(result, "does not read NOTEBOOK_SAFETY_FLOORS_MODE", tmp_path)


def test_control_accepts_shadow_on_a_build_that_reads_the_flag(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["flag"], "--floors", "shadow",
                  MIRA_ISO_APPROVED_SHA=remote["flag"], FAKE_SERVED_SHA=remote["flag"])
    assert result.returncode == 0, result.stderr
    assert '"floors_mode":"shadow"' in result.stdout
    assert "ISO_FLOORS_MODE=shadow" in (tmp_path / "mira-iso" / "run.env").read_text()


@pytest.mark.parametrize("sha", ["A" * 40, "a" * 39, ""])
def test_refuses_malformed_sha(tmp_path, remote, sha):
    _assert_refused(_run(tmp_path, remote, "up", "--sha", sha), "--sha must be exactly 40", tmp_path)


@pytest.mark.parametrize("approved", ["<unset>", "b" * 40])
def test_refuses_without_matching_approval(tmp_path, remote, approved):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], MIRA_ISO_APPROVED_SHA=approved)
    _assert_refused(result, "MIRA_ISO_APPROVED_SHA must equal --sha", tmp_path)


def test_refuses_sha_on_main(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["main"], MIRA_ISO_APPROVED_SHA=remote["main"])
    _assert_refused(result, f"SHA {remote['main']} is on main", tmp_path)


@pytest.mark.parametrize(
    ("key", "needle"),
    [
        ("not_tip", "is not the tip of any stg-combined/* branch"),  # ancestor of the tip
        ("pr", "is not a fetched commit"),  # a PR head: only main + stg-combined/* are fetched
    ],
)
def test_refuses_sha_that_is_not_a_stg_combined_tip(tmp_path, remote, key, needle):
    result = _run(tmp_path, remote, "up", "--sha", remote[key], MIRA_ISO_APPROVED_SHA=remote[key])
    _assert_refused(result, needle, tmp_path)


def test_refuses_unfetchable_remote(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], MIRA_ISO_REMOTE=str(tmp_path / "nope.git"))
    _assert_refused(result, "could not fetch main + stg-combined/*", tmp_path)


@pytest.mark.parametrize(
    ("root", "needle"),
    [
        ("/opt/mira", "resolves into a production/staging/preview path"),
        ("/opt/mira-staging/mira-iso", "resolves into a production/staging/preview path"),
        ("/opt/mira-preview", "resolves into a production/staging/preview path"),
        ("RELATIVE", "must be an absolute path"),
        ("OTHER", "must end in a mira-iso* directory"),
    ],
)
def test_refuses_unsafe_root(tmp_path, remote, root, needle):
    root = {"RELATIVE": "mira-iso", "OTHER": str(tmp_path / "scratch")}.get(root, root)
    _assert_refused(_run(tmp_path, remote, "up", "--sha", remote["tip"], MIRA_ISO_ROOT=root), needle, tmp_path)


@pytest.mark.parametrize("port", ["4101", "3101", "4700", "46a1"])
def test_refuses_port_outside_reserved_band(tmp_path, remote, port):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], MIRA_ISO_PORT=port)
    _assert_refused(result, "MIRA_ISO_PORT must be in the reserved 4600-4699 band", tmp_path)


def test_refuses_port_held_by_another_project(tmp_path, remote):
    holder = "stg-thing factorylm-staging 127.0.0.1:4699->3000/tcp"
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], FAKE_PORT_HOLDER=holder)
    _assert_refused(result, "port 4699 is published by 'stg-thing'", tmp_path)


def test_refuses_non_allowlisted_llm_env_line(tmp_path, remote):
    env_file = tmp_path / "llm.env"
    env_file.write_text("ISO_GROQ_API_KEY=x\nNEON_DATABASE_URL=postgres://prod\n")
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], MIRA_ISO_LLM_ENV_FILE=str(env_file))
    assert result.returncode != 0
    assert "ISO-REFUSE: MIRA_ISO_LLM_ENV_FILE has a non-allowlisted line (NEON_DATABASE_URL)" in result.stderr


def test_stops_when_a_non_iso_container_changes(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], FAKE_RESTARTING="1")
    assert result.returncode != 0
    assert "ISO-REFUSE: non-iso containers changed during up" in result.stderr


def test_refuses_served_sha_mismatch(tmp_path, remote):
    result = _run(tmp_path, remote, "up", "--sha", remote["tip"], FAKE_SERVED_SHA=remote["main"])
    assert result.returncode != 0
    assert f"/api/version gitSha '{remote['main']}' != {remote['tip']}" in result.stderr


# ── workflow wrapper ──────────────────────────────────────────────────────────

def _workflow() -> dict:
    return yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))


def test_workflow_cannot_be_mistaken_for_staging():
    wf = _workflow()
    assert wf["name"] != "Deploy to Staging VPS"  # retrieval-acceptance.yml workflow_run name
    assert set(wf.get("on", wf.get(True))) == {"workflow_dispatch"}
    assert wf["permissions"] == {"contents": "read"}
    assert wf["concurrency"] == {"group": "staging-environment", "cancel-in-progress": False}
    authorize, run = wf["jobs"]["authorize"], wf["jobs"]["run"]
    assert "environment" not in authorize and run["needs"] == "authorize"
    steps = [st for job in wf["jobs"].values() for st in job["steps"]]
    assert not any("upload-artifact" in st.get("uses", "") for st in steps)  # no artifact at all
    assert not any("staging-receipt" in st.get("run", "") or "DEPLOY_RECEIPT" in st.get("run", "") for st in steps)


def _run_authorizer(tmp_path: Path, *, status: str = "ahead", tip: bool = True, **over: str):
    sha = "c" * 40
    script = next(s for s in _workflow()["jobs"]["authorize"]["steps"] if s["name"] == "Authorize isolated-route inputs")["run"]
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "gh").write_text(
        "#!/bin/sh\n"
        'case "$2" in\n'
        f'  "repos/Mikecranesync/MIRA/compare/main...{sha}") [ "{status}" = error ] && exit 22; echo "{status}" ;;\n'
        f'  "repos/Mikecranesync/MIRA/git/matching-refs/heads/stg-combined/") [ "{int(tip)}" = 1 ] && echo refs/heads/stg-combined/t ;;\n'
        "  *) exit 22 ;;\n"
        "esac\n"
    )
    (bin_dir / "gh").chmod(0o755)
    env = {
        **os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main",
        "GITHUB_REPOSITORY": "Mikecranesync/MIRA", "ISO_ROUTE_ENABLED": "true",
        "ACTION": "up", "SHA": sha, "FLOORS": "shadow", "APPROVAL": f"GO-ISO-{sha}",
    }
    env.update(over)
    return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, check=False)


def test_workflow_authorizer_control_accepts(tmp_path):
    result = _run_authorizer(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Authorized " + "c" * 40 in result.stdout


@pytest.mark.parametrize(
    ("kwargs", "needle"),
    [
        ({"status": "identical"}, "is on main or unverifiable"),
        ({"status": "behind"}, "is on main or unverifiable"),
        ({"status": "error"}, "compare status: api error"),
        ({"tip": False}, "not the tip of any stg-combined/* branch"),
        ({"APPROVAL": "GO"}, "approval must be exactly GO-ISO-"),
        ({"ISO_ROUTE_ENABLED": ""}, "ISO_ROUTE_ENABLED is not 'true'"),
        ({"GITHUB_REF": "refs/heads/stg-combined/t"}, "dispatch from refs/heads/main"),
        ({"SHA": "C" * 40}, "integration_sha must be 40 lowercase hex"),
    ],
)
def test_workflow_authorizer_refuses(tmp_path, kwargs, needle):
    result = _run_authorizer(tmp_path, **kwargs)
    assert result.returncode != 0, result.stdout
    assert needle in result.stdout


def _run_host_step(tmp_path: Path, remote: dict, action: str, sha: str = "", floors: str = "enforce"):
    """Execute the workflow's real ssh step with a fake ssh that runs the remote
    command locally (stdin piped), so the nested quoting is exercised end to end."""
    script = next(s for s in _workflow()["jobs"]["run"]["steps"] if s.get("name") == "Run the trusted script on the host")["run"]
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "ssh").write_text('#!/bin/bash\nfor last; do :; done\nexec bash -c "$last"\n')
    (bin_dir / "ssh").chmod(0o755)
    for name, body in (("docker", _FAKE_DOCKER), ("curl", _FAKE_CURL)):
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("MIRA_ISO_", "FAKE_"))}
    env.update(
        PATH=f"{bin_dir}{os.pathsep}{env['PATH']}", ACTION=action, SHA=sha, FLOORS=floors,
        STAGING_HOST="203.0.113.7", DEPLOY_USER="staging-deploy",
        MIRA_ISO_REMOTE=remote["url"], MIRA_ISO_ROOT=str(tmp_path / "mira-iso"), MIRA_ISO_PORT="4699",
        FAKE_LOG=str(tmp_path / "docker.log"), FAKE_COUNTER=str(tmp_path / "counter"),
        FAKE_SERVED_SHA=sha, FAKE_OTHER_ID="id1",
    )
    return subprocess.run(["bash", "-c", script], cwd=_ROOT, env=env, capture_output=True, text=True, check=False)


def test_workflow_host_step_runs_up_then_down_through_ssh(tmp_path, remote):
    up = _run_host_step(tmp_path, remote, "up", remote["flag"], "shadow")
    assert up.returncode == 0, up.stderr
    assert f'"sha":"{remote["flag"]}"' in up.stdout and '"floors_mode":"shadow"' in up.stdout
    down = _run_host_step(tmp_path, remote, "down")
    assert down.returncode == 0, down.stderr
    assert "down complete" in down.stdout and not (tmp_path / "mira-iso").exists()


def test_workflow_host_step_rejects_bad_sha_before_ssh(tmp_path, remote):
    result = _run_host_step(tmp_path, remote, "up", "x; touch /tmp/pwned", "enforce")
    assert result.returncode != 0 and "bad integration_sha" in result.stdout
    assert not (tmp_path / "docker.log").exists()
