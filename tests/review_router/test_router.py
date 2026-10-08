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


@pytest.mark.parametrize(
    "path",
    [
        "mira-mobile/src/screens/SafetyNotice.tsx",  # a real tracked file
        "mira-hub/src/capabilities/Answer-Validation.ts",
        "mira-hub/src/lib/AuthClient.ts",
        "mira-hub/db/Migrations/106_x.sql",
    ],
)
def test_a_case_variant_of_a_critical_path_is_still_critical(path):
    """The globs are lowercase and fnmatch is case-sensitive on Linux: a
    mixed-case security path must not slide down to a cheaper lane."""
    assert router.classify([path]) == "critical"


def test_every_glob_is_lowercase():
    for g in router.CRITICAL_GLOBS + router.LOW_GLOBS + router.TEST_GLOBS:
        assert g == g.lower(), g


def test_a_single_critical_path_wins_over_any_number_of_low_paths():
    assert (
        router.classify([f"tests/t{i}.py" for i in range(50)] + ["mira-bots/shared/guardrails.py"])
        == "critical"
    )


# ---------------------------------------------------------------------------
# F1: R3 governance floor / production control paths from SDLC §2.1


def test_tenant_isolation_path_is_critical():
    """F1: neon_recall.py contains tenant isolation logic (R3)."""
    assert router.classify(["mira-bots/shared/neon_recall.py"]) == "critical"


def test_saas_compose_is_critical():
    """F1: docker-compose.saas.yml is production control (R3)."""
    assert router.classify(["docker-compose.saas.yml"]) == "critical"
    assert router.classify(["docker-compose.staging.yml"]) == "critical"


def test_claude_governance_files_are_critical():
    """F1: .claude/** and root governance files are R3 governance floor."""
    assert router.classify(["CLAUDE.md"]) == "critical"
    assert router.classify(["AGENTS.md"]) == "critical"
    assert router.classify([".claude/rules/security-boundaries.md"]) == "critical"
    assert router.classify([".claude/skills/defect-workflow/SKILL.md"]) == "critical"


def test_ci_hold_gate_is_critical():
    """F1: tools/ci/hold_gate.py is production control (R3)."""
    assert router.classify(["tools/ci/hold_gate.py"]) == "critical"


def test_runbooks_are_critical():
    """F1: runbooks are process documents (R3 governance floor)."""
    assert router.classify(["docs/runbooks/kiosk-askmira-deploy-and-verify.md"]) == "critical"


def test_sdlc_process_docs_are_critical():
    """F1: SDLC, versioning, environments, and review workflow are R3."""
    assert router.classify(["docs/architecture/mira-sdlc-v1.md"]) == "critical"
    assert router.classify(["docs/adversarial-review-workflow.md"]) == "critical"
    assert router.classify(["docs/environments.md"]) == "critical"
    assert router.classify(["docs/versioning.md"]) == "critical"


def test_a_critical_path_cannot_be_pulled_down_by_a_generic_rule():
    """F1: AGENTS.md must not slide to 'low' via the generic *.md glob."""
    assert router.classify(["AGENTS.md"]) == "critical"
    assert router.classify(["CLAUDE.md"]) == "critical"
    # But a non-governance markdown file should be low
    assert router.classify(["docs/promo-screenshots/README.md"]) == "low"


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


# ---------------------------------------------------------------------------
# F3: NaN, inf, and negative budget validation


def test_check_budget_rejects_nan_estimate():
    """F3: NaN estimate must be rejected."""
    ok, why = router.check_budget(float("nan"), [], budget_usd=20, round_ceiling_usd=3)
    assert not ok and "estimate is not a finite number" in why


def test_check_budget_rejects_inf_estimate():
    """F3: infinite estimate must be rejected."""
    ok, why = router.check_budget(float("inf"), [], budget_usd=20, round_ceiling_usd=3)
    assert not ok and "estimate is not a finite number" in why
    ok, why = router.check_budget(float("-inf"), [], budget_usd=20, round_ceiling_usd=3)
    assert not ok and "estimate is not a finite number" in why


def test_check_budget_rejects_negative_estimate():
    """F3: negative estimate must be rejected."""
    ok, why = router.check_budget(-0.5, [], budget_usd=20, round_ceiling_usd=3)
    assert not ok and "estimate cannot be negative" in why


def test_check_budget_rejects_nan_budget():
    """F3: NaN budget must be rejected."""
    ok, why = router.check_budget(0.5, [], budget_usd=float("nan"), round_ceiling_usd=3)
    assert not ok and "budget is not a finite number" in why


def test_check_budget_rejects_inf_budget():
    """F3: infinite budget must be rejected."""
    ok, why = router.check_budget(0.5, [], budget_usd=float("inf"), round_ceiling_usd=3)
    assert not ok and "budget is not a finite number" in why


def test_check_budget_rejects_negative_budget():
    """F3: negative budget must be rejected."""
    ok, why = router.check_budget(0.5, [], budget_usd=-20, round_ceiling_usd=3)
    assert not ok and "budget cannot be negative" in why


def test_check_budget_rejects_nan_ceiling():
    """F3: NaN ceiling must be rejected."""
    ok, why = router.check_budget(0.5, [], budget_usd=20, round_ceiling_usd=float("nan"))
    assert not ok and "round ceiling is not a finite number" in why


def test_check_budget_rejects_negative_ceiling():
    """F3: negative ceiling must be rejected."""
    ok, why = router.check_budget(0.5, [], budget_usd=20, round_ceiling_usd=-3)
    assert not ok and "round ceiling cannot be negative" in why


def test_reserve_rejects_nan_amount(tmp_path):
    """F3: reserve() must reject NaN amounts."""
    led = tmp_path / "costs.jsonl"
    ok, why, rid = router.reserve(led, float("nan"), budget_usd=20, round_ceiling_usd=3)
    assert not ok and rid is None and "estimate is not a finite number" in why


def test_reserve_rejects_inf_amount(tmp_path):
    """F3: reserve() must reject infinite amounts."""
    led = tmp_path / "costs.jsonl"
    ok, why, rid = router.reserve(led, float("inf"), budget_usd=20, round_ceiling_usd=3)
    assert not ok and rid is None and "estimate is not a finite number" in why


def test_reserve_rejects_negative_amount(tmp_path):
    """F3: reserve() must reject negative amounts."""
    led = tmp_path / "costs.jsonl"
    ok, why, rid = router.reserve(led, -0.5, budget_usd=20, round_ceiling_usd=3)
    assert not ok and rid is None and "estimate cannot be negative" in why


def test_ledger_round_trip(tmp_path):
    p = tmp_path / "costs.jsonl"
    assert router.read_ledger(p) == []
    p.write_text('{"cost_usd": 1.25}\n\n{"cost_usd": 0.5}\n')
    assert sum(r["cost_usd"] for r in router.read_ledger(p)) == pytest.approx(1.75)


# ---------------------------------------------------------------------------
# Finding -> deterministic test rule


def test_a_same_head_rerun_after_findings_is_blocked_without_a_test_change():
    """Cheap-gate finding on 2c47d35ba: the finding->test rule used to apply
    only when the head had moved, so re-invoking at the reviewed head (no fix
    at all) spent a paid round with no test change."""
    prior = {"reviewed_sha": HEAD_SHA, "status": "ISSUES_FOUND"}

    def never_diffed(a, b):
        raise AssertionError("same head must not shell out for a diff")

    assert router.blocked_by_finding_rule(prior, HEAD_SHA, never_diffed) is True
    assert (
        router.blocked_by_finding_rule({**prior, "status": "GREEN"}, HEAD_SHA, never_diffed)
        is False
    )
    assert router.blocked_by_finding_rule({}, HEAD_SHA, never_diffed) is False
    other = "b" * 40
    assert router.blocked_by_finding_rule(prior, other, lambda a, b: ["tools/x.py"]) is True
    assert (
        router.blocked_by_finding_rule(prior, other, lambda a, b: ["tools/x.py", "tests/test_x.py"])
        is False
    )


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


def _shim(tmp_path, fake, args, effort="", rc="0", extra_env=None, skip_snapshot_check=True):
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
    # Test-only escape: most hermetic tests don't need snapshot checking
    if skip_snapshot_check:
        env["REVIEW_SKIP_SNAPSHOT_CHECK"] = "1"
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


def test_shim_refuses_when_real_codex_does_not_exist(tmp_path):
    """The shim checks that REAL_CODEX exists before attempting to exec it."""
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(tmp_path / "nonexistent-codex"),
        REVIEW_USAGE_FILE=str(tmp_path / "usage.jsonl"),
        REVIEW_SKIP_SNAPSHOT_CHECK="1",
    )
    r = subprocess.run(
        ["bash", str(SHIM), "exec", "-"],
        input="PROMPT",
        text=True,
        capture_output=True,
        env=env,
    )
    assert r.returncode == 67
    assert "does not exist" in r.stderr
    assert "nonexistent-codex" in r.stderr


def test_shim_refuses_when_real_codex_is_not_executable(tmp_path):
    """The shim checks that REAL_CODEX is executable before attempting to exec it."""
    fake = tmp_path / "not-executable"
    fake.write_text("#!/usr/bin/env bash\necho test\n")
    # Don't make it executable
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(fake),
        REVIEW_USAGE_FILE=str(tmp_path / "usage.jsonl"),
        REVIEW_SKIP_SNAPSHOT_CHECK="1",
    )
    r = subprocess.run(
        ["bash", str(SHIM), "exec", "-"],
        input="PROMPT",
        text=True,
        capture_output=True,
        env=env,
    )
    assert r.returncode == 67
    assert "is not executable" in r.stderr
    assert str(fake) in r.stderr


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


def test_bootstrap_is_honoured_only_while_the_router_is_absent_from_the_base(monkeypatch):
    """Cheap-gate finding on 4ca3360c8: `--bootstrap` waived the trust check
    unconditionally; its "only before the router is on main" limit lived in
    help text. Now it is enforced from the base branch itself."""
    here = {r: f"sha-{i}" for i, r in enumerate(router.TOOLING)}
    _fake_git({}, here, monkeypatch)
    assert router.router_on_base("main") is False
    _fake_git({"tools/review_router/router.py": "sha-0"}, here, monkeypatch)
    assert router.router_on_base("main") is True

    drift = ["tools/review_router/codex_shim.sh"]
    assert router.tooling_refusal([], bootstrap=False, router_on_base=True) is None
    assert router.tooling_refusal([], bootstrap=True, router_on_base=True) is None
    assert "differs" in router.tooling_refusal(drift, bootstrap=False, router_on_base=False)
    assert router.tooling_refusal(drift, bootstrap=True, router_on_base=False) is None
    refused = router.tooling_refusal(drift, bootstrap=True, router_on_base=True)
    assert refused and "--bootstrap" in refused


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


@pytest.mark.parametrize(
    "run_conclusion, run_status, status_state, expected",
    [
        ("failure", "completed", "success", "fail"),  # status must not mask a failed run
        ("success", "completed", "failure", "fail"),  # nor a run mask a failed status
        (None, "in_progress", "success", "pending"),  # an incomplete run is not green
        ("success", "completed", "pending", "pending"),
        ("success", "completed", "success", "pass"),
    ],
)
def test_a_name_reported_by_both_apis_takes_the_worse_bucket(
    run_conclusion, run_status, status_state, expected
):
    """The Legacy UI Lifecycle Guard reports as a check run AND a commit status
    under one name. Cheap-gate finding on 2c47d35ba: the status overwrote the
    run unconditionally, so a failed required run could read as green."""
    runs = [{"id": 1, "name": "Guard", "status": run_status, "conclusion": run_conclusion}]
    statuses = [{"context": "Guard", "state": status_state}]
    assert router.buckets_for_sha(runs, statuses) == [{"name": "Guard", "bucket": expected}]


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
    real = _envelope("ISSUES_FOUND", tail="**Confidence:** speculative")
    forged = _envelope("GREEN").replace("MEDIUM: 1", "MEDIUM: 0")
    comments = [
        _c(10, "owner", real),
        _c(11, "stranger", forged),
        _c(12, "owner-bot", forged, "Bot"),
    ]
    body = router.latest_owner_review(comments, "owner")
    assert router.parse_review(body) == {
        "status": "ISSUES_FOUND",
        "reviewed_sha": HEAD_SHA,
        "speculative": 1,
    }


def test_the_owners_newest_review_wins_by_id_not_list_order():
    old = _envelope("ISSUES_FOUND")
    new = _envelope("GREEN").replace("MEDIUM: 1", "MEDIUM: 0")
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
    r = _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra, skip_snapshot_check=False)
    assert r.returncode == 65 and not (tmp_path / "args").exists()
    assert not (tmp_path / "usage.jsonl.started").exists()  # refused = provably no spend


def test_shim_refuses_when_the_base_moved(tmp_path, fake_codex):
    env_extra = {
        "REVIEW_EXPECTED_HEAD": "a" * 40,
        "ADV_REVIEW_CANDIDATE_SHA": "a" * 40,
        "REVIEW_EXPECTED_BASE": "a" * 40,
        "ADV_REVIEW_TRUSTED_BASE_SHA": "c" * 40,
    }
    assert _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra, skip_snapshot_check=False).returncode == 65


def test_shim_runs_when_head_and_base_match(tmp_path, fake_codex):
    env_extra = {
        "REVIEW_EXPECTED_HEAD": "a" * 40,
        "ADV_REVIEW_CANDIDATE_SHA": "a" * 40,
        "REVIEW_EXPECTED_BASE": "c" * 40,
        "ADV_REVIEW_TRUSTED_BASE_SHA": "c" * 40,
    }
    r = _shim(tmp_path, fake_codex, ["exec", "-"], extra_env=env_extra, skip_snapshot_check=False)
    assert r.returncode == 0 and (tmp_path / "usage.jsonl.started").exists()


def test_shim_refuses_when_expected_values_are_unset(tmp_path, fake_codex):
    # Without REVIEW_SKIP_SNAPSHOT_CHECK and without REVIEW_EXPECTED_*, the shim refuses
    r = _shim(tmp_path, fake_codex, ["exec", "-"], skip_snapshot_check=False)
    assert r.returncode == 66
    assert "is unset" in r.stderr
    assert not (tmp_path / "args").exists()
    assert not (tmp_path / "usage.jsonl.started").exists()


def test_router_strips_skip_snapshot_check_from_shim_environment(tmp_path, monkeypatch):
    """The router strips REVIEW_SKIP_SNAPSHOT_CHECK from the environment it passes
    to the shim, so a stray test escape in the operator's shell can't disable the
    snapshot check. Only tests that invoke the shim directly can set it."""
    ledger = tmp_path / "costs.jsonl"
    env_captured = {}

    def fake_reserve(*args, **kwargs):
        # Always allow the run
        return True, "ok", "test-rid-12345678"

    def fake_subprocess_run(cmd, **kwargs):
        # Capture the environment the router passes to bash (which runs the trusted script)
        if cmd[0] == "bash" and cmd[1] == "-s":
            env_captured.update(kwargs.get("env", {}))
            return subprocess.CompletedProcess(cmd, 0, "", "")
        # Everything else: pass through or stub
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "reserve", fake_reserve)
    monkeypatch.setattr(subprocess, "run", fake_subprocess_run)
    monkeypatch.setattr(
        router,
        "pr_facts",
        lambda pr: {
            "base_ref": "main",
            "base_sha": BASE_SHA,
            "head": HEAD_SHA,
            "merge_base": BASE_SHA,
            "paths": ["docs/x.md"],
            "diff_chars": 100,
        },
    )
    monkeypatch.setattr(router, "prior_round", lambda pr: {})
    monkeypatch.setattr(router, "deterministic_stage", lambda head, base: ([], []))
    monkeypatch.setattr(router, "untrusted_tooling", lambda ref: [])
    monkeypatch.setattr(router, "router_on_base", lambda ref: True)

    # Set REVIEW_SKIP_SNAPSHOT_CHECK in the operator's environment
    monkeypatch.setenv("REVIEW_SKIP_SNAPSHOT_CHECK", "1")

    # Run the router (it will hit our stubs above and capture the env it passes to bash)
    router.main(["1", "--ledger", str(ledger), "--no-prefilter"])

    # Verify that REVIEW_SKIP_SNAPSHOT_CHECK is NOT in the environment the router
    # passed to the trusted script (which passes it to the shim)
    assert "REVIEW_SKIP_SNAPSHOT_CHECK" not in env_captured
    # But verify the router did set the variables it should set
    assert "CODEX_BIN" in env_captured
    assert "REVIEW_EXPECTED_HEAD" in env_captured


# ---------------------------------------------------------------------------
# F2: ADV_REVIEW_HUMAN_AUTHORIZED must not be inherited from parent env


def test_router_strips_inherited_human_authorized_flag(tmp_path, monkeypatch):
    """F2: ADV_REVIEW_HUMAN_AUTHORIZED must be removed from the environment
    unless --authorized is explicitly passed."""
    ledger = tmp_path / "costs.jsonl"
    env_captured = {}

    def fake_reserve(*args, **kwargs):
        return True, "ok", "test-rid"

    def fake_subprocess_run(cmd, **kwargs):
        if cmd[0] == "bash" and cmd[1] == "-s":
            env_captured.update(kwargs.get("env", {}))
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "reserve", fake_reserve)
    monkeypatch.setattr(subprocess, "run", fake_subprocess_run)
    monkeypatch.setattr(
        router,
        "pr_facts",
        lambda pr: {
            "base_ref": "main",
            "base_sha": BASE_SHA,
            "head": HEAD_SHA,
            "merge_base": BASE_SHA,
            "paths": ["docs/x.md"],
            "diff_chars": 100,
        },
    )
    monkeypatch.setattr(router, "prior_round", lambda pr: {})
    monkeypatch.setattr(router, "deterministic_stage", lambda head, base: ([], []))
    monkeypatch.setattr(router, "untrusted_tooling", lambda ref: [])
    monkeypatch.setattr(router, "router_on_base", lambda ref: True)

    # Set the inherited flag in the parent environment
    monkeypatch.setenv("ADV_REVIEW_HUMAN_AUTHORIZED", "1")

    # Run WITHOUT --authorized
    env_captured.clear()
    router.main(["1", "--ledger", str(ledger), "--no-prefilter"])
    assert "ADV_REVIEW_HUMAN_AUTHORIZED" not in env_captured, \
        "inherited flag must be removed when --authorized is not passed"

    # Run WITH --authorized
    env_captured.clear()
    router.main(["1", "--ledger", str(ledger), "--no-prefilter", "--authorized"])
    assert env_captured.get("ADV_REVIEW_HUMAN_AUTHORIZED") == "1", \
        "flag must be set when --authorized is passed"


def test_killing_the_shim_kills_codex_itself(tmp_path):
    fake = tmp_path / "codex"
    fake.write_text('#!/usr/bin/env bash\necho $$ > "$FAKE_PID"\nsleep 30\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    env = dict(
        os.environ,
        REVIEW_REAL_CODEX=str(fake),
        REVIEW_USAGE_FILE=str(tmp_path / "u.jsonl"),
        FAKE_PID=str(tmp_path / "pid"),
        REVIEW_SKIP_SNAPSHOT_CHECK="1",
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


# ---------------------------------------------------------------------------
# Codex #4202 r2: the pre-filter executes the captured base tree (F8), a
# malformed owner comment cannot shadow a valid review (F5), and a missing
# process start is advisory unavailability, not a crash (F9)

BASE_SHA = "b" * 40
HEAD_SHA = "c" * 40
BODY_SHA = "d" * 64


def _envelope(status, iteration=1, sha=HEAD_SHA, body_sha=BODY_SHA, tail=""):
    return (
        "[CODEX-ADVERSARIAL-REVIEW]\n\n```\n"
        f"reviewed_sha: {sha}\n"
        f"reviewed_body_sha256: {body_sha}\n"
        f"base_sha: {BASE_SHA}\n"
        f"status: {status}\n"
        f"review_iteration: {iteration}\n\n"
        "BLOCKER: 0\nHIGH: 0\nMEDIUM: 1\nLOW: 0\nFALSE_POSITIVE: 0\n```\n" + tail
    )


def test_prefilter_executes_the_captured_base_tree_not_the_callers_checkout(tmp_path, monkeypatch):
    """F8: the router validates `HERE/../..` but used to execute the caller's
    `tools/gate7_review.py` under Doppler. The pre-filter must run from a
    detached checkout of the captured base SHA, never from `REPO`."""
    calls = []

    def run(cmd, **kw):
        calls.append((cmd, kw.get("cwd")))
        if cmd[:3] == ["git", "worktree", "add"]:
            wt = Path(cmd[-2])
            (wt / "tools").mkdir(parents=True)
            (wt / "tools" / "gate7_review.py").write_text("# base copy\n")
        if cmd[0] == "doppler":
            Path(cmd[cmd.index("-o") + 1]).write_text("**Verdict:** PASS\n")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "_run", run)
    monkeypatch.setattr(router, "REPO", tmp_path / "candidate")
    (tmp_path / "candidate" / "tools").mkdir(parents=True)
    (tmp_path / "candidate" / "tools" / "gate7_review.py").write_text("# CANDIDATE\n")

    out = router.free_prefilter(4202, tmp_path, BASE_SHA)

    assert out["prefilter"] == "PASS"
    gate7 = next((c, cwd) for c, cwd in calls if c[0] == "doppler")
    script = Path(gate7[0][gate7[0].index("--") + 2])
    assert script.name == "gate7_review.py"
    assert not str(script).startswith(str(tmp_path / "candidate"))
    assert str(gate7[1]) == str(script.parents[1])  # cwd is the tree it runs from
    added = next(c for c, _ in calls if c[:3] == ["git", "worktree", "add"])
    assert "--detach" in added and added[-1] == BASE_SHA
    assert str(script.parents[1]) == added[-2]
    assert any(c[:3] == ["git", "worktree", "remove"] for c, _ in calls)
    assert not script.exists()  # the ephemeral checkout is gone afterwards


def test_a_malformed_owner_comment_cannot_shadow_a_valid_review():
    """F5: the newest *well-formed* owner envelope controls escalation and the
    regression-test rule. Truncated, unfenced, or contradictory owner comments
    after it are ignored, as the review ledger ignores them."""
    valid = _envelope("ISSUES_FOUND", tail="- **Confidence:** speculative\n")
    truncated = "[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: " + HEAD_SHA
    unfenced = "[CODEX-ADVERSARIAL-REVIEW]\nstatus: GREEN\nreviewed_sha: " + HEAD_SHA
    contradictory = _envelope("GREEN").replace("MEDIUM: 1", "MEDIUM: 2")  # GREEN with findings
    comments = [
        _c(10, "owner", valid),
        _c(11, "owner", truncated),
        _c(12, "owner", unfenced),
        _c(13, "owner", contradictory),
    ]
    assert router.latest_owner_review(comments, "owner") == valid
    assert router.parse_review(valid) == {
        "status": "ISSUES_FOUND",
        "reviewed_sha": HEAD_SHA,
        "speculative": 1,
    }
    assert router.needs_regression_test("ISSUES_FOUND", ["tools/x.py"]) is True


def test_a_newer_valid_review_still_wins():
    old = _envelope("ISSUES_FOUND", iteration=1)
    new = _envelope("GREEN", iteration=2).replace("MEDIUM: 1", "MEDIUM: 0")
    assert router.latest_owner_review([_c(10, "owner", old), _c(11, "owner", new)], "owner") == new


def test_a_missing_prefilter_executable_is_recorded_as_unavailable(tmp_path, monkeypatch):
    """F9: a machine without Doppler must record `prefilter: unavailable` and
    continue to the paid runner, not raise before reaching it."""

    def run(cmd, **kw):
        if cmd[0] == "doppler":
            raise FileNotFoundError(2, "No such file or directory", "doppler")
        if cmd[:3] == ["git", "worktree", "add"]:
            Path(cmd[-2]).mkdir(parents=True)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "_run", run)
    out = router.free_prefilter(4202, tmp_path, BASE_SHA)
    assert out["prefilter"] == "unavailable"
    assert "doppler" in out["prefilter_error"]


def test_main_continues_past_an_unavailable_prefilter_to_the_trusted_runner(tmp_path, monkeypatch):
    ledger = tmp_path / "ledger.jsonl"
    monkeypatch.setattr(
        router,
        "pr_facts",
        lambda pr: {
            "base_ref": "main",
            "base_sha": BASE_SHA,
            "head": HEAD_SHA,
            "merge_base": BASE_SHA,
            "paths": ["docs/x.md"],
            "diff_chars": 100,
        },
    )
    monkeypatch.setattr(router, "prior_round", lambda pr: {})
    monkeypatch.setattr(router, "untrusted_tooling", lambda base: [])
    monkeypatch.setattr(router, "deterministic_stage", lambda head, base: ([], []))
    monkeypatch.setattr(
        router,
        "free_prefilter",
        lambda pr, d, base: {"prefilter": "unavailable", "prefilter_error": "doppler: ENOENT"},
    )
    monkeypatch.setattr(
        router, "_run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, "#!/bin/bash\n", "")
    )
    launched = []
    monkeypatch.setattr(
        router.subprocess,
        "run",
        lambda cmd, **kw: launched.append(cmd) or subprocess.CompletedProcess(cmd, 0, "", ""),
    )
    rc = router.main(["4202", "--ledger", str(ledger)])
    assert rc == 0 and launched, "the paid runner was never reached"
    rec = [json.loads(ln) for ln in ledger.read_text().splitlines()][-1]
    assert rec["prefilter"] == "unavailable" and rec["launched"] is False


# ---------------------------------------------------------------------------
# Codex #4202 r3: relative ledger paths crossing working directories (F10),
# UNKNOWN pre-filter verdicts never become PASS (F11), and the ledger is one
# per repository, not one per checkout (found by round 3 itself: run from a
# worktree, the router reported "spent $0.00")


def _patch_main(monkeypatch, prefilter):
    monkeypatch.setattr(
        router,
        "pr_facts",
        lambda pr: {
            "base_ref": "main",
            "base_sha": BASE_SHA,
            "head": HEAD_SHA,
            "merge_base": BASE_SHA,
            "paths": ["docs/x.md"],
            "diff_chars": 100,
        },
    )
    monkeypatch.setattr(router, "prior_round", lambda pr: {})
    monkeypatch.setattr(router, "untrusted_tooling", lambda base: [])
    monkeypatch.setattr(router, "deterministic_stage", lambda head, base: ([], []))
    monkeypatch.setattr(router, "free_prefilter", prefilter)
    monkeypatch.setattr(
        router, "_run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, "#!/bin/bash\n", "")
    )


def test_a_relative_ledger_is_resolved_before_the_runner_changes_directory(tmp_path, monkeypatch):
    """F10: the trusted runner chdirs into the producer checkout; the shim writes
    usage + `.started` at REVIEW_USAGE_FILE from there. A relative --ledger
    therefore lands the artifacts in the producer tree and the router, reading
    from the caller's directory, records a launched run as an unlaunched $0."""
    invoke = tmp_path / "invoke"
    producer = tmp_path / "producer"
    invoke.mkdir()
    producer.mkdir()
    monkeypatch.chdir(invoke)
    seen = {}
    _patch_main(monkeypatch, lambda pr, d, base: {"prefilter": "unavailable"})

    def runner(cmd, **kw):  # the trusted entrypoint, as seen from the producer cwd
        uf = Path(kw["env"]["REVIEW_USAGE_FILE"])
        seen["usage_file"] = uf
        target = uf if uf.is_absolute() else producer / uf
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            '{"type": "turn.completed", "usage": {"input_tokens": 1000000,'
            ' "cached_input_tokens": 0, "output_tokens": 0, "reasoning_output_tokens": 0}}\n'
        )
        Path(str(target) + ".started").write_text("launched")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router.subprocess, "run", runner)
    assert router.main(["4202", "--ledger", "costs/ledger.jsonl"]) == 0
    assert seen["usage_file"].is_absolute()
    assert str(seen["usage_file"]).startswith(str(invoke))
    assert not list(producer.rglob("*")), "artifacts leaked into the producer checkout"
    rec = [json.loads(ln) for ln in (invoke / "costs" / "ledger.jsonl").read_text().splitlines()][
        -1
    ]
    assert rec["launched"] is True and rec["usage_unknown"] is False and rec["cost_usd"] > 0


def test_the_prefilter_report_dir_is_created_before_the_stage_runs(tmp_path, monkeypatch):
    calls = []

    def run(cmd, **kw):
        if cmd[:3] == ["git", "worktree", "add"]:
            Path(cmd[-2]).mkdir(parents=True)
        if cmd[0] == "doppler":
            out = Path(cmd[cmd.index("-o") + 1])
            calls.append(out.parent.is_dir())
            out.write_text("**Verdict:** PASS · x\n")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "_run", run)
    assert router.free_prefilter(1, tmp_path / "missing" / "dir", BASE_SHA)["prefilter"] == "PASS"
    assert calls == [True]


@pytest.mark.parametrize(
    "report, expected",
    [
        ("**Verdict:** PASS · **Effort:** low · **Reviewer:** groq\n", "PASS"),
        ("**Verdict:** BLOCK · **Effort:** low\n- **[high]** x\n", "BLOCK"),
        ("**Verdict:** UNKNOWN · **Effort:** low\n", "UNKNOWN"),
        ("# Gate 7 review\nno verdict line at all\n", "unavailable"),
        ("", "unavailable"),
        ("**Verdict:** PASSING\n", "unavailable"),
    ],
)
def test_only_an_explicit_pass_verdict_is_recorded_as_pass(tmp_path, monkeypatch, report, expected):
    """F11: gate7 writes `**Verdict:** UNKNOWN` (exit 0) when the free model gave
    no parseable verdict; that must never be recorded as a successful PASS."""

    def run(cmd, **kw):
        if cmd[:3] == ["git", "worktree", "add"]:
            Path(cmd[-2]).mkdir(parents=True)
        if cmd[0] == "doppler":
            Path(cmd[cmd.index("-o") + 1]).write_text(report)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(router, "_run", run)
    assert router.free_prefilter(1, tmp_path, BASE_SHA)["prefilter"] == expected


def test_the_default_ledger_is_shared_by_every_worktree_of_the_repository(tmp_path, monkeypatch):
    """The budget is per repository. A worktree must not start with a fresh $20."""
    repo = tmp_path / "repo"
    repo.mkdir()

    def g(*a):
        subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True)

    g("init", "-q", "-b", "main")
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x")
    wt = tmp_path / "wt"
    g("worktree", "add", "-q", "--detach", str(wt))
    monkeypatch.chdir(wt)
    assert router.default_ledger() == (repo / ".planning" / "review-costs.jsonl").resolve()
    monkeypatch.chdir(repo)
    assert router.default_ledger() == (repo / ".planning" / "review-costs.jsonl").resolve()


# ---------------------------------------------------------------------------
# Codex #4202 r4: rename sources count toward risk (F12)


def _fake_pr(monkeypatch, gh_files, diff_names):
    def run(cmd, **kw):
        if cmd[:3] == ["gh", "pr", "view"]:
            out = json.dumps(
                {
                    "headRefOid": HEAD_SHA,
                    "baseRefName": "main",
                    "baseRefOid": BASE_SHA,
                    "files": [{"path": p} for p in gh_files],
                }
            )
        elif cmd[:2] == ["git", "merge-base"]:
            out = BASE_SHA
        elif cmd[:2] == ["git", "diff"] and "--name-only" in cmd:
            assert "--no-renames" in cmd, "rename detection must be OFF so both sides appear"
            out = "\n".join(diff_names)
        elif cmd[:2] == ["git", "diff"]:
            out = "+x\n" * 10
        else:
            out = ""
        return subprocess.CompletedProcess(cmd, 0, out + "\n", "")

    monkeypatch.setattr(router, "_run", run)


def test_a_renamed_critical_file_keeps_the_critical_tier(monkeypatch):
    """F12: GitHub's file list names only a rename's destination, so renaming
    `engine.py` → `supervisor.py` hid the critical source from routing. Paths
    come from the captured base..head diff with rename detection off, so the
    deleted source and the added destination are both present."""
    _fake_pr(
        monkeypatch,
        gh_files=["mira-bots/shared/supervisor.py", "mira-bots/shared/__init__.py"],
        diff_names=[
            "mira-bots/shared/engine.py",
            "mira-bots/shared/supervisor.py",
            "mira-bots/shared/__init__.py",
        ],
    )
    facts = router.pr_facts(1)
    assert "mira-bots/shared/engine.py" in facts["paths"]
    assert router.classify(facts["paths"]) == "critical"


def test_a_rename_into_a_critical_path_is_critical_too(monkeypatch):
    _fake_pr(
        monkeypatch,
        gh_files=["mira-bots/shared/engine.py"],
        diff_names=["mira-bots/shared/old_engine.py", "mira-bots/shared/engine.py"],
    )
    assert router.classify(router.pr_facts(1)["paths"]) == "critical"


def test_without_renames_paths_match_the_pr_file_list(monkeypatch):
    _fake_pr(
        monkeypatch, gh_files=["docs/a.md", "tests/t.py"], diff_names=["docs/a.md", "tests/t.py"]
    )
    assert sorted(router.pr_facts(1)["paths"]) == ["docs/a.md", "tests/t.py"]
