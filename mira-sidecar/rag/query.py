"""RAG query pipeline — dual-brain retrieval.

Implements the full retrieve-then-generate loop with Brain 1/Brain 2 architecture:
  1. Embed the user query
  2. Query Brain 2 (tenant docs) and Brain 1 (shared OEM) in parallel
  3. Merge, deduplicate, re-rank by cosine distance, keep top 5
  4. Check for safety keywords — prepend SAFETY_BANNER if detected
  5. Build context block with source labels (facility vs shared library)
  6. Call the LLM with the MIRA system prompt
  7. Return structured response with answer + labeled source citations
"""

from __future__ import annotations

import logging

from llm.base import EmbedProvider, LLMProvider
from rag.store import MiraVectorStore
from safety import SAFETY_BANNER, detect_safety

logger = logging.getLogger("mira-sidecar")

_SYSTEM_PROMPT = """\
You are Mira, a professional AI maintenance co-pilot for industrial equipment.
You answer based ONLY on the provided documentation and current tag values.
Do not fill gaps with your training data — if the documentation does not cover
the question, say so and recommend contacting the OEM or a qualified technician.

RESPONSE FORMAT — structure every answer as:
1. **Severity**: Critical / Warning / Informational
2. **Description**: What is happening, in plain language
3. **Likely Cause**: Based on the documentation provided
4. **Recommended Actions**: Numbered steps, one action per step
5. **Parts Needed**: If applicable (part number + description from docs)
6. **Estimated Time**: If the documentation provides repair time estimates
7. **Citations**: Every claim must cite its source

CITATION RULES:
- For facility documents: [Your docs: filename — page N]
- For shared library documents: [Mira library: filename — page N]
- Never answer without citing at least one source
- If no documentation matches, say: "No matching documentation found. \
Contact the equipment manufacturer or a qualified technician."

SAFETY: If the user describes a situation involving electrical hazards, \
lockout/tagout, confined spaces, pressurized systems, chemical exposure, \
or any immediate physical danger — lead with a safety warning BEFORE \
providing any technical answer.

TONE: Direct, confident, peer-to-peer. Never say "Great question!" or \
"Certainly!" Keep answers concise. You are a senior maintenance SME, not \
a chatbot.

SCOPE: You help with equipment maintenance, troubleshooting, specifications, \
and safety. Politely redirect off-topic questions: "I specialize in equipment \
maintenance. How can I help with your equipment today?"
"""

_N_RESULTS = 5

# Source labels for Brain 1 vs Brain 2
_LABEL_FACILITY = "Your docs"
_LABEL_SHARED = "Mira library"


def _format_tag_snapshot(tag_snapshot: dict) -> str:
    """Convert a tag snapshot dict into a readable string block."""
    if not tag_snapshot:
        return "No live tag data available."
    lines = ["Current tag values:"]
    for tag, value in tag_snapshot.items():
        lines.append(f"  {tag}: {value}")
    return "\n".join(lines)


def _merge_hits(
    tenant_hits: list[dict],
    shared_hits: list[dict],
    top_n: int = _N_RESULTS,
) -> list[dict]:
    """Merge hits from Brain 2 and Brain 1, deduplicate, re-rank by distance.

    Deduplication: if a chunk exists in both (same source_file + page),
    keep the Brain 2 (facility) copy and drop the Brain 1 duplicate.
    Re-ranking: sort all remaining hits by cosine distance (ascending).
    Brain 2 results are NOT artificially boosted — they win by relevance only.
    """
    # Tag each hit with its source brain
    for hit in tenant_hits:
        hit["_brain"] = _LABEL_FACILITY
    for hit in shared_hits:
        hit["_brain"] = _LABEL_SHARED

    # Deduplicate: facility copy wins over shared copy
    seen: set[tuple[str, str]] = set()
    merged: list[dict] = []

    for hit in tenant_hits:
        key = (hit.get("source_file", ""), hit.get("page", ""), hit.get("chunk_index", 0))
        seen.add(key)
        merged.append(hit)

    for hit in shared_hits:
        key = (hit.get("source_file", ""), hit.get("page", ""), hit.get("chunk_index", 0))
        if key not in seen:
            seen.add(key)
            merged.append(hit)

    # Re-rank by cosine distance (lower = more similar)
    merged.sort(key=lambda h: h.get("distance", 999.0))

    return merged[:top_n]


def _build_context(tag_snapshot: dict, hits: list[dict]) -> str:
    """Combine live tag data and retrieved document chunks into an LLM context block."""
    parts: list[str] = []

    tag_block = _format_tag_snapshot(tag_snapshot)
    parts.append(tag_block)

    if hits:
        parts.append("\nRelevant documentation:")
        for hit in hits:
            source = hit.get("source_file", "unknown")
            page = hit.get("page", "")
            brain = hit.get("_brain", _LABEL_SHARED)
            page_label = f" — page {page}" if page else ""
            text = hit.get("text", "").strip()
            parts.append(f"\n[{brain}: {source}{page_label}]\n{text}")
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
            excerpt = hit.get("text", "")[:200].strip()
            sources.append(
                {
                    "file": source_file,
                    "page": page,
                    "excerpt": excerpt,
                    "brain": hit.get("_brain", _LABEL_SHARED),
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
    shared_store: MiraVectorStore | None = None,
) -> dict:
    """Execute the dual-brain RAG pipeline and return a structured response.

    Args:
        query: The maintenance question from the user.
        asset_id: Tenant-scoped equipment identifier for Brain 2 filtering.
        tag_snapshot: Dict of live PLC/SCADA tag values for context.
        store: Brain 2 (tenant) MiraVectorStore.
        llm: LLM provider for final answer generation.
        embedder: Embedding provider for query vectorisation.
        shared_store: Brain 1 (shared OEM) MiraVectorStore. If None, skip Brain 1.

    Returns:
        Dict with keys:
          - answer (str): LLM-generated response
          - sources (list[dict]): Cited documents with file, page, excerpt, brain
    """
    # 1. Check safety BEFORE hitting the LLM
    is_safety = detect_safety(query)

    # 2. Embed the query
    query_vectors = await embedder.embed([query])
    if not query_vectors or not query_vectors[0]:
        logger.error("rag_query: embedding failed for query='%s'", query[:80])
        return {
            "answer": "Embedding service unavailable — unable to retrieve relevant documentation.",
            "sources": [],
        }
    query_embedding = query_vectors[0]

    # 3. Query Brain 2 (tenant docs, filtered by asset_id)
    tenant_hits = store.query(
        query_embedding=query_embedding,
        n_results=_N_RESULTS,
        asset_id=asset_id if asset_id else None,
    )

    # 4. Query Brain 1 (shared OEM library, no asset_id filter)
    shared_hits: list[dict] = []
    if shared_store:
        shared_hits = shared_store.query(
            query_embedding=query_embedding,
            n_results=_N_RESULTS,
        )

    logger.info(
        "rag_query: tenant_hits=%d shared_hits=%d asset_id=%s query='%s'",
        len(tenant_hits),
        len(shared_hits),
        asset_id,
        query[:80],
    )

    # 5. Merge, deduplicate, re-rank by distance, keep top 5
    hits = _merge_hits(tenant_hits, shared_hits, top_n=_N_RESULTS)

    # 6. Build context block with source labels
    context = _build_context(tag_snapshot, hits)

    # 7. Build system prompt — prepend safety context if needed
    system_prompt = _SYSTEM_PROMPT
    if is_safety:
        system_prompt = (
            "SAFETY ALERT: The user's question involves a potential safety hazard. "
            "You MUST lead your response with an appropriate safety warning before "
            "providing any technical guidance. Prioritize human safety above all else.\n\n"
            + system_prompt
        )

    # 8. Construct messages for LLM
    user_content = f"Context:\n{context}\n\nQuestion: {query}"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    # 9. Call LLM
    answer = await llm.complete(messages, max_tokens=1200)
    if not answer:
        answer = "Unable to generate a response at this time. Please check LLM provider settings."

    # 10. Prepend safety banner if safety keywords detected
    if is_safety:
        answer = SAFETY_BANNER + "\n\n" + answer

    # 11. Build source citations
    sources = _extract_sources(hits)

    return {"answer": answer, "sources": sources}
