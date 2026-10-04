"""Workflow contract for SDLC v1 Part B step 10 (§10.2 rollback).

Two workflows, read as data AND executed against a fake `gh`:

* deploy-vps.yml — authorize-source records per-service rollback candidates from the
  production receipts (bounded walk, fail closed) and the deploy job stamps them onto
  the production receipt between extract and verify.
* rollback-candidate-refresh.yml — designate → compat → evidence (verified exactly as
  authorize-source verifies it) → due; lost readiness opens an `incident` issue with
  the §10.3 fixed fields and fails the job.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import stat
import subprocess
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
DEPLOY = REPO / ".github" / "workflows" / "deploy-vps.yml"
REFRESH = REPO / ".github" / "workflows" / "rollback-candidate-refresh.yml"
TOOL = REPO / "tools" / "rollback_candidates.py"
OWNER_REPO = "Mikecranesync/MIRA"

B = "76887423c6c84d0871d531af98927423b02bfb5a"
C = "648896996d906b4c1df828a3eafd0771f6534a27"
NEW = "33dc98f6bac948a2587ed980c938b71d0fa4434a"
IMG = "sha256:" + "a" * 64

pytestmark = pytest.mark.skipif(
    shutil.which("jq") is None, reason="jq is required (ubuntu-latest ships it)"
)


def _wf(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _step(path: Path, job: str, name: str) -> dict:
    for step in _wf(path)["jobs"][job]["steps"]:
        if step.get("name") == name:
            return step
    raise AssertionError(f"{job}: step {name!r} missing")


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _receipt(sha: str, run_id: str, deployed_at: str, services) -> dict:
    return {
        "schema": "factorylm.deploy-receipt/1",
        "environment": "production",
        "approved_rc_sha": sha,
        "run_id": run_id,
        "deployed_at": deployed_at,
        "built_images": {s: IMG for s in services},
        "running_images": {s: IMG for s in services},
    }


def _zip(tmp: Path, name: str, member: str, obj: dict) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(member, json.dumps(obj))
    path = tmp / f"{name}.zip"
    path.write_bytes(buf.getvalue())
    return str(path)


FAKE_GH = r"""#!/usr/bin/env python3
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ["FAKE_GH_LOG"], "a") as fh:
    fh.write(json.dumps(args) + "\n")
fx = json.load(open(os.environ["FAKE_GH_FIXTURES"]))

def emit(data):
    if "--jq" in args:
        r = subprocess.run(["jq", "-r", args[args.index("--jq") + 1]], input=json.dumps(data),
                           capture_output=True, text=True)
        sys.stdout.write(r.stdout); sys.stderr.write(r.stderr); sys.exit(r.returncode)
    sys.stdout.write(json.dumps(data)); sys.exit(0)

if args[:2] == ["run", "list"]:
    runs = [r if isinstance(r, dict) else {"id": r} for r in fx["runs"]]
    want = args[args.index("--status") + 1] if "--status" in args else None
    runs = [r for r in runs if want in (None, r.get("status", "completed"), r.get("conclusion", "success"))]
    if "--limit" in args:
        runs = runs[: int(args[args.index("--limit") + 1])]
    emit([{"databaseId": int(r["id"]), "updatedAt": r.get("updatedAt", "2026-10-03T12:00:00Z")} for r in runs])
if args and args[0] == "api":
    raw = next(a for a in args[1:] if a.lstrip("/").startswith("repos/"))
    key = raw.lstrip("/").split("/", 3)[3]
    if key.endswith("/zip") and key in fx.get("zips", {}):
        sys.stdout.buffer.write(open(fx["zips"][key], "rb").read()); sys.exit(0)
    if key in fx.get("api", {}):
        emit(fx["api"][key])
    sys.stderr.write("HTTP 404: " + key + "\n"); sys.exit(1)
if args[:2] == ["issue", "list"]:
    emit(fx.get("issues", []))
if args[:2] in (["issue", "create"], ["issue", "comment"], ["label", "create"]):
    print("https://github.com/x/y/issues/1"); sys.exit(0)
sys.stderr.write("unexpected gh call\n"); sys.exit(1)
"""


def _env(tmp: Path, fixtures: dict, **extra: str) -> dict:
    bindir = tmp / "bin"
    bindir.mkdir(exist_ok=True)
    gh = bindir / "gh"
    gh.write_text(FAKE_GH, encoding="utf-8")
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
    fx = tmp / "fixtures.json"
    fx.write_text(json.dumps(fixtures), encoding="utf-8")
    rt = tmp / "rt"
    rt.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_GH_LOG": str(tmp / "gh.log"),
        "FAKE_GH_FIXTURES": str(fx),
        "GH_TOKEN": "x",
        "REPO": OWNER_REPO,
        "RUNNER_TEMP": str(rt),
        "GITHUB_OUTPUT": str(tmp / "out"),
        "GITHUB_STEP_SUMMARY": str(tmp / "summary"),
    }
    (tmp / "out").write_text("", encoding="utf-8")
    (tmp / "summary").write_text("", encoding="utf-8")
    env.update(extra)
    return env


def _calls(tmp: Path) -> list[list[str]]:
    log = tmp / "gh.log"
    return (
        [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        if log.exists()
        else []
    )


# ── deploy-vps.yml: candidates recorded before the host, stamped after ───────

RECORD = "Record rollback candidates (SDLC v1 §10.2)"
EXTRACT = "Extract and verify the production receipt"


def test_candidates_are_computed_in_authorize_source_from_the_trusted_tool():
    steps = [s.get("name") for s in _wf(DEPLOY)["jobs"]["authorize-source"]["steps"]]
    assert steps[-1] == RECORD, (
        "recorded after every authorization check, before any production job"
    )
    pin = _step(DEPLOY, "authorize-source", "Pin the trusted base and its validators")["run"]
    assert "tools/rollback_candidates.py" in pin
    run = _step(DEPLOY, "authorize-source", RECORD)["run"]
    assert 'TOOL="$RUNNER_TEMP/trusted/rollback_candidates.py"' in run
    assert 'python3 -I "$TOOL" candidates' in run and 'python3 -I "$TOOL" since' in run
    assert run.count("TOOL=") == 1, "the trusted copy is the only tool the step runs"
    assert "python3 tools/rollback_candidates.py" not in DEPLOY.read_text(encoding="utf-8")
    outputs = _wf(DEPLOY)["jobs"]["authorize-source"]["outputs"]
    assert (
        outputs["rollback_candidates"]
        == "${{ steps.rollback-candidates.outputs.rollback_candidates }}"
    )
    assert _wf(DEPLOY)["jobs"]["authorize-source"].get("environment") is None


def test_a_rerun_deploy_job_stamps_unresolved_candidates():
    """Pre-Codex Claude screen: re-running failed jobs reuses authorize-source's outputs from
    the first attempt, which a deploy in between may have made stale."""
    run = _step(DEPLOY, "deploy", EXTRACT)["run"]
    assert '--attempt "$GITHUB_RUN_ATTEMPT"' in run


def test_the_deploy_job_stamps_between_extract_and_verify():
    step = _step(DEPLOY, "deploy", EXTRACT)
    assert (
        step["env"]["ROLLBACK_CANDIDATES"]
        == "${{ needs.authorize-source.outputs.rollback_candidates }}"
    )
    run = step["run"]
    extract = run.index('staging_receipt.py" extract')
    stamp = run.index('rollback_candidates.py" stamp')
    verify = run.index('staging_receipt.py" verify')
    assert extract < stamp < verify
    assert 'git show "$TRUSTED_BASE_SHA:tools/rollback_candidates.py"' in run
    assert '--services "$EFFECTIVE_SERVICES"' in run[stamp:verify]


def _prod_fixtures(tmp: Path, *, broken_run: str = "") -> dict:
    rows = [
        ("36805202089", C, "2026-10-01T02:23:34Z", ("mira-hub", "mira-ask"), 901),
        ("36369296665", B, "2026-09-28T02:23:24Z", ("mira-hub", "mira-web", "mira-ask"), 902),
        (
            "36350115024",
            "0994b31a453cd0789661e21bb22db8f3e5eb926e",
            "2026-09-27T21:04:48Z",
            ("mira-hub", "mira-web", "mira-ask"),
            903,
        ),
    ]
    api, zips = {}, {}
    for run, sha, at, services, art in rows:
        api[f"actions/runs/{run}/artifacts"] = {
            "artifacts": [
                {"id": art + 10, "name": f"predeploy-bot-logs-{run}", "expired": False},
                {"id": art, "name": f"production-receipt-{sha}", "expired": False},
            ]
        }
        body = _receipt(sha, run, at, services)
        if run == broken_run:
            body["run_id"] = "1"
        zips[f"actions/artifacts/{art}/zip"] = _zip(tmp, str(art), "production-receipt.json", body)
    return {"runs": [r[0] for r in rows], "api": api, "zips": zips}


def _run_record(
    tmp: Path, fixtures: dict, services: str, cap: str = ""
) -> subprocess.CompletedProcess:
    job_env = _wf(DEPLOY)["jobs"]["authorize-source"]["env"]
    env = _env(
        tmp,
        fixtures,
        APPROVED_RC_SHA=NEW,
        EFFECTIVE_SERVICES=services,
        RECEIPT_WALK_DAYS=job_env["RECEIPT_WALK_DAYS"],
        RECEIPT_WALK_CAP=cap or job_env["RECEIPT_WALK_CAP"],
    )
    trusted = Path(env["RUNNER_TEMP"]) / "trusted"
    trusted.mkdir()
    shutil.copy(TOOL, trusted / "rollback_candidates.py")
    return subprocess.run(
        ["bash", "-c", _step(DEPLOY, "authorize-source", RECORD)["run"]],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_record_step_reads_the_whole_bounded_history(tmp_path):
    res = _run_record(tmp_path, _prod_fixtures(tmp_path), "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    line = next(
        x
        for x in (tmp_path / "out").read_text().splitlines()
        if x.startswith("rollback_candidates=")
    )
    cands = json.loads(line.split("=", 1)[1])
    assert {s: e["sha"] for s, e in cands.items()} == {"mira-hub": C, "mira-ask": C, "mira-web": B}
    downloads = [c for c in _calls(tmp_path) if c[0] == "api" and c[1].endswith("/zip")]
    assert len(downloads) == 3, "every readable receipt is read before selecting by deployed_at"
    listing = next(c for c in _calls(tmp_path) if c[:2] == ["run", "list"])
    assert listing[listing.index("--branch") + 1] == "main", (
        "a run dispatched from another ref runs ITS copy"
    )
    assert listing[listing.index("--event") + 1] == "workflow_dispatch"


def test_record_step_with_no_earlier_deploy_run_records_null_candidates(tmp_path):
    """The first production deploy after this lands: no run to walk, the step still succeeds."""
    res = _run_record(tmp_path, {"runs": [], "api": {}, "zips": {}}, "mira-hub mira-web")
    assert res.returncode == 0, res.stdout + res.stderr
    line = next(
        x
        for x in (tmp_path / "out").read_text().splitlines()
        if x.startswith("rollback_candidates=")
    )
    cands = json.loads(line.split("=", 1)[1])
    assert {s: e["sha"] for s, e in cands.items()} == {"mira-hub": None, "mira-web": None}
    assert not [c for c in _calls(tmp_path) if c[0] == "api"], "nothing to download"


def test_refresh_lists_only_main_dispatch_deploy_runs():
    run = _step(REFRESH, "check", "Gather the production receipts")["run"]
    assert (
        "--workflow deploy-vps.yml --branch main --event workflow_dispatch --status completed"
        in run
    )


def _walk_block(run: str) -> str:
    start = run.index("WINDOW_START=")
    end = run.index('done < "$RECEIPTLESS"') + len('done < "$RECEIPTLESS"')
    return "\n".join(line for line in run[start:end].splitlines() if "N=$((N + 1))" not in line)


def test_both_receipt_walks_are_the_same_walk():
    """deploy-vps authorize-source and the refresh must read production the same way."""
    record = _walk_block(_step(DEPLOY, "authorize-source", RECORD)["run"])
    gather = _walk_block(_step(REFRESH, "check", "Gather the production receipts")["run"])
    assert record == gather
    assert '--status completed --created ">=$WINDOW_START" --limit "$RECEIPT_WALK_CAP"' in record
    assert 'window-start --days "$RECEIPT_WALK_DAYS"' in record
    assert "jobs?per_page=100&filter=all" in record, "every attempt's steps, not only the latest"
    deploy_env = _wf(DEPLOY)["jobs"]["authorize-source"]["env"]
    refresh_env = _wf(REFRESH)["jobs"]["check"]["env"]
    # 90-day receipt retention + 30-day re-run limit + 1 day: every run whose receipt can matter
    assert deploy_env["RECEIPT_WALK_DAYS"] == refresh_env["RECEIPT_WALK_DAYS"] == "121"
    assert deploy_env["RECEIPT_WALK_CAP"] == refresh_env["RECEIPT_WALK_CAP"] == "1000"
    assert deploy_env["PRODUCTION_DEFAULT_SERVICES"] == refresh_env["PRODUCTION_DEFAULT_SERVICES"]
    for text in (DEPLOY.read_text(encoding="utf-8"), REFRESH.read_text(encoding="utf-8")):
        assert "--status success --limit" not in text


def test_the_missing_receipt_check_names_the_step_that_swaps_production():
    """A receipt-less run whose Deploy step ran may have changed production (the swap is in
    that step, before the receipt). A rename must fail here."""
    deploy = _step(DEPLOY, "deploy", "Deploy")["run"]
    assert "--force-recreate" in deploy, "the swap lives in the Deploy step"
    for run in (
        _step(DEPLOY, "authorize-source", RECORD)["run"],
        _step(REFRESH, "check", "Gather the production receipts")["run"],
    ):
        assert '.name == "Deploy" and .conclusion != null and .conclusion != "skipped"' in run
        assert "gh api --paginate" in run, "every page of every attempt's jobs"


def test_the_runbook_walks_receipts_like_the_workflows():
    """Codex #4222 r1 F5: the operator procedure keeps the same provenance filters."""
    runbook = (REPO / "docs/runbooks/rollback.md").read_text(encoding="utf-8")
    assert (
        "--workflow deploy-vps.yml --branch main --event workflow_dispatch --status completed"
        in runbook
    )
    assert "--status success" not in runbook
    assert "more than one production receipt" in runbook


def test_a_receipted_run_counts_whatever_its_conclusion(tmp_path):
    """Codex #4222 r1 F4: a run that failed AFTER uploading its receipt still ran in production."""
    fx = _prod_fixtures(tmp_path)
    d_sha, run = "d" * 40, "36900000001"
    fx["runs"] = [{"id": run, "conclusion": "failure"}, *fx["runs"]]
    fx["api"][f"actions/runs/{run}/artifacts"] = {
        "artifacts": [{"id": 999, "name": f"production-receipt-{d_sha}", "expired": False}]
    }
    fx["zips"]["actions/artifacts/999/zip"] = _zip(
        tmp_path,
        "999",
        "production-receipt.json",
        _receipt(d_sha, run, "2026-10-03T10:00:00Z", ("mira-hub",)),
    )
    res = _run_record(tmp_path, fx, "mira-hub")
    assert res.returncode == 0, res.stdout + res.stderr
    line = next(
        x
        for x in (tmp_path / "out").read_text().splitlines()
        if x.startswith("rollback_candidates=")
    )
    assert json.loads(line.split("=", 1)[1])["mira-hub"]["sha"] == d_sha


def test_a_rerun_of_an_older_run_with_the_newest_deployment_wins(tmp_path):
    """Codex #4222 r2 F7: run order and service coverage prove nothing about time."""
    fx = _prod_fixtures(tmp_path)
    a_sha = "0994b31a453cd0789661e21bb22db8f3e5eb926e"
    # the oldest-listed run was re-run after the others and deployed last
    fx["zips"]["actions/artifacts/903/zip"] = _zip(
        tmp_path,
        "903b",
        "production-receipt.json",
        _receipt(
            a_sha, "36350115024", "2026-10-02T09:00:00Z", ("mira-hub", "mira-web", "mira-ask")
        ),
    )
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    line = next(
        x
        for x in (tmp_path / "out").read_text().splitlines()
        if x.startswith("rollback_candidates=")
    )
    cands = json.loads(line.split("=", 1)[1])
    assert {s: e["sha"] for s, e in cands.items()} == dict.fromkeys(
        ("mira-hub", "mira-web", "mira-ask"), a_sha
    )


def _jobs(deploy_conclusion: str) -> dict:
    return {
        "jobs": [
            {
                "name": "Authorize production source",
                "steps": [{"name": "x", "conclusion": "success"}],
            },
            {"name": "Deploy", "steps": [{"name": "Deploy", "conclusion": deploy_conclusion}]},
        ]
    }


def _cands(tmp: Path) -> dict:
    line = next(
        x for x in (tmp / "out").read_text().splitlines() if x.startswith("rollback_candidates=")
    )
    return json.loads(line.split("=", 1)[1])


def _as_dict_runs(fx: dict, **updated: str) -> None:
    fx["runs"] = [
        {"id": r, **({"updatedAt": updated[r]} if r in updated else {})} for r in fx["runs"]
    ]


def test_a_vanished_receipt_that_could_be_newer_leaves_the_candidates_unresolved(tmp_path):
    """A run whose upload succeeded but whose receipt is gone may hide a newer deployment."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36369296665/artifacts"]["artifacts"].pop(1)
    fx["api"]["actions/runs/36369296665/jobs?per_page=100&filter=all"] = _jobs("success")
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, "uncertainty is recorded, never a failed deploy"
    cands = _cands(tmp_path)
    assert {s: e["sha"] for s, e in cands.items()} == dict.fromkeys(
        ("mira-hub", "mira-web", "mira-ask")
    )
    assert "unresolved: run 36369296665" in cands["mira-web"]["reason"]
    zips = [c for c in _calls(tmp_path) if c[0] == "api" and c[1].endswith("/zip")]
    assert len(zips) == 2, "every readable receipt is still read"


def test_a_vanished_rerun_behind_full_coverage_is_caught(tmp_path):
    """Codex #4222 r3 F7: run order [200, 100]; 200 covers everything; 100 was re-run later and
    its receipt vanished. Coverage must not hide it."""
    d_sha = "d" * 40
    fx = {
        "runs": [
            {"id": "36900000200", "updatedAt": "2026-10-02T10:00:00Z"},
            {"id": "36900000100", "updatedAt": "2026-10-04T08:00:00Z"},
        ],
        "api": {
            "actions/runs/36900000200/artifacts": {
                "artifacts": [{"id": 300, "name": f"production-receipt-{d_sha}", "expired": False}]
            },
            "actions/runs/36900000100/artifacts": {"artifacts": []},
            "actions/runs/36900000100/jobs?per_page=100&filter=all": _jobs("success"),
        },
        "zips": {
            "actions/artifacts/300/zip": _zip(
                tmp_path,
                "300",
                "production-receipt.json",
                _receipt(
                    d_sha,
                    "36900000200",
                    "2026-10-02T09:50:00Z",
                    ("mira-hub", "mira-web", "mira-ask"),
                ),
            )
        },
    }
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    assert all(e["sha"] is None for e in _cands(tmp_path).values())


def test_a_receiptless_run_older_than_every_receipt_is_not_even_asked(tmp_path):
    """Pass 2 asks for job lists only where a gap could matter."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36369296665/artifacts"]["artifacts"].pop(1)
    _as_dict_runs(fx, **{"36369296665": "2026-09-27T20:00:00Z"})
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    cands = _cands(tmp_path)
    a_sha = "0994b31a453cd0789661e21bb22db8f3e5eb926e"
    assert {s: e["sha"] for s, e in cands.items()} == {
        "mira-hub": C,
        "mira-ask": C,
        "mira-web": a_sha,
    }
    assert not [c for c in _calls(tmp_path) if c[0] == "api" and "/jobs" in c[1]]


def test_a_run_that_failed_after_the_swap_without_a_receipt_is_a_gap(tmp_path):
    """Pre-Codex Claude screen: production can change at the swap and the run still fail
    before the receipt; that run is a gap, not an ignorable failure."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36369296665/artifacts"]["artifacts"].pop(1)
    fx["api"]["actions/runs/36369296665/jobs?per_page=100&filter=all"] = _jobs("failure")
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    assert _cands(tmp_path)["mira-web"]["sha"] is None


def test_a_run_that_never_uploaded_a_receipt_is_skipped(tmp_path):
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36369296665/artifacts"]["artifacts"].pop(1)
    fx["api"]["actions/runs/36369296665/jobs?per_page=100&filter=all"] = _jobs("skipped")
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    assert _cands(tmp_path)["mira-web"]["sha"] == "0994b31a453cd0789661e21bb22db8f3e5eb926e"


@pytest.mark.parametrize(
    "updated,web_resolved",
    [("2026-06-01T00:00:00Z", True), ("2026-10-03T12:00:00Z", False)],
)
def test_an_expired_receipt_is_a_timestamped_gap(tmp_path, updated, web_resolved):
    """Old and expired changes nothing; a recent run with an expired receipt (a re-run) may."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36369296665/artifacts"]["artifacts"][1]["expired"] = True
    _as_dict_runs(fx, **{"36369296665": updated})
    res = _run_record(tmp_path, fx, "mira-hub mira-web mira-ask")
    assert res.returncode == 0, res.stdout + res.stderr
    web = _cands(tmp_path)["mira-web"]["sha"]
    assert (web == "0994b31a453cd0789661e21bb22db8f3e5eb926e") is web_resolved


REFRESH_STEPS = (
    "Gather the production receipts",
    "Designate the recovery candidates",
    "Check each candidate",
    "Record the outcome on issues",
)


def _run_refresh(tmp: Path, fixtures: dict, cap: str = "") -> tuple[list, dict]:
    job_env = _wf(REFRESH)["jobs"]["check"]["env"]
    env = _env(
        tmp,
        fixtures,
        HEAD_SHA=NEW,
        RUN_URL="https://github.com/x/y/actions/runs/1",
        REFRESH_BEFORE_HOURS=job_env["REFRESH_BEFORE_HOURS"],
        PRODUCTION_DEFAULT_SERVICES=job_env["PRODUCTION_DEFAULT_SERVICES"],
        RECEIPT_WALK_DAYS=job_env["RECEIPT_WALK_DAYS"],
        RECEIPT_WALK_CAP=cap or job_env["RECEIPT_WALK_CAP"],
    )
    done = []
    for name in REFRESH_STEPS:
        res = subprocess.run(
            ["bash", "-c", _step(REFRESH, "check", name)["run"]],
            cwd=REPO,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        done.append(res)
        if res.returncode != 0:
            break
    designated = Path(env["RUNNER_TEMP"]) / "designated.json"
    return done, (json.loads(designated.read_text()) if designated.exists() else {})


def _creates(tmp: Path) -> list[list[str]]:
    return [c for c in _calls(tmp) if c[:2] == ["issue", "create"]]


def test_refresh_bootstrap_reports_no_candidate_and_loses_nothing(tmp_path):
    """Today's shape: receipts cover the default set, none records the field yet."""
    done, d = _run_refresh(tmp_path, _prod_fixtures(tmp_path))
    assert [r.returncode for r in done] == [0, 0, 0, 0], [r.stderr for r in done]
    assert d["lost"] == {} and d["designated"] == []
    assert "NO_CANDIDATE" in (tmp_path / "summary").read_text()
    assert _creates(tmp_path) == []


def test_refresh_an_expired_newest_receipt_is_lost_not_bootstrap(tmp_path):
    """Codex #4222 r1 F1: production on B past retention must not read as 'nothing to do'."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36805202089/artifacts"]["artifacts"][1]["expired"] = True
    done, d = _run_refresh(tmp_path, fx)
    assert done[-1].returncode == 1 and len(done) == 4, [r.stderr for r in done]
    assert sorted(d["lost"]) == ["mira-ask", "mira-hub", "mira-web"]
    assert "NO_CANDIDATE" not in (tmp_path / "summary").read_text()
    titles = sorted(_arg(c, "--title") for c in _creates(tmp_path))
    assert titles == [
        f"Rollback designation lost for {s}" for s in ("mira-ask", "mira-hub", "mira-web")
    ]
    assert all(_arg(c, "--label") == "incident" for c in _creates(tmp_path))


def test_refresh_a_vanished_newest_receipt_is_lost(tmp_path):
    """Codex #4222 r2 F1: GitHub omits expired artifacts — absence must not read as bootstrap."""
    fx = _prod_fixtures(tmp_path)
    fx["api"]["actions/runs/36805202089/artifacts"]["artifacts"].pop(1)
    fx["api"]["actions/runs/36805202089/jobs?per_page=100&filter=all"] = _jobs("success")
    done, d = _run_refresh(tmp_path, fx)
    assert done[-1].returncode == 1 and len(done) == 4, [r.stderr for r in done]
    assert sorted(d["lost"]) == ["mira-ask", "mira-hub", "mira-web"]
    assert "may hold a deployment" in d["lost"]["mira-hub"]
    assert len(_creates(tmp_path)) == 3


def test_refresh_a_service_whose_runs_are_gone_is_lost(tmp_path):
    """Codex #4222 r2 F1: with its runs removed too, a default service is LOST, not 'never'."""
    fx = _prod_fixtures(tmp_path)
    fx["runs"] = ["36805202089"]  # only the hub+ask receipt remains
    done, d = _run_refresh(tmp_path, fx)
    assert done[-1].returncode == 1, [r.stderr for r in done]
    assert sorted(d["lost"]) == ["mira-web"]
    assert [_arg(c, "--title") for c in _creates(tmp_path)] == [
        "Rollback designation lost for mira-web"
    ]


def test_refresh_a_vanished_rerun_behind_full_coverage_is_lost(tmp_path):
    """Codex #4222 r3 F7, end to end: an incident, not a stale designation read as ready."""
    d_sha, c_sha = "d" * 40, "c" * 40
    cand = {
        s: {"sha": c_sha, "from_run_id": "36800000000", "reason": "prev"}
        for s in ("mira-hub", "mira-web", "mira-ask")
    }
    body = _receipt(
        d_sha, "36900000200", "2026-10-02T09:50:00Z", ("mira-hub", "mira-web", "mira-ask")
    )
    body["rollback_candidate"] = cand
    fx = {
        "runs": [
            {"id": "36900000200", "updatedAt": "2026-10-02T10:00:00Z"},
            {"id": "36900000100", "updatedAt": "2026-10-04T08:00:00Z"},
        ],
        "api": {
            "actions/runs/36900000200/artifacts": {
                "artifacts": [{"id": 300, "name": f"production-receipt-{d_sha}", "expired": False}]
            },
            "actions/runs/36900000100/artifacts": {"artifacts": []},
            "actions/runs/36900000100/jobs?per_page=100&filter=all": _jobs("success"),
        },
        "zips": {
            "actions/artifacts/300/zip": _zip(tmp_path, "300", "production-receipt.json", body)
        },
    }
    done, d = _run_refresh(tmp_path, fx)
    assert done[-1].returncode == 1 and len(done) == 4, [r.stderr for r in done]
    assert d["designated"] == [] and sorted(d["lost"]) == ["mira-ask", "mira-hub", "mira-web"]
    assert len(_creates(tmp_path)) == 3


def test_refresh_a_truncated_listing_loses_everything(tmp_path):
    """A listing cut at the cap leaves older runs unread: no current receipt can be trusted."""
    done, d = _run_refresh(tmp_path, _prod_fixtures(tmp_path), cap="1")
    assert done[-1].returncode == 1, [r.stderr for r in done]
    assert sorted(d["lost"]) == ["mira-ask", "mira-hub", "mira-web"]
    assert "truncated" in d["lost"]["mira-hub"]


def test_record_a_truncated_listing_leaves_every_candidate_unresolved(tmp_path):
    res = _run_record(tmp_path, _prod_fixtures(tmp_path), "mira-hub mira-web mira-ask", cap="2")
    assert res.returncode == 0, res.stdout + res.stderr
    cands = _cands(tmp_path)
    assert all(e["sha"] is None and "truncated" in e["reason"] for e in cands.values())


def test_record_step_fails_closed_on_a_malformed_receipt(tmp_path):
    res = _run_record(tmp_path, _prod_fixtures(tmp_path, broken_run="36805202089"), "mira-hub")
    assert res.returncode != 0
    assert "rollback_candidates=" not in (tmp_path / "out").read_text()


def test_record_step_fails_closed_when_the_api_fails(tmp_path):
    fixtures = _prod_fixtures(tmp_path)
    del fixtures["api"]["actions/runs/36805202089/artifacts"]
    res = _run_record(tmp_path, fixtures, "mira-hub")
    assert res.returncode != 0


# ── rollback-candidate-refresh.yml: shape ────────────────────────────────────


def test_refresh_triggers_permissions_and_isolation():
    wf = _wf(REFRESH)
    on = wf[True]
    assert set(on) == {"schedule", "workflow_dispatch"}
    assert wf["permissions"] == {}
    job = wf["jobs"]["check"]
    assert job["permissions"] == {"contents": "read", "actions": "read", "issues": "write"}
    assert job["if"] == "github.ref == 'refs/heads/main'"
    assert wf["concurrency"]["group"] != "staging-environment", (
        "must never queue behind or block a staging deploy"
    )
    checkout = job["steps"][0]
    assert checkout["with"] == {
        "ref": "${{ github.sha }}",
        "fetch-depth": 0,
        "persist-credentials": False,
    }


def test_refresh_never_deploys_or_dispatches():
    for step in _wf(REFRESH)["jobs"]["check"]["steps"]:
        run = step.get("run", "")
        assert not re.search(r"^\s*gh workflow run", run, re.M), (
            "the refresh must not dispatch (owner decision pending)"
        )
        assert "${{" not in run, "expressions go through env:, never inline into run:"


def _flags(text: str, tool: str) -> list[str]:
    """The option names passed to `<tool> verify`, in order (values differ by context)."""
    m = re.search(
        re.escape(tool) + r'"?\s+verify\s+(.*?)(?:\|\||\n\s*(?:echo|python3|\[|$))', text, re.S
    )
    assert m, f"{tool} verify invocation not found"
    return re.findall(r"--[a-z-]+", m.group(1))


def test_refresh_verifies_evidence_exactly_as_authorize_source_does():
    deploy = DEPLOY.read_text(encoding="utf-8")
    check = _step(REFRESH, "check", "Check each candidate")["run"]
    for tool in ("staging_receipt.py", "acceptance_receipt.py"):
        assert _flags(check, tool) == _flags(deploy, tool), tool
    assert "--require-capabilities retrieval,capture --require-services mira-hub" in check
    assert "--max-age-hours 168" in check
    # provenance mirrors authorize-source
    assert (
        "workflow_dispatch completed success" in check and "workflow_run completed success" in check
    )


# ── rollback-candidate-refresh.yml: executed ─────────────────────────────────

STUB = """#!/usr/bin/env python3
import os, sys
sys.exit(int(os.environ.get({var!r}, "0")))
"""


def _scratch_repo(tmp: Path, contract: bool) -> tuple[Path, str, str]:
    repo = tmp / "repo"
    (repo / "tools").mkdir(parents=True)
    (repo / "mira-hub/db/migrations").mkdir(parents=True)
    shutil.copy(TOOL, repo / "tools" / "rollback_candidates.py")
    (repo / "tools" / "staging_receipt.py").write_text(STUB.format(var="STAGING_VERIFY_RC"))
    (repo / "tools" / "acceptance_receipt.py").write_text(STUB.format(var="ACCEPTANCE_VERIFY_RC"))
    (repo / "mira-hub/db/migrations/001_a.sql").write_text("CREATE TABLE a (x int);\n")

    def git(*a: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *a], check=True, capture_output=True, text=True
        ).stdout.strip()

    git("init", "-q")
    for k, v in (("user.email", "t@example.com"), ("user.name", "t"), ("commit.gpgsign", "false")):
        git("config", k, v)
    git("add", "-A")
    git("commit", "-q", "-m", "candidate")
    cand = git("rev-parse", "HEAD")
    sql = "ALTER TABLE a DROP COLUMN x;\n" if contract else "ALTER TABLE a ADD COLUMN y int;\n"
    (repo / "mira-hub/db/migrations/002_b.sql").write_text(sql)
    git("add", "-A")
    git("commit", "-q", "-m", "head")
    return repo, cand, git("rev-parse", "HEAD")


def _evidence_fixtures(
    tmp: Path,
    sha: str,
    *,
    staging_age_h: float,
    staging_event: str = "workflow_dispatch",
    with_staging: bool = True,
) -> dict:
    now = datetime.now(timezone.utc)
    staging_run, acc_run = 5001, 6001
    api = {
        f"actions/runs/{staging_run}": {
            "repository": {"full_name": OWNER_REPO},
            "path": ".github/workflows/deploy-staging.yml",
            "event": staging_event,
            "status": "completed",
            "conclusion": "success",
            "html_url": f"https://github.com/{OWNER_REPO}/actions/runs/{staging_run}",
        },
        f"actions/runs/{acc_run}": {
            "repository": {"full_name": OWNER_REPO},
            "path": ".github/workflows/retrieval-acceptance.yml",
            "event": "workflow_run",
            "status": "completed",
            "conclusion": "success",
        },
        f"actions/artifacts?name=staging-receipt-{sha}&per_page=50": {
            "artifacts": (
                [
                    {
                        "id": 71,
                        "expired": False,
                        "created_at": "2026-10-01T00:00:00Z",
                        "workflow_run": {"id": staging_run},
                    }
                ]
                if with_staging
                else []
            )
        },
        f"actions/artifacts?name=acceptance-receipt-{sha}&per_page=50": {
            "artifacts": [
                {
                    "id": 72,
                    "expired": False,
                    "created_at": "2026-10-01T00:00:00Z",
                    "workflow_run": {"id": acc_run},
                }
            ]
        },
    }
    zips = {
        "actions/artifacts/71/zip": _zip(
            tmp,
            "71",
            "staging-receipt.json",
            {"deployed_at": _iso(now - timedelta(hours=staging_age_h))},
        ),
        "actions/artifacts/72/zip": _zip(
            tmp,
            "72",
            "acceptance-receipt.json",
            {"acceptance_run_id": str(acc_run), "expires_at": _iso(now + timedelta(hours=160))},
        ),
    }
    return {"runs": [], "api": api, "zips": zips}


def _run_check(
    tmp: Path, *, services: list, fixtures_for, contract: bool = False, **env_extra: str
):
    """Build the scratch repo, then the fixtures for its candidate SHA, then run the step."""
    repo, cand, head = _scratch_repo(tmp, contract)
    designated = [{"sha": cand, "services": services}] if services else []
    env = _env(tmp, fixtures_for(cand), HEAD_SHA=head, REFRESH_BEFORE_HOURS="72", **env_extra)
    (Path(env["RUNNER_TEMP"]) / "designated.json").write_text(
        json.dumps({"current": {}, "designated": designated, "undesignated": {}}), encoding="utf-8"
    )
    res = subprocess.run(
        ["bash", "-c", _step(REFRESH, "check", "Check each candidate")["run"]],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    results = Path(env["RUNNER_TEMP"]) / "results.tsv"
    rows = (
        [line.split("\t") for line in results.read_text().splitlines()] if results.exists() else []
    )
    return res, rows, cand


def test_no_designated_candidate_is_reported_not_failed(tmp_path):
    res, rows, _ = _run_check(tmp_path, services=[], fixtures_for=lambda cand: {"runs": []})
    assert res.returncode == 0, res.stderr
    assert rows == []
    assert "NO_CANDIDATE" in (tmp_path / "summary").read_text()


@pytest.mark.parametrize(
    "case,evidence,env_extra,contract,expected",
    [
        ("fresh", {"staging_age_h": 1}, {}, False, "FRESH"),
        ("due", {"staging_age_h": 120}, {}, False, "DUE"),
        ("no staging receipt", {"staging_age_h": 1, "with_staging": False}, {}, False, "STALE"),
        (
            "staging from a push run",
            {"staging_age_h": 1, "staging_event": "push"},
            {},
            False,
            "STALE",
        ),
        ("staging verify fails", {"staging_age_h": 1}, {"STAGING_VERIFY_RC": "1"}, False, "STALE"),
        (
            "acceptance verify fails",
            {"staging_age_h": 1},
            {"ACCEPTANCE_VERIFY_RC": "1"},
            False,
            "STALE",
        ),
        ("contracting migration", {"staging_age_h": 1}, {}, True, "INVALID"),
    ],
)
def test_each_candidate_state(tmp_path, case, evidence, env_extra, contract, expected):
    zdir = tmp_path / "z"
    zdir.mkdir()
    res, rows, cand = _run_check(
        tmp_path,
        services=["mira-hub", "mira-ask"],
        fixtures_for=lambda cand: _evidence_fixtures(zdir, cand, **evidence),
        contract=contract,
        **env_extra,
    )
    assert res.returncode == 0, case + res.stdout + res.stderr
    assert len(rows) == 1 and rows[0][0] == cand and rows[0][2] == expected, (case, rows)
    assert rows[0][1] == "mira-hub mira-ask"


# ── rollback-candidate-refresh.yml: issues ───────────────────────────────────

FIELDS = (
    "first_seen",
    "deploy_run",
    "deploy_sha",
    "services",
    "impact",
    "restored_at",
    "restoring_action",
)


def _run_outcome(tmp: Path, rows: list[tuple[str, str, str, str]], issues: list | None = None):
    env = _env(
        tmp, {"runs": [], "issues": issues or []}, RUN_URL="https://github.com/x/y/actions/runs/1"
    )
    (Path(env["RUNNER_TEMP"]) / "results.tsv").write_text(
        "".join("\t".join(r) + "\n" for r in rows), encoding="utf-8"
    )
    res = subprocess.run(
        ["bash", "-c", _step(REFRESH, "check", "Record the outcome on issues")["run"]],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return res, [c for c in _calls(tmp) if c[:1] == ["issue"]]


def _arg(call: list[str], flag: str) -> str:
    return call[call.index(flag) + 1]


@pytest.mark.parametrize("state", ["STALE", "INVALID"])
def test_lost_readiness_opens_an_incident_with_the_fixed_fields_and_fails(tmp_path, state):
    res, calls = _run_outcome(
        tmp_path, [(B, "mira-hub mira-ask", state, "no unexpired staging-receipt")]
    )
    assert res.returncode == 1, res.stdout + res.stderr
    create = next(c for c in calls if c[:2] == ["issue", "create"])
    assert _arg(create, "--label") == "incident"
    assert _arg(create, "--title") == f"Rollback candidate {B[:12]} lost recovery readiness"
    body = _arg(create, "--body").splitlines()
    assert [line.split(":", 1)[0] for line in body[:7]] == list(FIELDS), (
        "§10.3 fixed fields, in order, first"
    )
    assert body[1] == "deploy_run: none" and body[2] == "deploy_sha: none"
    assert body[3] == "services: mira-hub,mira-ask"
    assert body[5] == "restored_at: open" and body[6] == "restoring_action: none"
    assert re.fullmatch(r"first_seen: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body[0])


def test_a_lost_designation_opens_an_incident_with_the_fixed_fields_and_fails(tmp_path):
    res, calls = _run_outcome(
        tmp_path,
        [("none", "mira-web", "LOST", "no production receipt for mira-web within the walk")],
    )
    assert res.returncode == 1, res.stdout + res.stderr
    create = next(c for c in calls if c[:2] == ["issue", "create"])
    assert _arg(create, "--label") == "incident"
    assert _arg(create, "--title") == "Rollback designation lost for mira-web"
    body = _arg(create, "--body").splitlines()
    assert [line.split(":", 1)[0] for line in body[:7]] == list(FIELDS)
    assert body[3] == "services: mira-web"


def test_a_due_refresh_requests_action_without_an_incident(tmp_path):
    res, calls = _run_outcome(
        tmp_path, [(B, "mira-web", "DUE", "evidence valid until X (40.0h left)")]
    )
    assert res.returncode == 0, res.stdout + res.stderr
    create = next(c for c in calls if c[:2] == ["issue", "create"])
    assert "--label" not in create
    assert "reset_volumes=false" in _arg(create, "--body")


def test_fresh_rows_open_nothing(tmp_path):
    res, calls = _run_outcome(tmp_path, [(B, "mira-web", "FRESH", "evidence valid until X")])
    assert res.returncode == 0
    assert [c for c in calls if c[:2] != ["issue", "list"]] == []


def test_an_open_issue_gets_a_comment_not_a_duplicate(tmp_path):
    title = f"Rollback candidate {B[:12]} lost recovery readiness"
    res, calls = _run_outcome(
        tmp_path, [(B, "mira-hub", "STALE", "r")], issues=[{"number": 77, "title": title}]
    )
    assert res.returncode == 1
    assert any(c[:3] == ["issue", "comment", "77"] for c in calls)
    assert not any(c[:2] == ["issue", "create"] for c in calls)
