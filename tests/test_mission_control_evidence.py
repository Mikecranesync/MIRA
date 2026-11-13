"""Mission control v2 (#4737): gathering lifecycle evidence from GitHub + env endpoints.

post/get are injected: no network. Only owner-account ledger comments count.
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


evidence = _load("mission_control_evidence", MC / "evidence.py")

HEAD = "0123456789abcdef0123456789abcdef01234567"
MERGE = "aaaa456789abcdef0123456789abcdef01234567"
OTHER = "fedcba9876543210fedcba9876543210fedcba98"
BODY_SHA = hashlib.sha256(b"").hexdigest()  # pr() fixtures carry an empty body
LEDGER = (
    "[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {sha}\nreviewed_body_sha256: {b}\nbase_sha: x\n"
    "status: GREEN\nreview_iteration: 1\n\nBLOCKER: 0\nHIGH: 0\nMEDIUM: 0\nLOW: 0\nFALSE_POSITIVE: 0\n```\n"
)


def gql(prs: dict):
    def post(body):
        assert "mutation" not in body["query"].lower()
        return {"data": {"repository": {f"pr{n}": v for n, v in prs.items()}}}

    return post


def pr(head=HEAD, state="OPEN", merge=None, rollup="SUCCESS", body=""):
    return {
        "body": body,
        "number": 12,
        "title": "t",
        "url": "https://github.com/o/r/pull/12",
        "state": state,
        "headRefOid": head,
        "mergeCommit": {"oid": merge} if merge else None,
        "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": rollup}}}]},
    }


class FakeGet:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, url, headers=None):
        self.calls.append(url)
        return self.answers.get(url, (404, {}, {"message": "nope"}))


def comments_url(n):
    return f"https://api.github.com/repos/o/r/issues/{n}/comments?per_page=100&page=1"


def test_gather_builds_a_tested_and_reviewed_row_from_owner_comments():
    get = FakeGet(
        {
            comments_url(12): (
                200,
                {},
                [
                    {
                        "user": {"login": "owner"},
                        "body": LEDGER.format(sha=HEAD, b=BODY_SHA),
                        "html_url": "u1",
                    },
                    {
                        "user": {"login": "stranger"},
                        "body": LEDGER.format(sha=OTHER, b=BODY_SHA),
                        "html_url": "u2",
                    },
                ],
            )
        }
    )
    out = evidence.gather(gql({12: pr()}), get, "o/r", [12], envs={}, trusted=("owner",))
    row = out["rows"][0]
    assert row["number"] == 12 and row["cells"]["TESTED"]["on"] and row["cells"]["REVIEWED"]["on"]
    assert row["cells"]["REVIEWED"]["source"] == "u1"


def test_failed_or_pending_checks_never_read_tested():
    get = FakeGet({comments_url(12): (200, {}, [])})
    for rollup in ("FAILURE", "PENDING", None):
        out = evidence.gather(
            gql({12: pr(rollup=rollup)}), get, "o/r", [12], envs={}, trusted=("owner",)
        )
        assert not out["rows"][0]["cells"]["TESTED"]["on"], rollup
    out = evidence.gather(
        gql({12: pr(rollup="SUCCESS")}), get, "o/r", [12], envs={}, trusted=("owner",)
    )
    assert out["rows"][0]["cells"]["TESTED"]["on"]  # control


def test_stranger_ledger_never_counts():
    get = FakeGet(
        {
            comments_url(12): (
                200,
                {},
                [
                    {
                        "user": {"login": "stranger"},
                        "body": LEDGER.format(sha=HEAD, b=BODY_SHA),
                        "html_url": "u2",
                    }
                ],
            )
        }
    )
    out = evidence.gather(gql({12: pr()}), get, "o/r", [12], envs={}, trusted=("owner",))
    assert not out["rows"][0]["cells"]["REVIEWED"]["on"]


def test_env_versions_and_ancestry_feed_deployed_cells():
    get = FakeGet(
        {
            comments_url(12): (200, {}, []),
            "https://prod.example/api/version/": (
                200,
                {},
                {"gitSha": OTHER, "builtAt": "2026-11-07T21:22:34Z"},
            ),
            f"https://api.github.com/repos/o/r/compare/{MERGE}...{OTHER}": (
                200,
                {},
                {"behind_by": 0, "ahead_by": 4},
            ),
            "https://api.github.com/repos/o/r/compare/5e79ca7131fbae3d46a6db2e6a3c760411d0acd2...fedcba9876543210fedcba9876543210fedcba98": (
                200,
                {},
                {"behind_by": 7},
            ),
        }
    )
    envs = {
        "production": "https://prod.example/api/version/",
        "staging": "http://127.0.0.1:4101/api/version/",
    }
    out = evidence.gather(
        gql({12: pr(state="MERGED", merge=MERGE)}),
        get,
        "o/r",
        [12],
        envs=envs,
        trusted=("owner",),
        main_sha="5e79ca7131fbae3d46a6db2e6a3c760411d0acd2",
    )
    cells = out["rows"][0]["cells"]
    assert cells["DEPLOYED:production"]["on"] and not cells["DEPLOYED:staging"]["on"]
    assert out["envs"]["production"]["git_sha"] == OTHER and out["envs"]["production"]["ok"] == 1
    assert out["envs"]["production"]["behind_by"] == 7  # merged-to-main commits not yet deployed
    assert out["envs"]["staging"]["ok"] == 0 and out["envs"]["staging"]["git_sha"] is None


def test_field_verified_marker_from_owner_only():
    body = f"[FIELD-VERIFIED]\nproduction sha {OTHER} checked on the Pixel"
    get = FakeGet(
        {
            comments_url(12): (
                200,
                {},
                [{"user": {"login": "owner"}, "body": body, "html_url": "u"}],
            ),
            "https://prod.example/api/version/": (200, {}, {"gitSha": OTHER, "builtAt": "t"}),
            f"https://api.github.com/repos/o/r/compare/{MERGE}...{OTHER}": (
                200,
                {},
                {"behind_by": 0},
            ),
        }
    )
    envs = {"production": "https://prod.example/api/version/"}
    out = evidence.gather(
        gql({12: pr(state="MERGED", merge=MERGE)}), get, "o/r", [12], envs=envs, trusted=("owner",)
    )
    assert out["rows"][0]["cells"]["FIELD-VERIFIED"]["on"]
    get.answers[comments_url(12)] = (
        200,
        {},
        [{"user": {"login": "stranger"}, "body": body, "html_url": "u"}],
    )
    out = evidence.gather(
        gql({12: pr(state="MERGED", merge=MERGE)}), get, "o/r", [12], envs=envs, trusted=("owner",)
    )
    assert not out["rows"][0]["cells"]["FIELD-VERIFIED"]["on"]


def test_gather_survives_graphql_failure_and_reports_it():
    def post(body):
        raise RuntimeError("github down")

    out = evidence.gather(post, FakeGet({}), "o/r", [12], envs={}, trusted=("owner",))
    assert out["rows"] == [] and "github down" in out["error"]


# --- Codex round 1 (PR #5455) findings -------------------------------------------------


def page_url(n, page):
    return f"https://api.github.com/repos/o/r/issues/{n}/comments?per_page=100&page={page}"


def test_truncated_comment_pages_never_certify_reviewed():  # F4
    first = [
        {"user": {"login": "owner"}, "body": LEDGER.format(sha=HEAD, b=BODY_SHA), "html_url": "u"}
    ]
    first += [{"user": {"login": "x"}, "body": "chatter", "html_url": "u"}] * 99  # a full page
    get = FakeGet({page_url(12, 1): (200, {}, first), page_url(12, 2): (502, {}, "bad gateway")})
    out = evidence.gather(gql({12: pr()}), get, "o/r", [12], envs={}, trusted=("owner",))
    row = out["rows"][0]
    assert not row["cells"]["REVIEWED"]["on"] and "page 2" in row["error"]
    get.answers[page_url(12, 2)] = (200, {}, [])  # control: complete read
    out = evidence.gather(gql({12: pr()}), get, "o/r", [12], envs={}, trusted=("owner",))
    assert out["rows"][0]["cells"]["REVIEWED"]["on"] and not out["rows"][0].get("error")


def test_partial_graphql_failure_keeps_the_unresolved_candidate_as_an_unproven_row():  # F4
    def post(body):
        return {
            "data": {"repository": {"pr12": pr(), "pr13": None}},
            "errors": [
                {"path": ["repository", "pr13"], "type": "RATE_LIMITED", "message": "slow down"}
            ],
        }

    get = FakeGet({page_url(12, 1): (200, {}, [])})
    out = evidence.gather(post, get, "o/r", [12, 13], envs={}, trusted=("owner",))
    assert [r["number"] for r in out["rows"]] == [12, 13]
    assert "RATE_LIMITED" in out["rows"][1]["error"]
    assert not any(c["on"] for c in out["rows"][1]["cells"].values())


def test_a_candidate_that_is_an_issue_not_a_pr_is_skipped_not_flagged():  # F4 control
    def post(body):
        return {
            "data": {"repository": {"pr12": pr(), "pr5232": None}},
            "errors": [{"path": ["repository", "pr5232"], "type": "NOT_FOUND", "message": "no"}],
        }

    get = FakeGet({page_url(12, 1): (200, {}, [])})
    out = evidence.gather(post, get, "o/r", [12, 5232], envs={}, trusted=("owner",))
    assert [r["number"] for r in out["rows"]] == [12]


def test_markers_carry_comment_order_and_followup_issues():  # F3
    comments = [
        {"user": {"login": "x"}, "body": "chatter first", "html_url": "u0"},
        {"user": {"login": "owner"}, "body": LEDGER.format(sha=HEAD, b=BODY_SHA), "html_url": "u1"},
        {
            "user": {"login": "owner"},
            "body": f"[REVIEW-FOLLOWUPS]\nreviewed_sha: {HEAD}\n#9",
            "html_url": "u2",
        },
    ]
    ev = evidence.markers(comments, ("owner",))
    assert ev["ledgers"][0]["seq"] == 1
    assert ev["followups"] == [{"sha": HEAD, "seq": 2, "issues": ["#9"]}]


def test_pr_body_hash_rides_on_the_item():  # F3
    out = evidence.fetch_prs(gql({12: pr(body="hello")}), "o/r", [12])
    assert out[12]["body_sha256"] == hashlib.sha256(b"hello").hexdigest()
