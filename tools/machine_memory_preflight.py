#!/usr/bin/env python3
"""Machine Memory preflight — READ-ONLY, secret-free (PRD §9.3, Workstream C).

Answers, with stable reason codes, "is Machine Memory operational for CV-101?"

  * effective MIRA_RUN_DIFF_ENABLED
  * whether MIRA_MACHINE_MEMORY_UNS_PATHS / MIRA_RUN_TRIGGERS cover CV-101
  * whether fault-trigger tags are configured
  * latest ingest heartbeat (max tag_events.ingested_at under CV-101) + age
  * latest historian/run-diff execution (newest machine_state_window
    derivation) + age
  * latest CV-101 faulted/estopped window + its tag_events row count
  * physical / simulated / stale / unknown classification of those rows
  * GO / NO-GO + reason codes

Safety-by-default:
  * SELECT statements only; the connection is opened READ ONLY
    (default_transaction_read_only=on) and never commits anything.
  * Refuses any database URL that looks like production (host/db name
    containing prod/prd/production). The production run is PREPARED for Mike
    (`--print-command`) and never executed from here.
  * Never prints the database URL, a password, or any Doppler value. Facts
    only.
  * No equipment access of any kind — this reads MIRA's own tables.

Usage
  # dev / staging (read-only URL from env or --db-url):
  python tools/machine_memory_preflight.py --json
  # what Mike runs against production (prints the command, runs nothing):
  python tools/machine_memory_preflight.py --print-command

Exit code: 0 = GO, 1 = NO-GO, 2 = usage/refused.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlparse

DEFAULT_CV101_UNS_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1"
INGEST_STALE_AFTER_S = 15 * 60
HISTORIAN_STALE_AFTER_S = 60 * 60
FAULT_PRE_S = 60
FAULT_POST_S = 10

REASON_CODES: dict[str, str] = {
    "DB_NOT_CONFIGURED": "No NEON_DATABASE_URL / --db-url; DB facts could not be read.",
    "DB_CONNECT_FAILED": "The read-only database connection failed (details withheld; no host/user is printed).",
    "TENANT_REQUIRED": "MIRA_TENANT_ID / --tenant-id is required: the preflight never reads across tenants.",
    "RUN_DIFF_DISABLED": "MIRA_RUN_DIFF_ENABLED is not '1' — the historian is a no-op.",
    "CV101_NOT_CONFIGURED": "CV-101's UNS path is in neither MIRA_MACHINE_MEMORY_UNS_PATHS nor MIRA_RUN_TRIGGERS.",
    "NO_FAULT_TRIGGERS": "MIRA_RUN_TRIGGERS names no trigger tag (no run segmentation).",
    "TABLES_UNAVAILABLE": "tag_events / machine_state_window missing in this database (033/040 not applied).",
    "INGEST_NONE": "No tag_events row has ever been ingested under CV-101.",
    "INGEST_STALE": f"Newest CV-101 ingest is older than {INGEST_STALE_AFTER_S}s.",
    "HISTORIAN_NONE": "No machine_state_window has ever been derived for CV-101.",
    "HISTORIAN_STALE": f"Newest CV-101 state-window derivation is older than {HISTORIAN_STALE_AFTER_S}s.",
    "NO_FAULT_WINDOW": "No faulted/estopped machine_state_window recorded for CV-101.",
    "FAULT_WINDOW_EMPTY": "The latest CV-101 fault window contains zero tag_events rows.",
    "ROWS_SIMULATED": "Every row in the latest CV-101 fault window is simulated.",
    "ROWS_STALE_QUALITY": "Every row in the latest CV-101 fault window carries bad/stale quality.",
}

Query = Callable[[str, tuple], list[dict[str, Any]]]


class RelationMissing(Exception):
    """A required table is not present (SQLSTATE 42P01)."""


class ProductionRefused(Exception):
    """The database URL looks like production; this tool never reads it."""


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
_PROD_ENV_KEYS = ("DOPPLER_CONFIG", "DOPPLER_ENVIRONMENT", "MIRA_ENV")


def allowed_hosts(env: dict[str, str], extra: list[str] | None = None) -> set[str]:
    """Loopback + operator-named dev/staging hosts. NEVER production."""
    hosts = set(LOOPBACK_HOSTS)
    hosts.update(
        h.strip().lower()
        for h in env.get("MACHINE_MEMORY_PREFLIGHT_ALLOWED_HOSTS", "").split(",")
        if h.strip()
    )
    hosts.update(h.strip().lower() for h in (extra or []) if h.strip())
    return hosts


def assert_not_production(
    db_url: str, env: dict[str, str] | None = None, extra_hosts: list[str] | None = None
) -> None:
    """Fail CLOSED: a database URL is readable only when its host is on the
    allowlist (loopback, or a dev/staging host the operator named), and the
    shell is not a production Doppler config. Real Neon hosts carry no
    'prod' marker (`ep-<words>-<id>.<region>.aws.neon.tech`), so a denylist
    on the hostname is theatre; the allowlist is the gate."""
    env = env or {}
    for key in _PROD_ENV_KEYS:
        if env.get(key, "").strip().lower() in ("prd", "prod", "production"):
            raise ProductionRefused(
                f"{key}={env[key]} names production; prepare the command for Mike with --print-command"
            )
    host = (urlparse(db_url).hostname or "").lower()
    if host not in allowed_hosts(env, extra_hosts):
        raise ProductionRefused(
            "database host is not on the dev/staging allowlist (loopback, MACHINE_MEMORY_PREFLIGHT_ALLOWED_HOSTS, "
            "or --allow-host); production is never read from a code session — use --print-command for Mike"
        )


# ── pure evaluation ─────────────────────────────────────────────────────────


def _age_s(ts: Any, now: datetime) -> int | None:
    if ts is None:
        return None
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int((now - ts).total_seconds())


def _iso(ts: Any) -> str | None:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.astimezone(timezone.utc).isoformat()
    return str(ts)


def classify(n: int, simulated: int, bad_quality: int) -> str:
    if n <= 0:
        return "unknown"
    if simulated >= n:
        return "simulated"
    if bad_quality >= n:
        return "stale"
    return "physical"


def _configured_paths(env: dict[str, str]) -> set[str]:
    paths = {
        p.strip() for p in env.get("MIRA_MACHINE_MEMORY_UNS_PATHS", "").split(",") if p.strip()
    }
    for item in env.get("MIRA_RUN_TRIGGERS", "").split(","):
        item = item.strip()
        if "=" in item:
            paths.add(item.split("=", 1)[0].strip())
    return paths


def _trigger_tags(env: dict[str, str]) -> list[str]:
    tags = []
    for item in env.get("MIRA_RUN_TRIGGERS", "").split(","):
        item = item.strip()
        if "=" in item and ":" in item.split("=", 1)[1]:
            tags.append(item.split("=", 1)[1].split(":", 1)[0].strip())
    return tags


def collect_db_facts(query: Query, tenant_id: str, uns_path: str, now: datetime) -> dict[str, Any]:
    """SELECT-only reads. Never raises on a missing table — reports it."""
    facts: dict[str, Any] = {
        "tables_unavailable": [],
        "ingest": {},
        "historian": {},
        "fault_window": {},
    }
    if not tenant_id:
        raise ValueError("tenant_id is required — the preflight never scans across tenants")
    tenant = (tenant_id,)
    tenant_pred = "tenant_id = %s::uuid AND "

    # Ingest heartbeat under the CV-101 subtree.
    try:
        rows = query(
            f"SELECT max(ingested_at) AS latest FROM tag_events WHERE {tenant_pred}uns_path <@ %s::ltree",
            tenant + (uns_path,),
        )
        latest = rows[0]["latest"] if rows else None
        facts["ingest"] = {"latest": _iso(latest), "age_s": _age_s(latest, now)}
    except RelationMissing:
        facts["tables_unavailable"].append("tag_events")
        facts["ingest"] = {"latest": None, "age_s": None}

    # Historian: newest window derivation + latest fault window.
    fault: dict[str, Any] | None = None
    try:
        rows = query(
            f"SELECT window_id::text AS window_id, state, started_at, ended_at, "
            f"coalesce(created_at, started_at) AS derived_at "
            f"FROM machine_state_window WHERE {tenant_pred}uns_path = %s::ltree "
            f"ORDER BY coalesce(created_at, started_at) DESC LIMIT 1",
            tenant + (uns_path,),
        )
        newest = rows[0] if rows else None
        facts["historian"] = {
            "latest_derivation": _iso(newest["derived_at"]) if newest else None,
            "age_s": _age_s(newest["derived_at"], now) if newest else None,
            "latest_state": newest["state"] if newest else None,
        }
        frows = query(
            f"SELECT window_id::text AS window_id, state, started_at, ended_at FROM machine_state_window "
            f"WHERE {tenant_pred}uns_path = %s::ltree AND state IN ('faulted','estopped') "
            f"ORDER BY started_at DESC LIMIT 1",
            tenant + (uns_path,),
        )
        fault = (
            frows[0]
            if frows
            else (newest if newest and newest.get("state") in ("faulted", "estopped") else None)
        )
    except RelationMissing:
        facts["tables_unavailable"].append("machine_state_window")
        facts["historian"] = {"latest_derivation": None, "age_s": None, "latest_state": None}

    fw: dict[str, Any] = {
        "window_id": None,
        "state": None,
        "started_at": None,
        "ended_at": None,
        "row_count": 0,
        "simulated": 0,
        "bad_quality": 0,
        "sources": [],
        "classification": "unknown",
    }
    if fault:
        fw.update(
            {
                "window_id": fault.get("window_id"),
                "state": fault.get("state"),
                "started_at": _iso(fault.get("started_at")),
                "ended_at": _iso(fault.get("ended_at")),
            }
        )
        if "tag_events" not in facts["tables_unavailable"]:
            try:
                started = fault.get("started_at")
                ended = fault.get("ended_at") or started
                if isinstance(started, str):
                    started = datetime.fromisoformat(started.replace("Z", "+00:00"))
                if isinstance(ended, str):
                    ended = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                lo = started - timedelta(seconds=FAULT_PRE_S)
                hi = ended + timedelta(seconds=FAULT_POST_S)
                rows = query(
                    f"SELECT count(*)::int AS n, "
                    f"count(*) FILTER (WHERE simulated)::int AS simulated, "
                    f"count(*) FILTER (WHERE quality IN ('bad','stale'))::int AS bad_quality, "
                    f"array_agg(DISTINCT source_system) AS sources "
                    f"FROM tag_events WHERE {tenant_pred}uns_path <@ %s::ltree "
                    f"AND event_timestamp >= %s AND event_timestamp <= %s",
                    tenant + (uns_path, lo, hi),
                )
                r = rows[0] if rows else {}
                n = int(r.get("n") or 0)
                sim = int(r.get("simulated") or 0)
                bad = int(r.get("bad_quality") or 0)
                fw.update(
                    {
                        "row_count": n,
                        "simulated": sim,
                        "bad_quality": bad,
                        "sources": [s for s in (r.get("sources") or []) if s],
                        "classification": classify(n, sim, bad),
                    }
                )
            except RelationMissing:
                facts["tables_unavailable"].append("tag_events")
    facts["fault_window"] = fw
    return facts


def evaluate(
    env: dict[str, str], db_facts: dict[str, Any] | None, *, cv101_uns_path: str
) -> dict[str, Any]:
    reasons: list[str] = []
    run_diff = env.get("MIRA_RUN_DIFF_ENABLED") == "1"
    paths = _configured_paths(env)
    triggers = _trigger_tags(env)
    cv101_ok = cv101_uns_path in paths
    if not run_diff:
        reasons.append("RUN_DIFF_DISABLED")
    if not cv101_ok:
        reasons.append("CV101_NOT_CONFIGURED")
    if not triggers:
        reasons.append("NO_FAULT_TRIGGERS")

    facts: dict[str, Any] = {
        "run_diff_enabled": run_diff,
        "cv101_uns_path": cv101_uns_path,
        "cv101_configured": cv101_ok,
        "configured_uns_paths": sorted(paths),
        "fault_triggers_configured": bool(triggers),
        "fault_trigger_tags": triggers,
        "ingest": {"latest": None, "age_s": None},
        "historian": {"latest_derivation": None, "age_s": None, "latest_state": None},
        "fault_window": {"window_id": None, "row_count": 0, "classification": "unknown"},
        "tables_unavailable": [],
    }
    if db_facts is None:
        reasons.append("DB_NOT_CONFIGURED")
    else:
        facts.update(db_facts)
        if db_facts["tables_unavailable"]:
            reasons.append("TABLES_UNAVAILABLE")
        else:
            ing = db_facts["ingest"]
            if ing.get("age_s") is None:
                reasons.append("INGEST_NONE")
            elif ing["age_s"] > INGEST_STALE_AFTER_S:
                reasons.append("INGEST_STALE")
            hist = db_facts["historian"]
            if hist.get("age_s") is None:
                reasons.append("HISTORIAN_NONE")
            elif hist["age_s"] > HISTORIAN_STALE_AFTER_S:
                reasons.append("HISTORIAN_STALE")
            fw = db_facts["fault_window"]
            if not fw.get("window_id"):
                reasons.append("NO_FAULT_WINDOW")
            elif fw.get("row_count", 0) == 0:
                reasons.append("FAULT_WINDOW_EMPTY")
            elif fw.get("classification") == "simulated":
                reasons.append("ROWS_SIMULATED")
            elif fw.get("classification") == "stale":
                reasons.append("ROWS_STALE_QUALITY")
    return {
        "verdict": "GO" if not reasons else "NO-GO",
        "reasons": reasons,
        "reason_text": {r: REASON_CODES[r] for r in reasons},
        "facts": facts,
    }


def run_preflight(
    env: dict[str, str],
    query: Query | None,
    *,
    now: datetime,
    cv101_uns_path: str = DEFAULT_CV101_UNS_PATH,
) -> dict[str, Any]:
    db_facts = None
    extra_reasons: list[str] = []
    tenant_id = env.get("MIRA_TENANT_ID", "").strip()
    if query is not None and not tenant_id:
        extra_reasons.append("TENANT_REQUIRED")
    elif query is not None:
        db_facts = collect_db_facts(query, tenant_id, cv101_uns_path, now)
    report = evaluate(env, db_facts, cv101_uns_path=cv101_uns_path)
    for r in extra_reasons:
        if r not in report["reasons"]:
            report["reasons"].insert(0, r)
            report["reason_text"][r] = REASON_CODES[r]
    if report["reasons"]:
        report["verdict"] = "NO-GO"
    report["checked_at"] = now.astimezone(timezone.utc).isoformat()
    report["read_only"] = True
    return report


# ── live DB adapter (read-only) ─────────────────────────────────────────────


def _psycopg_query(db_url: str) -> Query:
    import psycopg2  # local import: the pure path needs no driver
    import psycopg2.extras

    conn = psycopg2.connect(db_url, options="-c default_transaction_read_only=on", sslmode="prefer")
    conn.set_session(readonly=True, autocommit=True)

    def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            try:
                cur.execute(sql, params)
            except psycopg2.errors.UndefinedTable as exc:  # type: ignore[attr-defined]
                raise RelationMissing(str(exc)) from exc
            except psycopg2.errors.UndefinedColumn as exc:  # type: ignore[attr-defined]
                raise RelationMissing(str(exc)) from exc
            return [dict(r) for r in cur.fetchall()]

    return query


PROD_COMMAND = (
    "# Prepared for Mike — run on a machine with Doppler access to factorylm/prd.\n"
    "# READ-ONLY: SELECT statements on MIRA's own tables; nothing is written, nothing is printed but facts.\n"
    "doppler run --project factorylm --config prd -- \\\n"
    "  python tools/machine_memory_preflight.py --json --allow-production-by-operator\n"
    "# (Claude never runs this. The flag exists so the refusal above cannot be bypassed by accident.)"
)


def _render_text(report: dict[str, Any]) -> str:
    f = report["facts"]
    lines = [
        f"Machine Memory preflight — {report['verdict']} ({report['checked_at']})",
        f"  run-diff enabled        : {f['run_diff_enabled']}",
        f"  CV-101 configured       : {f['cv101_configured']}  ({f['cv101_uns_path']})",
        f"  fault triggers          : {f['fault_trigger_tags'] or 'none'}",
        f"  ingest heartbeat        : {f['ingest'].get('latest')}  age={f['ingest'].get('age_s')}s",
        f"  historian derivation    : {f['historian'].get('latest_derivation')}  age={f['historian'].get('age_s')}s  state={f['historian'].get('latest_state')}",
        f"  latest fault window     : {f['fault_window'].get('window_id')}  rows={f['fault_window'].get('row_count')}  class={f['fault_window'].get('classification')}",
    ]
    if f.get("tables_unavailable"):
        lines.append(f"  tables unavailable      : {f['tables_unavailable']}")
    for r in report["reasons"]:
        lines.append(f"  - {r}: {REASON_CODES[r]}")
    return "\n".join(lines)


def main(
    argv: list[str] | None = None, *, env: dict[str, str] | None = None, db: Query | None = None
) -> int:
    ap = argparse.ArgumentParser(description="Read-only Machine Memory preflight (PRD §9.3)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--db-url",
        default=None,
        help="read-only database URL (default: NEON_DATABASE_URL); never printed",
    )
    ap.add_argument("--cv101-uns-path", default=DEFAULT_CV101_UNS_PATH)
    ap.add_argument("--now", default=None, help="ISO timestamp (tests)")
    ap.add_argument(
        "--print-command",
        action="store_true",
        help="print the production invocation for Mike; run nothing",
    )
    ap.add_argument(
        "--allow-host",
        action="append",
        default=[],
        help="add a dev/staging host to the allowlist (never production)",
    )
    ap.add_argument(
        "--tenant-id",
        default=None,
        help="tenant UUID (default: MIRA_TENANT_ID); required for any DB read",
    )
    ap.add_argument(
        "--allow-production-by-operator",
        action="store_true",
        help="operator-only: lift the production-URL refusal",
    )
    args = ap.parse_args(argv)
    env = dict(os.environ) if env is None else env

    if args.print_command:
        print(PROD_COMMAND)
        return 0

    now = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    if args.tenant_id:
        env = {**env, "MIRA_TENANT_ID": args.tenant_id}
    query: Query | None = db
    connect_failed = False
    if query is None:
        url = args.db_url or env.get("NEON_DATABASE_URL", "")
        if url:
            if not args.allow_production_by_operator:
                try:
                    assert_not_production(url, env, args.allow_host)
                except ProductionRefused as exc:
                    print(f"REFUSED: {exc}", file=sys.stderr)
                    return 2
            try:
                query = _psycopg_query(url)
            except Exception as exc:  # noqa: BLE001 — never print host/user from a driver error
                print(
                    f"DB_CONNECT_FAILED: {type(exc).__name__} (details withheld)", file=sys.stderr
                )
                connect_failed = True

    report = run_preflight(env, query, now=now, cv101_uns_path=args.cv101_uns_path)
    if connect_failed:
        report["verdict"] = "NO-GO"
        report["reasons"] = ["DB_CONNECT_FAILED"] + [
            r for r in report["reasons"] if r != "DB_NOT_CONFIGURED"
        ]
        report["reason_text"] = {r: REASON_CODES[r] for r in report["reasons"]}
    print(json.dumps(report, indent=2, default=str) if args.json else _render_text(report))
    return 0 if report["verdict"] == "GO" else 1


if __name__ == "__main__":
    sys.exit(main())
