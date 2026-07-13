"""Read-only FactoryLM context SDK for the garage conveyor demo.

This module is intentionally narrow: it exposes approved FactoryLM context as
structured data for MCP tools. It does not talk to PLCs, write tags, run raw
SQL supplied by callers, or expose unapproved documents.
"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from typing import Any

UNS_PATH = "enterprise.home_garage.conveyor_lab.conveyor_1"
ASSET = {
    "asset_id": "conveyor_1",
    "name": "Conveyor 1",
    "asset_type": "belt_conveyor",
    "uns_path": UNS_PATH,
    "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
    "approval_status": "verified",
}

RELATED_ASSETS = [
    {
        "asset_id": "gs10_vfd",
        "name": "GS10 VFD",
        "relationship": "DRIVES",
        "uns_path": f"{UNS_PATH}.gs10_vfd",
        "approval_status": "verified",
        "confidence": 0.97,
    },
    {
        "asset_id": "micro820_plc",
        "name": "Micro820 PLC",
        "relationship": "CONTROLS",
        "uns_path": f"{UNS_PATH}.micro820_plc",
        "approval_status": "verified",
        "confidence": 0.99,
    },
    {
        "asset_id": "photoeye_1",
        "name": "Photo Eye PE-001",
        "relationship": "SENSES_PRODUCT",
        "uns_path": f"{UNS_PATH}.photoeye_1",
        "approval_status": "verified",
        "confidence": 0.88,
    },
]

TAGS = [
    {
        "tag_id": "default_conveyor_motor_running",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "uns_path": UNS_PATH,
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "unit": None,
        "meaning": "True when the conveyor drive reports running.",
        "approval_status": "verified",
    },
    {
        "tag_id": "default_conveyor_estop_active",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "uns_path": UNS_PATH,
        "component_id": "micro820_plc",
        "data_type": "bool",
        "unit": None,
        "meaning": "True when the conveyor emergency stop input is active.",
        "approval_status": "verified",
    },
    {
        "tag_id": "default_conveyor_fault_alarm",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "uns_path": UNS_PATH,
        "component_id": "micro820_plc",
        "data_type": "bool",
        "unit": None,
        "meaning": "True when the conveyor fault alarm is active.",
        "approval_status": "verified",
    },
    {
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "uns_path": UNS_PATH,
        "component_id": "photoeye_1",
        "data_type": "bool",
        "unit": None,
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "approval_status": "verified",
    },
    {
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "uns_path": UNS_PATH,
        "component_id": "gs10_vfd",
        "data_type": "float",
        "unit": "Hz",
        "meaning": "GS10 output frequency in hertz.",
        "approval_status": "verified",
    },
    {
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "uns_path": UNS_PATH,
        "component_id": "gs10_vfd",
        "data_type": "float",
        "unit": "A",
        "meaning": "GS10 output current in amps.",
        "approval_status": "verified",
    },
]

EVIDENCE = [
    {
        "evidence_id": "garage:gs10_overcurrent",
        "title": "GS10 over-current fault guidance",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "source_type": "manual",
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "related_tags": ["default_mira_iocheck_vfd_vfd_current"],
        "summary": (
            "GS10 oC over-current can be caused by accel time, mechanical jam, "
            "or shorted motor leads."
        ),
    },
    {
        "evidence_id": "garage:micro820_io",
        "title": "Micro820 conveyor I/O map",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "source_type": "wiring_note",
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "related_tags": [
            "default_conveyor_estop_active",
            "default_mira_iocheck_inputs_di_05",
            "default_conveyor_fault_alarm",
        ],
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
    },
    {
        "evidence_id": "garage:gs10_modbus_params",
        "title": "GS10 Modbus command source parameters",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "source_type": "manual",
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "related_tags": ["default_mira_iocheck_vfd_vfd_frequency"],
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
    },
    {
        "evidence_id": "garage:unreviewed_torque_note",
        "title": "Unreviewed torque note",
        "source_url": "golden://garage_conveyor/UNREVIEWED_torque_note.md",
        "source_type": "draft_note",
        "approval_status": "draft",
        "asset_id": "conveyor_1",
        "related_tags": [],
        "summary": "Draft speed-increase note. This is intentionally hidden from default evidence search.",
    },
]

DIAGNOSTICS = [
    {
        "diagnostic_id": "conveyor:not_running",
        "fault": "Conveyor not running",
        "likely_causes": [
            "E-stop active or E-stop wiring fault",
            "Fault alarm active",
            "GS10 command source not set to RS-485",
            "Mechanical jam causing GS10 over-current",
        ],
        "next_checks": [
            "Check approved live values for E-stop, fault alarm, motor running, VFD frequency, and VFD current.",
            "If the machine must be opened or electrically inspected, stop and follow site LOTO before work.",
            "Inspect approved evidence for the GS10 over-current and Micro820 I/O mapping.",
        ],
        "citation_ids": [
            "garage:gs10_overcurrent",
            "garage:micro820_io",
            "garage:gs10_modbus_params",
        ],
        "approval_status": "verified",
        "confidence": 0.86,
    },
    {
        "diagnostic_id": "conveyor:photoeye_blocked",
        "fault": "Photoeye blocked or occupied too long",
        "likely_causes": [
            "Object in PE-001 beam",
            "Sensor alignment issue",
            "Input DI-05 stuck or stale",
        ],
        "next_checks": [
            "Read the PE-001 live value and freshness.",
            "Compare photoeye state against conveyor running/fault state.",
        ],
        "citation_ids": ["garage:micro820_io"],
        "approval_status": "verified",
        "confidence": 0.82,
    },
]


class ConveyorContextSDK:
    """Small read-only SDK facade for approved garage-conveyor context."""

    def __init__(self, live_values: dict[str, dict[str, Any]] | None = None) -> None:
        self.live_values = live_values if live_values is not None else self._load_env_live_values()

    def find_asset(self, query: str) -> dict[str, Any]:
        query_l = query.lower().strip()
        if not query_l or "conveyor" not in query_l:
            return self._not_found("asset", f"No approved asset matched '{query}'.", ["missing_asset"])
        return self._ok(asset=deepcopy(ASSET), matches=[deepcopy(ASSET)])

    def get_asset_context(self, asset_id: str = "conveyor_1") -> dict[str, Any]:
        if not self._asset_matches(asset_id):
            return self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"])
        return self._ok(
            asset=deepcopy(ASSET),
            tags=deepcopy(TAGS),
            related_assets=deepcopy(RELATED_ASSETS),
            related_documents=self._approved_evidence(),
        )

    def list_asset_tags(self, asset_id: str = "conveyor_1") -> dict[str, Any]:
        if not self._asset_matches(asset_id):
            return self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"])
        return self._ok(asset=deepcopy(ASSET), tags=deepcopy(TAGS), tag_count=len(TAGS))

    def get_tag_context(self, tag_id: str) -> dict[str, Any]:
        tag = self._find_tag(tag_id)
        if tag is None:
            return self._not_found("tag", f"No approved tag matched '{tag_id}'.", ["missing_tag"])
        return self._ok(asset=deepcopy(ASSET), tag=tag, related_documents=self._evidence_for_tag(tag["tag_id"]))

    def search_evidence(
        self,
        asset_id_or_query: str,
        query: str | None = None,
        include_draft: bool = False,
    ) -> dict[str, Any]:
        if query is None:
            asset_id = "conveyor_1"
            query_text = asset_id_or_query
        else:
            asset_id = asset_id_or_query
            query_text = query
        if not self._asset_matches(asset_id):
            return {
                **self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"]),
                "evidence": [],
            }
        query_l = query_text.lower().strip()
        docs = deepcopy(EVIDENCE if include_draft else self._approved_evidence())
        matches = [
            doc
            for doc in docs
            if query_l in json.dumps(doc, sort_keys=True).lower()
            or any(part and part in json.dumps(doc, sort_keys=True).lower() for part in query_l.split())
        ]
        if not matches:
            return {
                **self._not_found(
                    "evidence",
                    f"No approved evidence matched '{query_text}'.",
                    ["missing_approved_evidence"],
                ),
                "evidence": [],
            }
        return self._ok(asset=deepcopy(ASSET), evidence=matches, evidence_count=len(matches))

    def list_related_assets(self, asset_id: str = "conveyor_1") -> dict[str, Any]:
        if not self._asset_matches(asset_id):
            return self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"])
        return self._ok(asset=deepcopy(ASSET), related_assets=deepcopy(RELATED_ASSETS))

    def get_diagnostic_context(self, asset_id: str = "conveyor_1", question: str = "") -> dict[str, Any]:
        if question == "" and not self._asset_matches(asset_id):
            question = asset_id
            asset_id = "conveyor_1"
        if not self._asset_matches(asset_id):
            return {
                **self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"]),
                "diagnostics": [],
            }
        question_l = question.lower()
        diagnostics = deepcopy(DIAGNOSTICS)
        if "photoeye" in question_l or "photo eye" in question_l or "blocked" in question_l:
            diagnostics = [d for d in diagnostics if d["diagnostic_id"] == "conveyor:photoeye_blocked"]
        elif "not running" in question_l or "stopped" in question_l or "drive" in question_l:
            diagnostics = [d for d in diagnostics if d["diagnostic_id"] == "conveyor:not_running"]
        return self._ok(
            asset=deepcopy(ASSET),
            diagnostics=diagnostics,
            related_documents=self._approved_evidence(),
        )

    def get_live_value(self, tag_id: str) -> dict[str, Any]:
        tag = self._find_tag(tag_id)
        if tag is None:
            return self._not_found("tag", f"No approved tag matched '{tag_id}'.", ["missing_tag"])
        value = self.live_values.get(tag["tag_id"]) or self.live_values.get(tag["source_tag_path"])
        if value is None:
            return {
                **self._ok(asset=deepcopy(ASSET), tag=tag, live_value=None),
                "status": "not_available",
                "warnings": ["live_value_missing"],
            }
        return self._ok(asset=deepcopy(ASSET), tag=tag, live_value=self._normalize_live_value(value))

    def get_conveyor_status(self, asset_id: str = "conveyor_1") -> dict[str, Any]:
        if not self._asset_matches(asset_id):
            return self._not_found("asset", f"No approved asset matched '{asset_id}'.", ["missing_asset"])
        running = self._value_or_none("default_conveyor_motor_running")
        estop = self._value_or_none("default_conveyor_estop_active")
        fault = self._value_or_none("default_conveyor_fault_alarm")
        hz = self._value_or_none("default_mira_iocheck_vfd_vfd_frequency")
        state = {
            "running": running,
            "estop_active": estop,
            "fault_alarm": fault,
            "vfd_hz": hz,
        }
        warnings = ["live_value_missing"] if all(v is None for v in state.values()) else []
        status_tag_ids = [
            "default_conveyor_motor_running",
            "default_conveyor_estop_active",
            "default_conveyor_fault_alarm",
            "default_mira_iocheck_vfd_vfd_frequency",
        ]
        return {
            **self._ok(
                asset=deepcopy(ASSET),
                state=state,
                tags=[tag for tag in (self._find_tag(t) for t in status_tag_ids) if tag],
                related_documents=self._approved_evidence(),
            ),
            "warnings": warnings,
        }

    def _ok(self, **payload: Any) -> dict[str, Any]:
        return {
            "status": "ok",
            "asset": payload.pop("asset", deepcopy(ASSET)),
            "asset_id": ASSET["asset_id"],
            "asset_name": ASSET["name"],
            "uns_path": ASSET["uns_path"],
            "approval_status": "verified",
            "confidence": 0.92,
            "warnings": [],
            **payload,
        }

    @staticmethod
    def _not_found(kind: str, message: str, warnings: list[str]) -> dict[str, Any]:
        return {
            "status": "not_found",
            "asset": None if kind == "asset" else deepcopy(ASSET),
            "asset_id": ASSET["asset_id"],
            "asset_name": ASSET["name"],
            "uns_path": ASSET["uns_path"],
            "tag": None,
            "approval_status": "verified",
            "confidence": 0.0,
            "warnings": warnings,
            "message": message,
        }

    @staticmethod
    def _load_env_live_values() -> dict[str, dict[str, Any]]:
        raw = os.environ.get("FACTORYLM_LIVE_VALUES_JSON", "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _asset_matches(asset_id: str) -> bool:
        value = (asset_id or "").lower().strip()
        return value in {"", "conveyor", "conveyor_1", ASSET["uns_path"].lower()}

    @staticmethod
    def _approved_evidence() -> list[dict[str, Any]]:
        return [deepcopy(doc) for doc in EVIDENCE if doc["approval_status"] == "verified"]

    @staticmethod
    def _find_tag(tag_id: str) -> dict[str, Any] | None:
        needle = tag_id.lower().strip()
        for tag in TAGS:
            if needle in {
                tag["tag_id"].lower(),
                tag["name"].lower(),
                tag["source_tag_path"].lower(),
            }:
                return deepcopy(tag)
        return None

    def _evidence_for_tag(self, tag_id: str) -> list[dict[str, Any]]:
        return [
            doc
            for doc in self._approved_evidence()
            if tag_id in doc.get("related_tags", []) or not doc.get("related_tags")
        ]

    @staticmethod
    def _normalize_live_value(value: dict[str, Any]) -> dict[str, Any]:
        return {
            "value": value.get("value"),
            "quality": value.get("quality", "unknown"),
            "freshness_status": value.get("freshness_status", "unknown"),
            "last_seen_at": value.get("last_seen_at"),
            "source": "approved_read_only_live_path",
        }

    def _value_or_none(self, tag_id: str) -> Any:
        value = self.live_values.get(tag_id)
        if value is None:
            return None
        return value.get("value")
