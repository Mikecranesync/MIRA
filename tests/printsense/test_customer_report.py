"""Customer report — determinism, honesty, gating (commercial PR-1)."""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import customer_report as cr  # noqa: E402

PAYLOADS = {"pA": {"devices": [{"tag": "-91/K01", "bbox": [1, 2, 3, 4]}]},
            "pB": {"devices": [{"tag": "-92/K02"}]}}
XREFS = [
    {"raw_reference": "92.1 / K911", "source_page": "91", "target_page": "pB",
     "resolution": "resolved", "pattern_class": "SHEET_COL_ANCHOR",
     "confidence": 0.9, "evidence_bbox": [10, 10, 60, 20]},
    {"raw_reference": "-W5093", "source_page": "91", "target_page": None,
     "resolution": "unresolved_segment", "pattern_class": "CABLE_CONT",
     "confidence": 0.55, "evidence_bbox": [5, 5, 30, 12]},
    {"raw_reference": "99.1 / K999", "source_page": "91", "target_page": None,
     "resolution": "missing_target", "pattern_class": "SHEET_COL_ANCHOR",
     "confidence": 0.85, "evidence_bbox": [7, 7, 40, 15]},
]


def _report(**kw):
    return cr.build_customer_report("Why does K01 trip?", PAYLOADS, XREFS,
                                    purposes={"pA": "power distribution page"},
                                    **kw)


def test_report_deterministic_bytes():
    a, b = _report(), _report()
    assert cr.render_markdown(a) == cr.render_markdown(b)
    assert cr.stable_report_json(a) == cr.stable_report_json(b)


def test_report_shows_evidence_and_cta():
    md = cr.render_markdown(_report())
    assert "`-91/K01`" in md and "[1, 2, 3, 4]" in md
    assert "`92.1 / K911`" in md and "[10, 10, 60, 20]" in md
    assert "-W5093" in md
    assert "99.1 / K999" in md  # unresolved surfaced, never hidden
    assert cr.CTA in md and cr.POSITIONING in md and "Safety" in md


def test_reconstruction_never_implied_when_unqualified():
    r = _report()
    assert r["unavailable_capabilities"][0]["state"] == \
        "advanced_reasoning_unavailable"
    md = cr.render_markdown(r)
    assert "Not performed on this request" in md
    assert "Preliminary package inventory" in md


def test_model_assist_refused_without_qualified_provider():
    reg = {"providers": {}}  # nothing qualified
    r = _report(explain_fn=lambda d, x: "MODEL TEXT", registry=reg)
    assert r["explanation_source"] == "deterministic (no qualified provider)"
    assert "MODEL TEXT" not in r["circuit_explanation"]


def test_model_assist_used_only_when_qualified():
    reg = {"providers": {"p": {
        "schema_reliability": {"status": "qualified", "evidence": "x"},
        "cross_reference_extraction": {"status": "disqualified", "evidence": "x"},
        "system_reconstruction": {"status": "disqualified", "evidence": "x"}}}}
    r = _report(explain_fn=lambda d, x: "QUALIFIED ASSIST", registry=reg)
    assert r["circuit_explanation"] == "QUALIFIED ASSIST"
    assert r["explanation_source"] == "qualified_model_assist"
    # reconstruction stays unavailable even with a qualified explainer
    assert r["unavailable_capabilities"]


def test_empty_capture_is_honest():
    r = cr.build_customer_report("q", {}, [])
    md = cr.render_markdown(r)
    assert "No device labels were readable" in md
    assert "None proven" in md
