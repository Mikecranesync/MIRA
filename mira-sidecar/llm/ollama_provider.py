"""Ollama local inference provider.

Uses httpx directly to call the Ollama REST API.
Supports both /api/chat (completions) and /api/embeddings.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("mira-sidecar")


class OllamaProvider:
    """Calls a local Ollama instance for LLM completions and embeddings."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        chat_model: str = "llama3",
        embed_model: str = "nomic-embed-text",
        timeout: float = 120.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
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
        """Send a /api/chat request and return the assistant text.

        Returns empty string on any error.
        """
        url = f"{self._base_url}/api/chat"
        payload = {
            "model": self._chat_model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": max_tokens},
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["message"]["content"]
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Ollama chat HTTP %s: %s",
                exc.response.status_code,
                exc.response.text[:300],
            )
            return ""
        except Exception as exc:
            logger.error("Ollama chat unexpected error: %s", exc)
            return ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return embedding vectors for each input text via /api/embeddings.

        Ollama's embeddings endpoint accepts one prompt at a time, so we
        iterate. Returns empty list on failure.
        """
        if not texts:
            return []
        url = f"{self._base_url}/api/embeddings"
        results: list[list[float]] = []
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                for text in texts:
                    payload = {"model": self._embed_model, "prompt": text}
                    try:
                        resp = await client.post(url, json=payload)
                        resp.raise_for_status()
                        data = resp.json()
                        results.append(data["embedding"])
                    except httpx.HTTPStatusError as exc:
                        logger.error(
                            "Ollama embed HTTP %s: %s",
                            exc.response.status_code,
                            exc.response.text[:200],
                        )
                        results.append([])
                    except Exception as exc:
                        logger.error("Ollama embed snippet error: %s", exc)
                        results.append([])
        except Exception as exc:
            logger.error("Ollama embed client error: %s", exc)
            return []
        return results
