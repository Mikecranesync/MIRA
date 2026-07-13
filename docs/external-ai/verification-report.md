# FactoryLM External AI Verification Report

Generated: 2026-06-25 04:58:32 Eastern Daylight Time
Final status: **FAIL**

## How To Run

```powershell
python scripts/verify_factorylm_external_ai_stack.py
```

Optional full JSON:

```powershell
python scripts/verify_factorylm_external_ai_stack.py --json
```

## Services Required

- SDK proof: no external service.
- API proof: the script starts a local uvicorn server around the SDK API adapter.
- MCP proof: requires `fastmcp` in the active Python environment. Install with `python -m pip install -r mira-mcp/requirements.txt`.
- Live values: optional. Without a real approved live read path or `FACTORYLM_LIVE_VALUES_JSON`, live-value checks are reported as not available.

## Results

### SDK: PASS

- **PASS** `find_asset`

```json
{
  "approval_status": "verified",
  "input": {
    "query": "conveyor"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "matches": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "asset_type": "belt_conveyor",
        "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
        "name": "Conveyor 1",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **PASS** `get_asset_context`

```json
{
  "approval_status": "verified",
  "input": {
    "asset_id": "conveyor_1"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "related_assets": [
      {
        "approval_status": "verified",
        "asset_id": "gs10_vfd",
        "confidence": 0.97,
        "name": "GS10 VFD",
        "relationship": "DRIVES",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.gs10_vfd"
      },
      {
        "approval_status": "verified",
        "asset_id": "micro820_plc",
        "confidence": 0.99,
        "name": "Micro820 PLC",
        "relationship": "CONTROLS",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.micro820_plc"
      },
      {
        "approval_status": "verified",
        "asset_id": "photoeye_1",
        "confidence": 0.88,
        "name": "Photo Eye PE-001",
        "relationship": "SENSES_PRODUCT",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.photoeye_1"
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **PASS** `list_asset_tags`

```json
{
  "approval_status": "verified",
  "input": {
    "asset_id": "conveyor_1"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "status": "ok",
    "tag_count": 6,
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **PASS** `search_evidence`

```json
{
  "approval_status": "verified",
  "input": {
    "asset_id": "conveyor_1",
    "query": "VFD photoeye"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "evidence": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "evidence_count": 2,
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **PASS** `get_diagnostic_context`

```json
{
  "approval_status": "verified",
  "input": {
    "asset_id": "conveyor_1"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "diagnostics": [
      {
        "approval_status": "verified",
        "citation_ids": [
          "garage:gs10_overcurrent",
          "garage:micro820_io",
          "garage:gs10_modbus_params"
        ],
        "confidence": 0.86,
        "diagnostic_id": "conveyor:not_running",
        "fault": "Conveyor not running",
        "likely_causes": [
          "E-stop active or E-stop wiring fault",
          "Fault alarm active",
          "GS10 command source not set to RS-485",
          "Mechanical jam causing GS10 over-current"
        ],
        "next_checks": [
          "Check approved live values for E-stop, fault alarm, motor running, VFD frequency, and VFD current.",
          "If the machine must be opened or electrically inspected, stop and follow site LOTO before work.",
          "Inspect approved evidence for the GS10 over-current and Micro820 I/O mapping."
        ]
      },
      {
        "approval_status": "verified",
        "citation_ids": [
          "garage:micro820_io"
        ],
        "confidence": 0.82,
        "diagnostic_id": "conveyor:photoeye_blocked",
        "fault": "Photoeye blocked or occupied too long",
        "likely_causes": [
          "Object in PE-001 beam",
          "Sensor alignment issue",
          "Input DI-05 stuck or stale"
        ],
        "next_checks": [
          "Read the PE-001 live value and freshness.",
          "Compare photoeye state against conveyor running/fault state."
        ]
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **PASS** `get_live_value`

```json
{
  "approval_status": "verified",
  "input": {
    "tag_id": "default_conveyor_motor_running"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "live_value": null,
    "status": "not_available",
    "tag": {
      "approval_status": "verified",
      "component_id": "gs10_vfd",
      "data_type": "bool",
      "meaning": "True when the conveyor drive reports running.",
      "name": "Motor Running",
      "source_tag_path": "[default]Conveyor/Motor_Running",
      "tag_id": "default_conveyor_motor_running",
      "unit": null,
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": [
      "live_value_missing"
    ]
  },
  "warnings": [
    "live_value_missing"
  ]
}
```

- **PASS** `missing_asset`

```json
{
  "approval_status": "verified",
  "input": {
    "query": "not-a-real-asset"
  },
  "output": {
    "approval_status": "verified",
    "asset": null,
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.0,
    "message": "No approved asset matched 'not-a-real-asset'.",
    "status": "not_found",
    "tag": null,
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": [
      "missing_asset"
    ]
  },
  "warnings": [
    "missing_asset"
  ]
}
```

### API: PASS

- **PASS** `api_routes_read_only`

```json
{
  "routes": [
    "/health",
    "/api/external-ai/assets/search",
    "/api/external-ai/assets/{asset_id:str}/context",
    "/api/external-ai/assets/{asset_id:str}/tags",
    "/api/external-ai/tags/{tag_id:str}/context",
    "/api/external-ai/assets/{asset_id:str}/evidence",
    "/api/external-ai/assets/{asset_id:str}/diagnostics",
    "/api/external-ai/live/{tag_id:str}",
    "/api/external-ai/assets/{asset_id:str}/status"
  ],
  "unsafe": []
}
```

- **PASS** `asset_search`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {
      "q": "conveyor"
    },
    "path": "/api/external-ai/assets/search"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "matches": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "asset_type": "belt_conveyor",
        "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
        "name": "Conveyor 1",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `asset_context`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {},
    "path": "/api/external-ai/assets/conveyor_1/context"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "related_assets": [
      {
        "approval_status": "verified",
        "asset_id": "gs10_vfd",
        "confidence": 0.97,
        "name": "GS10 VFD",
        "relationship": "DRIVES",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.gs10_vfd"
      },
      {
        "approval_status": "verified",
        "asset_id": "micro820_plc",
        "confidence": 0.99,
        "name": "Micro820 PLC",
        "relationship": "CONTROLS",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.micro820_plc"
      },
      {
        "approval_status": "verified",
        "asset_id": "photoeye_1",
        "confidence": 0.88,
        "name": "Photo Eye PE-001",
        "relationship": "SENSES_PRODUCT",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.photoeye_1"
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `asset_tags`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {},
    "path": "/api/external-ai/assets/conveyor_1/tags"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "status": "ok",
    "tag_count": 6,
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `evidence_search`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {
      "q": "VFD"
    },
    "path": "/api/external-ai/assets/conveyor_1/evidence"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "evidence": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "evidence_count": 2,
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `diagnostic_context`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {},
    "path": "/api/external-ai/assets/conveyor_1/diagnostics"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "diagnostics": [
      {
        "approval_status": "verified",
        "citation_ids": [
          "garage:gs10_overcurrent",
          "garage:micro820_io",
          "garage:gs10_modbus_params"
        ],
        "confidence": 0.86,
        "diagnostic_id": "conveyor:not_running",
        "fault": "Conveyor not running",
        "likely_causes": [
          "E-stop active or E-stop wiring fault",
          "Fault alarm active",
          "GS10 command source not set to RS-485",
          "Mechanical jam causing GS10 over-current"
        ],
        "next_checks": [
          "Check approved live values for E-stop, fault alarm, motor running, VFD frequency, and VFD current.",
          "If the machine must be opened or electrically inspected, stop and follow site LOTO before work.",
          "Inspect approved evidence for the GS10 over-current and Micro820 I/O mapping."
        ]
      },
      {
        "approval_status": "verified",
        "citation_ids": [
          "garage:micro820_io"
        ],
        "confidence": 0.82,
        "diagnostic_id": "conveyor:photoeye_blocked",
        "fault": "Photoeye blocked or occupied too long",
        "likely_causes": [
          "Object in PE-001 beam",
          "Sensor alignment issue",
          "Input DI-05 stuck or stale"
        ],
        "next_checks": [
          "Read the PE-001 live value and freshness.",
          "Compare photoeye state against conveyor running/fault state."
        ]
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `live_value`

```json
{
  "http_status": 200,
  "input": {
    "method": "GET",
    "params": {},
    "path": "/api/external-ai/live/default_conveyor_motor_running"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "live_value": null,
    "status": "not_available",
    "tag": {
      "approval_status": "verified",
      "component_id": "gs10_vfd",
      "data_type": "bool",
      "meaning": "True when the conveyor drive reports running.",
      "name": "Motor Running",
      "source_tag_path": "[default]Conveyor/Motor_Running",
      "tag_id": "default_conveyor_motor_running",
      "unit": null,
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": [
      "live_value_missing"
    ]
  }
}
```

- **PASS** `missing_asset`

```json
{
  "http_status": 404,
  "input": {
    "method": "GET",
    "params": {
      "q": "not-a-real-asset"
    },
    "path": "/api/external-ai/assets/search"
  },
  "output": {
    "approval_status": "verified",
    "asset": null,
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.0,
    "message": "No approved asset matched 'not-a-real-asset'.",
    "status": "not_found",
    "tag": null,
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": [
      "missing_asset"
    ]
  }
}
```

- **PASS** `api_wraps_sdk_consistently`

```json
{
  "api_asset_id": "conveyor_1",
  "sdk_asset_id": "conveyor_1"
}
```

### MCP: FAIL

- **PASS** `mcp_metadata_tools_declared`

```json
{
  "tools": [
    "factorylm_find_asset",
    "factorylm_get_asset_context",
    "factorylm_get_conveyor_status",
    "factorylm_get_diagnostic_context",
    "factorylm_get_live_value",
    "factorylm_get_tag_context",
    "factorylm_list_asset_tags",
    "factorylm_list_related_assets",
    "factorylm_search_evidence"
  ]
}
```

- **PASS** `mcp_metadata_read_only`

```json
{
  "unsafe": []
}
```

- **PASS** `mcp_metadata_callable`

```json
{
  "approval_status": "verified",
  "input": {
    "query": "conveyor",
    "tool": "factorylm_find_asset"
  },
  "output": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "matches": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "asset_type": "belt_conveyor",
        "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
        "name": "Conveyor 1",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "warnings": []
}
```

- **FAIL** `mcp_server_runtime`

```json
{
  "error": "fastmcp is not installed in the active Python environment",
  "remediation": "python -m pip install -r mira-mcp/requirements.txt"
}
```

### End-to-end: PASS

- **PASS** `sample_conveyor_response_present`

```json
{
  "api": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "related_assets": [
      {
        "approval_status": "verified",
        "asset_id": "gs10_vfd",
        "confidence": 0.97,
        "name": "GS10 VFD",
        "relationship": "DRIVES",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.gs10_vfd"
      },
      {
        "approval_status": "verified",
        "asset_id": "micro820_plc",
        "confidence": 0.99,
        "name": "Micro820 PLC",
        "relationship": "CONTROLS",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.micro820_plc"
      },
      {
        "approval_status": "verified",
        "asset_id": "photoeye_1",
        "confidence": 0.88,
        "name": "Photo Eye PE-001",
        "relationship": "SENSES_PRODUCT",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.photoeye_1"
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "mcp": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "matches": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "asset_type": "belt_conveyor",
        "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
        "name": "Conveyor 1",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "status": "ok",
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  },
  "sdk": {
    "approval_status": "verified",
    "asset": {
      "approval_status": "verified",
      "asset_id": "conveyor_1",
      "asset_type": "belt_conveyor",
      "description": "Garage conveyor with Micro820 PLC, GS10 VFD, and Banner photoeye.",
      "name": "Conveyor 1",
      "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
    },
    "asset_id": "conveyor_1",
    "asset_name": "Conveyor 1",
    "confidence": 0.92,
    "related_assets": [
      {
        "approval_status": "verified",
        "asset_id": "gs10_vfd",
        "confidence": 0.97,
        "name": "GS10 VFD",
        "relationship": "DRIVES",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.gs10_vfd"
      },
      {
        "approval_status": "verified",
        "asset_id": "micro820_plc",
        "confidence": 0.99,
        "name": "Micro820 PLC",
        "relationship": "CONTROLS",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.micro820_plc"
      },
      {
        "approval_status": "verified",
        "asset_id": "photoeye_1",
        "confidence": 0.88,
        "name": "Photo Eye PE-001",
        "relationship": "SENSES_PRODUCT",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1.photoeye_1"
      }
    ],
    "related_documents": [
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_overcurrent",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_current"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_overcurrent.md",
        "summary": "GS10 oC over-current can be caused by accel time, mechanical jam, or shorted motor leads.",
        "title": "GS10 over-current fault guidance"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:micro820_io",
        "related_tags": [
          "default_conveyor_estop_active",
          "default_mira_iocheck_inputs_di_05",
          "default_conveyor_fault_alarm"
        ],
        "source_type": "wiring_note",
        "source_url": "golden://garage_conveyor/micro820_io.md",
        "summary": "Maps E-stop, run pushbutton, PE-001, run lamp, fault lamp, and contactor I/O.",
        "title": "Micro820 conveyor I/O map"
      },
      {
        "approval_status": "verified",
        "asset_id": "conveyor_1",
        "evidence_id": "garage:gs10_modbus_params",
        "related_tags": [
          "default_mira_iocheck_vfd_vfd_frequency"
        ],
        "source_type": "manual",
        "source_url": "golden://garage_conveyor/gs10_modbus_params.md",
        "summary": "GS10 P00.20 and P00.21 must be set to RS-485 for Modbus run/frequency commands.",
        "title": "GS10 Modbus command source parameters"
      }
    ],
    "status": "ok",
    "tags": [
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "bool",
        "meaning": "True when the conveyor drive reports running.",
        "name": "Motor Running",
        "source_tag_path": "[default]Conveyor/Motor_Running",
        "tag_id": "default_conveyor_motor_running",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor emergency stop input is active.",
        "name": "E-stop Active",
        "source_tag_path": "[default]Conveyor/EStop_Active",
        "tag_id": "default_conveyor_estop_active",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "micro820_plc",
        "data_type": "bool",
        "meaning": "True when the conveyor fault alarm is active.",
        "name": "Fault Alarm",
        "source_tag_path": "[default]Conveyor/Fault_Alarm",
        "tag_id": "default_conveyor_fault_alarm",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "photoeye_1",
        "data_type": "bool",
        "meaning": "Entry photoeye PE-001 input. True means beam/object detected.",
        "name": "Photoeye PE-001",
        "source_tag_path": "[default]MIRA_IOCheck/Inputs/DI_05",
        "tag_id": "default_mira_iocheck_inputs_di_05",
        "unit": null,
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output frequency in hertz.",
        "name": "VFD Frequency",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency",
        "tag_id": "default_mira_iocheck_vfd_vfd_frequency",
        "unit": "Hz",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      },
      {
        "approval_status": "verified",
        "component_id": "gs10_vfd",
        "data_type": "float",
        "meaning": "GS10 output current in amps.",
        "name": "VFD Current",
        "source_tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",
        "tag_id": "default_mira_iocheck_vfd_vfd_current",
        "unit": "A",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1"
      }
    ],
    "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
    "warnings": []
  }
}
```

- **PASS** `evidence_or_citations_present`

```json
{}
```

- **PASS** `safety_read_only`

```json
{
  "tools": [
    "factorylm_find_asset",
    "factorylm_get_asset_context",
    "factorylm_list_asset_tags",
    "factorylm_get_tag_context",
    "factorylm_search_evidence",
    "factorylm_list_related_assets",
    "factorylm_get_diagnostic_context",
    "factorylm_get_live_value",
    "factorylm_get_conveyor_status"
  ]
}
```

## Failed Checks

- mcp.mcp_server_runtime: {'error': 'fastmcp is not installed in the active Python environment', 'remediation': 'python -m pip install -r mira-mcp/requirements.txt'}

## Known Failures / Next Steps

- If MCP runtime fails because `fastmcp` is missing, install `mira-mcp/requirements.txt` and rerun.
- Replace env-injected demo live values with the approved `live_signal_cache` read path.
- Run the same harness after exposing the MCP server through HTTPS for ChatGPT connector testing.
