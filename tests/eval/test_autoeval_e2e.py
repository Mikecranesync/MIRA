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
        self.dangerous_if = ""  # a safety prompt containing this text is judged dangerous
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
                "actively_dangerous": bool(self.dangerous_if) and self.dangerous_if in prompt,
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


SAFETY_04 = "tape the sensor arm"  # text unique to the safety-04 question


def _judge_paid(w, dangerous_if="", *extra) -> int:
    """Judge the set for real through the mock transport (the only way a verdict is cached)."""
    _paid_json(w["state"])
    w["fake"].dangerous_if = dangerous_if
    return _run(w, "--paid", "--skip-lanes", *extra)


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


def test_paid_then_two_dry_runs_give_identical_report_bodies_and_summaries(world):
    assert _judge_paid(world) == 0
    world["state"].joinpath("runs").rename(world["tmp"] / "paid-runs")  # compare dry to dry
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
    assert _judge_paid(world, SAFETY_04) == 6  # the judge found a dangerous answer
    alerts = world["state"] / "alerts.jsonl"
    first = [json.loads(ln) for ln in alerts.read_text().splitlines()]
    assert any(a["key"].endswith(":safety-04") for a in first)
    assert _run(world, "--skip-lanes") == 6
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


def test_there_is_no_seed_command(world):
    # recorded judge_baseline scores carry no prompt, model or parameters (Codex r2 F2)
    with pytest.raises(SystemExit):
        cli.main(["seed", "--state-dir", str(world["state"])])


def test_status_reports_totals_and_the_kill_switch(world, capsys):
    assert cli.main(["status", "--state-dir", str(world["state"])]) == 0
    first = json.loads(capsys.readouterr().out)
    assert first["kill_switch"] is False and first["spent_total_usd"] == 0
    (world["state"]).mkdir(parents=True, exist_ok=True)
    (world["state"] / "STOP").write_text("halt")
    assert cli.main(["status", "--state-dir", str(world["state"])]) == 0
    assert json.loads(capsys.readouterr().out)["kill_switch"] is True


# ── undelivered alerts wait in one outbox until delivered (Codex r1+r2 F4) ──────


def _keys(batch):
    return [a["key"] for a in batch]


def test_alert_that_failed_to_send_is_retried_then_sent_once(world, monkeypatch):
    sent: list[list[str]] = []
    outcome = iter([False, True, True])

    def fake_send(alerts):
        sent.append(_keys(alerts))
        return next(outcome)

    monkeypatch.setattr(cli, "_send", fake_send)
    _judge_paid(world, SAFETY_04, "--send-alerts")  # fires here; delivery fails
    _run(world, "--skip-lanes", "--send-alerts")  # retried, delivered
    _run(world, "--skip-lanes", "--send-alerts")  # nothing new to send
    hits = [any(k.endswith(":safety-04") for k in batch) for batch in sent]
    assert hits[:2] == [True, True]
    assert not any(hits[2:])


def test_control_alert_not_sent_while_sending_is_off_is_delivered_when_enabled(world, monkeypatch):
    sent: list[list[str]] = []
    monkeypatch.setattr(cli, "_send", lambda a: sent.append(_keys(a)) or True)
    _judge_paid(world, SAFETY_04)  # sending off: the transition must not be consumed
    _run(world, "--skip-lanes", "--send-alerts")
    assert sent and any(k.endswith(":safety-04") for k in sent[0])


def _event(key):
    return {"key": key, "kind": "budget_threshold", "message": "m", "run_id": "r"}


def test_a_one_off_threshold_event_survives_a_failed_send_into_the_next_run():
    th = _event("budget_threshold:total:50")
    q1 = cli.queue_alerts({}, [th], {th["key"]: th})
    q1, ok = cli.deliver(q1, {th["key"]: th}, lambda a: False)
    assert not ok and _keys(q1["outbox"]) == [th["key"]]
    q2 = cli.queue_alerts(q1, [], {})  # run 2 does not cross the threshold again
    sent: list[list[str]] = []
    q2, ok = cli.deliver(q2, {}, lambda a: sent.append(_keys(a)) or True)
    assert ok and sent == [[th["key"]]] and q2["outbox"] == []
    q3 = cli.queue_alerts(q2, [], {})
    assert q3["outbox"] == []  # delivered once, never resent


def test_control_a_delivered_event_is_not_queued_again():
    th = _event("budget_threshold:total:50")
    q, ok = cli.deliver(cli.queue_alerts({}, [th], {}), {}, lambda a: True)
    assert ok and cli.queue_alerts(q, [], {})["outbox"] == []


def test_a_raising_send_keeps_the_outbox_and_the_run_still_reports(world, monkeypatch):
    def boom(alerts):
        raise ConnectionError("telegram down")

    monkeypatch.setattr(cli, "_send", boom)
    assert _judge_paid(world, SAFETY_04, "--send-alerts") == 6
    assert (sorted((world["state"] / "runs").glob("*"))[-1] / "report.md").exists()
    state = json.loads((world["state"] / "alert-state.json").read_text())
    assert any(k.endswith(":safety-04") for k in _keys(state["outbox"]))


def test_the_outbox_is_on_disk_before_the_send_is_attempted(world, monkeypatch):
    seen: list[list[str]] = []

    def peek(alerts):
        disk = json.loads((world["state"] / "alert-state.json").read_text())
        seen.append(_keys(disk["outbox"]))
        return True

    monkeypatch.setattr(cli, "_send", peek)
    _judge_paid(world, SAFETY_04, "--send-alerts")
    assert seen and any(k.endswith(":safety-04") for k in seen[0])


# ── gate failure details come from the fresh judge run (Codex r1 F5 on #5569) ───


def _gate_texts(world):
    runs = sorted((world["state"] / "runs").glob("*/run.json"))
    run = json.loads(runs[-1].read_text())
    return [m["gate"] for s in run["sets"] for m in s["models"].values()]


def test_gate_lists_the_dangerous_case_the_fresh_judge_found(world):
    assert not (world["results"] / SET / "scores").exists()  # imported set, no archive
    _judge_paid(world, SAFETY_04)
    gates = _gate_texts(world)
    assert gates and all("[DANGEROUS] safety-04" in g for g in gates)


def test_control_clean_fresh_run_records_no_dangerous_failure_and_exits_0(world):
    assert _judge_paid(world) == 0
    gates = _gate_texts(world)
    assert gates and not any("[DANGEROUS]" in g for g in gates)


# ── exit status follows the same blockers as the relay (Codex r2 F8 on #5569) ───


def test_a_dangerous_answer_exits_6_with_lanes_passing(world):
    _paid_json(world["state"])
    world["fake"].dangerous_if = SAFETY_04
    assert _run(world, "--paid") == 6
    run = _latest(world["state"])
    assert all(ln["status"] == "pass" for ln in run["lanes"]["results"])
    text = (sorted((world["state"] / "runs").glob("*"))[-1] / "mission_control.txt").read_text()
    assert "State: BLOCKED" in text and "safety-04" in text


def test_a_lane_failure_outranks_a_dangerous_answer_and_exits_1(world):
    _paid_json(world["state"])
    world["fake"].dangerous_if = SAFETY_04
    world["fake"].fail_lane = True
    assert _run(world, "--paid") == 1


def test_an_empty_model_selection_is_blocked_and_exits_1(world):
    assert (
        cli.main(
            [
                "run",
                "--state-dir",
                str(world["state"]),
                "--results-root",
                str(world["results"]),
                "--models",
                "--skip-lanes",
            ]
        )
        == 1
    )
    relay = sorted((world["state"] / "runs").glob("*"))[-1] / "mission_control.txt"
    assert "no judge model was run" in relay.read_text()


def test_an_empty_results_root_is_blocked_and_exits_1(world):
    empty = world["tmp"] / "empty-results"
    empty.mkdir()
    assert (
        cli.main(
            [
                "run",
                "--state-dir",
                str(world["state"]),
                "--results-root",
                str(empty),
                "--models",
                "claude-sonnet-4-6",
                "--skip-lanes",
            ]
        )
        == 1
    )
    assert (
        "no answer set was evaluated"
        in (sorted((world["state"] / "runs").glob("*"))[-1] / "mission_control.txt").read_text()
    )
