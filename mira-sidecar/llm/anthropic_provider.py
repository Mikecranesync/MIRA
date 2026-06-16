"""Anthropic Messages API provider.

Uses httpx directly — no anthropic SDK dependency, matching existing MIRA pattern.
Embedding falls back to Ollama because Anthropic has no embedding endpoint.

PII sanitization is applied to ALL outbound message content before the API call.
Patterns match the exact regexes defined in security-boundaries.md.
"""

from __future__ import annotations

import logging

import httpx

from llm.sanitize import sanitize_messages

logger = logging.getLogger("mira-sidecar")

_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"


class AnthropicProvider:
    """Calls Anthropic Messages API via httpx.

    Embedding delegates to Ollama because Anthropic offers no embedding API.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "claude-sonnet-4-6",
        ollama_base_url: str = "http://localhost:11434",
        ollama_embed_model: str = "nomic-embed-text",
        timeout: float = 60.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._ollama_base_url = ollama_base_url.rstrip("/")
        self._ollama_embed_model = ollama_embed_model
        self._timeout = timeout

    # ------------------------------------------------------------------
    # LLMProvider protocol
    # ------------------------------------------------------------------

    @property
    def model_name(self) -> str:
        return self._model

    async def complete(self, messages: list[dict], max_tokens: int = 800) -> str:
        """Send a Messages API request and return the assistant text.

        Strips PII before sending. Returns empty string on any error.
        """
        clean_messages = sanitize_messages(messages)

        # Anthropic API requires system message separate from messages array
        system_text: str | None = None
        user_messages: list[dict] = []
        for msg in clean_messages:
            if msg.get("role") == "system":
                # Concatenate multiple system messages (unusual but safe)
                content = msg.get("content", "")
                if isinstance(content, str):
                    system_text = (system_text + "\n" + content) if system_text else content
            else:
                user_messages.append(msg)

        payload: dict = {
            "model": self._model,
            "max_tokens": max_tokens,
            "messages": user_messages,
        }
        if system_text:
            payload["system"] = system_text

        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(_MESSAGES_URL, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                # content is a list of blocks; take the first text block
                for block in data.get("content", []):
                    if block.get("type") == "text":
                        return block["text"]
                logger.warning("Anthropic response had no text block: %s", data)
                return ""
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Anthropic HTTP %s: %s",
                exc.response.status_code,
                exc.response.text[:300],
            )
            return ""
        except Exception as exc:
            logger.error("Anthropic unexpected error: %s", exc)
            return ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Delegate embedding to Ollama (Anthropic has no embedding API).

        Returns empty list on any error.
        """
        if not texts:
            return []
        url = f"{self._ollama_base_url}/api/embeddings"
        results: list[list[float]] = []
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                for text in texts:
                    payload = {"model": self._ollama_embed_model, "prompt": text}
                    try:
                        resp = await client.post(url, json=payload)
                        resp.raise_for_status()
                        data = resp.json()
                        results.append(data["embedding"])
                    except httpx.HTTPStatusError as exc:
                        logger.error(
                            "Ollama embed HTTP %s for text snippet: %s",
                            exc.response.status_code,
                            exc.response.text[:200],
                        )
                        results.append([])
                    except Exception as exc:
                        logger.error("Ollama embed error for text snippet: %s", exc)
                        results.append([])
        except Exception as exc:
            logger.error("Ollama embed client creation error: %s", exc)
            return []
        return results
