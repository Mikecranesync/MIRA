"""Formal recall gate around the paid PrintSense interpretation (PR G).

Every test injects a fake ``interpret_fn`` — ZERO model calls, ZERO cost. The
gate's contract: an identical print (same page bytes + model/prompt/producer
version) is interpreted ONCE and recalled thereafter; a changed input recomputes;
any registry/CAS error falls through to a plain interpretation (never breaks it).
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from materialized_evidence import DatasetType  # noqa: E402
from materialized_evidence.backends import FileRegistry  # noqa: E402
from printsense.cas import CAS  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402
from printsense.recall import interpret_print_with_recall  # noqa: E402


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


def test_second_identical_call_makes_no_model_call(tmp_path):
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    g1, i1 = interpret_print_with_recall(_pages(), registry=reg, cas=cas, interpret_fn=fake)
    g2, i2 = interpret_print_with_recall(_pages(), registry=reg, cas=cas, interpret_fn=fake)
    assert calls["n"] == 1  # second call recalled — the model was NOT paid again
    assert i1.recalled is False
    assert i2.recalled is True
    assert g2.model_dump() == g1.model_dump()


def test_recall_survives_fresh_registry_and_cas(tmp_path):
    reg1, cas1 = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(_pages(), registry=reg1, cas=cas1, interpret_fn=fake)
    # fresh instances over the same dirs == a brand-new process
    reg2 = FileRegistry(tmp_path / "reg.json")
    cas2 = CAS(tmp_path / "cas")
    _, i2 = interpret_print_with_recall(_pages(), registry=reg2, cas=cas2, interpret_fn=fake)
    assert calls["n"] == 1
    assert i2.recalled is True


def test_changed_pages_recompute(tmp_path):
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(_pages(b"A"), registry=reg, cas=cas, interpret_fn=fake)
    _, i2 = interpret_print_with_recall(_pages(b"B"), registry=reg, cas=cas, interpret_fn=fake)
    assert calls["n"] == 2
    assert i2.recalled is False


def test_changed_model_recomputes(tmp_path):
    reg, cas = _store(tmp_path)
    fake, calls = _counting_fake()
    interpret_print_with_recall(_pages(), registry=reg, cas=cas, interpret_fn=fake, model="m1")
    _, i2 = interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=fake, model="m2"
    )
    assert calls["n"] == 2
    assert i2.recalled is False


def test_materialized_manifest_carries_type_source_and_economics(tmp_path):
    reg, cas = _store(tmp_path)
    _, info = interpret_print_with_recall(
        _pages(), registry=reg, cas=cas, interpret_fn=lambda p, **k: _graph()
    )
    m = reg.get(info.dataset_version_id, tenant_id="local")
    assert m is not None
    assert m.dataset_type == DatasetType.PRINT_INTERPRETATION
    assert m.compute_time_ms is not None  # real measured cost of the (one) computation
    assert m.storage_ref and m.storage_ref.startswith("printsense-cas:printsynth:")
    assert m.trust_status.value == "candidate"  # nothing self-promotes to trusted
    assert m.source_hashes  # keyed on the print's page hashes


class _BoomRegistry:
    """A registry that raises on every call — models a corrupt/unavailable backend."""

    def _boom(self, *a, **k):
        raise RuntimeError("boom")

    find = get = register = effective_stale_state = _boom
    status_overlays = downstream_of = lineage = mark_stale = _boom


def test_recall_error_falls_through_to_compute(tmp_path):
    cas = CAS(tmp_path / "cas")
    fake, calls = _counting_fake()

    def fake9(pages, **kw):
        calls["n"] += 1
        return _graph("-9/F9")

    g, info = interpret_print_with_recall(
        _pages(), registry=_BoomRegistry(), cas=cas, interpret_fn=fake9
    )
    assert calls["n"] == 1  # computed exactly once
    assert info.recalled is False
    assert g.devices[0].tag == "-9/F9"  # returned the freshly computed graph, not a crash
