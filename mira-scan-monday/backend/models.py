from __future__ import annotations

from pydantic import BaseModel, Field


class AssetPlate(BaseModel):
    make: str = ""
    model: str = ""
    serial: str | None = None
    voltage: str | None = None
    hp: str | None = None
    rpm: str | None = None
    hz: str | None = None
    frame: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class KBResult(BaseModel):
    matched: bool
    asset_id: str | None = None
    asset_label: str | None = None
    doc_count: int = 0
    queued: QueueAck | None = None


class ScanRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"


class ChatSource(BaseModel):
    title: str
    url: str | None = None
    page: int | None = None


class ChatMessageRequest(BaseModel):
    asset_id: str | None = None
    asset_label: str | None = None
    message: str
    history: list[dict] = Field(default_factory=list)


class QueueAck(BaseModel):
    id: int
    status: str
    times_seen: int
    first_seen: str | None = None


class ManualRequestQueueRequest(BaseModel):
    make: str
    model: str
    serial: str | None = None
    source: str = "mira-scan"
    notes: str | None = None


class ManualRequestQueueResponse(BaseModel):
    ok: bool
    queued: QueueAck | None = None
    item: dict | None = None
    error: str | None = None


class QueueItem(BaseModel):
    id: int
    make: str
    model: str
    serial: str | None = None
    source: str
    status: str
    times_seen: int
    first_seen: str | None = None
    last_seen: str | None = None
    manual_url: str | None = None
    notes: str | None = None


class QueueStatusResponse(BaseModel):
    available: bool
    counts: dict[str, int] = Field(default_factory=dict)
    items: list[dict] = Field(default_factory=list)


KBResult.model_rebuild()


class ChatMessageResponse(BaseModel):
    reply: str
    sources: list[ChatSource] = Field(default_factory=list)


class MondayColumnUpdate(BaseModel):
    item_id: str
    board_id: str
    columns: dict[str, object]


class MondayUpdateResponse(BaseModel):
    ok: bool
    monday_item_id: str | None = None
    error: str | None = None
