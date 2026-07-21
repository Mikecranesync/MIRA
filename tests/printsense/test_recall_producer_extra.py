"""``producer_extra`` recall-key extension (production recall gate, behavior-preserving).

PR G keyed recall on page bytes + model/preprocess + schema and deliberately
EXCLUDED the technician question (the CLI reuses one graph across questions). The
production print path is different: the paid graph is shaped by the question AND
the OCR/package context, so the recall key must cover them or a graph computed for
question A would be served to question B. The production caller folds those inputs
into ``producer_extra`` (a canonical-JSON string); these tests lock its contract:

* same ``producer_extra`` -> recall (no second model call),
* different ``producer_extra`` -> recompute,
* ``producer_extra=None`` preserves the exact legacy (page-only) key, so the CLI
  path is byte-for-byte unchanged,
* ``canonical_json`` is key-order independent and preserves unicode / null /
  list order (so equal inputs always hash equal, unequal never collide).

Every test injects a fake ``interpret_fn`` — ZERO model calls, ZERO cost.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from materialized_evidence.backends import FileRegistry  # noqa: E402
from printsense.cas import CAS  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402
from printsense.recall import canonical_json, interpret_print_with_recall  # noqa: E402


def _graph(tag: str = "-3/F1") -> PrintSynthGraph:
    return PrintSynthGraph(devices=[Entity(tag=tag, type="fuse", evidence=tag, confidence=0.9)])


def _pages(payload: bytes = b"page-bytes-A") -> list[tuple[bytes, str]]:
    return [(payload, "image/jpeg")]


def _store(tmp_path) -> tuple[FileRegistry, CAS]:
    return FileRegistry(tmp_path / "reg.json"), CAS(tmp_path / "cas")


def _counting_fake():
    calls = {"n": 0}

    def fake(pages, **kw):
        calls["n"] += 1
        return _graph()

    return fake, calls


def test_same_producer_extra_recalls(tmp_path):
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, producer_extra="ctx-A"
    )
    _, i2 = interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, producer_extra="ctx-A"
    )
    assert calls["n"] == 1  # identical inputs -> recalled, model not paid again
    assert i2.recalled is True


def test_different_producer_extra_recomputes(tmp_path):
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, producer_extra="ctx-A"
    )
    _, i2 = interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, producer_extra="ctx-B"
    )
    assert calls["n"] == 2  # a graph-affecting input changed -> recompute
    assert i2.recalled is False


def test_producer_extra_none_preserves_legacy_key(tmp_path):
    """A call with no ``producer_extra`` and a later ``producer_extra=None`` call
    share the exact legacy page-only key -> the second recalls the first."""
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(_pages(), registry=reg, cas=cas, interpret_fn=fake)  # legacy call
    _, i2 = interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, producer_extra=None
    )
    assert calls["n"] == 1
    assert i2.recalled is True


def test_canonical_json_is_key_order_independent():
    assert canonical_json({"a": 1, "b": 2}) == canonical_json({"b": 2, "a": 1})


def test_canonical_json_preserves_unicode_null_and_list_order():
    s = canonical_json({"q": "Ölfilter", "ctx": {"pages": [3, 1, 2]}, "opt": None})
    assert "Ölfilter" in s  # unicode preserved verbatim (not \\uXXXX-escaped)
    assert '"opt":null' in s  # null preserved
    assert "[3,1,2]" in s  # list order preserved (never sorted)
