"""Render ResponseBlocks to Microsoft Teams Adaptive Cards."""

from __future__ import annotations

from ..types import NormalizedChatResponse


def render_teams(response: NormalizedChatResponse) -> dict:
    """Convert NormalizedChatResponse to Teams Adaptive Card."""
    body: list[dict] = []
    actions: list[dict] = []

    for block in response.blocks:
        if block.kind == "header":
            body.append(
                {
                    "type": "TextBlock",
                    "text": block.data.get("text", ""),
                    "weight": "Bolder",
                    "size": "Large",
                }
            )
        elif block.kind == "paragraph":
            body.append({"type": "TextBlock", "text": block.data.get("text", ""), "wrap": True})
        elif block.kind == "key_value":
            facts = [{"title": k, "value": v} for k, v in block.data.get("pairs", [])]
            body.append({"type": "FactSet", "facts": facts})
        elif block.kind == "button_row":
            for btn in block.data.get("buttons", []):
                if btn.get("action") == "open_url":
                    actions.append(
                        {
                            "type": "Action.OpenUrl",
                            "title": btn["label"],
                            "url": btn.get("url", ""),
                        }
                    )
                else:
                    actions.append(
                        {
                            "type": "Action.Submit",
                            "title": btn["label"],
                            "data": {
                                "action": btn.get("action", ""),
                                "value": btn.get("value", ""),
                            },
                        }
                    )
        elif block.kind == "divider":
            body.append({"type": "TextBlock", "text": "---", "separator": True})
        elif block.kind == "citation":
            body.append(
                {
                    "type": "TextBlock",
                    "text": f"\U0001f4ce {block.data.get('source', '')}",
                    "isSubtle": True,
                    "size": "Small",
                }
            )
        elif block.kind == "warning":
            body.append(
                {
                    "type": "TextBlock",
                    "text": f"\u26a0\ufe0f {block.data.get('text', '')}",
                    "color": "Warning",
                    "weight": "Bolder",
                }
            )

    if not body:
        body.append({"type": "TextBlock", "text": response.text, "wrap": True})

    card: dict = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.5",
                    "body": body,
                    "actions": actions if actions else None,
                },
            }
        ],
    }
    return card
