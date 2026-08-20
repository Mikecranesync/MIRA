from __future__ import annotations

import os
import sys
import types
from unittest.mock import ANY, AsyncMock, MagicMock

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_channel_workflow_adapter_test.db")
os.environ.setdefault("MIRA_CHANNEL_WORKFLOW_ENABLED", "0")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import bot  # noqa: E402
from shared.chat.types import (  # noqa: E402
    NormalizedAttachment,
    NormalizedChatEvent,
    NormalizedChatResponse,
    ResponseBlock,
)
from renderers import render_telegram  # noqa: E402


OPERATION = "33333333-3333-4333-8333-333333333333"
DELIVERY = "44444444-4444-4444-8444-444444444444"


def normalized(*, kind: str | None = None, text: str = "find the user manual"):
    attachments = []
    if kind:
        attachments.append(
            NormalizedAttachment(
                kind=kind,  # type: ignore[arg-type]
                mime_type="application/pdf" if kind == "pdf" else "image/jpeg",
                filename="VLT User Manual.pdf" if kind == "pdf" else "danfoss.jpg",
                url="transport-file",
            )
        )
    return NormalizedChatEvent(
        event_id="9001:42",
        platform="telegram",
        tenant_id="adapter-hint",
        user_id="",
        external_user_id="42",
        external_channel_id="-10042",
        text=text,
        attachments=attachments,
        event_type="message",
    )


def canonical_response(kind: str = "nameplate_manual") -> NormalizedChatResponse:
    return NormalizedChatResponse(
        text=f"Canonical {kind} result",
        operation_id=OPERATION,
        operation_state="complete",
        semantic_kind=kind,
        terminal_delivery_token=DELIVERY,
        workflow_handled=True,
    )


def test_telegram_confirmation_button_carries_the_candidate_operation_id():
    response = canonical_response()
    response.blocks = [
        ResponseBlock(
            kind="button_row",
            data={
                "buttons": [
                    {
                        "label": "Confirm identity",
                        "action": "channel_workflow_confirm",
                        "value": OPERATION,
                    }
                ]
            },
        )
    ]

    _text, markup = render_telegram(response)

    assert markup["inline_keyboard"][0][0]["callback_data"] == (
        f"channel_workflow_confirm:{OPERATION}"
    )


def fake_update(*, text: str = "find the user manual", document=None):
    message = types.SimpleNamespace(
        text=text,
        caption=text,
        document=document,
        reply_text=AsyncMock(return_value=types.SimpleNamespace(edit_text=AsyncMock())),
        date=types.SimpleNamespace(isoformat=lambda: "2026-08-18T12:00:00+00:00"),
    )
    return types.SimpleNamespace(
        update_id=9001,
        effective_user=types.SimpleNamespace(id=42, first_name="Mike"),
        effective_chat=types.SimpleNamespace(id=-10042),
        message=message,
        to_dict=lambda: {"update_id": 9001, "message": {"message_id": 42}},
    )


@pytest.mark.asyncio
async def test_telegram_text_calls_canonical_before_every_local_memory_path(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized()
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=True))
    monkeypatch.setattr(
        bot.dispatcher, "try_channel_workflow", AsyncMock(return_value=canonical_response())
    )
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", AsyncMock(return_value=True))
    for name in (
        "_try_drive_pack_followup",
        "_try_print_workspace_followup",
        "_try_equipment_photo_followup",
        "_try_wiring_question_reply",
    ):
        monkeypatch.setattr(bot, name, AsyncMock(side_effect=AssertionError("legacy ran first")))
    monkeypatch.setattr(
        bot.printsense_commercial,
        "try_printsense_text_reply",
        AsyncMock(side_effect=AssertionError("PrintSense ran first")),
    )

    update = fake_update()
    await bot.handle_message(update, MagicMock())

    bot.dispatcher.try_channel_workflow.assert_awaited_once()
    bot.adapter.render_outgoing.assert_awaited_once_with(canonical_response(), event)
    bot.dispatcher.ack_channel_delivery.assert_awaited_once()
    bot.engine.process.assert_not_called() if hasattr(
        bot.engine.process, "assert_not_called"
    ) else None


@pytest.mark.asyncio
async def test_telegram_danfoss_photo_sends_full_bytes_to_canonical_before_printsense(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized(kind="image")
    seen: dict[str, bytes] = {}

    async def canonical(incoming, **_kwargs):
        seen["data"] = incoming.attachments[0].data
        seen["text"] = incoming.text.encode()
        return canonical_response()

    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=True))
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", AsyncMock(side_effect=canonical))
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", AsyncMock(return_value=True))
    monkeypatch.setattr(
        bot.printsense_testkit,
        "try_printsense_grade_reply",
        AsyncMock(side_effect=AssertionError("PrintSense ran first")),
    )
    monkeypatch.setattr(
        bot,
        "_try_nameplate_drive_pack_reply",
        AsyncMock(side_effect=AssertionError("local finder")),
    )

    raw = b"FULL_RES_DANFOSS_NAMEPLATE"
    await bot._dispatch_single_photo(
        raw, b"RESIZED", "Can you find the user manual?", fake_update(), MagicMock()
    )

    assert seen == {"data": raw, "text": b"Can you find the user manual?"}
    bot.dispatcher.ack_channel_delivery.assert_awaited_once()


@pytest.mark.asyncio
async def test_canonical_electrical_print_delegation_still_reaches_print_interpreter(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized(kind="image", text="Explain this electrical print")
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", AsyncMock(return_value=None))
    monkeypatch.setattr(
        bot.printsense_testkit, "try_printsense_grade_reply", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(bot, "_try_nameplate_drive_pack_reply", AsyncMock(return_value=False))
    monkeypatch.setattr(bot, "_try_wiring_intake_reply", AsyncMock(return_value=False))
    interpreter = AsyncMock(return_value=True)
    monkeypatch.setattr(bot, "_try_print_translator_reply", interpreter)

    await bot._dispatch_single_photo(
        b"FULL_RES_ELECTRICAL_PRINT",
        b"RESIZED_PRINT",
        "Explain this electrical print",
        fake_update(text="Explain this electrical print"),
        MagicMock(),
    )

    interpreter.assert_awaited_once()


@pytest.mark.asyncio
async def test_telegram_pdf_is_awaited_and_acknowledged_with_durable_ids(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    doc = types.SimpleNamespace(
        file_name="VLT User Manual.pdf",
        mime_type="application/pdf",
        file_size=1024,
        file_id="tg-pdf",
    )
    update = fake_update(text="VLT User Manual", document=doc)
    context = types.SimpleNamespace(
        bot=types.SimpleNamespace(
            get_file=AsyncMock(
                return_value=types.SimpleNamespace(
                    download_as_bytearray=AsyncMock(return_value=bytearray(b"%PDF-1.7\nVLT"))
                )
            )
        )
    )
    event = normalized(kind="pdf", text="VLT User Manual")
    response = canonical_response("file_intake")
    response.text = (
        "VLT User Manual.pdf: File 55555555-5555-4555-8555-555555555555; "
        "document 66666666-6666-4666-8666-666666666666; state indexed."
    )
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=True))
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", AsyncMock(return_value=response))
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", AsyncMock(return_value=True))
    monkeypatch.setattr(
        bot, "_submit_doc_to_hub", AsyncMock(side_effect=AssertionError("legacy folder upload"))
    )

    await bot.document_handler(update, context)

    assert event.attachments[0].data == b"%PDF-1.7\nVLT"
    bot.adapter.render_outgoing.assert_awaited_once_with(response, event)
    bot.dispatcher.ack_channel_delivery.assert_awaited_once_with(response)


@pytest.mark.asyncio
async def test_telegram_new_rotates_canonical_before_clearing_legacy_state(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    order: list[str] = []
    event = normalized(text="/new")
    response = canonical_response("reset")
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))

    async def canonical(*_args, **kwargs):
        assert kwargs["action"] == "reset"
        order.append("canonical")
        return response

    async def render(*_args):
        order.append("render")
        return True

    async def ack(*_args):
        order.append("ack")
        return True

    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", canonical)
    monkeypatch.setattr(bot.adapter, "render_outgoing", render)
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", ack)
    monkeypatch.setattr(
        bot, "_clear_legacy_conversation_state", lambda _chat_id: order.append("local")
    )

    await bot.new_command(fake_update(text="/new"), MagicMock())

    assert order == ["canonical", "render", "ack", "local"]


@pytest.mark.asyncio
async def test_telegram_confirmation_button_reuses_candidate_operation(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized(text="Confirm identity")
    response = canonical_response("nameplate_manual")
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=True))
    attempt = AsyncMock(return_value=response)
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", attempt)
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", AsyncMock(return_value=True))
    query_message = types.SimpleNamespace(to_dict=lambda: {"message_id": 42})
    query = types.SimpleNamespace(
        id="callback-1",
        data=f"channel_workflow_confirm:{OPERATION}",
        from_user=types.SimpleNamespace(to_dict=lambda: {"id": 42}),
        message=query_message,
        answer=AsyncMock(),
    )
    update = types.SimpleNamespace(
        update_id=9002,
        callback_query=query,
        message=query_message,
        effective_user=types.SimpleNamespace(id=42),
        effective_chat=types.SimpleNamespace(id=-10042),
    )

    await bot.channel_workflow_callback(update, MagicMock())

    query.answer.assert_awaited_once()
    assert event.event_id == "callback:callback-1"
    attempt.assert_awaited_once_with(
        event,
        action="confirm_identity",
        context=None,
        prior_operation_id=OPERATION,
        confirmed_identity=None,
        on_progress=ANY,
    )


@pytest.mark.asyncio
async def test_telegram_recover_command_authorizes_one_canonical_recovery(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized(text="Recover terminal response")
    response = canonical_response("grounded_answer")
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=True))
    attempt = AsyncMock(return_value=response)
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", attempt)
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", AsyncMock(return_value=True))
    update = fake_update(text=f"/recover {OPERATION}")

    await bot.recover_command(update, types.SimpleNamespace(args=[OPERATION]))

    attempt.assert_awaited_once_with(
        event,
        action="recover_delivery",
        context=None,
        prior_operation_id=OPERATION,
        confirmed_identity=None,
        on_progress=ANY,
    )
    bot.dispatcher.ack_channel_delivery.assert_awaited_once_with(response)


@pytest.mark.asyncio
async def test_telegram_recover_command_requires_a_single_operation_id(monkeypatch):
    attempt = AsyncMock()
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", attempt)
    update = fake_update(text="/recover")

    await bot.recover_command(update, types.SimpleNamespace(args=[]))

    update.message.reply_text.assert_awaited_once()
    attempt.assert_not_awaited()


@pytest.mark.asyncio
async def test_telegram_unacknowledged_terminal_leaves_recovery_instructions(monkeypatch):
    monkeypatch.setattr(bot._channel_workflow_client, "enabled", True)
    event = normalized(text="question")
    response = canonical_response("grounded_answer")

    async def attempt(incoming, **kwargs):
        await kwargs["on_progress"](OPERATION, "prepared")
        return response

    update = fake_update(text="question")
    progress_message = types.SimpleNamespace(edit_text=AsyncMock())
    update.message.reply_text = AsyncMock(return_value=progress_message)
    monkeypatch.setattr(bot.adapter, "normalize_incoming", AsyncMock(return_value=event))
    monkeypatch.setattr(bot.adapter, "render_outgoing", AsyncMock(return_value=False))
    monkeypatch.setattr(bot.dispatcher, "try_channel_workflow", AsyncMock(side_effect=attempt))
    ack = AsyncMock()
    monkeypatch.setattr(bot.dispatcher, "ack_channel_delivery", ack)

    await bot._try_canonical_workflow(update, event)

    recovery_text = progress_message.edit_text.await_args_list[-1].args[0]
    assert f"/recover {OPERATION}" in recovery_text
    assert "may repeat" in recovery_text
    ack.assert_not_awaited()


def test_telegram_legacy_reset_clears_every_known_local_workspace(monkeypatch):
    calls: list[tuple] = []
    task = MagicMock()
    task.done.return_value = False
    bot._BURST_COLLECTOR[-10042] = {"task": task}
    monkeypatch.setattr(bot.engine, "reset", lambda key: calls.append(("engine", key)))
    monkeypatch.setattr(
        bot.print_workspace, "clear_workspace", lambda key: calls.append(("print", key))
    )
    monkeypatch.setattr(bot, "_clear_drive_context", lambda key: calls.append(("tg-drive", key)))
    monkeypatch.setattr(
        bot, "clear_drive_context", lambda source, key: calls.append(("drive", source, key))
    )
    monkeypatch.setattr(
        bot.session_memory, "clear_session", lambda key: calls.append(("session", key))
    )

    bot._clear_legacy_conversation_state("-10042")

    assert ("engine", "-10042") in calls
    assert ("print", "-10042") in calls
    assert ("tg-drive", "-10042") in calls
    assert ("drive", "telegram", "telegram:-10042") in calls
    assert ("session", "-10042") in calls
    assert ("session", "telegram:-10042") in calls
    task.cancel.assert_called_once()
    assert -10042 not in bot._BURST_COLLECTOR
