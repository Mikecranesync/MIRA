"""Content-addressed identity for Materialized Evidence (PRD §9).

sha256 over canonicalized JSON, mirroring ``printsense/cas.py``'s approach. The
manifest hash deliberately EXCLUDES the two hash fields so that stamping the
hashes onto a manifest does not change the hash. Nothing here logs payload bytes.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from typing import Any

from .schema import EvidenceManifest, EvidenceRecord, _enum_safe

_HASH_EXCLUDED = ("content_hash", "manifest_hash")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(obj: Any) -> bytes:
    """Deterministic JSON: sorted keys, no insignificant whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def content_hash(records: list[EvidenceRecord]) -> str:
    """Hash of the canonicalized dataset payload (order-independent).

    Records are sorted by ``record_id`` first, so the same set of records in a
    different order yields the same content hash — identical output deduplicates
    (PRD §21.2)."""
    canon = [r.to_dict() for r in sorted(records, key=lambda r: r.record_id)]
    return sha256_bytes(canonical_json(canon))


def manifest_hash(m: EvidenceManifest) -> str:
    """Hash of the canonical manifest EXCLUDING the hash fields themselves — so
    setting the hashes is idempotent and re-hashing an unchanged manifest is
    stable."""
    d = _enum_safe({k: v for k, v in dataclasses.asdict(m).items() if k not in _HASH_EXCLUDED})
    return sha256_bytes(canonical_json(d))


def with_hashes(m: EvidenceManifest, records: list[EvidenceRecord]) -> EvidenceManifest:
    """Return a copy of ``m`` with ``content_hash`` (from records) and
    ``manifest_hash`` (from the manifest sans hash fields) stamped in. Idempotent:
    ``with_hashes(with_hashes(m, r), r)`` equals ``with_hashes(m, r)``."""
    ch = content_hash(records)
    stamped = dataclasses.replace(m, content_hash=ch, record_count=len(records))
    return dataclasses.replace(stamped, manifest_hash=manifest_hash(stamped))


def record_hash(r: EvidenceRecord) -> str:
    """Content-addressed identity for a single record, excluding its own
    ``evidence_hash`` field."""
    d = {k: v for k, v in r.to_dict().items() if k != "evidence_hash"}
    return sha256_bytes(canonical_json(d))
