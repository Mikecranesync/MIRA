#!/usr/bin/env python3
"""Turn a `[CHEAP-REVIEW]` PR comment into a head-bound GitHub check-run payload.

SDLC v1 Part B step 6 (docs/architecture/mira-sdlc-v1.md §4.2). The cheap review
lane (`tools/gate7_review.py <PR> --paid --post`) runs on a workstation under the
repository owner's token, and a personal token cannot create a check-run — only
a GitHub App can. So `.github/workflows/cheap-review-check.yml` reacts to the
comment and posts the check-run with the workflow's own token; this module is the
whole decision it makes, stdlib-only and network-free so it runs from the trusted
default-branch checkout with `python3 -I`.

The decision, in order (the first failing rule means nothing is posted):

1. The comment is the lane's envelope: it STARTS with `[CHEAP-REVIEW]`, then a
   fenced block of `key: value` lines carrying a 40-hex `head`, a `verdict`, a
   `model`, a `cost_usd`, a 32-hex `run_id` and a `scope` (`full`, or `partial`
   with an `excluded_files` count).
2. It was posted by the repository owner account as a `User` — the same
   authentication the review ledger applies (§4.4). Anyone else's envelope is
   ignored, however well-formed.
3. The reviewed `head` is still the pull request's head when the workflow runs.
4. The trigger only wakes the reconciler: the check this head should show is
   recomputed from ALL live, fully paginated owner reviews of it (`head_state`).
   The window starts at the newest FULL-scope review; any non-PASS verdict in it
   (that review, or a later scoped one) makes the head `failure`, sourced from the
   newest such review; otherwise a full PASS makes it `success`; scoped PASSes alone
   certify nothing and post nothing. So a replayed or late older review cannot post
   over a newer verdict (Codex F1, #4221), a `--paths` PASS never becomes a whole-head
   success (F2), and a newer scoped PASS never hides an earlier failure (F4).
5. Nothing is posted when the newest existing `Cheap Review` check-run on the head
   already shows that conclusion from that review's `run_id` (re-runs are no-ops).

Only then is a payload produced: check-run `Cheap Review` on that exact head,
`success` when the reconciled source is a full-scope `PASS`, `failure` for EVERY
other verdict. `neutral` and `skipped` are never used — branch protection treats both as passing.

The check-run stays ADVISORY until a required status context consumes it (a
branch-protection action, not this file). Its source limitation is stated in the
spec: any workflow in this repository holding `checks: write` can create a
check-run with the same name, so the context authenticates "a workflow token in
this repository", not this workflow specifically.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from typing import Iterable, Optional

MARKER = "[CHEAP-REVIEW]"
CHECK_NAME = "Cheap Review"
REQUIRED_FIELDS = ("head", "verdict", "model", "cost_usd", "run_id", "scope")

_ENVELOPE = re.compile(
    r"\A\[CHEAP-REVIEW\]\r?\n\r?\n```\r?\n(?P<block>.*?)\r?\n```(?:\r?\n|\Z)", re.DOTALL
)
_FIELD = re.compile(r"\A(?P<key>[a-z_]+): (?P<value>\S(?:.*\S)?)\Z")
_SHA40 = re.compile(r"\A[0-9a-f]{40}\Z")
_RUN_ID = re.compile(r"\A[0-9a-f]{32}\Z")
_VERDICT = re.compile(r"\A[A-Z]+\Z")
_COST = re.compile(r"\A[0-9]+(?:\.[0-9]+)?\Z")
_COUNT = re.compile(r"\A[1-9][0-9]*\Z")
_MAX_FIELD = 200


def parse_envelope(body: object) -> Optional[dict[str, str]]:
    """Return the envelope's fields, or None when the body is not a well-formed envelope."""
    if not isinstance(body, str):
        return None
    m = _ENVELOPE.match(body)
    if not m:
        return None
    fields: dict[str, str] = {}
    for line in m.group("block").splitlines():
        fm = _FIELD.match(line.rstrip("\r"))
        if not fm:
            return None
        key, value = fm.group("key"), fm.group("value")
        if key in fields or len(value) > _MAX_FIELD:
            return None
        fields[key] = value
    if any(k not in fields for k in REQUIRED_FIELDS):
        return None
    if not _SHA40.match(fields["head"]):
        return None
    if not _VERDICT.match(fields["verdict"]):
        return None
    if not _RUN_ID.match(fields["run_id"]):
        return None
    if not _COST.match(fields["cost_usd"]):
        return None
    if fields["scope"] == "full":
        if "excluded_files" in fields:
            return None
    elif fields["scope"] == "partial":
        if not _COUNT.match(fields.get("excluded_files", "")):
            return None
    else:
        return None
    return fields


def _is_owner_user(login: object, typ: object, owner: str) -> bool:
    return bool(owner) and login == owner and typ == "User"


@dataclass
class Decision:
    post: bool
    reason: str
    payload: dict = field(default_factory=dict)


def head_state(comments: Iterable[dict], owner: str, head: str) -> Optional[tuple[str, dict, dict]]:
    """Reconcile the check this head should show from ALL live owner reviews of it.

    Returns ``(conclusion, envelope, comment)`` or None when nothing certifies the head.
    Reviews are ordered by comment id (creation order). The window starts at the newest
    FULL-scope review; any non-PASS verdict inside that window (the full review itself or
    a later scoped one) makes the head ``failure``, sourced from the newest such review —
    a scoped PASS never outranks failure evidence (Codex F4, #4221). With no failure in
    the window, a full PASS makes it ``success``. Scoped PASSes alone certify nothing.
    """
    reviews: list[tuple[int, dict, dict]] = []
    for c in comments:
        user = c.get("user") or {}
        env = parse_envelope(c.get("body"))
        if (
            isinstance(c.get("id"), int)
            and _is_owner_user(user.get("login"), user.get("type"), owner)
            and env is not None
            and env["head"] == head
        ):
            reviews.append((c["id"], env, c))
    reviews.sort(key=lambda r: r[0])
    full = [r for r in reviews if r[1]["scope"] == "full"]
    window = [r for r in reviews if not full or r[0] >= full[-1][0]]
    failures = [r for r in window if r[1]["verdict"] != "PASS"]
    if failures:
        return "failure", failures[-1][1], failures[-1][2]
    if full and full[-1][1]["verdict"] == "PASS":
        return "success", full[-1][1], full[-1][2]
    return None


def decide(
    *,
    body: object,
    author_login: object,
    author_type: object,
    owner: str,
    current_head: str,
    comments: Iterable[dict],
    existing_checks: Iterable[dict],
) -> Decision:
    """Gate on the triggering comment, then reconcile the head's check from live evidence."""
    env = parse_envelope(body)
    if env is None:
        return Decision(False, "not a well-formed [CHEAP-REVIEW] envelope")
    if not _is_owner_user(author_login, author_type, owner):
        return Decision(
            False,
            f"envelope posted by {author_login!r} ({author_type!r}); only the repository owner "
            f"account {owner!r} as a User is trusted (SDLC v1 §4.4)",
        )
    if not _SHA40.match(current_head or ""):
        return Decision(False, f"current pull request head {current_head!r} is not a 40-hex SHA")
    if env["head"] != current_head:
        return Decision(
            False,
            f"reviewed head {env['head']} is no longer the pull request head ({current_head}); "
            "a verdict about superseded bytes is not posted",
        )
    state = head_state(comments, owner, current_head)
    if state is None:
        return Decision(
            False,
            f"no full-scope review and no failure among the owner reviews of {current_head}; "
            "a scoped PASS certifies nothing about the rest of the head",
        )
    conclusion, source, source_comment = state
    checks = [c for c in existing_checks if isinstance(c.get("id"), int)]
    latest = max(checks, key=lambda c: c["id"]) if checks else None
    if (
        latest is not None
        and latest.get("external_id") == source["run_id"]
        and latest.get("conclusion") == conclusion
    ):
        return Decision(
            False,
            f"{CHECK_NAME} already shows {conclusion} from run {source['run_id']}; nothing to do",
        )
    verdict = source["verdict"]
    title = f"Cheap review {verdict} at {source['head'][:12]}"
    lines = [
        f"verdict: {verdict}",
        f"head: {source['head']}",
        f"scope: {source['scope']}",
        f"model: {source['model']}",
        f"cost_usd: {source['cost_usd']}",
        f"run_id: {source['run_id']}",
        f"source_comment: {source_comment.get('id')}",
    ]
    if "excluded_files" in source:
        lines.append(f"excluded_files: {source['excluded_files']}")
    if "reviewed_verdict" in source:
        lines.append(f"reviewed_verdict: {source['reviewed_verdict']}")
    summary = (
        "Reconciled from all of the repository owner's live `[CHEAP-REVIEW]` comments on this "
        "head by `.github/workflows/cheap-review-check.yml` (SDLC v1 §4.2): the newest full-scope "
        "review, and any failure reported at or after it. Advisory until a required status "
        "context consumes it.\n\n```\n" + "\n".join(lines) + "\n```"
    )
    payload: dict = {
        "name": CHECK_NAME,
        "head_sha": source["head"],
        "status": "completed",
        "conclusion": conclusion,
        "external_id": source["run_id"],
        "output": {"title": title, "summary": summary},
    }
    url = source_comment.get("html_url") or ""
    if isinstance(url, str) and url.startswith("https://github.com/"):
        payload["details_url"] = url
    return Decision(
        True,
        f"posting {CHECK_NAME}={conclusion} on {source['head']} from run {source['run_id']}",
        payload,
    )


def _read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _cmd_decide(args: argparse.Namespace) -> int:
    with open(args.event, encoding="utf-8") as fh:
        event = json.load(fh)
    comment = event.get("comment") or {}
    user = comment.get("user") or {}
    decision = decide(
        body=comment.get("body"),
        author_login=user.get("login"),
        author_type=user.get("type"),
        owner=args.owner,
        current_head=args.current_head,
        comments=_read_jsonl(args.comments),
        existing_checks=_read_jsonl(args.existing_checks),
    )
    print(decision.reason)
    if decision.post:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(decision.payload, fh, sort_keys=True)
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as fh:
            fh.write(f"post={'true' if decision.post else 'false'}\n")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("decide", help="decide from an issue_comment event; write the payload")
    d.add_argument("--event", required=True, help="path to the issue_comment event JSON")
    d.add_argument("--owner", required=True, help="repository owner login")
    d.add_argument("--current-head", required=True, help="the pull request's head SHA, read now")
    d.add_argument("--comments", required=True, help="live PR comments, one JSON object per line")
    d.add_argument(
        "--existing-checks",
        required=True,
        help="external_id of each existing Cheap Review check-run",
    )
    d.add_argument("--out", required=True, help="where to write the check-run payload")
    d.add_argument("--github-output", default="", help="append post=true|false here")
    args = p.parse_args(argv)
    return _cmd_decide(args)


if __name__ == "__main__":
    sys.exit(main())
