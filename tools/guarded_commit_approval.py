#!/usr/bin/env python3
"""Owner approval for one exact guarded commit — the supported alternative to --no-verify.

WHY THIS EXISTS
---------------
`.githooks/pre-commit` blocks any staged path the UI lifecycle guard classifies
as guarded (legacy UI trees, `.github/workflows/**`, the guard's own controls),
and says automation must not bypass it. Until this tool, the only way for the
owner to land such a change was `git commit --no-verify`, which also skips
gitleaks, shellcheck, actionlint and the scope check for that commit. On
2026-10-05 that was the only route for a one-file CI workflow
(`.github/workflows/rerun-runner-starved.yml`).

This keeps every other check running and lets the owner authorize exactly one
staged tree:

    approve   run by the OWNER at a real terminal. Shows the binding and the
              diffstat, then requires typing the first 12 characters of the
              staged tree hash. Writes one record under the git common dir.
    verify    run by the pre-commit hook when the guard blocks. Passes only if
              a record matches this repository, branch, HEAD, staged tree
              (`git write-tree`, so `commit -a` / `commit <paths>` mismatch),
              staged path list, and the guarded paths recomputed NOW are a
              subset of what the owner saw. Expired, malformed, wrong-version
              or stale records fail closed.
    status    print the current binding and whether it is approved.

TRUST BOUNDARY (read before relying on it)
------------------------------------------
The human act is typing at a controlling terminal. Claude Code's Bash tool has
none (`open('/dev/tty')` fails with ENXIO), so an agent cannot complete
`approve` in normal operation. It is not cryptographic: a process running as
the same OS user could write a record file or fake a pty. That is a deliberate
evasion of the same kind as `--no-verify`, and the merge-time gates stay in
force regardless — the CI lifecycle guard (exact-head, exact-body rationale +
Codex GREEN) and the required checks. This tool never applies a PR label and
never touches CI.
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Optional

VERSION = 1
TTL_MINUTES = 30
STORE_NAME = "mira-guarded-approvals"
CONFIRM_CHARS = 12
DIFF_FILTER = "ACMRD"  # the same filter .githooks/pre-commit uses for STAGED_ALL

REPO = Path(__file__).resolve().parent.parent
REGISTRY = REPO / "docs/architecture/convergence/REGISTRY.yaml"


class Refused(Exception):
    """A verification or approval that must not pass. The message says why."""


def _git(*args: str) -> str:
    out = subprocess.run(["git", *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise Refused(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout


def staged_entries() -> list[list[str]]:
    """[[status, path], ...] for the index git will commit (honours GIT_INDEX_FILE)."""
    raw = _git(
        "diff", "--cached", "--name-status", "-z", "--no-renames", f"--diff-filter={DIFF_FILTER}"
    )
    parts = [p for p in raw.split("\0") if p]
    return sorted([parts[i], parts[i + 1]] for i in range(0, len(parts) - 1, 2))


def binding() -> dict:
    """Everything an approval is bound to, computed from the live repository."""
    branch = subprocess.run(
        ["git", "symbolic-ref", "--quiet", "--short", "HEAD"], capture_output=True, text=True
    )
    if branch.returncode != 0:
        raise Refused("HEAD is detached; approvals bind to a named branch")
    try:
        origin = _git("config", "--get", "remote.origin.url").strip()
    except Refused:
        origin = ""
    return {
        "repo_common_dir": str(Path(_git("rev-parse", "--git-common-dir").strip()).resolve()),
        "origin": origin,
        "branch": branch.stdout.strip(),
        "base": _git("rev-parse", "HEAD").strip(),
        "tree": _git("write-tree").strip(),
        "staged": staged_entries(),
    }


def guarded_paths(paths: list[str]) -> list[str]:
    """The same verdict the hook's guard-check gives (same classifier, same inputs)."""
    sys.path.insert(0, str(REPO / "tools"))
    from ui_surface_lifecycle_guard import ChangedFile, evaluate, load_guard_policy

    policy = load_guard_policy(str(REGISTRY))
    return sorted(
        p
        for p in paths
        if not evaluate([ChangedFile(path=p, status="modified")], pr_body="", policy=policy).allowed
    )


def store_dir(b: dict) -> Path:
    return Path(b["repo_common_dir"]) / STORE_NAME


def record_path(b: dict) -> Path:
    branch_key = hashlib.sha256(b["branch"].encode()).hexdigest()[:12]
    return store_dir(b) / f"{b['tree']}-{branch_key}.json"


def _audit(b: dict, event: str, detail: str) -> None:
    store = store_dir(b)
    store.mkdir(parents=True, exist_ok=True)
    line = f"{dt.datetime.now(dt.timezone.utc).isoformat()} {event} branch={b['branch']} base={b['base'][:12]} tree={b['tree'][:12]} {detail}\n"
    with open(store / "audit.log", "a", encoding="utf-8") as fh:
        fh.write(line)


def write_record(
    b: dict,
    allowed: list[str],
    approved_by: str,
    confirmed_via: str,
    now: Optional[dt.datetime] = None,
) -> Path:
    now = now or dt.datetime.now(dt.timezone.utc)
    record = {
        "version": VERSION,
        **b,
        "allowed_paths": sorted(allowed),
        "approved_by": approved_by,
        "confirmed_via": confirmed_via,
        "approved_at": now.isoformat(),
        "expires_at": (now + dt.timedelta(minutes=TTL_MINUTES)).isoformat(),
    }
    path = record_path(b)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _audit(
        b, "approve", f"by={approved_by!r} via={confirmed_via} paths={','.join(sorted(allowed))}"
    )
    return path


def verify(hook_files: list[str]) -> str:
    b = binding()
    staged_paths = sorted(p for _, p in b["staged"])
    if hook_files and sorted(set(hook_files)) != sorted(set(staged_paths)):
        raise Refused("the hook's staged list and the index disagree; refusing")
    path = record_path(b)
    if not path.exists():
        raise Refused(
            f"no owner approval for this exact staged tree ({b['tree'][:12]}) on {b['branch']}"
        )
    try:
        rec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Refused(f"approval record unreadable ({exc}); fail closed") from exc
    if not isinstance(rec, dict) or rec.get("version") != VERSION:
        raise Refused("approval record has an unknown version; fail closed")
    for key in ("repo_common_dir", "origin", "branch", "base", "tree"):
        if rec.get(key) != b[key]:
            raise Refused(
                f"approval is stale: {key} was {str(rec.get(key))[:40]!r}, now {str(b[key])[:40]!r}"
            )
    if rec.get("staged") != b["staged"]:
        raise Refused("approval is stale: the staged path list changed")
    try:
        expires = dt.datetime.fromisoformat(rec["expires_at"])
    except (KeyError, TypeError, ValueError) as exc:
        raise Refused("approval record has no valid expiry; fail closed") from exc
    if dt.datetime.now(dt.timezone.utc) >= expires:
        raise Refused(f"approval expired at {rec['expires_at']}")
    allowed = rec.get("allowed_paths")
    if not isinstance(allowed, list):
        raise Refused("approval record has no allowed_paths; fail closed")
    outside = [p for p in guarded_paths(staged_paths) if p not in allowed]
    if outside:
        raise Refused(f"guarded path(s) not covered by the approval: {', '.join(outside)}")
    _audit(b, "verify-pass", f"record={path.name}")
    return (
        f"owner approval: {rec.get('approved_by')} via {rec.get('confirmed_via')} at {rec.get('approved_at')}; "
        f"tree {b['tree'][:12]} on {b['branch']} @ {b['base'][:12]}; covers {', '.join(allowed)}"
    )


def approve() -> str:
    b = binding()
    staged_paths = [p for _, p in b["staged"]]
    guarded = guarded_paths(staged_paths)
    if not guarded:
        raise Refused("nothing guarded is staged; the hook does not need an approval")
    try:
        # Separate read and write streams: a terminal is not seekable, so a
        # single text "r+" stream (BufferedRandom) fails on a real tty.
        tty_in = open("/dev/tty", "r", encoding="utf-8")
        tty_out = open("/dev/tty", "w", encoding="utf-8")
    except OSError as exc:
        raise Refused(
            "approve needs the owner at a real terminal (no controlling terminal here: "
            f"{exc.strerror}). Claude Code's Bash tool has none by design; run this in a "
            "separate Terminal window."
        ) from exc
    with tty_in, tty_out:
        stat = _git("diff", "--cached", "--stat")
        tty_out.write(
            "\nApprove this exact guarded commit?\n"
            f"  repository   {b['origin'] or '(no origin)'}  [{b['repo_common_dir']}]\n"
            f"  branch       {b['branch']}\n"
            f"  base (HEAD)  {b['base']}\n"
            f"  staged tree  {b['tree']}\n"
            f"  guarded      {', '.join(guarded)}\n"
            f"  staged       {', '.join(f'{s} {p}' for s, p in b['staged'])}\n\n{stat}\n"
            f"Valid {TTL_MINUTES} minutes, for this tree only. Any re-stage, extra file, new commit or\n"
            "branch switch voids it. Every other pre-commit check still runs.\n"
            f"Type the first {CONFIRM_CHARS} characters of the staged tree hash to approve: "
        )
        tty_out.flush()
        typed = tty_in.readline().strip()
    if typed != b["tree"][:CONFIRM_CHARS]:
        raise Refused("confirmation did not match the staged tree hash; nothing approved")
    # `git config --get` exits 1 when the key is unset; that must not abort an approval.
    name = subprocess.run(
        ["git", "config", "--get", "user.name"], capture_output=True, text=True
    ).stdout.strip()
    who = f"{name or '?'} ({getpass.getuser()})"
    path = write_record(b, guarded, approved_by=who, confirmed_via="tty")
    return (
        f"approved {', '.join(guarded)} for tree {b['tree'][:12]} on {b['branch']}; record {path}"
    )


def status() -> str:
    b = binding()
    guarded = guarded_paths([p for _, p in b["staged"]])
    try:
        state = verify([])
    except Refused as exc:
        state = f"NOT approved — {exc}"
    return (
        f"branch {b['branch']} @ {b['base'][:12]}  tree {b['tree'][:12]}\n"
        f"guarded staged: {', '.join(guarded) or 'none'}\n{state}"
    )


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser(
        "approve", help="owner: approve the currently staged guarded change (needs a terminal)"
    )
    v = sub.add_parser("verify", help="pre-commit hook: pass only for an exactly matching approval")
    v.add_argument("--files", nargs="*", default=[])
    sub.add_parser("status", help="show the current binding and approval state")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "approve":
            print(approve())
        elif args.cmd == "verify":
            print(verify(args.files))
        else:
            print(status())
        return 0
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # fail closed on anything unexpected
        print(f"ERROR (fail closed): {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
