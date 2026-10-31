"""T-5 prompt-injection regression contract (#4875 register, T-5 evidence column).

The 8 T-5 attacks (#3785 leak, #3786 scope bypass, 4 indirect document injections) are
fixtures in tests/eval/adversarial/t5_prompt_injection_2026_10_29.jsonl. Their deterministic
defences live in the Hub (prompt-leak guard, scope check) — Python's classify_intent() labels
every probe 'industrial' — so the behavioural regression is the Hub test
mira-hub/src/capabilities/__tests__/t5-offline-regression.test.ts.

This offline-eval test fails if the fixture loses a case or a required field, or if the Hub
test is deleted or stops reading this fixture — so the regression can't silently disappear.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "tests/eval/adversarial/t5_prompt_injection_2026_10_29.jsonl"
HUB_TEST = REPO / "mira-hub/src/capabilities/__tests__/t5-offline-regression.test.ts"
EXPECTED_IDS = ["t5-L1", "t5-L2", "t5-L3", "t5-S1", "t5-I1", "t5-I2", "t5-I3", "t5-I4"]


def _cases() -> list[dict]:
    return [json.loads(line) for line in FIXTURE.read_text().splitlines() if line.strip()]


def test_fixture_has_every_t5_case_with_required_fields():
    cases = _cases()
    assert [c["id"] for c in cases] == EXPECTED_IDS
    for c in cases:
        for field in ("issue", "kind", "probe", "expected", "defence"):
            assert c.get(field), f"{c['id']} missing {field}"
        assert c["kind"] in ("direct_leak", "direct_scope", "indirect")
        if c["kind"] == "indirect":
            assert c.get("document"), f"{c['id']} has no injected document"


def test_direct_cases_name_a_deterministic_defence():
    for c in _cases():
        if c["kind"] == "direct_leak":
            assert c["defence"] == "prompt-leak-guard", c["id"]
        if c["kind"] == "direct_scope":
            assert c["defence"] == "scope-check", c["id"]


def test_hub_regression_test_exists_and_reads_this_fixture():
    assert HUB_TEST.is_file(), "the Hub T-5 regression test was removed"
    src = HUB_TEST.read_text()
    assert FIXTURE.name in src, "the Hub T-5 regression test no longer reads this fixture"
    for symbol in ("detectPromptLeak", "isOffTopic"):
        assert symbol in src, f"the Hub T-5 regression test no longer exercises {symbol}"
