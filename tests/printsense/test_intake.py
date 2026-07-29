"""Intake security — limits, consent, tenancy, safe names, logs (PR-2)."""

from __future__ import annotations

import logging

import pytest

pytest.importorskip("pydantic")

from printsense import intake  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic"
JPG = b"\xff\xd8\xff\xe0" + b"synthetic"


def _req(**over):
    base = dict(work_email="tech@example.com", company="Example Co",
                machine_type="conveyor", question="Why does K01 trip?",
                consent_confidentiality=True)
    base.update(over)
    return intake.IntakeRequest(**base)


def test_consent_is_mandatory():
    with pytest.raises(Exception):
        _req(consent_confidentiality=False)


def test_email_validated():
    with pytest.raises(Exception):
        _req(work_email="not-an-email")


def test_happy_path_and_status_lifecycle(tmp_path):
    out = intake.submit_intake(_req(), [("page one.png", PNG)], tmp_path, "t1")
    assert out["status"] == "queued" and out["files"] == 1
    rec = intake.get_intake(tmp_path, "t1", out["intake_id"])
    assert [h["status"] for h in rec["history"]] == ["received", "queued"]
    intake.set_status(tmp_path, "t1", out["intake_id"], "processing")
    with pytest.raises(ValueError):
        intake.set_status(tmp_path, "t1", out["intake_id"], "sneaky_state")


def test_magic_sniffing_rejects_disguised_files(tmp_path):
    with pytest.raises(intake.IntakeRefused):
        intake.submit_intake(_req(), [("x.png", b"MZexecutable")],
                             tmp_path, "t1")


def test_file_and_count_limits(tmp_path):
    many = [(f"p{i}.png", PNG + bytes([i])) for i in range(intake.MAX_FILES + 1)]
    with pytest.raises(intake.IntakeRefused):
        intake.submit_intake(_req(), many, tmp_path, "t1")
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (intake.MAX_FILE_BYTES + 1)
    with pytest.raises(intake.IntakeRefused):
        intake.submit_intake(_req(), [("big.png", big)], tmp_path, "t1")


def test_large_pdf_routed_to_managed_pilot(tmp_path):
    pdfium = pytest.importorskip("pypdfium2")
    doc = pdfium.PdfDocument.new()
    for _ in range(intake.MAX_PDF_PAGES + 1):
        doc.new_page(100, 100)
    import io
    buf = io.BytesIO()
    doc.save(buf)
    with pytest.raises(intake.IntakeRefused) as e:
        intake.submit_intake(_req(), [("pkg.pdf", buf.getvalue())],
                             tmp_path, "t1")
    assert "managed pilot" in str(e.value)


def test_safe_display_name_neutralizes_traversal(tmp_path):
    out = intake.submit_intake(_req(), [("../../evil\\..\\name.png", PNG)],
                               tmp_path, "t1")
    rec = intake.get_intake(tmp_path, "t1", out["intake_id"])
    dn = rec["files"][0]["display_name"]
    assert ".." not in dn and "/" not in dn and "\\" not in dn


def test_tenant_isolation(tmp_path):
    out = intake.submit_intake(_req(), [("a.jpg", JPG)], tmp_path, "tenant-a")
    with pytest.raises(KeyError):
        intake.get_intake(tmp_path, "tenant-b", out["intake_id"])


def test_logs_carry_hashes_never_content_or_names(tmp_path, caplog):
    with caplog.at_level(logging.INFO, logger="printsense.intake"):
        intake.submit_intake(_req(question="SECRET-QUESTION-MARKER ok?"),
                             [("SECRET-NAME.png", PNG + b"SECRET-BYTES")],
                             tmp_path, "t1")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "SECRET" not in joined and "sha=" in joined
