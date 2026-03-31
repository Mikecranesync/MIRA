"""seed_kb.py — Seeds MIRA KB with industrial maintenance content via Open WebUI API.

Run with:
    doppler run --project factorylm --config prd -- python seed_kb.py
"""

import io
import os

import httpx

_MIRA_SERVER = os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost")
OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", f"{_MIRA_SERVER}:3000")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")

HEADERS = {"Authorization": f"Bearer {OPENWEBUI_API_KEY}"} if OPENWEBUI_API_KEY else {}

WIKIPEDIA_TOPICS = [
    "Variable-frequency drive",
    "Electric motor",
    "Conveyor belt",
    "Programmable logic controller",
    "Industrial safety",
    "Predictive maintenance",
    "Overcurrent protection",
    "Motor soft starter",
]

COLLECTION_NAME = "MIRA Industrial KB"


def get_or_create_collection() -> str:
    """Return the knowledge collection ID, creating it if it doesn't exist."""
    resp = httpx.get(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/",
        headers=HEADERS,
        timeout=15,
    )
    resp.raise_for_status()
    for col in resp.json().get("items", []):
        if col.get("name") == COLLECTION_NAME:
            print(f"Found existing collection: {col['id']}")
            return col["id"]

    resp = httpx.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/create",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"name": COLLECTION_NAME, "description": "Industrial maintenance reference — VFDs, motors, PLCs, conveyors"},
        timeout=15,
    )
    resp.raise_for_status()
    col_id = resp.json()["id"]
    print(f"Created collection: {col_id}")
    return col_id


def upload_text_to_collection(collection_id: str, filename: str, content: str):
    """Upload a text document to the knowledge collection."""
    # Step 1: upload file
    file_bytes = content.encode("utf-8")
    resp = httpx.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/files/",
        headers=HEADERS,
        files={"file": (filename, io.BytesIO(file_bytes), "text/plain")},
        timeout=60,
    )
    resp.raise_for_status()
    file_id = resp.json()["id"]
    print(f"  Uploaded file: {filename} → {file_id}")

    # Step 2: add file to collection
    resp = httpx.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/{collection_id}/file/add",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"file_id": file_id},
        timeout=60,
    )
    if resp.status_code == 400 and "Duplicate" in resp.text:
        print(f"  Skipped (duplicate): {filename}")
        return
    resp.raise_for_status()
    print(f"  Added to collection: {filename}")


def fetch_wikipedia(topic: str) -> str:
    """Fetch a Wikipedia article summary + content via the REST API."""
    slug = topic.replace(" ", "_")
    resp = httpx.get(
        f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
        headers={"User-Agent": "MIRA-KB-Seeder/1.0 (factorylm industrial maintenance bot; contact@factorylm.com)"},
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"  WARNING: Wikipedia fetch failed for '{topic}': {resp.status_code}")
        return ""

    data = resp.json()
    title = data.get("title", topic)
    extract = data.get("extract", "")
    return f"# {title}\n\n{extract}\n"


def seed_wikipedia(collection_id: str):
    print("\n--- Seeding Wikipedia articles ---")
    for topic in WIKIPEDIA_TOPICS:
        print(f"Fetching: {topic}")
        content = fetch_wikipedia(topic)
        if not content:
            continue
        filename = topic.replace(" ", "_").replace("/", "-") + ".txt"
        upload_text_to_collection(collection_id, filename, content)


def seed_gs10_fault_guide(collection_id: str):
    """Seed a curated GS10 VFD fault code reference (from public documentation)."""
    print("\n--- Seeding GS10 VFD fault reference ---")
    content = """# AutomationDirect GS10 VFD — Fault Code Reference

## Overview
The GS10 is a general-purpose AC drive from AutomationDirect.
Faults cause the drive to stop and display a code on the keypad.

## Common Fault Codes

### OC (Overcurrent)
- Cause: Motor current exceeded drive rating. Load too heavy, acceleration too fast, or output short circuit.
- Clear: Remove fault via RESET key or digital input. Check motor wiring, reduce load, increase accel time.

### OV (Overvoltage)
- Cause: DC bus voltage exceeded limit. Usually caused by regenerative energy during fast deceleration.
- Clear: Increase decel time. Add braking resistor if needed.

### UV (Undervoltage)
- Cause: Input AC voltage dropped below minimum. Power supply issue.
- Clear: Check input voltage. Drive auto-recovers when voltage returns.

### OH (Overheat)
- Cause: Drive heatsink temperature too high. Ambient too hot or blocked ventilation.
- Clear: Check airflow, reduce ambient temperature, verify fan operation.

### GF (Ground Fault)
- Cause: Current leakage detected from output to ground.
- Clear: Inspect motor cable insulation. Check motor windings for ground fault.

### OL (Overload)
- Cause: Drive or motor thermal model exceeded.
- Clear: Reduce load, increase decel ramp, verify motor FLA matches drive settings.

### EF (External Fault)
- Cause: Digital input configured as external fault triggered.
- Clear: Check wiring on EF input terminal. Verify external fault source.

## Parameter Reset
To restore factory defaults: Set parameter P9.08 = 1.
Note: This resets ALL parameters including motor data.

## Modbus Register Map (standard GS10)
- HR100: Output frequency (×0.01 Hz)
- HR101: Output current (×0.1 A)
- HR102: Drive temperature (°C)
- Coil 0: Run forward
- Coil 1: Stop
- Coil 2: Fault reset
"""
    upload_text_to_collection(collection_id, "GS10_VFD_Fault_Reference.txt", content)


def seed_modbus_reference(collection_id: str):
    """Seed a Modbus TCP/RTU reference for PLC diagnostics."""
    print("\n--- Seeding Modbus reference ---")
    content = """# Modbus Protocol — Industrial Diagnostic Reference

## Overview
Modbus is a serial communication protocol used between industrial devices.
Versions: Modbus RTU (RS-485), Modbus TCP (Ethernet).

## Function Codes
- FC01: Read Coils (digital outputs)
- FC02: Read Discrete Inputs (digital inputs)
- FC03: Read Holding Registers (analog/config values)
- FC04: Read Input Registers (analog measurements)
- FC05: Write Single Coil
- FC06: Write Single Holding Register
- FC16: Write Multiple Holding Registers

## Common Fault Diagnosis via Modbus
When a device stops responding over Modbus:
1. Verify physical connection (cable, termination resistor on RS-485)
2. Check device address (slave ID) matches configuration
3. Verify baud rate, parity, stop bits match
4. Check exception code in error response:
   - 01: Illegal function
   - 02: Illegal data address
   - 03: Illegal data value
   - 04: Slave device failure

## MIRA Cluster Modbus Map (Micro820 PLC)
- Host: 192.168.1.100, Port: 502
- HR100: Motor speed setpoint (RPM)
- HR101: Motor current (×0.1 A)
- HR102: Motor temperature (°C)
- Coil 0: Motor run command
- Coil 1: Motor stop command
- Coil 2: Fault reset

## Troubleshooting Steps
1. Ping device: confirms network connectivity
2. Read HR100 with any Modbus client: confirms protocol response
3. If exception 04: check device fault indicators (LEDs, display)
4. If timeout: check cabling, termination, device power
"""
    upload_text_to_collection(collection_id, "Modbus_Protocol_Reference.txt", content)


def main():
    print(f"MIRA KB Seeder — target: {OPENWEBUI_BASE_URL}")
    collection_id = get_or_create_collection()
    seed_wikipedia(collection_id)
    seed_gs10_fault_guide(collection_id)
    seed_modbus_reference(collection_id)
    print(f"\nDone. Collection '{COLLECTION_NAME}' seeded. ID: {collection_id}")
    print("Next step: assign this collection to mira:latest in Open WebUI > Settings > Models.")


if __name__ == "__main__":
    main()
