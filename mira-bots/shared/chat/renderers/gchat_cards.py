"""Render ResponseBlocks to Google Chat Cards v2."""

from __future__ import annotations

from ..types import NormalizedChatResponse


def render_gchat(response: NormalizedChatResponse) -> dict:
    """Convert NormalizedChatResponse to Google Chat Cards v2."""
    sections: list[dict] = []
    current_widgets: list[dict] = []

    for block in response.blocks:
        if block.kind == "header":
            # Flush current section, start new one with header
            if current_widgets:
                sections.append({"widgets": current_widgets})
                current_widgets = []
            sections.append({"header": block.data.get("text", ""), "widgets": []})
        elif block.kind == "paragraph":
            current_widgets.append({"textParagraph": {"text": block.data.get("text", "")}})
        elif block.kind == "key_value":
            for k, v in block.data.get("pairs", []):
                current_widgets.append({"decoratedText": {"topLabel": k, "text": v}})
        elif block.kind == "button_row":
            buttons = []
            for btn in block.data.get("buttons", []):
                if btn.get("action") == "open_url":
                    on_click: dict = {"openLink": {"url": btn.get("url", "")}}
                else:
                    on_click = {
                        "action": {
                            "function": btn.get("action", ""),
                            "parameters": [{"key": "value", "value": btn.get("value", "")}],
                        }
                    }
                buttons.append({"text": btn["label"], "onClick": on_click})
            current_widgets.append({"buttonList": {"buttons": buttons}})
        elif block.kind == "citation":
            current_widgets.append(
                {"textParagraph": {"text": f"<i>\U0001f4ce {block.data.get('source', '')}</i>"}}
            )
        elif block.kind == "warning":
            current_widgets.append(
                {
                    "decoratedText": {
                        "text": f"\u26a0\ufe0f {block.data.get('text', '')}",
                        "startIcon": {"knownIcon": "ALERT"},
                    }
                }
            )

    if current_widgets:
        sections.append({"widgets": current_widgets})

    if not sections:
        return {"text": response.text}

    return {
        "cardsV2": [
            {
                "cardId": "mira-response",
                "card": {"sections": sections},
            }
        ],
        "text": response.text,  # fallback
    }
