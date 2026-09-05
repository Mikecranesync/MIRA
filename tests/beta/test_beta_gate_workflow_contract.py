"""Workflow contract for .github/workflows/beta-gate.yml.

A Hub log can echo credentials (connection strings, session cookies, Doppler
tokens). GitHub masks only REGISTERED secrets, so every path that prints or
uploads a Hub log must go through tools/qa/redact_ci_log.sh — including the
"Hub never became ready" failure branches, which are the most likely to dump
a startup error containing a connection string.
"""

from __future__ import annotations

import pathlib
import re

WORKFLOW = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "beta-gate.yml"
HUB_LOG = re.compile(r"/tmp/hub[^ \s\"']*\.log")


def _run_lines() -> list[str]:
    return WORKFLOW.read_text(encoding="utf-8").splitlines()


def test_no_raw_cat_of_any_hub_log():
    offenders = [
        (i + 1, ln.strip())
        for i, ln in enumerate(_run_lines())
        if re.search(r"\bcat\s+/tmp/hub[^ \s\"']*\.log", ln) and "redact_ci_log.sh" not in ln
    ]
    assert not offenders, f"raw cat of a Hub log (must pipe through redact_ci_log.sh): {offenders}"


def test_every_hub_log_read_goes_through_the_redactor():
    # Any line that READS a hub log (cat / < / tee-from) must name the redactor,
    # except the line that CREATES it (`> /tmp/hub*.log 2>&1`) and artifact
    # `path:` entries, which must reference the .redacted.log variant only.
    bad = []
    for i, ln in enumerate(_run_lines(), start=1):
        s = ln.strip()
        if not HUB_LOG.search(s):
            continue
        if re.search(r">\s*/tmp/hub[^ \s\"']*\.log\s+2>&1", s):
            continue  # creation
        if s.startswith("path:") or s.startswith("- /tmp/hub") or s.startswith("/tmp/hub"):
            assert ".redacted.log" in s, f"line {i}: artifact path must be the redacted log: {s}"
            continue
        if "redact_ci_log.sh" not in s and ".redacted.log" not in s:
            bad.append((i, s))
    assert not bad, f"Hub log read without redaction: {bad}"


def test_uploaded_hub_logs_are_redacted_variants_only():
    text = WORKFLOW.read_text(encoding="utf-8")
    uploaded = re.findall(r"^\s*(?:path:\s*|-\s*)(/tmp/hub[^\s]*\.log)\s*$", text, re.M)
    assert uploaded, "expected at least one uploaded Hub log path"
    assert all(p.endswith(".redacted.log") for p in uploaded), uploaded


def test_admission_regression_pins_the_exact_real_postgres_test():
    text = WORKFLOW.read_text(encoding="utf-8")
    exact_node = (
        "tests/beta/test_admission_preflight_pg.py::"
        "test_real_connect_select_readonly_rollback_and_admission"
    )
    assert exact_node in text
    assert 'grep -qE "^1 passed" /tmp/preflight-pg.out' in text
    assert 'grep -qE "^2 passed" /tmp/preflight-pg.out' not in text
