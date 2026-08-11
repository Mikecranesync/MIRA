"""Shared bake-off machinery: chunking, held-constant retrieval, scoring, records.

Design rules (Phase 1.5 directive):
- Deterministic over LLM judgment: scoring is marker/page matching, never a model.
- Retrieval is HELD CONSTANT across parser adapters (SQLite FTS5 BM25, stdlib) so
  differences measure the PARSER/representation, not a retrieval tweak.
- The chunker mirrors #3185's writeChunkRowsForNode semantics (1000 chars, 120
  overlap, per-page, break on \\n\\n or '. ' past 50% of the window) so the
  pymupdf+FTS5 lane is an honest control for the production shape.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ir import ExpDoc

CHUNK_CHARS = 1000
CHUNK_OVERLAP = 120


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Port of mira-hub/src/lib/node-knowledge-ingest.ts::chunkText."""
    clean = re.sub(r"[ \t]+\n", "\n", text.replace("\r\n", "\n")).strip()
    if not clean:
        return []
    if len(clean) <= size:
        return [clean]
    chunks: list[str] = []
    i = 0
    while i < len(clean):
        end = min(i + size, len(clean))
        if end < len(clean):
            window = clean[i:end]
            brk = max(window.rfind("\n\n"), window.rfind(". "))
            if brk > size * 0.5:
                end = i + brk + 1
        piece = clean[i:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(clean):
            break
        i = max(end - overlap, i + 1)
    return chunks


@dataclass
class Chunk:
    doc_id: str
    page: int
    text: str
    kind: str = "text"  # text | table


class Fts5Index:
    """Held-constant BM25 retrieval bed (stdlib sqlite3 FTS5)."""

    def __init__(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute(
            "CREATE VIRTUAL TABLE chunks USING fts5(doc_id, page UNINDEXED, kind UNINDEXED, text)"
        )

    def add(self, chunks: list[Chunk]) -> None:
        self.db.executemany(
            "INSERT INTO chunks (doc_id, page, kind, text) VALUES (?, ?, ?, ?)",
            [(c.doc_id, c.page, c.kind, c.text) for c in chunks],
        )
        self.db.commit()

    def query(self, doc_id: str, q: str, k: int = 6) -> list[Chunk]:
        """AND-first, OR-fallback — mirrors #3185's plainto/OR two-pass shape."""
        terms = [t for t in re.findall(r"\w+", q.lower()) if len(t) > 1]
        if not terms:
            return []
        quoted = [f'"{t}"' for t in terms]
        for joiner in (" AND ", " OR "):
            match = joiner.join(quoted)
            try:
                rows = self.db.execute(
                    "SELECT doc_id, page, kind, text FROM chunks "
                    "WHERE doc_id = ? AND chunks MATCH ? ORDER BY bm25(chunks) LIMIT ?",
                    (doc_id, match, k),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
            if rows:
                return [Chunk(doc_id=r[0], page=int(r[1]), text=r[3], kind=r[2]) for r in rows]
        return []


def index_expdoc(doc: ExpDoc, table_aware: bool) -> list[Chunk]:
    """IR → chunks. Plain mode flattens page text through the #3185 chunker.
    Table-aware mode additionally indexes every table's row-context serialization
    as its own chunk (the Phase-2 hypothesis)."""
    out: list[Chunk] = []
    for page in doc.pages:
        texts: list[str] = []
        for b in page.blocks:
            if b.kind == "table" and table_aware and b.text:
                out.append(Chunk(doc_id=doc.doc_id, page=page.number, text=b.text, kind="table"))
            elif b.text:
                texts.append(b.text)
        for piece in chunk_text("\n".join(texts)):
            out.append(Chunk(doc_id=doc.doc_id, page=page.number, text=piece))
    return out


# ── Scoring ──────────────────────────────────────────────────────────────────

ABSTAIN_PATTERNS = [
    "not in the", "does not cover", "doesn't cover", "no information", "not found",
    "cannot find", "can't find", "not mentioned", "not specified", "not covered",
    "unable to find", "does not contain", "doesn't contain", "not available in",
    "no coverage", "not provided", "outside the scope", "does not appear",
    "i don't have", "not addressed", "no mention",
]


def looks_like_abstention(answer: str) -> bool:
    low = answer.lower()
    return any(p in low for p in ABSTAIN_PATTERNS)


@dataclass
class QResult:
    """One (adapter, question) outcome — the machine-readable record."""

    run_id: str
    adapter: str
    adapter_kind: str          # retrieval | answer
    backend: str               # e.g. fts5, gemini-3.x-flash, docling-2.x+fts5
    versions: dict
    doc_id: str
    doc_sha256: str
    question_id: str
    question_class: str
    question: str
    expected: dict
    answer_text: str = ""
    evidence: list = field(default_factory=list)   # [{page, snippet, kind}]
    cited_pages: list = field(default_factory=list)
    abstained: bool = False
    correct: bool | None = None
    citation_correct: bool | None = None
    abstention_correct: bool | None = None
    scope_ok: bool | None = None
    latency_s: float = 0.0
    cost_usd: float | None = None
    tokens: dict | None = None
    error: str | None = None
    ts: str = ""


def score(result: QResult, q: dict) -> None:
    """Deterministic scoring, in place."""
    expect_abstain = bool(q.get("abstain"))
    hay_answer = result.answer_text.lower()
    hay_evidence = "\n".join(e.get("snippet", "") for e in result.evidence).lower()
    hay = hay_answer if result.adapter_kind == "answer" else hay_evidence

    def has_all(markers: list[str]) -> bool:
        return all(m.lower() in hay for m in markers)

    def has_any(markers: list[str]) -> bool:
        return any(m.lower() in hay for m in markers)

    if expect_abstain:
        if result.adapter_kind == "answer":
            result.abstention_correct = result.abstained or looks_like_abstention(result.answer_text)
        else:
            # A retrieval adapter "abstains" by returning nothing relevant; for
            # scope questions the scope check below is the real assertion.
            result.abstention_correct = len(result.evidence) == 0 or result.abstained
        result.correct = result.abstention_correct
    else:
        ok = True
        if q.get("expect_all"):
            ok = ok and has_all(q["expect_all"])
        if q.get("expect_any"):
            ok = ok and has_any(q["expect_any"])
        result.correct = ok
        if q.get("expect_page") is not None:
            page = int(q["expect_page"])
            if result.adapter_kind == "answer":
                result.citation_correct = page in [int(p) for p in result.cited_pages]
            else:
                result.citation_correct = page in [int(e.get("page", -1)) for e in result.evidence]

    if q.get("scope_guard"):
        # No evidence may come from any doc other than the scoped one.
        result.scope_ok = all(e.get("doc_id", result.doc_id) == result.doc_id for e in result.evidence)


def write_results(path: Path, results: list[QResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")


def now_ts() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")
