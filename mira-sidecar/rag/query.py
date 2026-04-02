"""RAG query pipeline.

Implements the full retrieve-then-generate loop:
  1. Embed the user query
  2. Retrieve top-5 chunks from ChromaDB (optionally filtered by asset_id)
  3. Build a context block from live tag snapshot + document excerpts
  4. Call the LLM with the MIRA system prompt
  5. Return a structured response with answer + source citations
"""

from __future__ import annotations

import logging

from llm.base import EmbedProvider, LLMProvider
from rag.store import MiraVectorStore

logger = logging.getLogger("mira-sidecar")

_SYSTEM_PROMPT = (
    "You are Mira, an AI maintenance co-pilot for industrial equipment. "
    "Answer based on the provided documentation and current tag values. "
    "Cite sources as [filename — page N]. "
    "If unsure, say so."
)

_N_RESULTS = 5


def _format_tag_snapshot(tag_snapshot: dict) -> str:
    """Convert a tag snapshot dict into a readable string block."""
    if not tag_snapshot:
        return "No live tag data available."
    lines = ["Current tag values:"]
    for tag, value in tag_snapshot.items():
        lines.append(f"  {tag}: {value}")
    return "\n".join(lines)


def _build_context(tag_snapshot: dict, hits: list[dict]) -> str:
    """Combine live tag data and retrieved document chunks into an LLM context block."""
    parts: list[str] = []

    tag_block = _format_tag_snapshot(tag_snapshot)
    parts.append(tag_block)

    if hits:
        parts.append("\nRelevant documentation:")
        for i, hit in enumerate(hits, start=1):
            source = hit.get("source_file", "unknown")
            page = hit.get("page", "")
            page_label = f" — page {page}" if page else ""
            text = hit.get("text", "").strip()
            parts.append(f"\n[{source}{page_label}]\n{text}")
    else:
        parts.append("\nNo relevant documentation found.")

    return "\n".join(parts)


def _extract_sources(hits: list[dict]) -> list[dict]:
    """Build a deduplicated source list from retrieved chunks."""
    seen: set[tuple[str, str]] = set()
    sources: list[dict] = []
    for hit in hits:
        source_file = hit.get("source_file", "")
        page = hit.get("page", "")
        key = (source_file, page)
        if key not in seen:
            seen.add(key)
            # Keep a short excerpt (first 200 chars) for display
            excerpt = hit.get("text", "")[:200].strip()
            sources.append(
                {
                    "file": source_file,
                    "page": page,
                    "excerpt": excerpt,
                }
            )
    return sources


async def rag_query(
    query: str,
    asset_id: str,
    tag_snapshot: dict,
    store: MiraVectorStore,
    llm: LLMProvider,
    embedder: EmbedProvider,
) -> dict:
    """Execute the full RAG pipeline and return a structured response.

    Args:
        query: The maintenance question from the user / orchestration layer.
        asset_id: Equipment identifier used to filter document retrieval.
        tag_snapshot: Dict of live PLC/SCADA tag values for context.
        store: Initialised MiraVectorStore.
        llm: LLM provider for final answer generation.
        embedder: Embedding provider for query vectorisation.

    Returns:
        Dict with keys:
          - answer (str): LLM-generated response
          - sources (list[dict]): Cited documents with file, page, excerpt
    """
    # 1. Embed the query
    query_vectors = await embedder.embed([query])
    if not query_vectors or not query_vectors[0]:
        logger.error("rag_query: embedding failed for query='%s'", query[:80])
        return {
            "answer": "Embedding service unavailable — unable to retrieve relevant documentation.",
            "sources": [],
        }
    query_embedding = query_vectors[0]

    # 2. Retrieve relevant chunks
    hits = store.query(
        query_embedding=query_embedding,
        n_results=_N_RESULTS,
        asset_id=asset_id if asset_id else None,
    )
    logger.info(
        "rag_query: retrieved %d chunks for asset_id=%s query='%s'",
        len(hits),
        asset_id,
        query[:80],
    )

    # 3. Build context block
    context = _build_context(tag_snapshot, hits)

    # 4. Construct messages for LLM
    user_content = f"Context:\n{context}\n\nQuestion: {query}"
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    # 5. Call LLM
    answer = await llm.complete(messages, max_tokens=800)
    if not answer:
        answer = "Unable to generate a response at this time. Please check LLM provider settings."

    # 6. Build source citations
    sources = _extract_sources(hits)

    return {"answer": answer, "sources": sources}
