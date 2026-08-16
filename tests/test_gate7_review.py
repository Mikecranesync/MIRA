"""Offline unit tests for the Gate 7 adversarial-review lane (CU-11).

No network, no provider keys: these lock the lane's decision logic — verdict
parsing (the observed drift risk is gpt-oss wandering off the output format →
exit 2) and brief construction (truncation must be visible to the reviewer).
Wired into CI by the architecture-check job (ci.yml "Check module boundaries"
block) — an unwired test file would itself be a false-green (CU-06 lesson).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("httpx")

_MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "gate7_review.py"
_spec = importlib.util.spec_from_file_location("gate7_review", _MODULE_PATH)
assert _spec is not None and _spec.loader is not None
gate7 = importlib.util.module_from_spec(_spec)
sys.modules["gate7_review"] = gate7
_spec.loader.exec_module(gate7)


class TestParseVerdict:
    def test_pass(self):
        assert gate7.parse_verdict("Verdict: PASS\n### Findings\n- none") == "PASS"

    def test_block(self):
        assert gate7.parse_verdict("Verdict: BLOCK\n### Findings\n- [blocking] x") == "BLOCK"

    def test_case_insensitive_and_leading_whitespace(self):
        assert gate7.parse_verdict("  verdict: pass\n") == "PASS"

    def test_missing_verdict_is_indeterminate(self):
        assert gate7.parse_verdict("Looks fine to me!") == "INDETERMINATE"

    def test_conflicting_verdicts_are_indeterminate(self):
        assert gate7.parse_verdict("Verdict: PASS\n...\nVerdict: BLOCK\n") == "INDETERMINATE"

    def test_repeated_identical_verdict_is_kept(self):
        assert gate7.parse_verdict("Verdict: BLOCK\n...\nVerdict: BLOCK\n") == "BLOCK"

    def test_verdict_mentioned_mid_line_does_not_count(self):
        # Only a line-anchored "Verdict:" counts — a quoted mention inside a
        # finding must not decide the round.
        text = "The diff says 'emit Verdict: PASS' in its prompt template."
        assert gate7.parse_verdict(text) == "INDETERMINATE"


class TestBuildPrompt:
    def test_truncation_note_present_when_capped(self):
        diff = "x" * (gate7.DIFF_CHAR_CAP + 100)
        prompt = gate7.build_prompt(diff, "")
        assert "TRUNCATED" in prompt
        assert len(prompt) < gate7.DIFF_CHAR_CAP + 5_000

    def test_no_truncation_note_for_small_diff(self):
        prompt = gate7.build_prompt("diff --git a/f b/f\n+x\n", "")
        assert "TRUNCATED" not in prompt

    def test_unit_record_included_and_capped(self):
        unit = "UNIT-MARKER " + "y" * (gate7.UNIT_CHAR_CAP + 100)
        prompt = gate7.build_prompt("+x\n", unit)
        assert "UNIT-MARKER" in prompt
        assert "y" * (gate7.UNIT_CHAR_CAP) not in prompt

    def test_accepted_context_block_present(self):
        # The calibration block that stops deterministic policy false-positives
        # (round-2 dogfood lesson) must stay in the brief.
        prompt = gate7.build_prompt("+x\n", "")
        assert "ACCEPTED PLATFORM CONTEXT" in prompt


class TestExitCodeMap:
    def test_every_overall_state_has_a_distinct_code(self):
        # The contract in the unit record: PASS 0, BLOCK 1, INDETERMINATE 2.
        mapping = {"PASS": 0, "BLOCK": 1, "INDETERMINATE": 2}
        source = _MODULE_PATH.read_text(encoding="utf-8")
        assert '{"PASS": 0, "BLOCK": 1, "INDETERMINATE": 2}' in source
        assert len(set(mapping.values())) == 3
