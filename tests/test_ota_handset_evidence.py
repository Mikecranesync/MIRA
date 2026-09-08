from __future__ import annotations

import hashlib
import importlib.util
import json
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
main = _evidence_module.main
validate_evidence = _evidence_module.validate_evidence


ARTIFACT_SHA = "a" * 64
CANARY_SHA = "b" * 64
RELEASE_SHA = "c" * 40
PLAY_CERT_SHA = "d" * 64
PROOF_SEQUENCE = [
    "update_ready",
    "restart",
    "about_expected_bundle_id",
    "second_check_now",
    "up_to_date",
]


def _evidence(root: Path) -> dict[str, object]:
    files = root / "docs" / "release" / "evidence" / "ota" / "files"
    files.mkdir(parents=True)
    transcript = files / "phone-check.txt"
    screenshot = files / "about-screen.png"
    transcript.write_text(
        "\n".join(
            [
                "FACTORYLM_OTA_PROOF_SEQUENCE_V2",
                "STEP update_ready",
                "STEP restart",
                "STEP about_expected_bundle_id",
                "STEP second_check_now",
                "RESULT up_to_date",
                "SECOND_DOWNLOAD observed=false",
                "",
            ]
        ),
        encoding="utf-8",
    )
    screenshot.write_bytes(b"png proof")
    return {
        "schemaVersion": 2,
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
        "secondCheckNowCompleted": True,
        "secondCheckResult": "up_to_date",
        "secondDownloadObserved": False,
        "proofSequence": PROOF_SEQUENCE.copy(),
        "proofTranscriptPath": "docs/release/evidence/ota/files/phone-check.txt",
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
def test_rejects_receipt_not_bound_to_exact_canary(tmp_path: Path, field: str, value: str) -> None:
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
        ("secondCheckNowCompleted", False),
        ("secondCheckResult", "update_ready"),
        ("secondDownloadObserved", True),
        ("secondDownloadObserved", 0),
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


@pytest.mark.parametrize(
    "sequence",
    [
        PROOF_SEQUENCE[:-2] + ["up_to_date"],
        PROOF_SEQUENCE[:-2] + ["up_to_date", "second_check_now"],
        [*PROOF_SEQUENCE, "up_to_date"],
    ],
    ids=["missing-second-check", "wrong-order", "duplicate-terminal-state"],
)
def test_rejects_incomplete_or_discontinuous_proof_sequence(
    tmp_path: Path, sequence: list[str]
) -> None:
    """Catches omitting, reordering, or replaying steps in the continuous capture."""
    evidence = _evidence(tmp_path)
    evidence["proofSequence"] = sequence

    with pytest.raises(EvidenceError, match="proofSequence"):
        _validate(tmp_path, evidence)


def test_rejects_proof_sequence_not_bound_to_the_continuous_transcript(tmp_path: Path) -> None:
    """Catches claiming continuity while pointing the chain at a single screenshot."""
    evidence = _evidence(tmp_path)
    evidence["proofTranscriptPath"] = "docs/release/evidence/ota/files/about-screen.png"

    with pytest.raises(EvidenceError, match="proofTranscriptPath"):
        _validate(tmp_path, evidence)


@pytest.mark.parametrize(
    "field",
    [
        "secondCheckNowCompleted",
        "secondCheckResult",
        "secondDownloadObserved",
        "proofSequence",
        "proofTranscriptPath",
    ],
)
def test_rejects_missing_terminal_proof_field(tmp_path: Path, field: str) -> None:
    evidence = _evidence(tmp_path)
    del evidence[field]

    with pytest.raises(EvidenceError, match="schemaVersion 2"):
        _validate(tmp_path, evidence)


@pytest.mark.parametrize(
    "transcript",
    [
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
RESULT up_to_date
SECOND_DOWNLOAD observed=false
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
RESULT up_to_date
SECOND_DOWNLOAD observed=true
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP second_check_now
STEP about_expected_bundle_id
RESULT up_to_date
SECOND_DOWNLOAD observed=false
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
RESULT up_to_date
SECOND_DOWNLOAD observed=false
SECOND_DOWNLOAD observed=true
""",
        """prefix FACTORYLM_OTA_PROOF_SEQUENCE_V2 suffix
prefix STEP update_ready suffix
prefix STEP restart suffix
prefix STEP about_expected_bundle_id suffix
prefix STEP second_check_now suffix
prefix RESULT up_to_date suffix
prefix SECOND_DOWNLOAD observed=false suffix
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
RESULT update_ready
RESULT up_to_date
SECOND_DOWNLOAD observed=false
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
RESULT up_to_date
SECOND_DOWNLOAD observed=false
SECOND_DOWNLOAD\tobserved=true
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
result update_ready
RESULT up_to_date
SECOND_DOWNLOAD observed=false
""",
        """FACTORYLM_OTA_PROOF_SEQUENCE_V2
STEP update_ready
STEP restart
STEP about_expected_bundle_id
STEP second_check_now
STEP: download_again
RESULT up_to_date
SECOND_DOWNLOAD observed=false
""",
    ],
    ids=[
        "missing-second-check",
        "second-download",
        "reordered",
        "contradictory-second-download",
        "embedded-control-markers",
        "extra-terminal-result",
        "tab-separated-second-download",
        "lowercase-terminal-result",
        "colon-separated-step",
    ],
)
def test_rejects_transcript_without_exact_continuous_terminal_proof(
    tmp_path: Path, transcript: str
) -> None:
    evidence = _evidence(tmp_path)
    transcript_path = (
        tmp_path / "docs" / "release" / "evidence" / "ota" / "files" / "phone-check.txt"
    )
    transcript_path.write_text(transcript, encoding="utf-8")
    evidence_file = evidence["evidenceFiles"][0]  # type: ignore[index]
    evidence_file["sha256"] = hashlib.sha256(transcript_path.read_bytes()).hexdigest()  # type: ignore[index]

    with pytest.raises(EvidenceError, match="proofTranscriptPath"):
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


def test_rejects_two_evidence_kinds_bound_to_one_physical_file(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path)
    files = evidence["evidenceFiles"]
    transcript = files[0]  # type: ignore[index]
    screenshot = files[1]  # type: ignore[index]
    governed_files = tmp_path / "docs" / "release" / "evidence" / "ota" / "files"
    (governed_files / "phone-check-alias.txt").hardlink_to(governed_files / "phone-check.txt")
    screenshot["path"] = "docs/release/evidence/ota/files/phone-check-alias.txt"  # type: ignore[index]
    screenshot["sha256"] = transcript["sha256"]  # type: ignore[index]

    with pytest.raises(EvidenceError, match="paths must be unique"):
        _validate(tmp_path, evidence)


@pytest.mark.parametrize(
    ("file_index", "noncanonical"),
    [
        (0, "docs/release/evidence/ota/files/./phone-check.txt"),
        (1, "docs/release/evidence/ota/files//about-screen.png"),
    ],
    ids=["dot-segment", "repeated-separator"],
)
def test_rejects_noncanonical_evidence_path_spelling(
    tmp_path: Path, file_index: int, noncanonical: str
) -> None:
    evidence = _evidence(tmp_path)
    evidence_file = evidence["evidenceFiles"][file_index]  # type: ignore[index]
    evidence_file["path"] = noncanonical  # type: ignore[index]
    if file_index == 0:
        evidence["proofTranscriptPath"] = noncanonical

    with pytest.raises(EvidenceError, match="canonical POSIX"):
        _validate(tmp_path, evidence)


@pytest.mark.parametrize(
    ("needle", "replacement"),
    [
        (
            '"secondDownloadObserved": false',
            '"secondDownloadObserved": true, "secondDownloadObserved": false',
        ),
        (
            '"kind": "adb_transcript"',
            '"kind": "about_screenshot", "kind": "adb_transcript"',
        ),
    ],
    ids=["top-level", "nested-evidence-file"],
)
def test_cli_rejects_duplicate_json_object_names_recursively(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    needle: str,
    replacement: str,
) -> None:
    receipt = tmp_path / "receipt.json"
    raw = json.dumps(_evidence(tmp_path))
    assert raw.count(needle) == 1
    receipt.write_text(raw.replace(needle, replacement, 1), encoding="utf-8")

    result = main(
        [
            "--evidence-json",
            str(receipt),
            "--evidence-root",
            str(tmp_path),
            "--artifact-sha256",
            ARTIFACT_SHA,
            "--bundle-id",
            "1.2.3-aaaaaaaa",
            "--native-fingerprint",
            "0123456789abcdef",
            "--release-sha",
            RELEASE_SHA,
            "--canary-manifest-sha256",
            CANARY_SHA,
            "--pointer-changed-at",
            "2026-09-07T01:02:03.004Z",
            "--play-signing-cert-sha256",
            PLAY_CERT_SHA,
        ]
    )

    assert result == 1
    assert "duplicate JSON object name" in capsys.readouterr().err
