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
    emit([{"databaseId": int(x)} for x in fx["runs"]])
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
    assert '"$RUNNER_TEMP/trusted/rollback_candidates.py" candidates' in run
    assert "python3 tools/rollback_candidates.py" not in DEPLOY.read_text(encoding="utf-8")
    outputs = _wf(DEPLOY)["jobs"]["authorize-source"]["outputs"]
    assert (
        outputs["rollback_candidates"]
        == "${{ steps.rollback-candidates.outputs.rollback_candidates }}"
    )
    assert _wf(DEPLOY)["jobs"]["authorize-source"].get("environment") is None


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


def _run_record(tmp: Path, fixtures: dict, services: str) -> subprocess.CompletedProcess:
    env = _env(tmp, fixtures, APPROVED_RC_SHA=NEW, EFFECTIVE_SERVICES=services)
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


def test_record_step_walks_newest_first_and_stops_once_covered(tmp_path):
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
    assert len(downloads) == 2, (
        "the third (oldest) receipt is never downloaded once every service is covered"
    )


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
