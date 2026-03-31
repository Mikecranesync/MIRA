"""Embedding dispatcher.

Thin wrapper around an EmbedProvider that adds batching for large
document sets. Batches of 100 avoid overwhelming either OpenAI or
Ollama with oversized payloads.
"""

from __future__ import annotations

import logging

from llm.base import EmbedProvider

logger = logging.getLogger("mira-sidecar")

_BATCH_SIZE = 100


async def embed_texts(
    texts: list[str],
    provider: EmbedProvider,
) -> list[list[float]]:
    """Embed a list of texts using the given provider.

    Splits into batches of _BATCH_SIZE to avoid large request payloads.
    Returns a flat list of vectors in the same order as the input texts.
    Returns an empty list if the provider returns an error.
    """
    if not texts:
        return []

    all_embeddings: list[list[float]] = []
    total = len(texts)
    batches = range(0, total, _BATCH_SIZE)

    for batch_start in batches:
        batch = texts[batch_start : batch_start + _BATCH_SIZE]
        logger.debug(
            "Embedding batch %d–%d of %d texts",
            batch_start,
            batch_start + len(batch) - 1,
            total,
        )
        try:
            vectors = await provider.embed(batch)
        except Exception as exc:
            logger.error("embed_texts batch %d error: %s", batch_start, exc)
            vectors = [[] for _ in batch]

        all_embeddings.extend(vectors)

    return all_embeddings
