"""Contract for the head-bound `Cheap Review` check-run (SDLC v1 Part B step 6, §4.2).

Covers `tools/cheap_review_check.py` (envelope parsing + reconciliation),
the envelope's agreement with what `tools/gate7_review.py` actually renders, and
`.github/workflows/cheap-review-check.yml` — whose decide/post steps are EXECUTED
here against a fake `gh`, not just read. Codex review of #4221 drove the
reconciliation rule: F1 (a replayed or late older review must not post over a newer
verdict), F2 (a `--paths` PASS must not become a whole-head PASS) and F4 (a newer
scoped PASS must not hide an earlier failure).
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
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
RUN_2 = "a77509048abf4dd5b2b3bffa7478994f"
OWNER = "Mikecranesync"
SCOPE_FULL = "scope: full\n"
SCOPE_PARTIAL = "scope: partial\nexcluded_files: 3\n"


def envelope(
    verdict: str = "PASS",
    head: str = HEAD,
    extra: str = "",
    run_id: str = RUN_ID,
    scope: str = SCOPE_FULL,
    tail: str = "# Gate 7\n",
) -> str:
    """The exact shape gate7_review.py posts (see test_envelope_matches_gate7_renderer)."""
    return (
        "[CHEAP-REVIEW]\n\n```\n"
        f"head: {head}\nverdict: {verdict}\n{extra}model: gpt-6-luna\n"
        f"cost_usd: 0.0034\nrun_id: {run_id}\n{scope}```\n\n" + tail
    )


def comment(cid: int, body: str, login: str = OWNER, typ: str = "User") -> dict:
    return {
        "id": cid,
        "html_url": f"https://github.com/Mikecranesync/MIRA/pull/1#issuecomment-{cid}",
        "user": {"login": login, "type": typ},
        "body": body,
    }


def check(cid: int, run_id: str, conclusion: str) -> dict:
    return {"id": cid, "external_id": run_id, "conclusion": conclusion}


def decide(
    body: str,
    *,
    cid: int = 10,
    comments: list | None = None,
    existing: tuple = (),
    login: str = OWNER,
    typ: str = "User",
    current: str = HEAD,
):
    live = comments if comments is not None else [comment(cid, body, login, typ)]
    return crc.decide(
        body=body,
        author_login=login,
        author_type=typ,
        owner=OWNER,
        current_head=current,
        comments=live,
        existing_checks=list(existing),
    )


# ── the envelope ─────────────────────────────────────────────────────────────


def test_envelope_matches_gate7_renderer():
    """The parser keys on gate7_review.py's literal rendering; a change there must fail here."""
    src = GATE7.read_text(encoding="utf-8")
    assert '"[CHEAP-REVIEW]\\n\\n```\\n"' in src
    assert 'f"head: {head_sha}\\n{verdict_line}model: {model}\\n"' in src
    assert 'f"cost_usd: {cost:.4f}\\nrun_id: {run_id}\\n{scope_line}```\\n\\n" + report' in src
    assert '"scope: full\\n"' in src
    assert 'f"scope: partial\\nexcluded_files: {len(excluded)}\\n"' in src
    assert 'verdict_line = f"verdict: {review.verdict}\\n"' in src
    assert 'f"verdict: STALE\\nreviewed_verdict: {review.verdict}\\n"' in src
    assert "run_id = uuid.uuid4().hex" in src  # 32 lowercase hex


def test_parses_a_full_scope_pass_envelope():
    assert crc.parse_envelope(envelope()) == {
        "head": HEAD,
        "verdict": "PASS",
        "model": "gpt-6-luna",
        "cost_usd": "0.0034",
        "run_id": RUN_ID,
        "scope": "full",
    }


def test_parses_the_partial_and_stale_shapes():
    env = crc.parse_envelope(envelope(scope=SCOPE_PARTIAL))
    assert env is not None and env["scope"] == "partial" and env["excluded_files"] == "3"
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
        envelope(scope=""),  # pre-scope envelope: no claim about coverage
        envelope(scope="scope: whole\n"),
        envelope(scope="scope: partial\n"),  # partial without a count
        envelope(scope="scope: partial\nexcluded_files: 0\n"),
        envelope(scope="scope: full\nexcluded_files: 2\n"),
    ],
)
def test_malformed_envelopes_are_rejected(body):
    assert crc.parse_envelope(body) is None
    assert decide(body).post is False


# ── owner, head ──────────────────────────────────────────────────────────────


def test_owner_full_pass_on_current_head_posts_success():
    d = decide(envelope("PASS"))
    assert d.post is True
    p = d.payload
    assert p["name"] == "Cheap Review"
    assert p["head_sha"] == HEAD
    assert p["status"] == "completed"
    assert p["conclusion"] == "success"
    assert p["external_id"] == RUN_ID
    assert p["details_url"].startswith("https://github.com/")
    assert "verdict: PASS" in p["output"]["summary"] and "scope: full" in p["output"]["summary"]
    assert p["output"]["title"] == f"Cheap review PASS at {HEAD[:12]}"


@pytest.mark.parametrize("verdict", ["BLOCK", "UNKNOWN", "STALE", "ERROR", "SKIPPED", "NEUTRAL"])
def test_every_non_pass_verdict_is_a_failure(verdict):
    """neutral/skipped count as PASSING in branch protection — never emit them."""
    d = decide(envelope(verdict))
    assert d.post is True
    assert d.payload["conclusion"] == "failure"


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
        body=envelope(),
        author_login="",
        author_type="User",
        owner="",
        current_head=HEAD,
        comments=[comment(1, envelope(), login="")],
        existing_checks=[],
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
    c = comment(1, envelope())
    c["html_url"] = "https://evil.example/x"
    d = decide(envelope(), cid=1, comments=[c])
    assert d.post is True and "details_url" not in d.payload


# ── reconciliation from live evidence (Codex F1 / F2 / F4 on #4221) ─────────

PASS_1 = envelope("PASS", run_id=RUN_ID)
BLOCK_2 = envelope("BLOCK", run_id=RUN_2)
LIVE = [comment(1, PASS_1), comment(2, BLOCK_2)]
RUN_3 = "c0ffee00c0ffee00c0ffee00c0ffee00"
RUN_4 = "d00dfeedd00dfeedd00dfeedd00dfeed"


def test_replaying_an_older_pass_after_a_newer_block_posts_nothing():
    """F1: PASS(c1), BLOCK(c2), then c1 replayed -> no new success."""
    first = decide(PASS_1, cid=1, comments=[comment(1, PASS_1)])
    assert first.payload["conclusion"] == "success"
    second = decide(BLOCK_2, cid=2, comments=LIVE, existing=(check(101, RUN_ID, "success"),))
    assert second.payload["conclusion"] == "failure" and second.payload["external_id"] == RUN_2
    shown = (check(101, RUN_ID, "success"), check(102, RUN_2, "failure"))
    replay = decide(PASS_1, cid=1, comments=LIVE, existing=shown)
    assert replay.post is False and "already shows failure" in replay.reason


def test_events_processed_out_of_order_leave_the_newest_verdict():
    """F1: c2 is processed first; the late c1 event must not post over it."""
    assert decide(BLOCK_2, cid=2, comments=LIVE).payload["conclusion"] == "failure"
    late = decide(PASS_1, cid=1, comments=LIVE, existing=(check(101, RUN_2, "failure"),))
    assert late.post is False


def test_an_unchanged_state_is_a_no_op():
    d = decide(BLOCK_2, cid=2, comments=LIVE, existing=(check(101, RUN_2, "failure"),))
    assert d.post is False and "already shows" in d.reason


def test_a_stale_latest_check_is_corrected_even_if_its_run_was_posted_before():
    """The newest check shows success from a since-deleted review; the live state is failure."""
    shown = (check(101, RUN_2, "failure"), check(102, RUN_3, "success"))
    d = decide(BLOCK_2, cid=2, comments=LIVE, existing=shown)
    assert d.post is True and d.payload["conclusion"] == "failure"


def test_newer_reviews_of_another_head_or_by_others_do_not_count():
    live = [
        comment(1, PASS_1),
        comment(2, envelope("BLOCK", head=OTHER, run_id=RUN_2)),  # another head
        comment(3, envelope("BLOCK", run_id=RUN_3), login="mallory"),  # not the owner
        comment(4, "LGTM"),  # not an envelope
    ]
    assert decide(PASS_1, cid=1, comments=live).payload["conclusion"] == "success"


def test_a_deleted_trigger_still_reconciles_from_the_remaining_evidence():
    d = decide(PASS_1, cid=1, comments=[comment(2, BLOCK_2)])
    assert d.post is True and d.payload["conclusion"] == "failure"
    assert d.payload["external_id"] == RUN_2


def _decide_with_trigger(body: str, cid: int, live: list, existing: tuple = ()):
    return crc.decide(
        body=body,
        author_login=OWNER,
        author_type="User",
        owner=OWNER,
        current_head=HEAD,
        comments=live,
        existing_checks=list(existing),
        trigger_id=cid,
        trigger_url=f"https://github.com/Mikecranesync/MIRA/pull/1#issuecomment-{cid}",
    )


def test_a_lagging_comment_list_cannot_hide_a_failing_trigger():
    """The list does not show the BLOCK yet; the trigger itself is counted (fail closed)."""
    d = _decide_with_trigger(BLOCK_2, 2, [comment(1, PASS_1)], (check(101, RUN_ID, "success"),))
    assert (
        d.post is True
        and d.payload["conclusion"] == "failure"
        and d.payload["external_id"] == RUN_2
    )


def test_a_missing_pass_trigger_is_never_resurrected():
    """A PASS absent from the list may have been deleted; only live evidence counts."""
    d = _decide_with_trigger(envelope("PASS", run_id=RUN_3), 3, [comment(2, BLOCK_2)])
    assert (
        d.post is True
        and d.payload["conclusion"] == "failure"
        and d.payload["external_id"] == RUN_2
    )


def test_a_deleted_certifying_pass_withdraws_the_stale_success():
    """Only a scoped PASS is live, yet the check still shows success: fail closed."""
    scoped = envelope("PASS", scope=SCOPE_PARTIAL, run_id=RUN_3)
    live = [comment(3, scoped)]
    d = decide(scoped, cid=3, comments=live, existing=(check(101, RUN_ID, "success"),))
    assert d.post is True and d.payload["conclusion"] == "failure"
    assert d.payload["external_id"] == "uncertified"
    after = (check(101, RUN_ID, "success"), check(102, "uncertified", "failure"))
    assert decide(scoped, cid=3, comments=live, existing=after).post is False
    assert decide(scoped, cid=3, comments=live).post is False  # nothing shown: nothing to withdraw


def test_a_newer_full_pass_clears_earlier_failures():
    live = [comment(1, BLOCK_2), comment(2, envelope("PASS", run_id=RUN_3))]
    d = decide(live[1]["body"], cid=2, comments=live, existing=(check(101, RUN_2, "failure"),))
    assert d.payload["conclusion"] == "success" and d.payload["external_id"] == RUN_3


def test_a_scoped_pass_alone_never_becomes_a_whole_head_success():
    """F2."""
    d = decide(envelope("PASS", scope=SCOPE_PARTIAL))
    assert d.post is False and "scoped PASS certifies nothing" in d.reason


def test_a_scoped_block_still_fails_the_head():
    d = decide(envelope("BLOCK", scope=SCOPE_PARTIAL))
    assert d.post is True and d.payload["conclusion"] == "failure"
    assert "excluded_files: 3" in d.payload["output"]["summary"]


def test_a_passing_scope_cannot_erase_a_failing_scope_on_the_same_head():
    block_scope = envelope("BLOCK", scope=SCOPE_PARTIAL, run_id=RUN_ID)
    pass_scope = envelope("PASS", scope=SCOPE_PARTIAL, run_id=RUN_2)
    live = [comment(1, block_scope), comment(2, pass_scope)]
    assert decide(block_scope, cid=1, comments=live[:1]).payload["conclusion"] == "failure"
    d = decide(pass_scope, cid=2, comments=live, existing=(check(101, RUN_ID, "failure"),))
    assert d.post is False


FULL_PASS = envelope("PASS", run_id=RUN_ID)
SCOPED_BLOCK = envelope("BLOCK", scope=SCOPE_PARTIAL, run_id=RUN_3)
SCOPED_PASS = envelope("PASS", scope=SCOPE_PARTIAL, run_id=RUN_4)
F4_LIVE = [comment(1, FULL_PASS), comment(2, SCOPED_BLOCK), comment(3, SCOPED_PASS)]
F4_SHOWN = (check(101, RUN_ID, "success"),)


@pytest.mark.parametrize("first", [2, 3])
def test_a_newer_scoped_pass_never_hides_an_unprocessed_block(first):
    """F4 (Codex it.2): full PASS already shows success; scoped BLOCK c2 and scoped
    PASS c3 land before either is processed. In EITHER event order the head ends at
    failure, and replays of every event are no-ops once it shows."""
    by_id = {c["id"]: c for c in F4_LIVE}
    d = decide(by_id[first]["body"], cid=first, comments=F4_LIVE, existing=F4_SHOWN)
    assert d.post is True and d.payload["conclusion"] == "failure"
    assert d.payload["external_id"] == RUN_3
    shown = F4_SHOWN + (check(102, RUN_3, "failure"),)
    for cid in (1, 2, 3):
        again = decide(by_id[cid]["body"], cid=cid, comments=F4_LIVE, existing=shown)
        assert again.post is False, cid


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


def test_job_filters_on_owner_pr_comments_with_the_marker():
    cond = _wf()["jobs"]["post"]["if"]
    assert "github.event.issue.pull_request" in cond
    assert "startsWith(github.event.comment.body, '[CHEAP-REVIEW]')" in cond
    # a non-owner marker comment must not even start a runner (free-cascade finding on #4221)
    assert "github.event.comment.user.login == github.repository_owner" in cond
    assert "github.event.comment.user.type == 'User'" in cond


def test_trusted_checkout_and_no_comment_interpolation():
    job = _wf()["jobs"]["post"]
    checkout = job["steps"][0]
    assert checkout["uses"].startswith("actions/checkout@")
    assert len(checkout["uses"].split("@")[1].split()[0]) == 40
    assert checkout["with"] == {"ref": "${{ github.sha }}", "persist-credentials": False}
    for step in job["steps"]:
        run = step.get("run", "")
        assert "github.event.comment" not in run, "comment text must never reach a shell line"
        assert "${{" not in run, "expressions go through env:, never inline into run:"
    decide_run = job["steps"][1]["run"]
    assert "python3 -I tools/cheap_review_check.py decide" in decide_run
    assert '--paginate "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments"' in decide_run
    assert "check_name=Cheap%20Review&filter=all" in decide_run
    assert job["steps"][2]["if"] == "steps.decide.outputs.post == 'true'"


FAKE_GH = r"""#!/usr/bin/env python3
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ["FAKE_GH_LOG"], "a") as fh:
    fh.write(json.dumps(args) + "\n")
fx = json.load(open(os.environ["FAKE_GH_FIXTURES"]))

def emit(data):
    if "--jq" in args:
        # gh --jq prints strings raw and everything else as compact JSON, one per line
        r = subprocess.run(["jq", "-c", args[args.index("--jq") + 1]], input=json.dumps(data),
                           capture_output=True, text=True)
        lines = [json.loads(x) if x.startswith('"') else x for x in r.stdout.splitlines()]
        sys.stdout.write("".join(x + "\n" for x in lines)); sys.exit(r.returncode)
    sys.stdout.write(json.dumps(data)); sys.exit(0)

if "--method" in args:
    print("https://github.com/x/y/runs/1"); sys.exit(0)
path = next(a for a in args[1:] if a.startswith("repos/"))
if "/issues/" in path:
    emit(fx["comments"])
if "/check-runs" in path:
    emit({"check_runs": fx["existing"]})
if "/pulls/" in path:
    emit({"head": {"sha": fx["head"]}})
sys.exit(1)
"""

needs_jq = pytest.mark.skipif(shutil.which("jq") is None, reason="jq is required")


def _run_steps(tmp_path: Path, trigger: dict, *, head: str, live: list, existing: tuple = ()):
    job = _wf()["jobs"]["post"]
    bindir = tmp_path / "bin"
    bindir.mkdir()
    gh = bindir / "gh"
    gh.write_text(FAKE_GH, encoding="utf-8")
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
    fx = tmp_path / "fx.json"
    fx.write_text(json.dumps({"comments": live, "existing": list(existing), "head": head}))
    event = tmp_path / "event.json"
    url = "https://github.com/Mikecranesync/MIRA/pull/9#issuecomment-1"
    event.write_text(json.dumps({"comment": {**trigger, "html_url": url}}), encoding="utf-8")
    out = tmp_path / "gh_output"
    out.write_text("", encoding="utf-8")
    runner_temp = tmp_path / "rt"
    runner_temp.mkdir()
    env = {
        **os.environ,
        "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_GH_LOG": str(tmp_path / "gh.log"),
        "FAKE_GH_FIXTURES": str(fx),
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
    calls = [json.loads(x) for x in (tmp_path / "gh.log").read_text().splitlines()]
    return outputs, runner_temp / "check-run.json", calls


@needs_jq
def test_workflow_steps_post_a_success_for_the_newest_full_pass(tmp_path):
    c = comment(10, PASS_1)
    outputs, payload_path, calls = _run_steps(tmp_path, c, head=HEAD, live=[c])
    assert "post=true" in outputs
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    assert payload["head_sha"] == HEAD and payload["conclusion"] == "success"
    assert any("--paginate" in call and any("/comments" in a for a in call) for call in calls)
    assert any(
        "--method" in call and "repos/Mikecranesync/MIRA/check-runs" in call for call in calls
    )


@needs_jq
def test_workflow_steps_skip_a_replayed_older_review(tmp_path):
    c1, c2 = comment(1, PASS_1), comment(2, BLOCK_2)
    shown = (check(101, RUN_ID, "success"), check(102, RUN_2, "failure"))
    outputs, payload_path, calls = _run_steps(
        tmp_path, c1, head=HEAD, live=[c1, c2], existing=shown
    )
    assert "post=false" in outputs and not payload_path.exists()
    assert not any("--method" in call for call in calls)


@needs_jq
def test_workflow_steps_skip_a_rerun_of_an_already_posted_review(tmp_path):
    c = comment(10, PASS_1)
    outputs, payload_path, _ = _run_steps(
        tmp_path, c, head=HEAD, live=[c], existing=(check(101, RUN_ID, "success"),)
    )
    assert "post=false" in outputs and not payload_path.exists()


@needs_jq
def test_workflow_steps_reconcile_the_f4_sequence_to_failure(tmp_path):
    outputs, payload_path, _ = _run_steps(
        tmp_path, F4_LIVE[2], head=HEAD, live=F4_LIVE, existing=F4_SHOWN
    )
    assert "post=true" in outputs
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    assert payload["conclusion"] == "failure" and payload["external_id"] == RUN_3


@needs_jq
def test_workflow_steps_post_nothing_for_a_superseded_head(tmp_path):
    c = comment(10, PASS_1)
    outputs, payload_path, _ = _run_steps(tmp_path, c, head=OTHER, live=[c])
    assert "post=false" in outputs and not payload_path.exists()


@needs_jq
def test_workflow_steps_post_nothing_for_a_non_owner(tmp_path):
    c = comment(10, PASS_1, login="mallory")
    outputs, payload_path, _ = _run_steps(tmp_path, c, head=HEAD, live=[c])
    assert "post=false" in outputs and not payload_path.exists()


def test_workflow_steps_fail_closed_on_a_non_numeric_pr(tmp_path):
    job = _wf()["jobs"]["post"]
    env = {**os.environ, "PR_NUMBER": "9; echo pwned", "GITHUB_OUTPUT": str(tmp_path / "o")}
    r = subprocess.run(
        ["bash", "-c", job["steps"][1]["run"]], cwd=REPO, env=env, capture_output=True, text=True
    )
    assert r.returncode != 0 and "pwned" not in r.stdout
