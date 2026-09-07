#!/usr/bin/env python3
"""Validate a Git-tracked physical-handset receipt for OTA production promotion."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

HEX_64 = re.compile(r"^[0-9a-f]{64}$")
HEX_40 = re.compile(r"^[0-9a-f]{40}$")
HEX_16 = re.compile(r"^[0-9a-f]{16}$")
CANONICAL_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
EVIDENCE_PREFIX = PurePosixPath("docs/release/evidence/ota/files")
REQUIRED_FILE_KINDS = {"adb_transcript", "about_screenshot"}
ALLOWED_FILE_KINDS = REQUIRED_FILE_KINDS | {"update_ready_screenshot"}
EXPECTED_FIELDS = {
    "schemaVersion",
    "result",
    "artifactSha256",
    "bundleId",
    "nativeFingerprint",
    "releaseSha",
    "canaryManifestSha256",
    "pointerChangedAt",
    "testedAt",
    "packageName",
    "installerPackage",
    "playSigningCertSha256",
    "deviceModel",
    "updateReady",
    "restartCompleted",
    "aboutBundleIdVerified",
    "aboutChannel",
    "evidenceFiles",
}


class EvidenceError(ValueError):
    """The receipt cannot authorize a production pointer change."""


def _canonical_time(field: str, value: object) -> datetime:
    if not isinstance(value, str) or not CANONICAL_TIMESTAMP.fullmatch(value):
        raise EvidenceError(f"{field} must be canonical UTC milliseconds")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise EvidenceError(f"{field} is not a real timestamp") from exc
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        raise EvidenceError(f"{field} must be canonical UTC milliseconds")
    return parsed


def _expect_exact(field: str, actual: object, expected: object) -> None:
    if actual != expected:
        raise EvidenceError(f"{field} does not match the exact canary evidence")


def _regular_evidence_file(root: Path, relative: object) -> Path:
    if not isinstance(relative, str) or not relative:
        raise EvidenceError("evidenceFiles path must be a nonempty string")
    posix = PurePosixPath(relative)
    if (
        posix.is_absolute()
        or ".." in posix.parts
        or posix.parts[: len(EVIDENCE_PREFIX.parts)] != EVIDENCE_PREFIX.parts
    ):
        raise EvidenceError("evidenceFiles path escapes the governed evidence directory")
    candidate = root.joinpath(*posix.parts)
    current = root
    for part in posix.parts:
        current /= part
        if current.is_symlink():
            raise EvidenceError("evidenceFiles paths must not traverse symlinks")
    try:
        resolved = candidate.resolve(strict=True)
        governed_root = root.joinpath(*EVIDENCE_PREFIX.parts).resolve(strict=True)
    except OSError as exc:
        raise EvidenceError(f"evidenceFiles path is missing: {relative}") from exc
    if governed_root not in resolved.parents:
        raise EvidenceError("evidenceFiles path resolves outside the evidence tree")
    if candidate.is_symlink() or not candidate.is_file():
        raise EvidenceError("evidenceFiles entries must be regular files, never symlinks")
    return candidate


def validate_evidence(
    value: Mapping[str, Any],
    *,
    evidence_root: Path,
    expected_artifact_sha256: str,
    expected_bundle_id: str,
    expected_native_fingerprint: str,
    expected_release_sha: str,
    expected_canary_manifest_sha256: str,
    expected_pointer_changed_at: str,
    expected_play_signing_cert_sha256: str,
) -> None:
    """Raise ``EvidenceError`` unless ``value`` proves the exact canary on Play."""

    if not isinstance(value, Mapping) or set(value) != EXPECTED_FIELDS:
        raise EvidenceError("receipt fields must exactly match schemaVersion 1")
    for name, pattern, expected in (
        ("artifactSha256", HEX_64, expected_artifact_sha256),
        ("nativeFingerprint", HEX_16, expected_native_fingerprint),
        ("releaseSha", HEX_40, expected_release_sha),
        ("canaryManifestSha256", HEX_64, expected_canary_manifest_sha256),
        ("playSigningCertSha256", HEX_64, expected_play_signing_cert_sha256),
    ):
        actual = value.get(name)
        if not isinstance(actual, str) or not pattern.fullmatch(actual):
            raise EvidenceError(f"{name} has a non-canonical shape")
        _expect_exact(name, actual, expected)

    _expect_exact("schemaVersion", value.get("schemaVersion"), 1)
    _expect_exact("result", value.get("result"), "PASS")
    _expect_exact("bundleId", value.get("bundleId"), expected_bundle_id)
    _expect_exact("pointerChangedAt", value.get("pointerChangedAt"), expected_pointer_changed_at)
    _expect_exact("packageName", value.get("packageName"), "com.factorylm.mira")
    _expect_exact("installerPackage", value.get("installerPackage"), "com.android.vending")
    _expect_exact("updateReady", value.get("updateReady"), True)
    _expect_exact("restartCompleted", value.get("restartCompleted"), True)
    _expect_exact("aboutBundleIdVerified", value.get("aboutBundleIdVerified"), True)
    _expect_exact("aboutChannel", value.get("aboutChannel"), "canary")

    model = value.get("deviceModel")
    if not isinstance(model, str) or not model.strip() or len(model) > 100 or "\n" in model:
        raise EvidenceError("deviceModel must identify the physical handset")

    pointer_time = _canonical_time("pointerChangedAt", value.get("pointerChangedAt"))
    tested_time = _canonical_time("testedAt", value.get("testedAt"))
    if tested_time < pointer_time:
        raise EvidenceError("testedAt predates the exact canary pointer")

    files = value.get("evidenceFiles")
    if not isinstance(files, list) or not (2 <= len(files) <= 20):
        raise EvidenceError("evidenceFiles must include transcript and About screenshot")
    kinds: set[str] = set()
    paths: set[str] = set()
    for item in files:
        if not isinstance(item, Mapping) or set(item) != {"kind", "path", "sha256"}:
            raise EvidenceError("evidenceFiles entries have invalid fields")
        kind = item.get("kind")
        if kind not in ALLOWED_FILE_KINDS:
            raise EvidenceError("evidenceFiles contains an unsupported kind")
        relative = item.get("path")
        if relative in paths:
            raise EvidenceError("evidenceFiles paths must be unique")
        expected_sha = item.get("sha256")
        if not isinstance(expected_sha, str) or not HEX_64.fullmatch(expected_sha):
            raise EvidenceError("evidenceFiles sha256 has a non-canonical shape")
        path = _regular_evidence_file(evidence_root, relative)
        actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_sha != expected_sha:
            raise EvidenceError(f"evidenceFiles digest mismatch: {relative}")
        kinds.add(kind)
        paths.add(relative)
    if not REQUIRED_FILE_KINDS.issubset(kinds):
        raise EvidenceError("evidenceFiles must include adb_transcript and about_screenshot")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-json", type=Path, required=True)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--artifact-sha256", required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--native-fingerprint", required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--canary-manifest-sha256", required=True)
    parser.add_argument("--pointer-changed-at", required=True)
    parser.add_argument("--play-signing-cert-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        raw = json.loads(args.evidence_json.read_text(encoding="utf-8"))
        validate_evidence(
            raw,
            evidence_root=args.evidence_root,
            expected_artifact_sha256=args.artifact_sha256,
            expected_bundle_id=args.bundle_id,
            expected_native_fingerprint=args.native_fingerprint,
            expected_release_sha=args.release_sha,
            expected_canary_manifest_sha256=args.canary_manifest_sha256,
            expected_pointer_changed_at=args.pointer_changed_at,
            expected_play_signing_cert_sha256=args.play_signing_cert_sha256,
        )
    except (EvidenceError, OSError, json.JSONDecodeError) as exc:
        print(f"HANDSET EVIDENCE FAILURE: {exc}", file=sys.stderr)
        return 1
    print("physical Play-signed handset evidence: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
