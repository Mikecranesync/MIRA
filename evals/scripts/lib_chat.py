"""Production chat driver for FactoryLM baseline testing.

Drives the real POST /api/equipment-notebooks/{notebook_id}/chat/ SSE path.
SSE frame semantics match mira-mobile/src/lib/sse.ts exactly.

Environment variables:
  FLM_BASE_URL: base URL (default https://app.factorylm.com)
  FLM_SESSION_COOKIE: full "name=value" cookie string (required)
  FLM_EVAL_NOTEBOOK_ID: notebook id (required by callers)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("lib_chat")


@dataclass
class ChatResult:
    """Result of a single chat turn via the production API."""

    answer: str = ""
    citations: list[dict] = field(default_factory=list)
    status: str = ""
    saw_status: bool = False
    evidence_label: str = ""
    evidence_basis: str = ""
    safety_trigger: str | None = None
    latency_s: float = 0.0
    http_status: int = 200
    error: str | None = None


def parse_sse(text: str, http_status: int = 200) -> ChatResult:
    """Parse SSE-formatted response body into ChatResult.

    Implements the frame semantics from mira-mobile/src/lib/sse.ts:
    - Frames separated by blank line ("\\n\\n")
    - Each frame is "data: <json>"
    - Frame kinds: content, sources, status, evidence, safety, followups, usage
    - [DONE] ignored
    """
    result = ChatResult(http_status=http_status)
    frames = text.split("\n\n")

    for frame_text in frames:
        line = frame_text.strip()
        if not line or not line.startswith("data:"):
            continue

        payload = line[5:].strip()
        if payload == "[DONE]":
            continue

        try:
            frame = json.loads(payload)
        except json.JSONDecodeError:
            continue

        kind = frame.get("kind")
        if kind == "content":
            result.answer += str(frame.get("content", ""))
        elif kind == "sources":
            # Normalize citations: extract fields per mira-mobile/src/lib/sse.ts
            raw_citations = frame.get("citations", [])
            if isinstance(raw_citations, list):
                for c in raw_citations:
                    if isinstance(c, dict) and "citationId" in c:
                        result.citations.append(
                            {
                                "citationId": str(c["citationId"]),
                                "sourceTitle": str(
                                    c.get("sourceTitle", "Attached document")
                                ),
                                "page": c.get("page"),
                                "quote": c.get("quote"),
                                "docId": c.get("docId"),
                                "fileId": c.get("fileId"),
                            }
                        )
        elif kind == "status":
            result.status = str(frame.get("status", ""))
            result.saw_status = True
        elif kind == "evidence":
            result.evidence_basis = str(frame.get("basis", ""))
            result.evidence_label = str(frame.get("label", ""))
        elif kind == "safety":
            result.safety_trigger = str(frame.get("trigger", ""))
        elif kind not in ("followups", "usage"):
            # Unknown frame kind — ignore but don't crash
            pass

    return result


def is_truncated(r: ChatResult) -> bool:
    """Check if turn is truncated (status never arrived, not user-stopped)."""
    return r.saw_status is False and r.status != "stopped"


async def ask(
    notebook_id: str,
    message: str,
    *,
    thread_id: str | None = None,
    mode: str | None = None,
    history: list[dict] | None = None,
    source_doc_ids: list[str] | None = None,
    timeout: float = 120.0,
) -> ChatResult:
    """Ask a question via the production chat endpoint.

    Args:
        notebook_id: Equipment notebook ID
        message: Question text
        thread_id: Optional thread ID for multi-turn
        mode: Optional mode (e.g., "general")
        history: Optional conversation history
        source_doc_ids: Optional source doc IDs for grounding
        timeout: Request timeout in seconds

    Returns:
        ChatResult with answer, citations, status, and metadata.
        On error: returns ChatResult with error set, never raises.
    """
    import os

    base_url = os.getenv("FLM_BASE_URL", "https://app.factorylm.com").rstrip("/")
    session_cookie = os.getenv("FLM_SESSION_COOKIE", "")

    if not session_cookie:
        return ChatResult(
            http_status=401,
            error="FLM_SESSION_COOKIE not set",
        )

    url = f"{base_url}/api/equipment-notebooks/{notebook_id}/chat/"
    body: dict[str, Any] = {
        "message": message,
        "sourceDocIds": source_doc_ids or [],
    }
    if thread_id is not None:
        body["threadId"] = thread_id
    if mode is not None:
        body["mode"] = mode
    if history is not None:
        body["history"] = history

    headers = {
        "Cookie": session_cookie,
        "Accept": "text/event-stream",
    }

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=body, headers=headers)
    except httpx.TimeoutException:
        latency = time.time() - start
        return ChatResult(
            http_status=504,
            error="Request timeout",
            latency_s=latency,
        )
    except Exception as e:
        latency = time.time() - start
        return ChatResult(
            http_status=0,
            error=f"{type(e).__name__}: {e}",
            latency_s=latency,
        )

    latency = time.time() - start
    if resp.status_code != 200:
        return ChatResult(
            http_status=resp.status_code,
            error=f"HTTP {resp.status_code}",
            latency_s=latency,
        )

    result = parse_sse(resp.text, http_status=resp.status_code)
    result.latency_s = latency
    return result


if __name__ == "__main__":
    # Unit test: parse synthetic SSE
    synthetic_sse = """data: {"kind": "content", "content": "Hello"}

data: {"kind": "content", "content": " world"}

data: {"kind": "sources", "citations": [{"citationId": "c1", "sourceTitle": "Manual", "page": 42, "quote": "test"}]}

data: {"kind": "evidence", "basis": "manual_chunk", "label": "grounded"}

data: {"kind": "status", "status": "stopped"}

data: [DONE]
"""
    result = parse_sse(synthetic_sse)
    assert result.answer == "Hello world", f"got: {result.answer}"
    assert len(result.citations) == 1, f"got {len(result.citations)} citations"
    assert result.citations[0]["citationId"] == "c1"
    assert result.citations[0]["page"] == 42
    assert result.evidence_label == "grounded"
    assert result.saw_status is True
    assert is_truncated(result) is False
    print("✓ parse_sse unit test passed")

    # Test truncation detection
    truncated_sse = """data: {"kind": "content", "content": "partial"}

data: {"kind": "sources", "citations": []}
"""
    result2 = parse_sse(truncated_sse)
    assert is_truncated(result2) is True, "should detect truncation"
    print("✓ truncation detection test passed")
