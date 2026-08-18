from __future__ import annotations

import hashlib

import pytest

from shared.channel_workflow import (
    ChannelWorkflowContractError,
    build_channel_request,
    semantic_projection,
)
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse


TENANT = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
PDF_BYTES = b"%PDF-1.7\nDanfoss VLT AQUA Drive FC-202"
PDF_SHA = hashlib.sha256(PDF_BYTES).hexdigest()


def event(platform: str) -> NormalizedChatEvent:
    is_slack = platform == "slack"
    return NormalizedChatEvent(
        event_id="slack-event-7" if is_slack else "telegram-update-7",
        platform=platform,  # type: ignore[arg-type]
        tenant_id="adapter-hint-must-not-win",
        user_id="",
        external_user_id="U42" if is_slack else "42",
        external_channel_id="C-MAINT" if is_slack else "-10042",
        external_thread_id="1700000000.001" if is_slack else "reply-message-ignored",
        text="i gave you the user manual can you help me",
        attachments=[
            NormalizedAttachment(
                kind="pdf",
                mime_type="application/pdf",
                filename="VLT User Manual.pdf",
                url="transport-only",
                size_bytes=len(PDF_BYTES),
                data=PDF_BYTES,
            )
        ],
        event_type="file_share",
    )


def test_builds_literal_channel_contract_with_actual_byte_hash() -> None:
    req = build_channel_request(
        event("telegram"),
        tenant_id=TENANT,
        actor_id=USER,
        uploader_id=USER,
    )

    assert req["contractVersion"] == "1.0"
    assert req["tenantId"] == TENANT
    assert req["actor"] == {
        "userId": USER,
        "externalUserId": "42",
        "uploaderId": USER,
    }
    assert req["conversation"]["id"] == "telegram:-10042"
    assert req["eventId"] == "telegram-update-7"
    assert req["attachments"] == [
        {
            "attachmentId": "attachment-0",
            "kind": "pdf",
            "mimeType": "application/pdf",
            "filename": "VLT User Manual.pdf",
            "sizeBytes": len(PDF_BYTES),
            "sha256": PDF_SHA,
        }
    ]


def test_slack_thread_root_is_the_conversation_while_telegram_replies_stay_in_chat() -> None:
    telegram = build_channel_request(
        event("telegram"), tenant_id=TENANT, actor_id=USER, uploader_id=USER
    )
    slack = build_channel_request(
        event("slack"), tenant_id=TENANT, actor_id=USER, uploader_id=USER
    )

    assert telegram["conversation"]["id"] == "telegram:-10042"
    assert slack["conversation"]["id"] == "slack:C-MAINT:1700000000.001"


def test_telegram_and_slack_transport_variants_have_equal_semantics() -> None:
    telegram = build_channel_request(
        event("telegram"), tenant_id=TENANT, actor_id=USER, uploader_id=USER
    )
    slack = build_channel_request(
        event("slack"), tenant_id=TENANT, actor_id=USER, uploader_id=USER
    )

    assert semantic_projection(slack) == semantic_projection(telegram)
    assert semantic_projection(telegram)["attachments"][0]["sha256"] == PDF_SHA


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("tenant_id", "staging", "invalid_tenant_id"),
        ("tenant_id", "", "invalid_tenant_id"),
        ("actor_id", "", "actor_id_required"),
        ("uploader_id", "", "uploader_id_required"),
    ],
)
def test_required_identity_boundaries_fail_closed(field: str, value: str, message: str) -> None:
    kwargs = {"tenant_id": TENANT, "actor_id": USER, "uploader_id": USER}
    kwargs[field] = value
    with pytest.raises(ChannelWorkflowContractError, match=message):
        build_channel_request(event("telegram"), **kwargs)


def test_missing_event_id_and_attachment_bytes_fail_closed() -> None:
    missing_event = event("telegram")
    missing_event.event_id = ""
    with pytest.raises(ChannelWorkflowContractError, match="event_id_required"):
        build_channel_request(
            missing_event, tenant_id=TENANT, actor_id=USER, uploader_id=USER
        )

    missing_bytes = event("telegram")
    missing_bytes.attachments[0].data = b""
    with pytest.raises(ChannelWorkflowContractError, match="attachment_bytes_required"):
        build_channel_request(
            missing_bytes, tenant_id=TENANT, actor_id=USER, uploader_id=USER
        )


def test_normalized_response_carries_operation_and_delivery_semantics() -> None:
    response = NormalizedChatResponse(
        text="Manual candidate found.",
        operation_id="44444444-4444-4444-8444-444444444444",
        operation_state="candidate_review",
        semantic_kind="nameplate_manual",
        citations=[{"docId": "doc-1", "page": 12}],
        provenance={"channel": "telegram"},
        terminal_delivery_token="delivery-token",
        suppress_delivery=False,
    )

    assert response.operation_id == "44444444-4444-4444-8444-444444444444"
    assert response.operation_state == "candidate_review"
    assert response.semantic_kind == "nameplate_manual"
    assert response.citations == [{"docId": "doc-1", "page": 12}]
    assert response.terminal_delivery_token == "delivery-token"
    assert response.suppress_delivery is False
