"""Tests for shared.guardrails — intent classification, query expansion, output validation."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.guardrails import (
    SAFETY_KEYWORDS,
    check_output,
    classify_intent,
    detect_emotional_state,
    detect_expertise_level,
    detect_session_followup,
    expand_abbreviations,
    resolve_option_selection,
    rewrite_question,
    strip_mentions,
    vendor_name_from_text,
    vendor_support_url,
)


# ---------------------------------------------------------------------------
# expand_abbreviations
# ---------------------------------------------------------------------------


class TestExpandAbbreviations:
    def test_single_abbreviation(self):
        assert "motor" in expand_abbreviations("mtr")

    def test_multiple_abbreviations(self):
        result = expand_abbreviations("mtr trpd")
        assert "motor" in result
        assert "tripped" in result

    def test_preserves_non_abbreviations(self):
        assert expand_abbreviations("the pump is broken") == "the pump is broken"

    def test_idempotent(self):
        once = expand_abbreviations("vfd flt")
        twice = expand_abbreviations(once)
        assert once == twice

    def test_punctuation_stripped_for_lookup(self):
        result = expand_abbreviations("mtr.")
        assert "motor" in result

    def test_empty_string(self):
        assert expand_abbreviations("") == ""

    def test_mixed_case_abbreviation(self):
        # Abbreviation lookup is case-insensitive via .lower()
        result = expand_abbreviations("VFD")
        assert "variable frequency drive" in result


# ---------------------------------------------------------------------------
# rewrite_question
# ---------------------------------------------------------------------------


class TestRewriteQuestion:
    def test_vague_phrase_replaced(self):
        result = rewrite_question("motor not working")
        assert "failure to operate" in result

    def test_asset_prepended(self):
        result = rewrite_question("running hot", asset_identified="PowerFlex 525")
        assert result.startswith("PowerFlex 525")
        assert "elevated temperature" in result

    def test_no_asset_no_prefix(self):
        result = rewrite_question("pump making noise")
        assert "abnormal vibration" in result
        assert "—" not in result or "pump" in result

    def test_abbreviations_expanded_before_rewrite(self):
        result = rewrite_question("mtr not working")
        assert "motor" in result
        assert "failure to operate" in result

    def test_passthrough_when_no_match(self):
        result = rewrite_question("check parameter P001")
        assert "parameter" in result


# ---------------------------------------------------------------------------
# classify_intent
# ---------------------------------------------------------------------------


class TestClassifyIntent:
    def test_safety_keyword_returns_safety(self):
        assert classify_intent("I see exposed wire near the panel") == "safety"

    def test_educational_safety_returns_industrial(self):
        assert classify_intent("What is arc flash?") == "industrial"

    def test_greeting_short_message(self):
        assert classify_intent("hi") == "greeting"

    def test_greeting_with_industrial_routes_industrial(self):
        assert classify_intent("hi my vfd is down") == "industrial"

    def test_help_pattern(self):
        assert classify_intent("what can you do") == "help"

    def test_documentation_request(self):
        assert classify_intent("do you have the manual for PowerFlex 525") == "documentation"

    def test_is_there_a_manual_phrasing(self):
        # 2026-04-19 audit — e4ced7d8 user phrasing that was missed in prod
        assert classify_intent("is there a manual that would show me the pin out") == "documentation"
        assert classify_intent("is there a datasheet for this") == "documentation"
        assert classify_intent("got a manual for the Pilz module") == "documentation"
        assert classify_intent("any documentation on this thing") == "documentation"
        assert classify_intent("show me the pinout for this sensor") == "documentation"

    def test_depth_request_detector(self):
        from shared.guardrails import detect_depth_request
        assert detect_depth_request("why?")
        assert detect_depth_request("explain why that matters")
        assert detect_depth_request("tell me more about overcurrent")
        assert detect_depth_request("go deeper on this")
        assert detect_depth_request("what does that mean")
        assert detect_depth_request("how does it work")
        assert not detect_depth_request("F12 fault on the drive")
        assert not detect_depth_request("")
        # Long messages (>400 chars) don't trigger even if they contain "why"
        long_msg = "The technician reported a fault at 3am why " + "x" * 400
        assert not detect_depth_request(long_msg)

    def test_scrub_fabricated_reflection(self):
        from shared.guardrails import scrub_fabricated_reflection
        # Fabricated — user never said they checked labels
        r = scrub_fabricated_reflection(
            "You've checked cable labels. What do they show?",
            "Can you find a manual",
        )
        assert "You've checked" not in r
        assert "What do they show?" in r
        # Genuine — user said they checked
        r2 = scrub_fabricated_reflection(
            "You've checked the voltage. What did you measure?",
            "I checked the voltage",
        )
        assert "You've checked" in r2
        # "pulled" fabrication — user said "pulled the big one" but reply says "removed the main power cable"
        r3 = scrub_fabricated_reflection(
            "You've removed the main power cable. What voltage is on the block?",
            "I just pulled the big one in the middle",
        )
        # "pulled" is in justifiers for "removed" verb — this SHOULD keep the reflection
        # (we can't detect Rule 21 elevation from verb alone — that needs noun-match)
        # So this test verifies the conservative behavior: don't strip when verb justified
        assert "You've removed" in r3
        # Non-reflection reply passes through unchanged
        r4 = scrub_fabricated_reflection(
            "What fault code is displayed?",
            "vfd is down",
        )
        assert r4 == "What fault code is displayed?"
        # Empty inputs
        assert scrub_fabricated_reflection("", "hello") == ""
        assert scrub_fabricated_reflection("Hello", "") == "Hello"

    def test_fault_code_pattern(self):
        assert classify_intent("What does F-201 mean") == "industrial"

    def test_equipment_name_pattern(self):
        assert classify_intent("PowerFlex 525 setup") == "industrial"

    def test_default_is_industrial(self):
        # Ambiguous queries default to industrial (not off_topic)
        assert classify_intent("can you look at this for me") == "industrial"

    def test_all_safety_keywords_detected(self):
        """Every safety keyword must trigger safety intent (not educational)."""
        for kw in SAFETY_KEYWORDS:
            msg = f"there is {kw} in the building"
            result = classify_intent(msg)
            assert result == "safety", f"Safety keyword '{kw}' classified as '{result}'"


# ---------------------------------------------------------------------------
# check_output
# ---------------------------------------------------------------------------


class TestCheckOutput:
    def test_strips_transcribing_on_text_only(self):
        resp = "Transcribing the nameplate. The motor is rated for 5HP."
        result = check_output(resp, intent="industrial", has_photo=False)
        assert "Transcribing" not in result

    def test_keeps_transcribing_on_photo(self):
        resp = "Transcribing the nameplate. The motor is rated for 5HP."
        result = check_output(resp, intent="industrial", has_photo=True)
        assert "Transcribing" in result

    def test_greeting_with_jargon_returns_greeting(self):
        resp = "Hello! The soft starter modbus overcurrent is..."
        result = check_output(resp, intent="greeting")
        # Should return a greeting variant, not the jargon-laden response
        assert "soft starter" not in result.lower()

    def test_help_with_jargon_returns_help_prompt(self):
        resp = "The variable frequency drive overcurrent..."
        result = check_output(resp, intent="help")
        assert "equipment or fault code" in result

    def test_system_prompt_leakage_blocked(self):
        resp = "As instructed in my system prompt, I should..."
        result = check_output(resp, intent="greeting")
        assert "system prompt" not in result.lower()

    def test_clean_industrial_passthrough(self):
        resp = "Check the VFD parameter P001 for overcurrent settings."
        result = check_output(resp, intent="industrial")
        assert result == resp


# ---------------------------------------------------------------------------
# detect_expertise_level
# ---------------------------------------------------------------------------


class TestDetectExpertiseLevel:
    def test_senior_short_with_abbreviations(self):
        assert detect_expertise_level("OC flt on plc tag") == "senior"

    def test_junior_uncertainty(self):
        assert detect_expertise_level("I'm new to this, not sure what to do") == "junior"

    def test_unknown_neutral_message(self):
        assert detect_expertise_level("the motor stopped") == "unknown"


# ---------------------------------------------------------------------------
# detect_emotional_state
# ---------------------------------------------------------------------------


class TestDetectEmotionalState:
    def test_pressured_deadline(self):
        assert detect_emotional_state("production down, my boss is angry") == "pressured"

    def test_neutral(self):
        assert detect_emotional_state("VFD showing F-201") == "neutral"

    def test_pressured_repeated_failure(self):
        assert detect_emotional_state("keeps tripping, third time this week") == "pressured"


# ---------------------------------------------------------------------------
# detect_session_followup
# ---------------------------------------------------------------------------


class TestDetectSessionFollowup:
    def test_idle_never_followup(self):
        assert detect_session_followup("you said check the fuse", {"asset": "VFD"}, "IDLE") is False

    def test_no_context_not_followup(self):
        assert detect_session_followup("tell me more", {}, "Q2") is False

    def test_active_session_with_signal(self):
        assert detect_session_followup("you mentioned a manual", {"asset": "pump"}, "Q2") is True

    def test_active_session_no_signal(self):
        assert detect_session_followup("ok", {"asset": "pump"}, "Q2") is False


# ---------------------------------------------------------------------------
# resolve_option_selection
# ---------------------------------------------------------------------------


class TestResolveOptionSelection:
    def test_numeric_selection(self):
        options = ["Check wiring", "Replace fuse", "Call electrician"]
        assert resolve_option_selection("2", options) == "Replace fuse"

    def test_option_prefix(self):
        options = ["Check wiring", "Replace fuse"]
        assert resolve_option_selection("option 1", options) == "Check wiring"

    def test_out_of_range_returns_none(self):
        options = ["A", "B"]
        assert resolve_option_selection("5", options) is None

    def test_non_numeric_returns_none(self):
        options = ["A", "B"]
        assert resolve_option_selection("check the fuse", options) is None

    def test_elaboration_appended(self):
        options = ["Check wiring", "Replace fuse"]
        result = resolve_option_selection("1 - yes and also check the ground connections please", options)
        assert result.startswith("Check wiring")
        assert "ground connections" in result


# ---------------------------------------------------------------------------
# vendor helpers
# ---------------------------------------------------------------------------


class TestVendorHelpers:
    def test_vendor_support_url_found(self):
        assert vendor_support_url("PowerFlex 525 by Allen-Bradley") == "rockwellautomation.com/support"

    def test_vendor_support_url_none(self):
        assert vendor_support_url("some unknown brand") is None

    def test_vendor_support_url_empty(self):
        assert vendor_support_url("") is None
        assert vendor_support_url(None) is None

    def test_vendor_name_found(self):
        assert vendor_name_from_text("Siemens SINAMICS G120") == "Siemens"

    def test_vendor_name_none(self):
        assert vendor_name_from_text("generic motor") is None

    def test_vendor_name_empty(self):
        assert vendor_name_from_text("") is None
        assert vendor_name_from_text(None) is None


# ---------------------------------------------------------------------------
# strip_mentions
# ---------------------------------------------------------------------------


class TestStripMentions:
    def test_strips_slack_mention(self):
        assert strip_mentions("<@U12345> check the VFD") == "check the VFD"

    def test_no_mention_passthrough(self):
        assert strip_mentions("check the VFD") == "check the VFD"
