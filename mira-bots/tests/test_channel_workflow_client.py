from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from shared.channel_workflow import (
    ChannelWorkflowClient,
    ChannelWorkflowConfigError,
    ChannelWorkflowSettings,
    validate_channel_workflow_config,
)
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent


TENANT = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
OPERATION = "33333333-3333-4333-8333-333333333333"
OWNER = "44444444-4444-4444-8444-444444444444"
DELIVERY = "55555555-5555-4555-8555-555555555555"
FILE_ID = "66666666-6666-4666-8666-666666666666"
DOC_ID = "77777777-7777-4777-8777-777777777777"
PDF = b"%PDF-1.7\nDanfoss VLT User Manual"


def event(*, attachments: bool = True) -> NormalizedChatEvent:
    return NormalizedChatEvent(
        event_id="tg:9001",
        platform="telegram",
        tenant_id=TENANT,
        user_id="",
        external_user_id="42",
        external_channel_id="-10042",
        text="VLT User Manual" if attachments else "What does the manual say?",
        attachments=(
            [
                NormalizedAttachment(
                    kind="pdf",
                    mime_type="application/pdf",
                    filename="VLT User Manual.pdf",
                    url="tg-file",
                    data=PDF,
                )
            ]
            if attachments
            else []
        ),
        event_type="file_share" if attachments else "message",
    )


def settings(**overrides: object) -> ChannelWorkflowSettings:
    values = {
        "enabled": True,
        "hub_url": "https://hub.test",
        "base_path": "/hub",
        "token": "secret-token",
        "tenant_id": TENANT,
        "poll_interval_seconds": 0.001,
        "operation_timeout_seconds": 1.0,
    }
    values.update(overrides)
    return ChannelWorkflowSettings(**values)


def intake_result() -> dict:
    return {
        "contractVersion": "1.0",
        "operationId": OPERATION,
        "state": "complete",
        "handled": True,
        "semanticKind": "file_intake",
        "conversation": {
            "sessionId": "88888888-8888-4888-8888-888888888888",
            "notebookId": "99999999-9999-4999-8999-999999999999",
            "generation": 1,
        },
        "files": [
            {
                "fileId": FILE_ID,
                "documentId": DOC_ID,
                "filename": "VLT User Manual.pdf",
                "indexed": True,
                "processingState": "indexed",
            }
        ],
        "provenance": {"sourceChannel": "telegram"},
    }


@pytest.mark.asyncio
async def test_prepare_precedes_execute_and_ack_waits_for_successful_render() -> None:
    calls: list[tuple[str, str]] = []
    progress = AsyncMock()

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        assert request.headers["authorization"] == "Bearer secret-token"
        assert request.headers["x-mira-tenant-id"] == TENANT
        assert request.headers["x-mira-user-id"] == USER
        if request.url.path.endswith("/operations"):
            body = json.loads(request.content)
            assert body["tenantId"] == TENANT
            assert body["actor"]["userId"] == USER
            return httpx.Response(
                201,
                json={
                    "operationId": OPERATION,
                    "sessionId": "88888888-8888-4888-8888-888888888888",
                    "state": "queued",
                    "disposition": "execute",
                    "ownerToken": OWNER,
                    "result": None,
                    "deliveryToken": None,
                },
            )
        if request.url.path.endswith("/execute"):
            assert request.headers["x-mira-owner-token"] == OWNER
            assert PDF in request.content
            assert b'filename="VLT User Manual.pdf"' in request.content
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "complete",
                    "deliveryToken": DELIVERY,
                    "result": {**intake_result(), "deliveryToken": DELIVERY},
                },
            )
        if request.url.path.endswith("/delivery"):
            assert json.loads(request.content) == {"deliveryToken": DELIVERY}
            return httpx.Response(200, json={"operationId": OPERATION, "acknowledged": True})
        raise AssertionError(request.url.path)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = ChannelWorkflowClient(settings(), http_client=http)
        response = await client.prepare_execute(
            event(), actor_id=USER, uploader_id=USER, on_progress=progress
        )

        assert calls == [
            ("POST", "/hub/api/channel-workflow/operations"),
            ("POST", f"/hub/api/channel-workflow/operations/{OPERATION}/execute"),
        ]
        progress.assert_awaited_once_with(OPERATION, "prepared")
        assert response.workflow_handled is True
        assert response.operation_id == OPERATION
        assert response.terminal_delivery_token == DELIVERY
        assert FILE_ID in response.text
        assert DOC_ID in response.text
        assert response.suppress_delivery is False
        assert not any(path.endswith("/delivery") for _, path in calls)

        await client.ack_delivery(response)
        assert calls[-1] == (
            "POST",
            f"/hub/api/channel-workflow/operations/{OPERATION}/delivery",
        )


@pytest.mark.asyncio
async def test_owned_long_operation_reports_only_durable_hub_progress() -> None:
    release_execute = asyncio.Event()
    progress: list[tuple[str, str]] = []

    async def on_progress(operation_id: str, step: str) -> None:
        progress.append((operation_id, step))
        if step == "ingesting_file":
            release_execute.set()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/operations"):
            return httpx.Response(
                201,
                json={
                    "operationId": OPERATION,
                    "state": "queued",
                    "disposition": "execute",
                    "ownerToken": OWNER,
                },
            )
        if request.url.path.endswith("/execute"):
            await release_execute.wait()
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "complete",
                    "deliveryToken": DELIVERY,
                    "result": intake_result(),
                },
            )
        if request.url.path.endswith(OPERATION):
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "running",
                    "progressStep": "ingesting_file",
                    "terminalDelivered": False,
                },
            )
        raise AssertionError(request.url.path)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        response = await ChannelWorkflowClient(settings(), http_client=http).prepare_execute(
            event(), actor_id=USER, uploader_id=USER, on_progress=on_progress
        )

    assert progress == [(OPERATION, "prepared"), (OPERATION, "ingesting_file")]
    assert response.operation_state == "complete"


@pytest.mark.asyncio
async def test_running_duplicate_cannot_emit_an_already_leased_terminal() -> None:
    calls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/operations"):
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "running",
                    "disposition": "running",
                    "ownerToken": None,
                    "result": None,
                    "deliveryToken": None,
                },
            )
        if request.url.path.endswith(OPERATION):
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "complete",
                    "progressStep": "answering_from_files",
                    "terminalDelivered": False,
                },
            )
        if request.url.path.endswith("/delivery"):
            return httpx.Response(
                202,
                json={
                    "operationId": OPERATION,
                    "state": "complete",
                    "progressStep": "answering_from_files",
                    "deliveryToken": None,
                },
            )
        raise AssertionError(request.url.path)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        response = await ChannelWorkflowClient(settings(), http_client=http).prepare_execute(
            event(attachments=False), actor_id=USER, uploader_id=USER
        )

    assert not any(path.endswith("/execute") for path in calls)
    assert response.operation_id == OPERATION
    assert response.suppress_delivery is True
    assert response.text == ""


@pytest.mark.asyncio
async def test_terminal_replay_without_delivery_token_is_suppressed() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "operationId": OPERATION,
                "state": "complete",
                "disposition": "terminal",
                "ownerToken": None,
                "result": intake_result(),
                "deliveryToken": None,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        response = await ChannelWorkflowClient(settings(), http_client=http).prepare_execute(
            event(), actor_id=USER, uploader_id=USER
        )
    assert response.suppress_delivery is True
    assert response.text == ""


@pytest.mark.asyncio
async def test_running_timeout_is_honest_and_never_promises_later_delivery() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/operations"):
            return httpx.Response(
                200,
                json={
                    "operationId": OPERATION,
                    "state": "running",
                    "disposition": "running",
                    "ownerToken": None,
                    "result": None,
                    "deliveryToken": None,
                },
            )
        return httpx.Response(
            200,
            json={
                "operationId": OPERATION,
                "state": "running",
                "progressStep": "ingesting_file",
                "terminalDelivered": False,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        response = await ChannelWorkflowClient(
            settings(operation_timeout_seconds=0), http_client=http
        ).prepare_execute(event(), actor_id=USER, uploader_id=USER)

    assert response.operation_state == "running"
    assert OPERATION in response.text
    assert "later" not in response.text.lower()
    assert "i'll" not in response.text.lower()
    assert response.terminal_delivery_token == ""


@pytest.mark.asyncio
async def test_client_rejects_identity_from_another_deployment_tenant_before_http() -> None:
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    incoming = event()
    incoming.tenant_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        response = await ChannelWorkflowClient(settings(), http_client=http).prepare_execute(
            incoming, actor_id=USER, uploader_id=USER
        )

    assert calls == 0
    assert response.workflow_handled is True
    assert response.operation_state == "failed"
    assert response.provenance == {"clientBoundaryFailure": True}


def test_enabled_configuration_fails_before_runtime_without_every_boundary() -> None:
    base = {
        "MIRA_CHANNEL_WORKFLOW_ENABLED": "1",
        "HUB_URL": "https://hub.test",
        "HUB_BASE_PATH": "/hub/",
        "HUB_INGEST_TOKEN": "sentinel-secret",
        "MIRA_TENANT_ID": TENANT,
    }
    parsed = validate_channel_workflow_config(base)
    assert parsed.enabled is True
    assert parsed.base_path == "/hub"

    for key in ("HUB_URL", "HUB_INGEST_TOKEN", "MIRA_TENANT_ID"):
        broken = {**base, key: ""}
        with pytest.raises(ChannelWorkflowConfigError) as caught:
            validate_channel_workflow_config(broken)
        assert "sentinel-secret" not in str(caught.value)

    disabled = validate_channel_workflow_config({"MIRA_CHANNEL_WORKFLOW_ENABLED": "0"})
    assert disabled.enabled is False

    with pytest.raises(ChannelWorkflowConfigError, match="origin"):
        validate_channel_workflow_config({**base, "HUB_URL": "https://hub.test/not-an-origin"})
