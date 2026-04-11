"""MIRA Nemotron Client — NVIDIA NIM API for embed, rewrite, rerank.

All methods fall back gracefully when NVIDIA_API_KEY is not set.
Zero external dependencies beyond httpx (already installed).
"""

import json
import logging
import os
import time

import httpx

logger = logging.getLogger("mira-gsd")

# Defaults — override via env vars or constructor args
DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_EMBED_MODEL = os.environ.get("NEMOTRON_EMBED_MODEL", "nvidia/llama-nemotron-embed-1b-v2")
DEFAULT_RERANK_MODEL = os.environ.get("NEMOTRON_RERANK_MODEL", "nvidia/llama-nemotron-rerank-1b-v2")
DEFAULT_REWRITE_MODEL = os.environ.get(
    "NEMOTRON_REWRITE_MODEL", "nvidia/llama-3.1-nemotron-nano-8b-v1"
)
DEFAULT_VL_EMBED_MODEL = os.environ.get(
    "NEMOTRON_VL_EMBED_MODEL", "nvidia/llama-nemotron-embed-vl-1b-v2"
)

Q2E_PROMPT = """\
Your task is to brainstorm useful search terms and related key phrases \
that could help locate information about the following question. \
Focus on alternate expressions, synonyms, and specific entities or \
events mentioned in the query. Return only the expanded query, no explanation.

Context: {context}
Original query: {query}
Expanded query:"""


class NemotronClient:
    """NVIDIA NIM API client with graceful fallback to local Ollama."""

    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        embed_model: str = None,
        rerank_model: str = None,
        rewrite_model: str = None,
        vl_embed_model: str = None,
    ):
        self.api_key = api_key or os.environ.get("NVIDIA_API_KEY", "")
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.embed_model = embed_model or DEFAULT_EMBED_MODEL
        self.rerank_model = rerank_model or DEFAULT_RERANK_MODEL
        self.rewrite_model = rewrite_model or DEFAULT_REWRITE_MODEL
        self.vl_embed_model = vl_embed_model or DEFAULT_VL_EMBED_MODEL
        self.enabled = bool(self.api_key)

        if self.enabled:
            logger.info("Nemotron client enabled (base=%s)", self.base_url)
        else:
            logger.info("Nemotron client disabled — NVIDIA_API_KEY not set, using fallbacks")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # Stage 1: Query Rewriting (Q2E)
    # ------------------------------------------------------------------

    async def rewrite_query(self, query: str, context: str = "") -> str:
        """Expand a terse maintenance query into a rich search query.

        Falls back to returning the original query unchanged.
        """
        if not self.enabled:
            return query

        prompt = Q2E_PROMPT.format(query=query, context=context)
        payload = {
            "model": self.rewrite_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 200,
        }

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            elapsed = int((time.monotonic() - t0) * 1000)

            rewritten = data["choices"][0]["message"]["content"].strip()
            logger.info(
                "NEMOTRON_REWRITE %s",
                json.dumps(
                    {
                        "original": query,
                        "rewritten": rewritten[:200],
                        "latency_ms": elapsed,
                    }
                ),
            )
            return rewritten or query

        except Exception as e:
            logger.warning("Nemotron rewrite failed, using original: %s", e)
            return query

    # ------------------------------------------------------------------
    # Stage 2a: Embedding
    # ------------------------------------------------------------------

    async def embed(self, text: str) -> list[float] | None:
        """Embed text via Nemotron. Returns None if disabled or failed."""
        if not self.enabled:
            return None

        payload = {
            "model": self.embed_model,
            "input": [text],
            "input_type": "query",
            "encoding_format": "float",
        }

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            elapsed = int((time.monotonic() - t0) * 1000)

            embedding = data["data"][0]["embedding"]
            logger.info("NEMOTRON_EMBED dim=%d latency_ms=%d", len(embedding), elapsed)
            return embedding

        except Exception as e:
            logger.warning("Nemotron embed failed: %s", e)
            return None

    # ------------------------------------------------------------------
    # Stage 2b: Reranking
    # ------------------------------------------------------------------

    async def rerank(
        self,
        query: str,
        passages: list[str],
        top_n: int = 5,
    ) -> list[dict]:
        """Rerank passages by relevance to query.

        Returns list of {"index": int, "text": str, "score": float}
        sorted by score descending. Falls back to original order.
        """
        if not self.enabled or not passages:
            return [{"index": i, "text": p, "score": 1.0} for i, p in enumerate(passages[:top_n])]

        payload = {
            "model": self.rerank_model,
            "query": {"role": "user", "content": query},
            "passages": [{"role": "user", "content": p} for p in passages],
            "truncate": "END",
        }

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.base_url}/ranking",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            elapsed = int((time.monotonic() - t0) * 1000)

            rankings = data.get("rankings", [])
            results = []
            for r in sorted(rankings, key=lambda x: x.get("logit", 0), reverse=True)[:top_n]:
                idx = r["index"]
                results.append(
                    {
                        "index": idx,
                        "text": passages[idx] if idx < len(passages) else "",
                        "score": r.get("logit", 0.0),
                    }
                )

            logger.info(
                "NEMOTRON_RERANK %s",
                json.dumps(
                    {
                        "query": query[:100],
                        "passages_in": len(passages),
                        "results_out": len(results),
                        "top_score": results[0]["score"] if results else 0,
                        "latency_ms": elapsed,
                    }
                ),
            )
            return results

        except Exception as e:
            logger.warning("Nemotron rerank failed, using original order: %s", e)
            return [{"index": i, "text": p, "score": 1.0} for i, p in enumerate(passages[:top_n])]

    # ------------------------------------------------------------------
    # Multimodal embedding (for vision_worker future use)
    # ------------------------------------------------------------------

    async def embed_image(self, image_b64: str, text: str = "") -> list[float] | None:
        """Embed image+text into shared vector space via VL model.

        Uses nvidia/llama-nemotron-embed-vl-1b-v2 which maps images and text
        into the same embedding space. Query must be text-only; documents can
        be image+text. Returns None if disabled or failed.
        """
        if not self.enabled:
            return None

        payload = {
            "model": self.vl_embed_model,
            "input": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                }
            ],
            "input_type": "passage",
            "encoding_format": "float",
        }
        if text:
            payload["input"].append({"type": "text", "text": text})

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            elapsed = int((time.monotonic() - t0) * 1000)

            embedding = data["data"][0]["embedding"]
            logger.info("NEMOTRON_VL_EMBED dim=%d latency_ms=%d", len(embedding), elapsed)
            return embedding
        except Exception as e:
            logger.warning("Nemotron VL embed failed: %s", e)
            return None
