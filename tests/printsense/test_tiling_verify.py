"""Hermetic tests for Phase 2 (tiling) + Phase 3 (verify) — no API, no network.

Mocks the single Anthropic entry point ``tiling._call_json`` with canned
locate/reread payloads so the crop/merge/promote/demote LOGIC is exercised
deterministically. Guards the rules that matter: only grammar-valid, confident,
non-duplicate crop readings merge (Phase 2); agreement promotes to
machine_verified and disagreement demotes to unresolved (Phase 3); the machine
never writes human_verified.
"""

import io

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("PIL")

from PIL import Image

from printsense import tiling, verify  # noqa: E402
from printsense.models import PrintSynthGraph, TrustState  # noqa: E402


def _img_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), "white").save(buf, format="JPEG")
    return buf.getvalue()


def _canned(script):
    """Return a fake _call_json that pops the next canned (data, usage) per call."""
    calls = list(script)

    class _U:
        input_tokens = 10
        output_tokens = 5

    def fake(client, image_bytes, user_text, system, effort):
        return calls.pop(0), _U()

    return fake


# ── Phase 2: tiling merge ────────────────────────────────────────────────────


def test_phase2_merges_only_grammar_valid_confident_new_reading(monkeypatch):
    graph = PrintSynthGraph.model_validate(
        {"unresolved": [{"item": "wire number near A13 LWL IN", "status": "unresolved"}]}
    )
    script = [
        # locate: one region found
        {
            "regions": [
                {"item": "wire number near A13 LWL IN", "bbox": [100, 100, 300, 160], "found": True}
            ]
        },
        # reread: a valid, confident wire + a low-conf junk + a grammar-violating "wire"
        {
            "readings": [
                {"text": "-W5497", "kind": "wire", "confidence": 0.93},
                {"text": "-W0001", "kind": "wire", "confidence": 0.3},  # below conf gate -> skip
                {"text": "-WK902", "kind": "wire", "confidence": 0.9},  # grammar violation -> skip
            ]
        },
    ]
    monkeypatch.setattr(tiling.interpret, "_client", lambda: object())
    monkeypatch.setattr(tiling, "_call_json", _canned(script))

    out = tiling.enhance(_img_bytes(), graph)
    tags = {e.tag for e in out["graph"].cables}
    assert tags == {"-W5497"}  # only the valid, confident one merged
    assert out["graph"].cables[0].trust == TrustState.proposed
    assert "bbox" in out["graph"].cables[0].evidence  # coordinate-traceable
    assert out["graph"].unresolved == []  # the item was resolved
    assert len(out["changes"]) == 1


def test_phase2_does_not_duplicate_existing_tag(monkeypatch):
    graph = PrintSynthGraph.model_validate(
        {
            "cables": [{"tag": "-W5497", "trust": "proposed"}],
            "unresolved": [{"item": "wire near A13", "status": "unresolved"}],
        }
    )
    script = [
        {"regions": [{"item": "wire near A13", "bbox": [10, 10, 90, 40], "found": True}]},
        {"readings": [{"text": "-W5497", "kind": "wire", "confidence": 0.95}]},  # already present
    ]
    monkeypatch.setattr(tiling.interpret, "_client", lambda: object())
    monkeypatch.setattr(tiling, "_call_json", _canned(script))

    out = tiling.enhance(_img_bytes(), graph)
    assert len(out["graph"].cables) == 1  # no duplicate added
    assert out["changes"] == []


def test_phase2_no_unresolved_is_a_noop(monkeypatch):
    graph = PrintSynthGraph.model_validate({"devices": [{"tag": "-21/A13"}]})
    out = tiling.enhance(_img_bytes(), graph)
    assert out["changes"] == []
    assert out["usage"]["input_tokens"] == 0  # never called the API


# ── Phase 3: blind verify ────────────────────────────────────────────────────


def _blind(graph_dict):
    """A fake blind full-page pass returning a canned graph_b + usage."""

    def _bp(image_bytes):
        return PrintSynthGraph.model_validate(graph_dict), {
            "input_tokens": 100,
            "output_tokens": 50,
        }

    return _bp


def test_phase3_agreement_promotes_to_machine_verified():
    graph = PrintSynthGraph.model_validate(
        {"cables": [{"tag": "-W5497", "confidence": 0.9, "trust": "proposed"}]}
    )
    # independent blind pass ALSO reads -W5497 -> agreement
    blind = _blind({"cables": [{"tag": "-W5497"}]})
    out = verify.verify(_img_bytes(), graph, blind_pass=blind)
    e = out["graph"].cables[0]
    assert e.trust == TrustState.machine_verified
    assert out["decisions"][0]["decision"] == "agree"


def test_phase3_no_second_witness_keeps_proposed_not_demoted():
    graph = PrintSynthGraph.model_validate(
        {"cables": [{"tag": "-W5497", "confidence": 0.9, "trust": "proposed"}]}
    )
    # blind pass does NOT list -W5497 — absence is not disagreement, so it stays proposed
    blind = _blind({"cables": [{"tag": "-W1111"}]})
    out = verify.verify(_img_bytes(), graph, blind_pass=blind)
    e = out["graph"].cables[0]
    assert e.trust == TrustState.proposed  # not verified...
    assert e.tag == "-W5497"  # ...and not falsely demoted
    assert out["decisions"][0]["decision"] == "no_second_witness"


def test_phase3_verifies_head_of_composite_tag():
    """A composite tag -21/A13:24VDC is verified when the blind pass asserts the
    atomic head -21/A13."""
    graph = PrintSynthGraph.model_validate(
        {"terminals": [{"tag": "-21/A13:24VDC", "trust": "proposed"}]}
    )
    blind = _blind({"devices": [{"tag": "-21/A13"}]})
    out = verify.verify(_img_bytes(), graph, blind_pass=blind)
    assert out["graph"].terminals[0].trust == TrustState.machine_verified


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
