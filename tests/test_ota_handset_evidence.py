from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
_SPEC = importlib.util.spec_from_file_location(
    "ota_handset_evidence", REPO_ROOT / "tools" / "ota_handset_evidence.py"
)
assert _SPEC is not None and _SPEC.loader is not None
_evidence_module = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("ota_handset_evidence", _evidence_module)
_SPEC.loader.exec_module(_evidence_module)
EvidenceError = _evidence_module.EvidenceError
validate_evidence = _evidence_module.validate_evidence


ARTIFACT_SHA = "a" * 64
CANARY_SHA = "b" * 64
RELEASE_SHA = "c" * 40
PLAY_CERT_SHA = "d" * 64


def _evidence(root: Path) -> dict[str, object]:
    files = root / "docs" / "release" / "evidence" / "ota" / "files"
    files.mkdir(parents=True)
    transcript = files / "phone-check.txt"
    screenshot = files / "about-screen.png"
    transcript.write_bytes(b"adb proof")
    screenshot.write_bytes(b"png proof")
    return {
        "schemaVersion": 1,
        "result": "PASS",
        "artifactSha256": ARTIFACT_SHA,
        "bundleId": "1.2.3-aaaaaaaa",
        "nativeFingerprint": "0123456789abcdef",
        "releaseSha": RELEASE_SHA,
        "canaryManifestSha256": CANARY_SHA,
        "pointerChangedAt": "2026-09-07T01:02:03.004Z",
        "testedAt": "2026-09-07T01:12:03.004Z",
        "packageName": "com.factorylm.mira",
        "installerPackage": "com.android.vending",
        "playSigningCertSha256": PLAY_CERT_SHA,
        "deviceModel": "Pixel 9a",
        "updateReady": True,
        "restartCompleted": True,
        "aboutBundleIdVerified": True,
        "aboutChannel": "canary",
        "evidenceFiles": [
            {
                "kind": "adb_transcript",
                "path": "docs/release/evidence/ota/files/phone-check.txt",
                "sha256": hashlib.sha256(transcript.read_bytes()).hexdigest(),
            },
            {
                "kind": "about_screenshot",
                "path": "docs/release/evidence/ota/files/about-screen.png",
                "sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest(),
            },
        ],
    }


def _validate(root: Path, value: dict[str, object]) -> None:
    validate_evidence(
        value,
        evidence_root=root,
        expected_artifact_sha256=ARTIFACT_SHA,
        expected_bundle_id="1.2.3-aaaaaaaa",
        expected_native_fingerprint="0123456789abcdef",
        expected_release_sha=RELEASE_SHA,
        expected_canary_manifest_sha256=CANARY_SHA,
        expected_pointer_changed_at="2026-09-07T01:02:03.004Z",
        expected_play_signing_cert_sha256=PLAY_CERT_SHA,
    )


def test_accepts_exact_play_signed_handset_receipt(tmp_path: Path) -> None:
    _validate(tmp_path, _evidence(tmp_path))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("artifactSha256", "e" * 64),
        ("bundleId", "1.2.3-wrong"),
        ("nativeFingerprint", "f" * 16),
        ("releaseSha", "0" * 40),
        ("canaryManifestSha256", "1" * 64),
        ("pointerChangedAt", "2026-09-07T01:02:03.005Z"),
    ],
)
def test_rejects_receipt_not_bound_to_exact_canary(
    tmp_path: Path, field: str, value: str
) -> None:
    evidence = _evidence(tmp_path)
    evidence[field] = value
    with pytest.raises(EvidenceError, match=field):
        _validate(tmp_path, evidence)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("result", "HOLD"),
        ("packageName", "com.example.fake"),
        ("installerPackage", "adb"),
        ("playSigningCertSha256", "e" * 64),
        ("updateReady", False),
        ("restartCompleted", False),
        ("aboutBundleIdVerified", False),
        ("aboutChannel", "production"),
    ],
)
def test_rejects_non_play_or_incomplete_physical_proof(
    tmp_path: Path, field: str, value: object
) -> None:
    evidence = _evidence(tmp_path)
    evidence[field] = value
    with pytest.raises(EvidenceError, match=field):
        _validate(tmp_path, evidence)


def test_rejects_proof_older_than_the_canary_pointer(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    evidence["testedAt"] = "2026-09-07T01:02:03.003Z"
    with pytest.raises(EvidenceError, match="testedAt"):
        _validate(tmp_path, evidence)


def test_rejects_tampered_evidence_file(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    first = evidence["evidenceFiles"][0]  # type: ignore[index]
    first["sha256"] = "f" * 64  # type: ignore[index]
    with pytest.raises(EvidenceError, match="evidenceFiles"):
        _validate(tmp_path, evidence)


def test_rejects_evidence_path_escape(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    first = evidence["evidenceFiles"][0]  # type: ignore[index]
    first["path"] = "docs/release/evidence/ota/files/../../../../outside"  # type: ignore[index]
    with pytest.raises(EvidenceError, match="evidenceFiles"):
        _validate(tmp_path, evidence)


def test_rejects_evidence_reached_through_a_symlinked_directory(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    outside = tmp_path / "docs" / "release" / "evidence" / "other"
    outside.mkdir()
    leaked = outside / "not-really-a-screenshot.png"
    leaked.write_bytes(b"unrelated repository bytes")
    link = tmp_path / "docs" / "release" / "evidence" / "ota" / "files" / "alias"
    link.symlink_to(outside, target_is_directory=True)
    second = evidence["evidenceFiles"][1]  # type: ignore[index]
    second["path"] = "docs/release/evidence/ota/files/alias/not-really-a-screenshot.png"  # type: ignore[index]
    second["sha256"] = hashlib.sha256(leaked.read_bytes()).hexdigest()  # type: ignore[index]

    with pytest.raises(EvidenceError, match="symlink"):
        _validate(tmp_path, evidence)


def test_requires_both_transcript_and_about_screenshot(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    evidence["evidenceFiles"] = evidence["evidenceFiles"][:1]  # type: ignore[index]
    with pytest.raises(EvidenceError, match="evidenceFiles"):
        _validate(tmp_path, evidence)


def test_rejects_ambiguous_extra_receipt_fields(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    evidence["override"] = True
    with pytest.raises(EvidenceError, match="fields"):
        _validate(tmp_path, evidence)
