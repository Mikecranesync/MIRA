"""Lineage-safe split assignment + the leakage guard (CLF data-rights law).

Splits are assigned **per lineage**, so every sibling (revision/page/crop/
rotation/paraphrase) of one ``document_lineage_key`` lands in the SAME partition —
by construction, a lineage can never straddle train/validation/test/held_out.
The guard :func:`find_leakage` re-checks an already-assigned record set for the
six violations the policy enumerates, returning typed governance rejections.

Pure + deterministic. Operates on light dicts (``document_lineage_key``, ``split``,
optional ``training_eligibility`` / ``record_id``) so it does not couple to the
`flywheel/records.py` schema.
"""

from __future__ import annotations

from collections.abc import Iterable

from . import lineage as ln
from . import rejection_codes as rc


def assign_splits_by_lineage(lineage_keys: Iterable[str]) -> dict[str, str]:
    """One split per DISTINCT lineage key (deterministic 70/15/10/5). All siblings
    of a lineage therefore share a split."""
    return {k: ln.assign_split(k) for k in set(lineage_keys)}


def group_and_split(records: list[dict]) -> list[dict]:
    """Return the records with a ``split`` stamped from their lineage's assignment,
    so siblings are always together. Records without a lineage key are left with
    ``split=None`` (the eligibility gate rejects them as LINEAGE_MISSING)."""
    keys = [r["document_lineage_key"] for r in records if r.get("document_lineage_key")]
    assigned = assign_splits_by_lineage(keys)
    out = []
    for r in records:
        k = r.get("document_lineage_key")
        out.append({**r, "split": assigned.get(k) if k else None})
    return out


def find_leakage(records: list[dict]) -> list[rc.Rejection]:
    """Detect the six leakage violations in an assigned record set. Empty ⇒ clean.

    Checks: (a) one lineage in >1 split, (b) an ``eligible`` record on the
    validation/test/held_out side, (c) a bare-content-hash lineage key, (d) a
    ``held_out`` lineage marked training-eligible. (Superseding-revision-fresh-key
    and page-based splitting are prevented upstream by the lineage-key contract +
    per-lineage assignment.)"""
    rej: list[rc.Rejection] = []
    by_lineage: dict[str, set[str]] = {}
    for r in records:
        key = r.get("document_lineage_key")
        split = ln.canonical_split(r.get("split") or "")
        elig = r.get("training_eligibility") == "eligible"

        if not key:
            rej.append(
                rc.Rejection(rc.LINEAGE_MISSING, f"record {r.get('record_id')} has no lineage key")
            )
            continue
        if ln.is_bare_content_hash(key):
            rej.append(
                rc.Rejection(rc.LINEAGE_MISSING, f"lineage key {key} is a bare content hash")
            )
        by_lineage.setdefault(key, set()).add(split)

        if elig and ln.is_quarantined(split):
            rej.append(
                rc.Rejection(rc.HELD_OUT, f"held_out lineage {key} marked training-eligible")
            )
        elif elig and not ln.is_train_side(split):
            rej.append(
                rc.Rejection(rc.LINEAGE_ON_EVAL_SIDE, f"eligible lineage {key} on split {split}")
            )

    for key, splits in by_lineage.items():
        real = {s for s in splits if s}
        if len(real) > 1:
            rej.append(
                rc.Rejection(
                    rc.LINEAGE_SPLIT_COLLISION, f"lineage {key} spans splits {sorted(real)}"
                )
            )
    return rej
