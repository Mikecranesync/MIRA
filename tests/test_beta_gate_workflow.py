"""The beta gate must not be able to pass by SKIPPING.

`tests/beta/beta_ready_upload_retrieval_citation.py` skips itself when `BETA_GATE_*` is unset
(lines 53-61) — correct for a local pytest run. But **a pytest run whose only test skips exits
0**, and the workflow's main lane captured that exit code as its verdict. So if provisioning
degraded — Doppler token scope, staging Neon unreachable, `provision-beta-gate.ts` emitting
empty env lines — the job reported SUCCESS having proven nothing about upload → retrieval →
citation, which is the project's headline beta gate and is described in root CLAUDE.md as
"CI-enforced".

The workflow already stated the property at line 55 ("must not be able to reach main on a green
CI that skipped it") and already used the correct idiom for the *preflight* lane ~288 lines
below. The headline lane simply never got it. Found 2026-09-07 by making the gate fail on the
regression it names.

This file pins both halves: the guard exists in the main lane, and the guard's logic actually
distinguishes a skip from a pass.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "beta-gate.yml"


def _main_lane() -> str:
    """The run-block that executes the headline gate test, up to the cleanup sweep."""
    text = WORKFLOW.read_text()
    start = text.index("python -m pytest tests/beta/beta_ready_upload_retrieval_citation.py")
    end = text.index("SWEEP_RC=0", start)
    return text[start:end]


def test_the_headline_lane_rejects_a_skip() -> None:
    lane = _main_lane()
    assert re.search(r'grep -qiE "skipped\|no tests ran"', lane), (
        "the beta gate's main lane does not fail on a skipped run — a pytest run whose only "
        "test skips exits 0, so the gate would report green having proven nothing"
    )
    assert "1 passed" in lane, "the main lane does not require an explicit passing case"


def test_the_headline_lane_captures_pytest_status_without_a_pipe() -> None:
    """`| tee` would make GATE_RC the exit status of tee, which is the same class of defect."""
    lane = _main_lane()
    pytest_line = next(ln for ln in lane.splitlines() if "-m pytest" in ln)
    assert "| tee" not in pytest_line and "|tee" not in pytest_line, (
        f"gate output is piped, so GATE_RC is the pipe's status, not pytest's: {pytest_line!r}"
    )
    assert "> /tmp/beta-gate.out" in lane, "gate output is not captured for inspection"


def test_the_skip_check_runs_before_the_verdict_but_after_cleanup_is_still_reachable() -> None:
    """Cleanup is proof in this workflow: the skip check must set GATE_RC rather than exiting,
    so the staging sweep in step 6 still runs. An early `exit` here would silently stop
    cleaning up run-owned staging rows."""
    lane = _main_lane()
    guard = lane[lane.index("skipped|no tests ran") :]
    assert "GATE_RC=1" in guard, "the skip check must set GATE_RC"
    assert not re.search(r"^\s*exit\s+1\s*$", guard, re.M), (
        "the skip check exits early, which skips the cleanup sweep that step 6 treats as proof"
    )


SKIPPED_OUTPUT = "collected 1 item\n\ntests/beta/x.py::test_gate SKIPPED (BETA_GATE_URL unset)\n\n=== 1 skipped in 0.10s ===\n"
PASSED_OUTPUT = (
    "collected 1 item\n\ntests/beta/x.py::test_gate PASSED\n\n=== 1 passed in 12.30s ===\n"
)
NO_TESTS_OUTPUT = "collected 0 items\n\n=== no tests ran in 0.01s ===\n"


@pytest.mark.parametrize(
    ("output", "expect_fail"),
    [(SKIPPED_OUTPUT, True), (NO_TESTS_OUTPUT, True), (PASSED_OUTPUT, False)],
)
def test_the_guard_logic_distinguishes_a_skip_from_a_pass(
    tmp_path: Path, output: str, expect_fail: bool
) -> None:
    """Behavioural, not structural: run the guard's own shell against captured pytest output.

    Without this, the two assertions above prove only that some text is present in a YAML file.
    """
    out = tmp_path / "beta-gate.out"
    out.write_text(output)
    script = f"""
    GATE_RC=0
    if grep -qiE "skipped|no tests ran" {out}; then GATE_RC=1; fi
    if ! grep -qE "(^| )1 passed" {out}; then GATE_RC=1; fi
    exit "$GATE_RC"
    """
    rc = subprocess.run(["bash", "-c", script], capture_output=True, text=True).returncode
    assert (rc != 0) is expect_fail, f"guard verdict wrong for output: {output!r}"
