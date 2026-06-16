# ADR-0012: MES Architecture — Walker Reynolds UNS Framework

## Status
Accepted

**Related:** Issues #327 (Week 1 MQTT/UNS), #328 (Week 2 ISA-95 namespace), #329 (cross-session memory), #321–#326 (MES Core Four modules).

---

## Context

MIRA v0.5+ has a working AI diagnosis layer (GSDiagnosisEngine), a knowledge base (NeonDB), a CMMS integration (Atlas — PR #279), and a Telegram interface. It has the **brains** (AI) and the **hands** (work orders). It is missing the **eyes** (live machine data).

For MIRA to function as a true MES — not just a chatbot — it needs:
1. Live machine state without requiring a technician to type fault codes manually
2. A structured way to track OEE (Overall Equipment Effectiveness)
3. Downtime event logging tied to specific assets
4. A data architecture that does not become spaghetti as more systems are added

Walker Reynolds (4.0 Solutions / iiot.university) is the leading Industry 4.0 educator and creator of the Unified Namespace (UNS) movement. His 8-Week MES Bootcamp framework was evaluated as the architecture MIRA should follow. It prescribes: Python + SQL + MQTT + open platforms. No proprietary software. Any manufacturer can deploy it.

### ISA-95 Pyramid Context

```
Level 4  ERP          (QuickBooks, SAP — business orders)
Level 3  MES          ← MIRA lives here
Level 2  SCADA        (Ignition, HMI dashboards)
Level 1  Control      (PLC — Micro820)
Level 0  Field        (GS10 VFD, sensors, motors)
```

MIRA is a Level 3 system. It must speak the language of Level 2 (SCADA) via the UNS layer.

---

## Decision

**Build MIRA as a Walker Reynolds-style MES using the Unified Namespace (UNS) + Core Four framework.**

### The Unified Namespace

Instead of wiring every system directly to every other system, everything publishes to ONE MQTT broker. MIRA subscribes to the topics it needs.

```
┌──────────────────────────────────────────────────────────┐
│  MIRA AI LAYER                                           │
│  Technician texts → MIRA diagnoses → creates work order  │
│  mira-bots | mira-pipeline | mira-mcp | NeonDB KB        │
└──────────────┬───────────────────────────────────────────┘
               │ reads: asset history, open WOs, fault events
               ▼
┌──────────────────────────────────────────────────────────┐
│  MES MODULES (Core Four)                                 │
│  1. Work Orders → Atlas CMMS (built — PR #279)          │
│  2. OEE → mira-oee microservice (issue #321)            │
│  3. Downtime Tracker → subscribes to fault events (#323) │
│  4. Scheduler → PM calendar (future — post-5-users)     │
└──────────────┬───────────────────────────────────────────┘
               │ subscribes to machine events
               ▼
┌──────────────────────────────────────────────────────────┐
│  UNIFIED NAMESPACE (UNS)                                 │
│  MQTT broker (Mosquitto container — issue #327)          │
│  Topic: FactoryLM/{site}/{area}/{line}/{asset}/{tag}     │
└──────────────┬───────────────────────────────────────────┘
               │ OPC-UA tags / Modbus polls
               ▼
┌──────────────────────────────────────────────────────────┐
│  Ignition SCADA + Micro820 PLC + GS10 VFD               │
│  Live data: speed, current, temp, fault codes, runtime   │
└──────────────────────────────────────────────────────────┘
```

### Walker's Core Four

Every MES needs exactly four things to start:

| Module | Plain English | Status |
|--------|--------------|--------|
| Work Orders | "I have a job to do. Give it a number and track it." | BUILT (PR #279) |
| Scheduling | "When does each job happen, and in what order?" | Future — post-5-users |
| OEE Tracking | Availability × Performance × Quality | Issue #321 |
| Downtime Tracking | "When did the machine stop, and why?" | Issue #323 |

### UNS Topic Schema

ISA-95 hierarchy: `Enterprise/Site/Area/Line/Cell/Asset/Tag`

```
FactoryLM/LakeWales/Line1/GS10/FaultCode
FactoryLM/LakeWales/Line1/GS10/MotorSpeed
FactoryLM/LakeWales/Line1/GS10/Current
FactoryLM/LakeWales/Line1/GS10/Temperature
FactoryLM/LakeWales/Line1/Micro820/CoilMotorRun
FactoryLM/LakeWales/Line1/Micro820/HoldingReg100
```

Full schema: `docs/architecture/mes-stack-diagram.md`

### Build Sequence

1. **Week 1** — Mosquitto MQTT broker container + UNS topic schema (#327) — *foundation*
2. **Week 2** — ISA-95 asset namespace + equipment registry in NeonDB (#328) — *identity layer*
3. **Week 3** — OEE calculator service (#321) — *requires #327 + #328*
4. **Week 4** — Work order CRUD + scheduling model (#322) — *extends existing CMMS*
5. **Week 5** — Downtime tracking (#323) — *requires #327 + #328*
6. **Week 6** — Atlas CMMS bidirectional sync (#324)
7. **Week 7** — Open WebUI fleet OEE dashboard (#325)
8. **Week 8** — MES integration test suite (#326)

Cross-cutting: cross-session equipment memory (#329) — can be built in parallel with Week 2.

---

## Consequences

### Positive

- **Zero licensing cost.** Mosquitto is free. NeonDB free tier covers early stage. No Rockwell or Siemens MES licensing.
- **Incremental.** Each module is a standalone microservice. Week 1 doesn't require Week 8 to work.
- **Walker-compatible.** Any iiot.university bootcamp student can read this codebase and understand it immediately. Reduces onboarding friction for future contributors.
- **MIRA gains sight.** After Week 1+2, MIRA stops asking "what fault code do you see?" — it already knows from the UNS feed.

### Negative / Trade-offs

- **MQTT is another moving part.** The Mosquitto container must stay healthy. Add health check to SCADA stack monitoring.
- **Ignition → MQTT bridge is manual.** Ignition doesn't auto-publish to Mosquitto out of the box. Requires Cirrus Link MQTT module (or custom OPC-UA → Python → MQTT bridge). This is a follow-on effort.
- **OEE accuracy depends on data quality.** Garbage fault events = garbage OEE numbers. Must validate Modbus poll accuracy before reporting OEE to customers.

---

## Rejected Alternatives

| Alternative | Reason Rejected |
|-------------|----------------|
| FactoryTalk MES (Rockwell) | $500K+ licensing. Closed ecosystem. Not aligned with "any manufacturer" mission. |
| Inductive Automation Sepasoft MES | Ignition add-on. Expensive. Vendor lock-in to Ignition platform. |
| LangGraph orchestration layer | Already rejected in ADR-0011. Adds complexity without improving MES function. |
| Custom ERP integration | Level 4 scope creep. MIRA is Level 3 MES. ERP is a future integration, not a replacement architecture. |
| Node-RED as MES logic layer | Node-RED (running on HMI :1880) is for visualization, not business logic. Mixing concerns. |

---

## References

- Walker Reynolds / 4.0 Solutions: iiot.university (8-Week MES Bootcamp)
- ISA-95 standard: Manufacturing Operations Management
- Mosquitto MQTT broker: eclipse.org/mosquitto
- MIRA SCADA stack: `~/factorylm/docker-compose.yml`
- Modbus register map: `~/factorylm/CLUSTER.md`
- Existing ADRs: `docs/adr/`
