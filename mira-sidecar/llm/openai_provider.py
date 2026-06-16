"""OpenAI LLM + embedding provider.

Uses httpx directly — no openai SDK dependency.
Both chat completions and embeddings are handled here.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("mira-sidecar")

_CHAT_URL = "https://api.openai.com/v1/chat/completions"
_EMBED_URL = "https://api.openai.com/v1/embeddings"


class OpenAIProvider:
    """Calls OpenAI API via httpx without the official SDK."""

    def __init__(
        self,
        api_key: str,
        chat_model: str = "gpt-4o-mini",
        embed_model: str = "text-embedding-3-small",
        timeout: float = 60.0,
    ) -> None:
        self._api_key = api_key
        self._chat_model = chat_model
        self._embed_model = embed_model
        self._timeout = timeout

    # ------------------------------------------------------------------
    # LLMProvider protocol
    # ------------------------------------------------------------------

    @property
    def model_name(self) -> str:
        return self._chat_model

    async def complete(self, messages: list[dict], max_tokens: int = 800) -> str:
        """Send a chat completion request and return the assistant text.

        Returns empty string on any error so callers always get a str.
        """
        payload = {
            "model": self._chat_model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(_CHAT_URL, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as exc:
            logger.error(
                "OpenAI chat HTTP %s: %s",
                exc.response.status_code,
                exc.response.text[:300],
            )
            return ""
        except Exception as exc:
            logger.error("OpenAI chat unexpected error: %s", exc)
            return ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return embedding vectors for a list of texts.

        Returns empty list on any error.
        """
        if not texts:
            return []
        payload = {"model": self._embed_model, "input": texts}
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(_EMBED_URL, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                # API returns data sorted by index
                sorted_items = sorted(data["data"], key=lambda x: x["index"])
                return [item["embedding"] for item in sorted_items]
        except httpx.HTTPStatusError as exc:
            logger.error(
                "OpenAI embed HTTP %s: %s",
                exc.response.status_code,
                exc.response.text[:300],
            )
            return []
        except Exception as exc:
            logger.error("OpenAI embed unexpected error: %s", exc)
            return []
