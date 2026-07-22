"""PR 2A — PrintSense / Print-of-the-Day corpus adapter.

Lowers a PrintSense print record into a :class:`SourceCandidate`:

* **Public prints** get a ``<manufacturer-slug>:<document-number-slug>`` lineage key and
  carry their declared rights (fail closed when undeclared). ``eval_only`` forces the
  ``public-eval-only`` license so the material stays ineligible for training.
* **Tenant / private uploads** get a ``tenant:<tenant-id>:document:<uuid>`` lineage key
  and are hardened to customer-private, sensitive, non-cross-tenant — regardless of any
  rights the record claims (tenant/private ambiguity fails closed to private).

A ``source_sha256`` / page / render / crop hash is an **evidence** identifier
(``evidence_id``) and is NEVER used as the lineage key.
"""

from __future__ import annotations

from factorylm_ai.governance import lineage as ln
from factorylm_ai.governance.rights import (
    LICENSE_CUSTOMER_PRIVATE,
    LICENSE_PUBLIC_EVAL_AND_TRAIN,
    LICENSE_PUBLIC_EVAL_ONLY,
    LICENSE_UNKNOWN,
)

from .source_candidate import SourceCandidate, build_corpus_source, canonical_document_uuid

SOURCE_SYSTEM = "printsense"

# Content-hash fields PrintSense may carry — kept as evidence, never as lineage.
_EVIDENCE_HASH_FIELDS = ("source_sha256", "page_hash", "render_hash", "crop_hash")


def _evidence_id(record: dict) -> str | None:
    for f in _EVIDENCE_HASH_FIELDS:
        if record.get(f):
            return str(record[f])
    return None


def _declared_rights(record: dict) -> dict:
    return record.get("rights") or {}


def printsense_candidate(record: dict) -> SourceCandidate:
    """Build a governance candidate from a PrintSense print record.

    Raises ``ValueError`` only for structurally un-representable input (a tenant record
    with no document uuid, or a public record with no manufacturer/document number).
    Everything else — undeclared rights, missing provenance — is faithfully lowered and
    fails closed at the gate, not here."""
    record_id = str(record.get("record_id") or record.get("id") or "")
    evidence_id = _evidence_id(record)
    tenant_id = record.get("tenant_id")

    if tenant_id:
        # Tenant / private — fail closed to private no matter what the record claims.
        doc_uuid = record.get("document_uuid")
        if not doc_uuid:
            raise ValueError("tenant PrintSense record needs a document_uuid for its lineage key")
        doc_uuid = canonical_document_uuid(doc_uuid)  # reject a content hash in the document slot
        lineage = ln.tenant_lineage_key(str(tenant_id), doc_uuid)
        confidentiality = record.get("confidentiality_class") or "customer-private"
        corpus_source = build_corpus_source(
            license_class=LICENSE_CUSTOMER_PRIVATE,
            confidentiality_class=confidentiality,
            rights_resolved=True,  # rights ARE resolved — resolved to "private, not trainable"
            training_allowed=False,
            evaluation_allowed=True,
            public_export_allowed=False,
            cross_tenant_reuse_allowed=False,
        )
        return SourceCandidate(
            source_system=SOURCE_SYSTEM,
            record_id=record_id,
            document_lineage_key=lineage,
            corpus_source=corpus_source,
            gold_status=str(record.get("gold_status", "ungraded")),
            validation_passed=bool(record.get("validation_passed", False)),
            safety_status=str(record.get("safety_status", "clear")),
            provenance_present=bool(record.get("provenance")),
            frozen_eval=False,
            sensitive=True,
            tenant_id=str(tenant_id),
            confidentiality_class=confidentiality,
            evidence_id=evidence_id,
            metadata={"visibility": "tenant"},
        )

    # Public print.
    manufacturer = record.get("manufacturer")
    document_number = record.get("document_number")
    if not manufacturer or not document_number:
        raise ValueError("public PrintSense record needs manufacturer + document_number")
    lineage = ln.public_lineage_key(str(manufacturer), str(document_number))

    eval_only = bool(record.get("eval_only", False))
    if eval_only:
        license_class = LICENSE_PUBLIC_EVAL_ONLY
    else:
        license_class = str(record.get("license_class") or LICENSE_UNKNOWN)
        if license_class == "public-eval-and-train":
            license_class = LICENSE_PUBLIC_EVAL_AND_TRAIN

    r = _declared_rights(record)
    corpus_source = build_corpus_source(
        license_class=license_class,
        confidentiality_class="public",
        rights_resolved=bool(r.get("rights_resolved", False)),
        training_allowed=bool(r.get("training_allowed", False)),
        evaluation_allowed=bool(r.get("evaluation_allowed", False)),
        public_export_allowed=bool(r.get("public_export_allowed", False)),
        cross_tenant_reuse_allowed=bool(r.get("cross_tenant_reuse_allowed", False)),
        derivatives_retained=bool(r.get("derivatives_retained", False)),
        policy_ref=r.get("policy_ref"),
    )
    return SourceCandidate(
        source_system=SOURCE_SYSTEM,
        record_id=record_id,
        document_lineage_key=lineage,
        corpus_source=corpus_source,
        gold_status=str(record.get("gold_status", "ungraded")),
        validation_passed=bool(record.get("validation_passed", False)),
        safety_status=str(record.get("safety_status", "clear")),
        provenance_present=bool(record.get("provenance")),
        frozen_eval=False,
        sensitive=False,
        tenant_id=None,
        confidentiality_class="public",
        evidence_id=evidence_id,
        metadata={"visibility": "public", "eval_only": eval_only},
    )
