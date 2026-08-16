"""Behavior-lock tests for the Gate 7 adversarial-review lane (CU-11).

Everything here is hermetic — the deterministic core (escalation detection,
prompt assembly, findings parsing, verdict arbitration) is tested with zero
network and zero tokens. The cascade call itself is I/O and is not exercised.

Why the escalation rules are tested this hard: they decide *reviewer effort* on
tenancy, schema, and auth changes. A trigger that silently stops firing would
downgrade exactly the reviews that matter most, and nothing else would notice.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from gate7_review import (  # noqa: E402
    BROAD_MODULE_THRESHOLD,
    Finding,
    build_prompt,
    escalation,
    parse_findings,
    render,
    Review,
    verdict_of,
)


# --- escalation: the doctrine's auto-xhigh list ----------------------------


def test_docs_only_change_stays_high():
    level, reasons = escalation(["docs/adr/0035-foo.md", "docs/plans/bar.md"], "docs: tidy prose")
    assert level == "high"
    assert reasons == []


@pytest.mark.parametrize(
    "paths,hay,expected_trigger",
    [
        (["mira-hub/db/migrations/076_x.sql"], "", "database/schema"),
        (["mira-bots/shared/uns_resolver.py"], "", "ISA-95/UNS"),
        (["some/file.py"], "adds a uns_path column", "ISA-95/UNS"),
        (["mira-hub/src/lib/auth/session.ts"], "", "authentication"),
        (["x.py"], "compares tenant_id in the RLS policy", "authorization"),
        (["mira-hub/src/lib/tenancy.ts"], "", "tenant scoping"),
        (["x.py"], "sets is_private on the write path", "tenant scoping"),
        (["docs/contracts/asset-tag-grammar.json"], "", "cross-repository contract"),
        (["docker-compose.saas.yml"], "", "production deployment"),
        (["x.py"], "runs DROP TABLE on rollback", "deletion/destructive"),
        (["x.py"], "adds a client_key for idempotency", "concurrency/idempotency/state"),
    ],
)
def test_each_doctrine_trigger_escalates(paths, hay, expected_trigger):
    level, reasons = escalation(paths, hay)
    assert level == "xhigh"
    assert expected_trigger in reasons


def test_broad_multi_module_change_escalates_on_count_alone():
    paths = [f"module{i}/file.txt" for i in range(BROAD_MODULE_THRESHOLD)]
    level, reasons = escalation(paths, "")
    assert level == "xhigh"
    assert any("broad multi-module" in r for r in reasons)


def test_just_under_the_broad_threshold_does_not_escalate():
    paths = [f"module{i}/file.txt" for i in range(BROAD_MODULE_THRESHOLD - 1)]
    level, _ = escalation(paths, "")
    assert level == "high"


def test_reasons_are_deduped_and_ordered():
    # A migration matches the path rule AND the keyword rule; it must appear once.
    _, reasons = escalation(["mira-hub/db/migrations/076.sql"], "ALTER TABLE foo -- migration")
    assert reasons.count("database/schema") == 1


def test_escalation_is_case_insensitive():
    # A real defect of exactly this shape (case sensitivity) is what Gate 7
    # caught on CU-P1, so the gate's own matcher must not have it.
    level, reasons = escalation(["X.PY"], "adds a TENANT_ID filter")
    assert level == "xhigh"
    assert "tenant scoping" in reasons


# --- prompt assembly -------------------------------------------------------


def test_prompt_briefs_the_reviewer_to_disprove_not_approve():
    p = build_prompt("t", "b", "diff", "high", [])
    assert "DISPROVE" in p
    assert "did NOT write this change" in p


def test_prompt_names_the_fired_triggers_as_attack_surface():
    p = build_prompt("t", "b", "d", "xhigh", ["tenant scoping", "authentication"])
    assert "XHIGH" in p
    assert "tenant scoping, authentication" in p
    assert "primary attack surface" in p


def test_prompt_truncates_a_huge_diff_rather_than_exploding():
    p = build_prompt("t", "b", "x" * 100_000, "high", [])
    assert len(p) < 60_000


# --- findings parsing ------------------------------------------------------


def test_parses_severity_title_and_detail():
    found = parse_findings(
        "## FINDINGS\n"
        "- **[severity: high] Tenant filter dropped** — `route.ts:42` reads without tenant_id\n"
        "- **[severity: low] Naming** — nit\n"
    )
    assert [f.severity for f in found] == ["high", "low"]
    assert found[0].title == "Tenant filter dropped"
    assert "route.ts:42" in found[0].detail


def test_none_found_yields_no_findings():
    assert parse_findings("## FINDINGS\n\nNone found\n") == []


# --- verdict arbitration ---------------------------------------------------


def test_stated_pass_is_honored_when_nothing_is_high():
    text = "## VERDICT\n\nPASS\n"
    assert verdict_of(text, [Finding("low", "nit")]) == "PASS"


def test_a_high_finding_overrides_a_stated_pass():
    """A reviewer listing a high-severity defect and then saying PASS is
    contradicting itself. The finding is the evidence, so the finding wins —
    otherwise a self-inconsistent review could wave through a real blocker."""
    text = "## VERDICT\n\nPASS\n"
    assert verdict_of(text, [Finding("high", "tenant leak")]) == "BLOCK"


def test_missing_verdict_section_is_unknown_not_pass():
    assert verdict_of("some prose with no verdict header", []) == "UNKNOWN"


def test_stated_block_is_honored():
    assert verdict_of("## VERDICT\n\nBLOCK\n", []) == "BLOCK"


# --- report shape ----------------------------------------------------------


def test_report_states_the_limits_of_independence():
    """The record must not imply a cross-vendor human review we are not doing."""
    out = render(Review("PASS", [], "groq (x)", "raw", ["groq: ok"]), 1, "high", [])
    assert "did not run the tests" in out
    assert "one check of eleven" in out


def test_report_carries_verdict_effort_and_triggers():
    out = render(
        Review("BLOCK", [Finding("high", "T", "d")], "groq (x)", "raw", []),
        42,
        "xhigh",
        ["tenant scoping"],
    )
    assert "PR #42" in out
    assert "**Verdict:** BLOCK" in out
    assert "xhigh" in out
    assert "tenant scoping" in out
    assert "**[high] T**" in out
