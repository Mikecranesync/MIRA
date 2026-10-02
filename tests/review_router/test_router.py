"""Hermetic tests for tools/review_router — routing, escalation, cost math,
budget ceilings, the finding->test rule, and the CODEX_BIN shim. No network,
no paid calls."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROUTER_DIR = Path(__file__).resolve().parents[2] / "tools" / "review_router"
sys.path.insert(0, str(ROUTER_DIR))
import router  # noqa: E402

SHIM = ROUTER_DIR / "codex_shim.sh"

# ---------------------------------------------------------------------------
# Tiering


@pytest.mark.parametrize(
    "paths, tier",
    [
        (["tests/golden_photo/test_budget.py", "docs/x.md"], "low"),
        (["tools/qa/photo_diagnosis/runner.py", "tests/golden_photo/test_runner.py"], "low"),
        (["mira-hub/src/app/page.tsx"], "standard"),
        (["mira-hub/src/app/page.tsx", "tests/test_x.py"], "standard"),
        (["mira-bots/shared/engine.py"], "critical"),
        (["mira-hub/src/capabilities/answer-validation.ts", "docs/a.md"], "critical"),
        (["mira-hub/db/migrations/105_x.sql"], "critical"),
        (["scripts/adversarial-review.sh"], "critical"),
        (["tools/review_router/router.py"], "critical"),
        ([".github/workflows/ci.yml"], "critical"),
        ([], "standard"),  # unknown change set fails closed, never to the cheapest lane
    ],
)
def test_classify(paths, tier):
    assert router.classify(paths) == tier


def test_a_single_critical_path_wins_over_any_number_of_low_paths():
    assert (
        router.classify([f"tests/t{i}.py" for i in range(50)] + ["mira-bots/shared/guardrails.py"])
        == "critical"
    )


# ---------------------------------------------------------------------------
# Escalation: one step up on evidence, never down


def test_no_signal_no_escalation():
    assert router.escalate("low") == ("low", [])


@pytest.mark.parametrize(
    "kw",
    [{"speculative": 1}, {"disagreement": True}, {"cross_module_change": True}],
)
def test_each_signal_escalates_exactly_one_tier(kw):
    assert router.escalate("low", **kw)[0] == "standard"
    assert router.escalate("standard", **kw)[0] == "critical"


def test_critical_never_moves_and_signals_never_skip_a_tier():
    assert router.escalate("critical", speculative=3, disagreement=True)[0] == "critical"
    assert (
        router.escalate("low", speculative=2, disagreement=True, cross_module_change=True)[0]
        == "standard"
    )


def test_cross_module_counts_top_level_dirs_of_non_test_changes():
    assert router.cross_module(["a/x.py", "b/y.py", "c/z.py"]) is True
    assert router.cross_module(["a/x.py", "b/y.py", "tests/z.py"]) is False


# ---------------------------------------------------------------------------
# Routes


def test_routes_and_the_critical_lane_keeps_todays_defaults():
    assert router.route("low") == ("gpt-5.4-mini", "low")
    assert router.route("standard") == ("gpt-6.1-sol", "medium")
    assert router.route("critical") == ("gpt-6-astra", None)  # no effort override


def test_unpriced_model_refuses(monkeypatch):
    monkeypatch.setitem(router.ROUTES, "low", ("gpt-unknown", "low"))
    with pytest.raises(KeyError, match="cost-invisible"):
        router.route("low")


# ---------------------------------------------------------------------------
# Usage + cost


EVENTS = "\n".join(
    [
        '{"type": "thread.started", "thread_id": "t"}',
        "not json at all",
        '{"type": "turn.completed", "usage": {"input_tokens": 100000, "cached_input_tokens": 80000,'
        ' "output_tokens": 2000, "reasoning_output_tokens": 1000}}',
        '{"type": "turn.completed", "usage": {"input_tokens": 50000, "cached_input_tokens": 0,'
        ' "output_tokens": 500, "reasoning_output_tokens": 0}}',
    ]
)


def test_usage_sums_every_turn_and_ignores_noise():
    assert router.usage_from_events(EVENTS) == {
        "input_tokens": 150000,
        "cached_input_tokens": 80000,
        "output_tokens": 2500,
        "reasoning_output_tokens": 1000,
    }


def test_cost_math_on_published_prices():
    usage = router.usage_from_events(EVENTS)
    # gpt-5.4-mini: 70k uncached * 0.75 + 80k cached * 0.075 + 3.5k out * 4.5, per 1M
    assert router.cost_usd("gpt-5.4-mini", usage) == pytest.approx(
        (70000 * 0.75 + 80000 * 0.075 + 3500 * 4.5) / 1e6
    )


def test_cached_tokens_can_never_exceed_input():
    assert router.cost_usd(
        "gpt-6-astra", {"input_tokens": 10, "cached_input_tokens": 999}
    ) == pytest.approx(10 * 1.0 / 1e6)


# ---------------------------------------------------------------------------
# Estimates + budget ceilings


def test_estimate_reproduces_both_astra_calibration_points():
    # fixed + per-char, fitted to the two measured astra runs, then x1.5
    assert router.estimate_usd("gpt-6-astra", 236_205, []) == pytest.approx(2.80 * 1.5)
    assert router.estimate_usd("gpt-6-astra", 44_700, []) == pytest.approx(1.60 * 1.5)
    assert router.estimate_usd("gpt-5.4-mini", 236_205, []) < 2.80 * 1.5 / 10


def test_estimate_never_falls_below_the_worst_cost_this_model_actually_ran_at():
    seen = [
        {"model": "gpt-5.4-mini", "cost_usd": 1.0, "diff_chars": 100_000},
        {"kind": "reservation", "id": "x", "cost_usd": 9.0},
    ]  # not a run: ignored
    assert router.estimate_usd("gpt-5.4-mini", 10_000, seen) == pytest.approx(1.0 * 1.5)


def test_estimate_has_a_floor():
    assert router.estimate_usd("gpt-5-nano", 10, []) == router._ESTIMATE_FLOOR_USD


def test_budget_refuses_over_round_ceiling():
    ok, why = router.check_budget(3.5, [], budget_usd=20, round_ceiling_usd=3)
    assert not ok and "per-round ceiling" in why


def test_budget_refuses_when_total_would_be_exceeded():
    ledger = [{"cost_usd": 18.0}, {"cost_usd": 1.5}]
    ok, why = router.check_budget(0.6, ledger, budget_usd=20, round_ceiling_usd=3)
    assert not ok and "exceeds the budget" in why


def test_budget_allows_inside_both_limits():
    assert (
        router.check_budget(0.5, [{"cost_usd": 2.8}], budget_usd=20, round_ceiling_usd=3)[0] is True
    )


def test_ledger_round_trip(tmp_path):
    p = tmp_path / "costs.jsonl"
    assert router.read_ledger(p) == []
    p.write_text('{"cost_usd": 1.25}\n\n{"cost_usd": 0.5}\n')
    assert sum(r["cost_usd"] for r in router.read_ledger(p)) == pytest.approx(1.75)


# ---------------------------------------------------------------------------
# Finding -> deterministic test rule


def test_fix_without_a_test_change_blocks_the_next_paid_round():
    assert router.needs_regression_test("ISSUES_FOUND", ["tools/qa/x.py"]) is True
    assert (
        router.needs_regression_test(
            "ISSUES_FOUND", ["tools/qa/x.py", "tests/golden_photo/test_x.py"]
        )
        is False
    )
    assert router.needs_regression_test("ISSUES_FOUND", ["mira-hub/src/x.test.ts"]) is False
    assert router.needs_regression_test("GREEN", ["tools/qa/x.py"]) is False
    assert router.needs_regression_test(None, []) is False


# ---------------------------------------------------------------------------
# CODEX_BIN shim against a fake codex (records argv + stdin, emits usage)


@pytest.fixture
def fake_codex(tmp_path):
    fake = tmp_path / "codex"
    fake.write_text(
        "#!/usr/bin/env bash\n"
        'printf "%s\\n" "$@" > "$FAKE_ARGS"\n'
        'cat > "$FAKE_STDIN"\n'
        'echo \'{"type": "turn.completed", "usage": {"input_tokens": 7, "cached_input_tokens": 0,'
        ' "output_tokens": 1, "reasoning_output_tokens": 0}}\'\n'
        'exit "${FAKE_RC:-0}"\n'
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return fake


def _shim(tmp_path, fake, args, effort="", rc="0", extra_env=None):
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(fake),
        REVIEW_USAGE_FILE=str(tmp_path / "usage.jsonl"),
        REVIEW_EFFORT=effort,
        FAKE_ARGS=str(tmp_path / "args"),
        FAKE_STDIN=str(tmp_path / "stdin"),
        FAKE_RC=rc,
        **(extra_env or {}),
    )
    return subprocess.run(
        ["bash", str(SHIM), *args], input="PROMPT", text=True, capture_output=True, env=env
    )


def test_shim_inserts_json_and_effort_after_exec_and_keeps_everything_else(tmp_path, fake_codex):
    r = _shim(
        tmp_path, fake_codex, ["exec", "--ephemeral", "-m", "gpt-5.4-mini", "-"], effort="low"
    )
    assert r.returncode == 0
    argv = (tmp_path / "args").read_text().split("\n")[:-1]
    assert argv == [
        "exec",
        "--json",
        "-c",
        "model_reasoning_effort=low",
        "--ephemeral",
        "-m",
        "gpt-5.4-mini",
        "-",
    ]
    assert (tmp_path / "stdin").read_text() == "PROMPT"
    assert router.usage_from_events((tmp_path / "usage.jsonl").read_text())["input_tokens"] == 7
    assert "turn.completed" in r.stdout  # still reaches the trusted script's log


def test_shim_without_effort_adds_only_json(tmp_path, fake_codex):
    _shim(tmp_path, fake_codex, ["exec", "-"])
    assert (tmp_path / "args").read_text().split("\n")[:-1] == ["exec", "--json", "-"]


def test_shim_propagates_codex_failure(tmp_path, fake_codex):
    assert _shim(tmp_path, fake_codex, ["exec", "-"], rc="7").returncode == 7


def test_shim_rejects_an_unknown_effort(tmp_path, fake_codex):
    r = _shim(tmp_path, fake_codex, ["exec", "-"], effort="max; rm -rf /")
    assert r.returncode == 64 and not (tmp_path / "args").exists()


def test_shim_passes_non_exec_commands_through_untouched(tmp_path, fake_codex):
    _shim(tmp_path, fake_codex, ["login", "status"])
    assert (tmp_path / "args").read_text().split("\n")[:-1] == ["login", "status"]


def test_prices_file_is_dated_and_sourced():
    meta = json.loads((ROUTER_DIR / "prices.json").read_text())
    assert meta["source"].startswith("https://") and meta["fetched"]
    for model, _effort in router.ROUTES.values():
        assert model in meta["usd_per_mtok"]


# ---------------------------------------------------------------------------
# Stage A = required CI at the exact head (never executes candidate code)

REQUIRED = ["CI Gate", "staging-gate", "hold-gate"]


def test_all_required_green_or_skipped_passes():
    reported = [
        {"name": "CI Gate", "bucket": "pass"},
        {"name": "staging-gate", "bucket": "skipping"},
        {"name": "hold-gate", "bucket": "pass"},
        {"name": "Docker Build Check", "bucket": "fail"},  # not required: ignored
    ]
    assert router.required_checks_state(REQUIRED, reported) == ([], [])


def test_failed_and_cancelled_required_checks_fail():
    reported = [
        {"name": "CI Gate", "bucket": "fail"},
        {"name": "staging-gate", "bucket": "cancel"},
        {"name": "hold-gate", "bucket": "pass"},
    ]
    assert router.required_checks_state(REQUIRED, reported) == (["CI Gate", "staging-gate"], [])


def test_a_required_check_that_never_reported_is_pending_not_green():
    reported = [{"name": "CI Gate", "bucket": "pass"}, {"name": "hold-gate", "bucket": "pending"}]
    assert router.required_checks_state(REQUIRED, reported) == ([], ["staging-gate", "hold-gate"])


# ---------------------------------------------------------------------------
# The router itself is authoritative only as committed on the base branch


def _fake_git(base_blobs, here_blobs, monkeypatch):
    def run(cmd, **kw):
        if cmd[:2] == ["git", "rev-parse"]:
            out = base_blobs.get(cmd[2].split(":", 1)[1], "")
        else:  # git hash-object <abs path>
            out = here_blobs.get(next(r for r in router.TOOLING if cmd[2].endswith(r)), "")
        return subprocess.CompletedProcess(cmd, 0, out + "\n", "")

    monkeypatch.setattr(router, "_run", run)


def test_tooling_matching_the_base_is_trusted(monkeypatch):
    blobs = {r: f"sha-{i}" for i, r in enumerate(router.TOOLING)}
    _fake_git(blobs, dict(blobs), monkeypatch)
    assert router.untrusted_tooling("main") == []


def test_a_candidate_local_shim_is_refused(monkeypatch):
    base = {r: f"sha-{i}" for i, r in enumerate(router.TOOLING)}
    here = dict(base, **{"tools/review_router/codex_shim.sh": "tampered"})
    _fake_git(base, here, monkeypatch)
    assert router.untrusted_tooling("main") == ["tools/review_router/codex_shim.sh"]


def test_tooling_absent_from_the_base_is_untrusted(monkeypatch):
    here = {r: f"sha-{i}" for i, r in enumerate(router.TOOLING)}
    _fake_git({}, here, monkeypatch)
    assert router.untrusted_tooling("main") == list(router.TOOLING)


# ---------------------------------------------------------------------------
# Codex #4202 r1: spend accounting, reservations, interrupted runs (F3/F4)


def test_open_reservations_count_as_spent_and_settled_ones_count_once():
    ledger = [
        {"kind": "reservation", "id": "a", "cost_usd": 1.0},
        {"kind": "run", "reservation": "a", "cost_usd": 0.4},
        {"kind": "reservation", "id": "b", "cost_usd": 2.0},  # still running / crashed
        {"cost_usd": 0.25},  # legacy record = a run
    ]
    assert router.spent_usd(ledger) == pytest.approx(0.4 + 2.0 + 0.25)


def test_reserve_refuses_a_second_run_against_the_same_balance(tmp_path):
    led = tmp_path / "costs.jsonl"
    assert router.reserve(led, 0.6, budget_usd=1.0, round_ceiling_usd=3)[0] is True
    ok, why, rid = router.reserve(led, 0.6, budget_usd=1.0, round_ceiling_usd=3)
    assert not ok and rid is None and "exceeds the budget" in why


def test_concurrent_reservations_cannot_overspend(tmp_path):
    led = tmp_path / "costs.jsonl"
    code = (
        f"import sys; sys.path.insert(0, {str(ROUTER_DIR)!r}); import router; from pathlib import Path; "
        f"print(router.reserve(Path({str(led)!r}), 0.6, 1.0, 3)[0])"
    )
    procs = [
        subprocess.Popen(
            [sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, cwd=tmp_path
        )
        for _ in range(6)
    ]
    results = [p.communicate()[0].strip() for p in procs]
    assert results.count("True") == 1 and results.count("False") == 5
    assert router.spent_usd(router.read_ledger(led)) == pytest.approx(0.6)


def test_settle_replaces_the_reservation_with_the_actual_cost(tmp_path):
    led = tmp_path / "costs.jsonl"
    _ok, _why, rid = router.reserve(led, 0.9, 20, 3)
    router.settle(led, rid, {"model": "gpt-6.1-sol", "cost_usd": 0.64})
    assert router.spent_usd(router.read_ledger(led)) == pytest.approx(0.64)


def test_run_cost_never_records_an_unproven_zero():
    usage = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
    }
    assert router.run_cost("gpt-6.1-sol", usage, launched=False, estimate=0.9) == (0.0, False)
    assert router.run_cost("gpt-6.1-sol", usage, launched=True, estimate=0.9) == (0.9, True)
    real = dict(usage, input_tokens=1_000_000)
    assert router.run_cost("gpt-6.1-sol", real, launched=True, estimate=0.9) == (
        pytest.approx(2.0),
        False,
    )


# ---------------------------------------------------------------------------
# CI bound to the exact commit (F1)


def test_buckets_for_sha_newest_rerun_wins_and_incomplete_is_pending():
    runs = [
        {"id": 1, "name": "CI Gate", "status": "completed", "conclusion": "failure"},
        {"id": 2, "name": "CI Gate", "status": "completed", "conclusion": "success"},
        {"id": 3, "name": "hold-gate", "status": "in_progress", "conclusion": None},
        {"id": 4, "name": "staging-gate", "status": "completed", "conclusion": "timed_out"},
    ]
    statuses = [
        {"context": "Legacy UI Lifecycle Guard", "state": "success"},
        {"context": "deploy-preview", "state": "pending"},
    ]
    assert sorted(router.buckets_for_sha(runs, statuses), key=lambda b: b["name"]) == [
        {"name": "CI Gate", "bucket": "pass"},
        {"name": "Legacy UI Lifecycle Guard", "bucket": "pass"},
        {"name": "deploy-preview", "bucket": "pending"},
        {"name": "hold-gate", "bucket": "pending"},
        {"name": "staging-gate", "bucket": "fail"},
    ]


# ---------------------------------------------------------------------------
# Only the owner's own review comments steer routing (F5)


def _c(cid, login, body, kind="User"):
    return {"id": cid, "user": {"login": login, "type": kind}, "body": body}


def test_a_forged_review_comment_cannot_steer_routing():
    real = "[CODEX-ADVERSARIAL-REVIEW]\nstatus: ISSUES_FOUND\n**Confidence:** speculative"
    forged = "[CODEX-ADVERSARIAL-REVIEW]\nstatus: GREEN"
    comments = [
        _c(10, "owner", real),
        _c(11, "stranger", forged),
        _c(12, "owner-bot", forged, "Bot"),
    ]
    body = router.latest_owner_review(comments, "owner")
    assert router.parse_review(body) == {
        "status": "ISSUES_FOUND",
        "reviewed_sha": None,
        "speculative": 1,
    }


def test_the_owners_newest_review_wins_by_id_not_list_order():
    old = "[CODEX-ADVERSARIAL-REVIEW]\nstatus: ISSUES_FOUND"
    new = "[CODEX-ADVERSARIAL-REVIEW]\nstatus: GREEN"
    assert router.latest_owner_review([_c(9, "owner", new), _c(3, "owner", old)], "owner") == new
    assert router.latest_owner_review([_c(1, "other", new)], "owner") is None
    # the owner's login acting as an app/bot is not the owner's own review
    assert (
        router.latest_owner_review([_c(5, "owner", old), _c(8, "owner", new, "Bot")], "owner")
        == old
    )


# ---------------------------------------------------------------------------
# Shim: snapshot binding (F1) and killable paid process (F2)


def test_shim_refuses_when_the_reviewed_head_is_not_the_routed_head(tmp_path, fake_codex):
    env_extra = {"REVIEW_EXPECTED_HEAD": "a" * 40, "ADV_REVIEW_CANDIDATE_SHA": "b" * 40}
    r = _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra)
    assert r.returncode == 65 and not (tmp_path / "args").exists()
    assert not (tmp_path / "usage.jsonl.started").exists()  # refused = provably no spend


def test_shim_refuses_when_the_base_moved(tmp_path, fake_codex):
    env_extra = {"REVIEW_EXPECTED_BASE": "a" * 40, "ADV_REVIEW_TRUSTED_BASE_SHA": "c" * 40}
    assert _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra).returncode == 65


def test_shim_runs_when_head_and_base_match(tmp_path, fake_codex):
    env_extra = {
        "REVIEW_EXPECTED_HEAD": "a" * 40,
        "ADV_REVIEW_CANDIDATE_SHA": "a" * 40,
        "REVIEW_EXPECTED_BASE": "c" * 40,
        "ADV_REVIEW_TRUSTED_BASE_SHA": "c" * 40,
    }
    r = _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra)
    assert r.returncode == 0 and (tmp_path / "usage.jsonl.started").exists()


def test_killing_the_shim_kills_codex_itself(tmp_path):
    fake = tmp_path / "codex"
    fake.write_text('#!/usr/bin/env bash\necho $$ > "$FAKE_PID"\nsleep 30\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(fake),
        REVIEW_USAGE_FILE=str(tmp_path / "u.jsonl"),
        FAKE_PID=str(tmp_path / "pid"),
    )
    p = subprocess.Popen(["bash", str(SHIM), "exec", "-"], env=env, stdin=subprocess.DEVNULL)
    for _ in range(100):
        if (tmp_path / "pid").exists() and (tmp_path / "pid").read_text().strip():
            break
        time.sleep(0.05)
    codex_pid = int((tmp_path / "pid").read_text())
    assert codex_pid == p.pid  # exec'd: the watchdog's target IS the paid process
    p.terminate()
    p.wait(timeout=5)
    with pytest.raises(ProcessLookupError):
        os.kill(codex_pid, 0)


def test_reserve_waits_for_the_ledger_lock(tmp_path):
    # Deterministic proof that check+append happens under the exclusive lock:
    # while another holder has it, reserve() must block, then proceed.
    import fcntl

    led = tmp_path / "costs.jsonl"
    code = (
        f"import sys; sys.path.insert(0, {str(ROUTER_DIR)!r}); import router; from pathlib import Path; "
        f"print(router.reserve(Path({str(led)!r}), 0.5, 20, 3)[0])"
    )
    with open(str(led) + ".lock", "w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
        time.sleep(0.8)
        assert p.poll() is None  # blocked on the lock
        assert not led.exists()  # and wrote nothing while blocked
    assert p.communicate(timeout=10)[0].strip() == "True"
