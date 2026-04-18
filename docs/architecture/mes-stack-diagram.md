# MIRA MES Stack Diagram

*Walker Reynolds UNS Framework — ADR-0012*

---

## Full Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 4 — ERP (future integration)                                │
│  QuickBooks / SAP — purchase orders, invoice, accounting           │
│  Not in scope for MIRA Phase 1                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST / webhooks (future)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 3 — MES: MIRA                                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  AI LAYER                                                   │   │
│  │  • GSDiagnosisEngine (FSM — mira-pipeline)                 │   │
│  │  • LLM cascade (Claude → Groq → local fallback)            │   │
│  │  • NeonDB knowledge base (manuals, fault codes)            │   │
│  │  • mira-mcp (tool server)                                  │   │
│  └──────────────────┬──────────────────────────────────────────┘   │
│                     │                                               │
│  ┌──────────────────▼──────────────────────────────────────────┐   │
│  │  MES MODULES (Core Four)                                    │   │
│  │  1. Work Orders     → Atlas CMMS REST API (BUILT #279)     │   │
│  │  2. OEE Calculator  → mira-oee service (TODO #321)         │   │
│  │  3. Downtime Log    → fault event subscriber (TODO #323)   │   │
│  │  4. PM Scheduler    → Atlas PM triggers (TODO post-beta)   │   │
│  └──────────────────┬──────────────────────────────────────────┘   │
│                     │                                               │
│  ┌──────────────────▼──────────────────────────────────────────┐   │
│  │  DATA LAYER                                                 │   │
│  │  • NeonDB (Postgres): knowledge, assets, sessions, OEE     │   │
│  │  • Atlas DB: work orders, PM schedules                     │   │
│  │  • Asset Registry: ISA-95 namespace (TODO #328)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  INTERFACES                                                 │   │
│  │  • Telegram bot (mira-bots) — technician text interface    │   │
│  │  • Open WebUI — fleet OEE dashboard (TODO #325)           │   │
│  │  • REST API — mira-mcp tool endpoints                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ MQTT subscribe
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UNIFIED NAMESPACE (UNS)                                           │
│  Mosquitto MQTT broker (Docker container — TODO #327)              │
│                                                                     │
│  Topic hierarchy: FactoryLM/{site}/{area}/{line}/{asset}/{tag}     │
│                                                                     │
│  Active topics (FactoryLM/LakeWales/Line1/):                       │
│  ├── GS10/FaultCode          ← VFD fault code (0=OK, 1=OC, ...)   │
│  ├── GS10/MotorSpeed         ← RPM (HR100 via Micro820 bridge)     │
│  ├── GS10/Current            ← Amps (HR101)                        │
│  ├── GS10/Temperature        ← °C (HR102)                          │
│  ├── GS10/RunState           ← Coil0 (motor_run)                  │
│  ├── Micro820/CoilMotorRun   ← Coil0                               │
│  ├── Micro820/CoilMotorStop  ← Coil1                               │
│  ├── Micro820/CoilFault      ← Coil2                               │
│  └── Micro820/HoldingReg100  ← Raw HR100                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ OPC-UA tag subscription
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 2 — SCADA                                                   │
│  Ignition (hub) — OPC-UA server, Perspective dashboards            │
│  Node-RED HMI — :1880 (Docker, mira-hmi container)                │
│  → publishes OPC-UA tags → UNS via Cirrus Link MQTT module         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Modbus TCP :502
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 1 — CONTROL                                                 │
│  Micro820 PLC (192.168.1.100:502)                                  │
│  • HR100 = motor_speed  HR101 = current  HR102 = temp              │
│  • Coil0 = motor_run    Coil1 = motor_stop  Coil2 = fault         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ RS-485 Modbus RTU
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 0 — FIELD                                                   │
│  GS10 VFD (RS-485 → PLC bridge) — motor drive                     │
│  Conveyor motor, height sensors, Factory IO simulation             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Build Status

| Layer | Component | Status | Issue |
|-------|-----------|--------|-------|
| AI | GSDiagnosisEngine | BUILT | — |
| AI | LLM cascade | BUILT | — |
| AI | NeonDB KB | BUILT | — |
| MES | Work Orders (Atlas) | BUILT | PR #279 |
| MES | OEE Calculator | TODO | #321 |
| MES | Downtime Log | TODO | #323 |
| MES | PM Scheduler | FUTURE | post-beta |
| Data | Asset Registry (ISA-95) | TODO | #328 |
| Data | Cross-session memory | TODO | #329 |
| UNS | Mosquitto MQTT broker | TODO | #327 |
| UNS | Ignition → MQTT bridge | TODO | follow-on |
| UI | Telegram bot | BUILT | — |
| UI | OEE dashboard | TODO | #325 |
| SCADA | Node-RED HMI | BUILT | — |
| Control | Micro820 PLC | BUILT | — |
| Field | GS10 VFD | BUILT | — |

---

## Event vs. Transaction Model

Following Walker Reynolds' data model:

- **Event** = one data point at one moment
  - `{topic: "FactoryLM/LakeWales/Line1/GS10/FaultCode", value: 3, ts: "2026-04-16T10:32:05Z"}`

- **Transaction** = snapshot of multiple values when something important happens
  - Fault occurred → record speed + current + temp + fault_code + time → one NeonDB row
  - This is what feeds OEE Availability calculation

---

## Deployment Nodes

| Service | Node | IP | Port |
|---------|------|----|------|
| MIRA AI / bots | CHARLIE | 192.168.1.12 | — |
| Mosquitto MQTT | CHARLIE (Docker) | 192.168.1.12 | 1883/9001 |
| NeonDB | Cloud (Neon) | — | 5432 |
| Atlas CMMS | Cloud (Atlas) | — | — |
| Node-RED HMI | CHARLIE (Docker) | 192.168.1.12 | 1880 |
| Ignition SCADA | ALPHA | 192.168.1.10 | 8088 |
| Micro820 PLC | PLC Laptop | 192.168.1.100 | 502 |

---

*Architecture frozen in ADR-0012. Changes require a new ADR.*
