#!/usr/bin/env python3
"""Resolve a PR's merge state to a NAMED blocker — or say the status was stale.

Why this exists (issue #3109). `gh pr view --json mergeStateStatus` returns
`BLOCKED` as a catch-all: a failed required check, a required check that has not
reported, a review gate, a conflict, and an out-of-date branch all collapse to
that one string. Worse, it LAGS — it keeps returning `BLOCKED` after a PR has
actually gone `CLEAN`. On PR #3106 a poll loop read `BLOCKED` nine consecutive
times while simultaneously reading zero pending and zero failed checks; nothing
was wrong, and the PR merged on the first attempt. "Still BLOCKED" was reported
to the user three times before the contradiction was noticed.

So a bare `BLOCKED` is not a finding. It is a prompt to go look. This resolves it
to exactly one named cause, or reports that the aggregate was stale.

Two mistakes this deliberately does NOT make:

1. **"Not SUCCESS" is not "failed."** `QUEUED` and `IN_PROGRESS` are pending, not
   failures. Classifying them as failures is the same false alarm wearing the
   opposite sign — and it bit during the #3111 verification, where a poll loop
   read `pending=0` while three checks were still running.
2. **Scanning only the checks that reported is not enough.** A *required* context
   that never reported at all is pending, and is invisible to any scan of
   reported checks. Required contexts come from the branch-protection API and are
   intersected with what actually reported.

Anything it cannot determine is reported as `UNKNOWN`, never as `CLEAN`.

Usage:
    tools/pr-merge-blocker.sh <pr-number>

Exit codes:
    0  CLEAN / CLEAN (status was stale) / MERGED  — nothing is blocking
    1  a real, named blocker
    2  UNKNOWN — could not determine (never assume clean)
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Optional

# --- Check-state classification --------------------------------------------
#
# Three DISJOINT buckets. An unrecognized state falls into `pending` and is
# printed with its raw state name, so an unknown state can never be silently
# counted as passing.

PENDING_STATES = frozenset({"QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED", "EXPECTED"})
FAILED_STATES = frozenset(
    {
        "FAILURE",
        "ERROR",
        "CANCELLED",
        "TIMED_OUT",
        "ACTION_REQUIRED",
        "STALE",
        "STARTUP_FAILURE",
    }
)
PASSING_STATES = frozenset({"SUCCESS", "SKIPPED", "NEUTRAL"})

EXIT_CLEAN = 0
EXIT_BLOCKED = 1
EXIT_UNKNOWN = 2


class Verdict:
    """The result of classification: lines to print plus an exit code."""

    def __init__(self, code: str, lines: list, exit_code: int) -> None:
        self.code = code  # headline, e.g. "FAILED" / "CLEAN" / "UNKNOWN"
        self.lines = lines  # every line to print, headline first
        self.exit_code = exit_code

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "Verdict(%r, %r, %r)" % (self.code, self.lines, self.exit_code)


def _ts(check: dict) -> str:
    """Sort key for picking the most recent run of a re-run check.

    ISO-8601 strings sort lexicographically, so a plain string compare is
    correct here. A check with no timestamp sorts oldest.
    """
    return str(check.get("startedAt") or "")


def latest_checks(checks) -> dict:
    """Collapse a check list to one row per name — the most recently started.

    A re-run leaves both the old and the new row in the API response. Taking the
    latest is what makes "I re-ran the failure and it passed" resolve to passing
    instead of staying failed forever.
    """
    best: dict = {}
    for check in checks or []:
        name = str(check.get("name") or "").strip()
        if not name:
            continue
        prev = best.get(name)
        if prev is None or _ts(check) >= _ts(prev):
            best[name] = check
    return best


def classify(pr: dict, protection: Optional[dict], checks) -> Verdict:
    """Resolve a PR's state to named blockers. Pure — no network, no subprocess.

    `protection` is None when the branch-protection API could not be read. In
    that case the required-context set is unknown, so the check scan degrades to
    advisory (every reported check) and the verdict is UNKNOWN — never CLEAN.
    """
    state = str(pr.get("state") or "").upper()
    if state == "MERGED":
        return Verdict("MERGED", ["MERGED: already merged"], EXIT_CLEAN)
    if state == "CLOSED":
        return Verdict("CLOSED", ["CLOSED: PR is closed, not merged"], EXIT_BLOCKED)

    reported = latest_checks(checks)

    # Things we could not determine. Any entry here forces an UNKNOWN verdict —
    # the whole point of this tool is that it never claims CLEAN on a guess.
    unknowns: list = []

    if protection is None:
        # Advisory scan only: we do not know which contexts are required.
        scope = sorted(reported)
        unknowns.append(
            "branch protection unreadable — required contexts unknown, so a "
            "never-reported required check cannot be detected"
        )
    else:
        scope = list(protection.get("contexts") or [])

    if str(pr.get("mergeable") or "").upper() == "UNKNOWN":
        # GitHub computes mergeability lazily. A first read (and every bulk
        # `gh pr list`) returns UNKNOWN until the background job finishes — which
        # means "not computed", NOT "no conflict". Calling that CLEAN would be
        # the same overconfidence in the other direction.
        unknowns.append(
            "mergeability not computed yet (mergeable=UNKNOWN) — cannot rule out "
            "a conflict; re-query"
        )

    failed: list = []
    pending: list = []
    for name in scope:
        check = reported.get(name)
        if check is None:
            # Only reachable when the required set IS known — a required context
            # that never reported. Invisible to any scan of reported checks.
            pending.append("%s (never reported)" % name)
            continue
        check_state = str(check.get("state") or "").upper()
        if check_state in PASSING_STATES:
            continue
        if check_state in FAILED_STATES:
            failed.append("%s [%s]" % (name, check_state))
        else:
            # PENDING_STATES, and anything unrecognized. Named either way.
            pending.append("%s [%s]" % (name, check_state or "NO STATE"))

    blockers: list = []

    if str(pr.get("mergeable") or "").upper() == "CONFLICTING":
        blockers.append("CONFLICTING: conflicts with the base branch — rebase or resolve")
    if pr.get("isDraft"):
        blockers.append("DRAFT: marked draft — cannot merge however green it is")
    if failed:
        blockers.append("FAILED: " + ", ".join(failed))
    if pending:
        blockers.append("PENDING: " + ", ".join(pending))

    review = str(pr.get("reviewDecision") or "").upper()
    if review == "CHANGES_REQUESTED":
        blockers.append("REVIEW_REQUIRED: changes requested")
    elif review == "REVIEW_REQUIRED":
        blockers.append("REVIEW_REQUIRED: an approving review is required")

    # GitHub only reports BEHIND when required_status_checks.strict is true, so
    # the flag needs no separate guard.
    if str(pr.get("mergeStateStatus") or "").upper() == "BEHIND":
        blockers.append("BEHIND: base branch moved — update the branch")

    if unknowns:
        lines = ["UNKNOWN: " + unknowns[0]]
        lines.extend("UNKNOWN: " + u for u in unknowns[1:])
        if blockers:
            lines.append("  (what IS known — advisory, may be an incomplete picture:)")
            lines.extend("  " + b for b in blockers)
        else:
            lines.append("  (what IS known: no check is failing or pending)")
        return Verdict("UNKNOWN", lines, EXIT_UNKNOWN)

    if blockers:
        return Verdict(blockers[0].split(":", 1)[0], blockers, EXIT_BLOCKED)

    merge_state = str(pr.get("mergeStateStatus") or "").upper()
    if merge_state == "CLEAN":
        return Verdict("CLEAN", ["CLEAN"], EXIT_CLEAN)
    # Every required context passes and no separate blocker applies, yet the
    # aggregate says otherwise. This is the #3106 case: the aggregate is stale.
    return Verdict(
        "CLEAN",
        [
            "CLEAN (status was stale) — every required context passes and no "
            "blocker applies, but mergeStateStatus=%s" % (merge_state or "<empty>")
        ],
        EXIT_CLEAN,
    )


# --- I/O -------------------------------------------------------------------


def _gh_json(args: list):
    """Run a `gh` command expected to emit JSON. Returns None on any failure."""
    try:
        proc = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    # Deliberately NOT gated on returncode. `gh pr checks` overloads its exit
    # code to report check STATE rather than command failure: 1 when a check
    # failed, 8 when checks are pending. Measured 2026-08-09, the `--json` path
    # suppresses that and returns 0 even on a PR with a FAILURE (#3149: --json
    # → 0, plain → 1), so gating would be harmless *today* — but that is an
    # undocumented property of one code path. If it ever changed, `checks` would
    # come back empty for exactly the PRs that have a failing required check,
    # every required context would resolve to "(never reported)", and the verdict
    # would be PENDING instead of FAILED: this tool's own failure mode, sign
    # flipped. Valid JSON on stdout is the real success signal.
    if not proc.stdout.strip():
        return None
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None


PR_FIELDS = "number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,baseRefName"


def fetch_pr(pr_number: str, attempts: int = 3, delay: float = 2.0) -> Optional[dict]:
    """Read the PR, re-querying while `mergeable` is still UNKNOWN.

    Asking is what makes GitHub compute mergeability, so the first read of a PR
    nobody has touched in a while routinely comes back UNKNOWN and the second one
    is real. This is exactly the "re-query directly" remedy #3109 prescribes —
    done here instead of left to whoever calls the tool.
    """
    pr = None
    for attempt in range(attempts):
        pr = _gh_json(["pr", "view", pr_number, "--json", PR_FIELDS])
        if not isinstance(pr, dict):
            return None
        if str(pr.get("mergeable") or "").upper() != "UNKNOWN":
            return pr
        if attempt < attempts - 1:
            time.sleep(delay)
    return pr


def fetch_protection(name_with_owner: str, branch: str) -> Optional[dict]:
    """Required contexts + strictness for `branch`, or None if unreadable.

    Unreadable is the normal case for a token without admin scope, so it must
    degrade to an honest UNKNOWN rather than a confident CLEAN.
    """
    raw = _gh_json(
        [
            "api",
            "repos/%s/branches/%s/protection" % (name_with_owner, branch),
        ]
    )
    if not isinstance(raw, dict):
        return None
    required = raw.get("required_status_checks") or {}
    return {
        "contexts": list(required.get("contexts") or []),
        "strict": bool(required.get("strict")),
    }


def main(argv: list) -> int:
    if len(argv) != 1 or argv[0] in ("-h", "--help"):
        sys.stderr.write(__doc__ or "")
        return EXIT_UNKNOWN
    pr_number = argv[0]

    pr = fetch_pr(pr_number)
    if not isinstance(pr, dict):
        print("UNKNOWN: could not read PR %s via gh" % pr_number)
        return EXIT_UNKNOWN

    checks = _gh_json(["pr", "checks", pr_number, "--json", "name,state,startedAt"])
    if not isinstance(checks, list):
        # No checks at all is legitimate (a docs-only PR on some repos); an
        # outright API failure is not distinguishable here, so treat as empty and
        # let the required-context intersection surface anything missing.
        checks = []

    repo = _gh_json(["repo", "view", "--json", "nameWithOwner"])
    protection = None
    if isinstance(repo, dict) and repo.get("nameWithOwner"):
        protection = fetch_protection(
            str(repo["nameWithOwner"]), str(pr.get("baseRefName") or "main")
        )

    verdict = classify(pr, protection, checks)
    for line in verdict.lines:
        print(line)
    return verdict.exit_code


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
