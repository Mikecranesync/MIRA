"""PR 2B — Drive Commander pack corpus adapter.

A Drive Commander "pack" is **data, not code** (ADR-0025): a per-drive bundle keyed by a
content-hash pack-id. That pack-id is an **evidence** identifier — it is NEVER the lineage
key (a content hash forks the lineage every time the pack is rebuilt).

* **Shared / public packs** (a pack derived from a published OEM drive manual) get a
  ``<manufacturer-slug>:<document-number-slug>`` lineage key. Their rights **fail closed**
  unless the pack ``manifest`` explicitly declares a resolved, trainable license.
* **Tenant packs** get a ``tenant:<tenant-id>:document:<pack-uuid>`` lineage key and default
  to ``sensitive=True``, customer-private, non-cross-tenant-reusable — a tenant's drive
  pack is not shared-corpus material.
"""

from __future__ import annotations

from factorylm_ai.governance import lineage as ln
from factorylm_ai.governance.rights import (
    LICENSE_CUSTOMER_PRIVATE,
    LICENSE_PUBLIC_EVAL_AND_TRAIN,
    LICENSE_PUBLIC_EVAL_ONLY,
    LICENSE_UNKNOWN,
)

from .source_candidate import SourceCandidate, build_corpus_source

SOURCE_SYSTEM = "drive_commander"

_KNOWN_LICENSES = frozenset(
    {LICENSE_PUBLIC_EVAL_AND_TRAIN, LICENSE_PUBLIC_EVAL_ONLY, LICENSE_CUSTOMER_PRIVATE}
)


def _evidence_id(pack: dict) -> str | None:
    for f in ("pack_id", "content_hash", "pack_sha256"):
        if pack.get(f):
            return str(pack[f])
    return None


def drive_commander_candidate(pack: dict) -> SourceCandidate:
    """Build a governance candidate from a Drive Commander pack descriptor.

    Raises ``ValueError`` only for structurally un-representable input (a tenant pack with
    no pack uuid, or a shared pack with no manufacturer/document number). Undeclared rights
    are lowered as unknown/unresolved and fail closed at the gate."""
    record_id = str(pack.get("record_id") or pack.get("id") or _evidence_id(pack) or "")
    evidence_id = _evidence_id(pack)
    tenant_id = pack.get("tenant_id")

    if tenant_id:
        pack_uuid = pack.get("pack_uuid") or pack.get("document_uuid")
        if not pack_uuid:
            raise ValueError("tenant Drive Commander pack needs a pack_uuid for its lineage key")
        lineage = ln.tenant_lineage_key(str(tenant_id), str(pack_uuid))
        confidentiality = pack.get("confidentiality_class") or "customer-private"
        corpus_source = build_corpus_source(
            license_class=LICENSE_CUSTOMER_PRIVATE,
            confidentiality_class=confidentiality,
            rights_resolved=True,
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
            gold_status=str(pack.get("gold_status", "ungraded")),
            validation_passed=bool(pack.get("validation_passed", False)),
            safety_status=str(pack.get("safety_status", "clear")),
            provenance_present=bool(pack.get("provenance")),
            frozen_eval=False,
            sensitive=True,
            tenant_id=str(tenant_id),
            confidentiality_class=confidentiality,
            evidence_id=evidence_id,
            metadata={"scope": "tenant", "pack_kind": pack.get("pack_kind")},
        )

    # Shared / public pack — rights fail closed unless the manifest grants otherwise.
    manufacturer = pack.get("manufacturer")
    document_number = pack.get("document_number") or pack.get("drive_model")
    if not manufacturer or not document_number:
        raise ValueError(
            "shared Drive Commander pack needs manufacturer + document_number/drive_model"
        )
    lineage = ln.public_lineage_key(str(manufacturer), str(document_number))

    manifest = pack.get("manifest") or {}
    manifest_rights = manifest.get("rights") or {}
    declared_license = str(manifest.get("license_class") or LICENSE_UNKNOWN)
    # Only a license the policy recognizes counts; anything else fails closed to unknown.
    license_class = declared_license if declared_license in _KNOWN_LICENSES else LICENSE_UNKNOWN
    corpus_source = build_corpus_source(
        license_class=license_class,
        confidentiality_class=str(manifest.get("confidentiality_class") or "public"),
        rights_resolved=bool(manifest_rights.get("rights_resolved", False)),
        training_allowed=bool(manifest_rights.get("training_allowed", False)),
        evaluation_allowed=bool(manifest_rights.get("evaluation_allowed", False)),
        public_export_allowed=bool(manifest_rights.get("public_export_allowed", False)),
        cross_tenant_reuse_allowed=bool(manifest_rights.get("cross_tenant_reuse_allowed", False)),
        derivatives_retained=bool(manifest_rights.get("derivatives_retained", False)),
        policy_ref=manifest_rights.get("policy_ref"),
    )
    return SourceCandidate(
        source_system=SOURCE_SYSTEM,
        record_id=record_id,
        document_lineage_key=lineage,
        corpus_source=corpus_source,
        gold_status=str(pack.get("gold_status", "ungraded")),
        validation_passed=bool(pack.get("validation_passed", False)),
        safety_status=str(pack.get("safety_status", "clear")),
        provenance_present=bool(pack.get("provenance")),
        frozen_eval=False,
        sensitive=False,
        tenant_id=None,
        confidentiality_class=str(manifest.get("confidentiality_class") or "public"),
        evidence_id=evidence_id,
        metadata={"scope": "shared", "pack_kind": pack.get("pack_kind")},
    )
