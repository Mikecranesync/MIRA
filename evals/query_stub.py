"""Query interface for FactoryLM RAG evaluation.

Provides query_factorylm() which returns {"answer": str, "contexts": [str, ...]}.

Two modes:
  - Dummy (default): returns canned responses for pipeline testing
  - Live (--live flag): calls real MIRA Supervisor for actual RAG responses
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# =============================================================================
# DUMMY RESPONSES — used when --live is not set
# These let you verify the eval pipeline runs end-to-end without any services.
# =============================================================================

_DUMMY_RESPONSES = {
    "default": {
        "answer": (
            "Based on the maintenance documentation, this appears to be "
            "a common issue. Check the equipment manual for the specific "
            "fault code and follow the recommended troubleshooting steps."
        ),
        "contexts": [
            "General troubleshooting: identify the fault code, check wiring, "
            "verify power supply, and inspect for mechanical issues.",
            "Always de-energize equipment before performing maintenance. "
            "Follow NFPA 70E lockout/tagout procedures.",
        ],
    },
    "F2": {
        "answer": (
            "F2 on the PowerFlex 40 indicates an overcurrent fault. The drive "
            "detected output current exceeding the trip level. Check motor "
            "wiring for shorts or ground faults, verify motor FLA matches the "
            "drive rating, and inspect for mechanical binding causing stall."
        ),
        "contexts": [
            "The PowerFlex 40 fault code F2 indicates Overcurrent — the drive "
            "output current exceeded the overcurrent trip level.",
            "Common causes of F2: shorted motor leads, ground fault between "
            "drive and motor, motor stall, or drive undersized for load.",
            "Action for F2: disconnect motor leads at drive and megohmeter test. "
            "Check for mechanical binding. Verify motor FLA does not exceed "
            "drive rated current.",
        ],
    },
    "3RT2": {
        "answer": (
            "To reset the Siemens 3RT2 contactor after overload: resolve the "
            "root cause first, wait for the thermal relay to cool (2-5 min), "
            "then press the blue RESET button on the overload relay."
        ),
        "contexts": [
            "Siemens 3RT2 contactors pair with 3RU2 thermal overload relays. "
            "After trip: identify root cause, allow relay to cool, press blue "
            "RESET button on relay.",
        ],
    },
}


def _match_dummy(question: str) -> dict:
    """Find the best dummy response for a question."""
    q = question.lower()
    for key, resp in _DUMMY_RESPONSES.items():
        if key == "default":
            continue
        if key.lower() in q:
            return resp
    return _DUMMY_RESPONSES["default"]


def query_factorylm(question: str, live: bool = False) -> dict:
    """Query the FactoryLM RAG system.

    Args:
        question: The maintenance question to ask.
        live: If True, call real MIRA Supervisor. If False, return dummy data.

    Returns:
        {"answer": str, "contexts": [str, ...]}
    """
    if not live:
        return _match_dummy(question)

    return _query_live(question)


# =============================================================================
# LIVE IMPLEMENTATION
#
# >>> TO CONNECT TO REAL MIRA: <<<
# Set these environment variables (via Doppler or export):
#   NEON_DATABASE_URL    — NeonDB connection string
#   MIRA_TENANT_ID       — tenant for knowledge_entries
#   OLLAMA_BASE_URL      — Ollama host (default: http://localhost:11434)
#   ANTHROPIC_API_KEY    — for Claude inference (optional)
#   OPENWEBUI_API_KEY    — for Open WebUI fallback (optional)
#
# Then run: python evals/run_eval.py --use-ragas --live
# =============================================================================


def _query_live(question: str) -> dict:
    """Call real MIRA RAG pipeline and return answer + contexts.

    Uses neon_recall.recall_knowledge() for retrieval and
    InferenceRouter for generation. Does NOT use the full Supervisor
    FSM — just the RAG retrieval + LLM call, which is what we want
    to evaluate.
    """
    import os

    import httpx

    tenant_id = os.environ.get("MIRA_TENANT_ID", "")
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    if not tenant_id:
        raise RuntimeError("MIRA_TENANT_ID not set — cannot run live eval")

    # Step 1: Embed the question
    embed_resp = httpx.post(
        f"{ollama_url}/api/embeddings",
        json={"model": "nomic-embed-text:latest", "prompt": question},
        timeout=30,
    )
    embed_resp.raise_for_status()
    embedding = embed_resp.json()["embedding"]

    # Step 2: Retrieve contexts from NeonDB
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-bots", "shared"))
    from neon_recall import recall_knowledge

    chunks = recall_knowledge(
        embedding=embedding,
        tenant_id=tenant_id,
        limit=5,
        query_text=question,
    )
    contexts = [c["content"] for c in chunks]

    # Step 3: Generate answer via Claude (if available) or return contexts only
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if anthropic_key:
        context_block = "\n\n---\n\n".join(contexts) if contexts else "(no context retrieved)"
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"),
                "max_tokens": 1024,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"You are an industrial maintenance assistant. "
                            f"Answer the question using ONLY the provided context.\n\n"
                            f"Context:\n{context_block}\n\n"
                            f"Question: {question}"
                        ),
                    }
                ],
            },
            timeout=60,
        )
        resp.raise_for_status()
        answer = resp.json()["content"][0]["text"]
    else:
        answer = "(Claude API not available — contexts retrieved but no answer generated)"
        logger.warning("ANTHROPIC_API_KEY not set — returning contexts only")

    return {"answer": answer, "contexts": contexts}
