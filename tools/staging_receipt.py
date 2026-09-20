#!/usr/bin/env python3
"""Deployed-receipt contract — extract and verify deploy receipts (#3910 / #3911).

A deploy (staging or production) prints exactly one line::

    FACTORYLM_DEPLOY_RECEIPT_JSON={...}

The runner extracts it (``extract``), stamps the run identity onto it, verifies
it (``verify``) and uploads it as the ``<environment>-receipt-<approved_rc_sha>``
artifact. Production authorization downloads the *staging* receipt for the same
``approved_rc_sha`` and verifies it again before any production credential is
reachable.

The verifier is FAIL-CLOSED: every field is mandatory, every runtime identity
must equal the approved SHA, every built image id must equal its running image
id, the receipt must carry a parseable timestamp inside the freshness window,
and the required services must all be present. A receipt that says less than
that is not proof. Pure core (``extract_receipt_line``, ``verify_receipt``) is
unit-tested; ``main()`` is the thin CLI. stdlib only — this runs on a bare
ubuntu runner with no third-party packages.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

RECEIPT_SCHEMA = "factorylm.deploy-receipt/1"
RECEIPT_PREFIX = "FACTORYLM_DEPLOY_RECEIPT_JSON="
ENVIRONMENTS = ("staging", "production")
# The two customer-facing surfaces whose runtime identity proves the deploy.
DEFAULT_REQUIRED_SERVICES = ("mira-hub", "mira-web")
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_FUTURE_SKEW = timedelta(minutes=5)
# The ONLY fields the runner may stamp after extraction: run identity. Every
# security-bearing field (SHA, environment, runtime, images, timestamp) must come
# from the deploy transcript itself, never from a runner-side flag.
SETTABLE_FIELDS = ("run_url", "run_id")


def extract_receipt_line(text: str) -> dict:
    """Return the receipt dict from the single ``FACTORYLM_DEPLOY_RECEIPT_JSON=`` line.

    Raises ``ValueError`` on zero lines, more than one line, or invalid JSON.
    """
    lines = [line for line in text.splitlines() if line.startswith(RECEIPT_PREFIX)]
    if len(lines) == 0:
        raise ValueError(f"no {RECEIPT_PREFIX} line found in the deploy output")
    if len(lines) > 1:
        raise ValueError(f"{len(lines)} {RECEIPT_PREFIX} lines found; exactly one is required")
    try:
        parsed = json.loads(lines[0][len(RECEIPT_PREFIX) :])
    except json.JSONDecodeError as exc:
        raise ValueError(f"receipt line is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("receipt JSON must be an object")
    return parsed


def _parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("deployed_at must be a non-empty ISO-8601 string")
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _as_utc(now: datetime) -> datetime:
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def verify_receipt(
    receipt: dict,
    *,
    approved_rc_sha: str,
    environment: str,
    now: datetime,
    max_age_hours: float,
    required_services: tuple[str, ...] = DEFAULT_REQUIRED_SERVICES,
) -> list[str]:
    """Return every problem with ``receipt``; an empty list means it verifies.

    Fail-closed by construction: a missing field is a problem, not a skip.
    """
    problems: list[str] = []
    now_utc = _as_utc(now)

    if not isinstance(receipt, dict):
        return ["receipt is not a JSON object"]

    if receipt.get("schema") != RECEIPT_SCHEMA:
        problems.append(f"schema: expected {RECEIPT_SCHEMA!r}, got {receipt.get('schema')!r}")

    if environment not in ENVIRONMENTS:
        problems.append(f"environment: {environment!r} is not one of {ENVIRONMENTS}")
    if receipt.get("environment") != environment:
        problems.append(
            f"environment mismatch: expected {environment!r}, got {receipt.get('environment')!r}"
        )

    if not _SHA_RE.match(approved_rc_sha or ""):
        problems.append(f"approved_rc_sha argument is not a 40-hex commit: {approved_rc_sha!r}")
    receipt_sha = receipt.get("approved_rc_sha")
    if not isinstance(receipt_sha, str) or not _SHA_RE.match(receipt_sha):
        problems.append(f"approved_rc_sha in receipt is missing or malformed: {receipt_sha!r}")
    elif receipt_sha != approved_rc_sha:
        problems.append(f"approved_rc_sha mismatch: expected {approved_rc_sha}, got {receipt_sha}")

    # Runtime identity — every reported service must equal the approved SHA, and
    # every required service must be reported. One matching surface never masks
    # another that does not.
    runtime = receipt.get("runtime")
    if not isinstance(runtime, dict) or not runtime:
        problems.append("runtime: missing or empty — no runtime identity was proven")
        runtime = {}
    for svc, value in runtime.items():
        if value != approved_rc_sha:
            problems.append(f"runtime[{svc}]: reported {value!r}, expected {approved_rc_sha}")
    for svc in required_services:
        if svc not in runtime:
            problems.append(f"runtime[{svc}]: required service not reported")

    # Image identity — built == running, per service, non-empty, well-formed.
    built = receipt.get("built_images")
    running = receipt.get("running_images")
    if not isinstance(built, dict) or not built:
        problems.append("built_images: missing or empty")
        built = {}
    if not isinstance(running, dict) or not running:
        problems.append("running_images: missing or empty")
        running = {}
    if built and running and set(built) != set(running):
        problems.append(f"image key mismatch: built {sorted(built)} != running {sorted(running)}")
    for svc in sorted(set(built) | set(running)):
        b, r = built.get(svc), running.get(svc)
        if not isinstance(b, str) or not _IMAGE_ID_RE.match(b):
            problems.append(f"built_images[{svc}]: not a sha256 image id: {b!r}")
        if not isinstance(r, str) or not _IMAGE_ID_RE.match(r):
            problems.append(f"running_images[{svc}]: not a sha256 image id: {r!r}")
        if b != r:
            problems.append(f"image identity mismatch for {svc}: built {b!r} != running {r!r}")
    for svc in required_services:
        if svc not in built:
            problems.append(f"built_images[{svc}]: required service not reported")
        if svc not in running:
            problems.append(f"running_images[{svc}]: required service not reported")
    for svc in runtime:
        if svc not in built or svc not in running:
            problems.append(f"runtime[{svc}] reported without a matching image identity")

    target = receipt.get("target")
    if not isinstance(target, dict):
        problems.append("target: missing")
        target = {}
    if not target.get("host"):
        problems.append("target.host: missing")
    if not target.get("compose"):
        problems.append("target.compose: missing")

    try:
        deployed_at = _parse_timestamp(receipt.get("deployed_at"))
    except (ValueError, TypeError) as exc:
        problems.append(f"deployed_at: missing or invalid ({exc})")
    else:
        if deployed_at > now_utc + _FUTURE_SKEW:
            problems.append(
                f"deployed_at is in the future: {deployed_at.isoformat()} vs now {now_utc.isoformat()}"
            )
        age = now_utc - deployed_at
        if age > timedelta(hours=max_age_hours):
            problems.append(
                f"receipt too old: deployed {age.total_seconds() / 3600:.1f}h ago, max {max_age_hours}h"
            )

    if not receipt.get("run_url"):
        problems.append("run_url: missing")
    if not receipt.get("run_id"):
        problems.append("run_id: missing")

    return problems


def _cmd_extract(args: argparse.Namespace) -> int:
    receipt = extract_receipt_line(Path(args.log).read_text(encoding="utf-8"))
    for kv in args.set:
        if "=" not in kv:
            raise ValueError(f"--set expects key=value, got {kv!r}")
        key, value = kv.split("=", 1)
        if key not in SETTABLE_FIELDS:
            raise ValueError(
                f"--set may only stamp {SETTABLE_FIELDS}; refusing to overwrite {key!r}"
            )
        if not value:
            raise ValueError(f"--set {key} requires a non-empty value")
        receipt[key] = value
    Path(args.out).write_text(
        json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    print(f"receipt written to {args.out}")
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    required = tuple(s for s in args.require_services.split(",") if s)
    problems = verify_receipt(
        receipt,
        approved_rc_sha=args.approved_rc_sha,
        environment=args.environment,
        now=datetime.now(timezone.utc),
        max_age_hours=args.max_age_hours,
        required_services=required,
    )
    if problems:
        for problem in problems:
            print(f"::error::receipt: {problem}", file=sys.stderr)
        print(f"receipt FAILED verification with {len(problems)} problem(s)", file=sys.stderr)
        return 1
    print(
        f"receipt verified: {args.environment} @ {args.approved_rc_sha} "
        f"(run {receipt.get('run_url')})"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract and verify deploy receipts")
    sub = parser.add_subparsers(dest="command", required=True)

    extract = sub.add_parser("extract", help=f"extract the {RECEIPT_PREFIX} line from a log")
    extract.add_argument("--log", required=True, help="deploy transcript to read")
    extract.add_argument("--out", required=True, help="receipt JSON to write")
    extract.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help=f"stamp a run-identity field onto the receipt (only {', '.join(SETTABLE_FIELDS)})",
    )
    extract.set_defaults(func=_cmd_extract)

    verify = sub.add_parser("verify", help="verify a receipt JSON; exit 1 on any problem")
    verify.add_argument("--receipt", required=True)
    verify.add_argument("--approved-rc-sha", required=True)
    verify.add_argument("--environment", required=True, choices=ENVIRONMENTS)
    verify.add_argument("--max-age-hours", type=float, default=168.0)
    verify.add_argument(
        "--require-services",
        default=",".join(DEFAULT_REQUIRED_SERVICES),
        help="comma-separated services whose runtime + image identity must be present",
    )
    verify.set_defaults(func=_cmd_verify)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::receipt: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
