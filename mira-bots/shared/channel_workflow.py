"""Channel-neutral Hub workflow contract and client boundary.

This module owns transport normalization only. The Hub owns recognition,
manual discovery, canonical Files, applicability, retrieval, grounding,
citations, operation state, and possession truth.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import os
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse, ResponseBlock

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_CHANNELS = frozenset({"telegram", "slack", "hub", "mobile"})
_ACTIONS = frozenset({"message", "reset", "confirm_identity"})
_IDENTITY_FIELDS = frozenset(
    {
        "manufacturer",
        "productFamily",
        "series",
        "model",
        "typeCode",
        "partNumber",
        "catalogNumber",
        "serialNumber",
        "equipmentType",
        "rating",
        "input",
        "confidence",
    }
)


class ChannelWorkflowContractError(ValueError):
    """A normalized request cannot safely cross the Hub service boundary."""


class ChannelWorkflowConfigError(RuntimeError):
    """The feature was enabled without a complete authenticated Hub boundary."""


class ChannelWorkflowProtocolError(RuntimeError):
    """The Hub returned a response that cannot be safely rendered."""


@dataclass(frozen=True, slots=True)
class ChannelWorkflowSettings:
    enabled: bool
    hub_url: str = ""
    base_path: str = ""
    token: str = ""
    tenant_id: str = ""
    poll_interval_seconds: float = 2.0
    operation_timeout_seconds: float = 600.0


ProgressCallback = Callable[[str, str], Awaitable[None]]


def validate_channel_workflow_config(
    env: Mapping[str, str] | None = None,
) -> ChannelWorkflowSettings:
    """Validate the feature before a bot starts polling or opens Socket Mode."""

    source = os.environ if env is None else env
    raw_enabled = str(source.get("MIRA_CHANNEL_WORKFLOW_ENABLED", "0")).strip().lower()
    if raw_enabled in {"", "0", "false", "no", "off"}:
        return ChannelWorkflowSettings(enabled=False)
    if raw_enabled not in {"1", "true", "yes", "on"}:
        raise ChannelWorkflowConfigError("invalid MIRA_CHANNEL_WORKFLOW_ENABLED")

    hub_url = str(source.get("HUB_URL", "")).strip().rstrip("/")
    parsed = urlsplit(hub_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ChannelWorkflowConfigError("HUB_URL must be an HTTP(S) origin")

    base_path = str(source.get("HUB_BASE_PATH", "/hub")).strip()
    if base_path in {"", "/"}:
        base_path = ""
    else:
        base_path = "/" + base_path.strip("/")
        if ".." in base_path.split("/") or "//" in base_path:
            raise ChannelWorkflowConfigError("HUB_BASE_PATH is invalid")

    token = str(source.get("HUB_INGEST_TOKEN", "")).strip()
    if not token:
        raise ChannelWorkflowConfigError("HUB_INGEST_TOKEN is required")
    try:
        tenant_id = _uuid(str(source.get("MIRA_TENANT_ID", "")), "MIRA_TENANT_ID must be a UUID")
    except ChannelWorkflowContractError as exc:
        raise ChannelWorkflowConfigError(str(exc)) from exc
    try:
        poll_interval = float(source.get("MIRA_CHANNEL_WORKFLOW_POLL_SECONDS", "2"))
        operation_timeout = float(source.get("MIRA_CHANNEL_WORKFLOW_TIMEOUT_SECONDS", "600"))
    except (TypeError, ValueError) as exc:
        raise ChannelWorkflowConfigError("channel workflow timing is invalid") from exc
    if poll_interval <= 0 or operation_timeout <= 0:
        raise ChannelWorkflowConfigError("channel workflow timing must be positive")
    return ChannelWorkflowSettings(
        enabled=True,
        hub_url=hub_url,
        base_path=base_path,
        token=token,
        tenant_id=tenant_id,
        poll_interval_seconds=poll_interval,
        operation_timeout_seconds=operation_timeout,
    )


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


def _confirmed_identity(value: dict[str, Any]) -> dict[str, Any]:
    if not value:
        raise ChannelWorkflowContractError("invalid_confirmed_identity")
    if any(key not in _IDENTITY_FIELDS for key in value):
        raise ChannelWorkflowContractError("unknown_identity_field")
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if key == "confidence":
            if item is not None and (
                isinstance(item, bool) or not isinstance(item, (int, float)) or not 0 <= item <= 1
            ):
                raise ChannelWorkflowContractError("invalid_identity_confidence")
            normalized[key] = item
        elif item is None:
            normalized[key] = None
        elif isinstance(item, str):
            normalized[key] = item.strip()[:500] or None
        else:
            raise ChannelWorkflowContractError("invalid_identity_field")
    return normalized


def build_channel_request(
    event: NormalizedChatEvent,
    *,
    tenant_id: str,
    actor_id: str,
    uploader_id: str,
    action: str = "message",
    context: dict[str, str] | None = None,
    prior_operation_id: str = "",
    confirmed_identity: dict[str, Any] | None = None,
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
    actor = _uuid(_required(actor_id, "actor_id_required"), "invalid_actor_id")
    uploader = _uuid(_required(uploader_id, "uploader_id_required"), "invalid_uploader_id")
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
        request["priorOperationId"] = _uuid(prior_operation_id, "invalid_prior_operation_id")
    if action == "confirm_identity" and not prior_operation_id:
        raise ChannelWorkflowContractError("prior_operation_required")
    if confirmed_identity is not None:
        if action != "confirm_identity":
            raise ChannelWorkflowContractError("confirmed_identity_requires_confirmation")
        request["confirmedIdentity"] = _confirmed_identity(confirmed_identity)
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


def _dict(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ChannelWorkflowProtocolError(code)
    return value


def _string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _workflow_failure(operation_id: str, state: str, message: str) -> NormalizedChatResponse:
    return NormalizedChatResponse(
        text=message,
        operation_id=operation_id,
        operation_state=state,
        semantic_kind="fallthrough",
        provenance={"clientBoundaryFailure": True},
        workflow_handled=True,
    )


def _identity_pairs(identity: dict[str, Any]) -> list[tuple[str, str]]:
    labels = {
        "manufacturer": "Manufacturer",
        "productFamily": "Product",
        "series": "Series",
        "model": "Model",
        "typeCode": "Type code",
        "partNumber": "P/N",
        "catalogNumber": "Catalog",
        "serialNumber": "S/N",
        "rating": "Rating",
        "input": "Input",
    }
    return [
        (label, str(identity[key]))
        for key, label in labels.items()
        if identity.get(key) not in {None, ""}
    ]


def _render_result(result: dict[str, Any], *, delivery_token: str = "") -> NormalizedChatResponse:
    operation_id = _string(result.get("operationId"))
    state = _string(result.get("state")) or "failed"
    semantic_kind = _string(result.get("semanticKind")) or "fallthrough"
    handled = result.get("handled") is True
    provenance = result.get("provenance")
    provenance = provenance if isinstance(provenance, dict) else {}
    citations = (
        result.get("answer", {}).get("citations", [])
        if isinstance(result.get("answer"), dict)
        else []
    )
    citations = [item for item in citations if isinstance(item, dict)]
    blocks: list[ResponseBlock] = []
    text = ""

    if not handled:
        return NormalizedChatResponse(
            text="",
            operation_id=operation_id,
            operation_state=state,
            semantic_kind=semantic_kind,
            provenance=provenance,
            terminal_delivery_token=delivery_token,
            workflow_handled=False,
        )

    identity = result.get("identity")
    if isinstance(identity, dict):
        pairs = _identity_pairs(identity)
        if pairs:
            blocks.append(ResponseBlock(kind="header", data={"text": "Equipment identity"}))
            blocks.append(ResponseBlock(kind="key_value", data={"pairs": pairs}))

    if semantic_kind == "nameplate_manual":
        manual = result.get("manual")
        manual = manual if isinstance(manual, dict) else {}
        candidate = manual.get("candidate")
        candidate = candidate if isinstance(candidate, dict) else {}
        title = _string(candidate.get("title"))
        url = _string(candidate.get("url"))
        if manual.get("verifiedGroundingSource") is True:
            text = "The confirmed official manual is indexed and available for cited answers."
            blocks.append(ResponseBlock(kind="paragraph", data={"text": text}))
        elif candidate:
            qualifier = "official OEM" if manual.get("official") is True else "unverified"
            text = f"Found a {qualifier} manual candidate: {title or url}. Confirm the equipment identity before intake."
            blocks.append(ResponseBlock(kind="paragraph", data={"text": text}))
            if url:
                blocks.append(ResponseBlock(kind="citation", data={"source": url}))
            blocks.append(
                ResponseBlock(
                    kind="button_row",
                    data={
                        "buttons": [
                            {
                                "label": "Confirm identity",
                                "action": "channel_workflow_confirm",
                                "value": operation_id,
                            }
                        ]
                    },
                )
            )
        else:
            reason = _string(manual.get("reason"))
            text = "No verified official manual was found for the recognized identity."
            if reason:
                text += f" {reason}"
            blocks.append(ResponseBlock(kind="warning", data={"text": text}))
    elif semantic_kind == "file_intake":
        files = result.get("files")
        files = files if isinstance(files, list) else []
        lines: list[str] = []
        for item in files:
            if not isinstance(item, dict):
                continue
            filename = _string(item.get("filename")) or "Uploaded PDF"
            file_id = _string(item.get("fileId"))
            document_id = _string(item.get("documentId"))
            status = _string(item.get("processingState")) or "processing"
            indexed = item.get("indexed") is True
            lines.append(
                f"{filename}: File {file_id}; document {document_id or 'pending'}; "
                f"state {status}{'; indexed' if indexed else ''}."
            )
        text = "\n".join(lines) or "The PDF intake did not return a canonical File ID."
        blocks.append(ResponseBlock(kind="paragraph", data={"text": text}))
    elif semantic_kind == "grounded_answer":
        answer = result.get("answer")
        answer = answer if isinstance(answer, dict) else {}
        text = _string(answer.get("text")) or "The canonical sources did not support an answer."
        blocks.append(ResponseBlock(kind="paragraph", data={"text": text}))
        for citation in citations:
            source = _string(citation.get("sourceTitle")) or _string(citation.get("docId"))
            page = citation.get("page")
            quote = _string(citation.get("quote"))
            label = source + (f", p. {page}" if isinstance(page, int) else "")
            if quote:
                label += f": {quote}"
            blocks.append(ResponseBlock(kind="citation", data={"source": label}))
    elif semantic_kind == "reset":
        text = "Fresh canonical workspace created. Prior equipment, print, and document context is no longer active."
        blocks.append(ResponseBlock(kind="paragraph", data={"text": text}))
    else:
        answer = result.get("answer")
        answer = answer if isinstance(answer, dict) else {}
        text = (
            _string(answer.get("text")) or "The canonical workflow could not complete this request."
        )
        blocks.append(ResponseBlock(kind="warning", data={"text": text}))

    return NormalizedChatResponse(
        text=text,
        blocks=blocks,
        operation_id=operation_id,
        operation_state=state,
        semantic_kind=semantic_kind,
        citations=citations,
        provenance=provenance,
        terminal_delivery_token=delivery_token,
        suppress_delivery=False,
        workflow_handled=True,
    )


class ChannelWorkflowClient:
    """Two-phase authenticated client for one Hub-owned semantic operation."""

    def __init__(
        self,
        settings: ChannelWorkflowSettings,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self.enabled = settings.enabled
        self._http = http_client

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "ChannelWorkflowClient":
        return cls(validate_channel_workflow_config(env))

    def _url(self, suffix: str) -> str:
        return f"{self.settings.hub_url}{self.settings.base_path}{suffix}"

    def _headers(self, request: dict[str, Any]) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.token}",
            "X-Mira-Tenant-Id": request["tenantId"],
            "X-Mira-User-Id": request["actor"]["userId"],
            "X-Mira-Source-Channel": request["channel"],
        }

    async def _with_http(self, fn: Callable[[httpx.AsyncClient], Awaitable[Any]]) -> Any:
        if self._http is not None:
            return await fn(self._http)
        timeout = httpx.Timeout(
            connect=10,
            read=max(30.0, self.settings.operation_timeout_seconds),
            write=max(30.0, self.settings.operation_timeout_seconds),
            pool=10,
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await fn(client)

    async def prepare_execute(
        self,
        event: NormalizedChatEvent,
        *,
        actor_id: str,
        uploader_id: str,
        action: str = "message",
        context: dict[str, str] | None = None,
        prior_operation_id: str = "",
        confirmed_identity: dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> NormalizedChatResponse:
        if not self.enabled:
            raise ChannelWorkflowConfigError("channel workflow is disabled")
        request = build_channel_request(
            event,
            tenant_id=event.tenant_id,
            actor_id=actor_id,
            uploader_id=uploader_id,
            action=action,
            context=context,
            prior_operation_id=prior_operation_id,
            confirmed_identity=confirmed_identity,
        )

        async def run(http: httpx.AsyncClient) -> NormalizedChatResponse:
            return await self._prepare_execute(http, request, event, on_progress)

        try:
            response = await self._with_http(run)
            response.delivery_tenant_id = request["tenantId"]
            response.delivery_user_id = request["actor"]["userId"]
            response.delivery_channel = request["channel"]
            return response
        except (httpx.HTTPError, ChannelWorkflowProtocolError) as exc:
            operation_id = getattr(exc, "operation_id", "")
            return _workflow_failure(
                operation_id,
                "failed",
                "The canonical MIRA workflow was unavailable for this request; no answer was produced.",
            )

    async def _prepare_execute(
        self,
        http: httpx.AsyncClient,
        request: dict[str, Any],
        event: NormalizedChatEvent,
        on_progress: ProgressCallback | None,
    ) -> NormalizedChatResponse:
        headers = self._headers(request)
        prepared_response = await http.post(
            self._url("/api/channel-workflow/operations"), headers=headers, json=request
        )
        if prepared_response.status_code >= 400:
            raise ChannelWorkflowProtocolError("workflow_prepare_failed")
        prepared = _dict(prepared_response.json(), "invalid_prepare_response")
        operation_id = _string(prepared.get("operationId"))
        disposition = _string(prepared.get("disposition"))
        if not _UUID_RE.fullmatch(operation_id):
            raise ChannelWorkflowProtocolError("invalid_operation_id")
        try:
            if disposition == "execute":
                if on_progress is not None:
                    await on_progress(operation_id, "prepared")
                owner_token = _string(prepared.get("ownerToken"))
                if not _UUID_RE.fullmatch(owner_token):
                    raise ChannelWorkflowProtocolError("invalid_owner_token")
                return await self._execute_owned(
                    http, request, event, operation_id, owner_token, on_progress
                )
            if disposition == "terminal":
                token = _string(prepared.get("deliveryToken"))
                result = prepared.get("result")
                if not token:
                    return self._suppressed(operation_id, _string(prepared.get("state")))
                return _render_result(
                    _dict(result, "invalid_terminal_result"), delivery_token=token
                )
            if disposition == "running":
                if on_progress is not None:
                    await on_progress(operation_id, "prepared")
                return await self._wait_for_delivery(http, request, operation_id, on_progress)
            if disposition == "cancelled":
                return self._suppressed(operation_id, "cancelled")
            raise ChannelWorkflowProtocolError("invalid_operation_disposition")
        except (httpx.HTTPError, ChannelWorkflowProtocolError) as exc:
            setattr(exc, "operation_id", operation_id)
            raise

    async def _execute_owned(
        self,
        http: httpx.AsyncClient,
        request: dict[str, Any],
        event: NormalizedChatEvent,
        operation_id: str,
        owner_token: str,
        on_progress: ProgressCallback | None,
    ) -> NormalizedChatResponse:
        files = []
        if len(event.attachments) != len(request["attachments"]):
            raise ChannelWorkflowProtocolError("attachment_count_mismatch")
        for attachment, descriptor in zip(event.attachments, request["attachments"], strict=True):
            files.append(
                (
                    f"attachment:{descriptor['attachmentId']}",
                    (descriptor["filename"], bytes(attachment.data), descriptor["mimeType"]),
                )
            )
        headers = {**self._headers(request), "X-Mira-Owner-Token": owner_token}

        async def submit() -> httpx.Response:
            return await http.post(
                self._url(f"/api/channel-workflow/operations/{operation_id}/execute"),
                headers=headers,
                files=files or None,
            )

        task = asyncio.create_task(submit())
        last_step = "prepared"
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=self.settings.poll_interval_seconds)
                if done:
                    response = await task
                    break
                status = await self._status(http, request, operation_id)
                step = _string(status.get("progressStep"))
                if on_progress is not None and step and step != last_step:
                    last_step = step
                    await on_progress(operation_id, step)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        payload = _dict(response.json(), "invalid_execute_response")
        result = _dict(payload.get("result"), "invalid_execute_result")
        token = _string(payload.get("deliveryToken"))
        if not token:
            return self._suppressed(operation_id, _string(payload.get("state")))
        return _render_result(result, delivery_token=token)

    async def _status(
        self, http: httpx.AsyncClient, request: dict[str, Any], operation_id: str
    ) -> dict[str, Any]:
        response = await http.get(
            self._url(f"/api/channel-workflow/operations/{operation_id}"),
            headers=self._headers(request),
        )
        if response.status_code >= 400:
            raise ChannelWorkflowProtocolError("workflow_status_failed")
        return _dict(response.json(), "invalid_status_response")

    async def _wait_for_delivery(
        self,
        http: httpx.AsyncClient,
        request: dict[str, Any],
        operation_id: str,
        on_progress: ProgressCallback | None,
    ) -> NormalizedChatResponse:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.operation_timeout_seconds
        last_step = "prepared"
        while loop.time() < deadline:
            status = await self._status(http, request, operation_id)
            step = _string(status.get("progressStep"))
            if on_progress is not None and step and step != last_step:
                last_step = step
                await on_progress(operation_id, step)
            state = _string(status.get("state"))
            if state in {"complete", "candidate_review", "insufficient_evidence", "failed"}:
                if status.get("terminalDelivered") is True:
                    return self._suppressed(operation_id, state)
                delivery = await http.get(
                    self._url(f"/api/channel-workflow/operations/{operation_id}/delivery"),
                    headers=self._headers(request),
                )
                payload = _dict(delivery.json(), "invalid_delivery_response")
                token = _string(payload.get("deliveryToken"))
                if delivery.status_code != 200 or not token:
                    return self._suppressed(operation_id, state)
                return _render_result(
                    _dict(payload.get("result"), "invalid_delivery_result"),
                    delivery_token=token,
                )
            await asyncio.sleep(self.settings.poll_interval_seconds)
        return _workflow_failure(
            operation_id,
            "running",
            f"Canonical operation {operation_id} did not reach a terminal state before this request ended.",
        )

    @staticmethod
    def _suppressed(operation_id: str, state: str) -> NormalizedChatResponse:
        return NormalizedChatResponse(
            text="",
            operation_id=operation_id,
            operation_state=state,
            suppress_delivery=True,
            workflow_handled=True,
        )

    async def ack_delivery(self, response: NormalizedChatResponse) -> bool:
        if (
            not self.enabled
            or response.suppress_delivery
            or not response.operation_id
            or not response.terminal_delivery_token
        ):
            return False

        async def send(http: httpx.AsyncClient) -> bool:
            tenant_id = response.delivery_tenant_id
            user_id = response.delivery_user_id
            channel = response.delivery_channel
            if not (_UUID_RE.fullmatch(tenant_id) and _UUID_RE.fullmatch(user_id)):
                raise ChannelWorkflowProtocolError("delivery_identity_missing")
            headers = {
                "Authorization": f"Bearer {self.settings.token}",
                "X-Mira-Tenant-Id": tenant_id,
                "X-Mira-User-Id": user_id,
                "X-Mira-Source-Channel": channel,
            }
            ack = await http.post(
                self._url(f"/api/channel-workflow/operations/{response.operation_id}/delivery"),
                headers=headers,
                json={"deliveryToken": response.terminal_delivery_token},
            )
            return ack.status_code == 200 and ack.json().get("acknowledged") is True

        return bool(await self._with_http(send))
