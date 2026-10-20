#!/usr/bin/env python3
"""Enforce the SDLC v1 §1.5 WIP policy on open pull requests.

§1.5 says a draft older than 14 days "is rebased and re-scoped or closed with a note".
Until this tool existed that was doctrine with no mechanism, and on 2026-10-18 the repo
held 207 open PRs, 127 of them untouched for more than a week. This is the mechanism.

The rule, applied to every open PR (draft or not):

* **Idle** = time since the last *human-or-agent* activity: the PR's creation, its head
  commit, or a comment/review from any non-bot account. Bot comments (`github-actions`,
  any `*[bot]`) and this tool's own notices never count, so the AI-review and
  staging-gate sticky comments cannot keep a dead PR alive, and a warning cannot reset
  the clock it started.
* Idle >= ``WARN_DAYS`` and not yet warned since the last activity -> **warn**: add the
  ``stale`` label and post a notice.
* Warned, still no activity, and >= ``CLOSE_GRACE_DAYS`` since the notice -> **close**,
  with a comment. The branch is never deleted, so ``gh pr reopen`` restores the PR.
* A ``keep`` label exempts a PR entirely (governing standards, owner-preserved work).
* A notice is authentic only when ``SWEEP_AUTHOR`` posted exactly ``WARN_BODY``. Anyone
  else's comment carrying the marker (a quote, a reply, a forgery) is ordinary activity.
* Every decision-bearing list (labels, comments, reviews) is read to the end. A PR whose
  lists cannot be read completely is skipped, never warned or closed.

Default mode is ``dry-run``: it prints the plan and changes nothing. ``--mode apply``
performs it. The workflow runs dry-run unless the repository variable
``STALE_PR_SWEEP_MODE`` is ``apply``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from dataclasses import dataclass, field

WARN_DAYS = 14
CLOSE_GRACE_DAYS = 7
EXEMPT_LABELS = frozenset({"keep"})
# Writes per run. The first apply run faces a ~100-PR backlog; doing it all at once would
# trip GitHub's secondary rate limit on content creation and flood notifications, so the
# backlog drains over a few days instead. Closes go first, then the longest-idle warns.
MAX_ACTIONS = 25
STALE_LABEL = "stale"
WARN_MARKER = "<!-- stale-pr-sweep:warn -->"
CLOSE_MARKER = "<!-- stale-pr-sweep:close -->"
# The account the workflow's GITHUB_TOKEN posts as. Notices from any other account,
# including other bots, are not notices.
SWEEP_AUTHOR = "github-actions"
MAX_PAGES = 50  # per nested connection; past this the PR is treated as unreadable

WARN_BODY = (
    f"{WARN_MARKER}\n"
    f"This PR has had no commits, comments or reviews for {WARN_DAYS}+ days. Per the WIP "
    f"policy (`docs/architecture/mira-sdlc-v1.md` §1.5) it will be **closed in "
    f"{CLOSE_GRACE_DAYS} days** unless there is new activity. Closing never deletes the "
    f"branch; `gh pr reopen` restores it. To exempt it, add the `keep` label."
)
CLOSE_BODY = (
    f"{CLOSE_MARKER}\n"
    f"Closed under the WIP policy (`docs/architecture/mira-sdlc-v1.md` §1.5): no activity "
    f"for {CLOSE_GRACE_DAYS} days after the stale notice. The branch is untouched; reopen "
    f"with `gh pr reopen <number>` if the work is still wanted."
)


@dataclass
class Event:
    author: str
    at: dt.datetime
    body: str = ""


@dataclass
class PR:
    number: int
    title: str
    created_at: dt.datetime
    head_committed_at: dt.datetime | None
    labels: set[str] = field(default_factory=set)
    events: list[Event] = field(default_factory=list)
    complete: bool = True  # False when a decision-bearing list could not be read in full


def is_bot(login: str) -> bool:
    return login.endswith("[bot]") or login in {"github-actions", ""}


def _is_notice(e: Event, body: str) -> bool:
    return e.author == SWEEP_AUTHOR and e.body.replace("\r\n", "\n").strip() == body


def _is_sweep_notice(e: Event) -> bool:
    return _is_notice(e, WARN_BODY) or _is_notice(e, CLOSE_BODY)


def last_activity(pr: PR) -> dt.datetime:
    times = [pr.created_at]
    if pr.head_committed_at:
        times.append(pr.head_committed_at)
    times += [e.at for e in pr.events if not is_bot(e.author) and not _is_sweep_notice(e)]
    return max(times)


def last_warning(pr: PR) -> dt.datetime | None:
    warns = [e.at for e in pr.events if _is_notice(e, WARN_BODY)]
    return max(warns) if warns else None


def decide(pr: PR, now: dt.datetime) -> str:
    """Return one of ``skip`` | ``keep`` | ``none`` | ``warn`` | ``close``."""
    if not pr.complete:
        return "skip"
    if pr.labels & EXEMPT_LABELS:
        return "keep"
    active = last_activity(pr)
    warned = last_warning(pr)
    if warned and warned > active:
        return "close" if now - warned >= dt.timedelta(days=CLOSE_GRACE_DAYS) else "none"
    return "warn" if now - active >= dt.timedelta(days=WARN_DAYS) else "none"


# --------------------------------------------------------------------------- GitHub I/O

_QUERY = """
query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
 pullRequests(states:OPEN,first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{
  number title createdAt labels(first:100){pageInfo{hasNextPage} nodes{name}}
  commits(last:1){nodes{commit{committedDate}}}
  comments(last:100){pageInfo{hasPreviousPage} nodes{author{login} createdAt body}}
  reviews(last:100){pageInfo{hasPreviousPage} nodes{author{login} submittedAt}}}}}}
"""

# The first page of each list is inline above. When one is truncated (labels have a next
# page; comments/reviews, read newest-first, have an earlier one) it is re-read whole.
_CONNECTION_FIELDS = {
    "labels": "name",
    "comments": "author{login} createdAt body",
    "reviews": "author{login} submittedAt",
}
_CONNECTION_QUERY = """
query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){
 pullRequest(number:$number){%s(first:100,after:$cursor){pageInfo{hasNextPage endCursor}
  nodes{%s}}}}}
"""


def _ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _login(node: dict) -> str:
    return (node.get("author") or {}).get("login", "")


def parse_pr(node: dict) -> PR:
    commits = node["commits"]["nodes"]
    events = [Event(_login(c), _ts(c["createdAt"]), c["body"]) for c in node["comments"]["nodes"]]
    events += [
        Event(_login(r), _ts(r["submittedAt"]))
        for r in node["reviews"]["nodes"]
        if r.get("submittedAt")
    ]
    return PR(
        number=node["number"],
        title=node["title"],
        created_at=_ts(node["createdAt"]),
        head_committed_at=_ts(commits[0]["commit"]["committedDate"]) if commits else None,
        labels={lbl["name"] for lbl in node["labels"]["nodes"]},
        events=events,
    )


def _graphql(query: str, **variables: object) -> dict:
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        if v is not None:
            args += ["-F", f"{k}={v}"]
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)


def _truncated(node: dict, conn: str) -> bool:
    info = node[conn].get("pageInfo") or {}
    return bool(info.get("hasNextPage") or info.get("hasPreviousPage"))


def _read_connection(gql, owner: str, name: str, number: int, conn: str) -> list[dict]:
    query = _CONNECTION_QUERY % (conn, _CONNECTION_FIELDS[conn])
    nodes: list[dict] = []
    cursor = None
    for _ in range(MAX_PAGES):
        data = gql(query, owner=owner, name=name, number=number, cursor=cursor)
        page = data["data"]["repository"]["pullRequest"][conn]
        nodes += page["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return nodes
        cursor = page["pageInfo"]["endCursor"]
        if not cursor:
            break
    raise ValueError(f"#{number} {conn}: could not read to the end")


def _complete_node(gql, owner: str, name: str, node: dict) -> bool:
    """Replace each truncated list on ``node`` with the whole list. False if one cannot be."""
    for conn in _CONNECTION_FIELDS:
        if not _truncated(node, conn):
            continue
        try:
            node[conn] = {"nodes": _read_connection(gql, owner, name, node["number"], conn)}
        except (subprocess.CalledProcessError, ValueError, KeyError, TypeError) as exc:
            print(
                f"::warning::#{node['number']} skipped, {conn} unreadable: {exc}", file=sys.stderr
            )
            return False
    return True


def fetch_open_prs(repo: str, gql=None) -> list[PR]:
    gql = gql or _graphql
    owner, name = repo.split("/", 1)
    prs: list[PR] = []
    cursor = None
    while True:
        data = gql(_QUERY, owner=owner, name=name, cursor=cursor)
        page = data["data"]["repository"]["pullRequests"]
        for n in page["nodes"]:
            complete = _complete_node(gql, owner, name, n)
            pr = parse_pr(n)
            pr.complete = complete
            prs.append(pr)
        if not page["pageInfo"]["hasNextPage"]:
            return prs
        cursor = page["pageInfo"]["endCursor"]


def _gh(*args: str) -> None:
    subprocess.run(["gh", *args], check=True, capture_output=True, text=True)


def apply(repo: str, pr: PR, action: str) -> None:
    n = str(pr.number)
    if action == "warn":
        _gh("pr", "edit", n, "--repo", repo, "--add-label", STALE_LABEL)
        _gh("pr", "comment", n, "--repo", repo, "--body", WARN_BODY)
    elif action == "close":
        # Deliberately no --delete-branch: closing must stay reversible.
        _gh("pr", "close", n, "--repo", repo, "--comment", CLOSE_BODY)


def select_actions(
    plan: list[tuple[PR, str]], now: dt.datetime, limit: int
) -> list[tuple[PR, str]]:
    """The writes this run performs: every due close first, then warns, most idle first."""
    due = [(pr, a) for pr, a in plan if a in ("warn", "close")]
    due.sort(key=lambda p: (p[1] != "close", last_activity(p[0])))
    return due[:limit]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--mode", choices=("dry-run", "apply"), default="dry-run")
    ap.add_argument("--max-actions", type=int, default=MAX_ACTIONS, help="writes per run")
    args = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc)
    plan = [(pr, decide(pr, now)) for pr in fetch_open_prs(args.repo)]
    counts = {
        a: sum(1 for _, x in plan if x == a) for a in ("warn", "close", "keep", "none", "skip")
    }
    print(f"# Stale PR sweep ({args.mode}) — {now:%Y-%m-%d %H:%MZ}\n")
    print(f"open={len(plan)} " + " ".join(f"{k}={v}" for k, v in counts.items()) + "\n")
    todo = select_actions(plan, now, args.max_actions)
    deferred = counts["warn"] + counts["close"] - len(todo)
    print(f"this run: {len(todo)} (cap {args.max_actions}); deferred to later runs: {deferred}\n")
    print("| PR | action | idle days | title |\n|---|---|---|---|")
    for pr, action in todo:
        idle = (now - last_activity(pr)).days
        print(f"| #{pr.number} | {action} | {idle} | {pr.title[:90]} |")

    failures = 0
    if args.mode == "apply":
        _gh(
            "label",
            "create",
            STALE_LABEL,
            "--repo",
            args.repo,
            "--force",
            "--color",
            "cccccc",
            "--description",
            "No activity for 14+ days; closes 7 days later (SDLC §1.5)",
        )
        _gh(
            "label",
            "create",
            "keep",
            "--repo",
            args.repo,
            "--force",
            "--color",
            "0e8a16",
            "--description",
            "Exempt from the stale PR sweep (owner-preserved work)",
        )
        for pr, action in todo:
            try:
                apply(args.repo, pr, action)
            except subprocess.CalledProcessError as exc:
                failures += 1
                print(
                    f"::error::#{pr.number} {action} failed: {exc.stderr.strip()}", file=sys.stderr
                )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
