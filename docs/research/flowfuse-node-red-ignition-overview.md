# FlowFuse / Node-RED / Ignition / MQTT / Sparkplug B / UNS — plain-English overview

**Audience:** anyone on the MIRA / FactoryLM team who needs a shared vocabulary for the industrial-edge stack.
**Companion:** `docs/audits/2026-06-04-flowfuse-ignition-alignment.md` (what we actually have today), `docs/architecture/node-red-ignition-bidirectional-patterns.md` (how the pieces connect).
**Rule of thumb:** MIRA is the **maintenance reasoning layer**. Everything below is plumbing that gets *trusted, structured machine context* to MIRA so it can answer a technician with citations. MIRA does not try to own or replace the plumbing.

---

## Node-RED

**What it is:** a flow-based, low-code wiring tool. You drag "nodes" (read Modbus, parse JSON, publish MQTT, call an HTTP endpoint) onto a canvas and connect them. It runs on Node.js and is the de-facto glue layer of the industrial-IoT world for moving and reshaping data.

**Why it matters for brownfield:** old plants have a zoo of protocols (Modbus RTU/TCP, OPC UA, EtherNet/IP, serial, REST). Node-RED is excellent at *protocol conversion and light transformation at the edge* — read a device one way, publish it another way — without writing a service from scratch.

**In MIRA today:** `mira-bridge/` is a self-hosted Node-RED 4.1.7 deployment. It does message routing (Telegram/REST webhooks → services), holds the shared SQLite write lock, and carries the demo HMI flow (`mira-bridge/flows/fault-detective.json`). See `mira-bridge/CLAUDE.md`.

## FlowFuse

**What it is:** a management platform *on top of* Node-RED. It adds multi-tenant project isolation, Git-synced flows, deploy snapshots/rollback, an audit log, role-based access, and a blueprint system (publish a flow, deploy to many tenants). Open-source self-host + a commercial cloud.

**Why it matters:** stock Node-RED's weak spot is operations — flows are edited in a UI and exported by hand, with no audit trail. FlowFuse fixes that and gives you per-customer isolation.

**In MIRA today:** **deferred.** `docs/adr/0016-mira-bridge-flowfuse.md` evaluated it and recommended staying on stock Node-RED for the MVP window (its multi-tenant model is incompatible with our shared-SQLite pattern, and its cloud pricing is margin-negative at our ARPU). Revisit at ~500 paying tenants or if a multi-tenant deal forces per-customer Node-RED isolation. **MIRA should not become "a FlowFuse."**

## Ignition (Inductive Automation)

**What it is:** a full industrial platform — SCADA, HMI, historian, alarming, tag system, and a driver suite (Modbus, OPC UA, EtherNet/IP, etc.). It runs on a "Gateway" (a JVM service) and is the system many plants already trust as their source of truth for live tags.

**Why it matters:** the customer probably already owns Ignition (or is buying it). Ignition already talks to the PLCs. Fighting Ignition is a losing battle; riding on top of it (Ignition Exchange / a Module) is the winning one.

**In MIRA today:** the **customer-deployable surface is an Ignition Module** (Perspective project + WebDev endpoints + gateway scripts), per `docs/adr/0021-ignition-module-first-edge.md` and `docs/mira-ignition-secure-architecture.md`. All plant-side I/O stays inside Ignition; MIRA reads tags by browsing Ignition's tag space, never by opening its own protocol socket. **MIRA does not replace Ignition.**

## MQTT

**What it is:** a lightweight publish/subscribe messaging protocol. Publishers send messages to "topics"; subscribers receive any topic they care about. A central "broker" (Mosquitto, HiveMQ, EMQX) routes everything. It is the standard backbone for the Unified Namespace pattern.

**Why it matters:** decouples producers from consumers. A PLC bridge publishes once; Ignition, Node-RED, a dashboard, and MIRA can all subscribe independently. It is the natural "shared nervous system."

**In MIRA today:** used **on the bench** (`docker-compose.fault-detective.yml` runs Mosquitto; `plc/live-plc-bridge/bridge.py` publishes Modbus reads; `mira-fault-detective/engine.py` subscribes). That compose file is explicitly a **BENCH HARNESS, not a customer architecture**. The customer path (ADR-0021) moves tags over **outbound HTTPS**, not a MIRA-hosted broker.

## Sparkplug B

**What it is:** a *convention on top of MQTT* (Eclipse Tahu, spec 3.0.0) that standardizes the topic structure (`spBv1.0/{group}/{message_type}/{edge_node}/{device}`) and the payload (typed metrics, **birth/death certificates** so consumers know when a device goes online/offline, and aliased metric names for bandwidth). It turns "raw MQTT" into a self-describing, stateful industrial bus.

**Why it matters:** birth/death + typed metrics + quality/timestamp make MQTT trustworthy for SCADA-grade data. It is the clean way to do a real UNS event stream.

**In MIRA today:** **spec-only.** `docs/specs/uns-kg-standards-compliance.md §6` maps MIRA's 7-segment UNS path onto Sparkplug's namespace and notes it is a "future Layer 4 (event stream)" needing "a 10-line transform." **No Sparkplug publisher or subscriber exists in code.** The non-Ignition Sparkplug edge subscriber (`mira-connect`) is tracked at issue #1627, not shipped. Do **not** describe Sparkplug as implemented.

## UNS — Unified Namespace

**What it is:** a single, hierarchical, business-friendly address space for everything in the plant — `enterprise / site / area / line / equipment / component / datapoint` — derived from ISA-95. Every tag, manual chunk, fault code and work order hangs off one path. It is the "single source of structure," whether expressed as MQTT topics (live) or database rows (persisted).

**Why it matters for MIRA:** the UNS is *how MIRA knows what the technician is talking about*. The confirmation gate resolves the technician's words to a UNS path before troubleshooting; retrieval and the knowledge graph are keyed on it.

**In MIRA today:** real and central. `mira-crawler/ingest/uns.py` builds the paths; `mira-bots/shared/uns_resolver.py` resolves free-form messages to a UNS context; the confirmation gate in `mira-bots/shared/engine.py` enforces "no confirmed context, no troubleshooting." Storage uses ltree (`docs/migrations/007_uns_path.sql`). ISA-95/ISO-14224/Sparkplug alignment is audited in `docs/specs/uns-kg-standards-compliance.md`.

## OPC UA

**What it is:** a vendor-neutral industrial protocol with a rich, browsable "address space" (typed nodes, metadata, security). Modern PLCs (Siemens S7, AB Logix, Beckhoff) expose an OPC UA server. It also supports PubSub over MQTT, which can bridge directly to a Sparkplug-style UNS.

**Why it matters:** where it exists, OPC UA gives structure for free — its address space maps almost 1:1 onto the UNS.

**In MIRA today:** **scanned, not consumed.** `plc/discover.py` probes for OPC UA endpoints during read-only discovery, but there is no OPC UA *read driver*. ADR-0001 deferred OPC UA (license/scope). In the customer architecture (ADR-0021) OPC UA is Ignition's job, and MIRA reads the resulting tags from Ignition.

## Modbus

**What it is:** the oldest, simplest, most universal fieldbus. Reads/writes numbered registers (coils, holding registers) over TCP or RS-485 serial (RTU). Ubiquitous on VFDs and small PLCs.

**Why it matters:** it is the lowest common denominator for brownfield devices — the GS10 VFD and Micro820 PLC in the conveyor lab speak it.

**In MIRA today:** the real device path. `mira-connect/.../drivers/modbus_driver.py` (async read), `plc/live-plc-bridge/bridge.py` and `plc/live_monitor.py` (bench tools). **Read-only by rule** (`.claude/rules/fieldbus-readonly.md`); the RS-485 sweep refuses to run on a live PLC-mastered bus without `--serial-bus-idle` (two masters can fault-stop a motor).

## REST APIs

**What it is:** plain HTTP request/response with JSON. The universal integration glue between web services.

**Why it matters for MIRA:** it is how the *trusted edge talks to the cloud* without opening inbound ports — the customer only allows `outbound 443`.

**In MIRA today:** the spine of the customer architecture. The Ignition gateway script `ignition/gateway-scripts/tag-stream.py` POSTs tag JSON to `mira-relay/relay_server.py`; the Ignition HMI POSTs questions to `mira-bots/ask_api/app.py`; both are outbound-HTTPS, HMAC-signed (ADR-0021). The chat engine itself talks to LLM providers over REST (Groq → Cerebras → Gemini cascade).

---

## How they fit together (one paragraph)

In a brownfield plant, **Modbus/OPC UA** are how you reach the iron. **Node-RED** (optionally managed by **FlowFuse**) converts those protocols at the edge. **Ignition** is the trusted SCADA/HMI/historian the customer already runs. **MQTT** (optionally framed as **Sparkplug B**) is the shared bus, addressed by the **UNS**. **REST** carries trusted, signed snapshots outbound to the cloud. **MIRA** sits at the top: it consumes the structured context, confirms the technician's UNS location, and produces cited troubleshooting answers. The deliberate boundary: data flows *up and out* to MIRA; MIRA never reaches *down and in* to write the plant.
