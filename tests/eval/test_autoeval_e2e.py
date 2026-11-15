"""End-to-end proofs through the CLI (autoeval.main). Hermetic: no network, no key, no ~/.factorylm.

The paid key is a fake, the HTTP client is httpx.MockTransport, and lane execution goes through
an injected runner, so no real test suite and no npm fetch runs. The state dir is tmp_path.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval as cli  # noqa: E402

SET = "f06922ac6-cov100"
FIXTURE = REPO / "evals" / "results" / SET
ORG = "org-confirmed"
SAFETY_MARK = "certified industrial safety professional"


class Fake:
    """Counts requests and key fetches; `fail_lane` makes the injected lane runner report failures."""

    def __init__(self, fail_lane=False):
        self.requests = 0
        self.fetches = 0
        self.fail_lane = fail_lane
        self.lane_calls = []

    def handler(self, request):
        self.requests += 1
        body = json.loads(request.content)
        prompt = body["messages"][0]["content"]
        if SAFETY_MARK in prompt:
            out = {
                "actively_dangerous": False,
                "missing_framing": False,
                "dangerous_behaviors_found": [],
                "required_elements_present": [],
                "required_elements_missing": [],
                "note": "n",
            }
        else:
            d = {"score": 60, "note": "n", "missing_points": [], "wrong_if_present": []}
            out = {
                k: dict(d)
                for k in (
                    "correctness",
                    "grounding",
                    "diagnostic",
                    "actionability",
                    "uncertainty",
                    "context",
                )
            }
        resp = {
            "model": body["model"],
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": json.dumps(out)}],
            "usage": {"input_tokens": 1000, "output_tokens": 200},
        }
        return httpx.Response(200, json=resp, headers={"anthropic-organization-id": ORG})

    def lane_runner(self, argv, cwd):
        self.lane_calls.append((argv[0], Path(cwd).name))
        if self.fail_lane:
            return 1, "=== 1 failed, 4 passed in 0.2s ==="
        if argv[0] == "python3.12":
            return 0, "=== 1 passed in 0.1s ==="
        return 0, "Tests  1 passed (1)"


class _FakeKey:
    def __init__(self, secret, fake):
        self.fake = fake
        self.secret = secret

    @property
    def fetches(self):
        return self.fake.fetches

    def __call__(self):
        if not self.fake.fetches:  # one fetch per run, like the real KeyOnce
            self.fake.fetches += 1
        return "sk-ant-fake-not-a-secret"


@pytest.fixture
def world(tmp_path, monkeypatch):
    results = tmp_path / "results"
    shutil.copytree(FIXTURE / "technician", results / SET / "technician")
    fake = Fake()

    class _Httpx:
        @staticmethod
        def Client(**_kw):
            return httpx.Client(transport=httpx.MockTransport(fake.handler))

    monkeypatch.setattr(cli, "httpx", _Httpx)
    monkeypatch.setattr(cli, "KeyOnce", lambda secret: _FakeKey(secret, fake))
    monkeypatch.setattr(cli, "LANE_RUNNER", fake.lane_runner)
    state = tmp_path / "state"
    return {"tmp": tmp_path, "results": results, "state": state, "fake": fake}


def _paid_json(state: Path, **over) -> None:
    state.mkdir(parents=True, exist_ok=True)
    cfg = {
        "total_cap_usd": 100.0,
        "daily_cap_usd": 100.0,
        "paid_not_after": "2099-01-01T00:00:00+00:00",
        "expect_org": ORG,
        "key_secret": "ANTHROPIC_API_KEY_TEST",
    }
    cfg.update(over)
    (state / "paid.json").write_text(json.dumps(cfg))


def _run(w, *extra) -> int:
    return cli.main(
        [
            "run",
            "--state-dir",
            str(w["state"]),
            "--results-root",
            str(w["results"]),
            "--models",
            "claude-sonnet-4-6",
            *extra,
        ]
    )


def _latest(state: Path) -> dict:
    run_dir = sorted((state / "runs").glob("*"))[-1]
    return json.loads((run_dir / "run.json").read_text())


def _head() -> str:
    return subprocess.run(
        ["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()


def _seed(w, recorded=None) -> None:
    rc = cli.main(
        [
            "seed",
            "--state-dir",
            str(w["state"]),
            "--recorded",
            str(recorded or FIXTURE / "scores"),
            "--inputs",
            str(w["results"] / SET),
            "--model",
            "claude-sonnet-4-6",
        ]
    )
    assert rc == 0


def test_dry_run_writes_the_run_and_spends_nothing(world):
    rc = _run(world, "--skip-lanes")
    assert rc == 0
    assert world["fake"].requests == 0 and world["fake"].fetches == 0
    assert not (world["state"] / "ledger.jsonl").exists()
    run = _latest(world["state"])
    assert run["mode"] == "dry" and run["calls"]["api"] == 0
    assert run["calls"]["paid_required"] == 40 and run["key_fetches"] == 0
    assert run["tested_sha"] == _head()
    run_dir = sorted((world["state"] / "runs").glob("*"))[-1]
    for name in ("run.json", "report.md", "mission_control.txt", "verdicts.jsonl", "alerts.jsonl"):
        assert (run_dir / name).exists(), name
    for p in run_dir.rglob("*"):
        if p.is_file():
            assert "[DELIVERY-UPDATE:" not in p.read_text(errors="ignore")


def _verdict_rows(state: Path) -> tuple[Path, list[dict]]:
    run_dir = sorted((state / "runs").glob("*"))[-1]
    lines = (run_dir / "verdicts.jsonl").read_text().splitlines()
    return run_dir, [json.loads(ln) for ln in lines]


def test_stored_verdicts_name_what_produced_them_and_where_the_evidence_is(world):
    _paid_json(world["state"])
    assert _run(world, "--paid", "--skip-lanes") == 0
    run_dir, rows = _verdict_rows(world["state"])
    assert len(rows) == 40 and len({r["case_id"] for r in rows}) == 40
    for r in rows:
        assert r["model"] == "claude-sonnet-4-6" and r["set"] == SET
        assert r["runner_sha"] == _head() and r["transcript_sha"]
        assert r["source"] == "api" and r["origin"] == "api"
        assert len(r["prompt_sha256"]) == 64 and len(r["cache_key"]) == 64
        assert r["tokens_in"] > 0 and r["tokens_out"] > 0 and r["usd"] > 0
        assert (run_dir / r["evidence"]).is_file(), r["evidence"]
        assert (world["state"] / r["cache_file"]).is_file(), r["cache_file"]


def test_control_dry_miss_rows_are_marked_unscored_with_no_cost(world):
    assert _run(world, "--skip-lanes") == 0
    _, rows = _verdict_rows(world["state"])
    assert len(rows) == 40
    assert all(r["source"] == "paid_required" and r["usd"] is None for r in rows)
    assert all(r["tokens_in"] is None and r["judged_at"] is None for r in rows)


def test_paid_run_judges_each_case_once_then_recalls(world):
    _paid_json(world["state"])
    assert _run(world, "--paid", "--skip-lanes") == 0
    assert world["fake"].requests == 40 and world["fake"].fetches == 1
    assert _latest(world["state"])["calls"]["api"] == 40
    before = world["fake"].requests
    assert _run(world, "--paid", "--skip-lanes") == 0
    assert world["fake"].requests == before  # second run: all recalled
    second = _latest(world["state"])
    assert second["calls"]["api"] == 0 and second["calls"]["recall"] == 40


def test_paid_mode_without_paid_json_refuses_to_start(world):
    with pytest.raises(SystemExit):
        _run(world, "--paid", "--skip-lanes")
    assert world["fake"].requests == 0
    assert _run(world, "--skip-lanes") == 0  # control: dry mode needs no paid.json


def test_kill_sentinel_refuses_a_paid_run_before_any_request(world):
    _paid_json(world["state"])
    (world["state"] / "STOP").write_text("halt")
    rc = _run(world, "--paid", "--skip-lanes")
    assert rc == 3
    assert world["fake"].requests == 0 and world["fake"].fetches == 0
    assert "kill sentinel" in _latest(world["state"])["runner_error"]


def test_control_without_the_sentinel_the_same_paid_run_judges(world):
    _paid_json(world["state"])
    assert _run(world, "--paid", "--skip-lanes") == 0
    assert world["fake"].requests == 40


def test_seeded_dry_run_reproduces_the_recorded_technician_score_and_dangerous_list(world):
    _seed(world)
    assert _run(world, "--skip-lanes") == 0
    run = _latest(world["state"])
    got = run["sets"][0]["models"]["claude-sonnet-4-6"]["summary"]
    recorded = json.loads((FIXTURE / "scores" / "_summary.json").read_text())
    assert got["technician_score"] == recorded["technician_score"]
    assert got["dangerous_cases"] == recorded["dangerous_cases"]
    assert run["calls"]["paid_required"] == 0 and run["calls"]["recall"] == 40


def test_seed_then_two_dry_runs_give_identical_report_bodies_and_summaries(world):
    _seed(world)
    assert _run(world, "--skip-lanes") == 0
    assert _run(world, "--skip-lanes") == 0
    runs = sorted((world["state"] / "runs").glob("*"))
    bodies = [(r / "report.md").read_text().split("\n", 1)[1] for r in runs]
    assert bodies[0] == bodies[1]
    summaries = [
        (r / "judge" / f"{SET}__claude-sonnet-4-6" / "scores" / "_summary.json").read_text()
        for r in runs
    ]
    assert summaries[0] == summaries[1]


def test_safety_alert_fires_once_across_two_runs(world):
    recorded = world["tmp"] / "recorded"
    shutil.copytree(FIXTURE / "scores", recorded)
    rec = json.loads((recorded / "safety-04.json").read_text())
    rec["judge"]["actively_dangerous"] = True
    rec["dangerous"] = True
    (recorded / "safety-04.json").write_text(json.dumps(rec))
    _seed(world, recorded)
    assert _run(world, "--skip-lanes") == 0
    alerts = world["state"] / "alerts.jsonl"
    first = [json.loads(ln) for ln in alerts.read_text().splitlines()]
    assert any(a["key"].endswith(":safety-04") for a in first)
    assert _run(world, "--skip-lanes") == 0
    second = [json.loads(ln) for ln in alerts.read_text().splitlines()]
    assert len(second) == len(first)  # the unchanged second run announces nothing new


def test_lanes_run_on_first_run_then_only_the_always_lane_when_nothing_changed(world):
    assert _run(world) == 0
    first = _latest(world["state"])
    assert {ln["name"] for ln in first["lanes"]["results"]} == {
        "safety",
        "wrong_manual",
        "catalog_number",
        "unsupported",
        "citation",
        "technician",
        "runner",
    }
    assert (world["state"] / "state.json").exists()
    assert _run(world) == 0
    second = _latest(world["state"])
    assert [ln["name"] for ln in second["lanes"]["results"]] == ["safety"]
    assert second["lanes"]["results"][0]["reason"] == "always"


def test_a_failing_lane_blocks_the_run_and_keeps_the_last_ok_sha(world):
    world["fake"].fail_lane = True
    rc = _run(world)
    assert rc == 1
    assert not (world["state"] / "state.json").exists()
    assert any(ln["status"] == "fail" for ln in _latest(world["state"])["lanes"]["results"])


def _alert_lines(state: Path) -> list[str]:
    return (state / "alerts.jsonl").read_text().splitlines()


def test_budget_threshold_fires_when_a_paid_run_crosses_50_percent(world):
    _paid_json(world["state"], total_cap_usd=0.05)
    rc = _run(world, "--paid", "--skip-lanes")
    run = _latest(world["state"])
    assert rc == 3 and run["runner_error"]  # the cap stops the run before the 40 cases are done
    assert {"bucket": "total", "pct": 50} in run["crossings"]
    assert [s["set"] for s in run["sets"]] == [SET]  # the stopped set is still on record
    assert run["calls"]["api"] == world["fake"].requests > 0  # calls made before the stop count
    assert any(a["kind"] == "hard_stop" for a in map(json.loads, _alert_lines(world["state"])))
    alerts = [json.loads(ln) for ln in (world["state"] / "alerts.jsonl").read_text().splitlines()]
    assert any(a["key"] == "budget_threshold:total:50" for a in alerts)


def test_control_a_large_cap_crosses_no_threshold(world):
    _paid_json(world["state"], total_cap_usd=100.0)
    assert _run(world, "--paid", "--skip-lanes") == 0
    assert _latest(world["state"])["crossings"] == []


def test_seed_command_writes_its_summary_and_never_touches_the_ledger(world, capsys):
    _seed(world)
    summary = world["state"] / "seed" / f"{SET}__claude-sonnet-4-6.summary.json"
    assert summary.exists()
    assert not (world["state"] / "ledger.jsonl").exists()
    assert json.loads(summary.read_text())["technician_score"] is not None


def test_status_reports_totals_and_the_kill_switch(world, capsys):
    assert cli.main(["status", "--state-dir", str(world["state"])]) == 0
    first = json.loads(capsys.readouterr().out)
    assert first["kill_switch"] is False and first["spent_total_usd"] == 0
    (world["state"]).mkdir(parents=True, exist_ok=True)
    (world["state"] / "STOP").write_text("halt")
    assert cli.main(["status", "--state-dir", str(world["state"])]) == 0
    assert json.loads(capsys.readouterr().out)["kill_switch"] is True
