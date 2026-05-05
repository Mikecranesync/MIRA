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
    doc_count: int = 0


class ScanRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"


class ChatSource(BaseModel):
    title: str
    url: str | None = None
    page: int | None = None


class ChatMessageRequest(BaseModel):
    asset_id: str | None = None
    message: str
    history: list[dict] = Field(default_factory=list)


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
