"""Submit an image through the REAL MIRA Telegram print-translator production path.

NO mocking. Imports the real `mira-bots/telegram/bot.py` (which builds
`engine = Supervisor(...)` at import), constructs Telegram-shaped stand-ins, and calls the
LITERAL production function:

    bot._try_print_translator_reply(raw_bytes, vision_bytes, caption, update, context)  # bot.py:935

Two spies (wrap-never-replace) capture what the production path otherwise discards:
  * `engine.vision.process`                       -> classification / OCR / vision description
  * `printsense.render.format_graph_for_telegram` -> the structured PrintSynthGraph

so we record, per submission: the classification, the EXACT user-facing reply (byte-for-byte),
the on-request `map` text, the structured graph, whether the Anthropic interpreter ran vs the
No-Anthropic cascade, latency, model/effort/provider, and any error — verbatim, never repaired.

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

    _render.format_graph_for_telegram = _render_spy
    _vision.process = _vision_spy

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
    latency = round(time.monotonic() - t0, 2)

    graph = captured.get("graph")
    vd = captured.get("vision_data") or {}
    sent = update.message.sent
    # The handler sends the "🔍 Reading…" ack first (if configured) then the answer.
    final_text = sent[-1] if sent else None
    ack = sent[0] if len(sent) > 1 else None
    map_text = None
    if graph is not None:
        try:
            map_text = _render.format_map_for_telegram(graph)
        except Exception as e:  # noqa: BLE001
            map_text = f"[map render error: {e}]"

    return {
        "bot_importable": True,
        "handled": handled,
        "classification": vd.get("classification"),
        "classification_confidence": vd.get("classification_confidence"),
        "drawing_type": vd.get("drawing_type"),
        "vision_description": vd.get("vision_result"),
        "ocr_items": vd.get("ocr_items"),
        "tesseract_text": vd.get("tesseract_text"),
        "ack": ack,
        "final_text": final_text,          # EXACT user-facing text, byte-for-byte, unrepaired
        "all_messages": list(sent),
        "map_text": map_text,              # the on-request "map" follow-up (called directly on the graph)
        "graph": graph.model_dump() if graph is not None else None,
        "interpreter_used": graph is not None,  # True = Anthropic PrintSynth ran; False = cascade/none
        "model": _interp.DEFAULT_MODEL,
        "provider": _interp.PROVIDER,
        "effort": _interp.EFFORT,
        "max_tokens": _interp.MAX_TOKENS,
        "latency_s": latency,
        "error": error,
    }


def submit_image_sync(raw_bytes: bytes, caption: str, **kw) -> dict:
    return asyncio.run(submit_image(raw_bytes, caption, **kw))
