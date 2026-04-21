"""Telegram rendering — NormalizedChatResponse → MarkdownV2 + InlineKeyboardMarkup dict."""

from __future__ import annotations

import re

from shared.chat.types import NormalizedChatResponse

_SPECIAL = re.compile(r"([_*\[\]()~`>#+=|{}.!\-])")


def _esc(text: str) -> str:
    """Escape MarkdownV2 special characters."""
    return _SPECIAL.sub(r"\\\1", str(text))


def render_telegram(response: NormalizedChatResponse) -> tuple[str, dict | None]:
    """Convert NormalizedChatResponse to (text, reply_markup).

    text uses MarkdownV2 formatting.
    reply_markup is a Telegram InlineKeyboardMarkup dict, or None.
    """
    keyboard_rows: list[list[dict]] = []

    if not response.blocks:
        text = _esc(response.text)
        if response.suggestions:
            keyboard_rows.append([{"text": s, "callback_data": s} for s in response.suggestions])
        return text, ({"inline_keyboard": keyboard_rows} if keyboard_rows else None)

    parts: list[str] = []
    for block in response.blocks:
        kind = block.kind
        data = block.data

        if kind == "header":
            parts.append(f"*{_esc(data.get('text', ''))}*")

        elif kind == "paragraph":
            parts.append(_esc(data.get("text", "")))

        elif kind == "bullet_list":
            items = data.get("items", [])
            parts.append("\n".join(f"• {_esc(i)}" for i in items))

        elif kind == "key_value":
            pairs = data.get("pairs", [])
            parts.append("\n".join(f"*{_esc(str(k))}:* {_esc(str(v))}" for k, v in pairs))

        elif kind == "divider":
            parts.append("─────────────")

        elif kind == "citation":
            src = data.get("source", data.get("text", ""))
            parts.append(f"_{_esc(src)}_")

        elif kind == "warning":
            msg = data.get("text", data.get("message", ""))
            parts.append(f"⚠️ *{_esc(msg)}*")

        elif kind == "code":
            code = data.get("code", data.get("text", ""))
            lang = data.get("lang", "")
            parts.append(f"```{lang}\n{code}\n```")

        elif kind == "button_row":
            buttons = data.get("buttons", [])
            row = [
                {"text": b.get("label", ""), "callback_data": b.get("action", b.get("label", ""))}
                for b in buttons
                if b.get("label")
            ]
            if row:
                keyboard_rows.append(row)

        elif kind == "suggestion_chips":
            chips = data.get("chips", data.get("suggestions", []))
            row = [{"text": c, "callback_data": c} for c in chips if c]
            if row:
                keyboard_rows.append(row)

    if response.suggestions:
        keyboard_rows.append([{"text": s, "callback_data": s} for s in response.suggestions])

    text = "\n\n".join(p for p in parts if p) or _esc(response.text)
    return text, ({"inline_keyboard": keyboard_rows} if keyboard_rows else None)
