"""Deterministic split assignment + the train/holdout near-duplicate guard.

ZTA role: a fine-tuning corpus is only as trustworthy as its holdout is
clean. This module has two independent jobs:

1. :func:`assign_split` — a PURE function of a record id: the same id always
   lands in the same split (train/dev/test/holdout, 70/10/10/10 in
   expectation), with no external state and no randomness. This is what
   makes a benchmark comparison across two proofpack runs meaningful — the
   split a record falls into cannot silently drift between runs.
2. :func:`split_records` — takes a batch of records (already split or not)
   and enforces the one invariant a per-record hash cannot: that two near-
   duplicate pieces of text never end up on both sides of the train/holdout
   boundary. A model that trained on a near-duplicate of a holdout case
   would pass that eval for the wrong reason. When a collision is found,
   the HOLDOUT copy wins and the train copy is dropped — logged, never
   silently.

:mod:`factorylm_ai.flywheel.export` is the only other module that reasons
about splits after this point, and it separately, physically refuses to
ever write the holdout split at all.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

logger = logging.getLogger("factorylm-ai")

_STANDARD_SPLITS = ("train", "dev", "test", "holdout")
_WHITESPACE_RE = re.compile(r"\s+")

# Cumulative thresholds over record_id's sha256 (first 8 hex chars, as an
# integer, mod 100): [0,70)->train, [70,80)->dev, [80,90)->test,
# [90,100)->holdout. 70/10/10/10 in expectation; exact and stable per id.
_TRAIN_END = 70
_DEV_END = 80
_TEST_END = 90


def assign_split(record_id: str) -> str:
    """Deterministically map ``record_id`` to "train"/"dev"/"test"/"holdout".

    Pure function of the id's sha256 digest — same id, same split, forever;
    no randomness, no external state, no dependence on call order or on
    what else has already been split.
    """
    digest = hashlib.sha256(record_id.encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    if bucket < _TRAIN_END:
        return "train"
    if bucket < _DEV_END:
        return "dev"
    if bucket < _TEST_END:
        return "test"
    return "holdout"


def near_duplicate_key(text: str) -> str:
    """sha256 of ``text`` lowercased with runs of whitespace collapsed to one space.

    Two texts that differ only in whitespace/case produce the same key —
    the near-duplicate signal :func:`split_records` uses to keep train and
    holdout from leaking into each other.
    """
    normalized = _WHITESPACE_RE.sub(" ", text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def split_records(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Bucket ``records`` by split, enforcing the train/holdout near-dup guard.

    A record already carrying a truthy ``"split"`` value is trusted as-is —
    this is the normal case, since
    :func:`factorylm_ai.flywheel.records.new_training_record` already calls
    :func:`assign_split` at construction time. A record with no ``"split"``
    value gets one assigned here, via :func:`assign_split` on its id field
    (``record_id``/``case_id``/``interaction_id``/``feedback_id``, first
    one found).

    After bucketing, any record in "train" whose :func:`near_duplicate_key`
    matches a record in "holdout" is DROPPED from train (logged via
    ``logging`` — never silently); holdout wins. Records on any other split
    (e.g. "eval", which is always exactly "eval" per
    :func:`factorylm_ai.flywheel.records.new_eval_case` and must never be
    mixed into a training split) are left alone — the guard only ever
    compares "train" against "holdout".

    Returns a dict with at least the four standard keys
    ("train"/"dev"/"test"/"holdout"), each present even if empty, plus any
    other split value actually seen on an input record (e.g. "eval").
    """
    buckets: dict[str, list[dict[str, Any]]] = {s: [] for s in _STANDARD_SPLITS}
    for record in records:
        split = record.get("split") or assign_split(_record_id_of(record))
        stamped = record if record.get("split") == split else {**record, "split": split}
        buckets.setdefault(split, []).append(stamped)

    _drop_train_holdout_near_dups(buckets)
    return buckets


def _drop_train_holdout_near_dups(buckets: dict[str, list[dict[str, Any]]]) -> None:
    train = buckets.get("train", [])
    holdout = buckets.get("holdout", [])
    if not train or not holdout:
        return

    holdout_keys = {near_duplicate_key(_text_of(r)) for r in holdout}
    kept: list[dict[str, Any]] = []
    for record in train:
        if near_duplicate_key(_text_of(record)) in holdout_keys:
            logger.warning(
                "split_records: dropping near-duplicate record %s from train "
                "(content matches a holdout record) — holdout wins",
                _record_id_of(record),
            )
            continue
        kept.append(record)
    buckets["train"] = kept


def _record_id_of(record: dict[str, Any]) -> str:
    for key in ("record_id", "case_id", "interaction_id", "feedback_id"):
        value = record.get(key)
        if isinstance(value, str) and value:
            return value
    raise ValueError(
        "split_records: record has no recognizable id field (expected one of "
        f"record_id/case_id/interaction_id/feedback_id): keys={sorted(record.keys())}"
    )


def _text_of(record: dict[str, Any]) -> str:
    messages = record.get("messages")
    if isinstance(messages, list) and messages:
        parts = [str(m.get("content", "")) for m in messages if isinstance(m, dict)]
        if parts:
            return " ".join(parts)
    for key in ("input_text", "final_text"):
        value = record.get(key)
        if isinstance(value, str) and value:
            return value
    return json.dumps(record, sort_keys=True, default=str)
