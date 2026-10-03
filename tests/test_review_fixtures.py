"""The light review fixture, hermetically: every planted defect is really in its
diff, the scorer is not vacuous, and a reviewer's recall/false-positive numbers
come out right against fake reviews. No network, no spend."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
import gate7_review as g7  # noqa: E402
import review_fixture as rf  # noqa: E402

CASES = rf.load_cases()
PLANTED = [c for c in CASES if c.get("planted") is not None]
CONTROLS = [c for c in CASES if c.get("planted") is None]


def test_the_corpus_has_planted_cases_and_a_control():
    assert len(PLANTED) >= 5 and len(CONTROLS) >= 1
    assert all(c["min_severity"] in rf.SEVERITY for c in CASES)


@pytest.mark.parametrize("case", PLANTED, ids=lambda c: c["name"])
def test_every_planted_defect_is_physically_in_its_diff(case):
    """A fixture whose defect is not in its text proves nothing (the workflow's
    first implementer shipped four of those). The regex must match the diff."""
    assert rf.planted_present(case) is True
    assert case["keywords_any"], "a planted case needs keywords an adequate finding would contain"
    assert case["provenance"], "every planted case names the real review that caught the class"


def test_the_control_plants_nothing_and_has_no_keywords():
    for c in CONTROLS:
        assert rf.planted_present(c) is None and not c.get("keywords_any")


def _f(sev, title, detail=""):
    return g7.Finding(sev, title, detail)


def test_score_hits_only_at_or_above_min_severity_with_a_keyword():
    case = {"min_severity": "medium", "keywords_any": ["hostname", "attacker"]}
    assert (
        rf.score([_f("high", "Guard is a substring check", "attacker host passes")], case)["hit"]
        is True
    )
    assert (
        rf.score([_f("low", "Guard is a substring check", "attacker host passes")], case)["hit"]
        is False
    )
    assert rf.score([_f("high", "Unrelated style nit", "rename variable")], case)["hit"] is False
    assert rf.score([], case)["hit"] is False


def test_score_counts_strong_findings_on_a_control_as_false_positives():
    control = {"min_severity": "high", "keywords_any": []}
    r = rf.score([_f("high", "x"), _f("medium", "y"), _f("high", "z")], control)
    assert r["control"] is True and r["false_positives"] == 2 and r["hit"] is None


def _review_for(case_name: str, catches: set[str], control_fp: bool) -> str:
    """A fake reviewer: for named cases it emits an adequate finding; on the
    control it emits a bogus high when control_fp is set."""
    lines = [
        "## VERDICT",
        "BLOCK" if (case_name in catches or control_fp) else "PASS",
        "",
        "## FINDINGS",
    ]
    by_case = {
        "substring_prod_guard": "- **[severity: high] Guard is a substring check** — attacker host passes",
        "plaintext_http": "- **[severity: medium] Cookie over plaintext http** — scheme is not checked",
        "empty_sign_off_marker": "- **[severity: medium] Empty validated_by counts as sign-off** — blank string",
        "unhashable_kind_crash": "- **[severity: medium] Unhashable kind raises TypeError** — list value",
        "length_truncated_pass": "- **[severity: medium] finish_reason length ignored** — truncated output parsed",
    }
    if case_name in catches and case_name in by_case:
        lines.append(by_case[case_name])
    if case_name == "control_clean" and control_fp:
        lines.append("- **[severity: high] Bogus** — nothing is wrong here")
    return "\n".join(lines) + "\n"


def _provider(catches: set[str], control_fp: bool = False, dead: set[str] | None = None):
    def provider(prompt: str) -> str | None:
        # the prompt carries the case name as the PR title
        name = next(
            (c["name"] for c in CASES if f"\n{c['name']}\n" in prompt or c["name"] in prompt), ""
        )
        if dead and name in dead:
            return None
        return _review_for(name, catches, control_fp)

    return provider


def test_run_reports_full_recall_and_zero_false_positives_for_a_perfect_reviewer():
    r = rf.run(_provider({c["name"] for c in PLANTED}), CASES)
    assert r["planted"] == len(PLANTED) and r["hits"] == len(PLANTED) and r["recall"] == 1.0
    assert r["control_false_positives"] == 0 and r["no_review"] == 0


def test_run_reports_partial_recall_a_control_false_positive_and_a_dead_case():
    catches = {"substring_prod_guard", "plaintext_http"}
    r = rf.run(_provider(catches, control_fp=True, dead={"unhashable_kind_crash"}), CASES)
    assert r["no_review"] == 1
    assert r["planted"] == len(PLANTED) - 1  # the dead case is not scored as a miss, it is reported
    assert r["hits"] == 2 and r["recall"] == pytest.approx(2 / (len(PLANTED) - 1))
    assert r["control_false_positives"] == 1


def test_the_prompt_sent_for_a_fixture_is_the_real_brief_with_the_diff_inside():
    seen = {}

    def provider(prompt):
        seen["p"] = prompt
        return "## VERDICT\nPASS\n"

    rf.run(provider, [PLANTED[0]])
    assert (
        "BEGIN UNTRUSTED PR DATA" in seen["p"] and PLANTED[0]["diff"].splitlines()[0] in seen["p"]
    )


def test_cli_refuses_when_a_planted_regex_no_longer_matches(tmp_path, monkeypatch, capsys):
    root = tmp_path / "fx"
    (root / "broken").mkdir(parents=True)
    (root / "broken" / "diff.patch").write_text("+++ b/x.py\n+ok = True\n")
    (root / "broken" / "expect.json").write_text(
        json.dumps(
            {
                "planted": "NOT_IN_DIFF",
                "keywords_any": ["x"],
                "min_severity": "medium",
                "provenance": "t",
            }
        )
    )
    monkeypatch.setattr(rf, "load_cases", lambda: _load(root))
    assert rf.main([]) == 1
    assert "NOT present" in capsys.readouterr().err


def _load(root):
    cases = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        expect = json.loads((d / "expect.json").read_text())
        cases.append({"name": d.name, "diff": (d / "diff.patch").read_text(), **expect})
    return cases


def test_r2_f5_a_skipped_call_records_no_spend(tmp_path, monkeypatch):
    """Codex r2 F5: without OPENAI_API_KEY every call is skipped, yet the live
    provider charged the estimate as launched spend."""
    monkeypatch.setattr(g7, "pick_paid_model", lambda chars, budget: "gpt-5.4-mini")
    monkeypatch.setattr(
        g7, "call_paid", lambda *a, **k: (None, "", ["openai: skipped (no OPENAI_API_KEY)"], {})
    )
    ledger = tmp_path / "c.jsonl"
    provider = rf.live_provider(0.10, ledger)
    assert provider("PROMPT") is None and not ledger.exists()


def test_strict_recall_counts_a_dead_case_as_a_miss():
    """Cheap gate on f570862b5: excluding no-review cases from recall flatters a
    reviewer that fails to review. `recall` is over reviewed cases (diagnostic);
    `recall_strict` is over every planted case (the honest number)."""
    catches = {c["name"] for c in PLANTED}
    r = rf.run(_provider(catches, dead={"unhashable_kind_crash"}), CASES)
    assert r["recall"] == 1.0
    assert r["recall_strict"] == pytest.approx((len(PLANTED) - 1) / len(PLANTED))


def test_live_total_budget_stops_launching_before_it_is_exceeded(tmp_path, monkeypatch):
    """Cheap gate on f570862b5: --budget-usd was per case; six cases could spend
    six budgets. A total hard-stop refuses further launches once the actual spend
    plus the next worst-case estimate would exceed it."""
    monkeypatch.setattr(g7, "pick_paid_model", lambda chars, budget: "gpt-5.4-mini")
    monkeypatch.setattr(g7, "paid_estimate_usd", lambda model, prompt, **k: 0.04)
    calls = []

    def call_paid(prompt, model, **k):
        calls.append(1)
        return (
            "## VERDICT\nPASS\n",
            "openai",
            ["openai: ok"],
            {
                "input_tokens": 1000,
                "cached_input_tokens": 0,
                "output_tokens": 100,
                "reasoning_output_tokens": 0,
            },
        )

    monkeypatch.setattr(g7, "call_paid", call_paid)
    # each launched call costs 1000×0.75 + 100×4.5 per 1M = $0.0012 at mini's prices
    provider = rf.live_provider(0.10, tmp_path / "c.jsonl", total_budget_usd=0.0415)
    assert provider("P1") is not None  # 0 + 0.04 ≤ 0.0415
    assert provider("P2") is not None  # 0.0012 + 0.04 = 0.0412 ≤ 0.0415
    assert provider("P3") is None and len(calls) == 2  # 0.0024 + 0.04 > 0.0415: refused


@pytest.mark.parametrize("flag", ["--budget-usd", "--total-budget-usd"])
def test_fixture_cli_refuses_a_non_finite_budget(flag, monkeypatch):
    with pytest.raises(SystemExit):
        rf.main(["--live", flag, "inf"])
