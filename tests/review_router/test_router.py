"""Hermetic tests for tools/review_router — routing, escalation, cost math,
budget ceilings, the finding->test rule, and the CODEX_BIN shim. No network,
no paid calls."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
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


def test_estimate_uses_calibration_scaled_by_price_then_observed_history():
    chars = 236_205  # the calibration diff
    astra = router.estimate_usd("gpt-6-astra", chars, [])
    assert astra == pytest.approx(2.80 * 1.5)
    assert router.estimate_usd("gpt-5.4-mini", chars, []) < astra / 10
    seen = [{"model": "gpt-5.4-mini", "cost_usd": 1.0, "diff_chars": 100_000}]
    assert router.estimate_usd("gpt-5.4-mini", chars, seen) == pytest.approx(
        1.0 / 100_000 * chars * 1.5
    )


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


def _shim(tmp_path, fake, args, effort="", rc="0"):
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(fake),
        REVIEW_USAGE_FILE=str(tmp_path / "usage.jsonl"),
        REVIEW_EFFORT=effort,
        FAKE_ARGS=str(tmp_path / "args"),
        FAKE_STDIN=str(tmp_path / "stdin"),
        FAKE_RC=rc,
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
