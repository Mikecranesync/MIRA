"""Document Evidence Compiler v1 — batch documents → candidate evidence receipts.

The first working *consumer* of the Materialized Evidence contract (ADR-0029).
Given a document that has **already** been downloaded and extracted, this module
compiles two typed, content-addressed, ``candidate`` receipts:

1. a **Page Identity** dataset (``DatasetType.PAGE_IDENTITY``) — byte identity of
   the document, plus page-level records **only** when the caller supplies pages
   the extractor actually verified;
2. an **extraction** dataset (``DatasetType.OCR``) — what the extractor actually
   did, with the real method preserved verbatim.

A receipt is a **pointer, not a document store.** It carries hashes, counts,
methods, and references to where the text already lives (``knowledge_entries``,
the raw PDF, a ``.txt`` sidecar). It never carries PDF bytes, extracted text, OCR
text, tenant chunk contents, or secrets.

Why ``DatasetType.OCR`` for a text-layer parse
----------------------------------------------
The controlled vocabulary in ``schema.py`` names one extracted-text stage, and
this module uses the **existing** vocabulary rather than forking it. That makes
the type name a *stage* label, not a claim about how the text was obtained — so
the honest distinction is carried explicitly and unmissably instead:

- ``schema_name`` is ``document_text_extraction`` (never ``..._ocr``);
- every record payload carries ``extraction_method`` verbatim (``pdfplumber``,
  ``pypdf``, ``tika_ocr``, …), a derived ``extraction_mode``
  (``text_layer`` | ``ocr`` | ``none`` | ``unknown``), and an explicit
  ``is_ocr`` boolean;
- a non-OCR dataset records a ``known_gaps`` entry saying so in words.

**A text-layer parse is never described as OCR.** See
``docs/architecture/materialized-evidence.md`` § "First vertical flow".

What this module deliberately does NOT do
-----------------------------------------
- **No recall/skip decision.** It never calls ``resolve_recall``; it cannot cause
  an extraction to be skipped. Writing a receipt is purely additive.
- **No promotion.** Trust stays ``candidate`` and approval stays ``pending``
  (rule 9 / ADR-0017). ``_finalize`` raises rather than emit anything else.
- **No page fabrication.** A markdown-heading count is not page provenance. With
  no verified pages the Page Identity dataset is **document-scoped**, declares
  the gap, and leaves ``completeness`` ``None`` — so a future page-level recall
  query cannot mistake it for full page coverage.
- **No lineage promotion.** The source SHA is byte identity only. It is not a
  ``document_lineage_key``, not training lineage, not a rights approval, and not
  permission to reuse customer material.

Determinism
-----------
Identical inputs produce byte-identical manifests. This matters more than it looks:
``manifest_hash`` covers every manifest field except the two hash fields, and the
registry rejects a re-register of one ``dataset_version_id`` carrying a different
``manifest_hash`` (ADR A3). So anything that varies between runs but is missing from
the version key yields a *permanent* immutability conflict — swallowed by the
caller's fail-open path, invisible to a fresh-registry test, and recall silently
dead. Two defences:

1. clock/cost fields stay ``None`` (``_DETERMINISM_MUST_BE_UNSET`` enforces it) and
   are reported by the caller instead;
2. ``dataset_version_id`` is **derived from the manifest's own content**
   (``_with_version_id``), so legitimately-varying provenance — the fetch URL, the
   per-host local path — produces a new *version* rather than a conflict.

Record ids are derived from ``(source_sha, stage)``, never random, and record
locators are content-addressed rather than URL-addressed (``_source_locator``).

Stdlib only — no new dependencies, no I/O of its own.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from .hashing import canonical_json, content_hash, record_hash, sha256_bytes, with_hashes
from .registry import MaterializationRegistry
from .schema import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    StageStatus,
    TrustStatus,
    validate_manifest,
)

COMPILER_NAME = "document_evidence_compiler"
COMPILER_VERSION = "1.0.0"

PAGE_IDENTITY_SCHEMA = ("document_page_identity", "1.0")
TEXT_EXTRACTION_SCHEMA = ("document_text_extraction", "1.0")

# ── extraction-mode vocabulary ───────────────────────────────────────────────
# The mapping is TOTAL and never defaults to a text-layer claim: an unrecognised
# method is "unknown", so a new extractor cannot silently inherit either label.

MODE_TEXT_LAYER = "text_layer"
MODE_OCR = "ocr"
MODE_NONE = "none"
MODE_UNKNOWN = "unknown"

_METHOD_MODES = {
    "pdfplumber": MODE_TEXT_LAYER,
    "pypdf": MODE_TEXT_LAYER,
    "tika_ocr": MODE_OCR,
}

# Manifest fields that would break cross-run determinism if set (see § Determinism).
_DETERMINISM_MUST_BE_UNSET = (
    "created_at",
    "wall_time_ms",
    "queue_time_ms",
    "compute_time_ms",
    "provider_cost_usd",
    "internal_cost_estimate_usd",
)


class DocumentCompilerError(Exception):
    """A contract violation while compiling a receipt (never raised for a failed
    *extraction* — a failed extraction is valid evidence)."""


def extraction_mode(method: str) -> str:
    """Map an extractor's real method string to a truthful mode.

    Handles the pipeline's decorated forms verbatim: ``"pypdf (empty)"`` keeps the
    extractor's mode (it ran; the char count tells the outcome), while ``"failed"``
    and ``"skip (>50 MB)"`` mean no extraction happened at all. Anything
    unrecognised is ``"unknown"`` — never ``"text_layer"``.
    """
    m = (method or "").strip()
    if m in _METHOD_MODES:
        return _METHOD_MODES[m]
    if m.endswith(" (empty)"):
        base = m[: -len(" (empty)")].strip()
        if base in _METHOD_MODES:
            return _METHOD_MODES[base]
        return MODE_UNKNOWN
    if m == "failed" or m.startswith("skip"):
        return MODE_NONE
    return MODE_UNKNOWN


# ── inputs (what the caller observed — recorded, never inferred) ──────────────


@dataclass(frozen=True)
class DocumentSource:
    """Byte identity of the document that was actually written to disk.

    ``content_sha256`` MUST be the SHA-256 of the real downloaded bytes — never
    derived from the URL, manufacturer, model, filename, or a chunk ordinal.
    """

    source_uri: str
    content_sha256: str
    byte_count: int
    local_path: str | None = None


@dataclass(frozen=True)
class DocumentExtraction:
    """What the extractor actually did.

    ``method`` is preserved verbatim. ``extractor_version`` is recorded **only**
    when genuinely available — ``None`` means unknown, never a guess.
    """

    method: str
    char_count: int
    text_sha256: str | None = None
    extractor_version: str | None = None
    ocr_requested: bool = False
    size_limit_bytes: int | None = None


@dataclass(frozen=True)
class VerifiedPage:
    """A page the extractor genuinely supplied page identity for. Callers that
    only have an estimate MUST NOT construct these."""

    page_number: int
    char_count: int
    text_sha256: str


@dataclass(frozen=True)
class MaterializationRef:
    """A stable pointer to where extracted content already lives. Never a copy."""

    kind: str  # e.g. "knowledge_entries" | "text_sidecar"
    locator: str
    record_count: int | None = None

    def as_index_ref(self) -> str:
        base = f"{self.kind}:{self.locator}"
        return base if self.record_count is None else f"{base}#records={self.record_count}"


@dataclass(frozen=True)
class DocumentEvidenceReceipt:
    """The compiled receipt: two (manifest, records) pairs, hashed and validated."""

    page_identity_manifest: EvidenceManifest
    page_identity_records: list[EvidenceRecord]
    extraction_manifest: EvidenceManifest
    extraction_records: list[EvidenceRecord]

    @property
    def manifests(self) -> list[EvidenceManifest]:
        return [self.page_identity_manifest, self.extraction_manifest]

    @property
    def dataset_version_ids(self) -> list[str]:
        return [m.dataset_version_id for m in self.manifests]


# ── identity ─────────────────────────────────────────────────────────────────


def compile_configuration_hash(extraction: DocumentExtraction) -> str:
    """Hash of everything about *how* this receipt was produced.

    Both datasets share it, so a change to the extraction configuration changes
    both receipts' identity — the guarantee that a re-extraction under different
    settings is a new dataset version rather than a silent overwrite.
    """
    return sha256_bytes(
        canonical_json(
            {
                "compiler": COMPILER_NAME,
                "compiler_version": COMPILER_VERSION,
                "extraction_method": extraction.method,
                "extraction_mode": extraction_mode(extraction.method),
                "extractor_version": extraction.extractor_version,
                "ocr_requested": extraction.ocr_requested,
                "size_limit_bytes": extraction.size_limit_bytes,
            }
        )
    )


def _dataset_id(dataset_type: DatasetType, source_sha: str) -> str:
    return f"doc:{dataset_type.value}:{source_sha[:16]}"


_VERSION_KEY_EXCLUDED = ("dataset_version_id", "content_hash", "manifest_hash")


def _with_version_id(manifest: EvidenceManifest, records: list[EvidenceRecord]) -> EvidenceManifest:
    """Derive ``dataset_version_id`` from the manifest's own content.

    The version key covers **every** manifest field except the three that depend on
    it, plus the records' content hash. That closes a silent, permanent failure the
    obvious design has: if the key covered only the identity-ish fields
    (``source_sha`` + stage + producer + config — the ``printsense/cas.py`` shape),
    then any *other* varying field would produce the SAME version id with a
    DIFFERENT ``manifest_hash``, and the registry's ADR-A3 immutability check would
    reject the write forever. Two such fields vary in real operation:

    - ``source_objects`` — the fetch URL. A CDN change, a mirror, an added query
      token, or http→https all change it while the bytes are identical.
    - ``storage_ref`` — the local path, which differs per host (``MANUALS_ROOT``).

    Caught end-to-end on 2026-07-30: re-ingesting one PDF from a different port
    produced ``immutable version conflict``, swallowed by the lane's fail-open path.

    Byte identity is still the *recall* key: ``dataset_id`` is byte-derived and
    ``source_hashes`` is what ``registry.find`` / ``resolve_recall`` match on. Two
    fetch URLs for the same bytes therefore yield two versions of one dataset with
    an **identical** ``content_hash`` — so the resolver picks one rather than
    reporting a conflict (which is why record locators are content-addressed, not
    URL-addressed; see ``_source_locator``).
    """
    body = {k: v for k, v in manifest.to_dict().items() if k not in _VERSION_KEY_EXCLUDED}
    body["records_content_hash"] = content_hash(records)
    key = sha256_bytes(canonical_json(body))
    return replace(manifest, dataset_version_id=f"{manifest.dataset_id}@{key[:32]}")


def _source_locator(source_sha: str, page_number: int | None = None) -> str:
    """A content-addressed record locator.

    Deliberately NOT the fetch URL: a record's identity must depend on the content
    it describes, not on where it was downloaded from. Keeping the URL out of
    records means the same bytes fetched from two URLs share one ``content_hash``
    (see ``_with_version_id``). The URL survives as provenance on the manifest's
    ``source_objects``.
    """
    base = f"sha256:{source_sha}"
    return base if page_number is None else f"{base}#page={page_number}"


def _stage_status(extraction: DocumentExtraction) -> StageStatus:
    if extraction.char_count > 0:
        return StageStatus.COMPLETE
    if (extraction.method or "").strip().startswith("skip"):
        return StageStatus.CANCELLED
    return StageStatus.FAILED


def _finalize(
    manifest: EvidenceManifest, records: list[EvidenceRecord]
) -> tuple[EvidenceManifest, list[EvidenceRecord]]:
    """Derive the version id from content, stamp hashes, enforce the invariants.

    ``manifest`` arrives with an empty ``dataset_version_id``; it is derived here so
    that every varying manifest field is inside the version key (see
    ``_with_version_id``). Callers must not set it themselves.
    """
    stamped = [replace(r, evidence_hash=record_hash(r)) for r in records]
    if manifest.dataset_version_id:
        raise DocumentCompilerError(
            "dataset_version_id is derived from content — do not set it (see _with_version_id)"
        )
    m = with_hashes(_with_version_id(manifest, stamped), stamped)

    problems = validate_manifest(m)
    if problems:
        raise DocumentCompilerError(f"invalid manifest: {problems}")
    if (
        m.trust_status is not TrustStatus.CANDIDATE
        or m.approval_status is not ApprovalStatus.PENDING
    ):
        raise DocumentCompilerError(
            "a compiled document receipt is always candidate/pending — this layer "
            "cannot promote evidence (rule 9 / ADR-0017)"
        )
    if any(r.status is not TrustStatus.CANDIDATE for r in stamped):
        raise DocumentCompilerError("every compiled record is candidate (rule 9)")
    for f in _DETERMINISM_MUST_BE_UNSET:
        if getattr(m, f) is not None:
            raise DocumentCompilerError(
                f"{f} must stay unset: it feeds manifest_hash, so a wall-clock or "
                f"cost value would make the same dataset version hash differently "
                f"on every run and trip the registry's immutability check"
            )
    return m, stamped


# ── the compiler ─────────────────────────────────────────────────────────────


def compile_document_evidence(
    *,
    source: DocumentSource,
    extraction: DocumentExtraction,
    tenant_id: str,
    environment: Environment = Environment.DEV,
    verified_pages: Sequence[VerifiedPage] | None = None,
    materializations: Sequence[MaterializationRef] = (),
    asset_refs: Sequence[str] = (),
    uns_paths: Sequence[str] = (),
    repository_commit: str | None = None,
) -> DocumentEvidenceReceipt:
    """Compile a Page Identity + extraction receipt for one already-processed document.

    Pure: no I/O, no network, no clock, no randomness. Raises
    ``DocumentCompilerError`` only on a *contract* violation — a failed or skipped
    extraction is legitimate evidence and produces a receipt with
    ``stage_status`` ``failed``/``cancelled``.
    """
    if not tenant_id:
        raise DocumentCompilerError("tenant_id is required (evidence is tenant-scoped)")
    if not source.content_sha256:
        raise DocumentCompilerError(
            "content_sha256 is required — byte identity is the whole point; it is "
            "never derived from a URL, filename, or chunk ordinal"
        )

    sha = source.content_sha256
    mode = extraction_mode(extraction.method)
    config_hash = compile_configuration_hash(extraction)
    status = _stage_status(extraction)
    producer_version = COMPILER_VERSION

    source_objects = [source.source_uri]
    if source.local_path and source.local_path != source.source_uri:
        source_objects.append(source.local_path)

    common = {
        "tenant_id": tenant_id,
        "environment": environment,
        "source_objects": source_objects,
        "source_hashes": [sha],
        "asset_refs": list(asset_refs),
        "uns_paths": list(uns_paths),
        "producer_name": COMPILER_NAME,
        "producer_version": producer_version,
        "repository_commit": repository_commit,
        "configuration_hash": config_hash,
        "storage_ref": source.local_path,
        # trust/approval are the dataclass defaults (candidate/pending) — stated
        # here only to make the no-self-promotion invariant impossible to miss.
        "trust_status": TrustStatus.CANDIDATE,
        "approval_status": ApprovalStatus.PENDING,
    }

    # ── dataset 1: page identity ────────────────────────────────────────────
    pages = list(verified_pages or [])
    if pages:
        scope = f"pages:{min(p.page_number for p in pages)}-{max(p.page_number for p in pages)}"
        gaps: list[str] = []
        page_records = [
            EvidenceRecord(
                record_id=f"{sha[:16]}:page:{p.page_number:05d}",
                dataset_id=_dataset_id(DatasetType.PAGE_IDENTITY, sha),
                source_locator=_source_locator(sha, p.page_number),
                payload={
                    "scope": "page",
                    "page_number": p.page_number,
                    "char_count": p.char_count,
                    "text_sha256": p.text_sha256,
                    "page_identity_source": "extractor_verified",
                },
                deterministic_reasons=[
                    "page identity supplied by the extractor (not inferred from headings)"
                ],
                producer=f"{COMPILER_NAME}@{producer_version}",
            )
            for p in sorted(pages, key=lambda p: p.page_number)
        ]
    else:
        scope = "document"
        gaps = [
            "page identity not supplied by the extraction layer — this dataset is "
            "document-scoped. A markdown-heading count is an estimate, not page "
            "provenance, so no page coordinate is recorded. Verified page-level "
            "extraction is a later boundary."
        ]
        page_records = [
            EvidenceRecord(
                record_id=f"{sha[:16]}:document",
                dataset_id=_dataset_id(DatasetType.PAGE_IDENTITY, sha),
                source_locator=_source_locator(sha),
                payload={
                    "scope": "document",
                    "content_sha256": sha,
                    "byte_count": source.byte_count,
                    "page_identity_available": False,
                    "page_count": None,
                },
                deterministic_reasons=[
                    "byte identity = sha256 of the downloaded document bytes",
                    "no verified page identity available from this extractor",
                ],
                producer=f"{COMPILER_NAME}@{producer_version}",
            )
        ]

    pi_dataset_id = _dataset_id(DatasetType.PAGE_IDENTITY, sha)
    pi_manifest = EvidenceManifest(
        dataset_id=pi_dataset_id,
        dataset_version_id="",  # derived from content by _finalize
        dataset_type=DatasetType.PAGE_IDENTITY,
        schema_name=PAGE_IDENTITY_SCHEMA[0],
        schema_version=PAGE_IDENTITY_SCHEMA[1],
        page_or_segment_scope=scope,
        stage_status=StageStatus.COMPLETE,
        # completeness stays None on purpose: a numeric 1.0 on a document-scoped
        # dataset would let a future page-level recall query (resolver gate 3)
        # reuse evidence that has no page identity at all.
        completeness=None,
        known_gaps=gaps,
        **common,
    )
    page_identity = _finalize(pi_manifest, page_records)

    # ── dataset 2: extraction ───────────────────────────────────────────────
    ex_gaps: list[str] = []
    if mode != MODE_OCR:
        ex_gaps.append(
            f"not OCR: text came from extraction method {extraction.method!r} "
            f"(mode {mode!r}). This dataset must not be read as OCR evidence."
        )
    if extraction.extractor_version is None:
        ex_gaps.append(
            "extractor version not reported by the extraction layer (unknown, not guessed)"
        )
    if status is not StageStatus.COMPLETE:
        ex_gaps.append(f"extraction produced no text (stage_status={status.value})")

    ex_dataset_id = _dataset_id(DatasetType.OCR, sha)
    ex_record = EvidenceRecord(
        record_id=f"{sha[:16]}:extraction",
        dataset_id=ex_dataset_id,
        source_locator=_source_locator(sha),
        # Extraction FACTS only. Materialization pointers live on the manifest's
        # `index_refs`, not here: their locators are host-relative (MANUALS_ROOT),
        # and a record payload feeds `content_hash` — duplicating them here would
        # make identical evidence hash differently per host and let a later recall
        # see a false conflict.
        payload={
            "extraction_method": extraction.method,  # verbatim, never normalized
            "extraction_mode": mode,
            "is_ocr": mode == MODE_OCR,
            "ocr_requested": extraction.ocr_requested,
            "char_count": extraction.char_count,
            "text_sha256": extraction.text_sha256,
            "extractor_version": extraction.extractor_version,
            "byte_count": source.byte_count,
            "content_sha256": sha,
        },
        deterministic_reasons=[
            "extraction method recorded verbatim from the extraction layer",
            "receipt references the existing materialization; it stores no document text",
        ],
        producer=f"{COMPILER_NAME}@{producer_version}",
    )
    ex_manifest = EvidenceManifest(
        dataset_id=ex_dataset_id,
        dataset_version_id="",  # derived from content by _finalize
        dataset_type=DatasetType.OCR,
        schema_name=TEXT_EXTRACTION_SCHEMA[0],
        schema_version=TEXT_EXTRACTION_SCHEMA[1],
        page_or_segment_scope="document",
        stage_status=status,
        completeness=None,
        known_gaps=ex_gaps,
        parent_dataset_versions=[page_identity[0].dataset_version_id],
        index_refs=[m.as_index_ref() for m in materializations],
        **common,
    )
    extraction_pair = _finalize(ex_manifest, [ex_record])

    return DocumentEvidenceReceipt(
        page_identity_manifest=page_identity[0],
        page_identity_records=page_identity[1],
        extraction_manifest=extraction_pair[0],
        extraction_records=extraction_pair[1],
    )


def write_receipt(receipt: DocumentEvidenceReceipt, registry: MaterializationRegistry) -> list[str]:
    """Register both manifests and return their dataset version ids.

    Parent-before-child so lineage is never dangling. Idempotent: re-registering
    an identical receipt is a no-op, because identical inputs hash identically.
    Only manifests are registered — ``FileRegistry`` persists manifests and status
    overlays, **not** record payloads; it is not a second content store.
    """
    registry.register(receipt.page_identity_manifest)
    registry.register(receipt.extraction_manifest)
    return receipt.dataset_version_ids
