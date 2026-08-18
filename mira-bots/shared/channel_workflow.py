"""Channel-neutral Hub workflow contract and client boundary.

This module owns transport normalization only. The Hub owns recognition,
manual discovery, canonical Files, applicability, retrieval, grounding,
citations, operation state, and possession truth.
"""

from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

from shared.chat.types import NormalizedChatEvent


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_CHANNELS = frozenset({"telegram", "slack", "hub", "mobile"})
_ACTIONS = frozenset({"message", "reset", "confirm_identity"})


class ChannelWorkflowContractError(ValueError):
    """A normalized request cannot safely cross the Hub service boundary."""


def _required(value: str, code: str) -> str:
    value = str(value or "").strip()
    if not value:
        raise ChannelWorkflowContractError(code)
    return value


def _uuid(value: str, code: str) -> str:
    value = str(value or "").strip()
    if not _UUID_RE.fullmatch(value):
        raise ChannelWorkflowContractError(code)
    return value.lower()


def _conversation_id(event: NormalizedChatEvent) -> str:
    channel = str(event.platform)
    external_channel = _required(event.external_channel_id, "conversation_id_required")
    if channel == "slack":
        thread = _required(event.external_thread_id, "conversation_thread_required")
        return f"slack:{external_channel}:{thread}"
    if channel == "telegram":
        # Telegram reply_to_message_id is not a conversation boundary. Treating
        # each reply as a new workspace caused document and photo amnesia.
        return f"telegram:{external_channel}"
    return f"{channel}:{external_channel}"


def build_channel_request(
    event: NormalizedChatEvent,
    *,
    tenant_id: str,
    actor_id: str,
    uploader_id: str,
    action: str = "message",
    context: dict[str, str] | None = None,
    prior_operation_id: str = "",
) -> dict[str, Any]:
    """Build the v1 request from a normalized adapter event.

    Hashes and sizes come from the bytes actually submitted, never from a
    platform-declared size. Attachments without downloaded bytes fail closed.
    """

    channel = str(event.platform)
    if channel not in _CHANNELS:
        raise ChannelWorkflowContractError("invalid_channel")
    if action not in _ACTIONS:
        raise ChannelWorkflowContractError("invalid_action")

    tenant = _uuid(tenant_id, "invalid_tenant_id")
    actor = _required(actor_id, "actor_id_required")
    uploader = _required(uploader_id, "uploader_id_required")
    external_user = _required(event.external_user_id, "external_user_id_required")
    event_id = _required(event.event_id, "event_id_required")

    conversation: dict[str, str] = {"id": _conversation_id(event)}
    allowed_context = {
        "sessionId": "invalid_session_id",
        "notebookId": "invalid_notebook_id",
        "assetId": "invalid_asset_id",
        "nodeId": "invalid_node_id",
    }
    for key, value in (context or {}).items():
        if key not in allowed_context:
            raise ChannelWorkflowContractError("unknown_context_field")
        if value:
            conversation[key] = _uuid(value, allowed_context[key])

    attachments: list[dict[str, Any]] = []
    for index, attachment in enumerate(event.attachments):
        if not attachment.data:
            raise ChannelWorkflowContractError("attachment_bytes_required")
        raw = bytes(attachment.data)
        kind = str(attachment.kind)
        if kind not in {"image", "pdf", "other"}:
            raise ChannelWorkflowContractError("invalid_attachment_kind")
        attachments.append(
            {
                "attachmentId": f"attachment-{index}",
                "kind": kind,
                "mimeType": _required(attachment.mime_type, "attachment_mime_required"),
                "filename": _required(attachment.filename, "attachment_filename_required"),
                "sizeBytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )

    request: dict[str, Any] = {
        "contractVersion": "1.0",
        "tenantId": tenant,
        "actor": {
            "userId": actor,
            "externalUserId": external_user,
            "uploaderId": uploader,
        },
        "channel": channel,
        "eventId": event_id,
        "conversation": conversation,
        "action": action,
        "text": str(event.text or "")[:4000],
        "caption": str(event.text or "")[:4000] if event.attachments else "",
        "attachments": attachments,
    }
    if prior_operation_id:
        request["priorOperationId"] = _uuid(
            prior_operation_id, "invalid_prior_operation_id"
        )
    return request


def semantic_projection(request: dict[str, Any]) -> dict[str, Any]:
    """Remove only transport identity for cross-client semantic parity tests."""

    projection = copy.deepcopy(request)
    projection.pop("channel", None)
    projection.pop("eventId", None)
    projection.get("actor", {}).pop("externalUserId", None)
    projection.get("conversation", {}).pop("id", None)
    for attachment in projection.get("attachments", []):
        attachment.pop("attachmentId", None)
    return projection
