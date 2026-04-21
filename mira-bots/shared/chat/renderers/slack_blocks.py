"""Render ResponseBlocks to Slack Block Kit."""

from __future__ import annotations

from ..types import NormalizedChatResponse


def render_slack(response: NormalizedChatResponse) -> dict:
    """Convert NormalizedChatResponse to Slack Block Kit payload."""
    blocks = []

    for block in response.blocks:
        if block.kind == "header":
            blocks.append(
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": block.data.get("text", "")},
                }
            )
        elif block.kind == "paragraph":
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": block.data.get("text", "")},
                }
            )
        elif block.kind == "key_value":
            pairs = block.data.get("pairs", [])
            fields = [{"type": "mrkdwn", "text": f"*{k}*\n{v}"} for k, v in pairs]
            blocks.append({"type": "section", "fields": fields[:10]})
        elif block.kind == "button_row":
            elements = []
            for btn in block.data.get("buttons", []):
                elements.append(
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": btn["label"]},
                        "action_id": btn.get("action", "click"),
                        "value": btn.get("value", ""),
                    }
                )
            blocks.append({"type": "actions", "elements": elements})
        elif block.kind == "divider":
            blocks.append({"type": "divider"})
        elif block.kind == "citation":
            blocks.append(
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": f"\U0001f4ce {block.data.get('source', '')}",
                        }
                    ],
                }
            )
        elif block.kind == "warning":
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"\u26a0\ufe0f *{block.data.get('text', '')}*",
                    },
                }
            )
        elif block.kind == "suggestion_chips":
            chips = block.data.get("suggestions", [])
            elements = [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": s},
                    "action_id": f"suggest_{i}",
                    "value": s,
                }
                for i, s in enumerate(chips)
            ]
            blocks.append({"type": "actions", "elements": elements[:5]})

    # Always include plain text fallback
    if not blocks:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": response.text}})

    return {"blocks": blocks, "text": response.text}
