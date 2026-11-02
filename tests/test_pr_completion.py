"""Hermetic tests for tools/pr_completion.py.

Each test runs the real controller in-process against a throwaway git repo whose
base commit carries the gate scripts (the real ledger, plus stubs for the review
loop, the trusted entrypoint and the lifecycle guard). GitHub is a fake `gh` on
PATH backed by a JSON state file. Nothing touches the network, GitHub, Codex or
Claude, and every test checks that the fake `gh` log holds no merge, no
non-guard workflow run and no API write.
"""

from __future__ import annotations

import dataclasses
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CTRL_PATH = REPO_ROOT / "tools" / "pr_completion.py"
LEDGER_SRC = REPO_ROOT / "scripts" / "adversarial-review-ledger.mjs"
BASH = shutil.which("bash")
NODE = shutil.which("node")
GIT = shutil.which("git")

pytestmark = pytest.mark.skipif(
    not (BASH and NODE and GIT), reason="bash, node and git are required"
)

VIEWER = "Mikecranesync"
PR = 77
GUARD = "Legacy UI Lifecycle Guard"
REVIEW_ITEM = "review:exact-head and exact-body Codex GREEN"
GUARD_DISPATCH = [
    "workflow",
    "run",
    "ui-lifecycle-guard.yml",
    "--ref",
    "main",
    "-f",
    "pr_number=77",
]
WRITES = ("-X", "--method", "-f", "-F", "--field", "--raw-field", "--input")
HEAD_A, HEAD_B, HEAD_C, HEAD_D = ("a" * 40, "b" * 40, "c" * 40, "d" * 40)
BODY = "## Summary\n\nDocs-only change for the controller suite.\n"
BODY_OTHER = BODY + "Edited after the review.\n"
MERGE_CONFLICT_FREE = "docs/notes.md"

BETA_GATE = """name: beta-gate
on:
  pull_request:
    paths:
      - "mira-hub/**"
      - "tools/paid/*.py"
  workflow_dispatch:
"""

BETA_GATE_REORDERED = """name: beta-gate
on:
  pull_request:
    branches: [main]
    paths:
      - "mira-hub/**"
"""

LOOP_CONVERGED = "#!/usr/bin/env bash\n# Stub loop with the CONVERGED stop.\nexit 5\n"
LOOP_EXIT_50 = "#!/usr/bin/env bash\n# No converged stop; only an unrelated exit 50.\nexit 50\n"

TRUSTED_STUB = (
    "#!/usr/bin/env bash\n"
    "# Test double for the trusted review loop: the fixture plan decides each outcome.\n"
    "set -euo pipefail\n"
    'exec python3 "$PRC_FAKE_DRIVER" "$@"\n'
)

GUARD_STUB = """import sys

MISSING = __MISSING__
if MISSING:
    print("::error::INDEPENDENT REVIEW REQUIRED for this body. Missing: " + ", ".join(MISSING))
    sys.exit(1)
sys.exit(0)
"""

FAKE_GH = r"""#!/usr/bin/env python3
import json
import os
import re
import sys

WRITE_FLAGS = ("-X", "--method", "-f", "-F", "--field", "--raw-field", "--input")
GUARD = "Legacy UI Lifecycle Guard"
args = sys.argv[1:]
with open(os.environ["PRC_FAKE_LOG"], "a", encoding="utf-8") as fh:
    fh.write(json.dumps(args) + "\n")
state_path = os.environ["PRC_FAKE_STATE"]
with open(state_path, encoding="utf-8") as fh:
    st = json.load(fh)


def save():
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump(st, fh)


def refuse():
    sys.stderr.write("fake gh: unscripted call " + " ".join(args) + "\n")
    sys.exit(97)


if args[:2] == ["pr", "view"]:
    st["pr_view_calls"] += 1
    hook = st["before_pr_view"].get(str(st["pr_view_calls"]))
    if isinstance(hook, dict):
        st["pr"].update(hook)
    elif hook:
        st["pr"]["headRefOid"] = hook
    save()
    pr = st["pr"]
    print(json.dumps({
        "state": pr["state"],
        "isDraft": pr["isDraft"],
        "headRefOid": pr["headRefOid"],
        "baseRefOid": pr["baseRefOid"],
        "baseRefName": pr["baseRefName"],
        "body": pr["body"],
        "changedFiles": pr.get("changed_files_override", len(pr["files"])),
        "mergeable": pr.get("mergeable", "MERGEABLE"),
        "mergeStateStatus": pr.get("mergeStateStatus", "CLEAN"),
        "reviewDecision": pr.get("reviewDecision", ""),
    }))
elif args == ["api", "user"]:
    print(json.dumps({"login": st["viewer"]}))
elif args[:1] == ["api"] and not any(a.startswith(WRITE_FLAGS) for a in args[1:]):
    path = args[1]
    if re.fullmatch(r"repos/[^/]+/[^/]+/branches/[^/]+/protection", path):
        print(json.dumps(st["protection"]))
    elif re.fullmatch(r"repos/[^/]+/[^/]+/commits/[0-9a-f]{40}/check-runs\?per_page=100", path):
        pend = st.get("pending_dispatch")
        if pend and pend["left"] > 0:
            pend["left"] -= 1
            save()
        elif pend:
            st["pending_dispatch"] = None
            st["checks"][pend["head"]] = pend["runs"]
            save()
        runs = st["checks"].get(path.split("/")[4], st["check_default"])
        print(json.dumps({"total_count": len(runs), "check_runs": runs}))
    elif re.fullmatch(r"repos/[^/]+/[^/]+/commits/[0-9a-f]{40}/statuses\?per_page=100", path):
        sha = path.split("/")[4]
        sd = st.get("status_dispatch")
        if sd and sd["head"] == sha:
            # Like ui-lifecycle-guard.yml: after some reads a pending status, then the final one.
            sd["reads"] += 1
            if sd["reads"] == sd["delay"] + 1:
                st["statuses"].setdefault(sha, []).insert(
                    0, {"id": 8000, "context": GUARD, "state": "pending"})
            elif sd["reads"] == sd["delay"] + 2:
                st["statuses"][sha].insert(0, {"id": 8001, "context": GUARD, "state": "success"})
                st["status_dispatch"] = None
            save()
        print(json.dumps(st["statuses"].get(sha, [])))
    elif re.fullmatch(r"repos/[^/]+/[^/]+/pulls/77/files\?per_page=100", path) and args[2:] == [
        "--paginate"
    ]:
        rows = [
            {"patch": "@@ -1 +1 @@\n-old line\n+new line"}
            | (f if isinstance(f, dict) else {"filename": f})
            for f in st["pr"]["files"]
        ]
        rows = [{k: v for k, v in r.items() if v is not None} for r in rows]
        pages = [rows[i:i + 100] for i in range(0, len(rows), 100)] or [[]]
        print("".join(json.dumps(page) for page in pages))
    elif path.startswith("repos/{owner}/{repo}/issues?state=all&creator=") and args[2:] == [
        "--paginate"
    ]:
        st["issue_queries"].append(path)
        save()
        print(json.dumps(st["issues"]))
    elif re.fullmatch(r"repos/[^/]+/[^/]+/issues/[0-9]+/comments", path) and args[2:] in (
        [],
        ["--paginate"],
    ):
        print(json.dumps(st["comments"]))
    else:
        refuse()
elif args == ["workflow", "run", "ui-lifecycle-guard.yml", "--ref", "main", "-f", "pr_number=77"]:
    head = st["pr"]["headRefOid"]
    runs = [c for c in st["checks"].get(head, st["check_default"]) if c["name"] != GUARD]
    runs.append({"id": 9000 + len(st["dispatches"]), "name": GUARD,
                 "status": "completed", "conclusion": "success"})
    if st.get("status_dispatch_delay") is not None:
        st["status_dispatch"] = {"head": head, "delay": st["status_dispatch_delay"], "reads": 0}
    elif st.get("dispatch_delay"):
        # Like GitHub: the dispatched run registers a few reads later; the old one stays visible.
        st["pending_dispatch"] = {"head": head, "left": st["dispatch_delay"], "runs": runs}
    else:
        st["checks"][head] = runs
    st["dispatches"].append(args)
    save()
elif args[:3] == ["pr", "comment", "77"] and len(args) == 5 and args[3] == "--body":
    cid = st["next_id"]
    st["next_id"] += 1
    st["comments"].append({"id": cid, "body": args[4],
                           "user": {"login": st["viewer"], "type": "User"}})
    save()
    print(f"https://github.com/example/mira/pull/77#issuecomment-{cid}")
elif (args[:2] == ["issue", "create"] and len(args) == 6
      and args[2] == "--title" and args[4] == "--body"):
    if st.get("fail_issue_create_at") == len(st["issues"]) + 1:
        sys.stderr.write("fake gh: simulated outage\n")
        sys.exit(1)
    number = st["next_issue"]
    st["next_issue"] += 1
    st["issues"].append({"number": number, "title": args[3], "body": args[5],
                         "user": {"login": st["viewer"], "type": "User"}})
    save()
    print(f"https://github.com/example/mira/issues/{number}")
else:
    refuse()
"""

DRIVER_PY = r"""import hashlib
import json
import os
import sys

state_path = os.environ["PRC_FAKE_STATE"]
with open(state_path, encoding="utf-8") as fh:
    st = json.load(fh)
st["review_runs"].append(sys.argv[1:])
step = st["plan"][min(len(st["review_runs"]), len(st["plan"])) - 1]
pr = st["pr"]
if step.get("status") and step.get("write", True):
    iteration = 1 + sum(
        1
        for c in st["comments"]
        if c["user"]["login"] == st["viewer"] and c["body"].startswith("[CODEX-ADVERSARIAL-REVIEW]")
    )
    text = (
        "[CODEX-ADVERSARIAL-REVIEW]\n\n```\n"
        f"reviewed_sha: {pr['headRefOid']}\n"
        f"reviewed_body_sha256: {hashlib.sha256(pr['body'].encode()).hexdigest()}\n"
        f"base_sha: {pr['baseRefOid']}\n"
        f"status: {step['status']}\n"
        f"review_iteration: {iteration}\n\n"
        f"BLOCKER: {step.get('blocker', 0)}\nHIGH: {step.get('high', 0)}\n"
        f"MEDIUM: {step.get('medium', 0)}\nLOW: {step.get('low', 0)}\nFALSE_POSITIVE: 0\n```\n"
    )
    for fid, title in step.get("findings", []):
        text += f"\n### {fid} · MEDIUM · {title}\n\nDetail for {fid}.\n"
    st["comments"].append(
        {"id": st["next_id"], "body": text, "created_at": "2026-11-02T00:00:00Z",
         "user": {"login": st["viewer"], "type": "User"}}
    )
    st["next_id"] += 1
if "move_head_to" in step:
    pr["headRefOid"] = step["move_head_to"]
with open(state_path, "w", encoding="utf-8") as fh:
    json.dump(st, fh)
sys.exit(step.get("rc", 0))
"""


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def review_text(
    sha: str,
    body: str = BODY,
    *,
    status: str = "GREEN",
    iteration: int = 1,
    blocker: int = 0,
    high: int = 0,
    medium: int = 0,
    findings: tuple = (),
) -> str:
    text = (
        "[CODEX-ADVERSARIAL-REVIEW]\n\n```\n"
        f"reviewed_sha: {sha}\n"
        f"reviewed_body_sha256: {sha256(body)}\n"
        f"base_sha: {'0' * 40}\n"
        f"status: {status}\n"
        f"review_iteration: {iteration}\n\n"
        f"BLOCKER: {blocker}\nHIGH: {high}\nMEDIUM: {medium}\nLOW: 0\nFALSE_POSITIVE: 0\n```\n"
    )
    for fid, title in findings:
        text += f"\n### {fid} · MEDIUM · {title}\n\nDetail for {fid}.\n"
    return text


def seed(cid: int, sha: str, status: str, iteration: int, body: str = BODY, **kw) -> dict:
    return {
        "id": cid,
        "body": review_text(sha, body, status=status, iteration=iteration, **kw),
        "user": {"login": VIEWER, "type": "User"},
    }


def ci(build="success", test="success", guard="success") -> list:
    return [
        {"id": 1, "name": "build", "status": "completed", "conclusion": build},
        {"id": 2, "name": "test", "status": "completed", "conclusion": test},
        {"id": 3, "name": GUARD, "status": "completed", "conclusion": guard},
    ]


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        [
            "git",
            "-C",
            str(cwd),
            "-c",
            "user.name=test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _write(path: Path, text: str, *, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


@dataclasses.dataclass
class World:
    repo: Path
    out: Path
    state_path: Path
    log_path: Path
    base: str

    def state(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def review_runs(self) -> list:
        return self.state()["review_runs"]

    def comments(self) -> list:
        return self.state()["comments"]

    def issues(self) -> list:
        return self.state()["issues"]

    def dispatches(self) -> list:
        return self.state()["dispatches"]

    def gh_calls(self) -> list:
        if not self.log_path.exists():
            return []
        return [json.loads(line) for line in self.log_path.read_text().splitlines()]


@dataclasses.dataclass
class Run:
    rc: int
    text: str
    result: dict

    @property
    def reasons(self) -> str:
        return " | ".join(self.result["reasons"])


def build_world(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    head: str = HEAD_A,
    body: str = BODY,
    files: tuple = (MERGE_CONFLICT_FREE,),
    plan: tuple = ({"status": "GREEN"},),
    missing: tuple = (),
    loop_text: str = LOOP_CONVERGED,
    checks: list | None = None,
    check_overrides: dict | None = None,
    statuses: dict | None = None,
    required: tuple = ("build", "test"),
    comments: tuple = (),
    before_pr_view: dict | None = None,
    beta_gate: str = BETA_GATE,
) -> World:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _write(repo / "scripts" / "adversarial-review-ledger.mjs", LEDGER_SRC.read_text("utf-8"))
    _write(repo / "scripts" / "adversarial-review-trusted.sh", TRUSTED_STUB)
    _write(repo / "scripts" / "adversarial-review-loop.sh", loop_text)
    _write(
        repo / "tools" / "ui_surface_lifecycle_guard.py",
        GUARD_STUB.replace("__MISSING__", repr(list(missing))),
    )
    _write(repo / "docs" / "architecture" / "convergence" / "REGISTRY.yaml", "entries: []\n")
    _write(repo / ".github" / "workflows" / "beta-gate.yml", beta_gate)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _git(repo, "rev-parse", "HEAD").strip()

    stub_dir = tmp_path / "bin"
    _write(stub_dir / "gh", FAKE_GH, executable=True)
    driver = tmp_path / "review_driver.py"
    _write(driver, DRIVER_PY)
    state_path = tmp_path / "fake_gh_state.json"
    log_path = tmp_path / "fake_gh_calls.log"
    state = {
        "viewer": VIEWER,
        "pr": {
            "state": "OPEN",
            "isDraft": False,
            "headRefOid": head,
            "baseRefOid": base,
            "baseRefName": "main",
            "body": body,
            "files": list(files),
        },
        "comments": list(comments),
        "next_id": 5000,
        "plan": list(plan),
        "check_default": checks if checks is not None else ci(),
        "checks": check_overrides or {},
        "statuses": statuses or {},
        "protection": {"required_status_checks": {"contexts": list(required)}},
        "issues": [],
        "next_issue": 100,
        "dispatches": [],
        "issue_queries": [],
        "pr_view_calls": 0,
        "before_pr_view": {str(k): v for k, v in (before_pr_view or {}).items()},
        "review_runs": [],
    }
    state_path.write_text(json.dumps(state), encoding="utf-8")
    monkeypatch.setenv("PATH", f"{stub_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("PRC_FAKE_STATE", str(state_path))
    monkeypatch.setenv("PRC_FAKE_LOG", str(log_path))
    monkeypatch.setenv("PRC_FAKE_DRIVER", str(driver))
    monkeypatch.chdir(repo)
    return World(repo, tmp_path / "out", state_path, log_path, base)


def load_controller():
    spec = importlib.util.spec_from_file_location("pr_completion_under_test", CTRL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_no_unsafe_calls(w: World) -> None:
    for args in w.gh_calls():
        assert "merge" not in args, args
        if args[:2] == ["workflow", "run"]:
            assert args == GUARD_DISPATCH, args
        if args[:1] == ["api"]:
            assert not any(a.startswith(WRITES) for a in args[1:]), args


def run_pr(w: World, capsys, *extra: str) -> Run:
    ctrl = load_controller()
    rc = ctrl.main([str(PR), "--poll", "0", "--ci-timeout", "2", "--out", str(w.out), *extra])
    text = capsys.readouterr().out
    assert_no_unsafe_calls(w)
    report = next(w.out.glob(f"pr-{PR}-*.json"))
    return Run(rc, text, json.loads(report.read_text(encoding="utf-8")))


# ── Item 1: exact-head GREEN with one review ────────────────────────────────


def test_item1_first_cycle_reviews_then_second_cycle_is_green(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN"},))
    run = run_pr(w, capsys)
    assert run.rc == 0
    assert run.result["status"] == "GREEN"
    assert run.result["head"] == HEAD_A
    assert len(w.review_runs()) == 1
    assert "all gates pass" in run.reasons


# ── Item 2: full-mode remediation head and review-mode HIGH ─────────────────


def test_item2_full_mode_reviews_moved_head_and_ends_green_there(tmp_path, monkeypatch, capsys):
    plan = (
        {"status": "ISSUES_FOUND", "high": 1, "move_head_to": HEAD_B},
        {"status": "GREEN"},
    )
    w = build_world(tmp_path, monkeypatch, plan=plan)
    run = run_pr(w, capsys, "--mode", "full", "--allow-paid-push")
    assert run.rc == 0
    assert run.result["status"] == "GREEN"
    assert run.result["head"] == HEAD_B
    runs = w.review_runs()
    assert len(runs) == 2
    # Two cycles per action: the loop breaks before remediation once it reaches --max-iter,
    # so --max-iter 1 could review but never fix (Codex r1 F1 on #5112).
    assert all(args[1:] == ["--max-iter", "2"] for args in runs), runs


def test_item2_review_mode_high_verdict_blocks_without_second_run(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "ISSUES_FOUND", "high": 1},))
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert run.result["status"] == "BLOCKED"
    assert "1 HIGH" in run.reasons
    assert len(w.review_runs()) == 1


# ── Item 3: stale evidence never counts as GREEN ────────────────────────────


def test_item3_green_verdict_for_old_head_is_not_evidence_for_new_head(
    tmp_path, monkeypatch, capsys
):
    w = build_world(
        tmp_path,
        monkeypatch,
        head=HEAD_B,
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys, "--read-only")
    assert run.result["status"] == "BLOCKED"
    assert "no exact-head" in run.reasons
    assert w.review_runs() == []


def test_item3_green_verdict_for_old_body_is_not_evidence_for_same_head(
    tmp_path, monkeypatch, capsys
):
    w = build_world(
        tmp_path,
        monkeypatch,
        body=BODY_OTHER,
        comments=(seed(10, HEAD_A, "GREEN", 1, body=BODY),),
    )
    run = run_pr(w, capsys, "--read-only")
    assert run.result["status"] == "BLOCKED"
    assert "no exact-head" in run.reasons
    assert w.review_runs() == []


def test_item3_head_moving_before_final_snapshot_is_stale(tmp_path, monkeypatch, capsys):
    # pr view calls: 1 = cycle 1, 2 = cycle 2 (GREEN read), 3 = final re-snapshot.
    w = build_world(
        tmp_path,
        monkeypatch,
        plan=({"status": "GREEN"},),
        before_pr_view={3: HEAD_B},
    )
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert run.result["status"] == "BLOCKED"
    assert "stale" in run.reasons
    assert run.result["head"] == HEAD_A
    assert len(w.review_runs()) == 1


# ── Item 4: CI, required contexts and the lifecycle guard ───────────────────


def test_item4_failed_ci_blocks_even_with_exact_green_verdict(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        checks=ci(test="failure"),
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "CI failed" in run.reasons
    assert w.review_runs() == []


@pytest.mark.parametrize(
    ("checks", "required"),
    [
        pytest.param(ci(), ("build", "test", "deploy-gate"), id="absent"),
        pytest.param(ci(test="skipped"), ("build", "test"), id="skipped"),
    ],
)
def test_item4_absent_or_skipped_required_context_blocks(
    tmp_path, monkeypatch, capsys, checks, required
):
    w = build_world(
        tmp_path,
        monkeypatch,
        checks=checks,
        required=required,
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "required check not green" in run.reasons
    assert w.review_runs() == []


def test_item4_guard_failure_tolerated_only_for_exact_review_item(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        missing=(REVIEW_ITEM,),
        checks=ci(guard="failure"),
        plan=({"status": "GREEN"},),
    )
    run = run_pr(w, capsys)
    # Every gate passes; a guarded diff is R3, so the verdict is the owner's (rc 3).
    assert run.rc == 3, run.reasons
    assert run.result["status"] == "NEEDS_APPROVAL"
    assert "Lifecycle Guard" in run.reasons
    assert len(w.review_runs()) == 1
    assert w.dispatches() == [GUARD_DISPATCH]


@pytest.mark.parametrize(
    "missing",
    [
        pytest.param(("docs: registry row missing",), id="other-item-only"),
        pytest.param((REVIEW_ITEM, "docs: registry row missing"), id="review-plus-other"),
    ],
)
def test_item4_guard_failure_blocks_when_missing_is_not_exactly_review_item(
    tmp_path, monkeypatch, capsys, missing
):
    w = build_world(
        tmp_path,
        monkeypatch,
        missing=missing,
        checks=ci(guard="failure"),
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "lifecycle guard missing" in run.reasons
    assert w.review_runs() == []


def test_item4_failed_guard_check_blocks_when_local_guard_passes(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        missing=(),
        checks=ci(guard="failure"),
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert GUARD in run.reasons
    assert w.review_runs() == []


# ── Item 5: durable Codex budget ────────────────────────────────────────────


def test_item5_three_consumed_rounds_refuse_review_at_new_head(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        comments=(
            seed(101, HEAD_B, "ISSUES_FOUND", 1),
            seed(102, HEAD_C, "ISSUES_FOUND", 2),
            seed(103, HEAD_D, "ISSUES_FOUND", 3),
        ),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "budget exhausted" in run.reasons
    assert run.result["codex_rounds_used"] == 3
    assert w.review_runs() == []


def test_item5_two_consumed_rounds_still_allow_one_review(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        plan=({"status": "GREEN"},),
        comments=(seed(101, HEAD_B, "ISSUES_FOUND", 1), seed(102, HEAD_C, "ISSUES_FOUND", 2)),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "GREEN"
    assert len(w.review_runs()) == 1


# ── Item 6: concurrency ─────────────────────────────────────────────────────


def test_item6_live_lock_blocks_before_any_gh_call(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch)
    lock = w.repo / ".git" / f"pr-completion-{PR}.lock"
    lock.mkdir()
    (lock / "pid").write_text(str(os.getpid()))
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "another controller owns" in run.reasons
    assert w.gh_calls() == []
    assert w.review_runs() == []
    assert lock.exists()


def test_item6_head_moved_by_someone_else_is_competing_writer(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        plan=({"status": "GREEN"},),
        before_pr_view={2: HEAD_B},
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "competing writer" in run.reasons
    assert len(w.review_runs()) == 1


# ── Item 7: authorization ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(["pr", "merge", "77", "--squash"], id="pr-merge"),
        pytest.param(
            ["workflow", "run", "deploy-staging.yml", "--ref", "main"], id="deploy-workflow"
        ),
        pytest.param(
            ["api", "-X", "PUT", "repos/{{owner}}/{{repo}}/branches/main/protection"],
            id="protection-put",
        ),
        pytest.param(
            ["api", "-f", "required_status_checks=null", "repos/{{owner}}/{{repo}}/x"],
            id="api-field",
        ),
        pytest.param(
            [
                "workflow",
                "run",
                "ui-lifecycle-guard.yml",
                "--ref",
                "main",
                "-f",
                "pr_number=77",
                "-f",
                "extra=1",
            ],
            id="guard-with-extra-field",
        ),
    ],
)
def test_item7_gh_refuses_non_allowlisted_calls_without_exec(tmp_path, monkeypatch, argv):
    w = build_world(tmp_path, monkeypatch)
    ctrl = load_controller()
    with pytest.raises(ctrl.Blocked, match="refused"):
        ctrl.gh(*argv)
    assert w.gh_calls() == []


def test_item7_migration_path_needs_owner_approval_not_green(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        files=("mira-hub/db/migrations/x.sql",),
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.rc == 3
    assert run.result["status"] == "NEEDS_APPROVAL"
    assert "needs_authorization" in run.reasons
    assert w.review_runs() == []


def test_item7_plc_path_needs_human_safety_approval(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        files=("plc/ladder/main.st",),
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.rc == 3
    assert run.result["status"] == "NEEDS_APPROVAL"
    assert "human safety" in run.reasons
    assert w.review_runs() == []


def test_item7_full_mode_into_paid_workflow_blocked_without_flag(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, files=("mira-hub/src/app/x.ts",))
    run = run_pr(w, capsys, "--mode", "full")
    assert run.result["status"] == "BLOCKED"
    assert "paid workflow paths" in run.reasons
    assert w.review_runs() == []


def test_item7_full_mode_into_paid_workflow_runs_with_explicit_flag(tmp_path, monkeypatch, capsys):
    w = build_world(
        tmp_path,
        monkeypatch,
        files=("mira-hub/src/app/x.ts",),
        plan=({"status": "GREEN"},),
    )
    run = run_pr(w, capsys, "--mode", "full", "--allow-paid-push")
    assert run.result["status"] == "GREEN"
    runs = w.review_runs()
    assert len(runs) == 1 and "--max-iter" in runs[0]


# ── Item 8: report contract ─────────────────────────────────────────────────


def test_item8_report_json_and_markdown_contract(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN"},))
    run = run_pr(w, capsys)
    result = run.result
    assert result["status"] == "GREEN"
    assert re.fullmatch(r"[0-9a-f]{40}", result["head"])
    assert re.fullmatch(r"[0-9a-f]{40}", result["base"])
    assert result["head"] == HEAD_A
    assert result["base"] == w.base
    assert re.fullmatch(r"[0-9a-f]{64}", result["body_sha256"])
    assert result["body_sha256"] == sha256(BODY)
    md = next(w.out.glob(f"pr-{PR}-*.md")).read_text(encoding="utf-8")
    assert md.splitlines()[0] == "[PR-COMPLETION-STATUS] GREEN"
    assert f"head: {HEAD_A}" in md
    assert run.text == md + "\n"  # print() adds one newline


# ── Item 9: CONVERGED follow-ups ────────────────────────────────────────────


def test_item9_converged_files_followups_then_goes_green(tmp_path, monkeypatch, capsys):
    plan = (
        {
            "status": "ISSUES_FOUND",
            "medium": 2,
            "findings": [("F1", "Tighten parser bounds"), ("F2", "Redact tokens in logs")],
        },
    )
    w = build_world(tmp_path, monkeypatch, plan=plan)
    run = run_pr(w, capsys)
    assert run.rc == 0
    assert run.result["status"] == "GREEN"
    assert "CONVERGED" in run.reasons
    assert [i["title"] for i in w.issues()] == [
        f"Tighten parser bounds (#{PR} F1)",
        f"Redact tokens in logs (#{PR} F2)",
    ]
    followups = [c["body"] for c in w.comments() if c["body"].startswith("[REVIEW-FOLLOWUPS]")]
    assert len(followups) == 1
    assert f"reviewed_sha: {HEAD_A}" in followups[0]
    assert "issues: #100 #101" in followups[0]
    assert len(w.review_runs()) == 1


def test_item9_converged_guarded_dispatches_guard_then_goes_green(tmp_path, monkeypatch, capsys):
    plan = ({"status": "ISSUES_FOUND", "medium": 1, "findings": [("F1", "Pin the parser")]},)
    w = build_world(
        tmp_path,
        monkeypatch,
        missing=(REVIEW_ITEM,),
        checks=ci(guard="failure"),
        plan=plan,
    )
    # Three cycles only: the follow-up path itself must dispatch the guard, since a later
    # "guard" action would otherwise mask its absence.
    run = run_pr(w, capsys, "--max-cycles", "3")
    assert run.result["status"] == "NEEDS_APPROVAL", run.reasons
    assert "CONVERGED" in run.reasons
    assert len(w.issues()) == 1
    assert w.dispatches() == [GUARD_DISPATCH]
    assert len(w.review_runs()) == 1


def test_item9_no_followups_flag_blocks_without_creating_issues(tmp_path, monkeypatch, capsys):
    plan = ({"status": "ISSUES_FOUND", "medium": 1, "findings": [("F1", "Pin the parser")]},)
    w = build_world(tmp_path, monkeypatch, plan=plan)
    run = run_pr(w, capsys, "--no-followups")
    assert run.result["status"] == "BLOCKED"
    assert "follow-ups not filed" in run.reasons
    assert w.issues() == []
    assert not [c for c in w.comments() if c["body"].startswith("[REVIEW-FOLLOWUPS]")]


def test_item9_heading_count_mismatch_blocks_without_creating_issues(tmp_path, monkeypatch, capsys):
    plan = ({"status": "ISSUES_FOUND", "medium": 2, "findings": [("F1", "Only one heading")]},)
    w = build_world(tmp_path, monkeypatch, plan=plan)
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"
    assert "MEDIUM headings" in run.reasons
    assert w.issues() == []


# ── Item 10: review tooling exit codes ──────────────────────────────────────


@pytest.mark.parametrize(
    "step",
    [
        pytest.param({"status": "GREEN", "rc": 2}, id="rc2-after-green-verdict"),
        pytest.param({"status": "GREEN", "rc": 3}, id="rc3-after-green-verdict"),
        pytest.param({"status": "GREEN", "rc": 6}, id="rc6-after-green-verdict"),
        pytest.param({"write": False, "rc": 2}, id="rc2-without-verdict"),
    ],
)
def test_item10_review_tooling_exit_is_blocked_never_green(tmp_path, monkeypatch, capsys, step):
    w = build_world(tmp_path, monkeypatch, plan=(step,))
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert run.result["status"] == "BLOCKED"
    assert "tooling" in run.reasons
    assert len(w.review_runs()) == 1


def test_item10_control_exit_5_with_green_verdict_is_accepted(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN", "rc": 5},))
    run = run_pr(w, capsys)
    assert run.result["status"] == "GREEN"
    assert len(w.review_runs()) == 1


# ── Regressions for four controller bugs found by this suite (fixed) ───────


@pytest.mark.parametrize(
    "argv",
    [
        pytest.param(
            ["api", "-XPUT", "repos/{{owner}}/{{repo}}/branches/main/protection"], id="-XPUT"
        ),
        pytest.param(
            ["api", "--method=PUT", "repos/{{owner}}/{{repo}}/branches/main/protection"],
            id="--method=PUT",
        ),
        pytest.param(["api", "-ftitle=x", "repos/{{owner}}/{{repo}}/x"], id="-ftitle"),
    ],
)
def test_bug_gh_refuses_write_flags_in_attached_forms(tmp_path, monkeypatch, argv):
    w = build_world(tmp_path, monkeypatch)
    ctrl = load_controller()
    with pytest.raises(ctrl.Blocked, match="refused"):
        ctrl.gh(*argv)
    assert w.gh_calls() == []


def test_bug_paid_gate_fails_closed_when_beta_gate_block_is_reordered(
    tmp_path, monkeypatch, capsys
):
    w = build_world(
        tmp_path,
        monkeypatch,
        files=("mira-hub/src/app/x.ts",),
        plan=({"status": "GREEN"},),
        beta_gate=BETA_GATE_REORDERED,
    )
    run = run_pr(w, capsys, "--mode", "full")
    assert run.result["status"] == "BLOCKED"
    assert w.review_runs() == []


def test_bug_converged_capability_marker_is_an_exact_exit_statement(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, loop_text=LOOP_EXIT_50, plan=({"status": "GREEN"},))
    run_pr(w, capsys, "--mode", "full")
    runs = w.review_runs()
    assert len(runs) == 1
    assert "--max-iter" not in runs[0]


def test_bug_failed_check_run_is_not_masked_by_same_named_success_status(
    tmp_path, monkeypatch, capsys
):
    w = build_world(
        tmp_path,
        monkeypatch,
        checks=ci(build="failure"),
        statuses={HEAD_A: [{"context": "build", "state": "success"}]},
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == "BLOCKED"


@pytest.mark.parametrize(
    ("newest", "expected"),
    [("success", "GREEN"), ("failure", "BLOCKED")],
)
def test_status_history_is_judged_by_its_newest_entry_over_a_green_check_run(
    tmp_path, monkeypatch, capsys, newest, expected
):
    """Real #5104 shape: a green check run plus statuses failure -> pending -> newest. The
    newest status decides; an older failure must not stick (and a newest failure still blocks)."""
    w = build_world(
        tmp_path,
        monkeypatch,
        statuses={
            HEAD_A: [  # GitHub returns statuses newest first
                {"context": "build", "state": newest},
                {"context": "build", "state": "pending"},
                {"context": "build", "state": "failure"},
            ]
        },
        comments=(seed(10, HEAD_A, "GREEN", 1),),
    )
    run = run_pr(w, capsys)
    assert run.result["status"] == expected, run.result


# ── Codex round 1 on #5112: regressions for F1-F5 ───────────────────────────


def test_f1_full_mode_with_one_round_left_only_reviews(tmp_path, monkeypatch, capsys):
    # Two rounds already used: a two-cycle action would exceed the durable budget.
    comments = (seed(10, HEAD_C, "ISSUES_FOUND", 1, high=1), seed(11, HEAD_D, "GREEN", 2))
    w = build_world(tmp_path, monkeypatch, comments=comments, plan=({"status": "GREEN"},))
    run = run_pr(w, capsys, "--mode", "full", "--allow-paid-push")
    assert run.result["status"] == "GREEN", run.reasons
    assert [args[1:] for args in w.review_runs()] == [["--max-iter", "1"]]


def test_f2_file_list_beyond_one_hundred_still_sees_the_last_file(tmp_path, monkeypatch, capsys):
    files = tuple(f"docs/page-{i:03d}.md" for i in range(100)) + ("mira-hub/db/migrations/9.sql",)
    w = build_world(tmp_path, monkeypatch, files=files, plan=({"status": "GREEN"},))
    run = run_pr(w, capsys)
    assert run.rc == 3, run.reasons
    assert run.result["tier"] == "needs_authorization"


def test_f2_rename_out_of_a_guarded_path_counts_the_origin(tmp_path, monkeypatch, capsys):
    renamed = {"filename": "docs/old-workflow.md", "previous_filename": ".github/workflows/x.yml"}
    w = build_world(tmp_path, monkeypatch, files=(renamed,), plan=({"status": "GREEN"},))
    run = run_pr(w, capsys)
    assert run.rc == 3, run.reasons
    assert ".github/workflows/x.yml" in run.reasons


def test_f2_rename_control_inside_docs_stays_low(tmp_path, monkeypatch, capsys):
    renamed = {"filename": "docs/new.md", "previous_filename": "docs/old.md"}
    w = build_world(tmp_path, monkeypatch, files=(renamed,), plan=({"status": "GREEN"},))
    run = run_pr(w, capsys)
    assert run.rc == 0, run.reasons
    assert run.result["tier"] == "low"


def test_f2_file_count_mismatch_is_blocked_not_classified(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN"},))
    st = w.state()
    st["pr"]["changed_files_override"] = 2
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert "partial file list" in run.reasons
    assert w.review_runs() == []


def test_f3_low_only_converged_files_one_issue_then_goes_green(tmp_path, monkeypatch, capsys):
    plan = ({"status": "ISSUES_FOUND", "low": 2},)
    w = build_world(tmp_path, monkeypatch, plan=plan)
    run = run_pr(w, capsys)
    assert run.rc == 0, run.reasons
    assert "CONVERGED" in run.reasons
    issues = w.issues()
    assert len(issues) == 1
    assert "finding=LOW" in issues[0]["body"]
    assert len(w.review_runs()) == 1


@pytest.mark.parametrize(
    "path",
    [
        "CLAUDE.md",
        ".claude/rules/multi-session-protocol.md",
        ".githooks/pre-commit",
        "docs/runbooks/rollback.md",
        "docs/environments.md",
        "docs/architecture/mira-sdlc-v1.md",
        "docs/architecture/convergence/REGISTRY.yaml",
        "tests/conftest.py",
        "tests/test_ui_surface_lifecycle_guard.py",
        "pyproject.toml",
        "tools/ci/check.py",
        "mira-bots/shared/guardrails.py",
    ],
)
def test_f4_sdlc_r3_paths_need_authorization_before_low_risk(path):
    assert load_controller().risk_tier([path])[0] == "needs_authorization"


@pytest.mark.parametrize("path", ["docs/notes.md", "tests/test_engine_reply.py", "wiki/hot.md"])
def test_f4_control_ordinary_docs_and_tests_stay_low(path):
    assert load_controller().risk_tier([path])[0] == "low"


def test_f5_rerun_after_partial_filing_reuses_issues(tmp_path, monkeypatch, capsys):
    findings = (("F1", "First"), ("F2", "Second"))
    plan = ({"status": "ISSUES_FOUND", "medium": 2, "findings": findings},)
    w = build_world(tmp_path, monkeypatch, plan=plan)
    st = w.state()
    st["fail_issue_create_at"] = 2  # the second create fails, after the first succeeded
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    first = run_pr(w, capsys)
    assert first.rc == 1
    assert len(w.issues()) == 1
    st = w.state()
    st.pop("fail_issue_create_at")
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    for old in w.out.glob("*"):
        old.unlink()
    second = run_pr(w, capsys)
    assert second.rc == 0, second.reasons
    issues = w.issues()
    assert len(issues) == 2, [i["title"] for i in issues]
    assert sorted(re.search(r"finding=(F[0-9])", i["body"]).group(1) for i in issues) == [
        "F1",
        "F2",
    ]
    record = [c["body"] for c in w.comments() if c["body"].startswith("[REVIEW-FOLLOWUPS]")]
    assert len(record) == 1 and "issues: #100 #101" in record[0]
    assert all("since=2026-11-02T00:00:00Z" in q for q in w.state()["issue_queries"])
    assert len(w.review_runs()) == 1


# ── Codex round 2 on #5112: regressions for F1-F4 ───────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "mira-hub/src/capabilities/answer-validation.ts",
        "mira-hub/src/lib/tenant-context.ts",
        "mira-mobile/scripts/ota-publish.mjs",
        "mira-mobile/android/app/build.gradle",
        "mira-hub/src/lib/rls-helpers.ts",
        "mira-crawler/ingest/private_upload.py",
        "mira-hub/src/lib/session.tsx",
        "mira-pipeline/session_store.py",
        "mira-hub/src/app/api/auth/[...nextauth]/route.ts",
        "mira-bots/shared/eval/answer_judge.py",
        "mira-connect/fieldbus/reader.py",
        "mira-relay/sparkplug_decode.py",
        "tools/acceptance_receipt_writer.py",
        "mira-hub/src/lib/__tests__/scopeguard.test.ts",
        "tools/kg_write_guard.py",
    ],
)
def test_r2_f1_tenant_safety_and_release_paths_need_authorization(path):
    assert load_controller().risk_tier([path], {path: "+x"})[0] == "needs_authorization"


@pytest.mark.parametrize("token", ["tenant_id", "is_private", "knowledge_entries", "CREATE POLICY"])
def test_r2_f1_a_changed_line_naming_an_r3_token_needs_authorization(token):
    path = "mira-hub/src/lib/report-builder.ts"
    tier = load_controller().risk_tier([path], {path: f"@@ -1 +1 @@\n-a\n+where {token} = $1"})
    assert tier[0] == "needs_authorization"
    assert token in tier[1][0]


def test_r2_f1_an_uninspectable_backend_diff_needs_authorization():
    path = "mira-hub/src/lib/report-builder.ts"
    tier = load_controller().risk_tier([path], {path: None})
    assert tier == ("needs_authorization", [f"{path} (diff not inspectable)"])


def test_r2_f1_control_plain_backend_change_stays_backend():
    path = "mira-hub/src/lib/report-builder.ts"
    assert load_controller().risk_tier([path], {path: "@@ -1 +1 @@\n-a\n+b"})[0] == "backend"


def test_r2_f1_control_tokens_in_low_risk_docs_do_not_promote():
    path = "docs/notes.md"
    assert load_controller().risk_tier([path], {path: "+tenant_id"})[0] == "low"


@pytest.mark.parametrize(
    "fields, needle",
    [
        ({"isDraft": True}, "draft"),
        ({"mergeable": "CONFLICTING"}, "mergeable=CONFLICTING"),
        ({"mergeStateStatus": "BEHIND"}, "BEHIND"),
        ({"reviewDecision": "CHANGES_REQUESTED"}, "changes requested"),
    ],
)
def test_r2_f2_unmergeable_pr_is_never_green(tmp_path, monkeypatch, capsys, fields, needle):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN"},))
    st = w.state()
    st["pr"].update(fields)
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert needle in run.reasons


def test_r2_f2_base_moving_before_final_snapshot_is_stale(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, plan=({"status": "GREEN"},))
    st = w.state()
    st["before_pr_view"] = {"3": {"baseRefOid": "e" * 40}}
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys)
    assert run.rc == 1
    assert "stale" in run.reasons


def test_r2_f3_full_mode_needs_the_flag_even_off_paid_paths(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, files=("mira-bots/shared/util.py",))
    run = run_pr(w, capsys, "--mode", "full")
    assert run.rc == 1
    assert "--allow-paid-push" in run.reasons
    assert w.review_runs() == []


def test_r2_f3_control_full_mode_without_a_paid_workflow_runs(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, files=("mira-bots/shared/util.py",), beta_gate="")
    _git(w.repo, "rm", "-q", ".github/workflows/beta-gate.yml")
    _git(w.repo, "commit", "-q", "-m", "no paid workflow")
    st = w.state()
    st["pr"]["baseRefOid"] = _git(w.repo, "rev-parse", "HEAD").strip()
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys, "--mode", "full")
    assert run.rc == 0, run.reasons
    assert len(w.review_runs()) == 1


def test_r2_f4_guard_dispatch_waits_for_the_new_run(tmp_path, monkeypatch, capsys):
    plan = ({"status": "ISSUES_FOUND", "medium": 1, "findings": [("F1", "Pin the parser")]},)
    w = build_world(
        tmp_path, monkeypatch, missing=(REVIEW_ITEM,), checks=ci(guard="failure"), plan=plan
    )
    st = w.state()
    st["dispatch_delay"] = 2  # the old failed guard stays visible for two reads
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys, "--max-cycles", "3")
    assert run.result["status"] == "NEEDS_APPROVAL", run.reasons
    assert w.dispatches() == [GUARD_DISPATCH]


def test_r2_f4_guard_dispatch_waits_for_a_new_commit_status(tmp_path, monkeypatch, capsys):
    # The real guard reports by commit status: the old failure stays visible, then a pending
    # status appears, then the final one. Only a status newer than the old one is evidence.
    plan = ({"status": "ISSUES_FOUND", "medium": 1, "findings": [("F1", "Pin the parser")]},)
    old = {"id": 7000, "context": GUARD, "state": "failure"}
    w = build_world(
        tmp_path,
        monkeypatch,
        missing=(REVIEW_ITEM,),
        checks=[c for c in ci() if c["name"] != GUARD],
        statuses={HEAD_A: [old]},
        plan=plan,
    )
    st = w.state()
    st["status_dispatch_delay"] = 2
    w.state_path.write_text(json.dumps(st), encoding="utf-8")
    run = run_pr(w, capsys, "--max-cycles", "3")
    assert run.result["status"] == "NEEDS_APPROVAL", run.reasons
    assert w.dispatches() == [GUARD_DISPATCH]


def test_r2_guarded_diff_is_needs_approval_even_when_paths_look_backend(
    tmp_path, monkeypatch, capsys
):
    w = build_world(
        tmp_path,
        monkeypatch,
        files=("mira-hub/src/app/page.tsx",),
        missing=(REVIEW_ITEM,),
        checks=ci(guard="success"),
        plan=({"status": "GREEN"},),
    )
    run = run_pr(w, capsys)
    assert run.rc == 3, run.reasons
    assert run.result["tier"] == "needs_authorization"


def test_r2_control_unguarded_backend_diff_stays_green(tmp_path, monkeypatch, capsys):
    w = build_world(tmp_path, monkeypatch, files=("mira-hub/src/app/page.tsx",))
    run = run_pr(w, capsys)
    assert run.rc == 0, run.reasons
    assert run.result["tier"] == "backend"
