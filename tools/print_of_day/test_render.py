"""Hermetic tests for the Print of the Day v2 renderer (PRD 9, 12, 14).

Renders the mobile-first email (HTML + plain-text) and the full report from ONE
view model. No network, no email.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import render  # noqa: E402
import view_model as vm  # noqa: E402


def _mk(**over):
    d = dict(
        case_id="potd-003", sequence_number=3, title="PowerFlex 523 Control I/O Wiring",
        evaluation_date="2026-07-21", verdict="gold_candidate", overall_grade="A",
        claim_counts={"confirmed": 20, "incorrect": 0, "unsupported": 0, "nuance": 1},
        dimension_grades={"accuracy": "A", "evidence": "A", "honesty": "A",
                          "safety": "pass", "rights": "evaluation_only"},
        source={"image_ref": "print.png", "sheet_label": "Control I/O Wiring",
                "rights_label": "evaluation_only", "sha256": "abc123"},
        blind_summary="PrintSense identified a PowerFlex 523 control I/O reference.",
        key_findings=[
            {"type": "confirmed", "title": "Terminals", "summary": "all correct"},
            {"type": "confirmed", "title": "No invented field state", "summary": "good"},
            {"type": "nuance", "title": "One term narrower", "summary": "phrase tighter"},
        ],
        pipeline_health={"status": "degraded", "judge": "manual_fallback",
                         "ocr_crosscheck": "unavailable", "messages": []},
        report={"version": 1, "sha256": "def456", "url": None},
    )
    d.update(over)
    return vm.build_view_model(**d)


def test_subject_format():
    # PRD 9.1: "Print of the Day #NNN — [title] — [Verdict]"
    assert render.render_subject(_mk()) == \
        "Print of the Day #003 — PowerFlex 523 Control I/O Wiring — Gold Candidate"


def test_email_html_verdict_before_blind_summary():
    # FR-3: verdict/grade appear before the blind interpretation.
    html = render.render_email_html(_mk())
    assert html.index("Gold Candidate") < html.index("What PrintSense concluded")


def test_email_html_shows_all_key_findings_and_no_more():
    # FR-4: exactly the (≤3) key findings, no fourth block.
    html = render.render_email_html(_mk())
    for title in ("Terminals", "No invented field state", "One term narrower"):
        assert title in html
    assert html.count('data-finding="1"') == 1  # findings are individually marked
    assert 'data-finding="4"' not in html


def test_email_html_pipeline_health_is_a_footer_after_actions():
    # FR-10 / 8.6: infra warnings live in a footer, after the reviewer actions,
    # not mixed into the verdict/grade.
    html = render.render_email_html(_mk())
    assert html.index("Approve case") < html.index("Pipeline health")
    assert "Independent LLM judge unavailable" in html


def test_email_html_is_single_column_mobile_width():
    # PRD 8.7 / 14: single column, ≤640px, responsive.
    html = render.render_email_html(_mk())
    assert "max-width:640px" in html.replace(" ", "")


def test_email_html_status_carries_text_and_glyph_not_color_alone():
    m = _mk()
    html = render.render_email_html(m)
    assert m.verdict_label() in html
    assert m.verdict_glyph() in html


def test_email_html_grade_strip_shows_all_dimensions():
    html = render.render_email_html(_mk())
    for label in ("Accuracy", "Evidence", "Honesty", "Safety", "Rights"):
        assert label in html


def test_email_html_image_has_alt_and_cid():
    # PRD 9.5 / 13.5: inline CID image with descriptive alt.
    html = render.render_email_html(_mk(), image_cid="potd-print")
    assert "cid:potd-print" in html
    assert "alt=" in html and "PowerFlex 523" in html


def test_email_has_four_reply_actions_in_html_and_text():
    # Phase 1 action mechanism = reply commands (PRD 9.9).
    m = _mk()
    for body in (render.render_email_html(m), render.render_email_text(m)):
        for cmd in ("APPROVE CASE", "CORRECT CASE", "REJECT CASE", "HOLD CASE"):
            assert cmd in body


def test_email_text_has_equivalent_information():
    # FR-9: plain-text alternative with equivalent info + a report reference.
    text = render.render_email_text(_mk())
    assert "Gold Candidate" in text
    assert "20 confirmed" in text
    assert "Terminals" in text
    assert "report" in text.lower()
    # verdict must precede the blind summary in text too
    assert text.index("Gold Candidate") < text.index("What PrintSense concluded")


def test_report_html_preserves_immutable_blind_and_verdict():
    # PRD 10: full report keeps the original blind answer verbatim + the verdict.
    detail = {"blind_verbatim": "VERBATIM-BLIND-ANSWER-XYZ",
              "answer_key": "the withheld key", "claims": []}
    html = render.render_report_html(_mk(), report_detail=detail)
    assert "VERBATIM-BLIND-ANSWER-XYZ" in html
    assert "Gold Candidate" in html
    assert "the withheld key" in html
