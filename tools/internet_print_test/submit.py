"""Submit an image through the REAL MIRA Telegram print-translator production path.

NO mocking. Imports the real `mira-bots/telegram/bot.py` (which builds
`engine = Supervisor(...)` at import), constructs Telegram-shaped stand-ins, and calls the
LITERAL production function:

    bot._try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context)  # bot.py:935

Three spies (wrap-never-replace) capture what the production path otherwise discards:
  * `engine.vision.process`                       -> classification / OCR / vision description
  * `printsense.render.format_graph_for_telegram` -> the structured PrintSynthGraph
  * `engine.router.complete`                      -> the free-cascade provider/model that answered

so we record, per submission: the classification, the full user-visible reply (every non-ack
chunk joined — see `final_text` vs `final_text_last_chunk`), the on-request `map` text, the
structured graph, whether the paid PrintSynth interpreter ran vs the free cascade
(`interpreter_used`), the ANSWERING provider/model (`provider`/`model` — truth, not config; see
`interpreter_provider`/`interpreter_model` for the paid interpreter's static config), why a
decline happened (`decline_reason`), latency, effort/max_tokens, and any error — verbatim, never
repaired.

This never opens a live Telegram connection and never touches a production bot token.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import traceback
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]


def _load_real_bot():
    """Reuse the proven importer from the existing eval runner (no duplication)."""
    for p in (str(_REPO / "tools" / "print_translator_eval"), str(_REPO)):
        if p not in sys.path:
            sys.path.insert(0, p)
    from run import _load_bot_module  # tools/print_translator_eval/run.py

    return _load_bot_module()


class _Msg:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def reply_text(self, text: str, **_kw) -> None:
        self.sent.append(str(text))


class _Update:
    def __init__(self, chat_id: str) -> None:
        self.message = _Msg()
        self.effective_chat = type("_Chat", (), {"id": chat_id})()


class _Bot:
    async def send_chat_action(self, **_kw) -> None:  # used by typing_action()
        return None


class _Context:
    def __init__(self) -> None:
        self.bot = _Bot()


# ---------------------------------------------------------------------------
# Pure helpers (no network, no Telegram) — factored out so test_runner.py can
# exercise them directly against synthetic inputs. See test_runner.py for the
# ack-strip/concat and decline_reason unit tests.
# ---------------------------------------------------------------------------

# The pre-processing ack the print-translator theory/interpreter path sends
# BEFORE calling the (often ~1-2 min) paid interpreter
# (mira-bots/telegram/bot.py::_try_print_translator_reply, gated on
# `_print_interpreter_configured()`). Matched by content, not position: the
# deterministic fast-path and the no-interpreter-configured path never send
# it, so a genuine one-message answer must never be mistaken for one. Keep
# this prefix in sync with bot.py if the ack copy changes.
_PRINT_ACK_PREFIX = "🔍 Reading your electrical print"


def _is_print_ack(message: str | None) -> bool:
    """True when `message` is the pre-processing ack, not part of the answer."""
    return bool(message) and message.startswith(_PRINT_ACK_PREFIX)


def _split_ack(messages: list[str]) -> tuple[str | None, list[str]]:
    """Separate the pre-processing ack (if present) from the answer chunks.

    bot.py always sends the ack first when it sends it at all, so only
    ``messages[0]`` is ever treated as one — and only when it actually
    matches the ack pattern, so a real answer that happens to arrive as the
    only/first message is never stripped.
    """
    if messages and _is_print_ack(messages[0]):
        return messages[0], list(messages[1:])
    return None, list(messages)


def _join_reply_messages(messages: list[str]) -> str | None:
    """The full user-visible answer: every non-ack message, in arrival order.

    A reply longer than Telegram's 4096-char cap is split into multiple
    ``sendMessage`` calls by ``bot.py::_reply_chunked``. The previous capture
    kept only the LAST chunk (see ``final_text_last_chunk`` at the call site)
    — silently discarding the rest of any multi-chunk reply; in one real run
    the correct answer landed in an earlier chunk than the one kept.
    """
    _, answer_messages = _split_ack(messages)
    if not answer_messages:
        return None
    return "\n\n".join(answer_messages)


def _decline_reason(*, handled: bool, classification: str | None, caption: str) -> str | None:
    """Why the print rung declined the turn — only meaningful when not handled.

    Derived from what the capture actually observed, checked deliberately in
    this order (mira-bots/telegram/bot.py::_try_print_translator_reply runs
    the wiring-intake check BEFORE the vision call, so "no classification was
    captured" is the observable signature of that carve-out, not "the vision
    call ran and returned nothing"):
      1. A classification WAS captured (the vision call ran) and it isn't
         ELECTRICAL_PRINT -> the ordinary "not a print" decline.
      2. No classification was captured (the vision call never ran) AND the
         caption is an explicit wiring-intake command -> bot.py's
         wiring-intake carve-out claimed the turn before any vision call.
      3. Anything else with no captured classification (e.g. the vision call
         raised) -> no more specific reason is derivable from the capture.
    """
    if handled:
        return None
    if classification and classification != "ELECTRICAL_PRINT":
        return f"classified_{classification}"
    mira_bots = str(_REPO / "mira-bots")
    if mira_bots not in sys.path:
        sys.path.insert(0, mira_bots)
    # Local import: lazy so this helper stays callable (pure-helper tests)
    # without going through `_load_real_bot()` first; mirrors the lazy
    # `printsense`/`run` imports elsewhere in this module.
    from shared import wiring_intake

    if wiring_intake.parse_wiring_intent(caption or "").kind == "intake":
        return "wiring_intake_carveout"
    return "pre_vision_decline"


def _resolve_answering_model(
    *,
    interpreter_used: bool,
    interpreter_usage: dict | None,
    cascade_usage: dict | None,
    handled: bool,
    interpreter_provider_default: str,
    interpreter_model_default: str,
) -> tuple[str | None, str | None]:
    """The provider/model that actually produced ``final_text`` — never the
    interpreter's static config. The previous capture always reported
    ``printsense.interpret.PROVIDER``/``DEFAULT_MODEL`` even when the free
    cascade answered, misattributing e.g. a together/gemma answer to the
    configured openai/gpt-5.5 interpreter.

    ``interpreter_used=True`` with no captured usage still means the
    configured interpreter answered — ``interpreter_usage`` only comes back
    empty if ``interpret_print`` stops calling ``_record_usage``, so the
    config values are a correct fallback there, not a guess.
    """
    if interpreter_used:
        if interpreter_usage:
            return interpreter_usage.get("provider"), interpreter_usage.get("model")
        return interpreter_provider_default, interpreter_model_default
    if cascade_usage:
        return cascade_usage.get("provider"), cascade_usage.get("model")
    if handled:
        return "deterministic", None
    return None, None


async def submit_image(raw_bytes: bytes, caption: str, *, chat_id: str = "internet-print-runner") -> dict:
    """Run one image through the real handler. Returns a verbatim capture dict."""
    os.environ.setdefault("MIRA_DB_PATH", str(_REPO / "tools" / "internet_print_test" / "_runner.sqlite"))
    bot, err = _load_real_bot()
    if bot is None:
        return {"handled": False, "bot_importable": False, "import_error": repr(err),
                "final_text": None, "graph": None}

    import printsense.interpret as _interp  # noqa: E402
    import printsense.render as _render  # noqa: E402

    captured: dict = {}

    # Spy 1 — the structured interpretation (otherwise discarded after render).
    _render_orig = _render.format_graph_for_telegram

    def _render_spy(graph):
        captured["graph"] = graph
        return _render_orig(graph)

    # Spy 2 — classification / OCR / vision description.
    _vision = bot.engine.vision
    _vision_orig = _vision.process

    async def _vision_spy(photo_b64, caption_):
        vd = await _vision_orig(photo_b64, caption_)
        captured["vision_data"] = vd
        return vd

    # Spy 3 — the free-cascade provider that actually answers when the paid
    # PrintSynth interpreter is unavailable/declines. Same wrap-never-replace
    # style as Spy 1/Spy 2, and the same seam
    # tools/print_translator_eval/run.py::_spy_engine already wraps for this
    # exact purpose. router.py has no after-the-fact seam here the way
    # printsense.interpret.pop_last_usage() does for the paid path below —
    # capturing usage directly off this call is the precise, stale-cache-free
    # source of truth (vs. e.g. InferenceRouter.last_model_for(chat_id), which
    # can hold a PRIOR turn's answer for a chat_id that didn't hit the cascade
    # this time).
    _router = bot.engine.router
    _router_complete_orig = _router.complete

    async def _router_complete_spy(messages, **kwargs):
        content, usage = await _router_complete_orig(messages, **kwargs)
        if content:
            captured["cascade_usage"] = usage
        return content, usage

    _render.format_graph_for_telegram = _render_spy
    _vision.process = _vision_spy
    _router.complete = _router_complete_spy

    vision_bytes = bot._resize_for_vision(raw_bytes)
    update, context = _Update(chat_id), _Context()
    t0 = time.monotonic()
    error = None
    handled = False
    try:
        handled = await bot._try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context)
    except Exception as e:  # noqa: BLE001 — record exactly what failed, never swallow
        error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    finally:
        _render.format_graph_for_telegram = _render_orig
        _vision.process = _vision_orig
        _router.complete = _router_complete_orig
    latency = round(time.monotonic() - t0, 2)

    graph = captured.get("graph")
    vd = captured.get("vision_data") or {}
    sent = update.message.sent
    classification = vd.get("classification")
    # True = Anthropic/OpenAI PrintSynth ran; False = cascade/deterministic/none.
    interpreter_used = graph is not None

    # Always drain the interpreter's usage slot, even when it isn't this
    # call's answer — it is a module-global "last call" slot (ZTA-1 cost
    # meter; printsense/interpret.py::_LAST_USAGE), so a stale entry left
    # behind by a FAILED interpreter attempt (API call succeeded, then JSON
    # parsing raised -> falls through to the cascade) must not leak into the
    # NEXT submission's capture.
    _last_interpreter_usage = _interp.pop_last_usage()
    interpreter_usage = _last_interpreter_usage if interpreter_used else None

    ack, _ = _split_ack(sent)
    final_text = _join_reply_messages(sent)
    provider, model = _resolve_answering_model(
        interpreter_used=interpreter_used,
        interpreter_usage=interpreter_usage,
        cascade_usage=captured.get("cascade_usage"),
        handled=handled,
        interpreter_provider_default=_interp.PROVIDER,
        interpreter_model_default=_interp.DEFAULT_MODEL,
    )
    map_text = None
    if graph is not None:
        try:
            map_text = _render.format_map_for_telegram(graph)
        except Exception as e:  # noqa: BLE001
            map_text = f"[map render error: {e}]"

    return {
        "bot_importable": True,
        "handled": handled,
        "classification": classification,
        "classification_confidence": vd.get("classification_confidence"),
        "drawing_type": vd.get("drawing_type"),
        "vision_description": vd.get("vision_result"),
        "ocr_items": vd.get("ocr_items"),
        "tesseract_text": vd.get("tesseract_text"),
        "ack": ack,
        # Full user-visible reply: every non-ack chunk, joined (was: last
        # chunk only, which silently dropped earlier chunks of a split
        # reply). See final_text_last_chunk for the previous semantics.
        "final_text": final_text,
        # Previous (chunk-losing) semantics, kept for cross-run comparability.
        "final_text_last_chunk": sent[-1] if sent else None,
        "all_messages": list(sent),
        "map_text": map_text,              # the on-request "map" follow-up (called directly on the graph)
        "graph": graph.model_dump() if graph is not None else None,
        "interpreter_used": interpreter_used,
        # ANSWERING truth (who actually produced `final_text`) — NOT the
        # interpreter's static config. A cascade answer (e.g. together/gemma)
        # must never be reported as the configured openai/gpt-5.5 interpreter
        # just because PRINT_VISION_PROVIDER defaults to "openai".
        "provider": provider,
        "model": model,
        # The PrintSynth interpreter's CONFIGURED provider/model
        # (PRINT_VISION_PROVIDER / PRINT_VISION_MODEL) — meaningful only when
        # interpreter_used is True. "provider"/"model" above are the
        # answering truth; these are the static config for anyone who wants
        # it specifically.
        "interpreter_provider": _interp.PROVIDER,
        "interpreter_model": _interp.DEFAULT_MODEL,
        "decline_reason": _decline_reason(
            handled=handled, classification=classification, caption=caption
        ),
        "effort": _interp.EFFORT,
        "max_tokens": _interp.MAX_TOKENS,
        # SUMMED free-cascade token usage of a PRINT_THEORY_SELF_CONSISTENCY run:
        # the engine records the total across all samples into the interpret slot
        # (drained above), surfaced here so a best-of-N bench envelope can price
        # the whole multi-sample turn. None on single-sample / paid-interpreter runs.
        "self_consistency_usage": _last_interpreter_usage if not interpreter_used else None,
        "latency_s": latency,
        "error": error,
    }


def submit_image_sync(raw_bytes: bytes, caption: str, **kw) -> dict:
    return asyncio.run(submit_image(raw_bytes, caption, **kw))
