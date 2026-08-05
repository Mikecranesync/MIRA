"""D3 — citation-eligibility rules: what may be cited as a [Source: …].

Defect (W2a eval case 6, docs/evals/2026-08-03-dialogue-mode-w2a/results.md):
MIRA replied "You think it's a WEG motor. [Source: Img 20231106 085404329 —
motor]" — an uploaded PHOTO'S FILENAME cited as documentation, and the turn
ended as if diagnosed. Per owner ruling this is an ELIGIBILITY rule set, not
merely a filename filter: session artifacts (photos, screenshots, timestamp
labels) are never citable documentation; manuals, fault tables, datasheets,
and pack citations are. Enforcement rides the existing compliance seam so a
reply whose only citation was ineligible becomes uncited and receives the
honest H4 KB-gap admission downstream instead of confident junk.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mira-bots"))

from shared.citation_compliance import (  # noqa: E402
    check_citation_compliance,
    ineligible_source_reason,
    valid_source_labels,
)

# The literal production string from eval case 6.
CASE6_LABEL = "Img 20231106 085404329 — motor"

INELIGIBLE = [
    (CASE6_LABEL, "image_artifact"),
    ("IMG_1234.jpg", "image_artifact"),
    ("image 42", "image_artifact"),
    ("photo 2023-11-06", "session_artifact"),
    ("Screenshot 2024-05-01 at 09.15.00", "session_artifact"),
    ("session photo", "session_artifact"),
    ("nameplate.png p.1", "image_artifact"),
    ("20231106085404329", "bare_timestamp"),
    ("", "empty"),
    ("   ", "empty"),
]

ELIGIBLE = [
    "Allen-Bradley PowerFlex 525 — Fault Code Table",
    "PowerFlex 525 Adjustable Frequency AC Drive User Manual (520-UM001O-EN-E) p.161",
    "DURApulse GS10 — Chapter 5",
    "Rockwell Automation 22A UM001",
    "AutomationDirect GS10 user manual",
    # An eligible doc label that merely CONTAINS the word photo/image inside
    # prose must not be caught (rules key on artifact-shaped labels).
    "Siemens SINAMICS G120 — imaging sensor wiring section",
]


class TestEligibilityClassifier:
    def test_ineligible_labels_with_reasons(self):
        for label, expected_reason in INELIGIBLE:
            reason = ineligible_source_reason(label)
            assert reason == expected_reason, (label, reason)

    def test_eligible_document_labels_pass(self):
        for label in ELIGIBLE:
            assert ineligible_source_reason(label) is None, label


class TestComplianceEnforcement:
    KB = {"status": "covered"}

    def test_case6_junk_citation_is_stripped_with_honesty_note(self):
        reply = f"You think it's a WEG motor. [Source: {CASE6_LABEL}]"
        out = check_citation_compliance(
            reply, self.KB, fsm_state="DIAGNOSIS", chat_id="t", enforce=True
        )
        sanitized = out["sanitized_reply"]
        assert sanitized is not None
        assert CASE6_LABEL not in sanitized
        assert "[Source:" not in sanitized  # nothing citable remains
        assert "not documentation" in sanitized or "unverified" in sanitized

    def test_eligible_citation_survives_untouched(self):
        reply = (
            "F004 = Undervoltage. Check incoming line voltage. "
            "[Source: Allen-Bradley PowerFlex 525 — Fault Code Table]"
        )
        out = check_citation_compliance(
            reply, self.KB, fsm_state="DIAGNOSIS", chat_id="t", enforce=True
        )
        assert out["sanitized_reply"] is None  # no strip performed

    def test_mixed_tags_strip_only_the_ineligible_one(self):
        reply = (
            "Check the DC bus. [Source: Allen-Bradley PowerFlex 525 — Fault Code Table] "
            f"[Source: {CASE6_LABEL}]"
        )
        out = check_citation_compliance(
            reply, self.KB, fsm_state="DIAGNOSIS", chat_id="t", enforce=True
        )
        sanitized = out["sanitized_reply"]
        assert sanitized is not None
        assert CASE6_LABEL not in sanitized
        assert "[Source: Allen-Bradley PowerFlex 525 — Fault Code Table]" in sanitized

    def test_stripped_only_junk_reply_then_gets_h4_admission(self):
        from shared.engine import enforce_citation_or_gap_admission

        reply = (
            f"You think it's a WEG motor and should replace the bearing. [Source: {CASE6_LABEL}]"
        )
        out = check_citation_compliance(
            reply, self.KB, fsm_state="DIAGNOSIS", chat_id="t", enforce=True
        )
        final = enforce_citation_or_gap_admission(out["sanitized_reply"], dispatch_kind="")
        assert "KB-gap" in final  # honest admission replaces confident junk


class TestSalvageNeverInsertsJunk:
    def test_valid_source_labels_excludes_ineligible_chunk_labels(self):
        # Real chunk shape: labels are built by format_source_label from
        # manufacturer/model_number/metadata.section — the case-6 junk label
        # came from a photo-ingested chunk whose manufacturer field WAS the
        # image filename.
        chunks = [
            {
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
                "metadata": {"section": "Fault Code Table"},
            },
            {"manufacturer": "Img 20231106 085404329", "metadata": {"section": "motor"}},
            {"manufacturer": "IMG_2231.jpeg", "metadata": {}},
        ]
        labels = valid_source_labels(chunks)
        assert "Allen-Bradley PowerFlex 525 — Fault Code Table" in labels
        assert CASE6_LABEL not in labels
        assert "IMG_2231.jpeg" not in labels
