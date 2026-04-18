"""
title: Create Work Order
author: FactoryLM
version: 1.0.0
description: Create a new work order in Atlas CMMS directly from the MIRA diagnostic chat.
             Call this when the technician confirms a fault and wants to log a repair task,
             or when a diagnostic session concludes with a required action step.
required_open_webui_version: 0.3.0
"""

from __future__ import annotations

import json
import os
from typing import Literal


class Tools:
    def __init__(self) -> None:
        self.atlas_url = os.getenv("ATLAS_API_URL", "http://atlas-api:8080")
        self.atlas_user = os.getenv("ATLAS_API_USER", "")
        self.atlas_password = os.getenv("ATLAS_API_PASSWORD", "")

    def _get_token(self) -> str | None:
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

    def create_work_order(
        self,
        description: str,
        priority: Literal["NONE", "LOW", "MEDIUM", "HIGH", "EMERGENCY"] = "MEDIUM",
        asset_id: str = "",
        title: str = "",
    ) -> str:
        """
        Create a new corrective work order in Atlas CMMS.

        Use this when a technician says:
        - 'Log this as a work order'
        - 'Create a WO for this fault'
        - 'I need to schedule a repair'
        - When a diagnostic session ends with a confirmed fault and action needed

        Args:
            description: Full description of the work to be done. Include fault code,
                         symptom, and recommended action from the diagnostic session.
            priority:    Work order priority — NONE, LOW, MEDIUM, HIGH, or EMERGENCY.
                         Default is MEDIUM. Use EMERGENCY if equipment is down and
                         blocking production.
            asset_id:    Equipment asset tag or ID (e.g. 'VFD-LINE-2'). Leave blank
                         if unknown — WO will be created unlinked and can be associated later.
            title:       Short WO title (max 100 chars). If blank, auto-generated from
                         the first 80 chars of description.

        Returns:
            Confirmation string with WO number, or an error message.
        """
        token = self._get_token()
        if not token:
            return "Could not connect to CMMS — check ATLAS_API_URL, ATLAS_API_USER, ATLAS_API_PASSWORD."

        if not description:
            return "Description is required to create a work order."

        wo_title = title.strip() or description[:80].strip()

        payload: dict = {
            "title": wo_title,
            "description": description,
            "priority": priority,
            "status": "OPEN",
        }
        if asset_id:
            payload["asset"] = {"id": asset_id}

        try:
            import urllib.request

            body = json.dumps(payload).encode()
            req = urllib.request.Request(
                f"{self.atlas_url}/api/work-orders",
                data=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            return f"Work order creation failed: {e}"

        wo_id = data.get("id", "?")
        return (
            f"Work order **WO-{wo_id}** created [{priority} priority].\n"
            f"Title: {wo_title}\n"
            + (f"Asset: {asset_id}\n" if asset_id else "")
            + f"View in CMMS: http://localhost:3100/work-orders/{wo_id}"
        )
