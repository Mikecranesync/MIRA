"""3-probe qualification harness — hermetic tests (no network, no corpus)."""

from __future__ import annotations

import hashlib

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from printsense.benchmarks import provider_qualification as q  # noqa: E402


def _good_graph(_img: bytes) -> dict:
    return {"devices": [{"tag": t} for t in q.SYNTH_DEVICES],
            "xrefs": [{"raw": r} for r in q.SYNTH_XREFS]}


def _blind_graph(_img: bytes) -> dict:
    return {"devices": [{"tag": q.SYNTH_DEVICES[0]}], "xrefs": []}


def test_synthetic_sheet_is_deterministic():
    a = hashlib.sha256(q.render_synthetic_xref_sheet()).hexdigest()
    b = hashlib.sha256(q.render_synthetic_xref_sheet()).hexdigest()
    assert a == b


def test_p1_scores_perfect_provider():
    s = q.score_p1(_good_graph(b""))
    assert s["schema_valid"] and s["device_recall"] == 1.0
    assert s["xref_hits"] == 3


def test_probes_without_corpus_paths_are_explicit_not_tested():
    out = q.run_probes(_good_graph)
    assert out["p2_b7_gate"]["status"] == "not_tested"
    assert out["p3_rack_inventory"]["status"] == "not_tested"


def test_xrefless_provider_proposed_disqualified_for_xrefs():
    out = q.run_probes(_blind_graph)
    v = out["proposed_capabilities"]
    assert v["cross_reference_extraction"] == "disqualified"
    assert v["system_reconstruction"] == "disqualified"
    assert v["schema_reliability"] == "qualified"
    assert v["device_inventory"] == "not_tested"


def test_xref_capable_provider_stays_not_tested_without_real_gate():
    out = q.run_probes(_good_graph)
    v = out["proposed_capabilities"]
    assert v["cross_reference_extraction"] == "not_tested"  # P2 not run
    assert v["system_reconstruction"] == "not_tested"


def test_provider_crash_is_a_recorded_p1_failure_not_a_harness_crash():
    def boom(_img: bytes) -> dict:
        raise RuntimeError("provider exploded")
    out = q.run_probes(boom)
    assert out["p1_synthetic_xref"]["schema_valid"] is False
    assert out["proposed_capabilities"]["schema_reliability"] == "disqualified"


def test_p3_runs_with_runtime_paths(tmp_path):
    photo = tmp_path / "rack.png"
    photo.write_bytes(q.render_synthetic_xref_sheet())
    truth = tmp_path / "truth.json"
    truth.write_text('{"device_tags": ["-91/K01", "-91/K02", "-91/X9"]}',
                     encoding="utf-8")
    out = q.run_probes(_good_graph, rack_photo=str(photo),
                       rack_truth=str(truth))
    assert out["p3_rack_inventory"]["status"] == "ran"
    assert out["proposed_capabilities"]["device_inventory"] == "qualified"
