"""
title: MIRA Equipment Tools
author: FactoryLM
version: 1.0.0
license: MIT
description: Live equipment status, active faults, and work order creation via mira-mcp.
"""

import httpx
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        mcp_base_url: str = Field(
            default="http://mira-mcp:8001",
            description="mira-mcp REST API base URL (internal Docker network)",
        )
        mcp_api_key: str = Field(
            default="",
            description="Bearer token for mira-mcp REST API (MCP_REST_API_KEY)",
        )

    def __init__(self):
        self.valves = self.Valves()

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.valves.mcp_api_key:
            h["Authorization"] = f"Bearer {self.valves.mcp_api_key}"
        return h

    async def get_equipment_status(self, equipment_id: str = "") -> str:
        """
        Get live equipment status readings from the CMMS.
        Returns current speed (RPM), temperature, current (amps), and pressure
        for monitored equipment. Pass an equipment_id to filter, or leave blank
        for all equipment.

        :param equipment_id: Optional equipment ID to filter (e.g. "pump-001")
        :return: Formatted equipment status report
        """
        url = f"{self.valves.mcp_base_url}/api/equipment"
        if equipment_id:
            url += f"?equipment_id={equipment_id}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                rows = resp.json().get("equipment", [])
            if not rows:
                return "No equipment found." + (
                    f" (filtered by: {equipment_id})" if equipment_id else ""
                )
            lines = [f"**Equipment Status** ({len(rows)} assets):\n"]
            for r in rows:
                readings = []
                if r.get("speed_rpm") is not None:
                    readings.append(f"{r['speed_rpm']} RPM")
                if r.get("temperature_c") is not None:
                    readings.append(f"{r['temperature_c']}\u00b0C")
                if r.get("current_amps") is not None:
                    readings.append(f"{r['current_amps']}A")
                if r.get("pressure_psi") is not None:
                    readings.append(f"{r['pressure_psi']} PSI")
                reading_str = ", ".join(readings) if readings else "no readings"
                status = r.get("status", "unknown").upper()
                lines.append(
                    f"- **{r['name']}** ({r['equipment_id']}): {status} \u2014 {reading_str}"
                )
            return "\n".join(lines)
        except httpx.HTTPStatusError as e:
            return f"Error querying equipment: HTTP {e.response.status_code}"
        except Exception as e:
            return f"Error querying equipment: {e}"

    async def get_active_faults(self) -> str:
        """
        List all active (unresolved) equipment faults with severity levels.
        Use this when a technician asks about current problems, alarms, or
        what needs attention.

        :return: Formatted list of active faults with severity and equipment
        """
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self.valves.mcp_base_url}/api/faults/active",
                    headers=self._headers(),
                )
                resp.raise_for_status()
                faults = resp.json().get("active_faults", [])
            if not faults:
                return "No active faults. All equipment operating normally."
            lines = [f"**Active Faults** ({len(faults)}):\n"]
            for f in faults:
                lines.append(
                    f"- [{f['severity'].upper()}] **{f['equipment_id']}** \u2014 "
                    f"{f['fault_code']}: {f['description']}"
                )
            return "\n".join(lines)
        except httpx.HTTPStatusError as e:
            return f"Error querying faults: HTTP {e.response.status_code}"
        except Exception as e:
            return f"Error querying faults: {e}"

    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: int = 0,
        category: str = "CORRECTIVE",
    ) -> str:
        """
        Create a CMMS work order from a diagnostic finding. Use this when the
        diagnosis identifies a clear action item that needs to be tracked as
        maintenance work.

        :param title: Short title for the work order (e.g. "VFD overcurrent on Pump-001")
        :param description: Detailed description of the issue and recommended action
        :param priority: Priority level: LOW, MEDIUM, HIGH, or EMERGENCY
        :param asset_id: CMMS asset ID (0 if unknown)
        :param category: Work order category: CORRECTIVE, PREVENTIVE, or INSPECTION
        :return: Confirmation with work order ID
        """
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.valves.mcp_base_url}/api/cmms/work-orders",
                    headers=self._headers(),
                    json={
                        "title": title,
                        "description": description,
                        "priority": priority,
                        "asset_id": asset_id,
                        "category": category,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            wo_id = data.get("id", "unknown")
            return (
                f"Work order created successfully.\n\n"
                f"- **WO #{wo_id}**: {title}\n"
                f"- Priority: {priority}\n"
                f"- Category: {category}"
            )
        except httpx.HTTPStatusError as e:
            return f"Error creating work order: HTTP {e.response.status_code} — {e.response.text[:200]}"
        except Exception as e:
            return f"Error creating work order: {e}"

    async def get_fault_history(self, equipment_id: str = "", limit: int = 10) -> str:
        """
        Get fault history for equipment. Shows resolved and unresolved faults
        over time. Useful for identifying recurring issues or patterns.

        :param equipment_id: Filter by equipment ID (blank for all)
        :param limit: Maximum number of records to return
        :return: Formatted fault history
        """
        url = f"{self.valves.mcp_base_url}/api/faults/history?limit={limit}"
        if equipment_id:
            url += f"&equipment_id={equipment_id}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
                faults = resp.json().get("fault_history", [])
            if not faults:
                return "No fault history found."
            lines = [f"**Fault History** ({len(faults)} records):\n"]
            for f in faults:
                resolved = "\u2705" if f.get("resolved") else "\u274c"
                lines.append(
                    f"- {resolved} **{f.get('equipment_id', '?')}** \u2014 "
                    f"{f.get('fault_code', '?')}: {f.get('description', '')}"
                )
            return "\n".join(lines)
        except httpx.HTTPStatusError as e:
            return f"Error querying fault history: HTTP {e.response.status_code}"
        except Exception as e:
            return f"Error querying fault history: {e}"
