# MIRA Connect — Factory Floor Connector Design

**Date:** 2026-04-17
**Status:** Draft
**Author:** Mike Harper + Claude
**Solves:** MVP Problem 7 — "Brownfield factories aren't connected"
**Target:** 30-minute onboarding. Zero IT involvement. $97/mo included.

---

## 1. Problem

SMB manufacturers have PLCs, VFDs, and sensors on their factory floor, but no way to feed that live data into MIRA's diagnostic engine. Without live equipment context, MIRA can only diagnose from manual knowledge — not from what the machine is actually doing right now.

Competitors like Fuuz (19 edge drivers), MaintainX (Ignition module), and Tractian (IoT sensors) solve this for enterprise at $50K+/year. No solution exists for the $97/mo SMB customer.

## 2. Solution

MIRA Connect is a lightweight edge agent that auto-discovers factory equipment, streams live tag data to MIRA cloud, and presents everything through the existing Open WebUI chat interface. Setup is conversational — no dashboards, no config files, no IT department.

Two delivery paths:
- **Ignition module** (primary): for factories with Ignition SCADA — reads the existing tag database, zero driver work
- **Standalone agent** (fallback): for factories without Ignition — carries its own protocol drivers

Both paths converge to the same cloud relay and chat UX.

## 3. Architecture

```
Factory Floor                          MIRA Cloud (VPS)
─────────────                          ─────────────────
┌──────────┐                           ┌──────────────────┐
│ PLC      │◄─EtherNet/IP──┐          │ WebSocket Relay   │
│ (Micro820│               │          │ wss://connect.    │
│  Compact)│               │          │ factorylm.com     │
└──────────┘               │          └────────┬──────────┘
                           │                   │
┌──────────┐          ┌────▼──────┐            │
│ VFD      │◄─Modbus──│ MIRA      │──WSS──────►│
│ (GS20,   │  TCP     │ Connect   │ outbound   │
│  V1000)  │          │ Agent     │ (no FW     │
└──────────┘          │           │  change)   │
                      │ Discovers │            │
┌──────────┐          │ Connects  │       ┌────▼──────────┐
│ OPC UA   │◄─OPC UA──│ Streams   │       │ mira-bridge   │
│ Server/  │          │           │       │ (SQLite WAL)  │
│ Gateway  │          └───────────┘       └────┬──────────┘
                           │                   │
┌──────────┐               │              ┌────▼──────────┐
│ MQTT     │◄─MQTT─────────┘              │ mira-mcp      │
│ Broker   │                              │ equipment_    │
└──────────┘                              │ status table  │
                                          └────┬──────────┘
                                               │
                                          ┌────▼──────────┐
                                          │ mira-pipeline │
                                          │ GSD Engine +  │
                                          │ Open WebUI    │
                                          └───────────────┘
```

## 4. Components

### 4.1 MIRA Connect Agent (`mira-connect/`)

Lightweight Python service. Runs on any Windows/Linux/Mac/Pi computer on the plant network.

**Module structure:**
```
mira-connect/
├── main.py              # Entry point, activation flow, service loop
├── discovery/
│   ├── scanner.py       # Network scanner orchestrator
│   ├── opcua.py         # OPC UA FindServers + Browse
│   ├── modbus.py        # Modbus TCP port 502 scan + register probe
│   ├── ethernetip.py    # EtherNet/IP port 44818 ListIdentity
│   └── mqtt.py          # MQTT broker detection on 1883
├── drivers/
│   ├── base.py          # DriverProtocol — poll(), subscribe(), read_tag()
│   ├── opcua_driver.py  # asyncua client — subscribe to OPC UA nodes
│   ├── modbus_driver.py # pymodbus client — poll holding/input registers
│   ├── ethernetip_driver.py  # pycomm3 — read AB tags natively
│   └── mqtt_driver.py   # aiomqtt — subscribe to topics
├── fingerprint/
│   ├── identifier.py    # Match register patterns → equipment make/model
│   └── register_maps/   # YAML register maps (GS20, PowerFlex, V1000, etc.)
├── relay/
│   ├── websocket.py     # Outbound WSS to connect.factorylm.com
│   └── store_forward.py # SQLite buffer for offline resilience
├── config.py            # Activation code, tenant_id, connection state
├── Dockerfile           # For Docker-savvy customers
├── installer/
│   ├── windows.py       # PyInstaller + NSIS wrapper → MSI
│   └── linux.sh         # curl | sh one-liner
└── tests/
```

**Protocol libraries (all MIT/Apache):**

| Protocol | Library | License |
|----------|---------|---------|
| OPC UA | `asyncua` | LGPL-3.0 (client-only use is fine) |
| Modbus TCP | `pymodbus` | BSD-3 |
| EtherNet/IP | `pycomm3` | MIT |
| MQTT | `aiomqtt` | BSD-3 |

**Driver protocol (base.py):**
```python
class DriverProtocol:
    async def connect(self, config: ConnectionConfig) -> bool
    async def discover_tags(self) -> list[TagDescriptor]
    async def read_tags(self, tags: list[str]) -> dict[str, TagValue]
    async def subscribe(self, tags: list[str], callback: Callable) -> None
    async def disconnect(self) -> None
```

Every driver implements this interface. New protocols (Siemens S7, PROFINET bridge, BACnet) are added as new driver files with zero changes to existing code.

### 4.2 Device Fingerprinting (`fingerprint/`)

When a Modbus device is discovered, MIRA reads characteristic registers and matches against known equipment profiles:

```yaml
# register_maps/gs20.yaml
manufacturer: AutomationDirect
model_pattern: "GS20-*"
protocol: modbus_tcp
identification:
  - register: 0x2100
    type: holding
    description: "Command register — write 0x0001 for FWD"
  - register: 0x2103
    type: holding
    description: "Output frequency (x0.1 Hz)"
tags:
  - name: outputFrequency
    register: 0x2103
    type: holding
    scale: 0.1
    unit: Hz
    sm_field: outputFrequency
  - name: motorCurrent
    register: 0x2104
    type: holding
    scale: 0.1
    unit: A
    sm_field: motorCurrent
  - name: dcBusVoltage
    register: 0x2105
    type: holding
    scale: 1
    unit: V
    sm_field: dcBusVoltage
  - name: faultCode
    register: 0x210F
    type: holding
    scale: 1
    unit: ""
    sm_field: faultCode
sm_profile: ConveyorDrive
```

Ship with register maps for the 10 most common SMB VFDs:
1. AutomationDirect GS10/GS20
2. Allen-Bradley PowerFlex 525/523
3. Yaskawa V1000/GA500
4. Siemens G120/SINAMICS
5. ABB ACS310/ACS580
6. Danfoss FC302/FC102
7. Mitsubishi FR-E800/FR-D700
8. WEG CFW500
9. Eaton PowerXL
10. Fuji FRENIC-Ace

Unrecognized devices: MIRA presents raw register values and asks the user to identify them conversationally. User says "that's a Lenze i550" → MIRA learns the mapping and saves it for future customers (crowd-sourced register map growth).

### 4.3 Cloud Relay (`wss://connect.factorylm.com`)

WebSocket server on the VPS that receives tag data from edge agents.

**Why WebSocket (not Tailscale, not MQTT broker):**
- Outbound HTTPS/WSS from factory → cloud ALWAYS works through corporate firewalls
- No Tailscale install needed on customer side
- No MQTT broker to maintain
- Bidirectional: cloud can push commands back (change poll rate, request specific tags)
- Multiplexed: one connection per agent, all tag data + control commands

**Protocol (JSON over WSS):**
```json
// Agent → Cloud: tag update
{"type": "tags", "tenant_id": "abc-123", "agent_id": "plant-1",
 "ts": 1713400000, "tags": {
   "vfd-001/outputFrequency": {"v": 42.1, "q": "good", "t": 1713400000},
   "vfd-001/motorCurrent": {"v": 8.3, "q": "good", "t": 1713400000}
 }}

// Agent → Cloud: discovery results
{"type": "discovery", "tenant_id": "abc-123", "devices": [...]}

// Cloud → Agent: subscribe to tags
{"type": "subscribe", "device_id": "vfd-001", "tags": ["outputFrequency", "motorCurrent"]}

// Cloud → Agent: connection request
{"type": "connect", "device_id": "192.168.1.100", "protocol": "modbus_tcp", "config": {...}}
```

**Relay writes to:** `mira-bridge/data/mira.db` `equipment_status` table (same SQLite WAL that mira-mcp reads). This means the existing MCP tools (`get_equipment_status`, `list_active_faults`) immediately surface live data with zero changes to the diagnostic engine.

### 4.4 Activation Flow (Chromecast-style pairing)

```
Open WebUI                    Agent on Plant PC
──────────                    ─────────────────
User: "connect my factory"
                              
MIRA: "Download MIRA Connect
 and enter this code:         
 MIRA-7X4K-9P2M"             ← code stored in NeonDB
 [Expires in 1 hour]            plg_activation_codes table
                              
                              Agent starts → prompts for code
                              User pastes: MIRA-7X4K-9P2M
                              
                              Agent POSTs to /api/connect/activate
                              with code + agent fingerprint
                              
                              Server validates code → returns:
                              - tenant_id
                              - WSS relay URL
                              - JWT for agent auth
                              
                              Agent connects WSS → starts discovery
                              
MIRA: "MIRA Connect is       ← relay pushes discovery results
 online! Found 2 devices..."    to Open WebUI via mira-pipeline
```

### 4.5 Ignition Module Path

For factories with Ignition SCADA, the Ignition module replaces the standalone agent:

- Java module installed via Ignition Gateway web UI (standard .modl file)
- Reads the Ignition tag database directly (internal API, no network scan needed)
- Streams all configured tags to the same WSS relay
- Same activation code flow, same cloud relay, same chat UX
- Ignition already handles ALL protocol drivers — module just bridges data to MIRA

**Build priority:** P2 (after standalone agent is proven). The standalone agent serves both Ignition and non-Ignition shops. The module is an optimization for Ignition shops that eliminates the need for a separate agent process.

### 4.6 Chat UX in Open WebUI

MIRA Connect interactions happen through the mira-pipeline (OpenAI-compatible API wrapping GSDEngine). The pipeline generates rich markdown cards that Open WebUI renders inline.

**Card types:**

1. **Discovery card** — shows found devices with protocol badges and [Connect] buttons
2. **Connection card** — shows live tag values for a connected device with status indicators
3. **Alert card** — shows alarm trigger with fault info + diagnostic steps + [Create WO] button
4. **Mapping card** — shows tag-to-SM-Profile field mapping for user confirmation

Cards use Open WebUI's markdown rendering. No custom Open WebUI plugins needed — standard markdown + HTML that any Open WebUI instance renders.

### 4.7 Store-and-Forward (Offline Resilience)

Agent buffers tag data in a local SQLite DB when the WSS connection drops. On reconnect, buffered data is forwarded with original timestamps. Configurable retention (default: 24 hours, ~50MB for 100 tags at 1s poll).

### 4.8 Alert Engine

Celery task on VPS: `mira_connect.check_alarms`

- Runs every 10 seconds
- Reads latest tag values from `equipment_status` table
- Compares against SM Profile alarm thresholds (`alarmHigh`, `alarmLow`)
- On threshold crossing: fires Telegram/Slack notification via existing bot adapters
- Notification includes: tag value, threshold, SM Profile context, and a pre-built diagnostic prompt that auto-starts the GSD Engine

## 5. Phased Build

| Phase | Scope | Effort | Depends on |
|-------|-------|--------|-----------|
| **P1: Modbus MVP** | Modbus TCP driver + discovery + GS20 register map + WSS relay + activation flow + chat cards | 2 weeks | ISA-95 (#312) ✅, SM Profiles (#313) ✅ |
| **P2: Multi-protocol** | Add OPC UA + EtherNet/IP + MQTT drivers, 10 VFD register maps | 2 weeks | P1 |
| **P3: Alert engine** | Celery alarm task + Telegram notifications + diagnostic auto-start | 1 week | P2 |
| **P4: Ignition module** | Java .modl that reads Ignition tags → same WSS relay | 2 weeks | P2 |
| **P5: Installers** | Windows MSI + Linux install script + auto-update | 1 week | P1 |

Total: ~8 weeks for full delivery. P1 alone (2 weeks) produces a demo-ready product.

## 6. Files Modified / Created

**New module:** `mira-connect/` (entire new directory per the structure in §4.1)

**Modified:**
- `mira-web/src/server.ts` — add `POST /api/connect/activate` (activation code endpoint)
- `mira-web/src/lib/quota.ts` — add `plg_activation_codes` table + `plg_agent_registrations` table
- `mira-pipeline/main.py` — add rich card rendering for discovery/connection/alert events
- `mira-bridge/` — WSS relay server (new file or extend Node-RED)
- `mira-bots/shared/engine.py` — wire `plc_worker.py` to read live tags from `equipment_status`
- `mira-bots/shared/workers/plc_worker.py` — replace stub with real tag-context injection
- `docker-compose.saas.yml` — add `mira-relay` service for WSS endpoint

**Reused:**
- `mira-core/sm_profiles/` — SM Profile schema + loader (already merged, #313)
- `mira-core/mira-ingest/db/neon.py` — ISA-95 path + data_type (already merged, #312)
- `mira-mcp/server.py` — `equipment_status` table schema (already exists)
- `docs/legacy/Modbus_Register_Map.md` — GS20 register definitions (seed data)

## 7. Verification

1. **Unit tests:** Each driver has offline tests with mocked protocol responses
2. **Integration test:** OPC UA simulator (Prosys free) → agent discovers + connects → tags appear in Open WebUI chat
3. **End-to-end demo:** Modbus simulator OR Micro820 PLC → agent → WSS → mira-bridge → mira-mcp → mira-pipeline → Open WebUI shows live card → fault injection → Telegram alert with diagnosis
4. **Onboarding timer:** Measure time from "download agent" to "first live tag in chat" — target ≤ 30 minutes
5. **Screenshot test:** Open WebUI showing a connected VFD with live values + diagnostic conversation = the marketing asset

## 8. What This Does NOT Include

- Siemens S7, PROFINET, BACnet, HART — future protocol plugins, not in v1
- Tag write-back (commanding equipment from chat) — read-only in v1
- Historical tag trending / time-series charts — v2 feature
- Multi-site management dashboard — v2 feature
- Edge ML inference — v2 feature (currently all AI runs in cloud)
