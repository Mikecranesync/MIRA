"""Tests for the Document Evidence Compiler v1 (Charlie's batch-document boundary).

Hermetic: no network, no DB, no clock, no PDF. Every assertion is about the
compiler's honesty invariants — byte identity, truthful extraction provenance, no
invented page coordinates, no self-promotion, no payload text in the registry, and
cross-run determinism (the one that silently breaks durable recall if it regresses).
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from materialized_evidence import (
    ApprovalStatus,
    DatasetType,
    Environment,
    RecallOutcome,
    RecallQuery,
    RecomputeDecision,
    RegistryError,
    StageStatus,
    TrustStatus,
    resolve_recall,
    sha256_bytes,
)
from materialized_evidence.backends.file_registry import FileRegistry
from materialized_evidence.document_compiler import (
    MODE_NONE,
    MODE_OCR,
    MODE_TEXT_LAYER,
    MODE_UNKNOWN,
    DocumentCompilerError,
    DocumentEvidenceReceipt,
    DocumentExtraction,
    DocumentSource,
    MaterializationRef,
    VerifiedPage,
    compile_document_evidence,
    extraction_mode,
    write_receipt,
)

TENANT = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT = "22222222-2222-2222-2222-222222222222"

SECRET_TEXT = "F0004 DC BUS OVERVOLTAGE — proprietary customer procedure, do not copy"


def _source(body: bytes = b"%PDF-1.7 real bytes") -> DocumentSource:
    return DocumentSource(
        source_uri="https://example.test/manuals/gs10.pdf",
        content_sha256=sha256_bytes(body),
        byte_count=len(body),
        local_path="/opt/mira/manuals/AutomationDirect/GS10/gs10.pdf",
    )


def _extraction(method: str = "pdfplumber", **kw) -> DocumentExtraction:
    base = {
        "method": method,
        "char_count": len(SECRET_TEXT),
        "text_sha256": sha256_bytes(SECRET_TEXT.encode()),
    }
    base.update(kw)
    return DocumentExtraction(**base)


def _compile(**kw) -> DocumentEvidenceReceipt:
    args = {"source": _source(), "extraction": _extraction(), "tenant_id": TENANT}
    args.update(kw)
    return compile_document_evidence(**args)


# ── determinism & identity ───────────────────────────────────────────────────


class TestDeterminism:
    def test_byte_identical_input_is_byte_identical_output(self):
        a, b = _compile(), _compile()
        assert a.dataset_version_ids == b.dataset_version_ids
        for ma, mb in zip(a.manifests, b.manifests, strict=True):
            assert ma.manifest_hash == mb.manifest_hash
            assert ma.content_hash == mb.content_hash
            assert ma.to_dict() == mb.to_dict()

    def test_no_wallclock_or_cost_field_is_set(self):
        """These feed manifest_hash — a value here would re-hash the same dataset
        version on every run and permanently break durable recall."""
        for m in _compile().manifests:
            assert m.created_at is None
            assert m.wall_time_ms is None
            assert m.compute_time_ms is None
            assert m.provider_cost_usd is None
        for r in _compile().extraction_records:
            assert r.created_at is None and r.updated_at is None

    def test_record_ids_are_derived_not_random(self):
        a, b = _compile(), _compile()
        ids = [r.record_id for r in a.page_identity_records + a.extraction_records]
        assert ids == [r.record_id for r in b.page_identity_records + b.extraction_records]
        assert all(
            r.record_id.startswith(_source().content_sha256[:16]) for r in a.extraction_records
        )

    def test_changed_source_bytes_changes_receipt_identity(self):
        base = _compile()
        changed = _compile(source=_source(b"%PDF-1.7 DIFFERENT bytes"))
        assert changed.dataset_version_ids != base.dataset_version_ids
        assert changed.extraction_manifest.content_hash != base.extraction_manifest.content_hash

    @pytest.mark.parametrize(
        "override",
        [
            {"method": "pypdf"},
            {"ocr_requested": True},
            {"extractor_version": "pdfplumber-0.11.4"},
            {"size_limit_bytes": 1024},
        ],
    )
    def test_changed_extraction_configuration_changes_receipt_identity(self, override):
        base = _compile()
        changed = _compile(extraction=_extraction(**override))
        assert (
            changed.extraction_manifest.dataset_version_id
            != base.extraction_manifest.dataset_version_id
        )
        # the config hash is shared, so page identity re-versions too
        assert (
            changed.page_identity_manifest.dataset_version_id
            != base.page_identity_manifest.dataset_version_id
        )

    def test_tenant_and_environment_are_in_the_version_key(self):
        """Two tenants ingesting the same bytes must not collide on one registry key."""
        a = _compile()
        assert _compile(tenant_id=OTHER_TENANT).dataset_version_ids != a.dataset_version_ids
        assert (
            _compile(environment=Environment.STAGING).dataset_version_ids != a.dataset_version_ids
        )


# ── truthful extraction provenance ───────────────────────────────────────────


class TestExtractionProvenance:
    def test_mode_mapping_is_total_and_never_defaults_to_text_layer(self):
        assert extraction_mode("pdfplumber") == MODE_TEXT_LAYER
        assert extraction_mode("pypdf") == MODE_TEXT_LAYER
        assert extraction_mode("tika_ocr") == MODE_OCR
        assert extraction_mode("pypdf (empty)") == MODE_TEXT_LAYER
        assert extraction_mode("failed") == MODE_NONE
        assert extraction_mode("skip (>50 MB)") == MODE_NONE
        for unknown in ("", "  ", "docling", "gpt-vision", "mystery (empty)"):
            assert extraction_mode(unknown) == MODE_UNKNOWN

    def test_text_layer_parse_is_never_labelled_ocr(self):
        rec = _compile(extraction=_extraction("pdfplumber")).extraction_records[0]
        assert rec.payload["extraction_method"] == "pdfplumber"
        assert rec.payload["extraction_mode"] == MODE_TEXT_LAYER
        assert rec.payload["is_ocr"] is False
        gaps = " ".join(
            _compile(extraction=_extraction("pdfplumber")).extraction_manifest.known_gaps
        )
        assert "not OCR" in gaps and "pdfplumber" in gaps

    def test_tika_ocr_is_labelled_ocr_and_carries_no_not_ocr_gap(self):
        receipt = _compile(extraction=_extraction("tika_ocr", ocr_requested=True))
        rec = receipt.extraction_records[0]
        assert rec.payload["extraction_method"] == "tika_ocr"
        assert rec.payload["extraction_mode"] == MODE_OCR
        assert rec.payload["is_ocr"] is True
        assert not any("not OCR" in g for g in receipt.extraction_manifest.known_gaps)

    def test_unavailable_extractor_version_is_unknown_not_guessed(self):
        receipt = _compile(extraction=_extraction(extractor_version=None))
        assert receipt.extraction_records[0].payload["extractor_version"] is None
        assert any("not reported" in g for g in receipt.extraction_manifest.known_gaps)

        known = _compile(extraction=_extraction(extractor_version="pypdf-5.1.0"))
        assert known.extraction_records[0].payload["extractor_version"] == "pypdf-5.1.0"
        assert not any("not reported" in g for g in known.extraction_manifest.known_gaps)

    def test_failed_extraction_stays_failed_and_claims_no_materialization(self):
        receipt = _compile(extraction=_extraction("failed", char_count=0, text_sha256=None))
        m = receipt.extraction_manifest
        assert m.stage_status is StageStatus.FAILED
        assert (
            m.index_refs == []
        )  # a receipt must never claim a materialization that does not exist
        assert m.completeness is None
        assert any("produced no text" in g for g in m.known_gaps)

    def test_skipped_extraction_is_cancelled_not_failed(self):
        receipt = _compile(extraction=_extraction("skip (>50 MB)", char_count=0, text_sha256=None))
        assert receipt.extraction_manifest.stage_status is StageStatus.CANCELLED

    def test_materializations_are_referenced_not_copied(self):
        receipt = _compile(
            materializations=[
                MaterializationRef("knowledge_entries", f"sha256:{sha256_bytes(b'x')}", 42),
                MaterializationRef("text_sidecar", "/opt/mira/manuals/x.txt"),
            ]
        )
        assert receipt.extraction_manifest.index_refs == [
            f"knowledge_entries:sha256:{sha256_bytes(b'x')}#records=42",
            "text_sidecar:/opt/mira/manuals/x.txt",
        ]


# ── page identity: never fabricated ──────────────────────────────────────────


class TestPageIdentity:
    def test_no_verified_pages_means_document_scope_and_no_page_coordinate(self):
        receipt = _compile()
        m = receipt.page_identity_manifest
        assert m.page_or_segment_scope == "document"
        # a numeric completeness here would let a page-level recall query reuse
        # evidence that has no page identity (resolver gate 3)
        assert m.completeness is None
        assert any("page identity not supplied" in g for g in m.known_gaps)

        assert len(receipt.page_identity_records) == 1
        payload = receipt.page_identity_records[0].payload
        assert payload["scope"] == "document"
        assert payload["page_identity_available"] is False
        assert payload["page_count"] is None
        assert "page_number" not in payload

    def test_verified_pages_produce_page_level_records(self):
        pages = [
            VerifiedPage(page_number=2, char_count=10, text_sha256=sha256_bytes(b"p2")),
            VerifiedPage(page_number=1, char_count=20, text_sha256=sha256_bytes(b"p1")),
        ]
        receipt = _compile(verified_pages=pages)
        m = receipt.page_identity_manifest
        assert m.page_or_segment_scope == "pages:1-2"
        assert m.known_gaps == []
        nums = [r.payload["page_number"] for r in receipt.page_identity_records]
        assert nums == [1, 2]  # ordered, so content_hash is order-independent
        assert receipt.page_identity_records[0].source_locator.endswith("#page=1")
        assert all(
            r.payload["page_identity_source"] == "extractor_verified"
            for r in receipt.page_identity_records
        )

    def test_extraction_dataset_descends_from_page_identity(self):
        receipt = _compile()
        assert receipt.extraction_manifest.parent_dataset_versions == [
            receipt.page_identity_manifest.dataset_version_id
        ]


# ── safety invariants ────────────────────────────────────────────────────────


class TestSafetyInvariants:
    def test_everything_is_candidate_and_pending(self):
        receipt = _compile()
        for m in receipt.manifests:
            assert m.trust_status is TrustStatus.CANDIDATE
            assert m.approval_status is ApprovalStatus.PENDING
            assert m.approval_refs == []
        for r in receipt.page_identity_records + receipt.extraction_records:
            assert r.status is TrustStatus.CANDIDATE

    def test_self_promotion_is_rejected_by_the_compiler_boundary(self):
        """A caller cannot smuggle a promoted receipt through ``_finalize``."""
        from materialized_evidence.document_compiler import _finalize

        receipt = _compile()
        promoted = dataclasses.replace(
            receipt.extraction_manifest,
            dataset_version_id="",  # derived by _finalize
            trust_status=TrustStatus.TRUSTED,
            approval_refs=["forged"],
        )
        with pytest.raises(DocumentCompilerError, match="candidate"):
            _finalize(promoted, list(receipt.extraction_records))

    def test_a_caller_cannot_preset_the_version_id(self):
        from materialized_evidence.document_compiler import _finalize

        receipt = _compile()
        with pytest.raises(DocumentCompilerError, match="derived from content"):
            _finalize(receipt.extraction_manifest, list(receipt.extraction_records))

    def test_source_sha_is_byte_identity_only_never_lineage_or_rights(self):
        receipt = _compile()
        sha = _source().content_sha256
        blob = json.dumps(
            [m.to_dict() for m in receipt.manifests]
            + [r.to_dict() for r in receipt.page_identity_records + receipt.extraction_records]
        )
        assert sha in blob  # preserved as byte identity …
        # … but it never becomes corpus lineage, training lineage, or a rights grant
        for banned in (
            "document_lineage_key",
            "training",
            "rights",
            "license_grant",
            "reuse_approved",
        ):
            assert banned not in blob
        for m in receipt.manifests:
            assert m.approval_refs == []

    def test_no_document_or_ocr_text_reaches_the_registry_snapshot(self, tmp_path):
        snapshot = tmp_path / "evidence.json"
        receipt = _compile(extraction=_extraction("tika_ocr"))
        write_receipt(receipt, FileRegistry(snapshot))

        raw = snapshot.read_text("utf-8")
        assert SECRET_TEXT not in raw
        for word in ("OVERVOLTAGE", "proprietary", "procedure"):
            assert word not in raw
        # Stronger than "no text": FileRegistry persists manifests + overlays only,
        # so no EvidenceRecord payload reaches disk at all. It is a receipt store,
        # not a second content store.
        assert set(json.loads(raw)) == {"manifests", "overlays"}
        assert sha256_bytes(SECRET_TEXT.encode()) not in raw
        # the text hash lives on the in-memory record as a pointer to the real text
        assert receipt.extraction_records[0].payload["text_sha256"] == sha256_bytes(
            SECRET_TEXT.encode()
        )

    def test_records_never_carry_document_text(self):
        receipt = _compile()
        for r in receipt.page_identity_records + receipt.extraction_records:
            assert SECRET_TEXT not in json.dumps(r.payload)

    def test_tenant_id_and_byte_identity_are_required(self):
        with pytest.raises(DocumentCompilerError, match="tenant_id"):
            _compile(tenant_id="")
        with pytest.raises(DocumentCompilerError, match="content_sha256"):
            _compile(source=dataclasses.replace(_source(), content_sha256=""))


# ── registry round-trip (the durable-recall path) ────────────────────────────


class TestUriRedaction:
    """A manifest is durable, and a download URL is routinely a credential."""

    PRESIGNED = (
        "https://oem-portal.example.test/dl/gs10.pdf"
        "?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=900"
    )

    def test_a_presigned_url_never_reaches_the_manifest(self):
        receipt = _compile(
            source=DocumentSource(
                source_uri=self.PRESIGNED,
                content_sha256=sha256_bytes(b"pdf"),
                byte_count=3,
            )
        )
        for m in receipt.manifests:
            assert m.source_objects == ["https://oem-portal.example.test/dl/gs10.pdf"]
            assert "X-Amz-Signature" not in json.dumps(m.to_dict())

    def test_userinfo_credentials_are_stripped(self):
        receipt = _compile(
            source=DocumentSource(
                source_uri="https://svc:hunter2@mirror.example.test/a/gs10.pdf#p=4",
                content_sha256=sha256_bytes(b"pdf"),
                byte_count=3,
            )
        )
        assert receipt.extraction_manifest.source_objects == [
            "https://mirror.example.test/a/gs10.pdf"
        ]
        assert "hunter2" not in json.dumps(receipt.extraction_manifest.to_dict())

    def test_a_secret_bearing_url_does_not_survive_into_the_durable_snapshot(self, tmp_path):
        """The end-to-end claim: nothing a fetch URL carried is recoverable from disk."""
        snapshot = tmp_path / "evidence.json"
        write_receipt(
            _compile(
                source=DocumentSource(
                    source_uri=self.PRESIGNED,
                    content_sha256=sha256_bytes(b"pdf"),
                    byte_count=3,
                    local_path="/opt/mira/manuals/x.pdf",
                )
            ),
            FileRegistry(snapshot),
        )
        raw = snapshot.read_text("utf-8")
        assert "deadbeefcafe" not in raw
        assert "X-Amz-Signature" not in raw
        assert "oem-portal.example.test/dl/gs10.pdf" in raw  # provenance survives

    def test_the_validator_is_the_floor_beneath_the_compiler(self):
        """Redaction at the producer is not the only defence: a manifest carrying an
        unredacted URI is rejected at ``register`` no matter which producer built it."""
        from materialized_evidence import validate_manifest

        m = dataclasses.replace(
            _compile().extraction_manifest,
            source_objects=["https://h.example.test/m.pdf?token=abc"],
        )
        assert any("unredacted network URI" in p for p in validate_manifest(m))

    def test_a_url_embedded_in_a_composite_locator_is_caught(self):
        """The actual leak shape: ``knowledge_entries:<url>#records=7``. ``urlsplit``
        reads that string's scheme as ``knowledge_entries``, so a whole-value parse
        calls it clean while a live token sits in the middle."""
        with pytest.raises(DocumentCompilerError, match="unredacted network URI"):
            _compile(
                materializations=[
                    MaterializationRef(
                        "knowledge_entries", "source_url=https://h.example.test/m.pdf?token=abc", 7
                    )
                ]
            )

    @pytest.mark.parametrize(
        "message",
        [
            "cannot open 'https://h.example.test/m.pdf?token=SECRET'",
            'failed: "https://h.example.test/m.pdf?token=SECRET"',
            "url=https://h.example.test/m.pdf?token=SECRET, retrying",
            "see (https://h.example.test/m.pdf?token=SECRET).",
            "fetching https://h.example.test/m.pdf?token=SECRET",
            "<https://h.example.test/m.pdf?token=SECRET>",
        ],
    )
    def test_a_url_quoted_inside_free_text_is_scrubbed(self, message):
        """Prose that gets persisted (an exception message copied into the repair
        journal) needs a regex, not a split on spaces: a quoted or comma-trailed URL
        does not parse as a URI, so a per-token pass returns it untouched — a leak."""
        from materialized_evidence import scrub_text_uris

        out = scrub_text_uris(message)
        assert "SECRET" not in out
        assert "token=" not in out
        assert "https://h.example.test/m.pdf" in out  # the origin+path survives

    def test_scrubbing_free_text_leaves_non_url_prose_alone(self):
        from materialized_evidence import scrub_text_uris

        for benign in ("", "read-only filesystem", "sha256:deadbeef#page=2", "a:b://c"):
            assert scrub_text_uris(benign) == benign

    def test_opaque_contract_locators_pass_through_byte_identical(self):
        """The contract's own locators use ``#`` structurally and feed content_hash —
        redaction must not touch them."""
        from materialized_evidence import redact_uri, uri_leaks_credentials

        for opaque in (
            "knowledge_entries:sha256:deadbeef#records=7",
            "sha256:deadbeef#page=12",
            "cas://printsense/deadbeef",
            "/opt/mira/manuals/AutomationDirect/GS10/gs10.pdf",
        ):
            assert redact_uri(opaque) == opaque
            assert uri_leaks_credentials(opaque) is False


class TestInputValidation:
    """Malformed caller input is a contract violation, rejected before it is durable.
    (A failed *extraction* is not — that is legitimate evidence.)"""

    def _page(self, n=1, chars=10, sha=None):
        return VerifiedPage(n, chars, sha if sha is not None else sha256_bytes(f"p{n}".encode()))

    def test_duplicate_page_numbers_are_rejected(self):
        """Two pages numbered 3 collide on one record_id (``{sha}:page:00003``): the
        dataset would silently hold one record where the caller believed it had two."""
        with pytest.raises(DocumentCompilerError, match="duplicate verified page 3"):
            _compile(verified_pages=[self._page(3), self._page(3, chars=99)])

    @pytest.mark.parametrize("bad", [0, -1, -12])
    def test_non_positive_page_numbers_are_rejected(self, bad):
        with pytest.raises(DocumentCompilerError, match="1-based and positive"):
            _compile(verified_pages=[self._page(bad)])

    def test_negative_page_char_count_is_rejected(self):
        with pytest.raises(DocumentCompilerError, match="char_count must be non-negative"):
            _compile(verified_pages=[self._page(1, chars=-5)])

    @pytest.mark.parametrize("bad", ["", "not-a-hash", "ABCDEF" * 10 + "ABCD", "deadbeef"])
    def test_malformed_page_hash_is_rejected(self, bad):
        with pytest.raises(DocumentCompilerError, match="fabricated claim"):
            _compile(verified_pages=[self._page(1, sha=bad)])

    def test_valid_pages_still_compile(self):
        """The negative control: validation must not reject legitimate page identity."""
        receipt = _compile(verified_pages=[self._page(1), self._page(2), self._page(7)])
        # NOT "pages:1-7" — pages 3-6 were never verified (see TestNonContiguousPages).
        assert receipt.page_identity_manifest.page_or_segment_scope == "pages:1-2,7"
        assert len(receipt.page_identity_records) == 3
        assert len({r.record_id for r in receipt.page_identity_records}) == 3

    @pytest.mark.parametrize("bad", ["", "not-hex", "abc123"])
    def test_malformed_document_hash_is_rejected(self, bad):
        with pytest.raises(DocumentCompilerError, match="sha256|byte identity"):
            _compile(source=dataclasses.replace(_source(), content_sha256=bad))

    def test_negative_counts_are_rejected(self):
        with pytest.raises(DocumentCompilerError, match="byte_count must be non-negative"):
            _compile(source=dataclasses.replace(_source(), byte_count=-1))
        with pytest.raises(DocumentCompilerError, match="char_count must be non-negative"):
            _compile(extraction=_extraction(char_count=-1))

    def test_malformed_text_hash_is_rejected(self):
        with pytest.raises(DocumentCompilerError, match="text_sha256"):
            _compile(extraction=_extraction(text_sha256="nope"))


class TestRegistryRoundTrip:
    def test_reingesting_the_same_document_is_idempotent(self, tmp_path):
        """Re-ingest must not raise: the version key excludes wall-clock/cost, so
        the same inputs produce the same manifest_hash and ``register`` is a no-op.
        A regression here is swallowed by the pipeline's fail-open path and silently
        disables recall forever."""
        snapshot = tmp_path / "evidence.json"
        first = write_receipt(_compile(), FileRegistry(snapshot))

        # same process, then a fresh instance hydrating from the snapshot on disk
        second = write_receipt(_compile(), FileRegistry(snapshot))
        third = write_receipt(_compile(), FileRegistry(snapshot))
        assert first == second == third

        hydrated = FileRegistry(snapshot)
        assert len(hydrated.find(tenant_id=TENANT, dataset_type=DatasetType.OCR)) == 1
        assert len(hydrated.find(tenant_id=TENANT, dataset_type=DatasetType.PAGE_IDENTITY)) == 1

    def test_same_bytes_from_a_different_url_does_not_wedge_the_registry(self, tmp_path):
        """Regression, caught end-to-end 2026-07-30.

        Re-ingesting one PDF from a different URL (CDN change, mirror, http→https)
        or on a different host (``MANUALS_ROOT``) previously produced the SAME
        ``dataset_version_id`` with a DIFFERENT ``manifest_hash``
        → ``immutable version conflict`` → swallowed by the lane's fail-open path →
        recall silently dead forever. The version key now covers every varying
        manifest field, so this is a new version rather than a conflict.
        """
        body = b"%PDF-1.7 identical bytes"
        mirrored = DocumentSource(
            source_uri="https://mirror.example.test/gs10.pdf?token=abc",
            content_sha256=sha256_bytes(body),
            byte_count=len(body),
            local_path="/var/other-host/manuals/gs10.pdf",
        )
        snapshot = tmp_path / "evidence.json"
        first = _compile(source=_source(body))
        write_receipt(first, FileRegistry(snapshot))

        second = _compile(source=mirrored)  # must NOT raise
        write_receipt(second, FileRegistry(snapshot))

        # the mirror's `?token=abc` is provenance-irrelevant AND a credential: the
        # origin+path survives, the token does not reach the durable snapshot
        assert second.extraction_manifest.source_objects[0] == (
            "https://mirror.example.test/gs10.pdf"
        )
        assert "token=abc" not in snapshot.read_text("utf-8")

        # byte identity still groups them: one dataset series, matched on source_hashes
        assert first.extraction_manifest.dataset_id == second.extraction_manifest.dataset_id
        assert first.extraction_manifest.source_hashes == second.extraction_manifest.source_hashes
        assert (
            first.extraction_manifest.dataset_version_id
            != second.extraction_manifest.dataset_version_id
        )
        # …and the payload is identical, so a later recall picks one instead of
        # reporting a conflict (record locators are content-addressed, not URLs)
        assert first.extraction_manifest.content_hash == second.extraction_manifest.content_hash
        assert first.extraction_records[0].source_locator == f"sha256:{sha256_bytes(body)}"

        registry = FileRegistry(snapshot)
        found = registry.find(
            tenant_id=TENANT,
            dataset_type=DatasetType.OCR,
            source_hashes=[sha256_bytes(body)],
        )
        assert len(found) == 2

        # The claim the docs make about this situation, actually executed: two
        # versions with an identical content_hash must let the resolver SELECT one,
        # not report CONFLICTING (`resolver.py` conflicts on distinct content
        # hashes). Asserted rather than reasoned about, because NORTH_STAR.md and
        # docs/architecture/materialized-evidence.md both state it.
        result = resolve_recall(
            RecallQuery(
                tenant_id=TENANT,
                dataset_type=DatasetType.OCR,
                source_hashes=[sha256_bytes(body)],
            ),
            registry,
        )
        assert result.outcome is RecallOutcome.EXACT, result.reason
        assert result.recompute_decision is RecomputeDecision.REUSED_EXACT
        assert len(result.selected_versions) == 1

    def test_record_locators_are_content_addressed_not_urls(self):
        receipt = _compile()
        sha = _source().content_sha256
        for r in receipt.page_identity_records + receipt.extraction_records:
            assert r.source_locator.startswith(f"sha256:{sha}")
            assert "example.test" not in r.source_locator
        # the fetch URL survives as manifest provenance
        assert "https://example.test/manuals/gs10.pdf" in receipt.extraction_manifest.source_objects

    def test_reextraction_under_new_config_adds_a_version_it_does_not_overwrite(self, tmp_path):
        snapshot = tmp_path / "evidence.json"
        write_receipt(_compile(extraction=_extraction("pypdf")), FileRegistry(snapshot))
        write_receipt(_compile(extraction=_extraction("tika_ocr")), FileRegistry(snapshot))

        registry = FileRegistry(snapshot)
        found = registry.find(tenant_id=TENANT, dataset_type=DatasetType.OCR)
        assert len(found) == 2  # two versions, neither overwritten
        assert len({f.dataset_id for f in found}) == 1  # one dataset series
        assert len({f.dataset_version_id for f in found}) == 2

        # the snapshot holds manifests + overlays only — it is not a content store
        data = json.loads(snapshot.read_text("utf-8"))
        assert set(data) == {"manifests", "overlays"}
        assert "payload" not in snapshot.read_text("utf-8")

    def test_tenant_isolation_survives_identical_bytes(self, tmp_path):
        snapshot = tmp_path / "evidence.json"
        write_receipt(_compile(), FileRegistry(snapshot))
        write_receipt(_compile(tenant_id=OTHER_TENANT), FileRegistry(snapshot))

        registry = FileRegistry(snapshot)
        assert len(registry.find(tenant_id=TENANT, dataset_type=DatasetType.OCR)) == 1
        assert len(registry.find(tenant_id=OTHER_TENANT, dataset_type=DatasetType.OCR)) == 1

    def test_a_forged_conflicting_version_is_still_rejected(self, tmp_path):
        """Immutability (ADR A3) is not weakened by determinism."""
        snapshot = tmp_path / "evidence.json"
        receipt = _compile()
        registry = FileRegistry(snapshot)
        write_receipt(receipt, registry)

        forged = dataclasses.replace(receipt.extraction_manifest, record_count=999)
        from materialized_evidence import with_hashes

        forged = with_hashes(forged, list(receipt.extraction_records))
        forged = dataclasses.replace(forged, manifest_hash="deadbeef")
        with pytest.raises(RegistryError, match="immutable version conflict"):
            registry.register(forged)


# ── non-contiguous verified pages ────────────────────────────────────────────


class TestNonContiguousPages:
    """Pages 1 and 3 are NOT "pages 1-3".

    A bare min-max scope on a gapped page set asserts coverage of pages the
    extractor never verified — the same fabrication the no-pages branch refuses
    to commit, arriving through a different door. Scope enumerates the real runs
    and `known_gaps` names what is absent.
    """

    def _page(self, n: int) -> VerifiedPage:
        return VerifiedPage(
            page_number=n, char_count=10 * n, text_sha256=sha256_bytes(f"p{n}".encode())
        )

    def test_a_gapped_page_set_never_claims_the_whole_span(self):
        receipt = _compile(verified_pages=[self._page(1), self._page(3)])
        m = receipt.page_identity_manifest

        assert m.page_or_segment_scope == "pages:1,3"
        assert m.page_or_segment_scope != "pages:1-3"
        assert any("NON-CONTIGUOUS" in g for g in m.known_gaps)
        assert any("2" in g for g in m.known_gaps)  # the absent page is named
        # only the verified pages exist as records — page 2 is not invented
        assert {r.payload["page_number"] for r in receipt.page_identity_records} == {1, 3}

    def test_a_contiguous_page_set_still_reads_as_a_range(self):
        """The negative control: the common case must not become noisy."""
        receipt = _compile(verified_pages=[self._page(n) for n in (1, 2, 3)])
        assert receipt.page_identity_manifest.page_or_segment_scope == "pages:1-3"
        assert receipt.page_identity_manifest.known_gaps == []

    def test_runs_are_collapsed_and_bounded(self):
        """`known_gaps` and the scope both feed `manifest_hash`, so neither may
        grow with the size of the gap: pages {1, 5000} must not emit 4998 entries."""
        receipt = _compile(verified_pages=[self._page(1), self._page(5000)])
        m = receipt.page_identity_manifest
        assert m.page_or_segment_scope == "pages:1,5000"
        assert len(m.known_gaps) == 1
        assert len(m.known_gaps[0]) < 400
        assert "2-4999" in m.known_gaps[0]  # the run, not 4998 numbers

    def test_many_scattered_pages_elide_rather_than_grow_without_bound(self):
        odd = [self._page(n) for n in range(1, 60, 2)]  # 30 one-page runs
        m = _compile(verified_pages=odd).page_identity_manifest
        assert "more" in m.page_or_segment_scope  # elided, and says so
        assert len(m.page_or_segment_scope) < 120
        assert len(m.known_gaps[0]) < 400
        assert len(_compile(verified_pages=odd).page_identity_records) == 30

    def test_page_completeness_is_still_unknown_not_asserted(self):
        """The compiler is never told the document's page COUNT, so it cannot know
        whether even a contiguous run is full coverage. Unknown stays unknown."""
        for pages in ([self._page(1), self._page(2)], [self._page(1), self._page(3)]):
            assert _compile(verified_pages=pages).page_identity_manifest.completeness is None


# ── the contract: a page-incomplete receipt cannot satisfy a page-complete query ──


class TestPageCompleteRecallContract:
    """End-to-end, through the real registry and the real resolver.

    The compiler leaves `completeness` None so a page-level query cannot mistake
    a document-scoped receipt for full page coverage. That intent is only real if
    the resolver honors it — before the gate-3 fix it did not, and a document with
    no page identity at all resolved as REUSED_EXACT for a `required_completeness
    = 1.0` query.
    """

    def _promoted(self, receipt, registry):
        """Register the page-identity manifest as trusted+approved.

        Promotion happens HERE, in the fixture, not in the compiler: the compiler
        must never self-promote (rule 9 / ADR-0017). It is required only because
        gate 5 would otherwise reject the candidate first, and then this test
        would pass without ever reaching the completeness gate. Re-hashed after
        the replace, or gate 6 rejects it as corrupt for the same reason.
        """
        from materialized_evidence import with_hashes

        promoted = dataclasses.replace(
            receipt.page_identity_manifest,
            trust_status=TrustStatus.TRUSTED,
            approval_status=ApprovalStatus.APPROVED,
            approval_refs=["ai_suggestions:1"],
        )
        promoted = with_hashes(promoted, list(receipt.page_identity_records))
        registry.register(promoted)
        return promoted

    def _query(self, sha, **over):
        base = dict(
            tenant_id=TENANT,
            dataset_type=DatasetType.PAGE_IDENTITY,
            source_hashes=[sha],
            allowed_trust_states=[TrustStatus.TRUSTED],
        )
        base.update(over)
        return RecallQuery(**base)

    def test_a_receipt_with_no_verified_pages_cannot_satisfy_a_page_complete_query(
        self, tmp_path
    ):
        body = b"%PDF-1.7 no page identity available"
        sha = sha256_bytes(body)
        registry = FileRegistry(tmp_path / "evidence.json")
        self._promoted(_compile(source=_source(body), verified_pages=None), registry)

        result = resolve_recall(self._query(sha, required_completeness=1.0), registry)
        assert result.recompute_decision is RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
        assert result.outcome is RecallOutcome.NONE

        # The counterfactual that proves gate 3 — not gate 5 or gate 6 — rejected
        # it: the SAME manifest is fully reusable when no completeness is required.
        unconstrained = resolve_recall(self._query(sha), registry)
        assert unconstrained.recompute_decision is RecomputeDecision.REUSED_EXACT, (
            unconstrained.reason
        )

    def test_a_gapped_page_receipt_cannot_satisfy_a_page_complete_query_either(
        self, tmp_path
    ):
        """Pages 1 and 3 verified: the scope says so, and the recall gate agrees."""
        body = b"%PDF-1.7 pages one and three"
        sha = sha256_bytes(body)
        pages = [
            VerifiedPage(page_number=n, char_count=10, text_sha256=sha256_bytes(f"p{n}".encode()))
            for n in (1, 3)
        ]
        registry = FileRegistry(tmp_path / "evidence.json")
        promoted = self._promoted(
            _compile(source=_source(body), verified_pages=pages), registry
        )
        assert promoted.page_or_segment_scope == "pages:1,3"

        result = resolve_recall(self._query(sha, required_completeness=1.0), registry)
        assert result.recompute_decision is RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
        assert (
            resolve_recall(self._query(sha), registry).recompute_decision
            is RecomputeDecision.REUSED_EXACT
        )
