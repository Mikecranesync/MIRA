"""Atlas CMMS thin client — bot-adapter side.

Calls the mira-mcp REST proxy (/api/cmms/work-orders) rather than Atlas
directly.  Auth is handled by mira-mcp using ATLAS_API_USER / ATLAS_API_PASSWORD;
this client only needs the MCP_REST_API_KEY bearer token.

Usage in engine.py:
    client = AtlasCMMSClient(base_url=self.mcp_base_url, api_key=self.mcp_api_key)
    result = await client.create_work_order(title, description, priority)
    wo_id  = result.get("id")

Hardening (Unit 8 — CRA-17):
- 3 attempts with exponential backoff (1s, 2s) on connection / timeout / 5xx
- 4xx responses are NOT retried (auth/validation errors are permanent)
- After all attempts fail, the payload is enqueued to the
  ``wo_outbox`` SQLite table via ``shared.integrations.wo_outbox.enqueue``;
  the bot's drain task retries every 5 minutes and admin-alerts after 3h.
- Returns ``{"error": "...", "outbox_id": N}`` so callers know the WO is
  durably persisted and will keep retrying. Existing callers that only
  check for the ``error`` key keep working unchanged.
"""

from __future__ import annotations

import asyncio
import logging
import os

import httpx

from .wo_outbox import enqueue as outbox_enqueue

logger = logging.getLogger("mira-gsd")

_TIMEOUT = 15  # seconds per attempt
_MAX_ATTEMPTS = 3  # 1 + 2 retries
_BASE_BACKOFF = 1.0  # 1s, 2s between attempts


class AtlasCMMSClient:
    """Thin async wrapper around mira-mcp's /api/cmms REST surface."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("MCP_BASE_URL", "http://mira-mcp:8001")).rstrip("/")
        self.api_key = api_key or os.getenv("MCP_REST_API_KEY", "")

    @property
    def configured(self) -> bool:
        """True when mira-mcp URL is set (api_key is optional on dev installs)."""
        return bool(self.base_url)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _post_work_order(self, payload: dict) -> dict:
        """Single attempt — caller handles retry + outbox enqueue.

        Returns the parsed JSON on 2xx. Raises ``httpx.HTTPStatusError`` on
        non-2xx (so retry logic can distinguish 4xx-permanent from
        5xx-transient) and lower-level transport errors as-is.
        """
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base_url}/api/cmms/work-orders",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: int = 0,
        category: str = "CORRECTIVE",
    ) -> dict:
        """POST /api/cmms/work-orders via mira-mcp with retry + durable outbox.

        Returns the work-order dict on success (always contains "id").
        Returns ``{"error": "...", "outbox_id": N}`` after every retry attempt
        has failed — the payload is now durably persisted in the outbox and
        will keep retrying via the drain task. Never raises.
        """
        payload = {
            "title": title[:100],
            "description": description[:2000],
            "priority": priority,
            "asset_id": asset_id,
            "category": category,
        }

        last_error_repr = "no attempts made"
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                return await self._post_work_order(payload)
            except httpx.HTTPStatusError as e:
                last_error_repr = f"HTTP {e.response.status_code}: {e.response.text[:100]}"
                if e.response.status_code < 500:
                    logger.error(
                        "CMMS WO create HTTP %d (no retry — 4xx is permanent): %s",
                        e.response.status_code,
                        e.response.text[:200],
                    )
                    return {"error": last_error_repr}
                logger.warning(
                    "CMMS WO create HTTP %d attempt=%d/%d — will retry",
                    e.response.status_code,
                    attempt,
                    _MAX_ATTEMPTS,
                )
            except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
                last_error_repr = f"{type(e).__name__}: {e}"
                logger.warning(
                    "CMMS WO create %s attempt=%d/%d — will retry",
                    type(e).__name__,
                    attempt,
                    _MAX_ATTEMPTS,
                )
            except Exception as e:
                last_error_repr = f"{type(e).__name__}: {e}"
                logger.warning(
                    "CMMS WO create %s attempt=%d/%d — will retry",
                    type(e).__name__,
                    attempt,
                    _MAX_ATTEMPTS,
                )

            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(_BASE_BACKOFF * (2 ** (attempt - 1)))

        try:
            outbox_id = outbox_enqueue(payload, last_error_repr)
        except Exception as enq_exc:
            logger.error(
                "CMMS WO outbox enqueue failed (work order may be lost!): %s",
                enq_exc,
            )
            return {"error": last_error_repr}

        logger.error(
            "CMMS WO create exhausted %d attempts — enqueued outbox_id=%d last_error=%s",
            _MAX_ATTEMPTS,
            outbox_id,
            last_error_repr,
        )
        return {"error": last_error_repr, "outbox_id": outbox_id}

    async def health_check(self) -> bool:
        """GET /health — returns True when mira-mcp responds 200."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self.base_url}/health",
                    headers=self._headers(),
                )
                return resp.status_code == 200
        except Exception as e:
            logger.warning("CMMS health check failed: %s", e)
            return False
