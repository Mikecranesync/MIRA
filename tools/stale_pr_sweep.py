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
STALE_LABEL = "stale"
WARN_MARKER = "<!-- stale-pr-sweep:warn -->"
CLOSE_MARKER = "<!-- stale-pr-sweep:close -->"

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


def is_bot(login: str) -> bool:
    return login.endswith("[bot]") or login in {"github-actions", ""}


def _is_sweep_notice(e: Event) -> bool:
    return WARN_MARKER in e.body or CLOSE_MARKER in e.body


def last_activity(pr: PR) -> dt.datetime:
    times = [pr.created_at]
    if pr.head_committed_at:
        times.append(pr.head_committed_at)
    times += [e.at for e in pr.events if not is_bot(e.author) and not _is_sweep_notice(e)]
    return max(times)


def last_warning(pr: PR) -> dt.datetime | None:
    warns = [e.at for e in pr.events if WARN_MARKER in e.body]
    return max(warns) if warns else None


def decide(pr: PR, now: dt.datetime) -> str:
    """Return one of ``keep`` | ``none`` | ``warn`` | ``close``."""
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
  number title createdAt labels(first:30){nodes{name}}
  commits(last:1){nodes{commit{committedDate}}}
  comments(last:50){nodes{author{login} createdAt body}}
  reviews(last:20){nodes{author{login} submittedAt}}}}}}
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


def fetch_open_prs(repo: str) -> list[PR]:
    owner, name = repo.split("/", 1)
    prs: list[PR] = []
    cursor = None
    while True:
        args = [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={_QUERY}",
            "-F",
            f"owner={owner}",
            "-F",
            f"name={name}",
        ]
        if cursor:
            args += ["-F", f"cursor={cursor}"]
        data = json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)
        page = data["data"]["repository"]["pullRequests"]
        prs += [parse_pr(n) for n in page["nodes"]]
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--repo", required=True, help="owner/name")
    ap.add_argument("--mode", choices=("dry-run", "apply"), default="dry-run")
    args = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc)
    plan = [(pr, decide(pr, now)) for pr in fetch_open_prs(args.repo)]
    counts = {a: sum(1 for _, x in plan if x == a) for a in ("warn", "close", "keep", "none")}
    print(f"# Stale PR sweep ({args.mode}) — {now:%Y-%m-%d %H:%MZ}\n")
    print(f"open={len(plan)} " + " ".join(f"{k}={v}" for k, v in counts.items()) + "\n")
    print("| PR | action | idle days | title |\n|---|---|---|---|")
    for pr, action in sorted(plan, key=lambda p: p[0].number):
        if action in ("warn", "close"):
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
        for pr, action in plan:
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
