"""Hermetic tests for the Print of the Day v2 structured view model (PRD 13.3).

No network, no email, no Doppler. The view model is the single source both the
mobile email and the full report render from.
"""
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import view_model as vm  # noqa: E402


def _base(**over):
    d = dict(
        case_id="potd-003",
        sequence_number=3,
        title="PowerFlex 523 Control I/O Wiring",
        evaluation_date="2026-07-21",
        verdict="gold_candidate",
        overall_grade="A",
        claim_counts={"confirmed": 20, "incorrect": 0, "unsupported": 0, "nuance": 1},
        dimension_grades={"accuracy": "A", "evidence": "A", "honesty": "A",
                          "safety": "pass", "rights": "evaluation_only"},
        source={"image_ref": "print.png", "sheet_label": "Control I/O Wiring",
                "rights_label": "evaluation_only", "sha256": "abc123"},
        blind_summary="PrintSense identified the drawing as a PowerFlex 523 control I/O reference.",
        key_findings=[{"type": "confirmed", "title": "Terminals", "summary": "all correct"}],
        pipeline_health={"status": "degraded", "judge": "manual_fallback",
                         "ocr_crosscheck": "unavailable", "messages": []},
        report={"version": 1, "sha256": "def456", "url": None},
    )
    d.update(over)
    return d


def test_build_carries_counts_verdict_grade():
    m = vm.build_view_model(**_base())
    assert m.verdict == "gold_candidate"
    assert m.overall_grade == "A"
    assert m.claim_counts["confirmed"] == 20
    assert m.claim_counts["incorrect"] == 0


def test_verdict_label_and_glyph_are_text_not_color():
    # Accessibility (PRD 14 / ui-style): status must carry a text label + a shape,
    # never color alone.
    m = vm.build_view_model(**_base())
    assert m.verdict_label() == "Gold Candidate"
    assert isinstance(m.verdict_glyph(), str) and m.verdict_glyph().strip()


def test_rejects_more_than_three_key_findings():
    # FR-4: the main email shows no more than three findings.
    findings = [{"type": "confirmed", "title": f"f{i}", "summary": "s"} for i in range(4)]
    with pytest.raises(ValueError):
        vm.build_view_model(**_base(key_findings=findings))


def test_rejects_unknown_verdict():
    with pytest.raises(ValueError):
        vm.build_view_model(**_base(verdict="totally_made_up"))


def test_claim_counts_require_the_four_keys():
    with pytest.raises(ValueError):
        vm.build_view_model(**_base(claim_counts={"confirmed": 1}))


def test_send_key_is_stable_and_recipient_scoped():
    # FR-8: durable per case/report_version/template_version/recipient key.
    m = vm.build_view_model(**_base())
    k1 = m.send_key("mike@example.com")
    k2 = m.send_key("mike@example.com")
    k3 = m.send_key("someone@else.com")
    assert k1 == k2 and k1 != k3
    assert len(k1) == 64  # sha256 hex
