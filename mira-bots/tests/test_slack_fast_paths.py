"""Integration tests: Slack fast-paths are called before dispatch."""

import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock

_repo_root = Path(__file__).resolve().parents[2]
_tests_dir = Path(__file__).resolve().parent
if str(_tests_dir) not in sys.path:
    sys.path.insert(0, str(_tests_dir))

import pytest

from slack_test_imports import load_slack_bot


def import_slack_bot():
    """Reload Slack modules without depending on live Slack env."""
    return load_slack_bot()


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


@pytest.mark.asyncio
async def test_pdf_uses_canonical_workflow_before_legacy_handler_and_dedupes(tmp_path, monkeypatch):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse

    raw_pdf = b"%PDF-1.7\nDanfoss VLT"
    rendered = []

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event.get("client_msg_id", raw_event["ts"]),
                platform="slack",
                tenant_id="adapter-hint",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event.get("thread_ts", raw_event["ts"]),
                text=raw_event.get("text", ""),
                attachments=[
                    NormalizedAttachment(
                        kind="pdf",
                        mime_type="application/pdf",
                        filename="VLT User Manual.pdf",
                        url="https://files.slack.test/vlt.pdf",
                    )
                ],
            )

        async def download_attachment(self, _attachment):
            return raw_pdf

        async def render_outgoing(self, response, event):
            rendered.append((response, event))
            return True

    class FakeDispatcher:
        def __init__(self):
            self.attempts = 0
            self.acks = 0

        async def try_channel_workflow(self, event, **_kwargs):
            self.attempts += 1
            assert event.attachments[0].data == raw_pdf
            return NormalizedChatResponse(
                text="Canonical File and document IDs",
                operation_id="33333333-3333-4333-8333-333333333333",
                operation_state="complete",
                semantic_kind="file_intake",
                terminal_delivery_token="44444444-4444-4444-8444-444444444444",
                workflow_handled=True,
            )

        async def ack_channel_delivery(self, _response):
            self.acks += 1
            return True

        async def dispatch(self, _event):
            raise AssertionError("legacy dispatcher ran")

    async def legacy_ingest(*_args, **_kwargs):
        raise AssertionError("legacy pdf_handler ran")

    monkeypatch.setitem(sys.modules, "pdf_handler", types.SimpleNamespace(ingest_pdf=legacy_ingest))
    dispatcher = FakeDispatcher()
    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=dispatcher,
        fast_paths=AsyncMock(side_effect=AssertionError("legacy fast path ran")),
    )
    event = {
        "channel": "C1",
        "ts": "1710000000.1",
        "client_msg_id": "client-event-1",
        "user": "U1",
        "text": "VLT User Manual",
        "files": [
            {
                "mimetype": "application/pdf",
                "url_private_download": "https://files.slack.test/vlt.pdf",
                "name": "VLT User Manual.pdf",
            }
        ],
    }

    await runtime.handle_message(event, AsyncMock(), client=None)
    await runtime.handle_message(event, AsyncMock(), client=None)

    assert dispatcher.attempts == 1
    assert dispatcher.acks == 1
    assert len(rendered) == 1


@pytest.mark.asyncio
async def test_slack_reset_rotates_canonical_before_local_clear(tmp_path):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    order = []

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event["ts"],
                platform="slack",
                tenant_id="adapter-hint",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event["ts"],
                text="/mira-reset",
            )

        async def render_outgoing(self, _response, _event):
            order.append("render")
            return True

    class FakeDispatcher:
        async def try_channel_workflow(self, _event, **kwargs):
            assert kwargs["action"] == "reset"
            order.append("canonical")
            return NormalizedChatResponse(
                text="reset",
                operation_id="33333333-3333-4333-8333-333333333333",
                operation_state="complete",
                semantic_kind="reset",
                terminal_delivery_token="44444444-4444-4444-8444-444444444444",
                workflow_handled=True,
            )

        async def ack_channel_delivery(self, _response):
            order.append("ack")
            return True

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=AsyncMock(),
    )
    runtime.clear_legacy_conversation = lambda _event: order.append("local")

    await runtime.reset_conversation(
        {"channel": "C1", "ts": "1710000000.1", "user": "U1", "text": "/mira-reset"}
    )

    assert order == ["canonical", "render", "ack", "local"]


@pytest.mark.asyncio
async def test_slack_confirmation_action_reuses_candidate_operation(tmp_path):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    prior = "33333333-3333-4333-8333-333333333333"
    seen = {}

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event["client_msg_id"],
                platform="slack",
                tenant_id="adapter-hint",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event["thread_ts"],
                text="Confirm identity",
            )

        async def render_outgoing(self, _response, _event):
            return True

    class FakeDispatcher:
        async def try_channel_workflow(self, event, **kwargs):
            seen.update(kwargs)
            seen["event"] = event
            return NormalizedChatResponse(
                text="confirmed",
                operation_id="44444444-4444-4444-8444-444444444444",
                operation_state="complete",
                semantic_kind="nameplate_manual",
                terminal_delivery_token="55555555-5555-4555-8555-555555555555",
                workflow_handled=True,
            )

        async def ack_channel_delivery(self, _response):
            return True

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=AsyncMock(),
    )

    await runtime.confirm_identity(
        {
            "client_msg_id": "action-1",
            "channel": "C1",
            "thread_ts": "1710000000.1",
            "ts": "1710000000.2",
            "user": "U1",
        },
        prior,
    )

    assert seen["action"] == "confirm_identity"
    assert seen["prior_operation_id"] == prior


@pytest.mark.asyncio
async def test_slack_recovery_action_authorizes_one_canonical_recovery(tmp_path):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    prior = "33333333-3333-4333-8333-333333333333"
    seen = {}

    class FakeAdapter:
        async def normalize_incoming(self, raw_event):
            return NormalizedChatEvent(
                event_id=raw_event["client_msg_id"],
                platform="slack",
                tenant_id="adapter-hint",
                user_id="",
                external_user_id=raw_event["user"],
                external_channel_id=raw_event["channel"],
                external_thread_id=raw_event["thread_ts"],
                text="Recover terminal response",
            )

        async def render_outgoing(self, _response, _event):
            return True

    class FakeDispatcher:
        async def try_channel_workflow(self, event, **kwargs):
            seen.update(kwargs)
            seen["event"] = event
            return NormalizedChatResponse(
                text="recovered",
                operation_id="44444444-4444-4444-8444-444444444444",
                operation_state="complete",
                semantic_kind="grounded_answer",
                terminal_delivery_token="55555555-5555-4555-8555-555555555555",
                workflow_handled=True,
            )

        async def ack_channel_delivery(self, _response):
            return True

    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=AsyncMock(),
    )

    await runtime.recover_delivery(
        {
            "client_msg_id": "recovery-1",
            "channel": "C1",
            "thread_ts": "1710000000.1",
            "ts": "1710000000.2",
            "user": "U1",
        },
        prior,
    )

    assert seen["action"] == "recover_delivery"
    assert seen["prior_operation_id"] == prior


@pytest.mark.asyncio
async def test_slack_unacknowledged_terminal_offers_recovery_in_the_original_thread(tmp_path):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse

    operation_id = "33333333-3333-4333-8333-333333333333"
    updates = []

    class FakeAdapter:
        async def render_outgoing(self, _response, _event):
            return False

    class FakeDispatcher:
        async def try_channel_workflow(self, _event, **kwargs):
            await kwargs["on_progress"](operation_id, "prepared")
            return NormalizedChatResponse(
                text="answer whose delivery is uncertain",
                operation_id=operation_id,
                operation_state="complete",
                semantic_kind="grounded_answer",
                terminal_delivery_token="44444444-4444-4444-8444-444444444444",
                workflow_handled=True,
            )

        async def ack_channel_delivery(self, _response):
            raise AssertionError("an unrendered terminal cannot be acknowledged")

    async def say(**_kwargs):
        return {"ts": "progress-message-ts"}

    client = types.SimpleNamespace(
        chat_update=AsyncMock(side_effect=lambda **kw: updates.append(kw))
    )
    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=object(),
        adapter=FakeAdapter(),
        dispatcher=FakeDispatcher(),
        fast_paths=AsyncMock(),
    )
    incoming = NormalizedChatEvent(
        event_id="event-1",
        platform="slack",
        tenant_id="adapter-hint",
        user_id="",
        external_user_id="U1",
        external_channel_id="C1",
        external_thread_id="1710000000.1",
        text="question",
    )

    await runtime._run_canonical(incoming, say=say, client=client)

    recovery_update = updates[-1]
    assert recovery_update["channel"] == "C1"
    assert recovery_update["ts"] == "progress-message-ts"
    button = recovery_update["blocks"][1]["elements"][0]
    assert button["action_id"] == "channel_workflow_recover"
    assert button["value"] == operation_id


def test_slack_legacy_reset_clears_engine_drive_and_session_state(tmp_path, monkeypatch):
    bot = import_slack_bot()
    from shared.chat.types import NormalizedChatEvent

    calls = []
    engine = types.SimpleNamespace(reset=lambda key: calls.append(("engine", key)))
    runtime = bot.SlackRuntime(
        settings=bot.SlackSettings(
            bot_token="xoxb-test-secret",
            app_token="xapp-test-secret",
            db_path=str(tmp_path / "mira.db"),
        ),
        engine=engine,
        adapter=object(),
        dispatcher=object(),
        fast_paths=AsyncMock(),
    )
    monkeypatch.setattr(
        bot, "clear_drive_context", lambda source, key: calls.append(("drive", source, key))
    )
    monkeypatch.setattr(
        bot.session_memory, "clear_session", lambda key: calls.append(("session", key))
    )
    event = NormalizedChatEvent(
        event_id="reset-1",
        platform="slack",
        tenant_id="",
        user_id="",
        external_user_id="U1",
        external_channel_id="C1",
        external_thread_id="1710000000.1",
    )

    runtime.clear_legacy_conversation(event)

    assert calls == [
        ("engine", "slack:C1:1710000000.1"),
        ("drive", "slack", "slack:C1:1710000000.1"),
        ("session", "C1"),
        ("session", "slack:C1:1710000000.1"),
    ]
