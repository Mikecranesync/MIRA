"""Tests for step 6 — the Materialized Evidence receipt in full_ingest_pipeline.

The receipt lane is OPTIONAL and FAIL-OPEN: with no registry configured the
pipeline behaves exactly as before, and any receipt failure is surfaced in
`report.evidence_status` without touching `report.errors` (which drives the CLI
exit code — a non-zero exit would make a cron retry a document that ingested fine).

Hermetic: a fake PDF on tmp_path, no network, no Neon, no Tika, no Ollama.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from tasks.full_ingest_pipeline import (
    PipelineReport,
    evidence_repair_path,
    step_document_evidence,
)

TENANT = "11111111-1111-1111-1111-111111111111"
DOC_TEXT = "## Page 1\n\nF0004 DC bus overvoltage — customer-private procedure"


def _pdf(tmp_path: Path) -> Path:
    p = tmp_path / "gs10.pdf"
    p.write_bytes(b"%PDF-1.7\n" + b"gs10 real bytes" * 8)
    return p


def _report(method: str = "pdfplumber", chunks: int = 7) -> PipelineReport:
    r = PipelineReport(pdf_url="https://example.test/gs10.pdf")
    r.extract_method = method
    r.extract_chars = len(DOC_TEXT)
    r.kb_chunks = chunks
    return r


def _run(
    tmp_path, *, report=None, text=DOC_TEXT, snapshot: str | None = "ev.json", tenant=TENANT, **kw
):
    report = report or _report()
    # The tenant is passed EXPLICITLY, never by patching a module global:
    # `test_celery_app_resilient_imports` deletes every `sys.modules["tasks.*"]`
    # entry, so `patch("tasks.full_ingest_pipeline.TENANT_ID", …)` would silently
    # target a re-imported module and these tests would fail only in a full-suite run.
    step_document_evidence(
        _pdf(tmp_path),
        text,
        report.pdf_url,
        kw.pop("ocr_requested", False),
        report,
        registry_path=str(tmp_path / snapshot) if snapshot else "",
        tenant_id=tenant,
        **kw,
    )
    return report


class TestOptionalAndFailOpen:
    def test_no_registry_configured_leaves_ingest_untouched(self, tmp_path):
        report = _run(tmp_path, snapshot=None)
        assert report.evidence_status == "skipped (no registry configured)"
        assert report.evidence_datasets == []
        assert report.errors == []

    def test_no_tenant_skips_rather_than_raising(self, tmp_path):
        report = _run(tmp_path, tenant="")
        assert report.evidence_status.startswith("skipped (MIRA_TENANT_ID not set")
        assert report.errors == []

    def test_unknown_environment_skips(self, tmp_path):
        report = _run(tmp_path, environment="production")
        assert "unknown MIRA_EVIDENCE_ENV" in report.evidence_status
        assert report.errors == []

    def test_receipt_write_failure_is_visible_but_never_blocks_ingest(self, tmp_path):
        report = _report()
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            step_document_evidence(
                _pdf(tmp_path),
                DOC_TEXT,
                report.pdf_url,
                False,
                report,
                registry_path=str(tmp_path / "ev.json"),
                tenant_id=TENANT,
            )
        assert report.evidence_status.startswith("failed: OSError: read-only filesystem")
        assert report.evidence_datasets == []
        # `errors` stays empty on purpose: it sets the CLI exit code, and a non-zero
        # exit would make a cron re-download and re-extract a document that is fine.
        assert report.errors == []

    def test_missing_pdf_fails_open(self, tmp_path):
        report = _report()
        step_document_evidence(
            tmp_path / "gone.pdf",
            DOC_TEXT,
            report.pdf_url,
            False,
            report,
            registry_path=str(tmp_path / "ev.json"),
            tenant_id=TENANT,
        )
        assert report.evidence_status.startswith("failed:")
        assert report.errors == []


class TestReceiptContent:
    def test_writes_two_candidate_receipts_keyed_on_the_real_bytes(self, tmp_path):
        report = _run(tmp_path)
        assert len(report.evidence_datasets) == 2
        assert report.evidence_status.endswith(str(tmp_path / "ev.json"))
        assert "2 candidate receipt(s)" in report.evidence_status

        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        manifests = data["manifests"]
        assert len(manifests) == 2
        # byte identity of the actual file, not the URL/filename
        from materialized_evidence import sha256_bytes

        expected = sha256_bytes(_pdf(tmp_path).read_bytes())
        for m in manifests:
            assert m["source_hashes"] == [expected]
            assert m["tenant_id"] == TENANT
            assert m["trust_status"] == "candidate"
            assert m["approval_status"] == "pending"
            assert m["approval_refs"] == []

    def test_references_the_knowledge_entries_materialization(self, tmp_path):
        _run(tmp_path, report=_report(chunks=7))
        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        extraction = next(m for m in data["manifests"] if m["dataset_type"] == "OCREvidence")
        # Content-addressed, NOT `source_url=…`: the download URL can be a
        # credential and an index_ref is persisted verbatim.
        doc_sha = hashlib.sha256(_pdf(tmp_path).read_bytes()).hexdigest()
        assert extraction["index_refs"] == [f"knowledge_entries:sha256:{doc_sha}#records=7"]
        assert extraction["storage_ref"] == str(_pdf(tmp_path))

    def test_no_document_text_reaches_the_snapshot(self, tmp_path):
        _run(tmp_path)
        raw = (tmp_path / "ev.json").read_text("utf-8")
        assert "overvoltage" not in raw.lower()
        assert "customer-private" not in raw
        assert set(json.loads(raw)) == {"manifests", "overlays"}

    def test_page_identity_stays_document_scoped_no_estimated_pages(self, tmp_path):
        """`report.extract_pages` is a heading-count estimate — it must never become
        a page coordinate."""
        report = _report()
        report.extract_pages = 41  # a plausible-looking estimate
        _run(tmp_path, report=report)
        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        pi = next(m for m in data["manifests"] if m["dataset_type"] == "PageIdentityEvidence")
        assert pi["page_or_segment_scope"] == "document"
        assert pi["completeness"] is None
        assert any("page identity not supplied" in g for g in pi["known_gaps"])
        assert "41" not in json.dumps(pi["known_gaps"])

    @pytest.mark.parametrize(
        ("method", "mode", "is_ocr"),
        [
            ("pdfplumber", "text_layer", False),
            ("pypdf", "text_layer", False),
            ("tika_ocr", "ocr", True),
        ],
    )
    def test_extraction_method_is_preserved_verbatim(self, method, mode, is_ocr):
        """A text-layer parse must never be recorded as OCR."""
        from materialized_evidence.document_compiler import (
            DocumentExtraction,
            DocumentSource,
            compile_document_evidence,
            extraction_mode,
        )
        from materialized_evidence import sha256_bytes

        assert extraction_mode(method) == mode
        receipt = compile_document_evidence(
            source=DocumentSource("u", sha256_bytes(b"x"), 1),
            extraction=DocumentExtraction(method=method, char_count=10),
            tenant_id=TENANT,
        )
        payload = receipt.extraction_records[0].payload
        assert payload["extraction_method"] == method
        assert payload["extraction_mode"] == mode
        assert payload["is_ocr"] is is_ocr


class TestFailedExtractionPath:
    def test_failed_extraction_is_receipted_without_claiming_success(self, tmp_path):
        """Preserves the needs_ocr/Tika failure behavior: the receipt records the
        failure; it never converts it into a success or a materialization."""
        report = _report(method="pypdf (empty)", chunks=0)
        report.extract_chars = 0
        _run(tmp_path, report=report, text="")

        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        extraction = next(m for m in data["manifests"] if m["dataset_type"] == "OCREvidence")
        assert extraction["stage_status"] == "failed"
        assert extraction["index_refs"] == []
        assert extraction["completeness"] is None
        assert report.errors == []

    def test_reingest_is_idempotent_across_processes(self, tmp_path):
        """Re-running the same document must not raise (and must not accumulate
        versions) — the durable-recall property the whole receipt exists for."""
        first = _run(tmp_path)
        second = _run(tmp_path)
        assert first.evidence_datasets == second.evidence_datasets
        assert not second.evidence_status.startswith("failed")
        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        assert len(data["manifests"]) == 2


class TestSecretBearingUrls:
    """A download URL is routinely a credential (presigned signature, portal
    `?token=`, `user:pass@`), and everything this step writes is durable."""

    PRESIGNED = "https://oem.example.test/dl/gs10.pdf?token=abc&X-Amz-Signature=deadbeefcafe"

    def test_the_token_never_reaches_the_registry_snapshot(self, tmp_path):
        report = _report()
        report.pdf_url = self.PRESIGNED
        _run(tmp_path, report=report)

        raw = (tmp_path / "ev.json").read_text("utf-8")
        assert "token=abc" not in raw
        assert "deadbeefcafe" not in raw
        assert "X-Amz-Signature" not in raw
        # provenance survives: scheme + host + path
        data = json.loads(raw)
        for m in data["manifests"]:
            assert "https://oem.example.test/dl/gs10.pdf" in m["source_objects"]

    def test_the_kb_reference_is_the_document_sha_not_the_url(self, tmp_path):
        report = _report(chunks=7)
        report.pdf_url = self.PRESIGNED
        _run(tmp_path, report=report)

        data = json.loads((tmp_path / "ev.json").read_text("utf-8"))
        extraction = next(m for m in data["manifests"] if m["dataset_type"] == "OCREvidence")
        doc_sha = hashlib.sha256(_pdf(tmp_path).read_bytes()).hexdigest()
        assert extraction["index_refs"] == [f"knowledge_entries:sha256:{doc_sha}#records=7"]

    def test_the_repair_journal_is_redacted_too(self, tmp_path):
        """The journal is exactly as durable as the snapshot — it must not become a
        second copy of the leak this PR closes."""
        report = _report()
        report.pdf_url = self.PRESIGNED
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError(f"cannot write while fetching {self.PRESIGNED}"),
        ):
            _run(tmp_path, report=report)

        raw = evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8")
        assert "token=abc" not in raw
        assert "deadbeefcafe" not in raw
        item = json.loads(raw.strip())
        assert item["source_uri"] == "https://oem.example.test/dl/gs10.pdf"
        assert item["replay"]["source"]["source_uri"] == "https://oem.example.test/dl/gs10.pdf"
        # …including the URL quoted inside the exception message
        assert "https://oem.example.test/dl/gs10.pdf" in item["reason"]


class TestRepairJournal:
    """A receipt failure keeps ingest fail-open — but must no longer be silent.

    Before this, the process exited zero, the cron marked the document done, and a
    document with no receipt was indistinguishable from one with two.
    """

    def _fail(self, tmp_path, exc=OSError("read-only filesystem"), **kw):
        with patch(
            "materialized_evidence.document_compiler.write_receipt", side_effect=exc
        ):
            return _run(tmp_path, **kw)

    def test_a_failure_records_a_replayable_repair_item(self, tmp_path):
        report = self._fail(tmp_path, report=_report(chunks=7))

        journal = evidence_repair_path(str(tmp_path / "ev.json"))
        assert journal.exists()
        item = json.loads(journal.read_text("utf-8").strip())
        assert item["status"] == "evidence_pending"
        assert item["schema"] == "evidence_repair_item/1.0"
        assert item["tenant_id"] == TENANT
        assert "read-only filesystem" in item["reason"]
        assert str(journal) in report.evidence_status

        # the compiler's inputs, verbatim — replay needs no network and no re-extract
        doc_sha = hashlib.sha256(_pdf(tmp_path).read_bytes()).hexdigest()
        assert item["replay"]["source"]["content_sha256"] == doc_sha
        assert item["replay"]["source"]["byte_count"] == len(_pdf(tmp_path).read_bytes())
        assert item["replay"]["extraction"]["method"] == "pdfplumber"
        assert item["replay"]["extraction"]["char_count"] == len(DOC_TEXT)
        assert item["replay"]["materializations"] == [
            {"kind": "knowledge_entries", "locator": f"sha256:{doc_sha}", "record_count": 7}
        ]

    def test_the_repair_item_actually_replays_into_a_receipt(self, tmp_path):
        """The claim executed, not asserted: the journal is sufficient on its own."""
        from materialized_evidence import Environment
        from materialized_evidence.backends.file_registry import FileRegistry
        from materialized_evidence.document_compiler import (
            DocumentExtraction,
            DocumentSource,
            MaterializationRef,
            compile_document_evidence,
            write_receipt,
        )

        self._fail(tmp_path, report=_report(chunks=7))
        item = json.loads(
            evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8").strip()
        )

        receipt = compile_document_evidence(
            source=DocumentSource(**item["replay"]["source"]),
            extraction=DocumentExtraction(**item["replay"]["extraction"]),
            tenant_id=item["tenant_id"],
            environment=Environment(item["environment"]),
            materializations=[MaterializationRef(**m) for m in item["replay"]["materializations"]],
        )
        snapshot = tmp_path / "repaired.json"
        assert len(write_receipt(receipt, FileRegistry(snapshot))) == 2
        assert len(json.loads(snapshot.read_text("utf-8"))["manifests"]) == 2

    def test_a_success_writes_no_repair_item(self, tmp_path):
        _run(tmp_path)
        assert not evidence_repair_path(str(tmp_path / "ev.json")).exists()

    def test_ingest_still_fails_open_with_a_journal(self, tmp_path):
        """`errors` drives the CLI exit code; a receipt gap must not re-download a
        document that ingested fine."""
        report = self._fail(tmp_path)
        assert report.errors == []
        assert report.evidence_datasets == []

    def test_an_unwritable_journal_never_breaks_ingest(self, tmp_path):
        """Recording the failure must not itself become a failure.

        The failure is induced with a read-only parent dir rather than by patching
        `builtins.open`: patching builtins fires first at `pdf_path.read_bytes()` —
        pathlib routes through `io.open` — so the receipt would never get far enough
        to journal, and the test would pass for the wrong reason.
        """
        registry = tmp_path / "ro" / "ev.json"
        registry.parent.mkdir()
        registry.parent.chmod(0o500)  # the journal's own open() -> PermissionError
        try:
            report = self._fail(tmp_path, snapshot="ro/ev.json")
        finally:
            registry.parent.chmod(0o700)
        assert not evidence_repair_path(str(registry)).exists()
        assert report.errors == []
        assert report.evidence_status.startswith("failed:")
        assert "repair item recorded" not in report.evidence_status

    def test_repeated_failures_append_rather_than_overwrite(self, tmp_path):
        self._fail(tmp_path)
        self._fail(tmp_path)
        lines = [
            line
            for line in evidence_repair_path(str(tmp_path / "ev.json"))
            .read_text("utf-8")
            .splitlines()
            if line.strip()
        ]
        assert len(lines) == 2
        assert all(json.loads(line)["status"] == "evidence_pending" for line in lines)


class TestQuotedUrlInExceptionMessage:
    """The exception message is persisted twice — into the journal's `reason` and
    into the stdout report the cron captures. A URL is routinely *quoted* there."""

    @pytest.mark.parametrize(
        "template",
        [
            "cannot open '{url}'",
            'failed: "{url}"',
            "url={url}, retrying",
            "see ({url}).",
        ],
    )
    def test_a_quoted_url_does_not_reach_the_journal(self, tmp_path, template):
        url = "https://oem.example.test/dl/gs10.pdf?token=SECRETVALUE"
        report = _report()
        report.pdf_url = url
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError(template.format(url=url)),
        ):
            _run(tmp_path, report=report)

        raw = evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8")
        assert "SECRETVALUE" not in raw
        assert "token=" not in raw
        assert "https://oem.example.test/dl/gs10.pdf" in raw
        assert "SECRETVALUE" not in report.evidence_status
