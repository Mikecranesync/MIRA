"""LLM provider protocol definitions.

All concrete providers implement LLMProvider. The EmbedProvider alias
exists because some providers (Anthropic) separate LLM and embedding
responsibilities behind different backends.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    """Minimal protocol every LLM backend must satisfy."""

    async def complete(self, messages: list[dict], max_tokens: int = 800) -> str:
        """Return the assistant text for a list of chat messages."""
        ...

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text."""
        ...

    @property
    def model_name(self) -> str:
        """Human-readable model identifier for logging / status endpoint."""
        ...


# Embedding provider is the same shape — alias for clarity in factory.py
EmbedProvider = LLMProvider
