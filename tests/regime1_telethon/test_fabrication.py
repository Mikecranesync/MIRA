"""Fabricated-specific detector (#3165) + the offline lab that runs it.

The detector's whole job is to make an ACCUSATION ("MIRA invented this"), so
its failure modes are asymmetric: a false negative costs a missed defect, a
false positive costs trust in the tool. These tests pin the fail-safe direction
in both places — an unresolvable token is never reported.
"""

from __future__ import annotations

import json

import pytest

from tests.regime1_telethon.campaign import fabrication

REAL = "To reset the fault, set P045 [Stop Mode] then cycle power."
FAKE = "To reset digital output on Rockwell Automation 525, set P0594 = 1"


class TestExtractParamClaims:
    def test_extracts_a_parameter_token(self):
        assert fabrication.extract_param_claims(FAKE) == {"P0594"}

    def test_extracts_dotted_gs10_form(self):
        assert "P09.03" in fabrication.extract_param_claims("Check P09.03 on the GS10.")

    def test_fault_codes_are_not_parameter_claims(self):
        """F004/F111 legitimately arrive from uns_context without appearing in
        any retrieved chunk — treating them as claims would fire on every
        fault conversation MIRA handles."""
        assert fabrication.extract_param_claims("F004 = UnderVoltage, see F111 too.") == set()

    def test_a_token_the_technician_supplied_is_not_mira_s_claim(self):
        assert fabrication.extract_param_claims("Set P09.03 higher.", "what is P09.03?") == set()

    def test_tokens_inside_a_source_tag_are_attribution_not_a_claim(self):
        reply = "Cycle power. [Source: AutomationDirect GS10 P09.03 Table]"
        assert fabrication.extract_param_claims(reply) == set()

    def test_short_tokens_are_not_parameters(self):
        """'L1'/'P1' are wiring and prose, not parameter ids."""
        assert fabrication.extract_param_claims("Measure at L1, L2, L3 and P1.") == set()


class TestCorpusIndex:
    def test_unresolved_token_reports_none_not_absent(self, tmp_path):
        """The fail-safe that matters: with no cache and no DB, the detector
        must stay SILENT rather than accuse."""
        corpus = fabrication.CorpusIndex(tmp_path / "c.json")
        assert corpus.exists("P0594") is None
        assert fabrication.find_fabricated_claims(FAKE, "", corpus) == []

    def test_cached_zero_is_a_fabrication(self, tmp_path):
        cache = tmp_path / "c.json"
        cache.write_text(json.dumps({"P0594": 0}), encoding="utf-8")
        corpus = fabrication.CorpusIndex(cache)
        assert fabrication.find_fabricated_claims(FAKE, "", corpus) == ["P0594"]

    def test_cached_nonzero_is_not_a_fabrication(self, tmp_path):
        cache = tmp_path / "c.json"
        cache.write_text(json.dumps({"P045": 200}), encoding="utf-8")
        corpus = fabrication.CorpusIndex(cache)
        assert fabrication.find_fabricated_claims(REAL, "", corpus) == []

    def test_fetch_result_is_cached_and_saved(self, tmp_path):
        calls = []

        def fetch(token):
            calls.append(token)
            return 0

        cache = tmp_path / "c.json"
        corpus = fabrication.CorpusIndex(cache, fetch=fetch)
        assert corpus.exists("P0594") is False
        assert corpus.exists("P0594") is False
        assert calls == ["P0594"], "a resolved token must not be looked up twice"
        corpus.save()
        assert json.loads(cache.read_text(encoding="utf-8")) == {"P0594": 0}

    def test_a_fetch_that_fails_does_not_accuse(self, tmp_path):
        corpus = fabrication.CorpusIndex(tmp_path / "c.json", fetch=lambda t: None)
        assert corpus.exists("P0594") is None
        assert fabrication.find_fabricated_claims(FAKE, "", corpus) == []


class TestOfflineLabDetectors:
    """The lab's own detectors, on the real shapes they were built from."""

    def test_contained_repeat_matches_the_c6_shape(self):
        from tests.regime1_telethon.campaign import offline_lab

        prior = (
            "F004 = UnderVoltage - the DC bus dropped below the minimum. Most common "
            "causes: low incoming line or a supply sag during start. Measure the "
            "incoming voltage at L1-L2-L3."
        )
        turns = [
            {"role": "tech", "text": "What does F004 mean?", "i": 1},
            {"role": "mira", "text": prior, "i": 1},
            {"role": "tech", "text": "How do I reset it?", "i": 2},
            {
                "role": "mira",
                "text": prior + "\n\nYou've asked about resetting a digital output.",
                "i": 2,
            },
        ]
        hits = offline_lab.detect_contained_repeat(turns)
        assert [h["detector"] for h in hits] == ["contained_repeat"]

    def test_distinct_replies_are_not_a_repeat(self):
        from tests.regime1_telethon.campaign import offline_lab

        turns = [
            {"role": "mira", "text": "F004 is an undervoltage trip on the DC bus.", "i": 1},
            {"role": "mira", "text": "Check the incoming supply at L1-L2-L3 for a sag.", "i": 2},
        ]
        assert offline_lab.detect_contained_repeat(turns) == []

    @pytest.mark.parametrize("frac_text", ["short", "a bit longer but still new"])
    def test_a_short_prior_does_not_trip_the_floor(self, frac_text):
        from tests.regime1_telethon.campaign import offline_lab

        turns = [
            {"role": "mira", "text": frac_text, "i": 1},
            {"role": "mira", "text": frac_text + " plus a genuinely new sentence here.", "i": 2},
        ]
        assert offline_lab.detect_contained_repeat(turns) == []
