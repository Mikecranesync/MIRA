"""Tests for `shared/print_translator.py` — pure intent + prompt logic.

No I/O, no DB, no network — mirrors the module under test.

The final section (`TestPrintTheoryMaxTokensEnvTunable`) additionally covers
`shared/engine.py::Supervisor._grounded_print_reply`'s use of
`PRINT_THEORY_MAX_TOKENS` — the one call site that turns this module's
messages into a router request. Still no real I/O: the worker fleet and
router are mocked (idiom borrowed from test_engine_general_question.py /
test_engine_drive_pack_fastpath.py).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from shared import print_translator
from shared.engine import Supervisor


# ── is_theory_request ────────────────────────────────────────────────────────


class TestIsTheoryRequest:
    def test_explain_this_print(self):
        assert print_translator.is_theory_request("explain this print") is True

    def test_what_does_this_circuit_do(self):
        assert print_translator.is_theory_request("what does this circuit do?") is True

    def test_theory_of_operation(self):
        assert print_translator.is_theory_request("theory of operation") is True

    def test_how_does_this_work(self):
        assert print_translator.is_theory_request("how does this work") is True

    def test_walk_me_through_this_print(self):
        assert print_translator.is_theory_request("walk me through this print") is True

    def test_case_insensitive(self):
        assert print_translator.is_theory_request("EXPLAIN THIS PRINT") is True

    def test_wiring_intake_caption_falls_through(self):
        assert print_translator.is_theory_request("add this wiring") is False

    def test_wiring_intake_with_asset_falls_through(self):
        assert print_translator.is_theory_request("CV-101 add this wiring") is False

    def test_unrelated_text_falls_through(self):
        assert print_translator.is_theory_request("what's the weather") is False

    def test_greeting_falls_through(self):
        assert print_translator.is_theory_request("hello") is False

    def test_empty_string_falls_through(self):
        assert print_translator.is_theory_request("") is False

    def test_none_falls_through(self):
        assert print_translator.is_theory_request(None) is False

    def test_nameplate_caption_does_not_steal(self):
        """A plain nameplate/drive caption must not be claimed by this module."""
        assert print_translator.is_theory_request("what drive is this?") is False


# ── build_theory_messages ────────────────────────────────────────────────────


class TestBuildTheoryMessages:
    def _vision_data(self, ocr_items=None, drawing_type="ladder logic"):
        return {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": ocr_items if ocr_items is not None else [],
            "drawing_type": drawing_type,
        }

    def test_returns_system_and_user_messages(self):
        messages = print_translator.build_theory_messages(
            "B64DATA", self._vision_data(["K10 contactor", "CR1"])
        )
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"

    def test_system_prompt_is_theory_system_prompt(self):
        messages = print_translator.build_theory_messages(
            "B64DATA", self._vision_data(["K10 contactor", "CR1"])
        )
        assert messages[0]["content"] == print_translator.THEORY_SYSTEM_PROMPT

    def test_system_prompt_has_all_six_headings(self):
        system = print_translator.THEORY_SYSTEM_PROMPT
        for heading in (
            "What this appears to be",
            "Main visible components",
            "Plain-English theory of operation",
            "What must be true for it to work",
            "What would stop it from working",
            "Unclear or unreadable items",
        ):
            assert heading in system

    def test_system_prompt_has_grounding_language(self):
        system = print_translator.THEORY_SYSTEM_PROMPT
        assert "According to this print" in system
        assert "NEVER invent" in system or "never invent" in system.lower()

    def test_user_content_is_image_then_text(self):
        messages = print_translator.build_theory_messages(
            "MYB64", self._vision_data(["K10 contactor"])
        )
        user_content = messages[1]["content"]
        assert isinstance(user_content, list)
        assert len(user_content) == 2
        assert user_content[0]["type"] == "image_url"
        assert "MYB64" in user_content[0]["image_url"]["url"]
        assert user_content[1]["type"] == "text"

    def test_user_text_contains_drawing_type(self):
        messages = print_translator.build_theory_messages(
            "B64", self._vision_data(["K10 contactor"], drawing_type="ladder logic")
        )
        text = messages[1]["content"][1]["text"]
        assert "ladder logic" in text

    def test_user_text_contains_every_ocr_item_verbatim(self):
        ocr_items = ["K10 contactor", "CR1", "W200"]
        messages = print_translator.build_theory_messages("B64", self._vision_data(ocr_items))
        text = messages[1]["content"][1]["text"]
        for item in ocr_items:
            assert item in text

    def test_user_text_has_no_label_not_in_ocr_items(self):
        """Grounding: the block must be built ONLY from the provided items."""
        ocr_items = ["K10 contactor", "CR1"]
        messages = print_translator.build_theory_messages("B64", self._vision_data(ocr_items))
        text = messages[1]["content"][1]["text"]
        ocr_lines = [line for line in text.splitlines() if line.startswith("- ")]
        assert ocr_lines == [f"- {item}" for item in ocr_items]

    def test_empty_ocr_items_gives_honest_fallback_line(self):
        messages = print_translator.build_theory_messages("B64", self._vision_data([]))
        text = messages[1]["content"][1]["text"]
        assert "No OCR labels were extracted" in text

    def test_missing_drawing_type_defaults(self):
        vision_data = {"classification": "ELECTRICAL_PRINT", "ocr_items": []}
        messages = print_translator.build_theory_messages("B64", vision_data)
        text = messages[1]["content"][1]["text"]
        assert "electrical drawing" in text

    def test_ocr_items_capped_at_80(self):
        many_items = [f"item-{i}" for i in range(100)]
        messages = print_translator.build_theory_messages("B64", self._vision_data(many_items))
        text = messages[1]["content"][1]["text"]
        assert "item-79" in text
        assert "item-80" not in text

    # ── evidence contract (Task E1) ──────────────────────────────────────────
    # Tower OP re-bench failures this locks down: (c05) a reply asserted part
    # numbers "not explicitly labeled in this view" while ocr_items held a
    # garbled fragment of them; (c03/c09) garbled OCR strings imported into
    # replies as if real tags; (general) answers never said which OCR
    # evidence they used. Always-present (bound even without a question).

    def test_user_text_carries_evidence_quoting_clause(self):
        messages = print_translator.build_theory_messages(
            "B64", self._vision_data(["K10 contactor"])
        )
        text = messages[1]["content"][1]["text"]
        assert "Evidence discipline" in text
        assert "Evidence:" in text

    def test_user_text_carries_garbled_token_discipline_clause(self):
        messages = print_translator.build_theory_messages(
            "B64", self._vision_data(["K10 contactor"])
        )
        text = messages[1]["content"][1]["text"]
        assert "unverified artifact" in text
        assert "not cleanly legible in THIS photo" in text

    def test_user_text_carries_absence_claim_discipline_clause(self):
        messages = print_translator.build_theory_messages(
            "B64", self._vision_data(["K10 contactor"])
        )
        text = messages[1]["content"][1]["text"]
        assert "Never claim a label or value is not labeled" in text
        assert "sheet not visible in this photo" in text


# ── format_theory_reply ──────────────────────────────────────────────────────


class TestFormatTheoryReply:
    def test_empty_raw_returns_fallback(self):
        assert print_translator.format_theory_reply("") == print_translator.FALLBACK_REPLY

    def test_none_raw_returns_fallback(self):
        assert print_translator.format_theory_reply(None) == print_translator.FALLBACK_REPLY

    def test_nonempty_raw_returned_unchanged(self):
        raw = "1. **What this appears to be**\nA motor control circuit."
        assert print_translator.format_theory_reply(raw) == raw

    def test_nonempty_raw_with_drawing_type_still_unchanged(self):
        raw = "Some explanation text."
        result = print_translator.format_theory_reply(raw, drawing_type="ladder logic")
        assert result == raw


# ── is_print_question (widened gate: device/wiring questions route to grounded) ─


class TestIsPrintQuestion:
    def test_what_devices_are_listed_regression(self):
        # The exact caption that hit the free-form LLM and hallucinated
        # ("ladder logic / timers / counters") — must now route to grounded.
        assert print_translator.is_print_question("what devices are listed in this print?") is True

    def test_theory_phrases_still_match(self):
        assert print_translator.is_print_question("explain this print") is True
        assert print_translator.is_print_question("theory of operation") is True

    def test_device_and_component_questions(self):
        assert print_translator.is_print_question("what components are in this print") is True
        assert print_translator.is_print_question("list the devices on this drawing") is True

    def test_wiring_and_tracing_questions(self):
        assert print_translator.is_print_question("trace this wire") is True
        assert print_translator.is_print_question("what feeds this motor") is True

    def test_case_insensitive(self):
        assert print_translator.is_print_question("WHAT DEVICES ARE ON THIS PRINT") is True

    def test_wiring_intake_caption_falls_through(self):
        # The wiring-intake flow owns "add this wiring".
        assert print_translator.is_print_question("add this wiring") is False

    def test_nameplate_caption_does_not_steal(self):
        assert print_translator.is_print_question("what drive is this?") is False

    def test_unrelated_text_falls_through(self):
        assert print_translator.is_print_question("what's the weather") is False

    def test_empty_and_none(self):
        assert print_translator.is_print_question("") is False
        assert print_translator.is_print_question(None) is False


# ── build_theory_messages(question=...) — grounded + targeted ──


class TestBuildTheoryMessagesWithQuestion:
    def _vd(self):
        return {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": ["-3/F1", "-3/E1"],
            "drawing_type": "schematic",
        }

    def test_question_is_appended_and_grounded(self):
        messages = print_translator.build_theory_messages(
            "B64", self._vd(), question="what devices are listed in this print?"
        )
        text = messages[1]["content"][1]["text"]
        assert "what devices are listed in this print?" in text
        assert "specifically asked" in text
        assert "never invent" in text.lower()
        # still grounded ONLY in the provided OCR items
        assert "-3/F1" in text and "-3/E1" in text

    def test_no_question_is_backward_compatible(self):
        messages = print_translator.build_theory_messages("B64", self._vd())
        text = messages[1]["content"][1]["text"]
        assert "specifically asked" not in text

    def test_blank_question_ignored(self):
        messages = print_translator.build_theory_messages("B64", self._vd(), question="   ")
        text = messages[1]["content"][1]["text"]
        assert "specifically asked" not in text

    def test_evidence_contract_clauses_present_alongside_question(self):
        """The three contract elements bind even WITH a question — they live
        in the always-present block, not the question-only extension."""
        messages = print_translator.build_theory_messages(
            "B64", self._vd(), question="is K5 shorted?"
        )
        text = messages[1]["content"][1]["text"]
        assert "Evidence discipline" in text
        assert "unverified artifact" in text
        assert "Never claim a label or value is not labeled" in text


# ── PRINT_THEORY_MAX_TOKENS — env-tunable grounded-cascade cap ──────────────
#
# `_grounded_print_reply`'s free-cascade fallback call to router.complete()
# hardcoded max_tokens=1200; two 2026-07-18 live turns truncated mid-sentence
# at exactly that cap. The cap is now read from PRINT_THEORY_MAX_TOKENS at
# CALL TIME (not import time), default 2000, guarded with `or "2000"` for the
# empty-string shape docker-compose's ${VAR:-} interpolation delivers
# in-container.


@pytest.fixture
def supervisor(tmp_path):
    """Supervisor with the worker fleet + router mocked — no network."""
    db_path = str(tmp_path / "print_theory_cap.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"):
            with patch("shared.engine.NameplateWorker"):
                with patch("shared.engine.RAGWorker"):
                    with patch("shared.engine.PrintWorker"):
                        with patch("shared.engine.PLCWorker"):
                            with patch("shared.engine.NemotronClient"):
                                with patch("shared.engine.InferenceRouter"):
                                    sup = Supervisor(
                                        db_path=db_path,
                                        openwebui_url="http://localhost:3000",
                                        api_key="test-key",
                                        collection_id="test-collection",
                                    )
    sup.router = MagicMock()
    sup.router.complete = AsyncMock(return_value=("A canned explanation.", {}))
    return sup


def _print_vision_data():
    return {
        "classification": "ELECTRICAL_PRINT",
        "ocr_items": ["K10 contactor"],
        "drawing_type": "ladder logic",
    }


class TestPrintTheoryMaxTokensEnvTunable:
    @pytest.mark.asyncio
    async def test_env_var_set_is_passed_through(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_MAX_TOKENS", "2222")
        await supervisor._grounded_print_reply(
            "B64DATA", "explain this print", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_args.kwargs["max_tokens"] == 2222

    @pytest.mark.asyncio
    async def test_env_var_unset_defaults_to_2000(self, supervisor, monkeypatch):
        monkeypatch.delenv("PRINT_THEORY_MAX_TOKENS", raising=False)
        await supervisor._grounded_print_reply(
            "B64DATA", "explain this print", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_args.kwargs["max_tokens"] == 2000

    @pytest.mark.asyncio
    async def test_env_var_empty_string_defaults_to_2000(self, supervisor, monkeypatch):
        """Compose ${VAR:-} interpolation delivers an empty string in-container
        — the mandatory `or "2000"` guard must catch it (a bare
        int(os.environ.get("PRINT_THEORY_MAX_TOKENS", "2000")) crashes on "")."""
        monkeypatch.setenv("PRINT_THEORY_MAX_TOKENS", "")
        await supervisor._grounded_print_reply(
            "B64DATA", "explain this print", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_args.kwargs["max_tokens"] == 2000


# ── PRINT_THEORY_FULL_RES — full-resolution image to the cascade theory call ─
#
# Production crushes photos to 1024 px for the local classifier and reused
# that crush for the cascade theory call. The R5-alpha probe (2026-07-19)
# measured serverless big-vision models (MiniMax-M3) reading dense table rows
# correctly at full resolution that the crushed image loses. The knob sends
# the caller's full-res bytes (interpret_b64 — already plumbed for the paid
# interpreter) to build_theory_messages instead. Default OFF.


class TestPrintTheoryFullRes:
    @pytest.mark.asyncio
    async def test_knob_on_uses_full_res_when_available(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_FULL_RES", "1")
        await supervisor._grounded_print_reply(
            "CRUSHED64",
            "explain this print",
            _print_vision_data(),
            "chat-1",
            interpret_b64="FULLRES64",
        )
        sent = str(supervisor.router.complete.await_args.args[0])
        assert "FULLRES64" in sent
        assert "CRUSHED64" not in sent

    @pytest.mark.asyncio
    async def test_knob_off_keeps_crushed_image(self, supervisor, monkeypatch):
        monkeypatch.delenv("PRINT_THEORY_FULL_RES", raising=False)
        await supervisor._grounded_print_reply(
            "CRUSHED64",
            "explain this print",
            _print_vision_data(),
            "chat-1",
            interpret_b64="FULLRES64",
        )
        sent = str(supervisor.router.complete.await_args.args[0])
        assert "CRUSHED64" in sent
        assert "FULLRES64" not in sent

    @pytest.mark.asyncio
    async def test_knob_on_without_full_res_falls_back_to_crushed(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_FULL_RES", "1")
        await supervisor._grounded_print_reply(
            "CRUSHED64", "explain this print", _print_vision_data(), "chat-1"
        )
        sent = str(supervisor.router.complete.await_args.args[0])
        assert "CRUSHED64" in sent

    @pytest.mark.asyncio
    async def test_knob_empty_string_is_off(self, supervisor, monkeypatch):
        """Compose ${PRINT_THEORY_FULL_RES:-} delivers "" in-container — off."""
        monkeypatch.setenv("PRINT_THEORY_FULL_RES", "")
        await supervisor._grounded_print_reply(
            "CRUSHED64",
            "explain this print",
            _print_vision_data(),
            "chat-1",
            interpret_b64="FULLRES64",
        )
        sent = str(supervisor.router.complete.await_args.args[0])
        assert "CRUSHED64" in sent
        assert "FULLRES64" not in sent


# ── PRINT_THEORY_STYLE=slim — raw-conditions prompt for strong vision models ─
#
# The R5 loop (2026-07-19) measured the full template (OCR block + evidence
# contract + six-section format) degrading strong vision models: fabricating
# verbosity around correct direct answers and reasoning burned past the
# router's retry cap, while the raw 3-sentence instruction scored the
# series-best 8.54. Slim reproduces raw conditions through production.


class TestPrintTheoryStyleSlim:
    def _msgs(self, question="what does K1 do?"):
        return print_translator.build_theory_messages(
            "B64IMG", _print_vision_data(), question=question
        )

    def test_default_full_keeps_template(self, monkeypatch):
        monkeypatch.delenv("PRINT_THEORY_STYLE", raising=False)
        msgs = self._msgs()
        assert msgs[0]["content"] == print_translator.THEORY_SYSTEM_PROMPT
        text = msgs[1]["content"][1]["text"]
        assert "OCR labels extracted" in text
        assert "Evidence discipline" in text

    def test_empty_string_knob_is_full(self, monkeypatch):
        """Compose ${PRINT_THEORY_STYLE:-} delivers "" in-container — full."""
        monkeypatch.setenv("PRINT_THEORY_STYLE", "")
        msgs = self._msgs()
        assert msgs[0]["content"] == print_translator.THEORY_SYSTEM_PROMPT

    def test_slim_drops_template_keeps_question(self, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_STYLE", "slim")
        msgs = self._msgs("what feeds this control unit?")
        assert msgs[0]["content"] == print_translator.SLIM_THEORY_SYSTEM_PROMPT
        text = msgs[1]["content"][1]["text"]
        assert "QUESTION: what feeds this control unit?" in text
        assert "OCR labels extracted" not in text
        assert "Evidence discipline" not in text
        assert "six" not in text.lower()
        # image still first content block, same wire shape as full
        assert msgs[1]["content"][0]["type"] == "image_url"
        assert "B64IMG" in msgs[1]["content"][0]["image_url"]["url"]

    def test_slim_keeps_deterministic_evidence(self, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_STYLE", "slim")
        vd = {**_print_vision_data(), "deterministic_evidence": ["13-14 = NO contact"]}
        msgs = print_translator.build_theory_messages("B64IMG", vd, question="is 13-14 NO?")
        text = msgs[1]["content"][1]["text"]
        assert "13-14 = NO contact" in text
        assert "Deterministic decoded evidence" in text

    def test_slim_without_question_asks_for_brief_explain(self, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_STYLE", "slim")
        msgs = self._msgs(question=None)
        text = msgs[1]["content"][1]["text"]
        assert "Explain what this print shows, briefly." in text

    def test_slim_system_carries_safety_floor(self):
        s = print_translator.SLIM_THEORY_SYSTEM_PROMPT
        assert "verify with" in s and "meter" in s
        assert "never shows live" in s


# ── PRINT_THEORY_VERIFY — self-verification second pass ──────────────────────
#
# R5-delta (2026-07-19) left five single-defect partials, four of which are
# second-look errors (misquoted terminal, paraphrased label, column-shift
# trace, dropped header tier). The verify pass re-reads the sheet against the
# model's own draft. Doctrine: fall-through on ANY failure — the draft is
# never lost, the turn is never eaten.


class TestBuildVerifyMessages:
    def test_shape_and_content(self):
        msgs = print_translator.build_verify_messages(
            "B64IMG", "K1 is at 3/E.", question="where is K1?"
        )
        assert msgs[0]["content"] == print_translator.VERIFY_SYSTEM_PROMPT
        assert msgs[1]["content"][0]["type"] == "image_url"
        assert "B64IMG" in msgs[1]["content"][0]["image_url"]["url"]
        text = msgs[1]["content"][1]["text"]
        assert "The technician's question was: where is K1?" in text
        assert "DRAFT ANSWER TO VERIFY AGAINST THE SHEET:\nK1 is at 3/E." in text

    def test_no_question_variant(self):
        msgs = print_translator.build_verify_messages("B64IMG", "draft text")
        text = msgs[1]["content"][1]["text"]
        assert "technician's question" not in text
        assert "DRAFT ANSWER TO VERIFY" in text


class TestPrintTheoryVerify:
    @pytest.mark.asyncio
    async def test_verify_on_second_call_replaces_draft(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_VERIFY", "1")
        supervisor.router.complete = AsyncMock(
            side_effect=[("draft with K5,3 typo", {}), ("corrected with X4,3.2", {})]
        )
        out = await supervisor._grounded_print_reply(
            "B64DATA", "which relays?", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_count == 2
        assert "corrected with X4,3.2" in out
        # second call's messages carry the draft
        second_msgs = supervisor.router.complete.await_args_list[1].args[0]
        assert "draft with K5,3 typo" in str(second_msgs)

    @pytest.mark.asyncio
    async def test_verify_empty_keeps_draft(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_VERIFY", "1")
        supervisor.router.complete = AsyncMock(side_effect=[("the draft", {}), ("", {})])
        out = await supervisor._grounded_print_reply(
            "B64DATA", "q?", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_count == 2
        assert "the draft" in out

    @pytest.mark.asyncio
    async def test_verify_exception_keeps_draft(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_VERIFY", "1")
        supervisor.router.complete = AsyncMock(
            side_effect=[("the draft", {}), RuntimeError("boom")]
        )
        out = await supervisor._grounded_print_reply(
            "B64DATA", "q?", _print_vision_data(), "chat-1"
        )
        assert "the draft" in out

    @pytest.mark.asyncio
    async def test_knob_off_single_call(self, supervisor, monkeypatch):
        monkeypatch.delenv("PRINT_THEORY_VERIFY", raising=False)
        supervisor.router.complete = AsyncMock(return_value=("only call", {}))
        await supervisor._grounded_print_reply("B64DATA", "q?", _print_vision_data(), "chat-1")
        assert supervisor.router.complete.await_count == 1

    @pytest.mark.asyncio
    async def test_knob_empty_string_off(self, supervisor, monkeypatch):
        """Compose ${PRINT_THEORY_VERIFY:-} delivers "" in-container — off."""
        monkeypatch.setenv("PRINT_THEORY_VERIFY", "")
        supervisor.router.complete = AsyncMock(return_value=("only call", {}))
        await supervisor._grounded_print_reply("B64DATA", "q?", _print_vision_data(), "chat-1")
        assert supervisor.router.complete.await_count == 1

    @pytest.mark.asyncio
    async def test_no_verify_when_draft_empty(self, supervisor, monkeypatch):
        monkeypatch.setenv("PRINT_THEORY_VERIFY", "1")
        supervisor.router.complete = AsyncMock(return_value=("", {}))
        out = await supervisor._grounded_print_reply(
            "B64DATA", "q?", _print_vision_data(), "chat-1"
        )
        assert supervisor.router.complete.await_count == 1
        assert out == print_translator.FALLBACK_REPLY


class TestVerifyPromptWording:
    """R5-epsilon regressions pinned (2026-07-19): c03 6->5 — the add-tiers
    clause let the verifier SWAP header tiers instead of accumulating; c09
    9->6.5 — the verifier ADDED a wrong attribution (Q2 vs Q4.C) that the
    draft never contained. Both are editor-prompt wording defects; these pins
    keep the two clauses from regressing."""

    def test_tiers_accumulate_clause_present(self):
        s = print_translator.VERIFY_SYSTEM_PROMPT
        assert "KEEP every function label the draft already" in s
        assert "one label never" in s and "replaces another" in s

    def test_never_add_attribution_clause_present(self):
        s = print_translator.VERIFY_SYSTEM_PROMPT
        assert "NEVER add a connection, terminal assignment, wire route, or device" in s
        assert "only permitted additions are" in s
