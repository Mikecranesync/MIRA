"""Standalone Langfuse connection test.

Usage:
    python evals/test_langfuse_connection.py

Exit 0 = connection OK + test trace sent
Exit 1 = connection failed or package missing

Requires env vars: LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY
Optional:          LANGFUSE_HOST (default: http://localhost:3000)
"""

import asyncio
import sys
import os

# Allow running from repo root: python evals/test_langfuse_connection.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evals.langfuse_setup import get_langfuse, trace_rag_query  # noqa: E402


def test_connection() -> bool:
    """Auth-check the Langfuse client. Returns True on success."""
    lf = get_langfuse()
    if lf is None:
        print("ERROR: Langfuse client could not be initialised.")
        print("  Check LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_HOST.")
        return False

    try:
        result = lf.auth_check()
        if result:
            print("Langfuse connection OK")
            return True
        else:
            print("ERROR: Langfuse auth_check returned False.")
            print("  Verify your API keys and host URL.")
            return False
    except Exception as exc:
        print(f"ERROR: Langfuse auth_check raised: {exc}")
        return False


async def send_test_trace() -> bool:
    """Send one hardcoded test trace with all 4 spans populated."""
    TEST_QUERY = "VFD fault code F001 on conveyor 4 — motor tripped"
    TEST_CHUNKS = ["chunk_abc123", "chunk_def456"]
    TEST_SCORES = [0.921, 0.874]
    TEST_CONTEXT = (
        "Allen-Bradley PowerFlex 525 fault F001: DC Bus Undervoltage. "
        "Check input voltage at L1/L2/L3. Minimum input: 342 VAC (460V drive). "
        "Common causes: loose fuse, open contactor, upstream breaker trip."
    )
    TEST_RESPONSE = (
        '{"next_state": "FAULT_ID", "reply": "What does the drive nameplate '
        'show for input voltage rating?", "options": ["460V", "230V", "Other"]}'
    )

    try:
        async with trace_rag_query(
            TEST_QUERY,
            session_id="test-session-001",
            metadata={"source": "test_langfuse_connection.py"},
        ) as spans:
            async with spans.embed_query(TEST_QUERY):
                pass  # In production: embedding happens here

            async with spans.vector_search(TEST_QUERY, TEST_CHUNKS, TEST_SCORES):
                pass  # In production: Open WebUI retrieval happens here

            async with spans.context_compose(TEST_CHUNKS, TEST_CONTEXT):
                pass  # In production: context composition happens here

            async with spans.llm_inference(
                prompt_token_estimate=312,
                response=TEST_RESPONSE,
                latency_ms=843,
            ):
                pass  # In production: LLM call happens here

        print("Test trace sent successfully.")
        return True
    except Exception as exc:
        print(f"ERROR: Test trace failed: {exc}")
        return False


def main():
    print("--- Langfuse Connection Test ---\n")

    # Step 1: Auth check
    if not test_connection():
        sys.exit(1)

    # Step 2: Send test trace
    print("\nSending test trace (all 4 spans)...")
    ok = asyncio.run(send_test_trace())
    if not ok:
        sys.exit(1)

    print("\nAll checks passed. Check your Langfuse dashboard for trace 'rag_query'.")
    sys.exit(0)


if __name__ == "__main__":
    main()
