# MIRA FactoryLM — Apache 2.0
"""seed_device_kb.py — Seeds facility-specific and device-specific KB collections.

Indexes repo docs (IO table, Modbus map, VFD params, wiring guide) into
device-specific collections in Open WebUI. Also seeds curated fault tables
for common industrial equipment.

Run with:
    doppler run --project factorylm --config prd -- python seed_device_kb.py
"""

import os
import io
import requests

OPENWEBUI_BASE_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://localhost:3000")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")

HEADERS = {"Authorization": f"Bearer {OPENWEBUI_API_KEY}"} if OPENWEBUI_API_KEY else {}

# Repo root relative to this script (mira-bots/scripts/ -> repo root)
REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def get_or_create_collection(name: str, description: str) -> str:
    """Return collection ID, creating if needed."""
    resp = requests.get(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/",
        headers=HEADERS,
        timeout=15,
    )
    resp.raise_for_status()
    for col in resp.json().get("items", []):
        if col.get("name") == name:
            print(f"Found existing collection '{name}': {col['id']}")
            return col["id"]

    resp = requests.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/knowledge/create",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"name": name, "description": description},
        timeout=15,
    )
    resp.raise_for_status()
    col_id = resp.json()["id"]
    print(f"Created collection '{name}': {col_id}")
    return col_id


def upload_text(collection_id: str, filename: str, content: str):
    """Upload text document to collection."""
    resp = requests.post(
        f"{OPENWEBUI_BASE_URL}/api/v1/files/",
        headers=HEADERS,
        files={"file": (filename, io.BytesIO(content.encode("utf-8")), "text/plain")},
        timeout=60,
    )
    resp.raise_for_status()
    file_id = resp.json()["id"]
    print(f"  Uploaded: {filename} -> {file_id}")

    resp = requests.post(
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


def upload_file_from_repo(collection_id: str, rel_path: str):
    """Upload a file from the repo root to a collection."""
    filepath = os.path.join(REPO_ROOT, rel_path)
    if not os.path.exists(filepath):
        print(f"  SKIP (not found): {rel_path}")
        return
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    filename = os.path.basename(rel_path)
    upload_text(collection_id, filename, content)


# ---------------------------------------------------------------------------
# Facility-specific collection (conveyor demo system)
# ---------------------------------------------------------------------------
def seed_facility_collection():
    """Index repo docs for the conveyor demo system."""
    print("\n=== Facility: Conveyor Demo System ===")
    col_id = get_or_create_collection(
        "Facility: Conveyor Demo System",
        "I/O table, Modbus register map, VFD parameters, and wiring guide "
        "for the Micro820 + GS10 conveyor demo system.",
    )

    facility_docs = [
        "IO_Table.md",
        "Modbus_Register_Map.md",
        "VFD_Parameters.md",
        "gist-master-wiring-guide.md",
        "Ignition_Tags.md",
        "plc/Micro820_v3_Program.st",
        "plc/CCW_VARIABLES_v3.txt",
    ]
    for doc in facility_docs:
        upload_file_from_repo(col_id, doc)

    return col_id


# ---------------------------------------------------------------------------
# Device-specific fault tables (curated from public documentation)
# ---------------------------------------------------------------------------
def seed_micro820_faults():
    """Seed Allen-Bradley Micro820 error/fault codes."""
    print("\n=== Micro820 PLC Faults ===")
    col_id = get_or_create_collection(
        "Micro820 PLC",
        "Allen-Bradley Micro820 error codes, LED patterns, and troubleshooting.",
    )

    content = """# Allen-Bradley Micro820 — Error Codes & LED Patterns

## Controller LED Indicators

### RUN LED (green)
- Solid green: Controller in RUN mode
- Flashing green: Controller in PROGRAM mode
- Off: Controller not powered or in FAULT

### FAULT LED (red)
- Solid red: Major fault — controller halted
- Flashing red: Minor/recoverable fault
- Off: No fault

### COMM LED (green)
- Solid green: Ethernet connected, link active
- Flashing green: Data traffic
- Off: No Ethernet link

## Common Error Codes

### Major Faults (controller stops)
| Code | Description | Action |
|------|-------------|--------|
| Type 1 | Power-up fault | Check 24VDC supply, cycle power |
| Type 3 | I/O fault | Check I/O wiring, module seated properly |
| Type 6 | Watchdog fault | Program scan time exceeded — simplify logic or increase watchdog timer |
| Type 8 | Memory fault | Project corrupted — re-download from CCW |

### Minor Faults (controller continues)
| Code | Description | Action |
|------|-------------|--------|
| Type 10 | Battery low | Replace CR2032 backup battery |
| Type 14 | Comm timeout | Check Ethernet cable, verify IP configuration |

## Troubleshooting Connectivity

### Cannot discover PLC on network
1. Verify 24VDC power (PWR LED solid green)
2. Check Ethernet cable (COMM LED should be solid/flashing green)
3. Use RSLinx Lite → EtherNet/IP driver → browse network
4. If not found: set IP manually via BOOTP/DHCP or USB connection in CCW

### Cannot download program
1. Key switch must be in REM (remote) position
2. Controller must be in PROGRAM mode (toggle in CCW)
3. Firmware version in CCW must match controller firmware
4. Check project is not read-only

## Serial Port (Modbus RTU Master)
- 1 RS-485 port, 3-pin terminal block (TXD+, TXD-, COM)
- Configure in CCW: Protocol = Modbus RTU Master
- Max 9600 baud for GS10 VFD communication
- Always power cycle PLC after changing serial port settings

## Factory Reset
1. In CCW: Online → Controller Properties → Restore Default Program
2. This erases user program — must re-download
"""
    upload_text(col_id, "Micro820_Error_Reference.txt", content)
    return col_id


def seed_motor_failure_guide():
    """Seed common motor failure modes and nameplate reading."""
    print("\n=== Motor Failure Guide ===")
    col_id = get_or_create_collection(
        "Motor Diagnostics",
        "Motor failure modes, nameplate reading, bearing failure identification.",
    )

    content = """# Common Motor Failure Modes & Diagnostics

## NEMA Motor Nameplate — How to Read

Every motor has a nameplate with critical specs. Key fields:

| Field | Meaning | Example |
|-------|---------|---------|
| HP / kW | Rated power output | 5 HP / 3.7 kW |
| V / Volts | Rated voltage | 208-230/460V |
| A / FLA | Full load amps at rated voltage | 14.0/7.0A |
| Hz | Rated frequency | 60 Hz |
| RPM | Full load speed | 1750 RPM |
| SF | Service factor (allowable overload) | 1.15 |
| NEMA Frame | Physical mounting dimensions | 184T |
| Enclosure | Environmental protection | TEFC (Totally Enclosed Fan Cooled) |
| Insulation Class | Max winding temperature | Class F (155°C) |
| Duty | Continuous or intermittent | CONT |

### Key Relationships
- Slip = Synchronous RPM - Nameplate RPM (e.g., 1800 - 1750 = 50 RPM slip)
- Synchronous RPM = 120 × Hz / Poles (1800 RPM = 4-pole at 60 Hz)
- If measured amps > FLA × SF: motor is overloaded

## Common Failure Modes

### 1. Overload / Overcurrent (OL)
- Symptom: Motor trips OL relay, high current measured
- Causes: Excessive load, jammed conveyor, worn bearings, low voltage
- Check: Measure current with clamp meter. Compare to nameplate FLA.
- If current > FLA × 1.15 (service factor): reduce load or upsize motor.

### 2. Single Phasing
- Symptom: Motor hums but won't start, or runs hot on 2 phases
- Causes: Blown fuse on one phase, loose connection, broken contactor finger
- Check: Measure voltage on all 3 phases at motor terminals. All should be within 2%.

### 3. Bearing Failure
- Symptom: Grinding noise, vibration, shaft wobble, hot bearing housing
- Stages:
  1. Slight increase in noise — replace bearings at next PM
  2. Audible grinding — schedule replacement within 1 week
  3. Shaft seizure imminent — stop motor immediately
- Check: Listen with stethoscope on bearing housing. Feel for heat.
  Spin shaft by hand with power off — should be smooth, no rough spots.

### 4. Winding Failure (Insulation Breakdown)
- Symptom: Ground fault trip, phase-to-phase short, burnt smell
- Causes: Age, overheating, moisture, contamination, voltage spikes
- Check: Megger test (insulation resistance). >1 MΩ is minimum acceptable.
  Phase-to-phase resistance should be balanced within 5%.

### 5. Misalignment
- Symptom: Vibration, premature bearing/coupling failure, noise
- Causes: Poor installation, thermal growth, foundation shift
- Check: Dial indicator or laser alignment tool. Angular and offset alignment.

### 6. Overheating
- Symptom: Motor too hot to touch (>80°C surface), insulation smell
- Causes: Overload, poor ventilation, high ambient, dirty motor
- Check: IR thermometer on frame. Clean cooling fins. Verify airflow around TEFC fan.

## Quick Diagnostic Checklist
1. Is the motor getting power? (Check voltage at terminals)
2. Is it getting the RIGHT power? (All 3 phases balanced, correct voltage)
3. Is the load reasonable? (Current at or below FLA?)
4. Are the bearings OK? (Listen, feel, spin by hand)
5. Is it running hot? (IR thermometer on frame)
"""
    upload_text(col_id, "Motor_Failure_Guide.txt", content)

    bearing_content = """# Bearing Failure Identification Guide

## Bearing Types in Industrial Motors
- Deep groove ball bearings (most common in small-medium motors)
- Cylindrical roller bearings (heavy radial loads)
- Angular contact bearings (combined radial + axial loads)

## Failure Stages (ISO 15243 Classification)

### Stage 1: Subsurface Fatigue
- Not audible yet
- Detectable: vibration analysis shows spike at bearing frequencies (BPFO, BPFI)
- Action: Plan replacement at next scheduled PM window

### Stage 2: Surface Damage
- Audible: slight increase in noise, intermittent
- Detectable: raised vibration levels, temperature slight increase
- Action: Order parts, schedule replacement within 2 weeks

### Stage 3: Visible Wear
- Audible: continuous grinding or rumble
- Detectable: shaft play detectable by hand, elevated temperature
- Action: Replace within 1 week. Monitor closely.

### Stage 4: Catastrophic
- Audible: loud grinding, metal-on-metal
- Detectable: shaft wobble, extreme heat, possible smoke
- Action: STOP MOTOR IMMEDIATELY. Risk of shaft seizure and winding damage.

## Common Causes of Premature Bearing Failure
| Cause | Signs | Prevention |
|-------|-------|------------|
| Over-greasing | Grease pushed past seals, heat | Follow manufacturer grease quantity spec |
| Under-greasing | Dry/rough bearing, rust | Schedule regular re-lubrication |
| Misalignment | Wear pattern on one side only | Laser-align motor to driven load |
| Overload | Fatigue flaking, spalling | Size motor correctly for application |
| Contamination | Pitting, corrosion, abrasive wear | Replace seals, keep area clean |
| Electrical fluting | Parallel grooves on race | Install shaft grounding ring or insulated bearing |

## Inspection Method
1. STOP and LOCK OUT motor
2. Remove coupling guard
3. Try to rock shaft side-to-side — should have zero radial play
4. Rotate shaft slowly by hand — should be smooth with no rough spots
5. If equipped with grease fittings: check grease condition (should be clean, not black/gritty)
6. Use IR thermometer on bearing housing during operation: should be <80°C
"""
    upload_text(col_id, "Bearing_Failure_Guide.txt", bearing_content)
    return col_id


def seed_additional_vfd_faults():
    """Seed fault tables for additional VFD brands."""
    print("\n=== Additional VFD Fault Tables ===")
    col_id = get_or_create_collection(
        "VFD Fault Reference",
        "Fault code tables for GS10, GS20, PowerFlex, and other common VFDs.",
    )

    gs20_content = """# AutomationDirect GS20 VFD — Fault Code Reference

## Common Fault Codes

| Code | Name | Description | Likely Cause | First Steps |
|------|------|-------------|-------------|-------------|
| oc | Overcurrent | Output current exceeded 200% of rated | Load jam, short circuit, accel too fast | Check motor wiring, reduce load, increase accel time |
| ov | Overvoltage | DC bus >410V (230V) or >820V (460V) | Fast decel, regeneration | Increase decel time, add braking resistor |
| uv | Undervoltage | DC bus below minimum | Power supply dip, loose connection | Check input voltage, tighten connections |
| oH1 | Drive Overheat | IGBT temperature too high | Blocked airflow, high ambient | Clean heatsink, check fan, reduce ambient |
| oH2 | External Overheat | External thermistor input tripped | Motor or enclosure overheating | Check motor ventilation, reduce load |
| oL1 | Motor Overload | Electronic thermal overload tripped | Sustained overcurrent | Reduce load, check motor FLA settings |
| oL2 | Drive Overload | Drive overloaded | Current exceeds drive rating | Upsize drive or reduce load |
| GF | Ground Fault | Leakage current to ground detected | Motor cable or winding insulation failure | Megger test motor, inspect cable |
| CF1 | IGBT Fault | Power module fault | Drive internal failure | Power cycle. If persists: replace drive |
| EF | External Fault | External fault input triggered | External interlock tripped | Check wiring on external fault terminal |
| cF2 | Current Detect Error | Current sensor fault | Drive internal | Power cycle. If persists: replace drive |
| oS | Overspeed | Motor speed exceeded 120% of max frequency | Regeneration, load driving motor | Add braking resistor |

## Reset Methods
1. Press STOP/RESET on keypad
2. Cycle power (wait 5 seconds)
3. Digital input configured as fault reset
4. Modbus command: write 0x0007 to command register
"""
    upload_text(col_id, "GS20_VFD_Fault_Reference.txt", gs20_content)

    powerflex_content = """# Allen-Bradley PowerFlex 525 — Fault Code Reference

## Common Fault Codes

| Code | Name | Description | First Steps |
|------|------|-------------|-------------|
| F002 | Aux Input | Auxiliary input fault | Check external fault input wiring |
| F004 | Undervoltage | DC bus undervoltage | Check input power supply |
| F005 | Overvoltage | DC bus overvoltage | Increase decel time, add brake resistor |
| F006 | Motor Stall | Motor cannot rotate | Check mechanical load, reduce accel torque boost |
| F007 | Motor Overload | Electronic OL tripped | Reduce load, verify motor data parameters |
| F012 | HW Overcurrent | Instantaneous overcurrent | Check motor wiring for short, reduce load |
| F013 | Ground Fault | Phase-to-ground leakage | Megger motor, check cable insulation |
| F029 | Analog Input Loss | 4-20mA signal lost | Check analog wiring, verify transmitter |
| F033 | Auto Restart Tries | Max restart attempts exceeded | Investigate root cause of repeated faults |
| F040 | Drive Overtemp | Heatsink too hot | Clean heatsink, check fan, verify ambient temp |
| F041 | Heatsink Sensor | Temp sensor fault | Drive needs service/replacement |
| F042 | Motor Overtemp | Motor PTC/thermistor tripped | Check motor ventilation, reduce load |
| F064 | Software Overcurrent | Current exceeded 300% of drive rated | Reduce load, check for phase loss |
| F070 | Power Loss | Input power interrupted | Check incoming power, breaker, fuses |
| F100 | Parameter Checksum | Parameter memory corrupted | Reload parameters from backup or factory reset |
| F122 | I/O Board Fault | I/O board communication error | Power cycle. If persists: replace I/O board |

## Reset Methods
1. Press Stop button on HIM (front panel)
2. Cycle power
3. Digital input configured as fault clear (P361)
4. Parameter P042 = 1 to clear fault queue
5. EtherNet/IP: write to fault clear attribute
"""
    upload_text(col_id, "PowerFlex525_Fault_Reference.txt", powerflex_content)
    return col_id


def seed_electrical_safety():
    """Seed basic electrical safety and troubleshooting reference."""
    print("\n=== Electrical Safety & Troubleshooting ===")
    col_id = get_or_create_collection(
        "Electrical Safety",
        "LOTO procedures, multimeter usage, and common electrical fault types.",
    )

    content = """# Electrical Safety & Troubleshooting Reference

## LOTO (Lockout/Tagout) — Summary of NFPA 70E Requirements

### Before ANY electrical work:
1. IDENTIFY all energy sources (electrical, pneumatic, hydraulic, mechanical)
2. NOTIFY all affected personnel
3. SHUT DOWN equipment using normal stop procedure
4. ISOLATE energy sources (open disconnects, close valves)
5. LOCK OUT each isolation device with personal lock
6. TAG each lock with name, date, reason
7. VERIFY zero energy state:
   - Test voltage with CAT III/IV rated meter
   - Try to start equipment (should not start)
   - Bleed stored energy (capacitors, springs, pressure)

### After work is complete:
1. Remove tools and materials
2. Replace all guards and covers
3. Verify all personnel are clear
4. Remove locks and tags (only the person who placed them)
5. Restore energy and test

## Multimeter Usage for Industrial Troubleshooting

### Safety: Use CAT III (600V) or CAT IV (1000V) rated meter
- CAT III: Distribution-level circuits (motor control centers, panels)
- CAT IV: Origin of installation (service entrance, utility)

### Common Measurements

| Measurement | Setting | How | Expected |
|------------|---------|-----|----------|
| AC Voltage | V~ | Probe L1-L2, L2-L3, L3-L1 | Within 2% of each other |
| DC Voltage | V= | Probe + to - | 24VDC control: 22-26V |
| Resistance | Ω | POWER OFF. Probe across component | Per component spec |
| Continuity | 🔊 | POWER OFF. Probe wire end-to-end | Beep = continuous path |
| Current (clamp) | A~ | Clamp around ONE conductor | Compare to nameplate FLA |

### Troubleshooting by Symptom

| Symptom | Check | Common Cause |
|---------|-------|-------------|
| Motor won't start | Voltage at contactor output | Blown fuse, tripped breaker, bad contactor |
| Motor hums, won't run | All 3 phase voltages | Single phasing (lost 1 phase) |
| Motor runs hot | Clamp amps on each phase | Overload, voltage imbalance, worn bearings |
| Control circuit dead | 24VDC at power supply output | Tripped breaker, bad power supply, blown fuse |
| PLC output not energizing | Voltage at PLC output terminal | PLC in fault, output fuse blown, wiring loose |
| Sensor not reading | DC voltage at sensor | Wiring broken, sensor failed, wrong polarity |

## Common Electrical Fault Types

### Short Circuit
- Very high current, immediate breaker trip
- Causes: Damaged insulation, pinched wire, metal debris
- Test: Megger insulation resistance between phases and to ground

### Ground Fault
- Current leaking from conductor to ground/enclosure
- Causes: Moisture, damaged insulation, conductive contamination
- Test: Megger motor windings to frame. Should be >1 MΩ.

### Open Circuit
- No current flow, device doesn't operate
- Causes: Broken wire, loose terminal, blown fuse, corroded contact
- Test: Continuity check with meter (POWER OFF)

### Voltage Imbalance
- One phase higher/lower than others
- Causes: Utility issue, uneven loading, bad transformer tap
- Effect: Motor current increases, runs hot, shortened life
- Test: Measure L1-L2, L2-L3, L3-L1. Max difference should be <2%
"""
    upload_text(col_id, "Electrical_Safety_Reference.txt", content)
    return col_id


def main():
    print(f"MIRA Device KB Seeder — target: {OPENWEBUI_BASE_URL}")

    seed_facility_collection()
    seed_micro820_faults()
    seed_motor_failure_guide()
    seed_additional_vfd_faults()
    seed_electrical_safety()

    print("\nDone. All device collections seeded.")
    print("Assign relevant collections to mira:latest in Open WebUI > Settings > Models.")


if __name__ == "__main__":
    main()
