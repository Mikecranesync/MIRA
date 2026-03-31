"""ChromaDB vector store wrapper.

Provides a clean interface over a persistent ChromaDB collection so that
app.py and the RAG query pipeline are decoupled from the Chroma API.

Metadata stored per chunk:
  source_file, page, asset_id, chunk_index, ingested_at (ISO timestamp)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import chromadb

from rag.chunker import Chunk

logger = logging.getLogger("mira-sidecar")

_COLLECTION_NAME = "mira_docs"


class MiraVectorStore:
    """Persistent ChromaDB-backed vector store for MIRA document chunks."""

    def __init__(
        self,
        chroma_path: str,
        collection_name: str = _COLLECTION_NAME,
    ) -> None:
        self._collection_name = collection_name
        self._client = chromadb.PersistentClient(path=chroma_path)
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            # cosine distance is standard for text embeddings
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(
            "VectorStore opened: collection=%s path=%s docs=%d",
            collection_name,
            chroma_path,
            self._collection.count(),
        )

    # ------------------------------------------------------------------
    # Write path
    # ------------------------------------------------------------------

    def add(
        self,
        chunks: list[Chunk],
        embeddings: list[list[float]],
        asset_id: str,
    ) -> None:
        """Upsert chunks with their embeddings into the collection.

        Uses a deterministic ID derived from asset_id + source_file + chunk_index
        so repeated ingestion of the same document is idempotent.

        Validates that embedding dimension matches any existing vectors in the
        collection before inserting (logs error if mismatch, skips offending
        chunks).
        """
        if not chunks:
            return
        if len(chunks) != len(embeddings):
            logger.error(
                "add(): chunk count (%d) != embedding count (%d) — skipping",
                len(chunks),
                len(embeddings),
            )
            return

        # Filter out chunks whose embeddings are empty (provider failure)
        valid = [(c, e) for c, e in zip(chunks, embeddings) if e]
        if not valid:
            logger.error("add(): all embeddings are empty — nothing inserted")
            return

        # Validate dimension consistency
        first_dim = len(valid[0][1])
        existing_count = self._collection.count()
        if existing_count > 0:
            # Peek at an existing vector to compare dimensions
            sample = self._collection.peek(limit=1)
            if sample["embeddings"] and sample["embeddings"][0]:
                existing_dim = len(sample["embeddings"][0])
                if existing_dim != first_dim:
                    logger.error(
                        "Embedding dimension mismatch: collection has %d, got %d — aborting add",
                        existing_dim,
                        first_dim,
                    )
                    return

        now_iso = datetime.now(timezone.utc).isoformat()

        ids: list[str] = []
        docs: list[str] = []
        metas: list[dict] = []
        embeds: list[list[float]] = []

        for chunk, embedding in valid:
            chunk_id = f"{asset_id}::{chunk.source_file}::{chunk.chunk_index}"
            ids.append(chunk_id)
            docs.append(chunk.text)
            metas.append(
                {
                    "source_file": chunk.source_file,
                    "page": str(chunk.page) if chunk.page is not None else "",
                    "asset_id": asset_id,
                    "chunk_index": chunk.chunk_index,
                    "ingested_at": now_iso,
                }
            )
            embeds.append(embedding)

        self._collection.upsert(
            ids=ids,
            documents=docs,
            metadatas=metas,
            embeddings=embeds,
        )
        logger.info(
            "Upserted %d chunks for asset_id=%s into collection=%s",
            len(ids),
            asset_id,
            self._collection_name,
        )

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------

    def query(
        self,
        query_embedding: list[float],
        n_results: int = 5,
        asset_id: str | None = None,
    ) -> list[dict]:
        """Return the top-n most similar chunks to the query embedding.

        If asset_id is provided, filters results to that asset only.
        Returns a list of dicts with keys: text, source_file, page, asset_id,
        chunk_index, distance.
        """
        where: dict | None = {"asset_id": asset_id} if asset_id else None

        try:
            result = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=min(n_results, max(self._collection.count(), 1)),
                where=where,
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:
            logger.error("ChromaDB query failed: %s", exc)
            return []

        hits: list[dict] = []
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        for doc, meta, dist in zip(docs, metas, distances):
            hits.append(
                {
                    "text": doc,
                    "source_file": meta.get("source_file", ""),
                    "page": meta.get("page", ""),
                    "asset_id": meta.get("asset_id", ""),
                    "chunk_index": meta.get("chunk_index", 0),
                    "distance": dist,
                }
            )
        return hits

    def doc_count(self) -> int:
        """Return total number of chunks stored in the collection."""
        return self._collection.count()
