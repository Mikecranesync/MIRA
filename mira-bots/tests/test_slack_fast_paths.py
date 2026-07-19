"""Integration test: Slack fast-paths are called before dispatch."""

import sys
from pathlib import Path

# Add paths before any imports to ensure module resolution
_repo_root = Path(__file__).resolve().parents[2]
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_repo_root / "mira-bots" / "slack") not in sys.path:
    sys.path.insert(0, str(_repo_root / "mira-bots" / "slack"))

import pytest


@pytest.fixture
def slackbot(tmp_path, monkeypatch):
    """Fixture that reloads the Slack bot module with fresh env."""
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    # Clean modules before reimporting
    for m in ("shared.chat.drive_context", "shared.chat.fast_paths", "bot"):
        if m in sys.modules:
            del sys.modules[m]
    import bot

    return bot


@pytest.mark.asyncio
async def test_photo_nameplate_reply_in_thread(slackbot, monkeypatch):
    """Verify fast-path response is sent in-thread and dispatcher is bypassed."""
    bot = slackbot
    sent = {}

    async def say(text=None, thread_ts=None, **kw):
        sent["text"] = text
        sent["thread_ts"] = thread_ts

    async def fake_router(event, engine):
        from shared.chat.types import NormalizedChatResponse

        return NormalizedChatResponse(
            text="📷 Identified: TECO GS10", thread_id=event.external_thread_id
        )

    monkeypatch.setattr(bot, "try_fast_paths", fake_router)

    # Mock the adapter's download_attachment method
    async def fake_download_attachment(att):
        return b"IMG"

    monkeypatch.setattr(bot.adapter, "download_attachment", fake_download_attachment)

    # Mock _resize_for_vision to avoid PIL parsing fake bytes
    def fake_resize(data):
        return data

    monkeypatch.setattr(bot, "_resize_for_vision", fake_resize)

    # Photo event with a file
    event = {
        "channel": "C1",
        "ts": "T1",
        "user": "U1",
        "files": [
            {
                "mimetype": "image/jpeg",
                "url_private_download": "http://x/p.jpg",
                "name": "p.jpg",
            }
        ],
    }

    await bot.handle_message(event, say, client=None)

    assert "Identified" in sent["text"]
    assert sent["thread_ts"] == "T1"
