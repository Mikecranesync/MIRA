"""MIRA Telemetry — Langfuse wrapper with graceful no-op fallback.

When LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY are set, traces and spans
are forwarded to a Langfuse instance.  Otherwise all calls silently no-op
so the rest of the codebase never needs to guard imports.
"""

import logging
import os
import uuid
from contextlib import contextmanager

logger = logging.getLogger("mira-telemetry")

_langfuse = None
_enabled = False


def _try_init():
    """Attempt Langfuse init once.  Swallow all errors — never block app."""
    global _langfuse, _enabled
    if _enabled:
        return
    secret = os.getenv("LANGFUSE_SECRET_KEY", "")
    public = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    host = os.getenv("LANGFUSE_HOST", "")
    if not (secret and public):
        logger.info("Langfuse not configured — telemetry disabled (no-op)")
        return
    try:
        from langfuse import Langfuse  # type: ignore[import-untyped]

        _langfuse = Langfuse(
            secret_key=secret,
            public_key=public,
            host=host or "https://cloud.langfuse.com",
        )
        _enabled = True
        logger.info("Langfuse telemetry enabled → %s", host or "cloud")
    except ImportError:
        logger.info("langfuse package not installed — telemetry disabled (no-op)")
    except Exception as exc:
        logger.warning("Langfuse init failed (non-fatal): %s", exc)


def is_enabled() -> bool:
    """Return True if Langfuse is active."""
    _try_init()
    return _enabled


class _NoOpSpan:
    """Stand-in when Langfuse is unavailable."""

    def __init__(self):
        self.id = None

    def end(self, **kwargs):
        pass

    def update(self, **kwargs):
        pass

    def generation(self, **kwargs):
        return _NoOpSpan()


class _NoOpTrace:
    """Stand-in when Langfuse is unavailable."""

    def __init__(self):
        self.id = None

    def span(self, **kwargs):
        return _NoOpSpan()

    def generation(self, **kwargs):
        return _NoOpSpan()

    def update(self, **kwargs):
        pass


def trace(name: str, *, user_id: str = "", metadata: dict | None = None):
    """Create a Langfuse trace (or no-op)."""
    _try_init()
    if not _enabled:
        return _NoOpTrace()
    try:
        return _langfuse.trace(
            name=name,
            user_id=user_id or None,
            metadata=metadata or {},
            id=str(uuid.uuid4()),
        )
    except Exception as exc:
        logger.warning("Langfuse trace() failed (non-fatal): %s", exc)
        return _NoOpTrace()


@contextmanager
def span(trace_obj, name: str, **kwargs):
    """Context-manager wrapper around trace.span()."""
    s = trace_obj.span(name=name, **kwargs) if trace_obj else _NoOpSpan()
    try:
        yield s
    finally:
        try:
            s.end()
        except Exception:
            pass


def flush():
    """Flush any pending events — safe to call even when disabled."""
    if _enabled and _langfuse:
        try:
            _langfuse.flush()
        except Exception:
            pass
