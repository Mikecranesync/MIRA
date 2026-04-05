"""Background health probe for Tier 1 (local Ollama) availability.

Pings the Ollama /api/tags endpoint on a configurable interval and caches
the result. Logs warnings on state transitions (up → down, down → up).
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

logger = logging.getLogger("mira-sidecar")


class HealthProbe:
    """Monitors Ollama availability at a given URL."""

    def __init__(self, ollama_url: str, interval: int = 30, timeout: int = 3) -> None:
        self._url = ollama_url.rstrip("/")
        self._interval = interval
        self._timeout = timeout
        self._available = False
        self._last_check: float = 0
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None

    @property
    def available(self) -> bool:
        return self._available

    @property
    def url(self) -> str:
        return self._url

    async def check_once(self) -> bool:
        """Ping Ollama /api/tags and return True if reachable."""
        if not self._url:
            return False
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            resp = await client.get(f"{self._url}/api/tags")
            resp.raise_for_status()
            return True
        except Exception:
            return False
        finally:
            if not self._client:
                await client.aclose()

    async def _loop(self) -> None:
        """Background loop that checks Ollama availability.

        Uses asyncio.wait_for as a hard cap so a hung HTTP connection
        never blocks the event loop longer than _timeout seconds.
        """
        while True:
            was_available = self._available
            try:
                self._available = await asyncio.wait_for(
                    self.check_once(), timeout=self._timeout + 1
                )
            except asyncio.TimeoutError:
                self._available = False

            self._last_check = time.monotonic()

            if was_available and not self._available:
                logger.warning("HEALTH_PROBE tier1 DOWN — %s unreachable", self._url)
            elif not was_available and self._available:
                logger.info("HEALTH_PROBE tier1 UP — %s reachable", self._url)

            await asyncio.sleep(self._interval)

    def start(self) -> None:
        """Start the background probe task with a reusable HTTP client."""
        if self._task is None or self._task.done():
            self._client = httpx.AsyncClient(timeout=self._timeout)
            self._task = asyncio.create_task(self._loop())
            logger.info(
                "HEALTH_PROBE started — url=%s interval=%ds",
                self._url,
                self._interval,
            )

    async def _stop_async(self) -> None:
        """Cancel the probe task and close the HTTP client."""
        if self._task and not self._task.done():
            self._task.cancel()
        if self._client:
            await self._client.aclose()
            self._client = None
        logger.info("HEALTH_PROBE stopped")

    def stop(self) -> None:
        """Schedule async cleanup from sync context (lifespan teardown)."""
        if self._task and not self._task.done():
            self._task.cancel()
        if self._client:
            # Schedule client close — safe from lifespan teardown
            asyncio.get_event_loop().create_task(self._client.aclose())
            self._client = None
        logger.info("HEALTH_PROBE stopped")
