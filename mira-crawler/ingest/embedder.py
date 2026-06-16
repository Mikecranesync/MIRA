"""Ollama batch embedder for document chunks.

Uses nomic-embed-text:v1.5 via Ollama REST API. Matches the pattern
in mira-core/mira-ingest/main.py and mira-hud/vim/db_adapter.py.

Retry with exponential backoff. Never crashes on Ollama failure —
returns None for failed embeddings so callers can skip or fallback.
"""

from __future__ import annotations

import logging
import time

import httpx

logger = logging.getLogger("mira-crawler.embedder")


def embed_text(
    text: str,
    ollama_url: str = "http://localhost:11434",
    model: str = "nomic-embed-text:latest",
    timeout: float = 30.0,
    max_retries: int = 3,
) -> list[float] | None:
    """Embed a single text string via Ollama. Returns vector or None."""
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                f"{ollama_url}/api/embeddings",
                json={"model": model, "prompt": text},
                timeout=timeout,
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                logger.warning(
                    "Embed attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, max_retries, e, wait,
                )
                time.sleep(wait)
            else:
                logger.error("Embed failed after %d attempts: %s", max_retries, e)
                return None


def embed_image(
    image_b64: str,
    ollama_url: str = "http://localhost:11434",
    model: str = "nomic-embed-vision:v1.5",
    timeout: float = 60.0,
    max_retries: int = 3,
) -> list[float] | None:
    """Embed an image (base64) via Ollama nomic-embed-vision. Returns 768-dim vector or None."""
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                f"{ollama_url}/api/embed",
                json={"model": model, "input": image_b64},
                timeout=timeout,
            )
            resp.raise_for_status()
            return resp.json()["embeddings"][0]
        except httpx.HTTPStatusError as e:
            if e.response.status_code < 500:
                # 4xx = model not found or bad request — not worth retrying
                logger.warning("Image embed skipped (HTTP %s): %s", e.response.status_code, e)
                return None
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                logger.warning(
                    "Image embed attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, max_retries, e, wait,
                )
                time.sleep(wait)
            else:
                logger.error("Image embed failed after %d attempts: %s", max_retries, e)
                return None
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                logger.warning(
                    "Image embed attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, max_retries, e, wait,
                )
                time.sleep(wait)
            else:
                logger.error("Image embed failed after %d attempts: %s", max_retries, e)
                return None


def embed_batch(
    chunks: list[dict],
    ollama_url: str = "http://localhost:11434",
    model: str = "nomic-embed-text:latest",
    batch_size: int = 32,
) -> list[tuple[dict, list[float] | None]]:
    """Embed a list of chunk dicts, returning (chunk, embedding) pairs.

    Processes in batches of batch_size. Each chunk must have a 'text' key.
    Failed embeddings return None — callers should skip those chunks.
    """
    results: list[tuple[dict, list[float] | None]] = []
    total = len(chunks)
    embedded = 0

    for i in range(0, total, batch_size):
        batch = chunks[i : i + batch_size]
        for chunk in batch:
            vec = embed_text(chunk["text"], ollama_url=ollama_url, model=model)
            results.append((chunk, vec))
            if vec is not None:
                embedded += 1

        logger.info(
            "Embedded %d/%d chunks (batch %d-%d)",
            embedded, total, i, min(i + batch_size, total),
        )

    logger.info("Embedding complete: %d/%d succeeded", embedded, total)
    return results
