"""
title: Lookup Part / Spare
author: FactoryLM
version: 1.0.0
description: Look up a part number, spare component, or replacement item from the
             MIRA knowledge base and Atlas CMMS parts inventory. Call this when the
             technician asks about a specific part, replacement component, or spare.
required_open_webui_version: 0.3.0
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request


class Tools:
    def __init__(self) -> None:
        self.atlas_url = os.getenv("ATLAS_API_URL", "http://atlas-api:8080")
        self.atlas_user = os.getenv("ATLAS_API_USER", "")
        self.atlas_password = os.getenv("ATLAS_API_PASSWORD", "")
        self.neon_url = os.getenv("NEON_DATABASE_URL", "")

    def _get_atlas_token(self) -> str | None:
        try:
            payload = json.dumps({"username": self.atlas_user, "password": self.atlas_password}).encode()
            req = urllib.request.Request(
                f"{self.atlas_url}/api/auth/signin",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode()).get("token")
        except Exception:
            return None

    def _search_atlas_parts(self, part_number: str, token: str) -> list[dict]:
        """Search Atlas CMMS parts inventory."""
        try:
            encoded = urllib.parse.quote(part_number)
            req = urllib.request.Request(
                f"{self.atlas_url}/api/parts?search={encoded}&limit=5",
                headers={"Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                items = data if isinstance(data, list) else data.get("content", [])
                return items[:5]
        except Exception:
            return []

    def _search_kb(self, part_number: str) -> list[dict]:
        """Search NeonDB knowledge_entries for part-related content."""
        if not self.neon_url:
            return []
        try:
            import psycopg2  # type: ignore

            conn = psycopg2.connect(self.neon_url, sslmode="require", connect_timeout=10)
            cur = conn.cursor()
            cur.execute(
                """
                SELECT content, manufacturer, model_number, source_type, metadata
                FROM knowledge_entries
                WHERE content ILIKE %s
                  AND embedding IS NOT NULL
                LIMIT 3
                """,
                (f"%{part_number}%",),
            )
            rows = cur.fetchall()
            cur.close()
            conn.close()
            return [
                {
                    "content": r[0][:300],
                    "manufacturer": r[1],
                    "model": r[2],
                    "source_type": r[3],
                }
                for r in rows
            ]
        except Exception:
            return []

    def lookup_part(self, part_number: str) -> str:
        """
        Search for a spare part or replacement component by part number or description.

        Use this when the technician asks:
        - 'Do we have [part number] in stock?'
        - 'What is the replacement for [part]?'
        - 'Find specs for part [number]'
        - 'What does part [number] do on a [equipment]?'

        Searches both Atlas CMMS parts inventory (stock levels) and the MIRA
        knowledge base (technical specifications from equipment manuals).

        Args:
            part_number: Part number, catalog number, or descriptive search term
                         (e.g. 'HC3-A012FB6', '20F1AND022JA0NNN', 'IGBT module')

        Returns:
            Formatted string with inventory and KB matches, or 'not found'.
        """
        if not part_number:
            return "Provide a part number or description to search."

        results: list[str] = []

        # Atlas inventory search
        token = self._get_atlas_token()
        if token:
            atlas_parts = self._search_atlas_parts(part_number, token)
            if atlas_parts:
                results.append(f"**Atlas inventory** — {len(atlas_parts)} match(es):")
                for p in atlas_parts:
                    name = p.get("name") or p.get("title") or "?"
                    qty = p.get("quantity", "?")
                    unit = p.get("unit") or ""
                    location = p.get("location") or p.get("area") or ""
                    results.append(
                        f"  - {name} | qty: {qty}{' ' + unit if unit else ''}"
                        + (f" | {location}" if location else "")
                    )
            else:
                results.append(f"Atlas inventory: no match for '{part_number}'.")

        # KB search
        kb_hits = self._search_kb(part_number)
        if kb_hits:
            results.append(f"\n**Knowledge base** — {len(kb_hits)} reference(s):")
            for hit in kb_hits:
                mfr = hit.get("manufacturer") or ""
                model = hit.get("model") or ""
                src = f"[{mfr} {model}]".strip("[ ]")
                snippet = hit["content"][:200].replace("\n", " ")
                results.append(f"  - {src}: {snippet}…")
        elif not token:
            results.append("Knowledge base search skipped — NEON_DATABASE_URL not set.")

        if not results:
            return f"No results found for '{part_number}' in inventory or knowledge base."

        return "\n".join(results)
