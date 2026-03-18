# MIRA FactoryLM — Apache 2.0
"""PDF ingestion handler — uploads PDFs from Slack to Open WebUI knowledge base."""

import io
import logging
import os
import re

import httpx

logger = logging.getLogger("mira-slack-pdf")

OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")

# Default collection for uploaded documents
DEFAULT_COLLECTION = os.environ.get("PDF_COLLECTION_NAME", "Facility Documents")

# Filename patterns for smart collection routing
ELECTRICAL_PATTERNS = re.compile(
    r"(wiring|schematic|diagram|electrical|one.?line|ladder)", re.IGNORECASE
)
MANUAL_PATTERNS = re.compile(
    r"(manual|vfd|drive|plc|motor|pump|compressor|datasheet)", re.IGNORECASE
)


def _route_collection(filename: str) -> tuple[str, str]:
    """Pick collection name and description based on filename."""
    if ELECTRICAL_PATTERNS.search(filename):
        return (
            "Electrical Prints",
            "Wiring diagrams, schematics, and electrical drawings uploaded by technicians.",
        )
    if MANUAL_PATTERNS.search(filename):
        return (
            "Equipment Manuals",
            "Equipment manuals, datasheets, and technical documentation.",
        )
    return (
        DEFAULT_COLLECTION,
        "General facility documents uploaded by technicians.",
    )


async def _get_or_create_collection(name: str, description: str) -> str:
    """Find or create a knowledge collection in Open WebUI."""
    headers = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/", headers=headers
        )
        resp.raise_for_status()
        for col in resp.json().get("items", []):
            if col.get("name") == name:
                return col["id"]

        resp = await client.post(
            f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/create",
            headers={**headers, "Content-Type": "application/json"},
            json={"name": name, "description": description},
        )
        resp.raise_for_status()
        return resp.json()["id"]


async def ingest_pdf(file_bytes: bytes, filename: str) -> str:
    """Upload a PDF to the appropriate Open WebUI knowledge collection.

    Returns a user-facing status message.
    """
    col_name, col_desc = _route_collection(filename)

    headers = {}
    if OPENWEBUI_API_KEY:
        headers["Authorization"] = f"Bearer {OPENWEBUI_API_KEY}"

    try:
        collection_id = await _get_or_create_collection(col_name, col_desc)
    except Exception as e:
        logger.error("Failed to get/create collection '%s': %s", col_name, e)
        return f"Could not create knowledge collection: {e}"

    # Upload file to Open WebUI
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{OPENWEBUI_BASE_URL}/api/v1/files/",
                headers=headers,
                files={
                    "file": (filename, io.BytesIO(file_bytes), "application/pdf")
                },
            )
            resp.raise_for_status()
            file_id = resp.json()["id"]
    except Exception as e:
        logger.error("Failed to upload PDF '%s': %s", filename, e)
        return f"Could not upload PDF: {e}"

    # Add file to collection
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/{collection_id}/file/add",
                headers={**headers, "Content-Type": "application/json"},
                json={"file_id": file_id},
            )
            if resp.status_code == 400 and "Duplicate" in resp.text:
                return (
                    f"This PDF was already indexed in *{col_name}*. "
                    "Ask me anything about it."
                )
            resp.raise_for_status()
    except Exception as e:
        logger.error("Failed to add PDF to collection: %s", e)
        return f"Uploaded file but could not add to collection: {e}"

    logger.info(
        "PDF '%s' ingested into collection '%s' (file_id=%s)",
        filename, col_name, file_id,
    )
    return (
        f"Got it — I've indexed *{filename}* into the *{col_name}* collection. "
        "Ask me anything about it."
    )
