#!/usr/bin/env python3
"""Staging receipt contract: extract and verify deployed receipts.

This module extracts `FACTORYLM_DEPLOY_RECEIPT_JSON=` lines from deploy logs
and verifies their contents against approved SHAs, environments, and timing.
Used to prove that a staging deployment succeeded before promotion to production.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def extract_receipt_line(text: str) -> dict:
    """Extract the single FACTORYLM_DEPLOY_RECEIPT_JSON line from text.

    Raises ValueError if zero or more than one line found.
    Returns: dict parsed from the JSON value.
    """
    lines = [line for line in text.split("\n") if line.startswith("FACTORYLM_DEPLOY_RECEIPT_JSON=")]
    if len(lines) == 0:
        raise ValueError("No FACTORYLM_DEPLOY_RECEIPT_JSON line found in output")
    if len(lines) > 1:
        raise ValueError(f"Multiple FACTORYLM_DEPLOY_RECEIPT_JSON lines found ({len(lines)})")

    line = lines[0]
    json_part = line.replace("FACTORYLM_DEPLOY_RECEIPT_JSON=", "", 1)
    try:
        return json.loads(json_part)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in receipt line: {e}") from e


def verify_receipt(
    receipt: dict,
    *,
    approved_rc_sha: str,
    environment: str,
    now: datetime | None = None,
    max_age_hours: float = 168.0,
) -> list[str]:
    """Verify a receipt dict against expected values.

    Returns: list of problem strings (empty if receipt is valid).
    """
    now = now or datetime.utcnow()
    problems: list[str] = []

    # Normalize now to naive UTC if tz-aware (for subtraction compatibility)
    if now.tzinfo is not None:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)

    # Schema check
    if receipt.get("schema") != "factorylm.deploy-receipt/1":
        problems.append(
            f"invalid schema: expected 'factorylm.deploy-receipt/1', got '{receipt.get('schema')}'"
        )

    # Environment check
    if receipt.get("environment") != environment:
        problems.append(
            f"environment mismatch: expected '{environment}', got '{receipt.get('environment')}'"
        )

    # SHA check
    receipt_sha = receipt.get("approved_rc_sha")
    if not receipt_sha:
        problems.append("missing approved_rc_sha in receipt")
    elif receipt_sha != approved_rc_sha:
        problems.append(f"sha mismatch: expected {approved_rc_sha}, got {receipt_sha}")
    elif not all(c in "0123456789abcdef" for c in receipt_sha) or len(receipt_sha) != 40:
        problems.append(f"malformed sha: {receipt_sha}")

    # Runtime SHA check (at least one must match, if present)
    runtime = receipt.get("runtime", {})
    if runtime:
        runtime_shas = [v for v in runtime.values() if v is not None]
        if runtime_shas:
            if not any(v == approved_rc_sha for v in runtime_shas):
                problems.append(
                    f"runtime sha mismatch: expected at least one to equal {approved_rc_sha}, "
                    f"got {runtime_shas}"
                )

    # Image identity check
    built_images = receipt.get("built_images", {})
    running_images = receipt.get("running_images", {})
    if built_images or running_images:
        if set(built_images.keys()) != set(running_images.keys()):
            problems.append(
                f"image key mismatch: built {set(built_images.keys())} != "
                f"running {set(running_images.keys())}"
            )
        for svc in built_images:
            if built_images.get(svc) != running_images.get(svc):
                problems.append(
                    f"image identity mismatch for {svc}: "
                    f"built {built_images.get(svc)} != running {running_images.get(svc)}"
                )

    # Target check
    target = receipt.get("target", {})
    if not target.get("host"):
        problems.append("missing target.host")
    if not target.get("compose"):
        problems.append("missing target.compose")

    # Deployed-at check
    deployed_at_str = receipt.get("deployed_at")
    if deployed_at_str:
        try:
            # Handle ISO format with Z suffix
            if deployed_at_str.endswith("Z"):
                deployed_at_str = deployed_at_str[:-1] + "+00:00"
            deployed_at = datetime.fromisoformat(deployed_at_str)

            # Normalize to naive UTC if tz-aware
            if deployed_at.tzinfo is not None:
                deployed_at = deployed_at.astimezone(timezone.utc).replace(tzinfo=None)

            # Check not in the future (allow 5 min skew)
            if deployed_at > now + timedelta(minutes=5):
                problems.append(f"future timestamp: deployed_at is {deployed_at}, now is {now}")

            # Check not too old
            age = now - deployed_at
            if age > timedelta(hours=max_age_hours):
                problems.append(
                    f"receipt too old: deployed {age.total_seconds() / 3600:.1f} hours ago, "
                    f"max is {max_age_hours}"
                )
        except (ValueError, TypeError) as e:
            problems.append(f"invalid deployed_at timestamp: {deployed_at_str} ({e})")
    else:
        # deployed_at is optional; only check if present
        pass

    # Metadata check
    if not receipt.get("run_url"):
        problems.append("missing run_url")
    if not receipt.get("run_id"):
        problems.append("missing run_id")

    return problems


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Extract and verify deployment receipts")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # extract command
    extract_parser = subparsers.add_parser(
        "extract", help="Extract FACTORYLM_DEPLOY_RECEIPT_JSON from a log file"
    )
    extract_parser.add_argument("--log", required=True, help="Path to log file")
    extract_parser.add_argument("--out", required=True, help="Path to output JSON file")
    extract_parser.add_argument(
        "--set",
        action="append",
        default=[],
        help="Add key=value pairs to the receipt (format: key=value)",
    )

    # verify command
    verify_parser = subparsers.add_parser("verify", help="Verify a receipt JSON file")
    verify_parser.add_argument("--receipt", required=True, help="Path to receipt JSON file")
    verify_parser.add_argument("--approved-rc-sha", required=True, help="Expected approved RC SHA")
    verify_parser.add_argument(
        "--environment",
        required=True,
        choices=["staging", "production"],
        help="Expected environment",
    )
    verify_parser.add_argument(
        "--max-age-hours",
        type=float,
        default=168.0,
        help="Maximum age of receipt in hours (default: 168)",
    )

    args = parser.parse_args()

    try:
        if args.command == "extract":
            log_text = Path(args.log).read_text()
            receipt = extract_receipt_line(log_text)

            # Apply --set modifications
            for kv in args.set:
                if "=" not in kv:
                    print(f"error: invalid --set format: {kv}", file=sys.stderr)
                    return 1
                k, v = kv.split("=", 1)
                receipt[k] = v

            Path(args.out).write_text(json.dumps(receipt))
            return 0

        elif args.command == "verify":
            receipt_data = json.loads(Path(args.receipt).read_text())
            problems = verify_receipt(
                receipt_data,
                approved_rc_sha=args.approved_rc_sha,
                environment=args.environment,
                now=datetime.utcnow(),
                max_age_hours=args.max_age_hours,
            )

            if problems:
                for problem in problems:
                    print(f"error: {problem}", file=sys.stderr)
                return 1

            return 0

    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
