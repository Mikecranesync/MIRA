"""ingest_interactions.py — Upload anonymized chat history to Open WebUI KB.

Reads anonymized_chats.jsonl, groups into Q&A sessions, uploads to knowledge collection.

Run with:
    doppler run --project factorylm --config prd -- python ingest_interactions.py
"""

import io
import json
import os
from datetime import datetime
from pathlib import Path

import httpx

_MIRA_SERVER = os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", f"{_MIRA_SERVER}:3000")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")

HEADERS = {"Authorization": f"Bearer {OPENWEBUI_API_KEY}"} if OPENWEBUI_API_KEY else {}
INPUT_PATH = Path(__file__).parent / "data" / "anonymized_chats.jsonl"
COLLECTION_NAME = "MIRA Industrial KB"

# Minimum content length to consider a message worth ingesting
MIN_CONTENT_LENGTH = 20


def get_collection_id() -> str:
    """Return the knowledge collection ID. Must exist (created by seed_kb.py)."""
    resp = httpx.get(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge",
        headers=HEADERS,
        timeout=15,
    )
    resp.raise_for_status()
    for col in resp.json():
        if col.get("name") == COLLECTION_NAME:
            return col["id"]
    raise RuntimeError(f"Collection '{COLLECTION_NAME}' not found. Run seed_kb.py first.")


def upload_text_to_collection(collection_id: str, filename: str, content: str):
    """Upload a text document to the knowledge collection."""
    file_bytes = content.encode("utf-8")
    resp = httpx.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/files",
        headers=HEADERS,
        files={"file": (filename, io.BytesIO(file_bytes), "text/plain")},
        timeout=60,
    )
    resp.raise_for_status()
    file_id = resp.json()["id"]

    resp = httpx.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/{collection_id}/file/add",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"file_id": file_id},
        timeout=60,
    )
    resp.raise_for_status()
    print(f"  Uploaded: {filename}")


def group_into_qa_pairs(messages: list[dict]) -> list[dict]:
    """Group consecutive user+assistant turns into Q&A pairs."""
    pairs = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        if (
            msg["role"] == "user"
            and i + 1 < len(messages)
            and messages[i + 1]["role"] == "assistant"
        ):
            question = msg["content"].strip()
            answer = messages[i + 1]["content"].strip()
            if len(question) >= MIN_CONTENT_LENGTH and len(answer) >= MIN_CONTENT_LENGTH:
                pairs.append(
                    {
                        "question": question,
                        "answer": answer,
                        "timestamp": msg.get("timestamp", ""),
                    }
                )
            i += 2
        else:
            i += 1
    return pairs


def format_qa_document(pairs: list[dict], batch_num: int) -> str:
    """Format Q&A pairs as a markdown document."""
    date_str = datetime.now().strftime("%Y-%m-%d")
    lines = [
        f"# MIRA Interaction Log — Batch {batch_num} ({date_str})",
        "",
        "These are real maintenance Q&A sessions from the MIRA system, anonymized for training.",
        "",
    ]
    for i, pair in enumerate(pairs, 1):
        lines.append(f"## Q{i}: {pair['question'][:80]}...")
        lines.append("")
        lines.append(f"**Question:** {pair['question']}")
        lines.append("")
        lines.append(f"**Answer:** {pair['answer']}")
        lines.append("")
    return "\n".join(lines)


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: {INPUT_PATH} not found. Run anonymize_interactions.py first.")
        return

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        messages = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(messages)} messages from {INPUT_PATH}")

    pairs = group_into_qa_pairs(messages)
    print(f"Grouped into {len(pairs)} Q&A pairs")

    if not pairs:
        print("No Q&A pairs to ingest. Exiting.")
        return

    collection_id = get_collection_id()
    print(f"Target collection: {collection_id}")

    # Upload in batches of 50 pairs per document
    batch_size = 50
    for batch_num, start in enumerate(range(0, len(pairs), batch_size), 1):
        batch = pairs[start : start + batch_size]
        doc = format_qa_document(batch, batch_num)
        filename = f"mira_interactions_batch_{batch_num:03d}.txt"
        upload_text_to_collection(collection_id, filename, doc)

    print(f"Done. Ingested {len(pairs)} Q&A pairs in {batch_num} batch(es).")


if __name__ == "__main__":
    main()
