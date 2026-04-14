"""MIRA GSD Engine — Backwards-compatible wrapper delegating to Supervisor.

All business logic lives in shared.engine.Supervisor. This module exists so
existing callers (bot.py) can continue using `from shared.gsd_engine import GSDEngine`
without changes to the public API.
"""

from shared.engine import Supervisor


class GSDEngine:
    """Guided Socratic Dialogue engine — thin wrapper around Supervisor."""

    def __init__(
        self,
        db_path: str,
        openwebui_url: str,
        api_key: str,
        collection_id: str,
        vision_model: str = "qwen2.5vl:7b",
        tenant_id: str = None,
        ingest_url: str = None,
        mcp_url: str = None,
    ):
        self._supervisor = Supervisor(
            db_path=db_path,
            openwebui_url=openwebui_url,
            api_key=api_key,
            collection_id=collection_id,
            vision_model=vision_model,
            tenant_id=tenant_id,
            mcp_base_url=mcp_url or "",
        )

    async def process(
        self,
        chat_id: str,
        message: str,
        photo_b64: str = None,
        *,
        platform: str = "telegram",
    ) -> str:
        """Main entry point. Returns reply string."""
        return await self._supervisor.process(
            chat_id,
            message,
            photo_b64,
            platform=platform,
        )

    def reset(self, chat_id: str) -> None:
        """Reset conversation to IDLE state."""
        self._supervisor.reset(chat_id)

    def log_feedback(self, chat_id: str, feedback: str, reason: str = "") -> None:
        self._supervisor.log_feedback(chat_id, feedback, reason)
