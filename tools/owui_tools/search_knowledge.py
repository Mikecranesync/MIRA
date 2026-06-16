"""
title: Search Equipment Knowledge Base
author: FactoryLM
version: 1.0.0
description: Directly query the MIRA equipment knowledge base (NeonDB + pgvector) for
             technical documentation, fault code meanings, parameter tables, and
             wiring specifications. Use when the primary RAG context is insufficient
             or when the technician explicitly requests documentation.
required_open_webui_version: 0.3.0
"""

import json
import os
import urllib.request


class Tools:
    def __init__(self) -> None:
        self.mcp_url = os.getenv("MCP_REST_API_URL", "http://mira-mcp:8001")
        self.mcp_key = os.getenv("MCP_REST_API_KEY", "")
        self.tenant_id = os.getenv("MIRA_TENANT_ID", "default")

    def search_knowledge(self, query: str, limit: int = 3) -> str:
        """
        Search the MIRA equipment knowledge base for technical documentation.

        Use this when:
        - The technician asks for parameter tables, wiring diagrams, or specifications
        - The primary conversation context doesn't contain specific technical details
        - The technician asks 'what does parameter P9.00 do?' or 'show me the fault code table'
        - You need to cite a source with a [Source: ...] reference

        Do NOT call this for every message — only when KB documentation would add
        specific value that isn't already in the retrieved context.

        Args:
            query: Natural language search query (e.g. 'GS20 overcurrent fault threshold',
                   'PowerFlex 525 F012 meaning', 'Yaskawa V1000 parameter A1-02')
            limit: Number of results to return (default 3, max 5)

        Returns:
            Formatted string with matching KB chunks and source citations.
        """
        if not query:
            return "Provide a search query."

        limit = min(int(limit), 5)

        if not self.mcp_key:
            return "KB search unavailable — MCP_REST_API_KEY not configured."

        try:
            payload = json.dumps({
                "query": query,
                "tenant_id": self.tenant_id,
                "limit": limit,
            }).encode()
            req = urllib.request.Request(
                f"{self.mcp_url}/recall",
                data=payload,
                headers={
                    "Authorization": f"Bearer {self.mcp_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            return f"KB search failed: {e}"

        chunks = data if isinstance(data, list) else data.get("results", [])
        if not chunks:
            return f"No KB results for '{query}'. No specific documentation found for this equipment or fault code."

        lines = [f"KB results for **{query}** ({len(chunks)} match(es)):\n"]
        for i, chunk in enumerate(chunks[:limit], start=1):
            content = (chunk.get("content") or "")[:400].replace("\n", " ")
            mfr = chunk.get("manufacturer") or ""
            model = chunk.get("model_number") or ""
            source_type = chunk.get("source_type") or "manual"
            similarity = chunk.get("similarity")
            sim_str = f" ({similarity:.0%} match)" if similarity else ""
            citation = f"[Source: {mfr} {model}, {source_type}]".replace("  ", " ").strip()
            lines.append(f"**{i}.** {content}…\n   {citation}{sim_str}\n")

        return "\n".join(lines)
