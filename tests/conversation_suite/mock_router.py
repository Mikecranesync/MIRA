"""Mock LLM router + RAG worker for deterministic mode.

Injected into Supervisor via:
    sup = Supervisor(...)
    sup.router = FakeInferenceRouter(canned_responses)
    sup.rag = FakeRAGWorker(canned_chunks)

Matches the public surface of the real router/worker — only the methods called
by the engine in the diagnostic path are implemented. Some parameters are
intentionally unused (mock signatures must match the real classes).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("mira-conv-suite")


# ─────────────────────────────────────────────────────────────────────────────
# Fake inference router
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class _MockReply:
    """A single canned reply, matched by substring against the user message."""

    match_substring: str
    reply: str
    match_role: str = "user"
    consumed: bool = False  # set after first match for one-shot replies

    def matches(self, messages: list[dict]) -> bool:
        for msg in reversed(messages):
            if msg.get("role") != self.match_role:
                continue
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    block.get("text", "") for block in content if isinstance(block, dict)
                )
            if self.match_substring.lower() in str(content).lower():
                return True
        return False


class FakeInferenceRouter:
    """Drop-in for shared.inference.router.InferenceRouter — returns canned replies.

    Loads canned replies from one or more YAML files. On each `complete()` call,
    finds the first reply whose `match_substring` is in the most recent user
    message. Falls back to a generic "I don't have enough context" reply.

    Compatible with `Supervisor.router` field — same `enabled`, `complete()`,
    `sanitize_context()` surface.
    """

    enabled: bool = True

    def __init__(self, response_files: list[Path] | None = None):
        self._replies: list[_MockReply] = []
        self.call_log: list[dict] = []
        if response_files:
            for path in response_files:
                self.load(path)

    def load(self, path: Path) -> None:
        if not path.exists():
            logger.warning("mock router: response file missing — %s", path)
            return
        try:
            data = yaml.safe_load(path.read_text()) or []
        except yaml.YAMLError as exc:
            logger.error("mock router: failed to parse %s — %s", path, exc)
            return
        for entry in data:
            self._replies.append(
                _MockReply(
                    match_substring=entry["match_substring"],
                    reply=entry["reply"],
                    match_role=entry.get("match_role", "user"),
                )
            )

    def add_reply(self, match_substring: str, reply: str) -> None:
        self._replies.append(_MockReply(match_substring=match_substring, reply=reply))

    async def complete(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        session_id: str = "mock",
        sanitize: bool = True,
    ) -> tuple[str, dict]:
        self.call_log.append({"messages": messages, "session_id": session_id})
        for canned in self._replies:
            if canned.matches(messages):
                return canned.reply, {
                    "provider": "mock",
                    "tokens_in": 0,
                    "tokens_out": len(canned.reply.split()),
                }
        return (
            "I need a bit more context to help — can you tell me which asset and what fault code you're seeing?",
            {"provider": "mock", "tokens_in": 0, "tokens_out": 20},
        )

    def sanitize_context(self, messages: list[dict]) -> list[dict]:
        return messages

    async def complete_with_provider(self, *args: Any, **kwargs: Any) -> tuple[str, dict]:
        return await self.complete(*args, **kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Fake RAG worker
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class _MockChunk:
    source: str
    section: str
    text: str


class FakeRAGWorker:
    """Drop-in for shared.workers.rag_worker.RAGWorker — returns canned chunks.

    Loaded from JSON files in fixtures/kb_chunks/. Returns ALL chunks for every
    query (the test author controls what's available by picking which files to
    load). Reply is constructed by concatenating chunk text with `[Source: ...]`
    tags so citation_compliance recognises them.
    """

    tenant_id: str = "conv-suite"

    def __init__(
        self,
        chunk_files: list[Path] | None = None,
        router: FakeInferenceRouter | None = None,
        tenant_id: str = "conv-suite",
    ):
        self._chunks: list[_MockChunk] = []
        self.search_log: list[str] = []
        self.tenant_id = tenant_id
        self._router = router
        # Real RAGWorker stores `_last_sources` as list[str] (chunk text content).
        # Engine `_is_grounded()` does `source.lower().split()` on each entry.
        self._last_sources: list[str] = []
        self._last_kb_status: dict = {"status": "uncovered"}
        if chunk_files:
            for path in chunk_files:
                self.load(path)

    def load(self, path: Path) -> None:
        import json

        if not path.exists():
            logger.warning("mock rag: chunk file missing — %s", path)
            return
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            logger.error("mock rag: failed to parse %s — %s", path, exc)
            return
        for entry in data:
            self._chunks.append(
                _MockChunk(
                    source=entry["source"],
                    section=entry.get("section", ""),
                    text=entry["text"],
                )
            )

    def add_chunk(self, source: str, text: str, section: str = "") -> None:
        self._chunks.append(_MockChunk(source=source, section=section, text=text))

    async def search(self, query: str, k: int = 5) -> list[dict]:
        self.search_log.append(query)
        return self._chunks_as_dicts(k)

    def _chunks_as_dicts(self, k: int = 5) -> list[dict]:
        return [
            {
                "source": c.source,
                "section": c.section,
                "text": c.text,
                "score": 0.9,
            }
            for c in self._chunks[:k]
        ]

    @property
    def kb_status(self) -> dict:
        """Real RAGWorker exposes this as a property. Engine does
        `getattr(self.rag, 'kb_status', {})` so it needs an attribute, not a method."""
        return self._last_kb_status

    def format_context(self, chunks: list[dict]) -> str:
        lines = []
        for c in chunks:
            tag = f"[Source: {c['source']}"
            if c.get("section"):
                tag += f" §{c['section']}"
            tag += "]"
            lines.append(f"{c['text']} {tag}")
        return "\n\n".join(lines)

    async def process(
        self,
        message: str,
        state: dict | None = None,
        photo_b64: str | None = None,
        tenant_id: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Engine calls `self.rag.process(message, state, ...)` and expects a raw
        string the engine then passes to `parse_response()`. We return either a
        canned router reply (preferred — already carries `[Source: ...]` tags) or
        a fallback concat of the chunks."""
        # Real RAGWorker keeps `_last_sources` as list[str] (chunk text) so engine
        # `_is_grounded()` can do source.lower().split() on each entry.
        self._last_sources = [c.text for c in self._chunks]
        self._last_kb_status = {"status": "covered" if self._chunks else "uncovered"}
        sources = self._chunks_as_dicts()

        if self._router is not None:
            messages = [
                {
                    "role": "system",
                    "content": "Mock RAG reply. Cite sources via [Source: ...] tags.",
                },
                {"role": "user", "content": message},
            ]
            reply, _ = await self._router.complete(messages, session_id="mock-rag")
            return reply
        if sources:
            return self.format_context(sources)
        return (
            "I don't have KB coverage for that yet — check the vendor manual or "
            "upload a relevant page so I can index it."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Fake vision / nameplate / nemotron
# ─────────────────────────────────────────────────────────────────────────────


class FakeVisionWorker:
    """No-op vision worker — tests that don't use photos."""

    async def describe(self, photo_b64: str, prompt: str = "") -> str:
        return ""

    async def extract(self, photo_b64: str) -> dict:
        return {}


class FakeNameplateWorker:
    """No-op nameplate worker."""

    async def extract(self, photo_b64: str) -> dict:
        return {}

    async def process(self, photo_b64: str, chat_id: str = "") -> dict:
        return {}


class FakeNemotronClient:
    """No-op nemotron client — disables Nemotron entirely."""

    enabled: bool = False

    async def complete(self, *args: Any, **kwargs: Any) -> str:
        return ""

    async def reason(self, *args: Any, **kwargs: Any) -> dict:
        return {}


__all__ = [
    "FakeInferenceRouter",
    "FakeRAGWorker",
    "FakeVisionWorker",
    "FakeNameplateWorker",
    "FakeNemotronClient",
]
