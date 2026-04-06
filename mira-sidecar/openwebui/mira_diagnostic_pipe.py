"""MIRA Diagnostic — Open WebUI Pipe Function.

Paste this file's contents into Open WebUI: Workspace > Functions > Add Function.
It registers "MIRA Diagnostic" as a selectable model that routes queries through
the mira-sidecar RAG pipeline (Claude API + ChromaDB).

When a user attaches files, they are forwarded to the sidecar's /ingest/upload
endpoint for embedding into the tenant-scoped ChromaDB collection.
"""

from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from pydantic import BaseModel, Field


class Pipe:
    """Open WebUI Pipe that proxies chat through the MIRA sidecar RAG endpoint."""

    class Valves(BaseModel):
        SIDECAR_URL: str = Field(
            default="http://mira-sidecar:5000",
            description="Base URL of the mira-sidecar service",
        )
        REQUEST_TIMEOUT: int = Field(
            default=120,
            description="HTTP timeout in seconds for sidecar calls",
        )

    def __init__(self) -> None:
        self.valves = self.Valves()

    def pipes(self) -> list[dict[str, str]]:
        return [{"id": "mira-diagnostic", "name": "MIRA Diagnostic"}]

    async def pipe(
        self,
        body: dict,
        __user__: dict | None = None,
        __event_emitter__: Any = None,
        __task__: str | None = None,
        __files__: list[dict] | None = None,
    ) -> str | dict | AsyncGenerator[str, None]:
        # Pass through internal Open WebUI tasks (title/tag/emoji generation)
        # so they don't hit the sidecar RAG pipeline.
        if __task__:
            return body

        user_id = __user__["id"] if __user__ else "anonymous"
        asset_id = f"tenant_{user_id}"
        messages = body.get("messages", [])

        if not messages:
            return "No message received."

        # -- Handle file attachments (ingest into sidecar) --------------------
        last_msg = messages[-1]
        files = last_msg.get("files", []) or __files__ or []
        if files and __event_emitter__:
            await self._ingest_files(files, asset_id, __event_emitter__)

        # -- Extract the user's question --------------------------------------
        query = last_msg.get("content", "")
        if not query.strip():
            return "Please type a question about your equipment."

        # -- Status: querying -------------------------------------------------
        if __event_emitter__:
            await __event_emitter__(
                {
                    "type": "status",
                    "data": {"description": "Searching knowledge base...", "done": False},
                }
            )

        # -- Call sidecar /rag ------------------------------------------------
        try:
            async with httpx.AsyncClient(timeout=self.valves.REQUEST_TIMEOUT) as client:
                resp = await client.post(
                    f"{self.valves.SIDECAR_URL}/rag",
                    json={
                        "query": query,
                        "asset_id": asset_id,
                        "tag_snapshot": {},
                        "context": "",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.ConnectError:
            if __event_emitter__:
                await __event_emitter__(
                    {"type": "status", "data": {"description": "Sidecar unreachable", "done": True}}
                )
            return (
                "The MIRA diagnostic service is currently unavailable. "
                "Please try again in a moment."
            )
        except httpx.HTTPStatusError as exc:
            if __event_emitter__:
                await __event_emitter__(
                    {"type": "status", "data": {"description": "Error", "done": True}}
                )
            return f"Diagnostic service error (HTTP {exc.response.status_code}). Please try again."
        except Exception:
            if __event_emitter__:
                await __event_emitter__(
                    {"type": "status", "data": {"description": "Error", "done": True}}
                )
            return "An unexpected error occurred. Please try again."

        # -- Format response with citations -----------------------------------
        answer = data.get("answer", "No answer returned.")
        sources = data.get("sources", [])

        if sources and __event_emitter__:
            for source in sources:
                filename = source.get("file", "")
                page = source.get("page", "")
                excerpt = source.get("excerpt", "")
                source_name = filename
                if page:
                    source_name += f" -- page {page}"
                await __event_emitter__(
                    {
                        "type": "citation",
                        "data": {
                            "document": [excerpt] if excerpt else [filename],
                            "metadata": [{"source": filename, "page": page}],
                            "source": {"name": source_name},
                        },
                    }
                )

        if __event_emitter__:
            await __event_emitter__(
                {"type": "status", "data": {"description": "Done", "done": True}}
            )

        return answer

    async def _ingest_files(
        self,
        files: list[dict],
        asset_id: str,
        __event_emitter__: Any,
    ) -> None:
        """Forward attached files to the sidecar for ingestion."""
        for file_info in files:
            file_data = file_info.get("file", file_info)
            file_id = file_data.get("id", "")
            filename = file_data.get("filename", "") or file_info.get("name", "unknown")

            await __event_emitter__(
                {
                    "type": "status",
                    "data": {"description": f"Ingesting {filename}...", "done": False},
                }
            )

            # Open WebUI stores uploads at /app/backend/data/uploads/{id}_{filename}
            upload_path = Path(f"/app/backend/data/uploads/{file_id}_{filename}")
            if not upload_path.exists():
                # Try alternate: content may already be parsed and available in data
                content = file_data.get("data", {}).get("content", "")
                if content:
                    await self._ingest_text(filename, asset_id, content)
                    continue
                await __event_emitter__(
                    {
                        "type": "status",
                        "data": {"description": f"Could not find file: {filename}", "done": True},
                    }
                )
                continue

            try:
                async with httpx.AsyncClient(timeout=self.valves.REQUEST_TIMEOUT) as client:
                    file_bytes = upload_path.read_bytes()
                    resp = await client.post(
                        f"{self.valves.SIDECAR_URL}/ingest/upload",
                        files={"file": (filename, file_bytes)},
                        data={"asset_id": asset_id},
                    )
                    resp.raise_for_status()
                    result = resp.json()
                    chunks = result.get("chunks_added", 0)
                    await __event_emitter__(
                        {
                            "type": "status",
                            "data": {
                                "description": f"Ingested {filename} ({chunks} chunks)",
                                "done": True,
                            },
                        }
                    )
            except Exception:
                await __event_emitter__(
                    {
                        "type": "status",
                        "data": {"description": f"Failed to ingest {filename}", "done": True},
                    }
                )

    async def _ingest_text(
        self,
        filename: str,
        asset_id: str,
        content: str,
    ) -> None:
        """Ingest pre-parsed text content via the sidecar's /ingest/upload endpoint.

        Used when Open WebUI has already extracted the document text.
        Sends it as a .txt file upload to the sidecar (avoids cross-container
        filesystem path issues with /ingest).
        """
        async with httpx.AsyncClient(timeout=self.valves.REQUEST_TIMEOUT) as client:
            resp = await client.post(
                f"{self.valves.SIDECAR_URL}/ingest/upload",
                files={"file": (filename, content.encode("utf-8"))},
                data={"asset_id": asset_id},
            )
            resp.raise_for_status()
