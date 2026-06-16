"""NeonDB pgvector search — Brain 3 (cloud knowledge base).

Queries knowledge_entries (40,280 rows, 768-dim) and brain_memories
(5,493 rows, 768-dim) using pgvector cosine similarity.

Both tables use nomic-embed-text 768-dim vectors — same as the local
ChromaDB stores — so no re-embedding is needed at query time.

psycopg2 is sync; calls are wrapped in asyncio.to_thread() so they
don't block the FastAPI event loop. Connection opened per-query with
no application-side pooling (Neon's PgBouncer handles that).
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("mira-sidecar")

_LABEL_NEON = "Mira library"

# Rows to fetch from each NeonDB table before merging
_N_PER_TABLE = 5


class NeonStore:
    """pgvector cosine-similarity search over NeonDB knowledge tables."""

    def __init__(self, database_url: str) -> None:
        self._url = database_url

    async def query(
        self,
        query_embedding: list[float],
        n_results: int = _N_PER_TABLE,
    ) -> list[dict]:
        """Return top-n hits from knowledge_entries + brain_memories combined.

        Results are returned in the same dict shape as MiraVectorStore.query()
        so they can be passed through the existing _merge_hits() pipeline.
        """
        return await asyncio.to_thread(self._query_sync, query_embedding, n_results)

    def _query_sync(self, query_embedding: list[float], n_results: int) -> list[dict]:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        vec_literal = "[" + ",".join(str(x) for x in query_embedding) + "]"
        hits: list[dict] = []

        try:
            conn = psycopg2.connect(self._url, sslmode="require")
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # --- knowledge_entries (main OEM knowledge base) ---
            cur.execute(
                """
                SELECT
                    content                              AS text,
                    COALESCE(source_url, '')             AS source_file,
                    COALESCE(source_page::text, '')      AS page,
                    (embedding <=> %s::vector)           AS distance
                FROM knowledge_entries
                WHERE embedding IS NOT NULL
                ORDER BY distance
                LIMIT %s
                """,
                (vec_literal, n_results),
            )
            for row in cur.fetchall():
                hits.append(
                    {
                        "text": row["text"] or "",
                        "source_file": row["source_file"] or "",
                        "page": row["page"] or "",
                        "asset_id": "",
                        "chunk_index": 0,
                        "distance": float(row["distance"]),
                        "_brain": _LABEL_NEON,
                    }
                )

            # --- brain_memories (conversation memories / past diagnoses) ---
            cur.execute(
                """
                SELECT
                    payload->>'data'                     AS text,
                    'brain_memories'                     AS source_file,
                    ''                                   AS page,
                    (vector <=> %s::vector)              AS distance
                FROM brain_memories
                WHERE vector IS NOT NULL
                  AND payload->>'data' IS NOT NULL
                ORDER BY distance
                LIMIT %s
                """,
                (vec_literal, n_results),
            )
            for row in cur.fetchall():
                text = row["text"] or ""
                if text:
                    hits.append(
                        {
                            "text": text,
                            "source_file": "brain_memories",
                            "page": "",
                            "asset_id": "",
                            "chunk_index": 0,
                            "distance": float(row["distance"]),
                            "_brain": _LABEL_NEON,
                        }
                    )

            cur.close()
            conn.close()

        except Exception as exc:
            logger.error("NeonDB query failed: %s", exc)
            return []

        # Sort combined results by distance before returning
        hits.sort(key=lambda h: h["distance"])
        return hits[:n_results]
