"""
title: Get Equipment Work Order History
author: FactoryLM
version: 1.0.0
description: Look up the last 5 work orders for an equipment asset from Atlas CMMS.
             Call this when the technician asks about equipment history, past repairs,
             or recurring faults for a specific asset.
required_open_webui_version: 0.3.0
"""

from __future__ import annotations

import json
import os
from typing import Any


class Tools:
    def __init__(self) -> None:
        self.atlas_url = os.getenv("ATLAS_API_URL", "http://atlas-api:8080")
        self.atlas_user = os.getenv("ATLAS_API_USER", "")
        self.atlas_password = os.getenv("ATLAS_API_PASSWORD", "")

    def _get_token(self) -> str | None:
        """Authenticate with Atlas CMMS and return a JWT token."""
        try:
            import urllib.request

            payload = json.dumps({"username": self.atlas_user, "password": self.atlas_password}).encode()
            req = urllib.request.Request(
                f"{self.atlas_url}/api/auth/signin",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                return data.get("token")
        except Exception:
            return None

    def get_equipment_history(self, asset_id: str) -> str:
        """
        Retrieve the last 5 work orders for an equipment asset.

        Use this when a technician asks:
        - 'What work has been done on [asset]?'
        - 'Has this fault happened before on [equipment ID]?'
        - 'Show me the maintenance history for [asset tag]'

        Args:
            asset_id: The equipment asset tag or ID (e.g. 'PUMP-003', 'VFD-LINE-2')

        Returns:
            Formatted string with last 5 work orders, or a message if none found.
        """
        token = self._get_token()
        if not token:
            return "Could not connect to CMMS — check ATLAS_API_URL, ATLAS_API_USER, ATLAS_API_PASSWORD."

        try:
            import urllib.request

            url = f"{self.atlas_url}/api/work-orders?asset={asset_id}&limit=5&sort=createdAt,desc"
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            return f"CMMS query failed: {e}"

        items: list[Any] = data if isinstance(data, list) else data.get("content", [])
        if not items:
            return f"No work orders found for asset '{asset_id}'."

        lines = [f"Work order history for **{asset_id}** (last {min(5, len(items))}):\n"]
        for wo in items[:5]:
            wo_id = wo.get("id", "?")
            title = wo.get("title") or wo.get("name") or "Untitled"
            status = wo.get("status", "?")
            priority = wo.get("priority", "")
            created = (wo.get("createdAt") or wo.get("dueDate") or "")[:10]
            description = (wo.get("description") or "")[:120]
            lines.append(
                f"- **WO-{wo_id}** [{status}] {created} — {title}"
                + (f" ({priority} priority)" if priority else "")
                + (f"\n  {description}" if description else "")
            )

        return "\n".join(lines)
