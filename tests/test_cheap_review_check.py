"""Contract for the head-bound `Cheap Review` check-run (SDLC v1 Part B step 6, §4.2).

Covers `tools/cheap_review_check.py` (envelope parsing + the three posting rules),
the envelope's agreement with what `tools/gate7_review.py` actually renders, and
`.github/workflows/cheap-review-check.yml` — whose decide/post steps are EXECUTED
here against a fake `gh`, not just read.
"""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "cheap_review_check.py"
WORKFLOW = REPO / ".github" / "workflows" / "cheap-review-check.yml"
GATE7 = REPO / "tools" / "gate7_review.py"

_spec = importlib.util.spec_from_file_location("cheap_review_check", TOOL)
assert _spec is not None and _spec.loader is not None
crc = importlib.util.module_from_spec(_spec)
sys.modules["cheap_review_check"] = crc
_spec.loader.exec_module(crc)

HEAD = "9fe5da7c4e90c05bb2c51e8a23379d07333bf17c"
OTHER = "144cd1e11cf7ee17f74d2a38d680335e8e550411"
RUN_ID = "8ed86bb9839547e69007cecad1537a36"
OWNER = "Mikecranesync"


def envelope(
    verdict: str = "PASS", head: str = HEAD, extra: str = "", tail: str = "# Gate 7\n"
) -> str:
    """The exact shape gate7_review.py posts (see test_envelope_matches_gate7_renderer)."""
    return (
        "[CHEAP-REVIEW]\n\n```\n"
        f"head: {head}\nverdict: {verdict}\n{extra}model: gpt-6-luna\n"
        f"cost_usd: 0.0034\nrun_id: {RUN_ID}\n```\n\n" + tail
    )


def decide(body: str, *, login: str = OWNER, typ: str = "User", current: str = HEAD):
    return crc.decide(
        body=body,
        author_login=login,
        author_type=typ,
        owner=OWNER,
        current_head=current,
        comment_url="https://github.com/Mikecranesync/MIRA/pull/1#issuecomment-1",
    )


# ── the envelope ─────────────────────────────────────────────────────────────


def test_envelope_matches_gate7_renderer():
    """The parser keys on gate7_review.py's literal rendering; a change there must fail here."""
    src = GATE7.read_text(encoding="utf-8")
    assert '"[CHEAP-REVIEW]\\n\\n```\\n"' in src
    assert 'f"head: {head_sha}\\n{verdict_line}model: {model}\\n"' in src
    assert 'f"cost_usd: {cost:.4f}\\nrun_id: {run_id}\\n```\\n\\n" + report' in src
    assert 'verdict_line = f"verdict: {review.verdict}\\n"' in src
    assert 'f"verdict: STALE\\nreviewed_verdict: {review.verdict}\\n"' in src
    assert "run_id = uuid.uuid4().hex" in src  # 32 lowercase hex


def test_parses_a_pass_envelope():
    env = crc.parse_envelope(envelope())
    assert env == {
        "head": HEAD,
        "verdict": "PASS",
        "model": "gpt-6-luna",
        "cost_usd": "0.0034",
        "run_id": RUN_ID,
    }


def test_parses_the_stale_shape():
    env = crc.parse_envelope(
        envelope("STALE", extra=f"reviewed_verdict: PASS\ncurrent_head: {OTHER}\n")
    )
    assert env is not None
    assert env["verdict"] == "STALE" and env["reviewed_verdict"] == "PASS"


@pytest.mark.parametrize(
    "body",
    [
        None,
        42,
        "",
        "LGTM",
        " " + envelope(),  # marker must be the very first thing
        "quote:\n" + envelope(),
        envelope().replace("[CHEAP-REVIEW]", "[CHEAP-REVIEW] "),
        envelope(head=HEAD[:39]),
        envelope(head=HEAD.upper()),
        envelope("pass"),
        envelope("PASS!"),
        envelope().replace(f"run_id: {RUN_ID}", "run_id: abc"),
        envelope().replace("cost_usd: 0.0034", "cost_usd: free"),
        envelope().replace("model: gpt-6-luna\n", ""),
        envelope(extra=f"head: {OTHER}\n"),  # duplicate key
        envelope(extra="not a field line\n"),
        envelope().replace("```\n\n# Gate", "\n\n# Gate"),  # unterminated fence
    ],
)
def test_malformed_envelopes_are_rejected(body):
    assert crc.parse_envelope(body) is None
    d = crc.decide(
        body=body, author_login=OWNER, author_type="User", owner=OWNER, current_head=HEAD
    )
    assert d.post is False


# ── the three rules ──────────────────────────────────────────────────────────


def test_owner_pass_on_current_head_posts_success():
    d = decide(envelope("PASS"))
    assert d.post is True
    p = d.payload
    assert p["name"] == "Cheap Review"
    assert p["head_sha"] == HEAD
    assert p["status"] == "completed"
    assert p["conclusion"] == "success"
    assert p["external_id"] == RUN_ID
    assert p["details_url"].startswith("https://github.com/")
    assert "verdict: PASS" in p["output"]["summary"]
    assert p["output"]["title"] == f"Cheap review PASS at {HEAD[:12]}"


@pytest.mark.parametrize("verdict", ["BLOCK", "UNKNOWN", "STALE", "ERROR", "SKIPPED", "NEUTRAL"])
def test_every_non_pass_verdict_is_a_failure(verdict):
    """neutral/skipped count as PASSING in branch protection — never emit them."""
    d = decide(envelope(verdict))
    assert d.post is True
    assert d.payload["conclusion"] == "failure"
    assert d.payload["conclusion"] not in ("neutral", "skipped", "success")


@pytest.mark.parametrize(
    "login,typ",
    [
        ("someone-else", "User"),
        ("github-actions[bot]", "Bot"),
        (OWNER, "Bot"),
        (OWNER, "Organization"),
        (None, "User"),
        (OWNER.lower(), "User"),
    ],
)
def test_only_the_owner_account_as_a_user_is_trusted(login, typ):
    d = decide(envelope("PASS"), login=login, typ=typ)
    assert d.post is False
    assert "owner" in d.reason


def test_an_empty_owner_trusts_nobody():
    d = crc.decide(
        body=envelope(), author_login="", author_type="User", owner="", current_head=HEAD
    )
    assert d.post is False


def test_a_superseded_head_posts_nothing():
    d = decide(envelope("PASS"), current=OTHER)
    assert d.post is False
    assert "no longer the pull request head" in d.reason


@pytest.mark.parametrize("current", ["", "unknown", HEAD[:12], HEAD.upper()])
def test_an_unreadable_current_head_posts_nothing(current):
    assert decide(envelope("PASS"), current=current).post is False


def test_a_non_github_details_url_is_dropped():
    d = crc.decide(
        body=envelope(),
        author_login=OWNER,
        author_type="User",
        owner=OWNER,
        current_head=HEAD,
        comment_url="https://evil.example/x",
    )
    assert d.post is True and "details_url" not in d.payload


# ── the workflow file ────────────────────────────────────────────────────────


def _wf() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_trigger_is_issue_comment_created_only():
    on = _wf()[True]  # YAML 1.1 reads the bare key `on` as True
    assert on == {"issue_comment": {"types": ["created"]}}
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "pull_request_target" not in text and "workflow_run" not in text


def test_permissions_are_minimal():
    wf = _wf()
    assert wf["permissions"] == {}
    job = wf["jobs"]["post"]
    assert job["permissions"] == {"checks": "write", "contents": "read", "pull-requests": "read"}
    assert set(wf["jobs"]) == {"post"}


def test_job_filters_on_pr_comments_with_the_marker():
    cond = _wf()["jobs"]["post"]["if"]
    assert "github.event.issue.pull_request" in cond
    assert "startsWith(github.event.comment.body, '[CHEAP-REVIEW]')" in cond


def test_trusted_checkout_and_no_comment_interpolation():
    job = _wf()["jobs"]["post"]
    checkout = job["steps"][0]
    assert (
        checkout["uses"].startswith("actions/checkout@")
        and len(checkout["uses"].split("@")[1].split()[0]) == 40
    )
    assert checkout["with"] == {"ref": "${{ github.sha }}", "persist-credentials": False}
    for step in job["steps"]:
        run = step.get("run", "")
        assert "github.event.comment" not in run, "comment text must never reach a shell line"
        assert "${{" not in run, "expressions go through env:, never inline into run:"
    decide_run = job["steps"][1]["run"]
    assert "python3 -I tools/cheap_review_check.py decide" in decide_run
    assert job["steps"][2]["if"] == "steps.decide.outputs.post == 'true'"


def _write_fake_gh(bindir: Path, head: str, log: Path) -> None:
    gh = bindir / "gh"
    gh.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$*" >> "{log}"\n'
        'case "$*" in\n'
        f'  *"--method POST"*) echo "https://github.com/x/y/runs/1" ;;\n'
        f'  *pulls/*) echo "{head}" ;;\n'
        "esac\n",
        encoding="utf-8",
    )
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)


def _run_steps(
    tmp_path: Path, body: str, current_head: str, login: str = OWNER
) -> tuple[str, Path, Path]:
    job = _wf()["jobs"]["post"]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "gh.log"
    _write_fake_gh(bindir, current_head, log)
    event = tmp_path / "event.json"
    event.write_text(
        json.dumps(
            {
                "comment": {
                    "body": body,
                    "user": {"login": login, "type": "User"},
                    "html_url": "https://github.com/Mikecranesync/MIRA/pull/9#issuecomment-1",
                }
            }
        ),
        encoding="utf-8",
    )
    out = tmp_path / "gh_output"
    out.write_text("", encoding="utf-8")
    runner_temp = tmp_path / "rt"
    runner_temp.mkdir()
    env = {
        **os.environ,
        "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}",
        "GH_TOKEN": "x",
        "PR_NUMBER": "9",
        "OWNER": OWNER,
        "GITHUB_REPOSITORY": "Mikecranesync/MIRA",
        "GITHUB_EVENT_PATH": str(event),
        "GITHUB_OUTPUT": str(out),
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary"),
        "RUNNER_TEMP": str(runner_temp),
    }
    subprocess.run(["bash", "-c", job["steps"][1]["run"]], cwd=REPO, env=env, check=True)
    outputs = out.read_text(encoding="utf-8")
    if "post=true" in outputs:
        subprocess.run(["bash", "-c", job["steps"][2]["run"]], cwd=REPO, env=env, check=True)
    return outputs, runner_temp / "check-run.json", log


def test_workflow_steps_post_a_success_for_a_current_pass(tmp_path):
    outputs, payload_path, log = _run_steps(tmp_path, envelope("PASS"), HEAD)
    assert "post=true" in outputs
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    assert payload["head_sha"] == HEAD and payload["conclusion"] == "success"
    calls = log.read_text(encoding="utf-8")
    assert "repos/Mikecranesync/MIRA/pulls/9" in calls
    assert "--method POST repos/Mikecranesync/MIRA/check-runs --input" in calls


def test_workflow_steps_post_nothing_for_a_superseded_head(tmp_path):
    outputs, payload_path, log = _run_steps(tmp_path, envelope("PASS"), OTHER)
    assert "post=false" in outputs
    assert not payload_path.exists()
    assert "check-runs" not in log.read_text(encoding="utf-8")


def test_workflow_steps_post_nothing_for_a_non_owner(tmp_path):
    outputs, payload_path, _ = _run_steps(tmp_path, envelope("PASS"), HEAD, login="mallory")
    assert "post=false" in outputs and not payload_path.exists()


def test_workflow_steps_fail_closed_on_a_non_numeric_pr(tmp_path):
    job = _wf()["jobs"]["post"]
    env = {**os.environ, "PR_NUMBER": "9; echo pwned", "GITHUB_OUTPUT": str(tmp_path / "o")}
    r = subprocess.run(
        ["bash", "-c", job["steps"][1]["run"]], cwd=REPO, env=env, capture_output=True, text=True
    )
    assert r.returncode != 0 and "pwned" not in r.stdout
