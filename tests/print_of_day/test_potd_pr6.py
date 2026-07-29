"""PR 6 tests — Containerized Print of the Day (ADR-0031, CLF POTD surface).

Hermetic ($0, no network, no docker): provenance seams and the readiness
collector are monkeypatched. Covers the directive's required behaviors:
provenance gates (git SHA / dirty / revision mismatch), fail-closed readiness
(Together+MiniMax-M3 + Tesseract, no silent fallback), send gate (§19.3),
duplicate-send protection, manifest provenance + gold-eligibility, and the
Dockerfile provenance-label / package contract.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.capability_codes import CapabilityError  # noqa: E402
from printsense.print_of_day import case, provenance, readiness_gate, send_gate  # noqa: E402


# ── provenance gates ────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch):
    for v in ("IMAGE_REVISION", "ALLOW_DIRTY_POTD"):
        monkeypatch.delenv(v, raising=False)
    yield


def test_missing_git_sha_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: None)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: False)
    with pytest.raises(CapabilityError) as exc:
        provenance.collect_provenance()
    assert exc.value.code == "DIRTY_WORKTREE"


def test_dirty_worktree_refuses_without_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: "a" * 40)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: True)
    with pytest.raises(CapabilityError) as exc:
        provenance.collect_provenance()
    assert exc.value.code == "DIRTY_WORKTREE"


def test_dirty_worktree_allowed_with_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: "a" * 40)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: True)
    monkeypatch.setenv("ALLOW_DIRTY_POTD", "1")
    prov = provenance.collect_provenance()
    assert prov.allow_dirty is True and prov.git_dirty is True


def test_revision_mismatch_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: "a" * 40)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: False)
    monkeypatch.setenv("IMAGE_REVISION", "b" * 40)
    with pytest.raises(CapabilityError) as exc:
        provenance.collect_provenance()
    assert exc.value.code == "REVISION_MISMATCH"


def test_clean_matching_revision_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: "c" * 40)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: False)
    monkeypatch.setenv("IMAGE_REVISION", "c" * 40)
    prov = provenance.collect_provenance()
    assert prov.git_sha == "c" * 40 and prov.git_dirty is False


def test_container_path_uses_image_revision_when_git_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A built container has no live .git; IMAGE_REVISION is the immutable identity.
    monkeypatch.setattr(provenance, "_git_sha", lambda: None)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: None)
    monkeypatch.setenv("IMAGE_REVISION", "d" * 40)
    prov = provenance.collect_provenance()
    assert prov.git_sha == "d" * 40 and prov.git_dirty is False


def test_no_git_and_no_image_revision_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provenance, "_git_sha", lambda: None)
    monkeypatch.setattr(provenance, "_git_dirty", lambda: None)
    with pytest.raises(CapabilityError) as exc:
        provenance.collect_provenance()
    assert exc.value.code == "DIRTY_WORKTREE"


def test_artifact_hashes(tmp_path: Path) -> None:
    f = tmp_path / "a.json"
    f.write_text('{"x":1}', encoding="utf-8")
    hashes = provenance.artifact_hashes([f, tmp_path / "missing.json"])
    assert set(hashes) == {"a.json"} and len(hashes["a.json"]) == 64


# ── readiness gate (fail closed, no substitution) ──────────────────────────


def _cap(**over):
    base = {
        "environment": "staging",
        "provider": {
            "requested": "together",
            "resolved": "together",
            "model": "MiniMaxAI/MiniMax-M3",
            "key_present": True,
            "network_enabled": True,
            "text_probe": "ok",
            "vision_probe": "ok",
        },
        "ocr": {
            "required": True,
            "available": True,
            "tesseract_version": "5.3.0",
            "pytesseract_version": "0.3.13",
        },
        "verdict": "ready",
    }
    for k, v in over.items():
        if k in base["provider"]:
            base["provider"][k] = v
        elif k in base["ocr"]:
            base["ocr"][k] = v
        else:
            base[k] = v
    return base


def test_readiness_passes_when_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(readiness_gate.readiness, "collect", lambda *a, **k: _cap())
    report = readiness_gate.enforce_potd_readiness()
    assert report["verdict"] == "ready"


@pytest.mark.parametrize(
    "over,code",
    [
        ({"resolved": "openai"}, "REQUIRED_PROVIDER_UNAVAILABLE"),
        ({"key_present": False}, "REQUIRED_PROVIDER_UNAVAILABLE"),
        ({"network_enabled": False}, "REQUIRED_PROVIDER_UNAVAILABLE"),
        ({"model": "google/gemma-3n-E4B-it"}, "MODEL_NOT_AVAILABLE"),
        ({"available": False, "tesseract_version": None}, "TESSERACT_MISSING"),
        ({"pytesseract_version": None}, "TESSERACT_MISSING"),
    ],
)
def test_readiness_fails_closed(monkeypatch: pytest.MonkeyPatch, over, code) -> None:
    monkeypatch.setattr(readiness_gate.readiness, "collect", lambda *a, **k: _cap(**over))
    with pytest.raises(CapabilityError) as exc:
        readiness_gate.enforce_potd_readiness()
    assert exc.value.code == code


def test_readiness_live_vision_probe_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        readiness_gate.readiness, "collect", lambda *a, **k: _cap(vision_probe="failed")
    )
    with pytest.raises(CapabilityError) as exc:
        readiness_gate.enforce_potd_readiness(live=True)
    assert exc.value.code == "VISION_PROBE_FAILED"


# ── send gate (§19.3) ───────────────────────────────────────────────────────


def _ctx(**over):
    base = dict(
        case_id="c1",
        recipient="mike@example.com",
        source_url="https://example.com/print.pdf",
        rights_complete=True,
        blind_response_present=True,
        script_ok=True,
        selected_page_sha="abc",
        graded_page_sha="abc",
        primary_attachments=["/x/manifest.json"],
    )
    base.update(over)
    return send_gate.SendContext(**base)


def test_send_gate_clear_when_all_good() -> None:
    assert send_gate.check_send_gate(_ctx(), prior_email_exists=False) == []


@pytest.mark.parametrize(
    "over,prior,reason",
    [
        ({"primary_attachments": []}, False, "attachment_missing"),
        ({"primary_attachments": ["a", "b"]}, False, "more_than_one_primary_attachment"),
        ({"rights_complete": False}, False, "rights_metadata_incomplete"),
        ({"blind_response_present": False}, False, "blind_response_missing"),
        ({"source_url": None}, False, "source_url_missing"),
        ({"recipient": None}, False, "email_recipient_missing"),
        ({"script_ok": False}, False, "script_generation_failed"),
        ({"graded_page_sha": "different"}, False, "selected_page_differs_from_graded_page"),
        ({}, True, "case_already_emailed"),
    ],
)
def test_send_gate_blocks(over, prior, reason) -> None:
    reasons = send_gate.check_send_gate(_ctx(**over), prior_email_exists=prior)
    assert reason in reasons


# ── duplicate-send protection ───────────────────────────────────────────────


def test_duplicate_send_prevention(tmp_path: Path) -> None:
    ledger = send_gate.SendLedger(tmp_path / "sent.jsonl")
    assert ledger.already_sent(run_id="r1", case_id="c1") is False
    ledger.record_sent(run_id="r1", case_id="c1", email_id="e1", sha="deadbeef")
    assert ledger.already_sent(run_id="r1", case_id="c1") is True
    # Same case id under a different run id is still a duplicate.
    assert ledger.already_sent(run_id="r2", case_id="c1") is True
    # Recording it again raises DUPLICATE_RUN (the check-then-act race is closed
    # inside the lock).
    with pytest.raises(CapabilityError) as exc:
        ledger.record_sent(run_id="r1", case_id="c1", email_id="e2", sha="x")
    assert exc.value.code == "DUPLICATE_RUN"


# ── manifest + gold eligibility ─────────────────────────────────────────────


def _evidence(tmp_path: Path, **over) -> case.CaseEvidence:
    prov = provenance.Provenance(
        git_sha="a" * 40, git_dirty=False, image_revision="a" * 40, allow_dirty=False
    )
    base = dict(
        case_id="c1",
        run_id="r1",
        generated_at="2026-07-22T00:00:00Z",
        environment="staging",
        provenance=prov,
        provider={"requested": "together", "resolved": "together", "model": "MiniMaxAI/MiniMax-M3"},
        ocr={
            "required": True,
            "available": True,
            "tesseract_version": "5.3.0",
            "pytesseract_version": "0.3.13",
        },
        grader={"score": 8.2, "letter": "B", "import_verdict": "PASS"},
        judge={"judge_independence": "reduced_same_cascade"},
        source_url="https://example.com/p.pdf",
        selected_page_sha="abc",
        graded_page_sha="abc",
    )
    base.update(over)
    return case.CaseEvidence(**base)


def test_manifest_carries_required_provenance(tmp_path: Path) -> None:
    art = tmp_path / "extraction.json"
    art.write_text("{}", encoding="utf-8")
    manifest = case.build_manifest(_evidence(tmp_path), [art])
    assert manifest["schema"] == "factorylm.print-of-day.v1"
    # The directive's required evidence set is all present.
    assert manifest["provider"]["model"] == "MiniMaxAI/MiniMax-M3"
    assert manifest["provenance"]["git_sha"] == "a" * 40
    assert manifest["provenance"]["image_revision"] == "a" * 40
    assert manifest["ocr"]["tesseract_version"] == "5.3.0"
    assert manifest["grader"]["import_verdict"] == "PASS"
    assert "extraction.json" in manifest["artifact_sha256"]
    assert manifest["gold_eligible"] is True


def test_manifest_validates_against_schema(tmp_path: Path) -> None:
    from factorylm_ai.schemas.validate import load_schema, validate_or_raise

    art = tmp_path / "e.json"
    art.write_text("{}", encoding="utf-8")
    manifest = case.build_manifest(_evidence(tmp_path), [art])
    validate_or_raise(manifest, load_schema("print_of_day"))


def test_fallback_or_degraded_is_not_gold_eligible(tmp_path: Path) -> None:
    art = tmp_path / "e.json"
    art.write_text("{}", encoding="utf-8")
    m1 = case.build_manifest(_evidence(tmp_path, fallback_attempts=[{"provider": "openai"}]), [art])
    assert m1["gold_eligible"] is False
    m2 = case.build_manifest(_evidence(tmp_path, degraded=["readiness_degraded"]), [art])
    assert m2["gold_eligible"] is False
    m3 = case.build_manifest(_evidence(tmp_path, graded_page_sha="different"), [art])
    assert m3["gold_eligible"] is False


# ── Dockerfile provenance + packaging contract ──────────────────────────────


def test_dockerfile_records_provenance_and_ships_reused_stages() -> None:
    df = (REPO / "tools" / "print_of_day" / "Dockerfile").read_text(encoding="utf-8")
    assert "org.opencontainers.image.revision" in df
    assert "ENV IMAGE_REVISION" in df
    assert "tesseract-ocr" in df
    assert "OCR_REQUIRE_TESSERACT=1" in df
    assert "PRINT_VISION_MODEL=MiniMaxAI/MiniMax-M3" in df
    assert "PRINT_PROVIDER_POLICY=strict" in df
    for pkg in ("printsense/", "factorylm_ai/", "config/providers/", "tools/internet_print_test/"):
        assert f"COPY {pkg}" in df, f"POTD image must ship {pkg}"
    assert "pytesseract" in (REPO / "tools" / "print_of_day" / "requirements.txt").read_text(
        encoding="utf-8"
    )
