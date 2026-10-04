#!/usr/bin/env python3
"""Turn a `[CHEAP-REVIEW]` PR comment into a head-bound GitHub check-run payload.

SDLC v1 Part B step 6 (docs/architecture/mira-sdlc-v1.md §4.2). The cheap review
lane (`tools/gate7_review.py <PR> --paid --post`) runs on a workstation under the
repository owner's token, and a personal token cannot create a check-run — only
a GitHub App can. So `.github/workflows/cheap-review-check.yml` reacts to the
comment and posts the check-run with the workflow's own token; this module is the
whole decision it makes, stdlib-only and network-free so it runs from the trusted
default-branch checkout with `python3 -I`.

The decision, in order (the first failing rule wins, and nothing is posted):

1. The comment is the lane's envelope: it STARTS with `[CHEAP-REVIEW]`, then a
   fenced block of `key: value` lines carrying a 40-hex `head`, a `verdict`, a
   `model`, a `cost_usd`, a 32-hex `run_id` and a `scope` (`full`, or `partial`
   with an `excluded_files` count).
2. It was posted by the repository owner account as a `User` — the same
   authentication the review ledger applies (§4.4). Anyone else's envelope is
   ignored, however well-formed.
3. The reviewed `head` is still the pull request's head when the workflow runs.
4. It is the NEWEST eligible review of that head: among the live, fully paginated
   PR comments, no later owner envelope for the same head exists. A replayed or
   late-delivered older review never posts over a newer verdict (Codex F1, #4221).
5. Its `run_id` has not already produced a `Cheap Review` check-run on that head,
   so a re-run of the workflow is a no-op.
6. A `scope: partial` PASS reviewed only part of the head and certifies nothing
   about the rest, so it posts nothing (Codex F2, #4221). A partial non-PASS still
   posts its failure: a defect found in part of the head is a defect in the head.

Only then is a payload produced: check-run `Cheap Review` on that exact head,
`success` for a full-scope `PASS` and `failure` for EVERY other verdict. `neutral`
and `skipped` are never used — branch protection treats both as passing.

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


def decide(
    *,
    body: object,
    author_login: object,
    author_type: object,
    owner: str,
    current_head: str,
    comment_id: object,
    comments: Iterable[dict],
    existing_external_ids: Iterable[str],
    comment_url: str = "",
) -> Decision:
    """Apply the six rules in the module docstring; build the check-run payload."""
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
    eligible: list[int] = []
    for c in comments:
        user = c.get("user") or {}
        other = parse_envelope(c.get("body"))
        if (
            isinstance(c.get("id"), int)
            and _is_owner_user(user.get("login"), user.get("type"), owner)
            and other is not None
            and other["head"] == current_head
        ):
            eligible.append(c["id"])
    if not isinstance(comment_id, int) or comment_id not in eligible:
        return Decision(
            False,
            f"triggering comment {comment_id!r} is not among the live owner reviews of this head",
        )
    newest = max(eligible)
    if comment_id != newest:
        return Decision(
            False,
            f"a newer owner review of {current_head} exists (comment {newest}); "
            f"comment {comment_id} is superseded and never posts over it",
        )
    if env["run_id"] in set(existing_external_ids):
        return Decision(
            False, f"run {env['run_id']} already has a {CHECK_NAME} check-run on this head"
        )
    verdict = env["verdict"]
    if verdict == "PASS" and env["scope"] != "full":
        return Decision(
            False,
            f"a scoped PASS ({env.get('excluded_files')} changed files excluded) reviewed only part "
            "of the head and certifies nothing about the rest",
        )
    conclusion = "success" if verdict == "PASS" else "failure"
    title = f"Cheap review {verdict} at {env['head'][:12]}"
    lines = [
        f"verdict: {verdict}",
        f"head: {env['head']}",
        f"scope: {env['scope']}",
        f"model: {env['model']}",
        f"cost_usd: {env['cost_usd']}",
        f"run_id: {env['run_id']}",
    ]
    if "excluded_files" in env:
        lines.append(f"excluded_files: {env['excluded_files']}")
    if "reviewed_verdict" in env:
        lines.append(f"reviewed_verdict: {env['reviewed_verdict']}")
    summary = (
        "Posted from the repository owner's newest `[CHEAP-REVIEW]` comment on this head by "
        "`.github/workflows/cheap-review-check.yml` (SDLC v1 §4.2). Advisory until a "
        "required status context consumes it.\n\n```\n" + "\n".join(lines) + "\n```"
    )
    payload: dict = {
        "name": CHECK_NAME,
        "head_sha": env["head"],
        "status": "completed",
        "conclusion": conclusion,
        "external_id": env["run_id"],
        "output": {"title": title, "summary": summary},
    }
    if comment_url.startswith("https://github.com/"):
        payload["details_url"] = comment_url
    return Decision(True, f"posting {CHECK_NAME}={conclusion} on {env['head']}", payload)


def _read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _read_lines(path: str) -> list[str]:
    with open(path, encoding="utf-8") as fh:
        return [line.strip() for line in fh if line.strip()]


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
        comment_id=comment.get("id"),
        comments=_read_jsonl(args.comments),
        existing_external_ids=_read_lines(args.existing_checks),
        comment_url=comment.get("html_url") or "",
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
