"""
rag_engine.py — Local document search + Claude synthesis

Loads .txt files from ./docs/, chunks them, builds a TF-IDF index.
search() returns the most relevant chunks for a query.
query() calls Claude with those chunks and returns a natural language answer.

To add new equipment docs: drop a .txt file in vision_backend/docs/
"""

import os
from pathlib import Path
from typing import Optional

import numpy as np
import anthropic
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

DOCS_DIR = Path(__file__).parent / "docs"
CHUNK_SIZE = 500
RELEVANCE_THRESHOLD = 0.01

RAG_PROMPT_TEMPLATE = """\
You are MIRA, an industrial maintenance assistant.
Answer concisely based on the documentation provided below.

Equipment context: {equipment_context}
Technician question: {question}

Relevant documentation:
{context}

Answer in 2-4 sentences. Be specific. If fault codes are mentioned, include the reset/fix steps."""


class RAGEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self._chunks: list[dict] = []
        self._vectorizer: Optional[TfidfVectorizer] = None
        self._tfidf_matrix = None
        self._load_docs()

    # ── Index ──────────────────────────────────────────────────

    def _load_docs(self):
        """Scan docs/ directory, chunk files, build TF-IDF index."""
        DOCS_DIR.mkdir(exist_ok=True)
        self._chunks = []

        for txt_file in sorted(DOCS_DIR.glob("*.txt")):
            content = txt_file.read_text(encoding="utf-8")
            paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
            for para in paragraphs:
                for i in range(0, len(para), CHUNK_SIZE):
                    chunk = para[i : i + CHUNK_SIZE]
                    if len(chunk) > 40:
                        self._chunks.append(
                            {"filename": txt_file.name, "chunk": chunk}
                        )

        if self._chunks:
            texts = [c["chunk"] for c in self._chunks]
            self._vectorizer = TfidfVectorizer(
                stop_words="english", ngram_range=(1, 2)
            )
            self._tfidf_matrix = self._vectorizer.fit_transform(texts)
            print(
                f"[rag] indexed {len(self._chunks)} chunks "
                f"from {len(list(DOCS_DIR.glob('*.txt')))} doc(s)"
            )
        else:
            print(f"[rag] no .txt docs found in {DOCS_DIR}")

    def reload(self):
        """Re-scan docs/ — call this after dropping new files."""
        self._load_docs()

    # ── Search ─────────────────────────────────────────────────

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """
        Return up to top_k most relevant chunks for query.
        Each result: {filename, chunk, score}
        """
        if not self._chunks or self._vectorizer is None:
            return []

        q_vec = self._vectorizer.transform([query])
        scores = cosine_similarity(q_vec, self._tfidf_matrix).flatten()
        top_indices = scores.argsort()[-top_k:][::-1]

        results = []
        for idx in top_indices:
            if scores[idx] > RELEVANCE_THRESHOLD:
                results.append(
                    {
                        "filename": self._chunks[idx]["filename"],
                        "chunk": self._chunks[idx]["chunk"],
                        "score": float(scores[idx]),
                    }
                )
        return results

    # ── Query ──────────────────────────────────────────────────

    def query(self, question: str, equipment_context: str = "") -> dict:
        """
        Find relevant doc chunks and ask Claude to synthesize an answer.
        Returns {answer, sources, equipment_context}
        """
        if not self.api_key:
            return {
                "answer": "MIRA RAG offline — set ANTHROPIC_API_KEY env var.",
                "sources": [],
                "equipment_context": equipment_context,
            }

        full_query = f"{equipment_context} {question}".strip()
        chunks = self.search(full_query, top_k=3)

        if chunks:
            context_text = "\n\n---\n\n".join(
                f"[{c['filename']}]\n{c['chunk']}" for c in chunks
            )
        else:
            context_text = "No relevant documentation found in local knowledge base."

        prompt = RAG_PROMPT_TEMPLATE.format(
            equipment_context=equipment_context or "Unknown",
            question=question,
            context=context_text,
        )

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )

        answer = message.content[0].text.strip()
        sources = list({c["filename"] for c in chunks})

        return {
            "answer": answer,
            "sources": sources,
            "equipment_context": equipment_context,
        }
