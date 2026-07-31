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
    main,
    replay_evidence_journal,
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


class TestJournalReplay:
    """The journal only RECORDS a gap. `replay_evidence_journal` is what closes it.

    A journal with no production consumer is a to-do list nobody reads: the
    receipt is still missing, and now there is a file that says so forever. These
    tests drive the real public path (and the real CLI), not a reconstruction
    written inside the test — a test that hand-rolls the replay proves only that
    the test can do it.
    """

    def _fail_then(self, tmp_path, **kw):
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path, **kw)
        return tmp_path / "ev.json"

    def _entries(self, snapshot: Path) -> list[dict]:
        raw = evidence_repair_path(str(snapshot)).read_text("utf-8")
        return [json.loads(line) for line in raw.splitlines() if line.strip()]

    def test_replay_turns_a_pending_entry_into_the_two_receipts(self, tmp_path):
        snapshot = self._fail_then(tmp_path, report=_report(chunks=7))
        assert not snapshot.exists()  # the receipt really was lost

        report = replay_evidence_journal(str(snapshot))

        assert (report.replayed, report.blocked, report.pending) == (1, 0, 0)
        assert len(report.dataset_versions) == 2
        assert len(json.loads(snapshot.read_text("utf-8"))["manifests"]) == 2

        # the entry carries its own durable outcome — the journal is not a
        # write-only log of things that went wrong
        (entry,) = self._entries(snapshot)
        assert entry["status"] == "replayed"
        assert entry["dataset_version_ids"] == report.dataset_versions
        assert entry["replayed_at"]

    def test_replay_never_rereads_the_document(self, tmp_path):
        """No download, no OCR, no extraction — and the PDF is *deleted* first.

        Asserting the network/extraction functions were not called is fakeable by
        a stray `pdf_path.read_bytes()`; an absent file is not. Both are checked.
        """
        snapshot = self._fail_then(tmp_path)
        _pdf(tmp_path).unlink()

        with patch("tasks.full_ingest_pipeline._download") as dl, patch(
            "tasks.full_ingest_pipeline.step_extract"
        ) as ex, patch("tasks.full_ingest_pipeline._ocr_extract") as ocr, patch(
            "tasks.full_ingest_pipeline.step_kb_ingest"
        ) as kb:
            report = replay_evidence_journal(str(snapshot))

        assert report.replayed == 1
        assert not dl.called and not ex.called and not ocr.called and not kb.called

    def test_a_second_replay_adds_no_version_and_no_duplicate_receipt(self, tmp_path):
        snapshot = self._fail_then(tmp_path)
        first = replay_evidence_journal(str(snapshot))
        before = snapshot.read_text("utf-8")

        second = replay_evidence_journal(str(snapshot))

        assert (second.replayed, second.already_replayed) == (0, 1)
        assert second.blocked == 0
        assert snapshot.read_text("utf-8") == before  # byte-identical registry
        assert len(json.loads(before)["manifests"]) == 2
        assert len(self._entries(snapshot)) == 1  # no duplicate journal entry
        assert first.dataset_versions and second.dataset_versions == []

    def test_replaying_the_compiled_receipt_twice_is_the_same_version(self, tmp_path):
        """Idempotence at the registry level, not just the journal's status flag:
        forcing the entry back to pending must still not mint a new version."""
        snapshot = self._fail_then(tmp_path)
        first = replay_evidence_journal(str(snapshot))

        journal = evidence_repair_path(str(snapshot))
        entry = self._entries(snapshot)[0]
        entry["status"] = "evidence_pending"
        journal.write_text(json.dumps(entry) + "\n", encoding="utf-8")

        again = replay_evidence_journal(str(snapshot))
        assert again.replayed == 1
        assert again.dataset_versions == first.dataset_versions
        assert len(json.loads(snapshot.read_text("utf-8"))["manifests"]) == 2

    def test_two_pending_entries_both_replay(self, tmp_path):
        snapshot = self._fail_then(tmp_path)
        self._fail_then(tmp_path, report=_report(chunks=3))  # a second, different run

        report = replay_evidence_journal(str(snapshot))
        assert report.replayed == 2
        assert all(e["status"] == "replayed" for e in self._entries(snapshot))

    def test_the_registry_the_entry_names_is_the_one_written(self, tmp_path):
        """The entry's own `registry_path` wins — a document journaled against one
        snapshot must not be repaired into a different one."""
        snapshot = self._fail_then(tmp_path)
        report = replay_evidence_journal(str(tmp_path / "somewhere-else.json"),
                                         journal_path=str(evidence_repair_path(str(snapshot))))
        assert report.replayed == 1
        assert snapshot.exists()
        assert not (tmp_path / "somewhere-else.json").exists()

    def test_no_journal_is_not_an_error(self, tmp_path):
        report = replay_evidence_journal(str(tmp_path / "ev.json"))
        assert (report.total, report.replayed, report.blocked) == (0, 0, 0)
        assert not report.needs_attention

    def test_redaction_survives_replay(self, tmp_path):
        url = "https://oem.example.test/dl/gs10.pdf?token=SECRETVALUE"
        report = _report()
        report.pdf_url = url
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError(f"cannot open '{url}'"),
        ):
            _run(tmp_path, report=report)

        snapshot = tmp_path / "ev.json"
        assert replay_evidence_journal(str(snapshot)).replayed == 1
        for durable in (snapshot, evidence_repair_path(str(snapshot))):
            raw = durable.read_text("utf-8")
            assert "SECRETVALUE" not in raw
            assert "token=" not in raw


class TestJournalReplayRefusals:
    """Nothing is silently discarded — not a bad line, not an unreplayable entry."""

    def _journal(self, tmp_path, *lines: str) -> Path:
        journal = evidence_repair_path(str(tmp_path / "ev.json"))
        journal.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
        return journal

    def test_a_malformed_line_is_preserved_byte_identical(self, tmp_path):
        bad = '{"status": "evidence_pending", TRUNCATED'
        journal = self._journal(tmp_path, bad)

        report = replay_evidence_journal(str(tmp_path / "ev.json"))

        assert (report.malformed, report.total) == (1, 1)
        assert report.needs_attention  # a line we cannot read is a line a human must
        assert journal.read_text("utf-8").splitlines() == [bad]

    def test_a_malformed_line_does_not_stop_the_good_ones(self, tmp_path):
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path)
        good = evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8").strip()
        self._journal(tmp_path, "}not json{", good)

        report = replay_evidence_journal(str(tmp_path / "ev.json"))
        assert (report.replayed, report.malformed) == (1, 1)
        assert "}not json{" in evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8")

    def test_an_entry_with_no_replay_payload_is_blocked_not_dropped(self, tmp_path):
        """`replay: null` means the inputs were never captured — no retry can help."""
        self._journal(tmp_path, json.dumps({
            "schema": "evidence_repair_item/1.0", "status": "evidence_pending",
            "tenant_id": TENANT, "environment": "dev",
            "registry_path": str(tmp_path / "ev.json"), "replay": None,
        }))

        report = replay_evidence_journal(str(tmp_path / "ev.json"))

        assert (report.blocked, report.replayed) == (1, 0)
        entry = json.loads(
            evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8").strip()
        )
        assert entry["status"] == "blocked"
        assert "no replay payload" in entry["blocked_reason"]

    def test_a_corrupt_replay_payload_is_blocked_with_a_reason(self, tmp_path):
        self._journal(tmp_path, json.dumps({
            "schema": "evidence_repair_item/1.0", "status": "evidence_pending",
            "tenant_id": TENANT, "environment": "dev",
            "registry_path": str(tmp_path / "ev.json"),
            "replay": {"source": {"source_uri": "x", "content_sha256": "not-a-sha",
                                  "byte_count": 1, "local_path": "x"},
                       "extraction": {"method": "pdfplumber", "char_count": 1,
                                      "text_sha256": None, "extractor_version": None,
                                      "ocr_requested": False, "size_limit_bytes": None},
                       "materializations": []},
        }))

        report = replay_evidence_journal(str(tmp_path / "ev.json"))

        assert report.blocked == 1
        entry = json.loads(
            evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8").strip()
        )
        assert entry["status"] == "blocked"
        assert "sha256" in entry["blocked_reason"]

    def test_an_unknown_schema_is_blocked(self, tmp_path):
        self._journal(tmp_path, json.dumps({
            "schema": "evidence_repair_item/9.9", "status": "evidence_pending",
        }))
        report = replay_evidence_journal(str(tmp_path / "ev.json"))
        assert report.blocked == 1

    def test_a_transient_failure_stays_pending_for_the_next_run(self, tmp_path):
        """A full disk is not a corrupt entry: it must be retried, not buried."""
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path)

        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("No space left on device"),
        ):
            report = replay_evidence_journal(str(tmp_path / "ev.json"))

        assert (report.pending, report.blocked, report.replayed) == (1, 0, 0)
        assert not report.needs_attention  # retryable — do not fail the operator's run
        entry = json.loads(
            evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8").strip()
        )
        assert entry["status"] == "evidence_pending"
        assert "No space left" in entry["last_replay_error"]

        # …and once the disk is fixed, the very same entry replays
        assert replay_evidence_journal(str(tmp_path / "ev.json")).replayed == 1

    @pytest.mark.parametrize(
        "template",
        ["cannot open '{url}'", 'failed: "{url}"', "url={url}, retrying", "see ({url})."],
    )
    def test_a_transient_failure_reason_is_redacted_too(self, tmp_path, template):
        """`last_replay_error` is a NEW durable surface, and it holds an exception
        message — the shape that already leaked once in this PR (a URL quoted inside
        the prose escaped the per-token scrubber). The journal is exactly as durable
        as the registry, so the same floor applies to a retry reason."""
        url = "https://oem.example.test/dl/gs10.pdf?token=SECRETVALUE"
        report = _report()
        report.pdf_url = url
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path, report=report)

        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError(template.format(url=url)),
        ):
            result = replay_evidence_journal(str(tmp_path / "ev.json"))

        assert result.pending == 1
        raw = evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8")
        assert "SECRETVALUE" not in raw
        assert "token=" not in raw
        assert "https://oem.example.test/dl/gs10.pdf" in raw  # provenance survives
        assert all("SECRETVALUE" not in n for n in result.notes)

    def test_a_blocked_reason_is_redacted_too(self, tmp_path):
        """Same floor on the other durable outcome."""
        url = "https://oem.example.test/dl/gs10.pdf?token=SECRETVALUE"
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path)
        with patch(
            "tasks.full_ingest_pipeline._replay_one",
            side_effect=ValueError(f"bad payload from '{url}'"),
        ):
            assert replay_evidence_journal(str(tmp_path / "ev.json")).blocked == 1

        raw = evidence_repair_path(str(tmp_path / "ev.json")).read_text("utf-8")
        assert "SECRETVALUE" not in raw and "token=" not in raw
        assert json.loads(raw.strip())["status"] == "blocked"


class TestReplayCli:
    """The operator command, executed — flag → dispatch → exit code."""

    def test_the_flag_replays_and_exits_zero(self, tmp_path, capsys):
        with patch(
            "materialized_evidence.document_compiler.write_receipt",
            side_effect=OSError("read-only filesystem"),
        ):
            _run(tmp_path)
        snapshot = tmp_path / "ev.json"

        code = main(["--replay-evidence-journal", str(snapshot)])

        assert code == 0
        assert "1 replayed" in capsys.readouterr().out
        assert len(json.loads(snapshot.read_text("utf-8"))["manifests"]) == 2

    def test_a_blocked_entry_exits_non_zero(self, tmp_path):
        evidence_repair_path(str(tmp_path / "ev.json")).write_text(
            json.dumps({"schema": "evidence_repair_item/1.0", "status": "evidence_pending",
                        "tenant_id": TENANT, "environment": "dev", "replay": None}) + "\n",
            encoding="utf-8",
        )
        assert main(["--replay-evidence-journal", str(tmp_path / "ev.json")]) == 1

    def test_replay_mode_needs_none_of_the_ingest_arguments(self, tmp_path):
        assert main(["--replay-evidence-journal", str(tmp_path / "missing.json")]) == 0

    def test_ingest_mode_still_requires_them(self):
        """`--pdf-url` went `required=False` to make room for the second mode; the
        cron passes it by name, and a missing one must still be an error."""
        with pytest.raises(SystemExit) as exc:
            main(["--manufacturer", "Allen-Bradley", "--model", "1606-XLS"])
        assert exc.value.code == 2


class TestJournalLockIsNotTheRegistryLock:
    """The nesting that made `print_recall`'s wrapper a deadlock.

    `replay_evidence_journal` holds the journal's lock and then calls
    `write_receipt` → `FileRegistry.register`, which takes the registry's. `flock`
    is per-open-file-description, so one shared path would make the process block
    on itself forever. Verified out-of-process too: forcing both onto
    `<snapshot>.lock` hangs, while the shipped pair completes.
    """

    def test_the_two_lock_paths_are_distinct(self, tmp_path):
        from materialized_evidence.backends.file_registry import FileRegistry

        from tasks.full_ingest_pipeline import _journal_lock_path

        snapshot = tmp_path / "ev.json"
        journal_lock = _journal_lock_path(evidence_repair_path(str(snapshot)))
        assert journal_lock != FileRegistry(snapshot)._lock_path
        assert journal_lock.name == "ev.json.repair.jsonl.lock"
