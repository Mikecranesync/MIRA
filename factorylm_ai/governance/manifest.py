"""Reproducible corpus manifest hashing (CLF governance).

A dataset build must be reproducible: identical eligible inputs → an identical
manifest hash, so a corpus version is content-addressed and a rebuild is
verifiable. Pure + deterministic — no wall-clock, no ordering dependence (records
are sorted before hashing). The caller stamps a ``dataset_version`` and any
timestamp; this module never reads the clock.
"""

from __future__ import annotations

import hashlib
import json

from . import lineage as ln

# The fields that define a manifest entry (identity + governance, not payload).
_ENTRY_FIELDS = (
    "record_id",
    "document_lineage_key",
    "split",
    "content_hash",
    "training_eligibility",
)


def corpus_manifest(records: list[dict], *, dataset_version: str) -> dict:
    """Build a reproducible manifest over the eligible ``records``.

    Deterministic: entries are reduced to their identity/governance fields and
    sorted by the full entry identity before the digest, so the same inputs (in
    any order) yield the same ``manifest_sha256``."""
    entries = [{k: r.get(k) for k in _ENTRY_FIELDS} for r in records]
    entries.sort(key=lambda e: tuple(str(e.get(k) or "") for k in _ENTRY_FIELDS))
    split_counts: dict[str, int] = {s: 0 for s in ln.ALL_SPLITS}
    lineages: set[str] = set()
    for e in entries:
        s = ln.canonical_split(e.get("split") or "")
        if s in split_counts:
            split_counts[s] += 1
        lineage_key = e.get("document_lineage_key")
        if isinstance(lineage_key, str) and lineage_key:
            lineages.add(lineage_key)

    body = {"dataset_version": dataset_version, "entries": entries}
    manifest_sha256 = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "dataset_version": dataset_version,
        "record_count": len(entries),
        "lineage_count": len(lineages),
        "split_counts": split_counts,
        "manifest_sha256": manifest_sha256,
        "entries": entries,
    }
