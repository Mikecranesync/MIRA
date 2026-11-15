"""Hermetic proofs for lane selection and count parsing. Fake runner only: no test is executed.

Each selection reason is asserted with the paths that matched it, so "safety ran" is
checked against the always reason and the matched guardrails path, not assumed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval_select as sel  # noqa: E402

LANES = sel.load_lanes(REPO / "evals" / "autoeval.lanes.json")
BY_NAME = {ln.name: ln for ln in LANES}
ALL = set(BY_NAME)


def _names(selection):
    return {ln.name for ln, _, _ in selection.selected}


def _reason(selection, name):
    return next(r for ln, r, _ in selection.selected if ln.name == name)


def _matched(selection, name):
    return next(m for ln, _, m in selection.selected if ln.name == name)


def test_docs_only_change_selects_only_the_always_safety_lane():
    s = sel.select(["docs/plans/x.md", "wiki/hot.md"], full=False, lanes=LANES)
    assert _names(s) == {"safety"}
    assert _reason(s, "safety") == "always"
    assert s.unmapped == ()


def test_control_a_code_change_to_citation_selects_citation_by_trigger():
    s = sel.select(["mira-bots/shared/citation_compliance.py"], full=False, lanes=LANES)
    assert _reason(s, "citation") == "trigger"
    assert "mira-bots/shared/citation_compliance.py" in _matched(s, "citation")
    assert _names(s) != {"safety"}


def test_guardrails_change_selects_safety_with_the_guardrails_path_as_its_match():
    s = sel.select(["mira-bots/shared/guardrails.py"], full=False, lanes=LANES)
    assert "safety" in _names(s)
    assert _reason(s, "safety") == "always"
    assert "mira-bots/shared/guardrails.py" in _matched(s, "safety")


def test_removing_the_guardrails_trigger_would_drop_its_match():
    lanes = [
        sel.Lane(
            ln.name, ln.always, tuple(t for t in ln.triggers if "guardrails" not in t), ln.steps
        )
        for ln in LANES
    ]
    s = sel.select(["mira-bots/shared/guardrails.py"], full=False, lanes=lanes)
    assert "mira-bots/shared/guardrails.py" not in _matched(s, "safety")


def test_unmapped_code_path_selects_every_lane():
    s = sel.select(["mira-hub/src/lib/brand-new-thing.ts"], full=False, lanes=LANES)
    assert _names(s) == ALL
    assert all(r in ("always", "unmapped") for _, r, _ in s.selected)
    assert s.unmapped == ("mira-hub/src/lib/brand-new-thing.ts",)


def test_control_docs_plus_unmapped_still_selects_all_only_because_of_the_code_path():
    only_docs = sel.select(["docs/a.md"], full=False, lanes=LANES)
    assert _names(only_docs) == {"safety"}
    mixed = sel.select(
        ["docs/a.md", "mira-hub/src/lib/brand-new-thing.ts"], full=False, lanes=LANES
    )
    assert _names(mixed) == ALL


def test_full_selects_every_lane_with_reason_full():
    s = sel.select([], full=True, lanes=LANES)
    assert _names(s) == ALL
    assert {r for _, r, _ in s.selected} == {"full"}


def test_no_changed_paths_selects_only_the_always_lane():
    s = sel.select([], full=False, lanes=LANES)
    assert _names(s) == {"safety"}


def test_editing_a_lane_test_file_selects_that_lane():
    s = sel.select(["mira-hub/src/lib/citation-page.test.ts"], full=False, lanes=LANES)
    assert _reason(s, "citation") == "trigger"


def test_every_lane_file_named_in_the_table_exists_at_the_base_commit():
    missing = []
    for ln in LANES:
        for st in ln.steps:
            for f in st.files:
                if not (REPO / st.cwd / f).exists():
                    missing.append(f"{st.cwd}/{f}")
    assert missing == []


def test_risk_class_is_r3_for_safety_and_r0_for_docs():
    risk = sel.risk_classes(["mira-bots/shared/guardrails.py", "docs/a.md"])
    assert risk["mira-bots/shared/guardrails.py"] == "R3"
    assert risk["docs/a.md"] == "R0"


def test_counts_parse_pytest_summary_line():
    out = "collected 8\n...\n=== 2 failed, 5 passed, 1 skipped in 0.52s ==="
    assert sel.parse_counts("pytest", out) == {"failed": 2, "passed": 5, "skipped": 1}


def test_counts_parse_vitest_tests_line():
    out = " ✓ a\n  Tests  1 failed | 5 passed (6)\n"
    assert sel.parse_counts("vitest", out) == {"failed": 1, "passed": 5}


def test_counts_absent_output_is_empty_not_a_pass():
    assert sel.parse_counts("pytest", "no tests ran in 0.01s") == {}
    assert sel.parse_counts("vitest", "Error: Cannot find module vitest") == {}


def _lane(runner_name):
    return next(ln for ln in LANES if ln.name == runner_name)


def _fake(rc, out):
    def runner(argv, cwd):
        return rc, out

    return runner


def test_control_lane_with_passing_count_is_pass():
    res = sel.run_lane(_lane("wrong_manual"), REPO, _fake(0, "Tests  4 passed (4)"))
    assert res.status == "pass"


def test_lane_with_no_count_is_infra_error_never_pass():
    res = sel.run_lane(_lane("citation"), REPO, _fake(0, "collected 0 items"))
    assert res.status == "infra_error"


def test_lane_with_zero_passed_and_no_failure_is_infra_error():
    res = sel.run_lane(_lane("citation"), REPO, _fake(0, "=== 0 passed in 0.1s ==="))
    assert res.status == "infra_error"


def test_lane_nonzero_exit_without_a_count_is_infra_error():
    res = sel.run_lane(_lane("citation"), REPO, _fake(2, "ERROR collecting"))
    assert res.status == "infra_error"


def test_lane_with_a_failure_count_is_fail_and_outranks_infra():
    res = sel.run_lane(_lane("safety"), REPO, _fake(1, "=== 1 failed, 3 passed in 0.2s ==="))
    assert res.status == "fail"


def test_run_lane_invokes_the_declared_cwd_and_files_and_never_runs_real_tests():
    calls = []

    def runner(argv, cwd):
        calls.append((argv, cwd))
        return 0, "Tests  2 passed (2)"

    res = sel.run_lane(_lane("wrong_manual"), REPO, runner)
    assert res.status == "pass"
    argv, cwd = calls[0]
    assert cwd == str(REPO / "mira-hub")
    assert argv[:4] == ["npx", "--no-install", "vitest", "run"]
    assert argv[4].endswith("wrong-manual.test.ts")


def test_safety_lane_is_always_flagged_always_and_has_both_runners():
    assert BY_NAME["safety"].always is True
    assert {st.runner for st in BY_NAME["safety"].steps} == {"vitest", "pytest"}
    assert all(not BY_NAME[n].always for n in ALL - {"safety"})


def _mixes_conftest_roots(step) -> bool:
    return len({f.startswith("mira-bots/") for f in step.files}) > 1


def test_no_pytest_step_mixes_the_two_conftest_roots():
    # tests/conftest.py and mira-bots/tests/conftest.py cannot be collected in one invocation
    # (ImportPathMismatchError); CI runs them as separate invocations too.
    for ln in LANES:
        for st in ln.steps:
            if st.runner == "pytest":
                assert not _mixes_conftest_roots(st), ln.name


def test_control_the_mixed_step_is_detected():
    assert _mixes_conftest_roots(sel.Step(".", "pytest", ("mira-bots/tests/a.py", "tests/b.py")))
    assert not _mixes_conftest_roots(sel.Step(".", "pytest", ("tests/a.py", "tests/b.py")))
