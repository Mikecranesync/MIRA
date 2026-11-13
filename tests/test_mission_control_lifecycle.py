"""Mission control v2 (#4737): the five-state evidence lifecycle.

IMPLEMENTED -> TESTED -> REVIEWED -> DEPLOYED:<env> -> FIELD-VERIFIED, never collapsed.
A cell lights only on independent evidence; an agent report only ever *claims*.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


lc = _load("mission_control_lifecycle", MC / "lifecycle.py")

HEAD = "0123456789abcdef0123456789abcdef01234567"
OTHER = "fedcba9876543210fedcba9876543210fedcba98"
MERGE = "aaaa456789abcdef0123456789abcdef01234567"

LEDGER_V2 = (
    "[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {sha}\nreviewed_body_sha256: {b}\n"
    "base_sha: {base}\nstatus: {status}\nreview_iteration: 1\n\nBLOCKER: {bl}\nHIGH: {hi}\n"
    "MEDIUM: {med}\nLOW: 0\nFALSE_POSITIVE: 0\n```\n"
)


def ledger(sha=HEAD, status="GREEN", bl=0, hi=0, med=0, crlf=False):
    s = LEDGER_V2.format(sha=sha, b="a" * 64, base=OTHER, status=status, bl=bl, hi=hi, med=med)
    return s.replace("\n", "\r\n") if crlf else s


def test_ledger_parser_reads_v2_and_crlf_bodies():
    r = lc.parse_ledger(ledger(med=1, crlf=True))
    assert (r["reviewed_sha"], r["status"], r["blocker"], r["high"], r["medium"]) == (
        HEAD,
        "GREEN",
        0,
        0,
        1,
    )
    assert lc.parse_ledger("[CODEX-ADVERSARIAL-REVIEW]\nnot a ledger") is None


def test_ledger_parser_reads_legacy_format_without_body_hash():
    legacy = (
        f"[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {HEAD}\nbase_sha: {OTHER}\n"
        "status: ISSUES_FOUND\nreview_iteration: 2\n\nBLOCKER: 1\nHIGH: 0\nMEDIUM: 0\nLOW: 0\n"
        "FALSE_POSITIVE: 0\n```\n"
    )
    assert lc.parse_ledger(legacy)["blocker"] == 1


def item(**over):
    base = {
        "number": 12,
        "kind": "pr",
        "state": "OPEN",
        "head_sha": HEAD,
        "merge_sha": None,
        "rollup": {"state": "SUCCESS", "sha": HEAD},
        "url": "https://github.com/o/r/pull/12",
        "title": "t",
    }
    base.update(over)
    return base


def bound(**over):
    return item(**{"body_sha256": "a" * 64, **over})


def evidence(**over):
    base = {
        "ledgers": [],  # owner-account [CODEX-ADVERSARIAL-REVIEW] records, oldest first
        "followups": [],  # reviewed_sha values of owner [REVIEW-FOLLOWUPS] records
        "envs": {},  # env -> {"git_sha", "behind_by"} (behind_by of merge sha vs deployed)
        "field_verified": [],  # shas named by acceptance-receipt artifacts / [FIELD-VERIFIED]
        "reports": [],  # parsed DELIVERY-UPDATE dicts mentioning this item
    }
    base.update(over)
    return base


def on(cells, name):
    return cells[name]["on"]


def test_open_pr_with_a_head_is_implemented_and_nothing_more():
    cells = lc.derive(item(rollup=None), evidence())["cells"]
    assert on(cells, "IMPLEMENTED") and cells["IMPLEMENTED"]["source"].startswith("https://")
    for name in ("TESTED", "REVIEWED", "DEPLOYED:staging", "DEPLOYED:production", "FIELD-VERIFIED"):
        assert not on(cells, name)


def test_tested_requires_a_success_rollup_at_the_exact_head():
    assert on(lc.derive(item(), evidence())["cells"], "TESTED")  # control
    stale = item(rollup={"state": "SUCCESS", "sha": OTHER})
    assert not on(lc.derive(stale, evidence())["cells"], "TESTED")
    failed = item(rollup={"state": "FAILURE", "sha": HEAD})
    assert not on(lc.derive(failed, evidence())["cells"], "TESTED")


def test_reviewed_requires_green_at_the_exact_head():
    green = lc.parse_ledger(ledger())
    assert on(lc.derive(bound(), evidence(ledgers=[green]))["cells"], "REVIEWED")  # control
    stale = lc.parse_ledger(ledger(sha=OTHER))
    assert not on(lc.derive(bound(), evidence(ledgers=[stale]))["cells"], "REVIEWED")
    # The newest record wins: a later ISSUES_FOUND with a HIGH un-lights an earlier GREEN.
    later_high = lc.parse_ledger(ledger(status="ISSUES_FOUND", hi=1))
    assert not on(lc.derive(bound(), evidence(ledgers=[green, later_high]))["cells"], "REVIEWED")


def test_reviewed_accepts_converged_only_with_followups_for_that_head():
    conv = dict(
        lc.parse_ledger(ledger(status="ISSUES_FOUND")), seq=0
    )  # 0 BLOCKER / 0 HIGH / 1 MEDIUM
    assert not on(lc.derive(bound(), evidence(ledgers=[conv]))["cells"], "REVIEWED")
    fu = [{"sha": HEAD, "seq": 1, "issues": ["#1"]}]
    cells = lc.derive(bound(), evidence(ledgers=[conv], followups=fu))["cells"]
    assert on(cells, "REVIEWED") and "CONVERGED" in cells["REVIEWED"]["label"]
    blocker = dict(lc.parse_ledger(ledger(status="ISSUES_FOUND", bl=1)), seq=0)
    assert not on(
        lc.derive(bound(), evidence(ledgers=[blocker], followups=fu))["cells"], "REVIEWED"
    )


def test_deployed_needs_ancestry_not_a_string_match_and_names_the_env():
    merged = item(state="MERGED", merge_sha=MERGE)
    envs = {"staging": {"git_sha": OTHER, "behind_by": 0}}
    cells = lc.derive(merged, evidence(envs=envs))["cells"]
    assert on(cells, "DEPLOYED:staging") and not on(cells, "DEPLOYED:production")
    assert "staging" in cells["DEPLOYED:staging"]["label"]
    envs = {"staging": {"git_sha": MERGE, "behind_by": 1}}  # same string, not an ancestor
    assert not on(lc.derive(merged, evidence(envs=envs))["cells"], "DEPLOYED:staging")
    envs = {"production": {"git_sha": OTHER, "behind_by": None}}  # unreachable env
    cells = lc.derive(merged, evidence(envs=envs))["cells"]
    assert (
        not on(cells, "DEPLOYED:production")
        and "unreachable" in cells["DEPLOYED:production"]["label"]
    )


def test_unmerged_pr_is_never_deployed():
    envs = {"production": {"git_sha": HEAD, "behind_by": 0}}
    assert not on(lc.derive(item(), evidence(envs=envs))["cells"], "DEPLOYED:production")


def test_field_verified_only_from_production_receipt_or_owner_marker():
    merged = item(state="MERGED", merge_sha=MERGE)
    prod = {"production": {"git_sha": OTHER, "behind_by": 0}}
    cells = lc.derive(merged, evidence(envs=prod, field_verified=[OTHER]))["cells"]
    assert on(cells, "FIELD-VERIFIED")  # control
    staging_only = {"staging": {"git_sha": OTHER, "behind_by": 0}}
    cells = lc.derive(merged, evidence(envs=staging_only, field_verified=[OTHER]))["cells"]
    assert not on(cells, "FIELD-VERIFIED")  # a staging deploy can never field-verify
    cells = lc.derive(merged, evidence(envs=prod, field_verified=[HEAD]))["cells"]
    assert not on(cells, "FIELD-VERIFIED")  # receipt for a different sha


def test_report_alone_lights_no_cell_only_a_reported_chip():
    rep = {"state": "COMPLETE", "evidence": "VERIFIED", "stage": "production", "items": [12]}
    out = lc.derive(item(rollup=None), evidence(reports=[rep]))
    assert out["reported"] == "COMPLETE / VERIFIED / production"
    for name in ("TESTED", "REVIEWED", "DEPLOYED:staging", "DEPLOYED:production", "FIELD-VERIFIED"):
        assert not on(out["cells"], name)
    assert lc.derive(item(rollup=None), evidence())["reported"] == "no report"


@pytest.mark.parametrize(
    ("hours_old", "expected"),
    [(1, "fresh"), (9.5, "stale")],
)
def test_report_freshness_uses_the_comment_updated_time(hours_old, expected):
    now = "2026-11-12T23:00:00Z"
    updated = "2026-11-12T22:00:00Z" if hours_old == 1 else "2026-11-12T13:30:00Z"
    assert lc.freshness(updated, now, stale_hours=9) == expected
    assert lc.freshness(None, now, stale_hours=9) == "missing"


def test_readiness_is_go_only_when_every_candidate_is_prod_deployed_and_field_verified():
    full = {
        "cells": {
            "DEPLOYED:production": {"on": True},
            "FIELD-VERIFIED": {"on": True},
        }
    }
    staging = {
        "cells": {
            "DEPLOYED:staging": {"on": True},
            "DEPLOYED:production": {"on": False},
            "FIELD-VERIFIED": {"on": False},
        }
    }
    assert lc.readiness([full], sources_stale=False)["decision"] == "GO"  # control
    r = lc.readiness([full, staging], sources_stale=False)
    assert r["decision"] == "NO-GO" and "DEPLOYED:production" in r["reason"]
    assert lc.readiness([full], sources_stale=True)["decision"] == "NO-GO"
    prod_only = {"cells": {"DEPLOYED:production": {"on": True}, "FIELD-VERIFIED": {"on": False}}}
    r = lc.readiness([prod_only], sources_stale=False)
    assert r["decision"] == "NO-GO" and "FIELD-VERIFIED" in r["reason"]  # deploy alone is not GO
    assert lc.readiness([], sources_stale=False)["decision"] == "NO-GO"  # nothing proven


# --- Codex round 1 (PR #5455) findings -------------------------------------------------


def test_field_verified_binds_to_the_running_production_sha_not_the_merge_commit():  # F2
    merged = item(state="MERGED", merge_sha=MERGE)
    prod = {"production": {"git_sha": OTHER, "behind_by": 0}}
    cells = lc.derive(merged, evidence(envs=prod, field_verified=[OTHER]))["cells"]
    assert on(cells, "FIELD-VERIFIED")  # control: marker names what production runs
    cells = lc.derive(merged, evidence(envs=prod, field_verified=[MERGE]))["cells"]
    assert not on(cells, "FIELD-VERIFIED")  # a marker for the merge commit is not a prod check
    advanced = {"production": {"git_sha": HEAD, "behind_by": 0}}  # prod moved on, unverified
    cells = lc.derive(merged, evidence(envs=advanced, field_verified=[OTHER]))["cells"]
    assert not on(cells, "FIELD-VERIFIED")


def test_ledger_parser_keeps_body_hash_low_count_and_legacy_flag():  # F3
    r = lc.parse_ledger(ledger())
    assert r["body_sha256"] == "a" * 64 and r["low"] == 0 and r["legacy"] is False
    legacy = (
        f"[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {HEAD}\nbase_sha: {OTHER}\n"
        "status: GREEN\nreview_iteration: 2\n\nBLOCKER: 0\nHIGH: 0\nMEDIUM: 0\nLOW: 0\n"
        "FALSE_POSITIVE: 0\n```\n"
    )
    assert lc.parse_ledger(legacy)["legacy"] is True


def test_reviewed_requires_the_ledger_body_hash_to_match_the_current_pr_body():  # F3
    green = lc.parse_ledger(ledger())
    assert on(lc.derive(bound(), evidence(ledgers=[green]))["cells"], "REVIEWED")  # control
    edited = bound(body_sha256="b" * 64)  # body changed after GREEN, same head
    assert not on(lc.derive(edited, evidence(ledgers=[green]))["cells"], "REVIEWED")
    assert not on(lc.derive(item(), evidence(ledgers=[green]))["cells"], "REVIEWED")  # unknown body


def test_reviewed_rejects_green_with_findings_and_legacy_records():  # F3
    lying = lc.parse_ledger(ledger(status="GREEN", bl=1))
    assert not on(lc.derive(bound(), evidence(ledgers=[lying]))["cells"], "REVIEWED")
    legacy = lc.parse_ledger(
        f"[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {HEAD}\nbase_sha: {OTHER}\n"
        "status: GREEN\nreview_iteration: 1\n\nBLOCKER: 0\nHIGH: 0\nMEDIUM: 0\nLOW: 0\n"
        "FALSE_POSITIVE: 0\n```\n"
    )
    assert not on(lc.derive(bound(), evidence(ledgers=[legacy]))["cells"], "REVIEWED")


def test_converged_needs_a_followups_record_newer_than_the_verdict_naming_issues():  # F3
    conv = dict(lc.parse_ledger(ledger(status="ISSUES_FOUND", med=1)), seq=5)
    good = {"sha": HEAD, "seq": 6, "issues": ["#1"]}
    assert on(lc.derive(bound(), evidence(ledgers=[conv], followups=[good]))["cells"], "REVIEWED")
    older = {"sha": HEAD, "seq": 4, "issues": ["#1"]}  # posted before the verdict
    assert not on(
        lc.derive(bound(), evidence(ledgers=[conv], followups=[older]))["cells"], "REVIEWED"
    )
    bare = {"sha": HEAD, "seq": 6, "issues": []}  # no follow-up issue filed
    assert not on(
        lc.derive(bound(), evidence(ledgers=[conv], followups=[bare]))["cells"], "REVIEWED"
    )


def test_followups_parser_reads_sha_and_issue_numbers():  # F3
    body = f"[REVIEW-FOLLOWUPS]\nreviewed_sha: {HEAD}\nMEDIUM F5 -> #5301\nMEDIUM F6 -> #5302\n"
    assert lc.followups(body) == {"sha": HEAD, "issues": ["#5301", "#5302"]}
    assert lc.followups("[REVIEW-FOLLOWUPS]\nnothing") is None


def test_readiness_is_no_go_while_any_candidate_has_incomplete_evidence():  # F4
    full = {"cells": {"DEPLOYED:production": {"on": True}, "FIELD-VERIFIED": {"on": True}}}
    broken = dict(full, number=13, error="comments page 2: 502")
    r = lc.readiness([full, broken], sources_stale=False)
    assert r["decision"] == "NO-GO" and "#13" in r["reason"] and "incomplete" in r["reason"]
    assert lc.readiness([full], sources_stale=False)["decision"] == "GO"  # control


def test_readiness_reports_the_given_staleness_reason():  # F1
    full = {"cells": {"DEPLOYED:production": {"on": True}, "FIELD-VERIFIED": {"on": True}}}
    r = lc.readiness([full], sources_stale=True, stale_reason="lifecycle evidence is 3 days old")
    assert r["decision"] == "NO-GO" and "3 days old" in r["reason"]
