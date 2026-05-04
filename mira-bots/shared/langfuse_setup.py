"""Langfuse tracing setup for the MIRA RAG pipeline.

Provides:
  get_langfuse()         — singleton Langfuse client
  trace_rag_query()      — async context manager wrapping a full RAG query trace

Environment variables:
  LANGFUSE_SECRET_KEY    — required
  LANGFUSE_PUBLIC_KEY    — required
  LANGFUSE_HOST          — optional, default: http://localhost:3000

Usage (Phase 4 integration target):
    async with trace_rag_query(query, session_id=user_id) as spans:
        async with spans.embed_query(query):
            ...
        async with spans.vector_search(query, chunks):
            ...
        async with spans.context_compose(chunks, context):
            ...
        async with spans.llm_inference(prompt_len, response, latency_ms):
            ...

Note: All Langfuse calls are wrapped in try/except.
Tracing failures are logged but NEVER propagate to the caller.
"""

import contextlib
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

logger = logging.getLogger("mira.evals.langfuse")

_langfuse_client = None


def get_langfuse():
    """Return a singleton Langfuse client.

    Returns None if the package is not installed or credentials are missing.
    Caller must handle None gracefully.
    """
    global _langfuse_client
    if _langfuse_client is not None:
        return _langfuse_client

    try:
        from langfuse import Langfuse  # noqa: PLC0415
    except ImportError:
        logger.warning("langfuse package not installed — tracing disabled")
        return None

    secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")
    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY") or os.environ.get(
        "LANGFUSE_PUBLIC_API_KEY", ""
    )
    host = os.environ.get("LANGFUSE_HOST") or os.environ.get(
        "LANGFUSE_BASE_URL", "https://cloud.langfuse.com"
    )

    if not secret_key or not public_key:
        logger.warning("LANGFUSE_SECRET_KEY / LANGFUSE_PUBLIC_KEY not set — tracing disabled")
        return None

    try:
        _langfuse_client = Langfuse(
            secret_key=secret_key,
            public_key=public_key,
            host=host,
        )
        logger.info("Langfuse client initialised (host=%s)", host)
    except Exception as exc:
        logger.warning("Langfuse client init failed: %s", exc)
        return None

    return _langfuse_client


class _SpanHelper:
    """Thin wrapper around a Langfuse trace that exposes one context manager per span.

    All methods silently no-op if the trace is None (langfuse disabled / error).
    """

    def __init__(self, trace):
        self._trace = trace

    @contextlib.asynccontextmanager
    async def embed_query(self, query: str):
        """span: embed_query
        input  — raw query string
        output — embedding vector shape (approximated; real embed is inside Open WebUI)
        """
        if self._trace is None:
            yield
            return
        span = None
        try:
            span = self._trace.span(
                name="embed_query",
                input={"query": query},
            )
        except Exception as exc:
            logger.debug("embed_query span start failed: %s", exc)
        try:
            yield
        finally:
            if span is not None:
                try:
                    span.end(output={"shape": "(1, 768)"})
                except Exception as exc:
                    logger.debug("embed_query span end failed: %s", exc)

    @contextlib.asynccontextmanager
    async def vector_search(
        self, query: str, chunk_ids: list[str] = None, scores: list[float] = None
    ):
        """span: vector_search
        input  — query string passed to retrieval
        output — list of retrieved chunk IDs and similarity scores
        """
        if self._trace is None:
            yield
            return
        span = None
        try:
            span = self._trace.span(
                name="vector_search",
                input={"query": query},
            )
        except Exception as exc:
            logger.debug("vector_search span start failed: %s", exc)
        try:
            yield
        finally:
            if span is not None:
                try:
                    results = []
                    for i, cid in enumerate(chunk_ids or []):
                        results.append(
                            {
                                "chunk_id": cid,
                                "score": scores[i] if scores and i < len(scores) else None,
                            }
                        )
                    span.end(output={"retrieved": results, "count": len(results)})
                except Exception as exc:
                    logger.debug("vector_search span end failed: %s", exc)

    @contextlib.asynccontextmanager
    async def context_compose(self, chunk_ids: list[str] = None, context: str = ""):
        """span: context_compose
        input  — chunk IDs used to compose context
        output — composed context string (first 500 chars)
        """
        if self._trace is None:
            yield
            return
        span = None
        try:
            span = self._trace.span(
                name="context_compose",
                input={"chunk_ids": chunk_ids or []},
            )
        except Exception as exc:
            logger.debug("context_compose span start failed: %s", exc)
        try:
            yield
        finally:
            if span is not None:
                try:
                    span.end(output={"context_preview": context[:500]})
                except Exception as exc:
                    logger.debug("context_compose span end failed: %s", exc)

    @contextlib.asynccontextmanager
    async def llm_inference(
        self, prompt_token_estimate: int = 0, response: str = "", latency_ms: int = 0
    ):
        """span: llm_inference
        input  — full prompt length in tokens (estimated)
        output — response text and latency_ms
        """
        if self._trace is None:
            yield
            return
        span = None
        t0 = time.monotonic()
        try:
            span = self._trace.span(
                name="llm_inference",
                input={"prompt_token_estimate": prompt_token_estimate},
            )
        except Exception as exc:
            logger.debug("llm_inference span start failed: %s", exc)
        try:
            yield
        finally:
            if span is not None:
                try:
                    elapsed = latency_ms or int((time.monotonic() - t0) * 1000)
                    span.end(
                        output={
                            "response_preview": response[:200],
                            "latency_ms": elapsed,
                        }
                    )
                except Exception as exc:
                    logger.debug("llm_inference span end failed: %s", exc)


@asynccontextmanager
async def trace_rag_query(query: str, session_id: str = None, metadata: dict[str, Any] = None):
    """Async context manager: wraps one full RAG query in a Langfuse trace.

    Yields a _SpanHelper instance. Use its methods as async context managers
    to record individual pipeline spans.

    Example:
        async with trace_rag_query("VFD fault code F001", session_id="u123") as spans:
            async with spans.embed_query(query):
                ...
            async with spans.vector_search(query, chunk_ids, scores):
                ...
            async with spans.context_compose(chunk_ids, composed_text):
                ...
            async with spans.llm_inference(prompt_len, response_text, latency_ms):
                ...

    Safe to use even when Langfuse is disabled — all spans become no-ops.
    """
    lf = get_langfuse()
    trace = None

    if lf is not None and hasattr(lf, "trace"):
        try:
            trace = lf.trace(
                name="rag_query",
                input={"query": query},
                session_id=session_id,
                metadata=metadata or {},
            )
        except Exception as exc:
            logger.warning("trace_rag_query: trace creation failed: %s", exc)
            trace = None

    helper = _SpanHelper(trace)
    try:
        yield helper
    finally:
        if lf is not None and hasattr(lf, "trace") and trace is not None:
            try:
                lf.flush()
            except Exception as exc:
                logger.debug("trace_rag_query: flush failed: %s", exc)
