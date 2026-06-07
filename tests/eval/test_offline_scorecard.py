"""Tests for the offline eval scorecard writer.

Regression guard for the "diagnosing blind" gap (#1583): the offline scorecard
must record each failing scenario's last MIRA response, so the eval watchdog's
`last_response_snippet` (parsed from the `- Last response:` line) is populated
and humans/agents can see what the bot actually said. `run_eval.py` already
emits this line; `offline_run.py` did not.
"""

from __future__ import annotations

from tests.eval import offline_run
from tests.eval.grader import CheckpointResult, ScenarioGrade


def _failing_grade(last_response: str) -> ScenarioGrade:
    return ScenarioGrade(
        scenario_id="demo_fixture_01",
        checkpoints=[CheckpointResult(name="cp_keyword_match", passed=False, reason="missing danfoss.com")],
        final_fsm_state="IDLE",
        total_turns=1,
        last_response=last_response,
    )


def test_offline_scorecard_records_last_response_for_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(offline_run, "_RUNS_DIR", tmp_path)
    grade = _failing_grade("I have the Danfoss AQUA Drive manual indexed.")

    path = offline_run.write_offline_scorecard(
        grades=[grade],
        judge_results=[None],
        total_seconds=1.0,
        suite="text",
        prev_path=None,
    )

    text = path.read_text()
    assert "## Failures" in text
    assert "- Last response:" in text
    assert "Danfoss AQUA Drive manual indexed" in text


def test_offline_scorecard_truncates_and_flattens_response(tmp_path, monkeypatch):
    monkeypatch.setattr(offline_run, "_RUNS_DIR", tmp_path)
    long_multiline = "line one\nline two " + ("x" * 300)
    grade = _failing_grade(long_multiline)

    text = offline_run.write_offline_scorecard(
        grades=[grade], judge_results=[None], total_seconds=1.0, suite="text", prev_path=None
    ).read_text()

    # Find the Last response line and verify it's single-line and capped.
    resp_line = next(ln for ln in text.splitlines() if ln.startswith("- Last response:"))
    assert "\n" not in resp_line  # newlines flattened
    assert "line one line two" in resp_line  # newline became a space
    # 200-char preview cap (well under the 300-x run we fed in)
    assert "x" * 300 not in resp_line
