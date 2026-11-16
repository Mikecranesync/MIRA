"""route_intent parses a classifier reply wrapped in one Markdown code fence.

Measured 2026-11-16 (staging read-only eval): claude-sonnet-4-6 answered the
router prompt with a ```json fenced block 14/14 times; the bare json.loads
raised, so every turn became "Router parse failure" -> continue_current, with
nothing logged. These pin the unwrap and its limits.

Run: cd mira-bots && python3 -m pytest tests/test_conversation_router_fenced_json.py -q
"""

from __future__ import annotations

import sys

import pytest

sys.path.insert(0, "mira-bots")

from shared import conversation_router as cr  # noqa: E402

BODY = '{"intent": "general_question", "confidence": 0.72, "reasoning": "no asset named"}'


async def _route(monkeypatch, reply: str) -> dict:
    async def fake_llm(messages, session_id=None):
        return reply

    monkeypatch.setattr(cr, "_call_router_llm", fake_llm)
    return await cr.route_intent("why would a motor not start?", [])


@pytest.mark.parametrize(
    "reply",
    [
        "```json\n" + BODY + "\n```",
        "```\n" + BODY + "\n```",
        "  ```JSON\n" + BODY + "\n```  \n",
        '```json\n{\n  "intent": "general_question",\n  "confidence": 0.72\n}\n```',
    ],
)
async def test_fenced_reply_keeps_the_classifiers_intent(monkeypatch, reply):
    r = await _route(monkeypatch, reply)
    assert r["intent"] == "general_question"
    assert r["confidence"] == 0.72


async def test_control_bare_json_unchanged(monkeypatch):
    r = await _route(monkeypatch, BODY)
    assert r["intent"] == "general_question"


async def test_fenced_unknown_intent_still_maps_to_continue(monkeypatch):
    r = await _route(monkeypatch, '```json\n{"intent": "launch_rocket", "confidence": 0.9}\n```')
    assert r["intent"] == "continue_current"


@pytest.mark.parametrize(
    "reply",
    [
        "Sure! ```json\n" + BODY + "\n``` hope that helps",  # prose around the fence: not unwrapped
        "```json\nnot json\n```",
        "",
    ],
)
async def test_unparseable_replies_still_fall_back(monkeypatch, reply):
    r = await _route(monkeypatch, reply)
    assert r["intent"] == "continue_current"
    assert r["reasoning"].startswith("Router parse failure")
