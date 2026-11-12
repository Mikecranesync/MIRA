"""Mission control v2 (#4737): gathering lifecycle evidence from GitHub + env endpoints.

post/get are injected: no network. Only owner-account ledger comments count.
"""

from __future__ import annotations

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
LEDGER = (
    "[CODEX-ADVERSARIAL-REVIEW]\n\n```\nreviewed_sha: {sha}\nreviewed_body_sha256: {b}\nbase_sha: x\n"
    "status: GREEN\nreview_iteration: 1\n\nBLOCKER: 0\nHIGH: 0\nMEDIUM: 0\nLOW: 0\nFALSE_POSITIVE: 0\n```\n"
)


def gql(prs: dict):
    def post(body):
        assert "mutation" not in body["query"].lower()
        return {"data": {"repository": {f"pr{n}": v for n, v in prs.items()}}}

    return post


def pr(head=HEAD, state="OPEN", merge=None, rollup="SUCCESS"):
    return {
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
                        "body": LEDGER.format(sha=HEAD, b="a" * 64),
                        "html_url": "u1",
                    },
                    {
                        "user": {"login": "stranger"},
                        "body": LEDGER.format(sha=OTHER, b="a" * 64),
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
                        "body": LEDGER.format(sha=HEAD, b="a" * 64),
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
    body = f"[FIELD-VERIFIED]\nproduction sha {MERGE} checked on the Pixel"
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
