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


def _eval(answer, ocr_items=None, usage=None, vision_data=None, **kw):
    return print_autoeval.evaluate_print_turn(
        "test question",
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


def test_format_alert_caps_and_omits_pii():
    r = _eval("The contactor is energized. " + "x" * 900)
    msg = print_autoeval.format_alert(r)
    assert len(msg) <= 500
    assert "test question" not in msg  # no question text in a public topic
    assert "best-effort attribution" in msg
