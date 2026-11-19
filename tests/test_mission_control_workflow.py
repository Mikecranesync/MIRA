"""Capability workflow: exact revision/build binding and safe plan projection."""
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"
spec = importlib.util.spec_from_file_location("mission_control_server_workflow", MC / "server.py")
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)
workflow = server.workflow
NOW = dt.datetime(2026, 11, 18, 22, 0, tzinfo=dt.timezone.utc)
AT = NOW.isoformat()
REV, HEAD, BUILD = "a" * 40, "b" * 40, "c" * 40
REPO = "Mikecranesync/MIRA"
SOURCE = f"https://github.com/{REPO}/issues/5232#issuecomment-6870960483"
PROOF = f"https://github.com/{REPO}/pull/5625#issuecomment-6992591038"
DECISION = f"https://github.com/{REPO}/issues/5232#issuecomment-8"
GEN, CONFIG = "staging-generation-1", "d" * 64


def fixture_results():
    return [
        {"id": rid, "status": "PASS", "build": BUILD, "environment": "staging",
         "generation": GEN, "configuration_sha256": CONFIG,
         "observed": "Passed on tablet", "receipt": PROOF}
        for rid in ("FIND-01", "FIND-02")
    ]


ROWS = {entry["id"]: {k: v for k, v in entry.items() if k != "id"} for entry in fixture_results()}
DIGEST = hashlib.sha256(json.dumps(ROWS, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
ENVELOPE = "\n".join((
    "[CAPABILITY-ACCEPTED]", f"Plan revision: {REV}", "Step: 1", "PR: 5625",
    f"PR head: {HEAD}", f"Build: {BUILD}", "Environment: staging",
    f"Runtime generation: {GEN}", f"Configuration SHA-256: {CONFIG}", f"Results SHA-256: {DIGEST}",
))
ROADMAP = """# Roadmap

Build trusted equipment context.

## Capability sequence

| Step | Name | New technician capability | Proof before moving on |
|---|---|---|---|
| **1 — current** | **Find the Right Equipment** | Find the drive. | [Walk](find-the-right-equipment.md) |
| 2 | Open Its Workbench | Open its manual. | Open the cited page. |
"""
PLAN = """# Step 1 — Find the Right Equipment

## Pass/fail contract

| ID | Test and expected result | Required evidence |
|---|---|---|
| FIND-01 | Find the drive. | Device receipt. |
| FIND-02 | Keep the draft. | Screen recording. |

## Implement and verify in this order

1. Qualify the candidate.
2. Walk the tablet.
"""


def documents():
    return workflow.load_documents(
        lambda path: ROADMAP if path.endswith("capability-roadmap.md") else PLAN, REPO, REV
    )


def report(**overrides):
    block = {
        "plan_revision": REV,
        "step": 1,
        "pr": 5625,
        "head": HEAD,
        "build": BUILD,
        "environment": "staging",
        "generation": GEN,
        "configuration_sha256": CONFIG,
        "action": {
            "title": "Walk the tablet",
            "owner": "CHARLIE Codex",
            "expected": "Find the drive",
            "observed": "Drive selected",
            "status": "PASS",
            "next": "Record acceptance",
        },
        "results": fixture_results(),
        "decision": DECISION,
    }
    block.update(overrides)
    return {
        "id": 6870960483,
        "lane": "CHARLIE-CODEX",
        "trusted": 1,
        "url": SOURCE,
        "updated_at": AT,
        "raw": "[DELIVERY-UPDATE: CHARLIE-CODEX]\nUpdated: " + AT
               + f"\nCapability candidate: #5625 @ {HEAD}\n"
               + "```capability-results\n" + json.dumps(block) + "\n```",
        "parsed": {},
    }


def evidence(review_passes=True, head=HEAD, runtime=BUILD, generation=GEN, configuration=CONFIG):
    return {
        "at": AT,
        "rows": [{
            "number": 5625, "head_sha": head,
            "cells": {
                "REVIEWED": {"on": review_passes, "label": "GREEN at head" if review_passes else "ISSUES_FOUND: 0 BLOCKER / 1 HIGH", "source": PROOF},
                "TESTED": {"on": True, "label": "checks SUCCESS", "source": PROOF},
                "DEPLOYED:staging": {"on": True},
            },
        }],
        "envs": {"staging": {"ok": 1, "git_sha": runtime, "generation": generation, "configuration_sha256": configuration}},
    }


def project(rep=None, ev=None, state=None):
    return workflow.project(
        state or {"documents": documents(), "at": AT, "proposed": False,
                  "decision": {"url": DECISION, "envelope": ENVELOPE}},
        [rep or report()],
        ev or evidence(),
        NOW,
        report_id=6870960483,
        max_age_seconds=120,
        reports_at=AT,
    )


def test_workflow_loads_steps_and_executable_acceptance_contract():
    d = documents()
    assert [x["name"] for x in d["steps"]] == ["Find the Right Equipment", "Open Its Workbench"]
    assert [x["id"] for x in d["checks"]] == ["FIND-01", "FIND-02"]
    assert d["actions"] == ["Qualify the candidate.", "Walk the tablet."]


def test_new_failed_review_blocks_even_with_older_pass_and_decision():
    v = project(ev=evidence(False))
    assert v["status"] == "Blocked"
    assert "ISSUES_FOUND" in v["review"]["label"]
    assert v["review"]["source"] == PROOF
    assert v["next_step"]["name"] == "Open Its Workbench"


def test_receipts_on_replaced_candidate_or_runtime_are_history():
    for ev in (evidence(head="d" * 40), evidence(runtime="e" * 40)):
        v = project(ev=ev)
        assert v["status"] != "Accepted"
        assert all(row["status"] == "NO RECEIPT" and row["history"] for row in v["checks"])
        assert v["action"]["status"] != "PASS"


def test_advancement_requires_current_results_and_explicit_decision():
    assert project(report(decision=None))["status"] == "In progress"
    assert project()["status"] == "Accepted"
    assert project()["current"]["name"] == "Find the Right Equipment"
    assert project(state={"documents": documents(), "at": AT, "proposed": True})["status"] != "Accepted"


def test_reported_action_pass_remains_distinct_from_accepted_advancement():
    reported, accepted = project(report(decision=None)), project()
    no_receipts = project(report(results=[]))
    assert no_receipts["status"] == "In progress"
    assert all(check["status"] == "NO RECEIPT" for check in no_receipts["checks"])
    assert '<h3>Walk the tablet</h3><p class="meta">CHARLIE Codex · Reported pass</p>' in (
        server.cockpit.render_workflow(no_receipts)
    )
    assert reported["status"] == "In progress" and reported["decision"] is None
    assert accepted["status"] == "Accepted" and accepted["decision"] == DECISION
    assert reported["checks"] == accepted["checks"]
    assert reported["results_digest"] == accepted["results_digest"] == DIGEST

    reported_html = server.cockpit.render_workflow(reported)
    assert '<h3>Walk the tablet</h3><p class="meta">CHARLIE Codex · Reported pass</p>' in reported_html
    assert "Acceptance decision" not in reported_html
    assert "View receipt" in reported_html

    accepted_html = server.cockpit.render_workflow(accepted)
    assert '<h3>Advance the roadmap</h3><p class="meta">CHARLIE Codex · integration · PASS</p>' in accepted_html
    assert "Acceptance decision" in accepted_html


def test_stale_untrusted_or_ambiguous_results_cannot_accept():
    assert project(state={"documents": documents(), "at": "2026-11-17T00:00:00Z"})["status"] == "Evidence stale"
    assert project({**report(), "trusted": 0})["status"] != "Accepted"
    duplicate = {"id": "FIND-01", "build": BUILD, "environment": "staging",
                 "status": "PASS", "observed": "duplicate", "receipt": PROOF}
    assert project(report(results=[duplicate, duplicate]))["status"] != "Accepted"


def test_refresh_keeps_last_good_and_fetches_both_files_at_same_revision():
    calls = []

    def get(url, headers):
        calls.append(url)
        assert url.endswith("?ref=" + REV)
        md = ROADMAP if "/capability-roadmap.md?" in url else PLAN
        return 200, {}, {"encoding": "base64", "content": base64.b64encode(md.encode()).decode()}

    state = workflow.refresh({}, get, REPO, pin=REV, now=NOW)
    assert len(calls) == 2 and state["proposed"] and state["at"]
    assert workflow.refresh(state, get, REPO, pin=REV, now=NOW)["at"] == state["at"]
    assert len(calls) == 2
    bad = workflow.refresh(state, lambda *_a, **_k: (503, {}, {}), REPO, pin=HEAD, now=NOW)
    assert bad["documents"] == state["documents"] and bad["at"] == state["at"] and bad["error"]


def test_result_text_is_escaped_in_homepage_render():
    v = project(report(action={"title": "<img onerror=evil>", "owner": "A",
                               "expected": "Find", "observed": "<script>old</script>",
                               "status": "FAIL", "next": "Repair"}))
    html = server.cockpit.render_workflow(v)
    assert "&lt;img" in html and "&lt;script&gt;" in html
    assert "<img" not in html and "<script>" not in html


def test_new_candidate_requires_review_and_uses_only_its_owner_decision():
    new_head = "d" * 40
    ev = evidence(head=new_head)
    ev["rows"][0]["cells"]["REVIEWED"] = {"on": False, "label": "no well-formed review at this head"}
    coordinator = report()
    coordinator["raw"] = "[DELIVERY-UPDATE: CHARLIE-CODEX]\nBranch / SHA: #5625 old\n"
    ui = {
        "id": 2, "lane": "CHARLIE-CLAUDE", "trusted": 1,
        "url": SOURCE, "updated_at": AT,
        "raw": f"[DELIVERY-UPDATE: CHARLIE-CLAUDE]\nUpdated: {AT}\n"
               f"```html\n<details>\n```\n\nPushed {new_head[:9]}",
        "parsed": {"items": [5625], "state": "BLOCKED", "decision": "Authorize review of new candidate"},
    }
    state = {"documents": documents(), "at": AT}
    value = workflow.project(state, [coordinator, ui], ev, NOW, report_id=6870960483,
                             max_age_seconds=120, reports_at=AT)
    assert value["status"] == "Blocked"
    assert value["action"]["next"] == "Authorize review of new candidate"
    assert value["action"]["observed"] == "no well-formed review at this head"
    ui["raw"] = (f"[DELIVERY-UPDATE: CHARLIE-CLAUDE]\nUpdated: {AT}\n"
                 f"```text\nExample review at {new_head[:9]}\n```\n\nEarlier review at {HEAD}")
    unrelated = workflow.project(state, [coordinator, ui], ev, NOW, report_id=6870960483,
                                 max_age_seconds=120, reports_at=AT)
    assert unrelated["ui_url"] is None


def test_unrelated_main_commit_preserves_the_readable_plan_revision():
    ref = REV

    def get(url, headers):
        if url.endswith("/commits/main"):
            return 200, {}, {"sha": ref}
        md = ROADMAP if "/capability-roadmap.md?" in url else PLAN
        return 200, {}, {"encoding": "base64", "content": base64.b64encode(md.encode()).decode()}

    first = workflow.refresh({}, get, REPO, now=NOW)
    ref = HEAD
    new = workflow.refresh(first, get, REPO, now=NOW + dt.timedelta(seconds=60))
    assert new["source_sha"] == HEAD and new["documents"]["revision"] == REV
    assert new["at"] != first["at"]


def test_arbitrary_link_or_unverified_approval_cannot_accept():
    state = {"documents": documents(), "at": AT, "proposed": False}
    assert project(state=state)["status"] == "In progress"
    assert project(report(decision=PROOF))["status"] == "In progress"

    def check(body, user="Mikecranesync"):
        def get(url, headers):
            assert url == f"https://api.github.com/repos/{REPO}/issues/comments/8"
            return 200, {}, {"body": body, "html_url": DECISION, "user": {"login": user}}

        return workflow.verify_decision(get, REPO, 5232, [report()], 6870960483, "Mikecranesync")

    assert not check(ENVELOPE, "other-user")
    assert not check("Any unrelated decision")
    assert not check(ENVELOPE.replace(BUILD, REV))
    assert check(ENVELOPE) == {"url": DECISION, "envelope": ENVELOPE}


def test_workflow_pr_evidence_remains_visible_after_it_leaves_open_board():
    r = report()
    assert server.reports.parse(r["raw"])["items"] == []
    plan = {"documents": documents()}
    assert workflow.coordinator_pr(plan, [r], 6870960483) == 5625

    class Handler:
        snapshot = server.Snapshot(lambda: [])
        workflow_evidence = {}

    class Evidence:
        def gather(self, _post, _get, _repo, numbers, *_args):
            return {"rows": [{"number": n} for n in numbers]}

    server.runtime.refresh_evidence(Handler, Evidence(), None, None, [7], {}, (), {}, None)
    server.runtime.refresh_workflow_evidence(Handler, Evidence(), None, None, 5625, {}, (), {}, None)
    assert [r["number"] for r in Handler.evidence["rows"]] == [7]
    assert [r["number"] for r in Handler.workflow_evidence["rows"]] == [5625]


def test_project_links_show_real_refs_and_preserve_stale_status():
    links = server.project_links

    def get(url, headers):
        number = int(url.rsplit("/", 1)[-1])
        return 200, {}, {"number": number, "title": f"GitHub item {number}", "state": "open",
                         "draft": number == 5625}

    state = links.refresh({}, get, REPO, NOW)
    v = links.project(state, 1, NOW)
    assert v["fresh"] and v["current"][0]["issue"]["number"] == 5617
    assert v["current"][0]["prs"][0]["state"] == "Draft"
    assert {i["issue"]["number"] for i in v["next"]} == {5600, 5626}
    page = server.cockpit._project_work(v)
    assert "https://github.com/Mikecranesync/MIRA/pull/5625" in page
    assert "No closing PR linked" in page
    then = NOW + dt.timedelta(minutes=6)
    failed = links.refresh(state, lambda *a, **kw: (503, {}, {}), REPO, then)
    stale = links.project(failed, 1, then)
    assert not stale["fresh"] and stale["current"] == v["current"]
    assert "Last seen project records" in server.cockpit._project_work(stale)


def test_replacing_the_candidate_pr_makes_earlier_passes_historical():
    coordinator = report()
    coordinator["raw"] = coordinator["raw"].replace(
        f"Capability candidate: #5625 @ {HEAD}", f"Capability candidate: #5630 @ {HEAD}",
    )
    ev = evidence()
    next_row = {**ev["rows"][0], "number": 5630}
    ev["rows"].append(next_row)
    value = project(coordinator, ev)
    assert value["status"] == "Blocked"
    assert "differs from these results" in value["result_error"]
    assert all(c["status"] == "NO RECEIPT" and c["history"] for c in value["checks"])


def test_same_sha_recreation_flag_change_or_missing_config_invalidates_results():
    for change in ({"generation": "second"}, {"configuration": "e" * 64}, {"configuration": None}):
        value = project(ev=evidence(**change))
        assert value["status"] != "Accepted"
        assert value["action"]["status"] != "PASS"
        assert all(c["status"] == "NO RECEIPT" and c["history"] for c in value["checks"])


def test_owner_decision_is_bound_to_nonblank_specific_receipts():
    entries = fixture_results()
    entries[0]["observed"] = "Different observation"
    assert project(report(results=entries))["status"] != "Accepted"
    entries[0]["observed"] = " "
    assert project(report(results=entries))["result_error"]
    entries[0]["observed"] = "Valid observation"
    entries[0]["receipt"] = "https://github.com/"
    invalid = project(report(results=entries))
    assert invalid["result_error"] and invalid["status"] != "Accepted"


def test_capability_fence_proof_mentions_do_not_enter_readiness():
    r = report(action={
        "title": "Confirm #5630", "owner": "A", "expected": "Probe only", "observed": "See #5625",
        "status": "NOT TESTED", "next": "Read update",
    })
    assert server.reports.parse(r["raw"])["items"] == []
    assert workflow.coordinator_pr({"documents": documents()}, [r], 6870960483) == 5625


def test_next_capability_template_shows_expected_result_and_proof():
    plan = """## Acceptance contract

| ID | Technician action or failure condition | Expected observable result | Proof level / owner | Receipt and result |
|---|---|---|---|---|
| NEXT-01 | Open manual. | Correct manual opens. | Device recording. | NOT TESTED |
"""
    value = workflow.load_documents(lambda path: ROADMAP if "roadmap" in path else plan, REPO, REV)
    assert value["checks"] == [
        {"id": "NEXT-01", "expected": "Correct manual opens.", "proof": "Device recording."}
    ]


def test_projects_outage_does_not_stop_workflow_evidence():
    r = report()

    class BoardUnavailable:
        def get(self):
            return self
        at = NOW
        error = "Projects denied"

    class NoopPoll:
        def poll_events(self, *args): pass
        def poll_reports(self, *args): pass

    class Store:
        def reports(self): return [r]

    class Evidence:
        def gather(self, _post, _get, _repo, numbers, *_args):
            assert numbers == [5625]
            return {"rows": [{"number": 5625}], "at": AT}

    class Workflow:
        def refresh(self, *_args, **_kwargs): return {"documents": documents(), "at": AT}
        def verify_decision(self, *_args): return None
        def coordinator_pr(self, *_args): return 5625

    class Handler:
        snapshot = BoardUnavailable()
        poll_mod = NoopPoll()
        evidence_mod = Evidence()
        workflow_mod = Workflow()
        store = Store()
        plan_state = {}
        workflow_evidence = {}
        evidence = {}

        @staticmethod
        def trusted_authors():
            return ("Mikecranesync",)

    server.runtime.poll_once(Handler, lambda *a, **kw: (200, {}, {"sha": REV}), None, {})
    assert "Projects denied" in Handler.evidence["error"]
    assert Handler.workflow_evidence == {"rows": [{"number": 5625}], "at": AT}


def test_ambiguous_candidate_references_cannot_keep_an_old_acceptance():
    for line in (
        "Capability candidate: https://github.com/Mikecranesync/MIRA/pull/5630",
        f"Capability candidate: #5625 superseded by #5630 @ {HEAD}",
        "Capability candidate: #5625 @ 23456abcd",
        f"Capability candidate: #5625 @ {HEAD}\nCapability candidate: #5630 @ {HEAD}",
        f"Capability candidate: #5625 @ {HEAD}\nCapability candidate: [#5630](https://example.com)",
        *(f"Capability candidate: #5625 @ {HEAD}\n{' ' * n}Capability candidate: #5630 @ {HEAD}"
          for n in (1, 2, 3)),
        f"Capability candidate: #5625 @ {HEAD}\n**Capability candidate:** #5630 @ {HEAD}",
        f"Capability candidate: #5625 @ {HEAD}\nCapability  candidate : #5630 @ {HEAD}",
    ):
        value = report()
        value["raw"] = value["raw"].replace(f"Capability candidate: #5625 @ {HEAD}", line)
        projected = project(value)
        assert projected["status"] == "Blocked"
        assert all(row["history"] for row in projected["checks"])
        assert server.reports.parse(value["raw"])["items"] == []


def test_archived_examples_cannot_continue_acceptance():
    live = report()
    candidate = f"Capability candidate: #5625 @ {HEAD}"
    assert project(live)["status"] == "Accepted"
    assert project({**live, "raw": live["raw"] + "\n<details>\n\n" + live["raw"] + "\n</details>"})[
        "status"
    ] == "Accepted"

    variants = (
        live["raw"].replace(candidate, f"```text\n{candidate}\n```"),
        live["raw"].replace(candidate, f"`\n{candidate}\n`"),
        live["raw"].replace("\n```capability-results\n", "\n````example\n```capability-results\n")
        + "\n````",
        live["raw"].replace(candidate, f"<DETAILS>\n\n{candidate}") + "\n\n</DETAILS>",
    )
    for raw in variants:
        assert project({**live, "raw": raw})["status"] != "Accepted"


def test_fenced_history_example_cannot_hide_live_replacement():
    live = report()
    fenced_example = "\n\n```html\n<details>\n[DELIVERY-UPDATE: CHARLIE-CODEX]\n```\n\n"
    raw = (live["raw"] + fenced_example + f"Capability candidate: #5630 @ {HEAD}\n"
           "Next: follow up on production #5666")
    projected = project({**live, "raw": raw})
    assert projected["status"] == "Blocked"
    assert all(row["history"] for row in projected["checks"])
    assert server.reports.parse(raw)["items"] == [5666]


def test_legacy_candidate_after_fenced_example_is_visible():
    value = report()
    value["raw"] = (
        f"[DELIVERY-UPDATE: CHARLIE-CODEX]\nUpdated: {AT}\n"
        "```html\n<details>\nBranch / SHA: example PR #5625\n```\n\n"
        f"Branch / SHA: flag-fix at {HEAD}, PR #5630\n"
        "<details><summary>History</summary>\n\nBranch / SHA: earlier PR #5625\n\n</details>"
    )
    assert workflow.coordinator_pr({}, [value], value["id"], value["url"].split("#")[0]) == 5630


def test_capability_candidate_is_excluded_but_unclosed_fence_blocks_production():
    raw = report()["raw"] + "\nNext: follow up on production #5666"
    assert server.reports.parse(raw)["items"] == [5666]

    class Snap:
        def get(self):
            return self

        items = [{"kind": "PR", "repo": REPO, "state": "OPEN", "status": "In Progress", "number": 7}]
        at = NOW
        error = None

    class Handler:
        snapshot = Snap()

    class Store:
        def __init__(self, parsed):
            self.parsed = parsed

        def reports(self):
            return [{"trusted": 1, "parsed": self.parsed}]

    broken = raw.replace("\n```\nNext:", "\nNext:")
    later_example = "\n\n```text\nExample\n```"
    assert server.runtime.candidates(Handler, Store(server.reports.parse(raw + later_example)), now=NOW) == [7, 5666]
    duplicate = raw + "\n\n```capability-results\n{}\n```"
    for malformed in (broken, broken + later_example, duplicate):
        parsed = server.reports.parse(malformed)
        assert parsed["malformed_capability"] and 5666 in parsed["items"]
        try:
            server.runtime.candidates(Handler, Store(parsed), now=NOW)
        except RuntimeError as exc:
            assert "invalid capability-results block" in str(exc)
        else:
            raise AssertionError("Readiness accepted a malformed authoritative report")


def test_live_hub_probe_fields_map_to_acceptance_runtime():
    def get(url, headers):
        return 200, {}, {
            "service": "mira-hub", "version": "3.455.0", "gitSha": BUILD,
            "builtAt": "2026-11-18T20:00:00Z", "runtimeGeneration": GEN,
            "configurationSha256": CONFIG, "ts": 1000,
        }

    ev = evidence()
    ev["envs"]["staging"] = server.evidence.env_version(get, "https://app-staging.factorylm.com/api/version/")
    assert project(ev=ev)["status"] == "Accepted"
