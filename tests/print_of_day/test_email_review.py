"""Email-review layer tests (PRD: Print of the Day — Mobile-First Daily Review).

Hermetic ($0, no network). Covers the acceptance criteria (PRD §17): verdict-
first + inline print + ≤3 findings + labeled blind summary + compact grade +
pipeline-health separation + plain-text equivalence + duplicate-send key +
attachment verification + the full 20-section report + one-view-model-two-
surfaces.
"""

from __future__ import annotations

import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools" / "internet_print_test"))

from printsense.print_of_day import email_render, report_render, view_model  # noqa: E402


def _manifest(**over):
    m = {
        "schema": "factorylm.print-of-day.v1",
        "case_id": "potd-003",
        "generated_at": "2026-07-21T09:00:00Z",
        "provider": {
            "requested": "together",
            "resolved": "together",
            "model": "MiniMaxAI/MiniMax-M3",
            "responded_model": "MiniMaxAI/MiniMax-M3",
            "endpoint_class": "serverless",
        },
        "ocr": {
            "required": True,
            "available": True,
            "tesseract_version": "5.5.0",
            "pytesseract_version": "0.3.13",
        },
        "grader": {
            "score": None,
            "letter": "A",
            "import_verdict": "PASS",
            "hard_failures": [],
            "safety_critical_misreads": [],
            "confident_misreads": [],
        },
        "judge": {"judge_independence": "reduced_same_cascade"},
        "provenance": {
            "git_sha": "a" * 40,
            "git_dirty": False,
            "image_revision": "a" * 40,
            "allow_dirty": False,
        },
        "selected_page_sha": "sha_sel",
        "graded_page_sha": "sha_sel",
        "artifact_sha256": {"print.png": "printhash", "extraction.json": "exh"},
        "gold_eligible": True,
        "degraded": [],
    }
    for k, v in over.items():
        m[k] = v
    return m


def _vm(**over):
    return view_model.build_view_model(
        _manifest(**over.pop("manifest", {})),
        recipient="mike@example.com",
        title="PowerFlex 523 Control I/O Wiring",
        blind_summary="PrintSense identified a PowerFlex 523 control I/O reference and described the terminal groupings.",
        claim_counts=over.pop(
            "claim_counts", {"confirmed": 20, "incorrect": 0, "unsupported": 0, "nuance": 1}
        ),
        **over,
    )


# ── view model derivation ───────────────────────────────────────────────────


def test_verdict_gold_when_clean_and_eligible() -> None:
    vm = _vm()
    assert vm.verdict == "gold_candidate"
    assert vm.promotion_blocked is False
    assert vm.overall_grade == "A"


def test_incorrect_claims_force_correction_required() -> None:
    vm = _vm(claim_counts={"confirmed": 18, "incorrect": 2, "unsupported": 0, "nuance": 0})
    assert vm.verdict == "correction_required"
    assert vm.promotion_blocked is True


def test_safety_misread_forces_unsafe_and_blocks() -> None:
    vm = _vm(
        manifest={
            "grader": {
                "letter": "C",
                "import_verdict": "PASS",
                "safety_critical_misreads": ["bypassed interlock"],
                "hard_failures": [],
                "confident_misreads": [],
            }
        }
    )
    assert vm.verdict == "unsafe"
    assert vm.promotion_blocked is True


def test_missing_ocr_when_required_holds() -> None:
    vm = _vm(
        manifest={
            "ocr": {
                "required": True,
                "available": False,
                "tesseract_version": None,
                "pytesseract_version": None,
            },
            "gold_eligible": False,
        }
    )
    assert vm.verdict == "hold_for_review"


def test_duplicate_send_key_is_stable_and_recipient_scoped() -> None:
    k1 = view_model.duplicate_send_key("potd-003", 1, "print_of_day_email_v2", "a@x.com")
    k2 = view_model.duplicate_send_key("potd-003", 1, "print_of_day_email_v2", "a@x.com")
    k3 = view_model.duplicate_send_key("potd-003", 1, "print_of_day_email_v2", "b@x.com")
    assert k1 == k2 and k1 != k3 and len(k1) == 64


def test_pipeline_health_separated_from_grade() -> None:
    vm = _vm(manifest={"judge": {"judge_error": "InferenceRouter unavailable"}})
    assert vm.pipeline_health["status"] == "manual_review_required"
    assert vm.pipeline_health["judge"] == "manual_fallback"
    # grade is unaffected by the infra degradation
    assert vm.overall_grade == "A"


def test_claim_counts_null_when_unavailable() -> None:
    vm = _vm(claim_counts=None)
    assert all(v is None for v in vm.claim_counts.values())


# ── email rendering ─────────────────────────────────────────────────────────


def test_subject_names_artifact_and_outcome() -> None:
    vm = _vm(sequence_number=3)
    s = email_render.subject(vm)
    assert s.startswith("Print of the Day #003 —")
    assert "PowerFlex 523 Control I/O Wiring" in s
    assert "Gold Candidate" in s


def test_html_is_verdict_first_before_findings() -> None:
    vm = _vm()
    html = email_render.render_html(vm, image_cid="print")
    assert html.index("Verdict") < html.index("Key findings")
    assert html.index("Verdict") < html.index("What PrintSense concluded")


def test_html_embeds_inline_cid_image_with_alt_text() -> None:
    vm = _vm()
    html = email_render.render_html(vm, image_cid="print")
    assert 'src="cid:print"' in html
    assert 'alt="Evaluated print:' in html  # descriptive alt text (accessibility)


def test_html_caps_key_findings_at_three() -> None:
    # even with many grade misreads, the email shows ≤3
    vm = _vm(
        manifest={
            "grader": {
                "letter": "B",
                "import_verdict": "PASS",
                "hard_failures": [],
                "safety_critical_misreads": [],
                "confident_misreads": ["a", "b", "c", "d", "e"],
            }
        },
        claim_counts=None,
    )
    assert len(vm.key_findings) <= 3
    html = email_render.render_html(vm)
    assert html.count("<li ") <= 3


def test_status_not_colour_alone_carries_text_and_glyph() -> None:
    vm = _vm()
    html = email_render.render_html(vm)
    assert "Gold Candidate" in html  # text label present
    assert email_render._verdict_glyph("gold_candidate") in html  # shape glyph too


def test_plain_text_has_equivalent_information() -> None:
    vm = _vm(sequence_number=3)
    txt = email_render.render_text(vm)
    assert "VERDICT: GOLD CANDIDATE" in txt
    assert "WHAT PRINTSENSE CONCLUDED" in txt
    assert "KEY FINDINGS" in txt
    assert "PIPELINE HEALTH" in txt
    assert "Approve" in txt and "Request correction" in txt
    # action URLs/commands are usable in plain text
    assert "APPROVE CASE" in txt


def test_preheader_is_short_and_actionable() -> None:
    vm = _vm()
    ph = email_render.preheader(vm)
    assert len(ph) <= 120
    assert "under 30 seconds" in ph


# ── full report ─────────────────────────────────────────────────────────────


def test_report_has_all_twenty_sections_in_order() -> None:
    vm = _vm()
    md = report_render.render_markdown(vm, _manifest(), answer_key="withheld key text")
    idx = [md.find(f"## {s}") for s in report_render.SECTIONS]
    assert all(i >= 0 for i in idx), "every section present"
    assert idx == sorted(idx), "sections in canonical order"


def test_report_preserves_blind_verbatim_and_notes_immutability() -> None:
    vm = _vm()
    md = report_render.render_markdown(vm, _manifest())
    assert "never overwritten by corrections" in md
    assert "PowerFlex 523 control I/O reference" in md


def test_report_hash_is_content_addressed() -> None:
    vm = _vm()
    md = report_render.render_markdown(vm, _manifest())
    h1 = report_render.report_version_hash(md)
    h2 = report_render.report_version_hash(md + " ")
    assert len(h1) == 64 and h1 != h2


def test_email_and_report_share_one_view_model() -> None:
    # Both surfaces read the SAME vm — they cannot disagree (PRD §19).
    vm = _vm()
    html = email_render.render_html(vm)
    md = report_render.render_markdown(vm, _manifest())
    assert vm.verdict_label in html and vm.verdict_label in md
    assert vm.template_versions["email"] in html
    assert vm.template_versions["report"] in md


# ── mailer extensions ───────────────────────────────────────────────────────


def test_attachment_verification_catches_missing_empty_and_mismatch(tmp_path: Path) -> None:
    import mailer

    good = tmp_path / "print.png"
    good.write_bytes(b"realbytes")
    import hashlib

    good_hash = hashlib.sha256(b"realbytes").hexdigest()
    empty = tmp_path / "empty.png"
    empty.write_bytes(b"")

    assert mailer.verify_attachments([good], {"print.png": good_hash}) == []
    assert "missing:nope.png" in mailer.verify_attachments([tmp_path / "nope.png"], {})
    assert "empty:empty.png" in mailer.verify_attachments([empty], {})
    assert "hash_mismatch:print.png" in mailer.verify_attachments([good], {"print.png": "wrong"})


def test_email_package_carries_text_and_inline_images() -> None:
    import mailer

    pkg = mailer.build_package("subj", "<p>hi</p>", "a@x.com", [])
    assert pkg.text is None and pkg.inline_images is None  # backward compatible
    pkg.text = "plain"
    pkg.inline_images = [{"cid": "print", "path": "/x/print.png"}]
    assert pkg.text == "plain" and pkg.inline_images[0]["cid"] == "print"
