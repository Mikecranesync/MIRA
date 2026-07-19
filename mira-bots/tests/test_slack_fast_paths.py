"""Integration tests: Slack fast-paths are called before dispatch."""

import sys
from pathlib import Path

# Add paths before any imports to ensure module resolution
_repo_root = Path(__file__).resolve().parents[2]
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_repo_root / "mira-bots" / "slack") not in sys.path:
    sys.path.insert(0, str(_repo_root / "mira-bots" / "slack"))

import pytest


def import_slack_bot():
    """Reload Slack modules without depending on live Slack env."""
    for m in ("shared.chat.drive_context", "shared.chat.fast_paths", "bot"):
        if m in sys.modules:
            del sys.modules[m]
    import bot

    return bot


@pytest.mark.asyncio
async def test_photo_nameplate_reply_in_thread(tmp_path):
    """Verify fast-path response is sent in-thread and dispatcher is bypassed."""
    bot = import_slack_bot()
    sent = {}

    async def say(text=None, thread_ts=None, **kw):
        sent["text"] = text
        sent["thread_ts"] = thread_ts

    async def fake_router(event, engine):
        from shared.chat.types import NormalizedChatResponse

        return NormalizedChatResponse(
            text="📷 Identified: TECO GS10", thread_id=event.external_thread_id
        )

    class FakeAdapter(bot.SlackChatAdapter):
        async def download_attachment(self, att):
            return b"IMG"

    class FakeDispatcher:
        async def dispatch(self, event):
            raise AssertionError("dispatcher should be bypassed")

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(bot_token="xoxb-test-secret"),
        dispatcher=FakeDispatcher(),
        fast_paths=fake_router,
        resize_for_vision=lambda data: data,
    )

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

    await runtime.handle_message(event, say, client=None)

    assert "Identified" in sent["text"]
    assert sent["thread_ts"] == "T1"


@pytest.mark.asyncio
async def test_dm_hello_falls_through_to_dispatcher_without_env_patch(tmp_path):
    """Plain DMs that are not fast-paths still reach dispatcher/render."""
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    sent = []

    async def say(text=None, thread_ts=None, **kw):
        sent.append({"text": text, "thread_ts": thread_ts})

    async def no_fast_path(event, engine):
        return None

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event["client_msg_id"],
                platform="slack",
                tenant_id="T1",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event["ts"],
                text=raw_event["text"],
                attachments=[],
                event_type="dm",
                raw=raw_event,
            )

        async def render_outgoing(self, response, event):
            sent.append({"text": response.text, "thread_ts": event.external_thread_id})

    class FakeDispatcher:
        async def dispatch(self, event):
            assert event.platform == "slack"
            assert event.event_type == "dm"
            assert event.text == "hello"
            return NormalizedChatResponse(text="What machine are you looking at?")

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=no_fast_path,
    )

    event = {
        "channel": "D0B3YF4DU1Y",
        "channel_type": "im",
        "user": "U0B3V3QLUFP",
        "text": "hello",
        "ts": "1710000000.000300",
        "client_msg_id": "dm-hello-1",
    }

    await runtime.handle_message(event, say, client=None)

    assert sent == [{"text": "What machine are you looking at?", "thread_ts": "1710000000.000300"}]
