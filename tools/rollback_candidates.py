#!/usr/bin/env python3
"""Rollback candidates from production receipts (SDLC v1 §10.2, Part B step 10).

A rollback is a forward deploy of a known-good SHA through the same gates. This
module answers the three questions that rule needs, from receipts only — never
from the host checkout (`prior.sha` is the /opt/mira HEAD, not the per-service
runtime set) and never from tags:

* ``candidates`` — at deploy time, per service in the deploy target set: the SHA
  that service is running in production now, i.e. the newest production receipt
  that deployed it with a different SHA. Recorded on the new production receipt
  as ``rollback_candidate`` (``stamp``). A service with no earlier receipt within
  artifact retention gets ``sha: null`` and a reason — explicit, never absent.
* ``designate`` — for the scheduled refresh: the recovery targets production
  designates right now. Per service, the newest receipt that deployed it is what
  is running; its recorded ``rollback_candidate`` for that service is the target.
  Receipts written before this field existed designate nothing.
* ``compat`` — is a candidate still a valid code-only rollback target? Only while
  every migration file that changed on main after it carries a human ``expand``
  label for its exact content (LABELS_FILE); anything else may contract, and
  rolling code back across a contraction needs a schema decision (§10.2
  "Database"). No SQL is parsed.

Plus ``due`` (refresh when the candidate's staging or acceptance receipt expires
within the window).

FAIL-CLOSED: a malformed receipt, a run-id mismatch with the run it was
downloaded from, or a candidate map that does not cover exactly the deploy target
set is an error, not a skip. stdlib only — runs from the trusted base with
``python3 -I`` on a bare runner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

RECEIPT_SCHEMA = "factorylm.deploy-receipt/1"
RECEIPT_FILE = "production-receipt.json"
FRESHNESS_HOURS = 168.0  # shared system-wide constant (§6.2 Expiry)
# Every directory an apply-* workflow applies (apply-migrations.yml,
# apply-ingest-migrations.yml). A contraction in either invalidates a candidate.
MIGRATION_DIRS = ("mira-hub/db/migrations", "mira-core/mira-ingest/db/migrations")
_SHA = re.compile(r"\A[0-9a-f]{40}\Z")
_RUN_ID = re.compile(r"\A[1-9][0-9]*\Z")
_SERVICE = re.compile(r"\A[a-z0-9-]+\Z")
_CANDIDATE_KEYS = {"sha", "from_run_id", "reason"}


@dataclass(frozen=True)
class ProdReceipt:
    run_id: str
    sha: str
    deployed_at: datetime
    services: tuple[str, ...]
    rollback_candidate: Optional[dict]


def _parse_ts(value: object) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value):
        raise ValueError(f"not an ISO-8601 UTC timestamp: {value!r}")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def candidate_problems(cands: object, services: tuple[str, ...], deploying_sha: str) -> list[str]:
    """Every problem with a ``rollback_candidate`` map for ``services``; empty = valid."""
    if not isinstance(cands, dict):
        return ["rollback_candidate: not an object"]
    problems = []
    if set(cands) != set(services):
        problems.append(
            f"rollback_candidate: services {sorted(cands)} != deploy target set {sorted(services)}"
        )
    for svc, entry in sorted(cands.items()):
        if not isinstance(entry, dict) or set(entry) != _CANDIDATE_KEYS:
            problems.append(
                f"rollback_candidate[{svc}]: keys must be exactly {sorted(_CANDIDATE_KEYS)}"
            )
            continue
        sha, run_id, reason = entry["sha"], entry["from_run_id"], entry["reason"]
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 300:
            problems.append(f"rollback_candidate[{svc}].reason: missing or over 300 chars")
        if sha is None:
            if run_id is not None:
                problems.append(f"rollback_candidate[{svc}]: from_run_id without a sha")
        elif not isinstance(sha, str) or not _SHA.match(sha):
            problems.append(f"rollback_candidate[{svc}].sha: not a 40-hex commit: {sha!r}")
        elif sha == deploying_sha:
            problems.append(f"rollback_candidate[{svc}].sha: equals the SHA being deployed")
        elif not isinstance(run_id, str) or not _RUN_ID.match(run_id):
            problems.append(f"rollback_candidate[{svc}].from_run_id: not a run id: {run_id!r}")
    return problems


def parse_receipt(data: object, run_id: str) -> ProdReceipt:
    """Validate one downloaded production receipt; ``run_id`` is the run it came from."""
    if not isinstance(data, dict):
        raise ValueError("receipt is not a JSON object")
    if data.get("schema") != RECEIPT_SCHEMA or data.get("environment") != "production":
        raise ValueError(f"not a production {RECEIPT_SCHEMA} receipt")
    sha = data.get("approved_rc_sha")
    if not isinstance(sha, str) or not _SHA.match(sha):
        raise ValueError(f"approved_rc_sha malformed: {sha!r}")
    if str(data.get("run_id")) != run_id:
        raise ValueError(
            f"receipt says run_id={data.get('run_id')!r}, artifact came from run {run_id}"
        )
    built = data.get("built_images")
    if not isinstance(built, dict) or not built or not all(_SERVICE.match(str(s)) for s in built):
        raise ValueError("built_images missing, empty or malformed")
    services = tuple(sorted(built))
    cands = data.get("rollback_candidate")
    if cands is not None:
        problems = candidate_problems(cands, services, sha)
        if problems:
            raise ValueError("; ".join(problems))
    return ProdReceipt(run_id, sha, _parse_ts(data.get("deployed_at")), services, cands)


def load_receipts(root: Path) -> list[ProdReceipt]:
    """``root/<run_id>/production-receipt.json`` for each downloaded run, newest first."""
    receipts = []
    for child in sorted(root.iterdir()) if root.is_dir() else []:
        if not child.is_dir():
            continue
        if not _RUN_ID.match(child.name):
            raise ValueError(f"receipt directory is not a run id: {child.name!r}")
        path = child / RECEIPT_FILE
        receipts.append(parse_receipt(json.loads(path.read_text(encoding="utf-8")), child.name))
    return sorted(receipts, key=lambda r: (r.deployed_at, int(r.run_id)), reverse=True)


@dataclass(frozen=True)
class Gap:
    """A completed deploy run whose receipt cannot be read (expired, or vanished after a
    successful upload). ``updated_at`` (GitHub's, for the latest attempt) bounds when it
    could have deployed: never after it."""

    run_id: str
    updated_at: datetime
    reason: str


def load_gaps(path: str) -> list[Gap]:
    """``run_id<TAB>updated_at<TAB>reason`` per line, as the receipt walks write them."""
    if not path:
        return []
    gaps = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3 or not _RUN_ID.match(parts[0]) or not parts[2].strip():
            raise ValueError(f"malformed gap line: {line!r}")
        gaps.append(Gap(parts[0], _parse_ts(parts[1]), parts[2].strip()[:120]))
    return gaps


# deployed_at comes from the deploy host's clock, updatedAt from GitHub's: compare with margin.
CLOCK_SKEW = timedelta(minutes=15)


def _newer_gap(gaps: list[Gap], than: datetime) -> Optional[Gap]:
    """A gap that could hold a deployment at or after ``than`` (it was updated no earlier,
    within the clock-skew margin)."""
    return next(
        (g for g in sorted(gaps, key=lambda g: g.updated_at) if g.updated_at >= than - CLOCK_SKEW),
        None,
    )


def candidates_for_deploy(
    receipts: list[ProdReceipt],
    deploying_sha: str,
    services: tuple[str, ...],
    gaps: Optional[list[Gap]] = None,
) -> dict:
    """Per service: the newest receipted production SHA that is not the one being deployed.

    When an unreadable run could hold a newer deployment than that receipt, the candidate
    is unresolved: ``sha: null`` with the reason, never a possibly stale target.
    """
    out = {}
    for svc in services:
        hit = next((r for r in receipts if svc in r.services and r.sha != deploying_sha), None)
        gap = _newer_gap(gaps or [], hit.deployed_at) if hit else None
        if gap is not None:
            out[svc] = {
                "sha": None,
                "from_run_id": None,
                "reason": (
                    f"unresolved: run {gap.run_id} (updated {_iso(gap.updated_at)}) may hold a"
                    f" deployment newer than receipt run {hit.run_id}: {gap.reason}"
                )[:300],
            }
        elif hit is None:
            out[svc] = {
                "sha": None,
                "from_run_id": None,
                "reason": f"no earlier production receipt deployed {svc} within the receipt walk (retention or run window)",
            }
        else:
            out[svc] = {
                "sha": hit.sha,
                "from_run_id": hit.run_id,
                "reason": f"previous production SHA of {svc}: receipt run {hit.run_id}, deployed {_iso(hit.deployed_at)}",
            }
    return out


def designate(
    receipts: list[ProdReceipt],
    inventory: tuple[str, ...] = (),
    gaps: Optional[list[Gap]] = None,
) -> dict:
    """The recovery targets production designates now (newest receipt per service).

    ``inventory`` names services that must be accounted for (the deploy default set).
    One with no readable receipt is ``lost``: GitHub omits expired artifacts and
    removes old runs, so a missing receipt is missing history, never "never deployed".
    Only a receipt that exists but records no candidate is bootstrap (``undesignated``).
    A service whose current receipt an unreadable run could post-date (``gaps``) is
    ``lost`` too: its real current deployment, and so its target, may be hidden.
    """
    current: dict[str, ProdReceipt] = {}
    for r in receipts:  # newest first
        for svc in r.services:
            current.setdefault(svc, r)
    targets: dict[str, dict] = {}
    undesignated: dict[str, str] = {}
    lost: dict[str, str] = {}
    for svc in sorted(set(inventory) - set(current)):
        lost[svc] = (
            f"no readable production receipt for {svc} (receipts expire after 90 days and old"
            " runs are removed)"
        )
    for svc, r in sorted(current.items()):
        gap = _newer_gap(gaps or [], r.deployed_at)
        if gap is not None:
            lost[svc] = (
                f"run {gap.run_id} (updated {_iso(gap.updated_at)}) may hold a deployment of"
                f" {svc} newer than receipt run {r.run_id}: {gap.reason}"
            )
            continue
        entry = (r.rollback_candidate or {}).get(svc)
        if entry is None:
            undesignated[svc] = (
                f"current production receipt (run {r.run_id}) records no rollback_candidate"
            )
        elif entry["sha"] is None and entry["reason"].startswith("unresolved:"):
            # uncertainty recorded at deploy time, not bootstrap: it must reach an incident
            lost[svc] = (
                f"receipt run {r.run_id} recorded no resolvable candidate: {entry['reason']}"
            )
        elif entry["sha"] is None:
            undesignated[svc] = f"run {r.run_id}: {entry['reason']}"
        else:
            t = targets.setdefault(
                entry["sha"], {"sha": entry["sha"], "services": [], "designated_by_runs": []}
            )
            t["services"].append(svc)
            if r.run_id not in t["designated_by_runs"]:
                t["designated_by_runs"].append(r.run_id)
    return {
        "current": {svc: {"sha": r.sha, "run_id": r.run_id} for svc, r in sorted(current.items())},
        "designated": [targets[s] for s in sorted(targets)],
        "undesignated": dict(sorted(undesignated.items())),
        "lost": lost,
    }


# ── migration labels (expand/contract, §10.2 Compatibility) ───────────────────────
#
# A rollback candidate is valid only while no contracting migration has been applied since
# it ran. Whether a migration contracts is decided ONCE, by a human, when it is written:
# LABELS_FILE carries one line per migration file, bound to its exact content,
#     <label> <sha256 of the file's bytes> <repo-relative path>
# with label ``expand`` (older code keeps working), ``contract`` or ``unreviewed``. Only
# ``expand`` keeps a candidate valid. No SQL is parsed: an unlabelled file, a label for
# other content, a file added and deleted in between, and any file whose content changed
# after the candidate (an earlier version may be the one applied) all invalidate (fail closed).
# tests/test_rollback_candidates.py fails CI on any migration without a matching line, so
# the label lands in the migration's own reviewed PR; the sha matches the ledger's
# ``sha256sum`` (apply-migrations.yml, schema_migrations.content_sha256).

LABELS_FILE = "tools/migration_compat.txt"
LABELS = ("expand", "contract", "unreviewed")
_SHA256 = re.compile(r"\A[0-9a-f]{64}\Z")


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout


def _git_bytes(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def parse_labels(text: str) -> dict[str, tuple[str, str]]:
    """``path -> (label, sha256)`` from LABELS_FILE text. Blank lines and ``#`` comments are
    skipped; any other malformed line, unknown label or repeated path is an error."""
    out: dict[str, tuple[str, str]] = {}
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 3:
            raise ValueError(f"{LABELS_FILE}:{n}: expected '<label> <sha256> <path>': {line!r}")
        label, sha, path = fields
        if label not in LABELS:
            raise ValueError(
                f"{LABELS_FILE}:{n}: unknown label {label!r} (one of {', '.join(LABELS)})"
            )
        if not _SHA256.match(sha):
            raise ValueError(f"{LABELS_FILE}:{n}: not a lowercase sha256: {sha!r}")
        if path in out:
            raise ValueError(f"{LABELS_FILE}:{n}: {path} is labelled more than once")
        out[path] = (label, sha)
    return out


def label_problems(labels: dict[str, tuple[str, str]], files: dict[str, str]) -> list[str]:
    """Everything wrong between LABELS_FILE and the migration files (``path -> sha256``):
    a file with no line or a line for other content, and a line for a file that is gone.
    Each problem names the fix; empty = consistent."""
    problems = []
    for path, sha in sorted(files.items()):
        entry = labels.get(path)
        if any(c.isspace() for c in path):
            problems.append(
                f"{path}: migration file names may not contain whitespace ({LABELS_FILE}"
                " separates its fields by whitespace); rename the file"
            )
        elif entry is None:
            problems.append(
                f"{path} has no label. Add this line to {LABELS_FILE}, choosing expand, contract"
                f" or unreviewed (only expand keeps rollback candidates valid):\n  unreviewed {sha} {path}"
            )
        elif entry[1] != sha:
            problems.append(
                f"{path}: its label is for different content (sha {entry[1][:12]}…, file is"
                f" {sha[:12]}…). Label the new content:\n  {entry[0]} {sha} {path}"
            )
    for path in sorted(set(labels) - set(files)):
        problems.append(f"{LABELS_FILE} labels {path}, but there is no such migration file")
    return problems


def _blobs(repo: Path, rev: str) -> dict[str, str]:
    """``path -> git blob id`` of every migration file in ``rev``. NUL-separated output (-z):
    git's default output quotes unusual paths, and a quoted path is not ``*.sql``."""
    out = {}
    for entry in _git(repo, "ls-tree", "-r", "-z", rev, "--", *MIGRATION_DIRS).split("\0"):
        if not entry:
            continue
        meta, path = entry.split("\t", 1)
        if path.endswith(".sql"):
            out[path] = meta.split()[2]
    return out


def _versions_since(candidate: str, head: str, repo: Path) -> dict[str, set[str]]:
    """``path -> every blob id`` a migration file had in any commit of candidate..head where it
    changed (merge commits against each parent; no rename pairing). A deletion adds nothing."""
    raw = _git(
        repo,
        "log",
        "-m",
        "--no-renames",
        "--raw",
        "--no-abbrev",
        "-z",
        "--format=",
        f"{candidate}..{head}",
        "--",
        *MIGRATION_DIRS,
    )
    return _raw_versions(raw)


def _raw_versions(raw: str) -> dict[str, set[str]]:
    """Parse ``git log --raw -z --no-renames`` output: each change is
    ":<old mode> <new mode> <old blob> <new blob> <status>" NUL "<path>" NUL, paths never
    quoted, exactly one path per change. Anything else is an error (exit 2), never a guess."""
    out: dict[str, set[str]] = {}
    tokens = raw.split("\0")
    i = 0
    while i < len(tokens):
        meta = tokens[i].lstrip("\n")
        if not meta.startswith(":"):
            i += 1
            continue
        fields = meta.split()
        if len(fields) != 5 or i + 1 >= len(tokens) or not tokens[i + 1]:
            raise ValueError(f"unexpected git log --raw record: {meta!r}")
        path, new_blob = tokens[i + 1], fields[3]
        i += 2
        if path.endswith(".sql"):
            versions = out.setdefault(path, set())
            if new_blob.strip("0"):  # all zeros = deleted at that commit
                versions.add(new_blob)
    return out


def contracting_since(candidate: str, head: str, repo: Path) -> list[dict]:
    """Migration files whose content after ``candidate`` is not proven harmless to it, looking
    at EVERY version each file had in candidate..head, not only its final bytes: a version
    applied in between stays live (kind ``contract``, ``unreviewed`` or ``unlabelled``).

    * A file the candidate already had is compatible with it by construction. Edited at any
      point after it (even if later restored), the version the database ran may be one no
      label covers: invalid. Deleted unchanged: no new schema, ignored.
    * A file new after the candidate must have had exactly one version, still present at
      head and labelled ``expand`` for those bytes.

    Empty means the candidate is still a valid code-only rollback target."""
    for sha in (candidate, head):
        if not _SHA.match(sha):
            raise ValueError(f"not a 40-hex commit: {sha!r}")
    _git(repo, "merge-base", "--is-ancestor", candidate, head)  # CalledProcessError if not
    labels = parse_labels(_git(repo, "show", f"{head}:{LABELS_FILE}"))  # missing file = error
    before, after = _blobs(repo, candidate), _blobs(repo, head)
    hits = []
    for path, versions in sorted(_versions_since(candidate, head, repo).items()):
        if path in before:
            if versions - {before[path]}:
                hits.append(
                    {
                        "path": path,
                        "kind": "unlabelled",
                        "reason": "changed after the candidate, which already had it; an edited"
                        " version may have been applied, and no label can cover it",
                    }
                )
            continue
        if path not in after:
            hits.append(
                {
                    "path": path,
                    "kind": "unlabelled",
                    "reason": "added after the candidate and deleted before head; it may have been applied",
                }
            )
            continue
        if len(versions) > 1:
            hits.append(
                {
                    "path": path,
                    "kind": "unlabelled",
                    "reason": f"its content changed after the candidate ({len(versions)} versions);"
                    " an earlier version may have been applied, and the label covers only the last",
                }
            )
            continue
        sha = hashlib.sha256(_git_bytes(repo, "show", f"{head}:{path}")).hexdigest()
        label, labelled_sha = labels.get(path, (None, None))
        if label is None:
            hits.append({"path": path, "kind": "unlabelled", "reason": f"no line in {LABELS_FILE}"})
        elif labelled_sha != sha:
            hits.append(
                {
                    "path": path,
                    "kind": "unlabelled",
                    "reason": f"its label is for different content (sha {labelled_sha[:12]}…)",
                }
            )
        elif label != "expand":
            hits.append({"path": path, "kind": label, "reason": f"labelled {label}"})
    return hits


def refresh_due(
    staging: dict, acceptance: dict, now: datetime, before_hours: float
) -> tuple[bool, str]:
    """Due when either receipt's validity ends within ``before_hours`` of ``now``."""
    staging_until = _parse_ts(staging.get("deployed_at")) + timedelta(hours=FRESHNESS_HOURS)
    acceptance_until = _parse_ts(acceptance.get("expires_at"))
    until = min(staging_until, acceptance_until)
    left = (until - now).total_seconds() / 3600
    return left < before_hours, f"evidence valid until {_iso(until)} ({left:.1f}h left)"


# ── CLI ─────────────────────────────────────────────────────────────────────


def _services(arg: str) -> tuple[str, ...]:
    services = tuple(arg.split())
    if (
        not services
        or len(set(services)) != len(services)
        or not all(_SERVICE.match(s) for s in services)
    ):
        raise SystemExit(f"--services must be distinct service names, got {arg!r}")
    return services


def _write(obj: object, out: str) -> None:
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    if out:
        Path(out).write_text(text + "\n", encoding="utf-8")
    print(text)


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("candidates")
    c.add_argument("--receipts-dir", required=True)
    c.add_argument("--deploying", required=True)
    c.add_argument("--services", required=True)
    c.add_argument("--out", default="")
    c.add_argument("--gaps", default="")
    w = sub.add_parser("since")
    w.add_argument("--receipts-dir", required=True)
    ws = sub.add_parser("window-start")
    ws.add_argument("--days", type=int, required=True)
    d = sub.add_parser("designate")
    d.add_argument("--receipts-dir", required=True)
    d.add_argument("--out", default="")
    d.add_argument("--inventory", default="")
    d.add_argument("--gaps", default="")
    s = sub.add_parser("stamp")
    s.add_argument("--receipt", required=True)
    s.add_argument("--candidates-json", required=True)
    s.add_argument("--services", required=True)
    s.add_argument("--attempt", type=int, default=1)
    k = sub.add_parser("compat")
    k.add_argument("--candidate", required=True)
    k.add_argument("--head", required=True)
    k.add_argument("--repo", default=".")
    u = sub.add_parser("due")
    u.add_argument("--staging-receipt", required=True)
    u.add_argument("--acceptance-receipt", required=True)
    u.add_argument("--refresh-before-hours", type=float, default=72.0)
    a = p.parse_args(argv)

    try:
        if a.cmd == "candidates":
            if not _SHA.match(a.deploying):
                raise ValueError(f"--deploying is not a 40-hex commit: {a.deploying!r}")
            cands = candidates_for_deploy(
                load_receipts(Path(a.receipts_dir)),
                a.deploying,
                _services(a.services),
                load_gaps(a.gaps),
            )
            problems = candidate_problems(cands, _services(a.services), a.deploying)
            if problems:
                raise ValueError("; ".join(problems))
            _write(cands, a.out)
        elif a.cmd == "since":
            receipts = load_receipts(Path(a.receipts_dir))
            print(_iso(min(r.deployed_at for r in receipts) - CLOCK_SKEW) if receipts else "")
        elif a.cmd == "window-start":
            print((datetime.now(timezone.utc) - timedelta(days=a.days)).strftime("%Y-%m-%d"))
        elif a.cmd == "designate":
            inventory = _services(a.inventory) if a.inventory.strip() else ()
            _write(
                designate(
                    load_receipts(Path(a.receipts_dir)),
                    inventory,
                    load_gaps(a.gaps),
                ),
                a.out,
            )
        elif a.cmd == "stamp":
            receipt = json.loads(Path(a.receipt).read_text(encoding="utf-8"))
            if "rollback_candidate" in receipt:
                raise ValueError(
                    "receipt already carries rollback_candidate; refusing to overwrite"
                )
            cands = json.loads(a.candidates_json)
            if a.attempt > 1:
                # A re-run of failed jobs reuses authorize-source's outputs from an earlier
                # attempt; a deploy in between may have made them stale.
                cands = {
                    svc: {
                        "sha": None,
                        "from_run_id": None,
                        "reason": (
                            f"unresolved: deploy re-run (attempt {a.attempt}) reuses candidates"
                            " computed by an earlier attempt"
                        ),
                    }
                    for svc in cands
                }
            problems = candidate_problems(
                cands, _services(a.services), str(receipt.get("approved_rc_sha"))
            )
            if problems:
                raise ValueError("; ".join(problems))
            receipt["rollback_candidate"] = cands
            Path(a.receipt).write_text(
                json.dumps(receipt, sort_keys=True, separators=(",", ":")), encoding="utf-8"
            )
            print(f"stamped rollback_candidate for {', '.join(sorted(cands))}")
        elif a.cmd == "compat":
            hits = contracting_since(a.candidate, a.head, Path(a.repo))
            for h in hits:
                print(f"{h['kind'].upper()} {h['path']}: {h['reason']}")
            print(f"{len(hits)} migration file(s) since {a.candidate} not labelled expand")
            return 1 if hits else 0
        elif a.cmd == "due":
            staging = json.loads(Path(a.staging_receipt).read_text(encoding="utf-8"))
            acceptance = json.loads(Path(a.acceptance_receipt).read_text(encoding="utf-8"))
            due, why = refresh_due(
                staging, acceptance, datetime.now(timezone.utc), a.refresh_before_hours
            )
            print(("refresh due: " if due else "fresh: ") + why)
            return 3 if due else 0
    except (ValueError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        print(f"::error::rollback_candidates {a.cmd}: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
