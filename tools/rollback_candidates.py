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
* ``compat`` — is a candidate still a valid code-only rollback target? Not if a
  contracting migration landed on main after it (expand/contract: rolling code
  back across a contraction needs a schema decision, §10.2 "Database").

Plus ``covered`` (lets the workflow stop downloading receipts once every service
has a candidate) and ``due`` (refresh when the candidate's staging or acceptance
receipt expires within the window).

FAIL-CLOSED: a malformed receipt, a run-id mismatch with the run it was
downloaded from, or a candidate map that does not cover exactly the deploy target
set is an error, not a skip. stdlib only — runs from the trusted base with
``python3 -I`` on a bare runner.
"""

from __future__ import annotations

import argparse
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


def candidates_for_deploy(
    receipts: list[ProdReceipt], deploying_sha: str, services: tuple[str, ...]
) -> dict:
    """Per service: the newest receipted production SHA that is not the one being deployed."""
    out = {}
    for svc in services:
        hit = next((r for r in receipts if svc in r.services and r.sha != deploying_sha), None)
        if hit is None:
            out[svc] = {
                "sha": None,
                "from_run_id": None,
                "reason": f"no earlier production receipt deployed {svc} within artifact retention",
            }
        else:
            out[svc] = {
                "sha": hit.sha,
                "from_run_id": hit.run_id,
                "reason": f"previous production SHA of {svc}: receipt run {hit.run_id}, deployed {_iso(hit.deployed_at)}",
            }
    return out


def designate(receipts: list[ProdReceipt]) -> dict:
    """The recovery targets production designates now (newest receipt per service)."""
    current: dict[str, ProdReceipt] = {}
    for r in receipts:  # newest first
        for svc in r.services:
            current.setdefault(svc, r)
    targets: dict[str, dict] = {}
    undesignated = {}
    for svc, r in sorted(current.items()):
        entry = (r.rollback_candidate or {}).get(svc)
        if entry is None:
            undesignated[svc] = (
                f"current production receipt (run {r.run_id}) records no rollback_candidate"
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
        "undesignated": undesignated,
    }


# ── contracting-migration detection (expand/contract, §10.2 Compatibility) ────────

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)
# One left-to-right pass, so a quote or comment marker is only special where it starts a
# token: a '(' ';' ',' or '--' inside a string literal can neither hide nor fake an action.
_LEXEMES = re.compile(
    r"(?P<dollar>\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*|)\$.*?\$(?P=tag)\$)"
    r"|(?P<ident>\"(?:[^\"]|\"\")*\")"
    r"|(?P<literal>'(?:[^']|'')*')"
    r"|(?P<comment>--[^\n]*|/\*.*?\*/)",
    re.DOTALL,
)


def _strip_literals_and_comments(sql: str) -> str:
    """Blank string literals, drop comments; keep identifiers and dollar-quoted bodies.

    A dollar-quoted body (``DO $$ … $$``, a function body) stays visible, comments
    stripped, because DDL inside it still runs — hiding it would be the unsafe direction.
    """

    def repl(m: re.Match) -> str:
        if m.group("dollar"):
            return _COMMENTS.sub(" ", m.group("dollar"))
        if m.group("ident"):
            return m.group("ident")
        return "''" if m.group("literal") else " "

    return _LEXEMES.sub(repl, sql)


_DROP_OBJECT = re.compile(
    r"\ADROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA|SEQUENCE|FUNCTION)\s+(?:IF\s+EXISTS\s+)?(.+)\Z"
)
_ALTER_TABLE = re.compile(r"\AALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)\s+(.+)\Z")
# Where a checked statement starts inside a ;-delimited piece. DDL inside a DO block or
# function body follows a PL/pgSQL prefix (DO $$ BEGIN IF … THEN) and still runs.
_DDL_START = re.compile(
    r"\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA|SEQUENCE|FUNCTION))\b"
)


def _norm_name(raw: str) -> str:
    name = raw.strip().split("(")[0].strip().strip('"').lower()
    return name[len("public.") :] if name.startswith("public.") else name


def _created_names(sql_upper: str) -> set[str]:
    pattern = (
        r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?"
        r"(?:TABLE|VIEW|TYPE|SCHEMA|SEQUENCE|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)"
    )
    return {_norm_name(m) for m in re.findall(pattern, sql_upper)}


def _split_top_level(text: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def contracting_statements(sql: str) -> list[str]:
    """Statements that remove or narrow what older code may rely on.

    Contracting: DROP TABLE/VIEW/TYPE/SCHEMA/SEQUENCE/FUNCTION (unless the same file
    re-creates that name — the idempotent drop-and-recreate pattern), and ALTER TABLE
    actions DROP [COLUMN], RENAME, ALTER COLUMN ... [SET DATA] TYPE, ALTER COLUMN ...
    SET NOT NULL. Not contracting: DROP POLICY/INDEX/TRIGGER, DROP CONSTRAINT, DROP
    DEFAULT / DROP NOT NULL, ADD COLUMN, CREATE … (expand), data DML.
    """
    upper = _strip_literals_and_comments(sql).upper()
    recreated = _created_names(upper)
    hits = []
    for raw in upper.split(";"):
        stmt = " ".join(raw.split())
        start = _DDL_START.search(stmt)
        if not start:
            continue
        stmt = stmt[start.start() :]
        m = _DROP_OBJECT.match(stmt)
        if m:
            names = [
                _norm_name(n)
                for n in _split_top_level(
                    m.group(2).replace(" CASCADE", "").replace(" RESTRICT", "")
                )
            ]
            if any(n not in recreated for n in names):
                hits.append(stmt)
            continue
        m = _ALTER_TABLE.match(stmt)
        if not m:
            continue
        for action in _split_top_level(m.group(2)):
            if (
                re.match(r"DROP\s+(?!CONSTRAINT\b)", action)
                or action.startswith("RENAME")
                or re.match(r"ALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b", action)
                or re.match(r"ALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b", action)
            ):
                hits.append(stmt)
                break
    return hits


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout


def contracting_since(candidate: str, head: str, repo: Path) -> list[dict]:
    """Contracting statements in migration files added or changed on ``head`` after ``candidate``."""
    for sha in (candidate, head):
        if not _SHA.match(sha):
            raise ValueError(f"not a 40-hex commit: {sha!r}")
    _git(repo, "merge-base", "--is-ancestor", candidate, head)  # CalledProcessError if not
    changed = _git(
        repo, "diff", "--name-only", "--diff-filter=AMR", candidate, head, "--", *MIGRATION_DIRS
    ).split()
    hits = []
    for path in sorted(p for p in changed if p.endswith(".sql")):
        for stmt in contracting_statements(_git(repo, "show", f"{head}:{path}")):
            hits.append({"path": path, "statement": stmt[:300]})
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
    for name in ("candidates", "covered"):
        c = sub.add_parser(name)
        c.add_argument("--receipts-dir", required=True)
        c.add_argument("--deploying", required=True)
        c.add_argument("--services", required=True)
        c.add_argument("--out", default="")
    d = sub.add_parser("designate")
    d.add_argument("--receipts-dir", required=True)
    d.add_argument("--out", default="")
    s = sub.add_parser("stamp")
    s.add_argument("--receipt", required=True)
    s.add_argument("--candidates-json", required=True)
    s.add_argument("--services", required=True)
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
        if a.cmd in ("candidates", "covered"):
            if not _SHA.match(a.deploying):
                raise ValueError(f"--deploying is not a 40-hex commit: {a.deploying!r}")
            cands = candidates_for_deploy(
                load_receipts(Path(a.receipts_dir)), a.deploying, _services(a.services)
            )
            if a.cmd == "covered":
                missing = sorted(svc for svc, e in cands.items() if e["sha"] is None)
                print(f"uncovered: {' '.join(missing) or '-'}")
                return 3 if missing else 0
            problems = candidate_problems(cands, _services(a.services), a.deploying)
            if problems:
                raise ValueError("; ".join(problems))
            _write(cands, a.out)
        elif a.cmd == "designate":
            _write(designate(load_receipts(Path(a.receipts_dir))), a.out)
        elif a.cmd == "stamp":
            receipt = json.loads(Path(a.receipt).read_text(encoding="utf-8"))
            if "rollback_candidate" in receipt:
                raise ValueError(
                    "receipt already carries rollback_candidate; refusing to overwrite"
                )
            cands = json.loads(a.candidates_json)
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
                print(f"CONTRACTING {h['path']}: {h['statement']}")
            print(f"{len(hits)} contracting statement(s) since {a.candidate}")
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
