#!/usr/bin/env python3
"""Generation-bound acceptance-receipt contract (SDLC v1 Part B step 4).

`docs/architecture/mira-sdlc-v1.md` §6.2 requires an `acceptance-receipt-<sha>` that
`retrieval-acceptance.yml` produces and `deploy-vps.yml` (step 5) consumes. Today the
acceptance run uploads an untyped `{base, ran_at, rows}` blob with no SHA, no run id,
no service list, and nothing downstream reads it. This module is the producer
(``build_receipt``) and the fail-closed verifier (``verify_receipt``) for the typed
receipt that replaces it — mirroring ``tools/staging_receipt.py``'s shape: a pure
core that is unit-tested, plus a thin CLI.

A receipt only *authorizes* when it proves PASS on every required capability against
the exact SHA re-read at verdict time, bound to a specific deployment generation
(the staging run + running images that produced it). Anything less — SUPERSEDED,
SKIPPED, NOT_APPLICABLE, INFRA_UNASSESSED, a stale timestamp, a tampered expiry — is a
problem the verifier names, never a silent pass. stdlib only; runs on a bare runner.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = "factorylm.acceptance-receipt/1"
FRESHNESS_HOURS = 168.0
INFRA_UNASSESSED = "INFRA_UNASSESSED"
# The full verdict vocabulary a scenario or `overall` may carry.
VERDICTS = ("PASS", "FAIL", "SKIPPED", "NOT_APPLICABLE", "SUPERSEDED", INFRA_UNASSESSED)
_CAPTURE_STATUSES = ("PASS", "FAIL", "SKIPPED", "NOT_APPLICABLE")
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_FUTURE_SKEW = timedelta(minutes=5)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("timestamp must be a non-empty ISO-8601 string")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(text)
    return _as_utc(parsed)


def _format_z(dt: datetime) -> str:
    return _as_utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_receipt(
    *,
    repository: str,
    base_url: str,
    deployed_sha: str,
    rows: dict,
    capture_status: str,
    identity_end: str,
    run_id: str,
    run_attempt: int,
    run_url: str,
    staging_run_id: int | None = None,
    staging_receipt: dict | None = None,
    ran_at: datetime | None = None,
) -> dict:
    """Build a generation-bound acceptance receipt. Raises ``ValueError`` on any
    malformed input — an empty suite set, a bad verdict, or a non-40-hex SHA never
    silently becomes a receipt."""
    if not _SHA_RE.match(deployed_sha or ""):
        raise ValueError(f"deployed_sha is not a 40-hex commit: {deployed_sha!r}")
    if identity_end != INFRA_UNASSESSED and not _SHA_RE.match(identity_end or ""):
        raise ValueError(
            f"identity_end must be a 40-hex commit or {INFRA_UNASSESSED}: {identity_end!r}"
        )
    if capture_status not in _CAPTURE_STATUSES:
        raise ValueError(f"capture_status must be one of {_CAPTURE_STATUSES}: {capture_status!r}")

    raw_rows = rows.get("rows") if isinstance(rows, dict) else None
    if not raw_rows:
        raise ValueError(
            "rows contains zero scenarios; an empty suite set never certifies anything"
        )

    scenarios = [
        {
            "name": row.get("scenario"),
            "capability": "retrieval",
            "verdict": "PASS" if row.get("pass") else "FAIL",
            "trace_id": row.get("trace_id"),
        }
        for row in raw_rows
    ]
    scenarios.append(
        {"name": "capture_acceptance", "capability": "capture", "verdict": capture_status}
    )

    if staging_receipt is not None:
        # The artifact NAME is only a lookup key. Bind the generation to the staging
        # receipt's own identity fields, not to the filename: same schema, staging
        # environment, the SAME approved SHA this run audited, and the run id that
        # stamped it must be the run that triggered this acceptance (cheap-lane
        # finding, PR #4217). A receipt that says otherwise is not this generation.
        missing = [k for k in ("deployed_at", "running_images") if not staging_receipt.get(k)]
        if missing:
            raise ValueError(f"staging_receipt missing/empty field(s): {missing}")
        if staging_receipt.get("schema") != "factorylm.deploy-receipt/1":
            raise ValueError(
                f"staging_receipt schema is {staging_receipt.get('schema')!r}, "
                "expected 'factorylm.deploy-receipt/1'"
            )
        if staging_receipt.get("environment") != "staging":
            raise ValueError(
                f"staging_receipt environment is {staging_receipt.get('environment')!r}, expected 'staging'"
            )
        if staging_receipt.get("approved_rc_sha") != deployed_sha:
            raise ValueError(
                f"staging_receipt approved_rc_sha {staging_receipt.get('approved_rc_sha')!r} "
                f"!= deployed_sha {deployed_sha}; not this deployment's receipt"
            )
        if staging_run_id is None or str(staging_receipt.get("run_id")) != str(staging_run_id):
            raise ValueError(
                f"staging_receipt run_id {staging_receipt.get('run_id')!r} != triggering staging run "
                f"{staging_run_id!r}; not this generation's receipt"
            )
        generation = {
            "staging_run_id": staging_run_id,
            "deployed_at": staging_receipt["deployed_at"],
            "running_images": staging_receipt["running_images"],
        }
    else:
        generation = None

    if identity_end == INFRA_UNASSESSED:
        overall = INFRA_UNASSESSED
    elif identity_end != deployed_sha:
        overall = "SUPERSEDED"
    elif capture_status == "FAIL" or any(
        s["capability"] == "retrieval" and s["verdict"] == "FAIL" for s in scenarios
    ):
        overall = "FAIL"
    else:
        overall = "PASS"

    authorizes = overall == "PASS" and generation is not None and staging_run_id is not None

    ran_at_dt = _as_utc(ran_at) if ran_at is not None else datetime.now(timezone.utc)
    expires_at_dt = ran_at_dt + timedelta(hours=FRESHNESS_HOURS)

    return {
        "schema": SCHEMA,
        "repository": repository,
        "environment": "staging",
        "base_url": base_url,
        "git_sha": {"mira-hub": deployed_sha},
        "services_covered": ["mira-hub"],
        "capabilities": sorted({s["capability"] for s in scenarios}),
        "scenarios": scenarios,
        "capture_status": capture_status,
        "identity_start": deployed_sha,
        "identity_end": identity_end,
        "overall": overall,
        "authorizes": authorizes,
        "staging_run_id": staging_run_id,
        "acceptance_run_id": str(run_id),
        "acceptance_run_attempt": int(run_attempt),
        "run_url": run_url,
        "generation": generation,
        "ran_at": _format_z(ran_at_dt),
        "expires_at": _format_z(expires_at_dt),
    }


def verify_receipt(
    receipt: dict,
    *,
    approved_rc_sha: str,
    now: datetime,
    max_age_hours: float = FRESHNESS_HOURS,
    required_capabilities: tuple[str, ...] = ("retrieval",),
    expected_staging_run_id: object = None,
) -> list[str]:
    """Return every problem with ``receipt``; an empty list means it authorizes.

    Fail-closed by construction: a missing field is a problem, not a skip. Only an
    exact-SHA, PASS, generation-matched, non-stale receipt covering every required
    capability clears.
    """
    problems: list[str] = []
    now_utc = _as_utc(now)

    if not isinstance(receipt, dict):
        return ["receipt is not a JSON object"]

    if receipt.get("schema") != SCHEMA:
        problems.append(f"schema: expected {SCHEMA!r}, got {receipt.get('schema')!r}")

    if not receipt.get("repository"):
        problems.append("repository: missing or empty")

    if receipt.get("environment") != "staging":
        problems.append(f"environment: expected 'staging', got {receipt.get('environment')!r}")

    if not _SHA_RE.match(approved_rc_sha or ""):
        problems.append(f"approved_rc_sha argument is not a 40-hex commit: {approved_rc_sha!r}")

    git_sha = receipt.get("git_sha")
    if not isinstance(git_sha, dict) or not git_sha:
        problems.append("git_sha: missing or empty")
    else:
        for svc, value in git_sha.items():
            if value != approved_rc_sha:
                problems.append(f"git_sha[{svc}]: reported {value!r}, expected {approved_rc_sha}")

    identity_start = receipt.get("identity_start")
    identity_end = receipt.get("identity_end")
    if identity_end == INFRA_UNASSESSED:
        problems.append(f"identity re-read failed: {INFRA_UNASSESSED}")
    else:
        if identity_start != approved_rc_sha:
            problems.append(
                f"identity_start mismatch: expected {approved_rc_sha}, got {identity_start!r}"
            )
        if identity_end != approved_rc_sha:
            problems.append(
                f"identity_end mismatch: expected {approved_rc_sha}, got {identity_end!r}"
            )

    overall = receipt.get("overall")
    if overall != "PASS":
        if overall == "SUPERSEDED":
            problems.append("overall: SUPERSEDED — deployment generation changed during assessment")
        elif overall == INFRA_UNASSESSED:
            problems.append(f"overall: {INFRA_UNASSESSED} — infra could not be assessed")
        else:
            problems.append(f"overall: expected PASS, got {overall!r}")

    if receipt.get("authorizes") is not True:
        problems.append(f"authorizes: expected True, got {receipt.get('authorizes')!r}")

    generation = receipt.get("generation")
    if not isinstance(generation, dict) or not generation:
        problems.append("generation: missing or empty — no deployment generation was proven")
    else:
        for key in ("staging_run_id", "deployed_at", "running_images"):
            if not generation.get(key):
                problems.append(f"generation[{key}]: missing or empty")

    staging_run_id = receipt.get("staging_run_id")
    if staging_run_id is None:
        problems.append("staging_run_id: missing")
    elif isinstance(generation, dict) and str(generation.get("staging_run_id")) != str(
        staging_run_id
    ):
        problems.append(
            f"generation.staging_run_id {generation.get('staging_run_id')!r} != staging_run_id {staging_run_id!r}"
        )
    elif expected_staging_run_id is not None and str(staging_run_id) != str(
        expected_staging_run_id
    ):
        problems.append(
            f"staging_run_id mismatch: expected {expected_staging_run_id!r}, got {staging_run_id!r}"
        )

    scenarios = receipt.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        problems.append("scenarios: missing or empty")
        scenarios = []

    for capability in required_capabilities:
        matching = [
            s for s in scenarios if isinstance(s, dict) and s.get("capability") == capability
        ]
        if not matching:
            problems.append(f"capability {capability}: no scenarios reported")
            continue
        for s in matching:
            verdict = s.get("verdict")
            if verdict != "PASS":
                problems.append(
                    f"capability {capability}: scenario {s.get('name')} is {verdict}"
                    " — blocks authorization"
                )

    if not receipt.get("acceptance_run_id"):
        problems.append("acceptance_run_id: missing")
    if not receipt.get("run_url"):
        problems.append("run_url: missing")

    ran_at: datetime | None
    try:
        ran_at = _parse_timestamp(receipt.get("ran_at"))
    except (ValueError, TypeError) as exc:
        problems.append(f"ran_at: missing or invalid ({exc})")
        ran_at = None
    else:
        if ran_at > now_utc + _FUTURE_SKEW:
            problems.append(
                f"ran_at is in the future: {ran_at.isoformat()} vs now {now_utc.isoformat()}"
            )
        age = now_utc - ran_at
        if age > timedelta(hours=max_age_hours):
            problems.append(
                f"receipt too old: ran {age.total_seconds() / 3600:.1f}h ago, max {max_age_hours}h"
            )

    try:
        expires_at = _parse_timestamp(receipt.get("expires_at"))
    except (ValueError, TypeError) as exc:
        problems.append(f"expires_at: missing or invalid ({exc})")
    else:
        if ran_at is not None:
            expected_expiry = ran_at + timedelta(hours=FRESHNESS_HOURS)
            if abs((expires_at - expected_expiry).total_seconds()) > 1:
                problems.append(
                    f"expires_at tampered: expected {expected_expiry.isoformat()}, "
                    f"got {expires_at.isoformat()}"
                )

    return problems


def _cmd_build(args: argparse.Namespace) -> int:
    rows = json.loads(Path(args.rows).read_text(encoding="utf-8"))
    staging_receipt = None
    if args.staging_receipt:
        staging_receipt = json.loads(Path(args.staging_receipt).read_text(encoding="utf-8"))
    ran_at = _parse_timestamp(args.ran_at) if args.ran_at else None

    receipt = build_receipt(
        repository=args.repository,
        base_url=args.base_url,
        deployed_sha=args.deployed_sha,
        rows=rows,
        capture_status=args.capture_status,
        identity_end=args.identity_end,
        run_id=args.run_id,
        run_attempt=args.run_attempt,
        run_url=args.run_url,
        staging_run_id=args.staging_run_id,
        staging_receipt=staging_receipt,
        ran_at=ran_at,
    )
    Path(args.out).write_text(
        json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    print(f"acceptance receipt written to {args.out}")
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    required = tuple(c for c in args.require_capabilities.split(",") if c)
    problems = verify_receipt(
        receipt,
        approved_rc_sha=args.approved_rc_sha,
        now=datetime.now(timezone.utc),
        max_age_hours=args.max_age_hours,
        required_capabilities=required,
        expected_staging_run_id=args.expect_staging_run_id,
    )
    if problems:
        for problem in problems:
            print(f"::error::acceptance receipt: {problem}", file=sys.stderr)
        print(
            f"acceptance receipt FAILED verification with {len(problems)} problem(s)",
            file=sys.stderr,
        )
        return 1
    print(
        f"acceptance receipt verified: staging @ {args.approved_rc_sha} "
        f"(run {receipt.get('run_url')})"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build and verify acceptance receipts")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="build an acceptance receipt from acceptance rows")
    build.add_argument("--repository", required=True)
    build.add_argument("--base-url", required=True)
    build.add_argument("--deployed-sha", required=True)
    build.add_argument("--rows", required=True, help="retrieval acceptance rows JSON")
    build.add_argument("--capture-status", required=True, choices=_CAPTURE_STATUSES)
    build.add_argument("--identity-end", required=True)
    build.add_argument("--run-id", required=True)
    build.add_argument("--run-attempt", required=True, type=int)
    build.add_argument("--run-url", required=True)
    build.add_argument("--staging-run-id", type=int, default=None)
    build.add_argument("--staging-receipt", default=None, help="staging-receipt JSON")
    build.add_argument("--ran-at", default=None, help="ISO-8601 timestamp; default now (UTC)")
    build.add_argument("--out", required=True)
    build.set_defaults(func=_cmd_build)

    verify = sub.add_parser("verify", help="verify an acceptance receipt; exit 1 on any problem")
    verify.add_argument("--receipt", required=True)
    verify.add_argument("--approved-rc-sha", required=True)
    verify.add_argument("--max-age-hours", type=float, default=FRESHNESS_HOURS)
    verify.add_argument(
        "--require-capabilities",
        default="retrieval",
        help="comma-separated capabilities that must be PASS on every scenario",
    )
    verify.add_argument("--expect-staging-run-id", default=None)
    verify.set_defaults(func=_cmd_verify)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::acceptance receipt: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
