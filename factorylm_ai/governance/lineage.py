"""Lineage-safe splits (CLF `data-rights-and-leakage.md`, ADR-0030).

The approved policy, encoded as runtime (the shipped `flywheel/splits.py` predates
it and stays as-is for back-compat — this is the governed path PR 3+ export uses):

* Assignment is by ``document_lineage_key`` hash, **never** by page/render/crop.
* Ratios **70 / 15 / 10 / 5** → ``train / validation / test / held_out``.
* All revisions/renders/crops/augmentations of one lineage share the key → the
  same split; a superseding revision keeps the prior lineage key.
* ``held_out`` (5%) is a **permanent, quarantined** benchmark: never used for
  training, model selection, threshold calibration, prompt tuning, or rule dev.
* The key is NEVER a bare content hash (that would fork a lineage each revision).

Pure + deterministic: a key in, a split out; same inputs → same assignment.
"""

from __future__ import annotations

import hashlib
import re

SPLIT_TRAIN = "train"
SPLIT_VALIDATION = "validation"
SPLIT_TEST = "test"
SPLIT_HELD_OUT = "held_out"
ALL_SPLITS: tuple[str, ...] = (SPLIT_TRAIN, SPLIT_VALIDATION, SPLIT_TEST, SPLIT_HELD_OUT)

TRAIN_SIDE: frozenset[str] = frozenset({SPLIT_TRAIN})
# Quarantined: unusable for training, selection, tuning, calibration, rule dev.
QUARANTINED: frozenset[str] = frozenset({SPLIT_HELD_OUT})

# Cumulative bucket boundaries (out of 100) — 70 / 15 / 10 / 5.
_BOUNDS: tuple[tuple[int, str], ...] = (
    (70, SPLIT_TRAIN),
    (85, SPLIT_VALIDATION),
    (95, SPLIT_TEST),
    (100, SPLIT_HELD_OUT),
)

# Legacy `flywheel/splits.py` vocabulary → canonical policy names.
LEGACY_SPLIT_MAP: dict[str, str] = {
    "dev": SPLIT_VALIDATION,
    "holdout": SPLIT_HELD_OUT,
    "eval": SPLIT_TEST,
}

_BARE_HASH = re.compile(r"^[0-9a-fA-F]{64}$")  # case-insensitive: uppercase hex is still a hash
_SLUG = re.compile(r"[^a-z0-9]+")


def canonical_split(split: str) -> str:
    """Map a legacy split name to the canonical policy name (idempotent)."""
    return LEGACY_SPLIT_MAP.get(split, split)


def slug(text: str) -> str:
    return _SLUG.sub("-", (text or "").strip().lower()).strip("-")


def public_lineage_key(manufacturer: str, document_number: str) -> str:
    """`<manufacturer-slug>:<document-number-slug>` — stable across revisions."""
    m, d = slug(manufacturer), slug(document_number)
    if not m or not d:
        raise ValueError("public lineage key needs a manufacturer and document number")
    return f"{m}:{d}"


def tenant_lineage_key(tenant_id: str, doc_uuid: str) -> str:
    """`tenant:<tenant-id>:document:<uuid>` — registry-assigned, not content-derived."""
    if not tenant_id or not doc_uuid:
        raise ValueError("tenant lineage key needs a tenant id and a registry uuid")
    return f"tenant:{tenant_id}:document:{doc_uuid}"


def is_bare_content_hash(key: str) -> bool:
    """A 64-hex key is a content hash, NOT a lineage key (forks on every revision)."""
    return bool(_BARE_HASH.match(key or ""))


def assign_split(document_lineage_key: str) -> str:
    """Deterministic split for a lineage key (70/15/10/5). Every revision/render/
    crop of the same lineage hashes to the SAME split. Rejects a bare content hash
    used as a lineage key (a leakage-guard violation at the source)."""
    if not document_lineage_key:
        raise ValueError("empty document_lineage_key")
    if is_bare_content_hash(document_lineage_key):
        raise ValueError("document_lineage_key must not be a bare content hash (forks lineage)")
    bucket = int(hashlib.sha256(document_lineage_key.encode("utf-8")).hexdigest(), 16) % 100
    for upper, name in _BOUNDS:
        if bucket < upper:
            return name
    return SPLIT_HELD_OUT  # unreachable (last bound is 100)


def is_train_side(split: str) -> bool:
    return canonical_split(split) in TRAIN_SIDE


def is_known_split(split: str) -> bool:
    return canonical_split(split) in ALL_SPLITS


def is_quarantined(split: str) -> bool:
    return canonical_split(split) in QUARANTINED
