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

Plus ``due`` (refresh when the candidate's staging or acceptance receipt expires
within the window).

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


# ── contracting-migration detection (expand/contract, §10.2 Compatibility) ────────

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)
# One left-to-right pass, so a quote or comment marker is only special where it starts a
# token: a '(' ';' ',' or '--' inside a string literal can neither hide nor fake an action.
_LEXEMES = re.compile(
    r"(?P<dollar>\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*|)\$(?P<body>.*?)\$(?P=tag)\$)"
    r"|(?P<ident>\"(?:[^\"]|\"\")*\")"
    r"|(?P<estr>(?<![A-Za-z0-9_])[Ee]'(?:[^'\\]|\\.|'')*')"
    r"|(?P<literal>'(?:[^']|'')*')"
    r"|(?P<comment>--[^\n]*|/\*.*?\*/)",
    re.DOTALL,
)
_ESCAPE = re.compile(r"\\.", re.DOTALL)


def _strip_literals_and_comments(sql: str, keep_literals: bool = False) -> str:
    """Blank string literals, drop comments; keep identifiers and dollar-quoted bodies.

    A dollar-quoted body (``DO $$ … $$``, a function body) stays visible because DDL
    inside it still runs — hiding it would be the unsafe direction. Its contents are
    lexed the same way, except that literals are kept (``EXECUTE 'ALTER TABLE …'`` is
    real DDL), with E-string escapes rewritten as '' so quote tracking stays balanced.
    A quote that starts no literal or identifier is not structure and is blanked.
    """

    def render(m: re.Match) -> str:
        if m.group("dollar"):
            tag = f"${m.group('tag')}$"
            return tag + _strip_literals_and_comments(m.group("body"), keep_literals=True) + tag
        if m.group("ident"):
            # A quoted name is one token: whitespace, quotes or keywords inside it are data.
            return '"' + re.sub(r"[^A-Za-z0-9_]", "_", m.group("ident")[1:-1]) + '"'
        if m.group("estr"):
            if not keep_literals:
                return "''"
            return _ESCAPE.sub(lambda e: "''" if e.group(0) == "\\'" else "__", m.group("estr")[1:])
        if m.group("literal"):
            return m.group("literal") if keep_literals else "''"
        return " "

    out, pos = [], 0
    for m in _LEXEMES.finditer(sql):
        out.append(re.sub(r"['\"]", " ", sql[pos : m.start()]))
        out.append(render(m))
        pos = m.end()
    out.append(re.sub(r"['\"]", " ", sql[pos:]))
    return "".join(out)


_DROP_OBJECT = re.compile(
    r"\ADROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA|SEQUENCE|FUNCTION)\s+(?:IF\s+EXISTS\s+)?(.+)\Z"
)
_ALTER_TABLE = re.compile(r"\AALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)\s+(.+)\Z")
# Where a checked statement starts inside a ;-delimited piece. DDL inside a DO block or
# function body follows a PL/pgSQL prefix (DO $$ BEGIN IF … THEN) and still runs.
_DDL_START = re.compile(
    r"\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA|SEQUENCE|FUNCTION))\b"
)


def _split_statements(text: str) -> list[str]:
    """Split on ';' outside '…' and "…". Dollar bodies stay in the text (their DDL runs)."""
    parts, cur, quote = [], [], ""
    for ch in text:
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        if ch == ";" and not quote:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def _split_top_level(text: str) -> list[str]:
    parts, depth, cur, quote = [], 0, [], ""
    for ch in text:
        # A paren or comma inside '…' or "…" is data, not structure ('' and "" escapes
        # toggle twice and so stay inside).
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0 and not quote:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def contracting_statements(sql: str) -> list[str]:
    """Statements that remove or narrow what older code may rely on.

    Contracting: DROP TABLE/VIEW/MATERIALIZED VIEW/TYPE/SCHEMA/SEQUENCE/FUNCTION — always,
    even when the same file re-creates the name (the new object may differ: another
    function overload, a table without a column, a narrower view or enum) — and ALTER
    TABLE actions DROP [COLUMN], RENAME, ALTER COLUMN ... [SET DATA] TYPE, ALTER COLUMN
    ... SET NOT NULL, including inside DO blocks and function bodies. Not contracting:
    DROP POLICY/INDEX/TRIGGER, DROP CONSTRAINT, DROP DEFAULT / DROP NOT NULL, ADD
    COLUMN, CREATE … (expand), data DML. Literals and comments are ignored; quoted
    names are single tokens; every statement inside an EXECUTE string is checked, and
    an EXECUTE built at run time (|| or format()) that could narrow anything counts.
    """
    upper = _strip_literals_and_comments(sql).upper()
    hits = []
    for raw in _split_statements(upper):
        piece = " ".join(raw.split())
        # Every DDL start, each up to the next: a piece can hold several statements (an
        # EXECUTE string, a PL/pgSQL body) and each one runs.
        starts = [m.start() for m in _DDL_START.finditer(piece)]
        for i, at in enumerate(starts):
            stmt = piece[at : starts[i + 1] if i + 1 < len(starts) else len(piece)].strip()
            if _contracts(stmt):
                hits.append(stmt)
    for body in _bodies(sql):
        # A body that EXECUTEs anything other than one literal runs SQL assembled at run
        # time, which cannot be parsed: contracting if it could narrow anything
        # (conservative: a false INVALID beats a silent one).
        if _executes_dynamic_sql(body) and _NARROWING.search(body.upper()):
            hits.append("dynamic EXECUTE: " + " ".join(body.split())[:200])
        # Every string literal in a body may be executed: decode it and check it as SQL.
        for text in _decoded_literals(body):
            hits.extend(contracting_statements(text))
    return list(dict.fromkeys(hits))


_NARROWING = re.compile(r"\bDROP\b|\bRENAME\b|\bALTER\s+COLUMN\b|\bSET\s+NOT\s+NULL\b")
_EXECUTE_ARG = re.compile(r"\bEXECUTE\b(.*)", re.DOTALL)
_ONE_LITERAL = re.compile(r"\A'(?:[^']|'')*'(?:\s+USING\b.*)?\Z", re.DOTALL)


def _bodies(sql: str) -> list[str]:
    """Every dollar-quoted body, nested ones included."""
    out = []
    for m in _LEXEMES.finditer(sql):
        if m.group("dollar"):
            out.append(m.group("body"))
            out.extend(_bodies(m.group("body")))
    return out


def _decoded_literals(body: str) -> list[str]:
    """The string literals at this body's own level, unescaped to the SQL they hold."""
    out = []
    for m in _LEXEMES.finditer(body):
        if m.group("literal"):
            out.append(m.group("literal")[1:-1].replace("''", "'"))
        elif m.group("estr"):
            out.append(
                re.sub(r"\\(.)", r"\1", m.group("estr")[2:-1].replace("''", "'"), flags=re.DOTALL)
            )
    return out


def _executes_dynamic_sql(body: str) -> bool:
    text = _strip_literals_and_comments(body, keep_literals=True).upper()
    for piece in _split_statements(text):
        m = _EXECUTE_ARG.search(piece)
        if m and not _ONE_LITERAL.match(m.group(1).strip()):
            return True
    return False


def _contracts(stmt: str) -> bool:
    if _DROP_OBJECT.match(stmt):
        return True
    m = _ALTER_TABLE.match(stmt)
    if not m:
        return False
    for action in _split_top_level(m.group(2)):
        if (
            re.match(r"DROP\s+(?!CONSTRAINT\b)", action)
            or action.startswith("RENAME")
            or re.match(r"ALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b", action)
            or re.match(r"ALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b", action)
        ):
            return True
    return False


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout


# Expand-only allowlist (fail closed). A statement is proven harmless to OLDER code only if
# it matches one of these; anything else is "not proven" and makes the candidate invalid.
# One row per entry, with why older code can neither read nor write wrongly through it:
#   BEGIN / COMMIT / END / START TRANSACTION   transaction control, no schema change
#   SET [LOCAL|SESSION] name TO|= value         this migration session only (a SET of search_path
#                                               also ends every same-file exemption below: it
#                                               re-points the names created before it)
#   CREATE TABLE … (no INHERITS / PARTITION OF; a new table older code never references —
#     foreign keys only to tables new in this file) an FK to an older table can block its deletes
#   CREATE SEQUENCE …                           a new object older code never references
#   COMMENT ON …                                metadata only
#   GRANT privileges ON [TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE] x, or ON ALL … IN SCHEMA s
#                                               object privileges can only allow more (not a
#                                               role grant: it can bring a restrictive policy into
#                                               force; not schema USAGE: search_path skips a schema
#                                               without it, so granting it re-points names)
#   ALTER TABLE … ADD COLUMN c <built-in type>  older inserts omit c, so c must take NULL or a
#     [NULL | NOT NULL with DEFAULT] [DEFAULT     default that always succeeds: a constant (cast,
#      constant | now() | gen_random_uuid()]     if at all, only to a built-in type), now() or
#     [COLLATE x] and nothing else               gen_random_uuid(); no domain type, no constraint,
#                                               no other default expression. A length- or
#                                               precision-bounded type takes a constant only:
#                                               now() as text varies in length between calls
#   any statement but INSERT on a table a PLAIN `CREATE TABLE` (not CREATE TABLE … AS) made
#     earlier in the same file (IF NOT EXISTS proves nothing: the table may predate the file).
#     With every INSERT and CREATE TABLE … AS unproven, that table is empty, so nothing on it
#     evaluates a row expression.
# Assumed of older code: it names the columns it reads (no SELECT * unpacked by position).
# Not on it, deliberately: CREATE INDEX on an existing table (an expression or predicate can
# error, and a btree rejects rows over its size limit), CREATE TABLE … AS and INSERT anywhere
# (a query, and a table's defaults and checks, can call any function, e.g. setval),
# UPDATE/DELETE, CREATE UNIQUE INDEX, DROP
# INDEX or DROP CONSTRAINT (an ON CONFLICT arbiter for older upserts), ADD CONSTRAINT, policies
# and RLS, REVOKE, triggers, CREATE [OR REPLACE] FUNCTION/VIEW (overload resolution and
# behaviour), CREATE EXTENSION, DO blocks, and anything unrecognised. These need a human.
_EXPAND_ONLY = tuple(
    re.compile(p)
    for p in (
        r"BEGIN",
        r"COMMIT",
        r"END",
        r"START TRANSACTION",
        r"SET (?:LOCAL |SESSION )?[A-Z_][A-Z0-9_.]* (?:TO|=) [^$]+",
        r"CREATE TABLE (?:IF NOT EXISTS )?\S+ [^$]+",
        r"CREATE SEQUENCE (?:IF NOT EXISTS )?\S+[^$]*",
        r"COMMENT ON [^$]+",
        r"GRANT [^$]+? ON (?:(?:TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE) [^$]+"
        r"|ALL (?:TABLES|SEQUENCES|FUNCTIONS|PROCEDURES|ROUTINES) IN SCHEMA [^$]+"
        r"|[^\s,]+(?:, ?[^\s,]+)* TO [^$]+)",
    )
)
_UNBOUNDED_TYPE = (
    r"(?:SMALLINT|INTEGER|INT[248]?|BIGINT|BOOL(?:EAN)?|TEXT|UUID|JSONB?|DATE|REAL|FLOAT[48]"
    r"|DOUBLE PRECISION|BYTEA|INTERVAL|TIMESTAMPTZ|TIMESTAMP(?: WITH(?:OUT)? TIME ZONE)?"
    r"|NUMERIC|DECIMAL|VARCHAR|CHARACTER VARYING)(?:\[\])?"
)
_BOUNDED_TYPE = (
    r"(?:(?:NUMERIC|DECIMAL)\(\d+(?:, ?\d+)?\)|(?:VARCHAR|CHARACTER VARYING)\(\d+\))(?:\[\])?"
)
_BUILTIN_TYPE = rf"(?:{_BOUNDED_TYPE}|{_UNBOUNDED_TYPE})"
# a literal (blanked by _opaque) is coerced once, when the migration runs; a cast to a domain
# would run the domain's check, which can depend on session state, on every older insert
_CONST_DEFAULT = rf"DEFAULT (?:-?\d+(?:\.\d+)?|''(?:::{_BUILTIN_TYPE})?|TRUE|FALSE)"
_SAFE_DEFAULT = rf"(?:{_CONST_DEFAULT}|DEFAULT (?:NOW\(\)|CURRENT_TIMESTAMP|GEN_RANDOM_UUID\(\)))"
_ADD_COLUMN = re.compile(
    rf"ADD COLUMN (?:IF NOT EXISTS )?\S+ "
    rf"(?:{_UNBOUNDED_TYPE}(?: (?:NULL|NOT NULL|{_SAFE_DEFAULT}|COLLATE \S+))*"
    rf"|{_BOUNDED_TYPE}(?: (?:NULL|NOT NULL|{_CONST_DEFAULT}|COLLATE \S+))*)"
)
_NOT_NULL_NEEDS_DEFAULT = re.compile(rf"(?!.*\bNOT NULL\b)|(?=.*\b{_SAFE_DEFAULT})")
_PLAIN_CREATE_TABLE = re.compile(r"CREATE TABLE (?!IF NOT EXISTS )(\S+) .+")
_TABLE_TARGET = tuple(
    re.compile(p)
    for p in (
        r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(\S+) [^$]+",
        r"CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?\S+ ON (?:ONLY )?([^\s(]+)[^$]*",
        r"(?:CREATE|DROP) POLICY (?:IF EXISTS )?\S+ ON (\S+)[^$]*",
        r"(?:GRANT|REVOKE) [^$]+ ON (?:TABLE )?([^\s,]+) (?:TO|FROM) [^$]+",
        r"COMMENT ON (?:TABLE|COLUMN) ([^\s.]+)[^$]*",
    )
)


def _opaque(sql: str) -> str:
    """Upper-case SQL with literals blanked, comments dropped, quoted names as exact
    case-preserving tokens and every dollar-quoted body replaced by one opaque token (its
    content is never proof). A quoted name never folds into an unquoted one: at worst a
    statement on the same table looks foreign, which only makes the result stricter."""
    out, pos = [], 0
    for m in _LEXEMES.finditer(sql):
        out.append(re.sub(r"['\"]", " ", sql[pos : m.start()]))
        if m.group("dollar"):
            out.append(" $BODY$ ")
        elif m.group("ident"):
            out.append('"Q' + m.group("ident")[1:-1].encode("utf-8").hex() + '"')
        else:
            out.append("''" if (m.group("literal") or m.group("estr")) else " ")
        pos = m.end()
    out.append(re.sub(r"['\"]", " ", sql[pos:]))
    return "".join(out).upper()


def _table(name: str) -> str:
    """The table as written, schema included: ``a.t`` and ``b.t`` are different tables."""
    return name


_REFERENCES = re.compile(r"\bREFERENCES (?:ONLY )?([^\s(]+)")
# CREATE TABLE … INHERITS / PARTITION OF, and their ALTER TABLE spellings INHERIT / ATTACH PARTITION
_BINDS_PARENT = re.compile(r"\bINHERITS?\b|\bPARTITION OF\b|\bATTACH PARTITION\b")


_SEARCH_PATH = re.compile(r"SET (?:LOCAL |SESSION )?SEARCH_PATH\b")
_CREATE_TABLE_AS = re.compile(r"\bAS\b")


def _depth0(stmt: str) -> str:
    """The statement with every parenthesised group removed (literals are already blanked)."""
    out, depth = [], 0
    for ch in stmt:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(depth - 1, 0)
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def _evaluates_a_query(stmt: str) -> bool:
    """CREATE TABLE … AS: an AS outside every parenthesis (a column list's AS — a generated
    column, a CAST — is inside one)."""
    return stmt.startswith("CREATE TABLE ") and bool(_CREATE_TABLE_AS.search(_depth0(stmt)))


def _binds_older_table(stmt: str, new_tables: set[str]) -> bool:
    """A foreign key into, or inheritance/partitioning involving, a table not new in this file
    (CREATE TABLE … INHERITS / PARTITION OF, ALTER TABLE … INHERIT / ATTACH PARTITION)."""
    return bool(_BINDS_PARENT.search(stmt)) or any(
        _table(t) not in new_tables for t in _REFERENCES.findall(stmt)
    )


def unproven_statements(sql: str) -> list[str]:
    """Statements not on the expand-only allowlist above — older code might mis-read or
    mis-write through them, so a rollback across them needs a human decision."""
    new_tables: set[str] = set()
    out = []
    for raw in _opaque(sql).split(";"):
        stmt = " ".join(raw.split())
        if not stmt:
            continue
        if _SEARCH_PATH.match(stmt):
            new_tables.clear()  # every earlier name may now resolve to an older table
        created = _PLAIN_CREATE_TABLE.fullmatch(stmt)
        own = {_table(created.group(1))} if created else set()
        if _binds_older_table(stmt, new_tables | own) or _evaluates_a_query(stmt):
            out.append(stmt)
            continue
        target = next((m.group(1) for p in _TABLE_TARGET if (m := p.fullmatch(stmt))), None)
        if target is not None and _table(target) in new_tables:
            continue
        if any(p.fullmatch(stmt) for p in _EXPAND_ONLY):
            new_tables |= own
            continue
        alter = _ALTER_TABLE.match(stmt)
        if alter and all(
            _ADD_COLUMN.fullmatch(a) and _NOT_NULL_NEEDS_DEFAULT.match(a)
            for a in _split_top_level(alter.group(2))
        ):
            continue
        out.append(stmt)
    return out


def contracting_since(candidate: str, head: str, repo: Path) -> list[dict]:
    """Statements in migration files added or changed on ``head`` after ``candidate`` that
    stop it being a code-only rollback target: known contractions (``contracting``) and
    anything not provably expand-only (``unproven``). Empty means the candidate is valid."""
    for sha in (candidate, head):
        if not _SHA.match(sha):
            raise ValueError(f"not a 40-hex commit: {sha!r}")
    _git(repo, "merge-base", "--is-ancestor", candidate, head)  # CalledProcessError if not
    changed = _git(
        repo, "diff", "--name-only", "--diff-filter=AMR", candidate, head, "--", *MIGRATION_DIRS
    ).split()
    hits = []
    # A file added after the candidate and deleted before head may have been applied in
    # between: its effect can be live although head no longer shows it.
    added = _git(
        repo,
        "log",
        "--format=",
        "--name-only",
        "--diff-filter=A",
        f"{candidate}..{head}",
        "--",
        *MIGRATION_DIRS,
    ).split()
    at_head = set(_git(repo, "ls-tree", "-r", "--name-only", head, "--", *MIGRATION_DIRS).split())
    for path in sorted({p for p in added if p.endswith(".sql")} - at_head):
        hits.append(
            {
                "path": path,
                "kind": "unproven",
                "statement": "added after the candidate and deleted before head; it may have been applied",
            }
        )
    for path in sorted(p for p in changed if p.endswith(".sql")):
        text = _git(repo, "show", f"{head}:{path}")
        for stmt in contracting_statements(text):
            hits.append({"path": path, "kind": "contracting", "statement": stmt[:300]})
        for stmt in unproven_statements(text):
            hits.append({"path": path, "kind": "unproven", "statement": stmt[:300]})
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
                print(f"{h['kind'].upper()} {h['path']}: {h['statement']}")
            n = sum(h["kind"] == "contracting" for h in hits)
            print(
                f"{n} contracting and {len(hits) - n} not provably expand-only statement(s)"
                f" since {a.candidate}"
            )
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
