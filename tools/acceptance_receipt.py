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
# The workflow's explicit verdict-time assessment (emitted once, after every check).
_ASSESSMENTS = ("PASS", "SUPERSEDED", INFRA_UNASSESSED)
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
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
    built_at_start: str,
    built_at_end: str,
    assessment: str,
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
    # The deployment GENERATION is `builtAt` from /api/health — stamped per build by
    # deploy-staging.yml (MIRA_BUILD_TIME), so a same-SHA `--no-cache` rebuild changes
    # it while gitSha does not (Codex F1, PR #4217). Start value must be a real
    # timestamp; the end value is a timestamp or INFRA_UNASSESSED.
    try:
        _parse_timestamp(built_at_start)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"built_at_start is not a timestamp ({exc}); cannot pin the generation"
        ) from exc
    if built_at_end != INFRA_UNASSESSED:
        try:
            _parse_timestamp(built_at_end)
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"built_at_end must be a timestamp or {INFRA_UNASSESSED} ({exc})"
            ) from exc
    if assessment not in _ASSESSMENTS:
        raise ValueError(f"assessment must be one of {_ASSESSMENTS}: {assessment!r}")

    raw_rows = rows.get("rows") if isinstance(rows, dict) else None
    if not raw_rows:
        raise ValueError(
            "rows contains zero scenarios; an empty suite set never certifies anything"
        )

    # Evidence must be well-formed before it becomes a verdict: each row is an
    # object with a non-empty scenario name and a JSON BOOLEAN `pass`. Python
    # truthiness would turn "false", 1 or {"result": "FAIL"} into PASS (Codex F4,
    # PR #4217) — malformed evidence is rejected, never authorized.
    if not isinstance(raw_rows, list):
        raise ValueError("rows['rows'] must be a list of scenario objects")
    scenarios = []
    for i, row in enumerate(raw_rows):
        if not isinstance(row, dict):
            raise ValueError(f"rows[{i}] is not a scenario object: {row!r}")
        name = row.get("scenario")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"rows[{i}].scenario must be a non-empty string: {name!r}")
        passed = row.get("pass")
        if not isinstance(passed, bool):
            raise ValueError(
                f"rows[{i}].pass must be a JSON boolean, got {type(passed).__name__} {passed!r}"
            )
        scenarios.append(
            {
                "name": name,
                "capability": "retrieval",
                "verdict": "PASS" if passed else "FAIL",
                "trace_id": row.get("trace_id"),
            }
        )
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
        # The triggering deploy's own build identity (deploy-staging stamps
        # MIRA_BUILD_TIME into the receipt). Both live probes must equal it, or the
        # generation observed is NOT the one this acceptance was triggered for —
        # e.g. an older run re-run before this audit started (Codex F1, PR #4217).
        receipt_built_at = staging_receipt.get("built_at")
        try:
            _parse_timestamp(receipt_built_at)
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"staging_receipt built_at is missing or invalid ({exc}); cannot bind the generation"
            ) from exc
        generation = {
            "staging_run_id": staging_run_id,
            "deployed_at": staging_receipt["deployed_at"],
            "built_at": receipt_built_at,
            "running_images": staging_receipt["running_images"],
        }
    else:
        generation = None

    live_is_triggering_generation = generation is None or (
        built_at_start == generation["built_at"] and built_at_end == generation["built_at"]
    )
    if (
        assessment == INFRA_UNASSESSED
        or identity_end == INFRA_UNASSESSED
        or built_at_end == INFRA_UNASSESSED
    ):
        overall = INFRA_UNASSESSED
    elif (
        assessment == "SUPERSEDED"
        or identity_end != deployed_sha
        or built_at_end != built_at_start
        or not live_is_triggering_generation
    ):
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
        "built_at_start": built_at_start,
        "built_at_end": built_at_end,
        "assessment": assessment,
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
    required_services: tuple[str, ...] = ("mira-hub",),
    staging_receipt: dict | None = None,
) -> list[str]:
    """Return every problem with ``receipt``; an empty list means it authorizes.

    Fail-closed by construction: a missing field is a problem, not a skip. Only an
    exact-SHA, PASS, generation-matched, non-stale receipt covering every required
    capability clears.

    ``staging_receipt`` is the staging receipt PRESENTED at production authorization.
    A run id alone cannot bind a generation: GitHub keeps ``GITHUB_RUN_ID`` across
    re-runs, so a re-run of the same staging run rebuilds the same SHA into a NEW
    generation under the OLD id (SDLC v1 §6.2 "Same-SHA redeploy"; Codex F1 on
    PR #4218). When given, the acceptance receipt's ``generation`` must equal that
    staging receipt's identity — built_at, deployed_at, every running image id and
    the run id — or the receipt does not authorize.
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

    # Generation identity observed live: builtAt at start and at verdict must be the
    # same parseable timestamp. A rebuild of the same SHA mid-run is SUPERSEDED.
    built_at_start = receipt.get("built_at_start")
    built_at_end = receipt.get("built_at_end")
    try:
        _parse_timestamp(built_at_start)
    except (ValueError, TypeError) as exc:
        problems.append(f"built_at_start: missing or invalid ({exc})")
    if built_at_end == INFRA_UNASSESSED:
        problems.append(f"built_at re-read failed: {INFRA_UNASSESSED}")
    elif built_at_end != built_at_start:
        problems.append(
            f"built_at changed during assessment: {built_at_start!r} -> {built_at_end!r} (SUPERSEDED)"
        )

    # Scope fields are mandatory and must agree with each other (Codex F2).
    services_covered = receipt.get("services_covered")
    if not isinstance(services_covered, list) or not services_covered:
        problems.append("services_covered: missing or empty")
        services_covered = []
    elif isinstance(git_sha, dict):
        if set(services_covered) != set(git_sha):
            problems.append(
                f"services_covered {sorted(services_covered)} != git_sha services {sorted(git_sha)}"
            )
    for svc in required_services:
        if svc not in services_covered:
            problems.append(f"services_covered: required service {svc!r} not covered")
    capture_status = receipt.get("capture_status")
    if capture_status not in _CAPTURE_STATUSES:
        problems.append(f"capture_status: missing or invalid ({capture_status!r})")
    attempt = receipt.get("acceptance_run_attempt")
    if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
        problems.append(f"acceptance_run_attempt: missing or invalid ({attempt!r})")

    assessment = receipt.get("assessment")
    if assessment != "PASS":
        problems.append(f"assessment: expected PASS, got {assessment!r}")

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
        for key in ("staging_run_id", "deployed_at", "built_at", "running_images"):
            if not generation.get(key):
                problems.append(f"generation[{key}]: missing or empty")
        try:
            _parse_timestamp(generation.get("deployed_at"))
        except (ValueError, TypeError) as exc:
            problems.append(f"generation[deployed_at]: invalid ({exc})")
        try:
            _parse_timestamp(generation.get("built_at"))
        except (ValueError, TypeError) as exc:
            problems.append(f"generation[built_at]: invalid ({exc})")
        else:
            if (
                generation.get("built_at") != built_at_start
                or generation.get("built_at") != built_at_end
            ):
                problems.append(
                    f"generation[built_at] {generation.get('built_at')!r} != live probes "
                    f"{built_at_start!r}/{built_at_end!r} — the audited generation is not the triggering deploy"
                )
        images = generation.get("running_images")
        if not isinstance(images, dict) or not images:
            problems.append("generation[running_images]: not a non-empty object")
        else:
            for svc, image in images.items():
                if not isinstance(image, str) or not _IMAGE_ID_RE.match(image):
                    problems.append(
                        f"generation[running_images][{svc}]: not a sha256 image id: {image!r}"
                    )
            for svc in services_covered:
                if svc not in images:
                    problems.append(
                        f"generation[running_images]: covered service {svc!r} has no image id"
                    )

    if staging_receipt is not None:
        problems.extend(_generation_matches_staging(receipt, staging_receipt, approved_rc_sha))

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

    capabilities = receipt.get("capabilities")
    declared = {s.get("capability") for s in scenarios if isinstance(s, dict)}
    if not isinstance(capabilities, list) or not capabilities:
        problems.append("capabilities: missing or empty")
    elif set(capabilities) != declared:
        problems.append(
            f"capabilities {sorted(map(str, capabilities))} != scenario capabilities {sorted(map(str, declared))}"
        )
    capture_rows = [
        s for s in scenarios if isinstance(s, dict) and s.get("capability") == "capture"
    ]
    if capture_rows and capture_status in _CAPTURE_STATUSES:
        verdicts = {s.get("verdict") for s in capture_rows}
        if verdicts != {capture_status}:
            problems.append(
                f"capture_status {capture_status!r} != capture scenario verdict(s) {sorted(map(str, verdicts))}"
            )

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
        built_at_start=args.built_at_start,
        built_at_end=args.built_at_end,
        assessment=args.assessment,
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


def _generation_matches_staging(
    receipt: dict, staging_receipt: dict, approved_rc_sha: str
) -> list[str]:
    """Every problem where the acceptance generation != the presented staging receipt."""
    problems: list[str] = []
    if not isinstance(staging_receipt, dict):
        return ["staging receipt: not a JSON object"]
    generation = receipt.get("generation")
    if not isinstance(generation, dict):
        return ["generation: missing — cannot bind to the presented staging receipt"]
    if staging_receipt.get("approved_rc_sha") != approved_rc_sha:
        problems.append(
            f"staging receipt is for {staging_receipt.get('approved_rc_sha')!r}, not {approved_rc_sha}"
        )
    for key in ("built_at", "deployed_at"):
        if generation.get(key) != staging_receipt.get(key) or not staging_receipt.get(key):
            problems.append(
                f"generation[{key}] {generation.get(key)!r} != staging receipt {key} "
                f"{staging_receipt.get(key)!r} — a different generation of the same SHA (SUPERSEDED)"
            )
    gen_images = generation.get("running_images")
    stg_images = staging_receipt.get("running_images")
    if not isinstance(stg_images, dict) or not stg_images:
        problems.append("staging receipt running_images: missing or empty")
    elif gen_images != stg_images:
        problems.append(
            "generation[running_images] != staging receipt running_images — "
            "the audited containers are not the ones presented for production"
        )
    if str(receipt.get("staging_run_id")) != str(staging_receipt.get("run_id")):
        problems.append(
            f"staging_run_id {receipt.get('staging_run_id')!r} != staging receipt run_id "
            f"{staging_receipt.get('run_id')!r}"
        )
    return problems


def _cmd_verify(args: argparse.Namespace) -> int:
    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    required = tuple(c for c in args.require_capabilities.split(",") if c)
    staging = None
    if args.staging_receipt:
        staging = json.loads(Path(args.staging_receipt).read_text(encoding="utf-8"))
    problems = verify_receipt(
        receipt,
        approved_rc_sha=args.approved_rc_sha,
        now=datetime.now(timezone.utc),
        max_age_hours=args.max_age_hours,
        required_capabilities=required,
        expected_staging_run_id=args.expect_staging_run_id,
        required_services=tuple(x for x in args.require_services.split(",") if x),
        staging_receipt=staging,
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
    build.add_argument("--built-at-start", required=True, help="builtAt from /api/health at start")
    build.add_argument(
        "--built-at-end", required=True, help="builtAt at verdict, or INFRA_UNASSESSED"
    )
    build.add_argument(
        "--assessment",
        required=True,
        choices=_ASSESSMENTS,
        help="the workflow's explicit verdict-time assessment (emitted after every check)",
    )
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
    verify.add_argument(
        "--staging-receipt",
        default=None,
        help=(
            "the staging-receipt JSON presented at production authorization; the acceptance "
            "generation (built_at, deployed_at, running_images, run id) must equal it"
        ),
    )
    verify.add_argument(
        "--require-services",
        default="mira-hub",
        help="comma-separated services that must appear in services_covered",
    )
    verify.set_defaults(func=_cmd_verify)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::acceptance receipt: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
