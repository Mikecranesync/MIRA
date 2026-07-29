"""Deterministic scorers for the ZTA proofpack experiments.

ZTA role: every number the proofpack report shows is computed here from
already-finished :class:`~factorylm_ai.providers.base.ModelResponse` output
(or from a fixture's known-correct answer) — no model calls, no randomness,
no wall clock. That is what makes e01-e04 dry-run numbers a fixture-
determinism check (same input -> same score, forever) rather than a flaky
benchmark: the flakiness, if any, can only come from the provider layer
(the mock provider has none by construction), never from scoring.

Every function here is a pure function of its arguments.
"""

from __future__ import annotations

import math
import re
from collections.abc import Collection, Sequence

_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> set[str]:
    """Lowercase, alphanumeric-run tokenization for the keyword baseline."""
    return set(_WORD_RE.findall(text.lower()))


def route_accuracy(predicted: Sequence[str], expected: Sequence[str]) -> float:
    """Fraction of ``predicted[i] == expected[i]``.

    ``predicted`` and ``expected`` must be the same length (one prediction
    per case) — a length mismatch is a caller bug, not a scoring question,
    so it raises rather than silently truncating. Empty input scores 0.0,
    never ``NaN`` — an experiment that scored nothing is worth reporting as
    "zero", not crashing the report.
    """
    if len(predicted) != len(expected):
        raise ValueError(
            f"route_accuracy: predicted has {len(predicted)} items, expected has {len(expected)}"
        )
    if not expected:
        return 0.0
    correct = sum(1 for p, e in zip(predicted, expected, strict=True) if p == e)
    return correct / len(expected)


def tool_choice_accuracy(predicted: Sequence[str], expected: Sequence[str]) -> float:
    """Fraction of cases where the chosen tool name matches the expected one.

    Same mechanics as :func:`route_accuracy` (exact-match sequence
    comparison) — a distinct name at call sites for readability in e04
    (tool selection) versus e02 (intent routing).
    """
    return route_accuracy(predicted, expected)


def json_validity_rate(valid_flags: Sequence[bool]) -> float:
    """Fraction of ``True`` in ``valid_flags``. Empty input scores 0.0."""
    if not valid_flags:
        return 0.0
    return sum(1 for v in valid_flags if v) / len(valid_flags)


def keyword_overlap_score(query: str, document: str) -> float:
    """Jaccard token overlap between ``query`` and ``document``, in ``[0, 1]``.

    The zero-model retrieval baseline: no embeddings, no provider call, just
    set overlap over lowercased alphanumeric tokens. Either side empty (after
    tokenizing) scores 0.0.
    """
    q = _tokenize(query)
    d = _tokenize(document)
    if not q or not d:
        return 0.0
    return len(q & d) / len(q | d)


def keyword_overlap_topk(query: str, documents: Sequence[str], k: int) -> list[int]:
    """Indices of the top-``k`` ``documents`` by :func:`keyword_overlap_score`.

    Descending by score; ties break by ascending original index, so the
    result is fully deterministic regardless of dict/set iteration order.
    ``k <= 0`` returns an empty list.
    """
    scored = [(keyword_overlap_score(query, doc), idx) for idx, doc in enumerate(documents)]
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [idx for _, idx in scored[: max(0, k)]]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity of two equal-length vectors.

    Either vector being all-zero (undefined direction) scores 0.0 rather
    than raising a division-by-zero.
    """
    if len(a) != len(b):
        raise ValueError(f"cosine_similarity: length mismatch {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def cosine_topk(
    query_vec: Sequence[float], vectors: Sequence[Sequence[float]], k: int
) -> list[int]:
    """Indices of the top-``k`` ``vectors`` by cosine similarity to ``query_vec``.

    Descending by score; ties break by ascending original index. The dense
    (embedding-based) analog of :func:`keyword_overlap_topk`. ``k <= 0``
    returns an empty list.
    """
    scored = [(cosine_similarity(query_vec, vec), idx) for idx, vec in enumerate(vectors)]
    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    return [idx for _, idx in scored[: max(0, k)]]


def hit_at_k(ranked_indices: Sequence[int], correct_indices: Collection[int]) -> bool:
    """``True`` if any of ``correct_indices`` appears anywhere in ``ranked_indices``.

    ``correct_indices`` is a :class:`~collections.abc.Collection` (order
    never matters for a correctness set — a plain ``set[int]`` is the
    natural caller shape) while ``ranked_indices`` is an ordered
    :class:`~collections.abc.Sequence` (already sliced to the top-``k`` by
    the caller, e.g. from :func:`keyword_overlap_topk`/:func:`cosine_topk`).
    """
    correct = set(correct_indices)
    return any(idx in correct for idx in ranked_indices)


def mean_hit_rate(hits: Sequence[bool]) -> float:
    """Fraction of ``True`` in ``hits`` (a hit@k rate across many queries).

    Empty input scores 0.0, never ``NaN``.
    """
    if not hits:
        return 0.0
    return sum(1 for h in hits if h) / len(hits)
