"""``lookup_recall`` — the recall-only half of the bridge.

The production gate needs a lookup that does NOT compute on a miss (so it can do a
lockless first lookup, then a double-check under a per-key lock). ``lookup_recall``
returns a stored ``(graph, RecallInfo)`` on an EXACT hit, else ``None``. It never
computes and never catches — the caller decides how a lookup error falls through.
Zero model calls.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from materialized_evidence.backends import FileRegistry  # noqa: E402
from printsense.cas import CAS  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402
from printsense.recall import interpret_print_with_recall, lookup_recall  # noqa: E402


def _graph(tag: str = "-3/F1") -> PrintSynthGraph:
    return PrintSynthGraph(devices=[Entity(tag=tag, type="fuse", evidence=tag, confidence=0.9)])


def _pages(payload: bytes = b"A") -> list[tuple[bytes, str]]:
    return [(payload, "image/jpeg")]


def _store(tmp_path) -> tuple[FileRegistry, CAS]:
    return FileRegistry(tmp_path / "reg.json"), CAS(tmp_path / "cas")


def test_lookup_returns_none_when_nothing_materialized(tmp_path):
    reg, cas = _store(tmp_path)
    assert lookup_recall(_pages(), registry=reg, cas=cas) is None


def test_lookup_returns_graph_after_materialize(tmp_path):
    reg, cas = _store(tmp_path)
    interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=lambda p, **k: _graph("-7/F7")
    )
    hit = lookup_recall(_pages(), registry=reg, cas=cas)
    assert hit is not None
    graph, info = hit
    assert info.recalled is True
    assert graph.devices[0].tag == "-7/F7"  # returned the stored graph, no model call


def test_lookup_respects_producer_extra(tmp_path):
    reg, cas = _store(tmp_path)
    interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=lambda p, **k: _graph(), producer_extra="A"
    )
    assert lookup_recall(_pages(), registry=reg, cas=cas, producer_extra="A") is not None
    assert lookup_recall(_pages(), registry=reg, cas=cas, producer_extra="B") is None
