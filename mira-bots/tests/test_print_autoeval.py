"""Evaluator units for the per-turn print autoeval (shared/print_autoeval.py).

Hermetic, $0, truth-free — the checks run on answer text + the live photo's own
OCR items. Pins: negation-aware state-claim P0, spend-law P0, drift/invented P1
with the empty-OCR skip, caveat tripwire, JSON round-trip, grader-unavailable
degrade, the flood-guard limiter, and the compose ``${VAR:-}`` env knob shape."""

from __future__ import annotations

import json
import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

pytest.importorskip("pydantic")

from shared import print_autoeval  # noqa: E402


def _eval(answer, ocr_items=None, usage=None, vision_data=None, question="test question", **kw):
    return print_autoeval.evaluate_print_turn(
        question,
        answer,
        vision_data if vision_data is not None else {"ocr_items": ocr_items or []},
        usage,
        1.5,
        **kw,
    )


def _classes(result):
    return [f["class"] for f in result["flags"]]


class TestStateClaim:
    def test_bare_assertion_is_p0(self):
        r = _eval("The contactor is energized.")
        assert r["severity"] == "P0"
        assert "unsupported_state_claim" in _classes(r)

    def test_honest_negation_passes(self):
        r = _eval("The print does not show whether K44 is energized.")
        assert "unsupported_state_claim" not in _classes(r)

    def test_contrast_after_negator_rearms(self):
        r = _eval("The print does not show live state, but it is energized.")
        assert "unsupported_state_claim" in _classes(r)


class TestSpendLaw:
    _PAID = {"provider": "openai", "input_tokens": 1000, "output_tokens": 1000}

    def test_paid_spend_on_deterministic_branch_is_p0(self):
        r = _eval("ok", usage=self._PAID, branch="deterministic_fastpath")
        assert "paid_spend_on_free_path" in _classes(r)

    def test_sanctioned_paid_spend_is_info_only(self):
        r = _eval("ok", usage=self._PAID, branch="theory", interpreter_configured=True)
        assert "paid_spend_on_free_path" not in _classes(r)
        assert r["estimated_cost_usd"] > 0

    def test_free_cascade_usage_is_zero_cost(self):
        r = _eval("ok", usage={"provider": "together", "model": "google/gemma-3n-E4B-it"})
        assert r["estimated_cost_usd"] == 0.0
        assert r["provider"] == "together"


class TestTagGrounding:
    def test_drift_p1_on_lev1_pair(self):
        r = _eval("Wire V7301 feeds the coil.", ocr_items=["-W7301"])
        assert "ocr_identifier_drift" in _classes(r)

    def test_grounded_tag_not_flagged(self):
        r = _eval("Relay -27/K44 drops out.", ocr_items=["-27/K44"])
        assert "invented_tags" not in _classes(r)
        assert "ocr_identifier_drift" not in _classes(r)

    def test_invented_tag_p1(self):
        r = _eval("Contactor K911 is in the main circuit.", ocr_items=["-27/K44"])
        assert "invented_tags" in _classes(r)

    def test_empty_ocr_skips_both_lanes(self):
        r = _eval("Contactor K911 is in the main circuit.", ocr_items=[])
        assert "invented_tags" not in _classes(r)
        assert "ocr_identifier_drift" not in _classes(r)
        assert "invented_tags" in r["skipped"]
        assert "ocr_identifier_drift" in r["skipped"]


class TestCaveatTripwire:
    def test_verdict_without_caveat_is_p1(self):
        r = _eval("Contact 13/14 is normally open.")
        assert "missing_caveat" in _classes(r)

    def test_verdict_with_caveat_is_clean(self):
        r = _eval("Contact 13/14 is normally open. Verify with a meter before working.")
        assert "missing_caveat" not in _classes(r)


class TestResultShape:
    def test_info_lanes_and_json_round_trip(self):
        r = _eval(
            "I can't read that section — please retake the photo. "
            "Verify with a meter before relying on this."
        )
        assert r["refusal"] is True
        assert r["safety_language"] is True
        assert json.loads(json.dumps(r)) == r  # log_turn meta serialization

    def test_ok_severity_when_clean(self):
        r = _eval("This sheet shows a start/stop circuit. Verify with a meter.")
        assert r["severity"] == "ok"
        assert r["flags"] == []

    def test_grader_unavailable_degrades(self, monkeypatch):
        import printsense.benchmarks as _pb

        # None in sys.modules makes the submodule import raise; the parent
        # attribute must also go away or the from-import short-circuits on it.
        monkeypatch.setitem(sys.modules, "printsense.benchmarks.single_photo_grader", None)
        monkeypatch.delattr(_pb, "single_photo_grader", raising=False)
        r = print_autoeval.evaluate_print_turn("q", "The coil is energized.", None, None, 1.0)
        assert r["grader_available"] is False
        assert "unsupported_state_claim" in r["skipped"]


class TestAlertLimiter:
    def test_first_p0_allowed_then_class_cooldown(self):
        lim = print_autoeval.AlertRateLimiter(max_per_hour=5, per_flag_cooldown_s=900)
        assert lim.allow(["unsupported_state_claim"], now=0.0) is True
        assert lim.allow(["unsupported_state_claim"], now=10.0) is False
        assert lim.allow(["unsupported_state_claim"], now=901.0) is True

    def test_different_class_allowed_within_cooldown(self):
        lim = print_autoeval.AlertRateLimiter()
        assert lim.allow(["unsupported_state_claim"], now=0.0) is True
        assert lim.allow(["paid_spend_on_free_path"], now=10.0) is True

    def test_global_hourly_cap(self):
        lim = print_autoeval.AlertRateLimiter(max_per_hour=2, per_flag_cooldown_s=1)
        assert lim.allow(["a"], now=0.0) is True
        assert lim.allow(["b"], now=10.0) is True
        assert lim.allow(["c"], now=20.0) is False  # cap
        assert lim.allow(["d"], now=3700.0) is True  # window expired


class TestEnabledKnob:
    def test_empty_string_means_on(self, monkeypatch):
        monkeypatch.setenv("PRINT_AUTOEVAL_ENABLED", "")  # compose ${VAR:-} shape
        assert print_autoeval.enabled() is True

    def test_zero_disables(self, monkeypatch):
        monkeypatch.setenv("PRINT_AUTOEVAL_ENABLED", "0")
        assert print_autoeval.enabled() is False

    def test_unset_means_on(self, monkeypatch):
        monkeypatch.delenv("PRINT_AUTOEVAL_ENABLED", raising=False)
        assert print_autoeval.enabled() is True


class TestDegenerateOutputRules:
    """v2 rules written by the 2026-07-18 live garbage turns: two answers
    degenerated into K1..K226 / "A1".."A201" enumeration, truncated at the
    token cap, with 0 OCR items — and v1 graded both ok."""

    def test_enumeration_run_is_p0(self):
        answer = "Contactors shown: " + ", ".join(f"K{i}" for i in range(1, 21)) + "."
        r = _eval(answer, ocr_items=["-27/K44"])
        assert "degenerate_enumeration" in _classes(r)
        assert r["severity"] == "P0"

    def test_quoted_enumeration_fires_too(self):
        answer = "Components: " + ", ".join(f'"A{i}"' for i in range(1, 18)) + "."
        r = _eval(answer, ocr_items=["-27/K44"])
        assert "degenerate_enumeration" in _classes(r)

    def test_short_legit_list_does_not_fire(self):
        r = _eval("K1 and K2 interlock with K3. Verify with a meter.", ocr_items=["K1", "K2", "K3"])
        assert "degenerate_enumeration" not in _classes(r)

    def test_non_consecutive_tags_do_not_fire(self):
        answer = "Refs: " + ", ".join(f"K{i}" for i in range(1, 80, 4)) + " appear."
        r = _eval(answer, ocr_items=["K1"])
        assert "degenerate_enumeration" not in _classes(r)

    def test_tag_flood_without_ocr_is_p1(self):
        tags = [f"{fam}{n}" for fam, n in zip("KMSFRQXUKMSFRQXUKMSFRQXU", range(3, 99, 4))]
        r = _eval("Devices: " + ", ".join(tags) + " are present.", ocr_items=[])
        assert "tag_flood_without_ocr" in _classes(r)
        assert "degenerate_enumeration" not in _classes(r)  # no consecutive run

    def test_no_flood_when_ocr_present(self):
        tags = [f"K{n}" for n in range(3, 99, 4)]
        r = _eval("Devices: " + ", ".join(tags) + " are present.", ocr_items=["K3"])
        assert "tag_flood_without_ocr" not in _classes(r)

    def test_cap_truncation_on_long_reply_ending_mid_list(self):
        answer = ("This print shows a control circuit. " * 60) + "Also K224, K225, K226,"
        assert len(answer) >= 2000
        r = _eval(answer, ocr_items=["K1"])
        assert "cap_truncation" in _classes(r)

    def test_no_truncation_flag_on_proper_ending(self):
        answer = ("This print shows a control circuit. " * 60) + "Verify with a meter."
        r = _eval(answer, ocr_items=["K1"])
        assert "cap_truncation" not in _classes(r)

    def test_live_garbage_replica_now_fully_flagged(self):
        """The exact 2026-07-18 shape: prose prefix, runaway consecutive run,
        trailing comma at the cap, zero OCR items — v1 said ok; v2 says P0
        with all three classes."""
        answer = (
            "**1. What this appears to be**\n\nAccording to this print, this is a "
            "circuit diagram for the inputs PLC. Several contactors are shown, "
            "such as " + ", ".join(f"K{i}" for i in range(1, 400)) + ","
        )
        assert len(answer) >= 2000  # the live answers were 4KB+
        r = _eval(answer, ocr_items=[])
        classes = _classes(r)
        assert r["severity"] == "P0"
        assert "degenerate_enumeration" in classes
        assert "tag_flood_without_ocr" in classes
        assert "cap_truncation" in classes


class TestOcrFloorDeadRule:
    """v2 rule (PR-C keep-alive): a print turn ran with a dead OCR floor
    (ocr_source="none") while the floor was expected up
    (OCR_EXPECT_TESSERACT=1) — pages P0 through the existing autoeval alert
    pipeline instead of rotting silently like the 2026-07 glm-ocr lane did."""

    _DEAD = {"classification": "ELECTRICAL_PRINT", "ocr_items": [], "ocr_source": "none"}

    def test_dead_floor_is_p0_when_expected(self, monkeypatch):
        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        r = _eval("Some answer text.", vision_data=self._DEAD)
        assert "ocr_floor_dead" in _classes(r)
        assert r["severity"] == "P0"

    def test_does_not_fire_when_env_absent(self, monkeypatch):
        monkeypatch.delenv("OCR_EXPECT_TESSERACT", raising=False)
        r = _eval("Some answer text.", vision_data=self._DEAD)
        assert "ocr_floor_dead" not in _classes(r)

    def test_does_not_fire_when_ocr_source_absent(self, monkeypatch):
        # Backward compatible: rows/turns captured before PR-A have no
        # ocr_source key at all — must not fire.
        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        r = _eval(
            "Some answer text.",
            vision_data={"classification": "ELECTRICAL_PRINT", "ocr_items": []},
        )
        assert "ocr_floor_dead" not in _classes(r)

    def test_does_not_fire_when_floor_healthy(self, monkeypatch):
        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        r = _eval(
            "Some answer text.",
            vision_data={
                "classification": "ELECTRICAL_PRINT",
                "ocr_items": [],
                "ocr_source": "tesseract",
            },
        )
        assert "ocr_floor_dead" not in _classes(r)

    def test_does_not_fire_when_not_electrical_print(self, monkeypatch):
        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1")
        r = _eval(
            "Some answer text.",
            vision_data={"classification": "NAMEPLATE", "ocr_items": [], "ocr_source": "none"},
        )
        assert "ocr_floor_dead" not in _classes(r)

    def test_fires_with_whitespace_padded_env(self, monkeypatch):
        # Strip-normalized env read: whitespace must not prevent firing.
        # Parity with vision_worker.ocr_lane_report() idiom.
        monkeypatch.setenv("OCR_EXPECT_TESSERACT", "1 ")
        r = _eval("Some answer text.", vision_data=self._DEAD)
        assert "ocr_floor_dead" in _classes(r)
        assert r["severity"] == "P0"


class TestFalseAbsenceClaimRule:
    """Task E1: the reply claims a label/value is absent from the print
    without having checked the OCR ground-truth block first — tonight's
    Tower OP c05 failure ("The part numbers are not explicitly labeled in
    this view." while ocr_items held a garbled fragment of the exact part
    number, xSi-MErHO <- XS1-N18PC410). MUST NOT fire on the honest,
    required sheet-absence phrasing ("depends on a sheet not visible in
    this photo") — that stays as-is per the prompt contract."""

    _C05_ANSWER = "The part numbers are not explicitly labeled in this view."

    def test_c05_shape_fires_p1(self):
        r = _eval(self._C05_ANSWER, ocr_items=["xSi-MErHO"])
        assert "false_absence_claim" in _classes(r)
        flag = next(f for f in r["flags"] if f["class"] == "false_absence_claim")
        assert flag["severity"] == "P1"
        assert flag["detail"]  # the matched absence phrase, not blank

    def test_silent_when_ocr_items_empty(self):
        r = _eval(self._C05_ANSWER, ocr_items=[])
        assert "false_absence_claim" not in _classes(r)

    def test_silent_on_honest_sheet_absence(self):
        r = _eval(
            "The answer depends on a sheet not visible in this photo.",
            ocr_items=["-27/K44"],
        )
        assert "false_absence_claim" not in _classes(r)

    def test_silent_when_no_absence_phrase(self):
        r = _eval(
            "This sheet shows a start/stop circuit. Verify with a meter.",
            ocr_items=["-27/K44"],
        )
        assert "false_absence_claim" not in _classes(r)

    def test_severity_stays_p1_and_existing_rules_unaffected(self):
        r = _eval(self._C05_ANSWER, ocr_items=["xSi-MErHO"])
        assert r["severity"] == "P1"
        assert not any(f["severity"] == "P0" for f in r["flags"])
        assert _classes(r) == ["false_absence_claim"]  # nothing else on this input

    def test_fires_on_no_part_numbers_visible_phrasing(self):
        r = _eval("No part numbers are visible on this sheet.", ocr_items=["Q1.2-Q12.2"])
        assert "false_absence_claim" in _classes(r)

    def test_fires_on_not_specified_phrasing(self):
        r = _eval("The device rating is not specified on this print.", ocr_items=["K44"])
        assert "false_absence_claim" in _classes(r)

    def test_fires_on_not_indicated_and_not_marked_phrasings(self):
        r1 = _eval("The torque rating is not indicated on this print.", ocr_items=["K44"])
        r2 = _eval("The wire gauge is not marked on this drawing.", ocr_items=["K44"])
        assert "false_absence_claim" in _classes(r1)
        assert "false_absence_claim" in _classes(r2)

    def test_mixed_reply_still_fires_on_its_own_sentence(self):
        """A genuine false-absence claim must not be masked by an unrelated,
        honest sheet caveat elsewhere in the same reply (per-sentence, not
        whole-reply, scoping — see _false_absence_phrase)."""
        r = _eval(
            "The part numbers are not explicitly labeled in this view. "
            "Separately, the answer depends on a sheet not visible in this photo.",
            ocr_items=["xSi-MErHO"],
        )
        assert "false_absence_claim" in _classes(r)

    def test_same_sentence_absence_and_sheet_language_does_not_fire(self):
        """When the SAME sentence carries both, it reads as one honest
        composite claim ("not specified because the sheet isn't visible")
        rather than a false claim about content that was actually there."""
        r = _eval(
            "The part number is not specified because the sheet is not visible in this photo.",
            ocr_items=["xSi-MErHO"],
        )
        assert "false_absence_claim" not in _classes(r)

    # ── review fix wave: adjacent-sentence guard window (Finding 1) ────────

    def test_two_sentence_honest_composite_does_not_fire(self):
        """The same honest composite as
        test_same_sentence_absence_and_sheet_language_does_not_fire, but
        split across two sentences by a period instead of "because" — the
        real two-sentence phrasing the same-sentence-only guard used to miss
        (review finding: this used to fire, wrongly)."""
        r = _eval(
            "The part number is not specified. "
            "This is because the sheet is not visible in this photo.",
            ocr_items=["xSi-MErHO"],
        )
        assert "false_absence_claim" not in _classes(r)

    def test_far_apart_honest_caveat_still_fires(self):
        """The guard window must not over-suppress: a false claim with an
        honest sheet-absence mention several sentences later (not the
        adjacent/tight composite above) must still fire."""
        r = _eval(
            "The part numbers are not explicitly labeled in this view. "
            "The relay coils are wired through the top terminal block. "
            "The contactor auxiliary contacts feed back to the PLC input card. "
            "Verify continuity with a meter before assuming a signal path. "
            "Separately, the answer to your other question about sheet 89 "
            "depends on a sheet not visible in this photo.",
            ocr_items=["xSi-MErHO"],
        )
        assert "false_absence_claim" in _classes(r)

    # ── review fix wave: hedge/contraction breadth (Finding 2) ─────────────

    def test_fires_on_arent_contraction(self):
        r = _eval("The ratings aren't labeled on this print.", ocr_items=["K44"])
        assert "false_absence_claim" in _classes(r)

    def test_fires_on_bare_unlabeled_form(self):
        r = _eval("The part numbers are unlabeled.", ocr_items=["K44"])
        assert "false_absence_claim" in _classes(r)

    def test_fires_on_clearly_adverb_variant(self):
        r = _eval("The device rating is not clearly labeled on this drawing.", ocr_items=["K44"])
        assert "false_absence_claim" in _classes(r)


class TestAskedModuleUnresolvedRule:
    """The 2026-07-19 Tower OP re-benchmark blind spot: false_absence_claim
    structurally cannot catch a wrong-row lookup — nothing is claimed absent
    and every quoted phrase can be verbatim-real print text, but the row
    belongs to a DIFFERENT module. Two live shapes: asked X4.4 LED 5, got the
    X4.3 LED 1 row with no mention of X4.4 at all; asked X6.3 elements 5-8,
    got X6.1/X6.2 row text presented as the answer. Fixtures use fictional
    9x-series module refs (X9.3/X9.4) per repo convention — never real print
    content."""

    _Q = "What does it mean when module X9.4 LED 5 flashes?"
    _WRONG_ROW_ANSWER = (
        "Looking at the table, X9.3 LED 1 flashing indicates a communication "
        "fault on that input channel. Cycle power to clear it."
    )

    def test_fires_on_wrong_row_answer(self):
        r = _eval(self._WRONG_ROW_ANSWER, ocr_items=["X9.4", "X9.3"], question=self._Q)
        assert "asked_module_unresolved" in _classes(r)
        flag = next(f for f in r["flags"] if f["class"] == "asked_module_unresolved")
        assert flag["severity"] == "P1"
        assert flag["detail"]  # names the asked ref, not blank

    def test_severity_p1_and_no_p0_leak(self):
        r = _eval(self._WRONG_ROW_ANSWER, ocr_items=["X9.4", "X9.3"], question=self._Q)
        assert r["severity"] == "P1"
        assert not any(f["severity"] == "P0" for f in r["flags"])

    def test_silent_when_answer_mentions_asked_ref(self):
        answer = "X9.4 LED 5 flashing indicates a communication fault on that input."
        r = _eval(answer, ocr_items=["X9.4", "X9.3"], question=self._Q)
        assert "asked_module_unresolved" not in _classes(r)

    def test_silent_on_honest_refusal(self):
        answer = "I couldn't read that table row — send a clearer photo."
        r = _eval(answer, ocr_items=["X9.4"], question=self._Q)
        assert "asked_module_unresolved" not in _classes(r)

    def test_silent_when_no_coordinate_in_question(self):
        r = _eval(
            self._WRONG_ROW_ANSWER,
            ocr_items=["X9.4", "X9.3"],
            question="what does this print show?",
        )
        assert "asked_module_unresolved" not in _classes(r)

    def test_silent_when_evidence_lacks_asked_ref(self):
        r = _eval(self._WRONG_ROW_ANSWER, ocr_items=["X9.3"], question=self._Q)
        assert "asked_module_unresolved" not in _classes(r)

    def test_silent_on_bare_module_mention_without_element_index(self):
        """Both parts are required to arm — a general "what is X9.4?"
        question has no single row to get wrong."""
        r = _eval(
            "X9.4 is a digital input module on this rack.",
            ocr_items=["X9.4"],
            question="What is module X9.4 used for?",
        )
        assert "asked_module_unresolved" not in _classes(r)

    def test_case_insensitive_dash_tolerant_mention_suppresses(self):
        answer = "Per the table, -x9.4 led 5 indicates a comm fault on that channel."
        r = _eval(answer, ocr_items=["X9.4", "X9.3"], question=self._Q)
        assert "asked_module_unresolved" not in _classes(r)

    def test_fires_on_elements_range_phrasing(self):
        q = "For module X9.4, what do elements 5-8 lighting together mean?"
        answer = "On X9.3, elements 1-4 lighting together mean a network fault upstream."
        r = _eval(answer, ocr_items=["X9.4", "X9.3"], question=q)
        assert "asked_module_unresolved" in _classes(r)


def test_format_alert_caps_and_omits_pii():
    r = _eval("The contactor is energized. " + "x" * 900)
    msg = print_autoeval.format_alert(r)
    assert len(msg) <= 500
    assert "test question" not in msg  # no question text in a public topic
    assert "best-effort attribution" in msg
