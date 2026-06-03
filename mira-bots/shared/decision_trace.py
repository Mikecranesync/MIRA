"""Decision trace writer for MIRA engine turns (Phase 8).

Each call to ``Supervisor.process_full`` that reaches the RAG path produces
one ``decision_traces`` row in NeonDB.  The row captures the full decision
chain: UNS gate outcome, retrieval set, KG hops, tag events consulted, LLM
call metadata, citation check, final reply, and total latency.

## Design principles

1. **Fail-soft.**  A trace write failure MUST NOT break the user reply.
   Every public method catches all exceptions and logs a warning.
2. **Sanitized data only.**  ``user_message`` and ``prompt`` are sanitized via
   ``InferenceRouter.sanitize_text`` (strips IP/MAC/SN) before writing.
3. **App-side UUIDs.**  We mint a UUIDv7 per turn (time-ordered primary key)
   so INSERT is idempotent on retry without a DB round-trip.
4. **One INSERT per turn.**  ``commit()`` performs a single parameterized
   INSERT.  Never UPDATE on the same trace_id; retries append a new row.
5. **NullPool.**  NeonDB uses PgBouncer; no app-side connection pool.
6. **Platform auto-detection.**  ``start_turn`` infers the platform from the
   ``chat_id`` prefix ("slack:", "telegram:", "ignition:", "hub:", "web:").
   Callers may override via ``platform=`` kwarg.

## Column mapping to 032_decision_traces.sql

    trace_id              — UUIDv7 generated in start_turn()
    tenant_id             — required; passed to start_turn()
    session_id            — optional troubleshooting_sessions FK
    chat_id               — platform-scoped channel/thread id
    platform              — inferred or passed
    ts                    — DEFAULT NOW() — not sent; DB sets it
    user_message          — sanitized message
    router_intent         — from record_llm_call()
    gate_outcome          — from record_gate_outcome()
    uns_path              — from record_uns_resolution()
    uns_confidence        — from record_uns_resolution()
    retrieval_set         — from record_retrieval()
    kg_hops               — from record_kg_hops()
    tag_events_consulted  — from record_tag_events_consulted()
    prompt                — sanitized, from record_llm_call()
    model_used            — from record_llm_call()
    llm_latency_ms        — from record_llm_call()
    cascade_failures      — from record_llm_call()
    raw_reply             — from record_final_reply()
    citation_check        — from record_citation_check()
    final_reply           — from record_final_reply()
    total_latency_ms      — from commit()
    next_state            — from record_final_reply()
"""

from __future__ import annotations

import json
import logging
import os
import re
import struct
import time
import uuid
from typing import Optional

logger = logging.getLogger("mira-gsd")


# ---------------------------------------------------------------------------
# UUIDv7 (time-ordered primary key — same pattern as flaky_input_detector.py)
# ---------------------------------------------------------------------------


def _uuid7() -> str:
    """Mint a UUIDv7 (time-ordered UUID per RFC 9562 draft)."""
    ts_ms = int(time.time() * 1000)
    rand_a = struct.unpack(">H", os.urandom(2))[0] & 0x0FFF  # 12-bit random_a
    rand_b = struct.unpack(">Q", os.urandom(8))[0] & 0x3FFFFFFFFFFFFFFF  # 62-bit random_b
    high = (ts_ms << 16) | (0x7 << 12) | rand_a
    low = (0b10 << 62) | rand_b
    b = high.to_bytes(8, "big") + low.to_bytes(8, "big")
    return str(uuid.UUID(bytes=b))


# ---------------------------------------------------------------------------
# Platform inference from chat_id prefix
# ---------------------------------------------------------------------------

_PLATFORM_PREFIXES = (
    ("slack:", "slack"),
    ("telegram:", "telegram"),
    ("ignition:", "ignition"),
    ("hub:", "hub"),
    ("web:", "web"),
)


def _infer_platform(chat_id: str) -> str:
    for prefix, name in _PLATFORM_PREFIXES:
        if (chat_id or "").startswith(prefix):
            return name
    return "unknown"


# ---------------------------------------------------------------------------
# Sanitisation helper (re-uses InferenceRouter patterns via simple re.sub)
# ---------------------------------------------------------------------------

_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b")
_SERIAL_RE = re.compile(r"\bS/?N[:\s]?\w{4,20}\b", re.IGNORECASE)


def _sanitize(text: Optional[str]) -> Optional[str]:
    """Strip IPs, MACs, serial numbers from a single string.

    Mirrors InferenceRouter.sanitize_text() without importing the router,
    keeping this module dependency-free.
    """
    if not isinstance(text, str):
        return text
    text = _IPV4_RE.sub("[IP]", text)
    text = _MAC_RE.sub("[MAC]", text)
    text = _SERIAL_RE.sub("[SN]", text)
    return text


# ---------------------------------------------------------------------------
# DecisionTraceWriter
# ---------------------------------------------------------------------------


class DecisionTraceWriter:
    """Accumulate turn data then flush a single INSERT to decision_traces.

    Usage::

        tracer = DecisionTraceWriter()
        trace_id = tracer.start_turn(
            tenant_id="...",
            chat_id="slack:C123",
            message="Why is the conveyor faulted?",
        )
        tracer.record_uns_resolution(uns_path="enterprise.site.area", confidence="high")
        tracer.record_gate_outcome("confirmed")
        tracer.record_retrieval([{"chunk_id": "...", "score": 0.9, "source": "GS10 Manual"}])
        tracer.record_kg_hops([{"entity_id": "...", "type": "component", "rel": "part_of"}])
        tracer.record_llm_call(
            prompt="<sanitized>",
            model_used="groq",
            llm_latency_ms=320,
            router_intent="continue_current",
        )
        tracer.record_citation_check("pass")
        tracer.record_final_reply(raw_reply="...", final_reply="...", next_state="DIAGNOSIS")
        await tracer.commit()  # fire-and-forget; errors are logged, not raised

    """

    __slots__ = (
        "_trace_id",
        "_tenant_id",
        "_session_id",
        "_chat_id",
        "_platform",
        "_user_message",
        "_t0",
        "_router_intent",
        "_gate_outcome",
        "_uns_path",
        "_uns_confidence",
        "_retrieval_set",
        "_kg_hops",
        "_tag_events_consulted",
        "_prompt",
        "_model_used",
        "_llm_latency_ms",
        "_cascade_failures",
        "_raw_reply",
        "_citation_check",
        "_final_reply",
        "_next_state",
    )

    def __init__(self) -> None:
        self._trace_id: Optional[str] = None
        self._tenant_id: Optional[str] = None
        self._session_id: Optional[str] = None
        self._chat_id: Optional[str] = None
        self._platform: Optional[str] = None
        self._user_message: Optional[str] = None
        self._t0: float = 0.0
        self._router_intent: Optional[str] = None
        self._gate_outcome: Optional[str] = None
        self._uns_path: Optional[str] = None
        self._uns_confidence: Optional[str] = None
        self._retrieval_set: Optional[list] = None
        self._kg_hops: Optional[list] = None
        self._tag_events_consulted: Optional[list] = None
        self._prompt: Optional[str] = None
        self._model_used: Optional[str] = None
        self._llm_latency_ms: Optional[int] = None
        self._cascade_failures: Optional[list] = None
        self._raw_reply: Optional[str] = None
        self._citation_check: Optional[str] = None
        self._final_reply: Optional[str] = None
        self._next_state: Optional[str] = None

    # ------------------------------------------------------------------
    # start_turn — call first; returns the trace_id so caller can thread it
    # ------------------------------------------------------------------

    def start_turn(
        self,
        tenant_id: str,
        chat_id: str,
        message: str,
        *,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> str:
        """Initialise a new turn; return the trace_id.

        Must be the first call; subsequent ``record_*`` calls accumulate data
        for the same turn until ``commit()`` flushes to NeonDB.
        """
        try:
            self._trace_id = _uuid7()
            self._tenant_id = tenant_id
            self._chat_id = chat_id
            self._user_message = _sanitize(message)
            self._t0 = time.monotonic()
            self._platform = platform or _infer_platform(chat_id)
            self._session_id = session_id
        except Exception as exc:
            logger.warning("DECISION_TRACE start_turn error=%s", exc)
            self._trace_id = str(uuid.uuid4())
        return self._trace_id  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Record helpers — all fail-soft
    # ------------------------------------------------------------------

    def record_uns_resolution(
        self,
        uns_path: Optional[str],
        confidence: Optional[str],
    ) -> None:
        """Store UNS resolution result."""
        try:
            self._uns_path = uns_path
            self._uns_confidence = confidence
        except Exception as exc:
            logger.warning("DECISION_TRACE record_uns_resolution error=%s", exc)

    def record_gate_outcome(self, outcome: str) -> None:
        """Store UNS gate outcome.

        Values: ``"direct_connection"`` | ``"confirmed"`` | ``"fired"`` |
        ``"skipped"``.
        """
        try:
            self._gate_outcome = outcome
        except Exception as exc:
            logger.warning("DECISION_TRACE record_gate_outcome error=%s", exc)

    def record_retrieval(self, chunks: list[dict]) -> None:
        """Store the retrieval set: [{chunk_id, score, source}, ...]."""
        try:
            self._retrieval_set = [
                {
                    "chunk_id": str(c.get("chunk_id") or c.get("id") or ""),
                    "score": float(c.get("score") or c.get("similarity") or 0.0),
                    "source": str(c.get("source") or c.get("source_url") or ""),
                }
                for c in (chunks or [])
            ]
        except Exception as exc:
            logger.warning("DECISION_TRACE record_retrieval error=%s", exc)

    def record_kg_hops(self, hops: list[dict]) -> None:
        """Store KG hops: [{entity_id, type, rel}, ...]."""
        try:
            self._kg_hops = list(hops or [])
        except Exception as exc:
            logger.warning("DECISION_TRACE record_kg_hops error=%s", exc)

    def record_tag_events_consulted(self, event_ids: list) -> None:
        """Store tag event IDs consulted during this turn."""
        try:
            self._tag_events_consulted = [str(e) for e in (event_ids or [])]
        except Exception as exc:
            logger.warning("DECISION_TRACE record_tag_events_consulted error=%s", exc)

    def record_llm_call(
        self,
        *,
        prompt: Optional[str] = None,
        model_used: Optional[str] = None,
        llm_latency_ms: Optional[int] = None,
        router_intent: Optional[str] = None,
        cascade_failures: Optional[list] = None,
    ) -> None:
        """Store LLM call details.  ``prompt`` is sanitized before storing."""
        try:
            self._prompt = _sanitize(prompt)
            self._model_used = model_used
            self._llm_latency_ms = llm_latency_ms
            self._router_intent = router_intent
            self._cascade_failures = list(cascade_failures or [])
        except Exception as exc:
            logger.warning("DECISION_TRACE record_llm_call error=%s", exc)

    def record_citation_check(self, outcome: str) -> None:
        """Store citation check outcome: ``"pass"`` | ``"rewritten"`` | ``"admitted_gap"``."""
        try:
            self._citation_check = outcome
        except Exception as exc:
            logger.warning("DECISION_TRACE record_citation_check error=%s", exc)

    def record_final_reply(
        self,
        *,
        raw_reply: Optional[str] = None,
        final_reply: Optional[str] = None,
        next_state: Optional[str] = None,
    ) -> None:
        """Store the raw and final reply text, plus the FSM state after this turn."""
        try:
            self._raw_reply = raw_reply
            self._final_reply = final_reply
            self._next_state = next_state
        except Exception as exc:
            logger.warning("DECISION_TRACE record_final_reply error=%s", exc)

    # ------------------------------------------------------------------
    # commit — single INSERT; always fail-soft
    # ------------------------------------------------------------------

    async def commit(self) -> None:
        """Insert one row into ``decision_traces``.

        Requires ``NEON_DATABASE_URL`` to be set; silently skips if not.
        Never raises — a trace failure must not break the user reply.
        """
        if not self._trace_id:
            return  # start_turn was never called

        neon_url = os.getenv("NEON_DATABASE_URL", "")
        if not neon_url:
            logger.debug("DECISION_TRACE skip — NEON_DATABASE_URL not set")
            return

        total_ms = int((time.monotonic() - self._t0) * 1000) if self._t0 else None

        try:
            import psycopg2  # soft dependency — already in requirements.txt
            import psycopg2.extras

            # NullPool: open, write, close. NeonDB's PgBouncer handles pooling.
            conn = psycopg2.connect(neon_url)
            psycopg2.extras.register_uuid(conn)
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO decision_traces (
                            trace_id,
                            tenant_id,
                            session_id,
                            chat_id,
                            platform,
                            user_message,
                            router_intent,
                            gate_outcome,
                            uns_path,
                            uns_confidence,
                            retrieval_set,
                            kg_hops,
                            tag_events_consulted,
                            prompt,
                            model_used,
                            llm_latency_ms,
                            cascade_failures,
                            raw_reply,
                            citation_check,
                            final_reply,
                            total_latency_ms,
                            next_state
                        ) VALUES (
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s::ltree, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s, %s
                        )
                        ON CONFLICT (trace_id, tenant_id) DO NOTHING
                        """,
                        (
                            self._trace_id,
                            self._tenant_id,
                            self._session_id,
                            self._chat_id,
                            self._platform,
                            self._user_message,
                            self._router_intent,
                            self._gate_outcome,
                            # uns_path cast to ltree — NULL when not resolved
                            self._uns_path,
                            self._uns_confidence,
                            # JSONB columns — psycopg2 requires explicit json.dumps
                            json.dumps(self._retrieval_set)
                            if self._retrieval_set is not None
                            else None,
                            json.dumps(self._kg_hops) if self._kg_hops is not None else None,
                            json.dumps(self._tag_events_consulted)
                            if self._tag_events_consulted is not None
                            else None,
                            self._prompt,
                            self._model_used,
                            self._llm_latency_ms,
                            json.dumps(self._cascade_failures)
                            if self._cascade_failures is not None
                            else None,
                            self._raw_reply,
                            self._citation_check,
                            self._final_reply,
                            total_ms,
                            self._next_state,
                        ),
                    )
                conn.commit()
                logger.debug(
                    "DECISION_TRACE committed trace_id=%s tenant=%s latency_ms=%s",
                    self._trace_id,
                    self._tenant_id,
                    total_ms,
                )
            finally:
                conn.close()

        except Exception as exc:
            # Fail-soft: log and continue — never break the user reply.
            logger.warning(
                "DECISION_TRACE commit failed trace_id=%s error=%s",
                self._trace_id,
                exc,
            )
