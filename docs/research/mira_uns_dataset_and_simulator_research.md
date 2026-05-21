# MIRA — UNS Dataset & Simulator Research

> Research date: **2026-05-21** · Author: research sweep across CESMII / i3X / awesome-industrial-datasets / TEP / SWaT / OPC UA sims / MQTT-Sparkplug B sims / NASA PCoE / PHM Society / ISO + DEXPI + AAS standards. Companion build plan: [`factorylm_proveit_simulator_build_plan.md`](./factorylm_proveit_simulator_build_plan.md).

---

## A. Executive Summary

MIRA's commercial wedge — *"ingest messy automation data + docs, propose 70–80% of asset / component / tag / document relationships automatically, let humans approve the rest"* — has no off-the-shelf benchmark. Public industrial datasets are overwhelmingly raw time-series or anomaly datasets; **almost none ship the contextualization layer** (ISA-95 hierarchy + Sparkplug B topic tree + manuals + work-orders + KG seed) we need to score.

**The research surfaces three distinct asset categories, and our simulator stitches one of each into a coherent fixture:**

| Layer | Best free source | Why |
|---|---|---|
| **Live-tag simulators** (broker + publisher emit realistic Sparkplug B/OPC UA) | `libremfg/PackML-MQTT-Simulator` + `Azure-Samples/iot-edge-opc-plc` + `FreeOpcUa/asyncua` | Native Sparkplug B/PackML lifecycle, configurable hierarchy via env vars/NodeSet XML, MIT/MPL/LGPL |
| **Process datasets with labeled faults** (replay as time-series) | Tennessee Eastman + SWaT + Petrobras 3W + IBM AssetOpsBench + UCI Hydraulic | Multi-unit ISA-95-mappable hierarchy, labeled fault catalogs, public P&IDs |
| **KG / work-order / failure-mode seeds** (text-shaped evidence) | IBM AssetOpsBench (4,200 WOs) + IBM FailureSensorIQ (8,296 ISO-coded FM↔sensor pairs) + ISO-14224-derived open vocabulary | Citable evidence packets for MIRA's "propose & cite" loop |

**The unlock:** none of these layers alone gives MIRA a benchmark, but glued together — TEP process loop publishing as Sparkplug B over Mosquitto, with AssetOpsBench work-orders + FailureSensorIQ KG seeds + AAS Nameplate shells representing engineering context — we get a 4–5 level UNS fixture with live traffic, labeled faults, real manuals and work orders, and a citation surface. **All open-licensed, all Dockerizable, ~8 containers in `docker-compose.benchmark.yml`.**

**Critical gaps the simulator must fill itself** (no source does this for us):
1. **Messy real-plant naming** (typo injection, namespace drift, duplicate assets, zombie devices) — must build a ~100-line noise injector.
2. **Coherent doc pack per component** (manual + datasheet + wiring + parts list) joined to the same UNS path — must generate procedurally and seed via `mira-crawler`.
3. **Human-in-the-loop approval ground truth** — must hand-label the "verified" vs "proposed" relationships per fixture run so we can score MIRA's recall/precision.

**ProveIt2026 is not a dataset** — the `cesmii/ProveIt2026` repo is conference slides only. The live i3X demo endpoint (`https://api.i3x.dev/v1`) is real and useful, but shallow (pump + tank + sensors). SMIP is paywalled. **CESMII's open contribution to the benchmark is the i3X spec + object/relationship model**, not operational data.

---

## B. Ranked Resources (full inventory)

Format: **name** · URL · type · domain · license · format · live/static · signals · faults · hierarchy depth · docs included · UNS-wrappable · usefulness (1–5) · why.

### B.1 Live-tag simulators (broker / publisher / address-space generators)

| # | Name | URL | Type | License | Format | Live/Static | Hierarchy | Docs? | UNS-wrappable | Use (1-5) | Why |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **libremfg/PackML-MQTT-Simulator** | https://github.com/libremfg/PackML-MQTT-Simulator | Line sim | MIT | MQTT + Sparkplug B v1.0 | Live | 3 (SITE/AREA/LINE via env) | No | **YES** | **5** | Full PackML state machine, counters, stop-reason codes — best ready-to-run UNS line sim |
| 2 | **Azure-Samples/iot-edge-opc-plc** | https://github.com/Azure-Samples/iot-edge-opc-plc | OPC UA server | MIT | NodeSet2 XML + JSON | Live | Configurable | No | YES | **5** | Official Docker image, loads any companion-spec XML via `--ns2`, last release Mar 2026 |
| 3 | **FreeOpcUa/opcua-asyncio** | https://github.com/FreeOpcUa/opcua-asyncio | OPC UA framework | LGPL-3.0 | Programmatic | Live | Programmatic | No | YES | **5** | Python-first → shares `mira-crawler/ingest/uns.py` builders, fastest iteration |
| 4 | **amine-amaach/simulators** (`IoTSensorsMQTT-SpB`) | https://github.com/amine-amaach/simulators | SpB EoN publisher | Apache 2.0 | Sparkplug B | Live | Configurable group/node/device | No | YES | 4 | Canonical Go SpB publisher, NBIRTH/DBIRTH/NDEATH lifecycle |
| 5 | **mkashwin/unifiednamespace** | https://github.com/mkashwin/unifiednamespace | Full UNS stack | BSD-3/MIT | SpB + GraphQL + ISA-95 JSON | Live | ISA-95 enforced | No | YES | 4 | Includes `99_simulator` that generates messages at each ISA-95 level — best ISA-95 enforcer |
| 6 | **emqx/neuron** | https://github.com/emqx/neuron | Protocol gateway | Apache 2.0 | OPC UA/Modbus/EIP → SpB | Live | Pass-through | No | YES | 4 | Brownfield OPC UA → SpB bridge — realistic "discovered device" scenario |
| 7 | **eclipse-tahu/tahu** | https://github.com/eclipse-tahu/tahu | SpB reference lib | EPL-2.0 | Sparkplug B | Library | N/A | No | N/A | 4 | Authoritative SpB implementation — use as library under custom publishers |
| 8 | **node-opcua/node-opcua** | https://github.com/node-opcua/node-opcua | OPC UA framework | MIT | Programmatic + NodeSet | Live | Programmatic | No | YES | 3 | Best TS option; MIRA is Python-first so deprioritized |
| 9 | **open62541** | https://github.com/open62541/open62541 | OPC UA framework | MPL-2.0 | C + NodeSet compiler | Live | NodeSet compiled in | No | YES | 3 | High compliance, but C toolchain slows iteration — defer to Phase 2 |
| 10 | **eclipse-milo/milo** | https://github.com/eclipse-milo/milo | OPC UA framework | EPL-2.0 | Java | Live | Programmatic | No | YES | 2 | JVM weight; only if Java is already in stack |
| 11 | **CESMII/simdata-opcua** | https://github.com/cesmii/simdata-opcua | Motor-line OPC UA sim | unclear | OPC UA events | Live | 2 levels | No | YES (via bridge) | 3 | 10-station electric motor assembly sim — useful pre-seeded scenario |
| 12 | **CESMII/CNCBaseType-Simulator** | https://github.com/cesmii/CNCBaseType-Simulator | CNC sim → SMIP | MIT | MQTT/SMIP API | Live | 2 levels | No | YES (needs SMIP) | 2 | Best CNC sim, but requires CESMII membership for SMIP target |
| 13 | **PackML-MQTT-Simulator (Sparkplug B branch)** | (see #1) | — | — | — | — | — | — | — | — | duplicate, listed for completeness |
| 14 | **DamascenoRafael/mqtt-simulator** | https://github.com/DamascenoRafael/mqtt-simulator | Generic MQTT sim | Apache 2.0 | JSON over MQTT | Live | Configurable | No | PARTIAL | 3 | Cleanest base for adversarial/noise injector layer (no SpB) |
| 15 | **mtconnect/cppagent** | https://github.com/mtconnect/cppagent | MTConnect agent + sim | Apache 2.0 | MTConnect XML / MQTT | Live | 3 (agent/device/dataitem) | No | PARTIAL | 4 | Built-in `simulator/` adapter for CNC axes; v2.7 (Apr 2026) |
| 16 | **PROSYS Simulation Server** | https://prosysopc.com/products/opc-ua-simulation-server/ | OPC UA server (GUI) | Proprietary freeware | GUI | Live | Manual | No | NO | 1 | GUI-only, no headless mode → unfit for compose-driven benchmark |
| 17 | **Open-Industry-Project** | https://github.com/Open-Industry-Project/Open-Industry-Project | 3D plant sim | MIT | OPC UA + Modbus + EIP + MQTT | Live | Procedural (3D) | No | YES | 3 | Godot-based 3D conveyor/sorter — visual validation layer |
| 18 | **Spruik/Libre** | https://github.com/Spruik/Libre | MES + OEE stack | Apache 2.0 | InfluxDB line protocol | Live | Site/Line | No | PARTIAL | 2 | OEE event generator; not MQTT-native |
| 19 | **i3X public demo endpoint** | https://api.i3x.dev/v1 | i3X REST API | Public access | JSON / REST | Live | 4 levels (Abelara ns) | No | YES | 3 | Real i3X data, no auth needed; shallow (pump + tank + sensors) |
| 20 | **HiveMQ Sparkplug-aware extension** | https://github.com/hivemq/hivemq-sparkplug-aware-extension | Broker plugin | Apache 2.0 | MQTT broker | Live | Pass-through | No | YES | 3 | Surfaces birth certs at `$sparkplug/certificates/*` — useful for resolver tests |

### B.2 Process / industrial datasets (replay-able as Sparkplug B / MQTT)

| # | Name | URL | Domain | License | Format | Hierarchy | Faults | Docs? | UNS-wrappable | Use (1-5) | Why |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Tennessee Eastman (Harvard Dataverse)** | https://doi.org/10.7910/DVN/6C3JR1 | Chemical process | CC BY | CSV | 5 named units, ISA-95 confirmed | 21 labeled | P&ID public | **YES** | **5** | Gold standard process sim; Python reimpl: `mv-per/tennessee-eastman-dataset` (MIT) |
| 2 | **TEP Alarm Management** (IEEE DataPort) | https://doi.org/10.21227/326k-qr90 | Chemical | Open access | XLSX | Same as TEP | Alarm thresholds + 11 docs | YES | YES | 4 | Adds alarm + control-loop docs to TEP — full evidence layer |
| 3 | **SWaT** (iTrust, SUTD) | https://itrust.sutd.edu.sg/itrust-labs_datasets/ | Water treatment ICS | Free (request, ~2d) | CSV @ 1Hz | 6 stages, 51 named tags | 41 cyber-physical attacks | P&ID public | **YES** | **5** | Best ICS taxonomy; P&ID downloadable without form |
| 4 | **WADI** (iTrust) | https://itrust.sutd.edu.sg/itrust-labs_datasets/ | Water distribution | Free (request) | CSV | Multi-stage | Attacks labeled | Limited | YES | 3 | Same gate as SWaT, lower doc quality — defer |
| 5 | **HAI Security Dataset** | https://github.com/icsdataset/hai | Multi-process ICS | CC BY-SA 4.0 | CSV | 4 systems × real DCS/PLC vendors | 38–58 attacks | README + USENIX paper | YES | 4 | Boiler+turbine+water+HIL — multi-vendor realism |
| 6 | **Petrobras 3W** | https://github.com/petrobras/3W | Oil well | Apache-2.0 + CC BY 4.0 | Parquet | Downhole→subsea→surface | 9 event classes | Tag taxonomy doc | YES | 4 | Production-realistic tag names; live-maintained (May 2026) |
| 7 | **IBM AssetOpsBench** | https://github.com/IBM/AssetOpsBench | Cross-industry assets | Apache-2.0 | JSON/Parquet | 10 asset types, Maximo hierarchy | ISO-coded FMs | **4,200 WOs + manuals** | PARTIAL | **5** | The only public WO + sensor + manual + FM joined dataset |
| 8 | **IBM FailureSensorIQ** | https://github.com/IBM/FailureSensorIQ | Rotating equipment + 10 asset types | Apache-2.0 | QA dataset (8,296 Q&A) | Asset-type level | All ISO FMs | ISO-cited | YES (seed only) | **5** | Pre-built `kg_relationships` seed with citations |
| 9 | **UCI Hydraulic Systems** | https://archive.ics.uci.edu/dataset/447 | Test rig | CC BY 4.0 | CSV | 2 sub-systems, 4 components | Multi-label (4-comp condition vector) | Schema | YES | 4 | Best multi-component fault labeling |
| 10 | **CARE-to-Compare Wind SCADA** | https://zenodo.org/records/10958775 | Wind | CC BY-SA 4.0 | CSV | Farm → turbine | 44 of 95 datasets labeled | Fault logbook | YES | 4 | 89 turbine-years; real labeled fault windows |
| 11 | **ALPI (Alarm Logs)** | https://ieee-dataport.org/open-access/alarm-logs-packaging-industry-alpi | Packaging | Open access (IEEE acct) | CSV/JSON | Machine-level | 154 alarm codes | No | PARTIAL | 3 | Real CMMS-style alarm sequences |
| 12 | **SKAB** | https://github.com/waico/SKAB | Lab water loop | Unlicensed | CSV | Single loop | Anomalies labeled | No | YES | 2 | Quick smoke test of anomaly injection |
| 13 | **EPANET/EPyT** | https://github.com/OpenWaterAnalytics/EPyT | Water distribution | MIT (Python wrapper); Public domain (EPA) | Python | Pipe network | Pressure/flow events | EPA docs | YES (via bridge) | 3 | Live process sim for water plants |
| 14 | **MTConnect demo agent** | http://demo.mtconnect.org | CNC machining | Open (AMT) | XML | 3 (agent/device/dataitem) | Conditions/alarms | Schema | PARTIAL | 3 | Live CNC samples (OKUMA + Mazak) |

### B.3 Predictive maintenance / component-level fault datasets

| # | Name | URL | Equipment | License | Faults | Replay-able? | UNS verdict | Use |
|---|---|---|---|---|---|---|---|---|
| 1 | **NASA IMS Bearing** (PCoE #4) | https://data.nasa.gov/dataset/ims-bearings | 4-bearing rig | Public domain | Natural run-to-failure (3 experiments) | YES (timestamped 10-min snapshots) | YES | **5** real degradation curves |
| 2 | **NASA C-MAPSS Turbofan** (PCoE #6/#17) | NASA PCoE | Turbofan | Public domain | 6 fault modes × 4 ops cond | YES | YES | 4 best RUL benchmark |
| 3 | **NASA FEMTO/PRONOSTIA** (PCoE #10) | NASA PCoE | Bearing rig | No explicit license; cite | Accelerated run-to-failure | YES | YES | 4 |
| 4 | **CWRU Bearing** | https://csegroups.case.edu/bearingdatacenter | Motor bearing | Open (cite) | 48 configurations | YES | **YES** | **5** gold-standard academic benchmark |
| 5 | **MFPT Bearing** | https://www.mfpt.org/fault-data-sets/ | Bearing + 3 real wind-turbine bearings | Free (cite) | 7 conditions | YES | YES | 4 includes real-world failures |
| 6 | **Paderborn KAt-DataCenter** | https://mb.uni-paderborn.de/.../bearing-datacenter | Bearing | CC BY-NC | 32 states (most comprehensive) | YES | YES | 4 NC clause OK for internal benchmark |
| 7 | **AI4I 2020** (UCI / Kaggle) | https://archive.ics.uci.edu/dataset/601 | Milling machine (synthetic) | CC BY 4.0 | 5 labeled (TWF/HDF/PWF/OSF/RNF) | YES (10K-row CSV) | YES | **5** fastest CSV → MQTT path |
| 8 | **Pump Sensor Data** (Kaggle) | https://www.kaggle.com/datasets/nphantawee/pump-sensor-data | Water pump | Kaggle default | 7 real failures over 1 year, 52 ch | YES | YES | **5** rare real-world sparse-label data |
| 9 | **MIMII** (Hitachi) | https://zenodo.org/records/3384388 | Valves/pumps/fans/rails | CC BY-NC-SA 4.0 | Audio anomalies | YES (audio) | NO (audio-only) | 2 only if MIRA adds acoustics |
| 10 | **Rotating Equipment Multi-Sensor** | https://www.kaggle.com/datasets/zoya77/rotating-equipment-multi-sensor-fault-dataset | Rotating shaft | Kaggle | Normal + imbalance + bearing + misalignment | YES | YES | 3 |

### B.4 Standards & schemas (encode in simulator output)

| # | Standard | Where | License | What we encode |
|---|---|---|---|---|
| 1 | **ISA-95 / B2MML V0700** | https://github.com/MESAInternational/B2MML-BatchML | Royalty-free w/ attribution | 5-level ltree UNS path |
| 2 | **Sparkplug B 3.0** | https://sparkplug.eclipse.org/specification/version/3.0/ | EPL-2.0 | Topic + NBIRTH/DBIRTH/NDATA/NDEATH lifecycle |
| 3 | **PackML / ISA-TR88.00.02 OPC UA NodeSet** | https://github.com/OPCFoundation/UA-Nodeset/blob/latest/PackML/Opc.Ua.PackML.NodeSet2.xml | OPC Foundation (open) | 17 states, 3 modes, PackTag triad |
| 4 | **IDTA AAS Nameplate (02006-3-0)** | https://industrialdigitaltwin.org/en/content-hub/downloads | CC BY 4.0 | Per-asset shell w/ ManufacturerName, SerialNumber, etc. |
| 5 | **IDTA AAS Time Series Data (02008-1-1)** | (same) | CC BY 4.0 | Binds shell ↔ live SpB metric stream |
| 6 | **OPC UA Pumps (OPC 30050/40223)** | https://github.com/OPCFoundation/UA-Nodeset/tree/latest/Pumps | OPC Foundation (open) | MaintenanceGroupType taxonomy |
| 7 | **OPC UA MachineTool (OPC 40501-1)** | (same) | OPC Foundation (open) | CNC channel/spindle/axis hierarchy |
| 8 | **MTConnect 1.4** | https://www.mtconnect.org/standard-download20181 | Open (AMT) | CNC telemetry XML / Execution states |
| 9 | **ISO 14224 (derived vocabulary)** | (ISO paywalled; subset reproduced openly) | Open subset only | failure mode + cause taxonomy |
| 10 | **DEXPI 2.0** | https://dexpi.org/specifications/ | CC | P&ID topology + instrument loops |
| 11 | **CFIHOS RDL v1.4** | https://www.jip36-cfihos.org/.../CFIHOS-Reference-Data-Library-V1.4-1.xlsx | Free (register) | Equipment class attribute lists |
| 12 | **i3X spec (CESMII)** | https://github.com/cesmii/i3X | unclear (spec doc) | Object/relationship model (hierarchical/composition/graph) |

### B.5 Tooling / clients (debug + verify)

| # | Tool | URL | Purpose |
|---|---|---|---|
| 1 | UaExpert | https://www.unified-automation.com/products/development-tools/uaexpert.html | OPC UA browser (manual debug) |
| 2 | opcua-commander | https://github.com/node-opcua/opcua-commander | CLI OPC UA browser (CI) |
| 3 | benthos-umh | https://learn.umh.app/course/our-open-source-docker-container-... | OPC UA → SpB bridge (Apache 2.0) |
| 4 | UA-CloudPublisher | https://github.com/barnstee/UA-CloudPublisher | OPC UA PubSub → MQTT JSON |
| 5 | korelate | https://github.com/slalaure/korelate | UNS topic visualization |
| 6 | umati demo servers | opc.tcp://opcua.umati.app:484{0,2,3} | Live OPC UA companion-spec servers for client sanity tests |

---

## C. Top-10 Short List

The 10 resources that, combined, produce the first usable MIRA benchmark fixture. Each is open-licensed, Dockerizable or trivially scriptable, and fills a distinct layer:

| # | Resource | Layer | Role in benchmark |
|---|---|---|---|
| 1 | **PackML-MQTT-Simulator** (MIT) | Live SpB | Primary line traffic — emits PackML states + counters over SpB, 3 instances = 3 lines |
| 2 | **Azure-Samples/iot-edge-opc-plc** (MIT) | Live OPC UA | Loads PackML + Pumps + MachineTool NodeSets — exercises companion-spec mapping |
| 3 | **FreeOpcUa/asyncua** (LGPL-3.0) | Live OPC UA | Python-scripted custom factory hierarchies, shares `uns.py` builders |
| 4 | **Mosquitto** (EPL/EDL) | Broker | The MQTT spine; pair with HiveMQ Sparkplug-aware extension if cert surfacing needed |
| 5 | **benthos-umh** (Apache 2.0) | Bridge | OPC UA → SpB transcoder per simulator instance |
| 6 | **Tennessee Eastman** (CC BY) + `mv-per/tennessee-eastman-dataset` (MIT) | Process replay | Full chemical-plant time-series + 21 labeled faults under named units |
| 7 | **IBM AssetOpsBench** (Apache 2.0) | WOs + manuals | 4,200 real work orders + manual references + ISO-coded FMs → seeds `cmms_work_orders` + ingest pipeline |
| 8 | **IBM FailureSensorIQ** (Apache 2.0) | KG seed | 8,296 sensor↔failure-mode pairs w/ ISO citations → seeds `kg_relationships` (status=verified) |
| 9 | **OPC Foundation UA-Nodeset** (open) | Companion specs | NodeSet XMLs for PackML / Pumps / MachineTool / IO-Link → seeds component templates |
| 10 | **IDTA AAS Nameplate (02006-3-0) + Time Series (02008)** (CC BY 4.0) | Engineering context | Per-asset shells = ground truth for nameplate extraction; TS submodel binds shell ↔ SpB topic |

**Honorable mentions** (Phase 2 / scenario extensions): SWaT (after access grant), CWRU Bearing (vibration anomaly replay), Petrobras 3W (O&G scenario), AI4I 2020 (fast CSV → MQTT smoke test), MTConnect cppagent (CNC machining scenario), DEXPI 2.0 (P&ID evidence layer), Open-Industry-Project (3D visual validation).

---

## D. "FactoryLM ProveIt Simulator" — Reference Architecture

**Goal.** A docker-composable benchmark that emits a fully-typed synthetic plant — ISA-95 hierarchy, live Sparkplug B traffic, OPC UA companion-spec address spaces, AAS Nameplate shells, alarm/fault events drawn from labeled datasets, work-order history, manual PDFs, and an answer key of verified asset/component/tag relationships — so we can score MIRA's contextualization, UNS gate, and KG-proposal layers.

```
┌──────────────────────────────────────────────────────────────────────┐
│                  FactoryLM ProveIt Simulator (compose)               │
│                                                                      │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐    │
│  │  Hierarchy   │    │           Synthetic Generators            │    │
│  │  Generator   │    │                                           │    │
│  │ (Python →    │    │  ┌─────────────┐  ┌─────────────┐         │    │
│  │  YAML        │───▶│  │ PackML-MQTT │  │  asyncua    │         │    │
│  │  manifest)   │    │  │ Simulator   │  │  OPC UA     │ ...     │    │
│  └──────────────┘    │  │ (x3 lines)  │  │ (custom)    │         │    │
│         │            │  └──────┬──────┘  └──────┬──────┘         │    │
│         │            │         │                │                │    │
│         │            │  ┌──────▼────────────────▼──────┐         │    │
│         │            │  │       Mosquitto + HiveMQ      │         │    │
│         │            │  │   Sparkplug-aware extension   │         │    │
│         │            │  └───────────────┬───────────────┘         │    │
│         │            └──────────────────┼─────────────────────────┘    │
│         │                               │                              │
│         │            ┌──────────────────▼─────────────────────────┐    │
│         │            │       Adversarial Noise Injector            │    │
│         │            │  (typo/drift/zombie/duplicate-asset rates)  │    │
│         │            └──────────────────┬─────────────────────────┘    │
│         │                               │                              │
│         │            ┌──────────────────▼─────────────────────────┐    │
│         │            │           Process Dataset Replay            │    │
│         │            │   TEP / Pump-Sensor / CWRU / Petrobras 3W   │    │
│         │            │     CSV → SpB DDATA at configurable rate    │    │
│         │            └──────────────────┬─────────────────────────┘    │
│         │                               │                              │
│         │            ┌──────────────────▼─────────────────────────┐    │
│         │            │              Event Generator                │    │
│         │            │  PackML state faults + ISO 14224 FM events  │    │
│         │            │  injected per dataset's labeled timeline    │    │
│         │            └──────────────────┬─────────────────────────┘    │
│         │                               │                              │
│         │            ┌──────────────────▼─────────────────────────┐    │
│         │            │       Doc-Pack & WO Generator               │    │
│         │            │  per asset: AAS Nameplate (02006) shell +   │    │
│         │            │  manual.pdf + datasheet.pdf + wiring.pdf +  │    │
│         │            │  parts_list.csv + AssetOpsBench WO history  │    │
│         │            │  → drops to /MiraDrop watched dir           │    │
│         │            └──────────────────┬─────────────────────────┘    │
│         │                               │                              │
│         └───────────────────────────┐   │                              │
│                                     ▼   ▼                              │
│                          ┌─────────────────────┐                       │
│                          │   GROUND TRUTH       │                       │
│                          │   answer_key.json    │                       │
│                          │  (verified rels +    │                       │
│                          │   FM↔sensor seed)    │                       │
│                          └──────────┬──────────┘                       │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │       MIRA STACK           │
                       │  mira-relay → mira-mcp →   │
                       │  mira-crawler → engine →   │
                       │  Slack bot                 │
                       └─────────────┬─────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │   Relationship-Proposal    │
                       │      Scorecard Harness     │
                       │ (precision/recall/F1 vs    │
                       │  answer_key per layer)     │
                       └────────────────────────────┘
```

### Component contracts

1. **MQTT broker** — `eclipse-mosquitto:2.0` + (optionally) HiveMQ CE 4.x with `hivemq-sparkplug-aware-extension` so the resolver can fetch live NBIRTH from `$sparkplug/certificates/*`.
2. **Sparkplug B publishers** —
   - `PackML-MQTT-Simulator` for 3 packaging/discrete lines (env vars: `SITE`, `AREA`, `LINE`, fault-rate, mode).
   - `amine-amaach/IoTSensorsMQTT-SpB` for sensor-heavy edge nodes (vibration, pressure, temp).
3. **OPC UA simulators (with companion specs)** —
   - `iot-edge-opc-plc --ns2 PackML.NodeSet2.xml` → packaging line.
   - `iot-edge-opc-plc --ns2 Pumps.NodeSet2.xml` → pump skid.
   - Custom asyncua server loading `MachineTool.NodeSet2.xml` → CNC cell.
   Each bridged to SpB via one `benthos-umh` container per OPC UA instance.
4. **CSV-replay engine** — Python service that walks `datasets/<name>/data.csv` row-by-row, projects each column onto a configured UNS path, and publishes SpB `DDATA` at simulated real-time (configurable speed-up). Initial fixtures: TEP, Pump-Sensor, CWRU.
5. **Synthetic hierarchy generator** — Python tool that reads `factory.yaml` (a declarative ISA-95 description: site → area → line → cell → component, with manufacturer/model per component) and produces:
   - `mosquitto.conf` topic ACLs
   - Per-publisher env files / NodeSet stubs
   - AAS Nameplate shells per component
   - A canonical `expected_uns_paths.json`
   - `answer_key.json` (verified relationships)
6. **Event generator** — joins dataset fault timelines with PackML state transitions: when CWRU's bearing dataset enters fault region, the corresponding asset's PackML state cycles `Execute → Holding → Held` and emits a `StopReasonCode` from the ISO 14224 vocabulary. Synthetic alarm message goes both to SpB (`<UNS>/Alarm`) and to a CMMS-style work-order file dropped to `/MiraDrop/work_orders/`.
7. **Doc-pack generator** — for each component, produces a deterministic pack:
   - `manual_<vendor>_<model>.pdf` (3-page LLM-rendered template incl. nameplate, install notes, fault codes table)
   - `datasheet_<vendor>_<model>.pdf` (1-page nameplate-style)
   - `wiring_<asset_tag>.pdf` (parametric pinout diagram)
   - `parts_list_<asset_tag>.csv`
   - `aas_<asset_tag>.aasx` (IDTA 02006 Nameplate + 02008 TS submodel + 02004 Handover docs link)
   All dropped into `/MiraDrop/` per `wiki/nodes/wiki-sync.md` watcher to exercise `mira-crawler/ingest/` end-to-end.
8. **Relationship-proposal engine harness** — calls MIRA's existing `mira-crawler/ingest/kg_writer.py` propose path with the generated docs; output relationships are diffed against `answer_key.json` and scored.
9. **MIRA test harness** — driver that:
   - Starts compose, waits for NBIRTH stabilization
   - Triggers `mira-crawler` ingest of `/MiraDrop/`
   - Asks the Slack/Telegram bot a set of golden technician questions (e.g., "Why did Conveyor C-103 stop?", "What's the part number for the seal on Pump P-201?")
   - Captures replies, citations, and groundedness scores
   - Asserts UNS gate confirmation occurred before troubleshooting
10. **Scoring** — emits a per-run scorecard (see §I).

---

## E. Three Synthetic Factory Models

### E.1 "Conveyor Plant" — Mike's garage demo, expanded

**Inspiration:** Mike's existing Factory IO sorting-by-height conveyor + Cluster PLC integration (Micro 820 + GS10 VFD + Modbus map `HR100/101/102`, `Coil0/1/2`).

| Level | Name | Notes |
|---|---|---|
| Enterprise | `factorylm` | |
| Site | `lake_wales_garage` | |
| Area | `assembly` | |
| Line | `sorter_line_1` | |
| Cells | `infeed`, `sorting`, `reject`, `outfeed` | |
| Components per cell | conveyor (motor + VFD + photoeye + e-stop), divert arm (pneumatic), HMI panel, PLC | |

**Tags:** ~120 across line. Mix of Modbus HR/coil mapped names (`HR100_motor_speed`) and OPC UA companion-spec mapped names (`Conveyor1/Motor/Speed_RPM`). Inject naming drift between layers.

**Publishers:** 1× `PackML-MQTT-Simulator` (cell-level PackML), 1× `asyncua` with Pumps/PackML NodeSets (component-level), 1× IoT sensor sim (vibration/temp).

**Faults:** Photoeye misalignment, divert arm pneumatic failure, VFD overload trip, motor bearing failure (replayed from CWRU).

**Docs:** Allen-Bradley PowerFlex 525 manual (real PDF), GS10 VFD datasheet (synthetic AAS), Factory IO sorter wiring (synthetic), PM checklist (synthetic).

**Why this model:** Mike has ground truth in his head — fastest sniff test of MIRA's groundedness scoring. Maps to the existing PLC/Cluster integration so we exercise real `mira-connect`/`mira-relay` code paths.

### E.2 "Process Plant" — TE + SWaT fusion

**Inspiration:** Tennessee Eastman chemical loop + SWaT water-treatment hierarchy, fused into a fictional 5-stage continuous-process plant.

| Level | Name | Notes |
|---|---|---|
| Enterprise | `acme_chemicals` | |
| Site | `houston_plant` | |
| Areas | `feed_handling`, `reaction`, `separation`, `utilities`, `effluent` | |
| Work centers | TE-mapped: `reactor`, `condenser`, `separator`, `stripper`, `compressor`; SWaT-mapped: `P1_raw`, `P2_chemicals`, `P3_uf`, `P4_dechlorination`, `P5_ro`, `P6_distribution` | |
| Work units | TEP XMV/XMEAS sources, SWaT FIT/LIT/MV/P assets | |

**Tags:** ~520 (TE's 52 + SWaT's 51 plus instrumentation around each unit).

**Publishers:** 1× CSV-replay engine for TEP (52 ch), 1× CSV-replay for SWaT (51 ch), 1× asyncua with Pumps NodeSet for pump skid, 1× IoT sensors for ambient/utility.

**Faults:** All 21 TEP fault classes + 41 SWaT attacks + ISO 14224 mechanical events (bearing/seal/coupling) generated per CWRU/IMS timeline.

**Docs:** TEP control narrative + Downs & Vogel paper + Siemens app note + SWaT technical report + synthetic per-pump nameplates and PM checklists.

**Why this model:** stress-tests the UNS resolver on a deep, multi-area hierarchy with two distinct naming conventions colliding. Tests groundedness on the *only* full-plant labeled dataset that's openly available.

### E.3 "Steel Works" — scale stress-test

**Inspiration:** A fictional integrated steel mill with ~50 areas, ~500 assets, ~10K tags. Synthetic only — no public dataset of this scale exists.

| Level | Notes |
|---|---|
| Enterprise | `bluescope_americas` |
| Sites | 1 (`granite_city`) |
| Areas | coke ovens, blast furnace, BOF, ladle metallurgy, continuous casting, hot-strip mill, cold-rolling, galvanizing, utilities (×10 sub-areas), shipping |
| Lines | ~50 |
| Components | ~500 (motors, pumps, hydraulic skids, gearboxes, induction furnaces, cranes) |
| Tags | ~10K |

**Publishers:** Procedurally generated by hierarchy generator — emits a mix of OPC UA companion-spec address spaces (one per equipment family) bridged to SpB.

**Faults:** Procedural — sample per-asset fault rates from ISO 14224 per-class MTBFs; inject events on Poisson process.

**Docs:** All synthetic — generator template fills the doc pack per asset from a vendor catalog.

**Why this model:** scale stress-test for MIRA's UNS resolver, KG proposal engine, deduplication, and Slack-reply latency. Also validates that the relationship-proposal scorecard converges with thousands of relationships in flight.

---

## F. UNS Generation Strategy

### F.1 Tiered scale

| Tier | Assets | Tags | Use |
|---|---|---|---|
| **S** ("Conveyor Plant") | 50 | ~5K | CI smoke / sniff test (`docker compose up` < 60s) |
| **M** ("Process Plant") | 500 | ~30K | Per-PR scoring run (~5 min) |
| **L** ("Steel Works") | 5,000 | 100K+ | Nightly full-scale benchmark |

### F.2 Naming-mess injection

Real plants are messy. Configurable injection per run:

| Mess type | How | Default rate |
|---|---|---|
| **Typos** | Random char delete/swap/dupe in vendor/model strings (`PowerFlex 525` → `Powrflx 525`) | 15% |
| **Case/separator drift** | `LineA` vs `line_a` vs `line-a` across publishers | 10% |
| **Missing nameplate fields** | Drop `SerialNumber` or `YearOfConstruction` from AAS shell | 20% |
| **Duplicate assets** | Same metric stream published under two device IDs | 5% |
| **Zombie devices** | Publish NDEATH then continue NDATA | 5% |
| **Missing NBIRTH** | Send DDATA before NBIRTH (cold join) | 10% |
| **Wrong-depth topic** | `acme/Area1/Line_A` instead of `acme/area_1/line_a` | 10% |
| **Acronym ambiguity** | `VFD` vs `Drive` vs `Inverter` for the same component | uniform |

### F.3 Per-asset attached artifacts

Every component gets a coherent pack:

1. **Manual.pdf** — 3 pages: nameplate page, install notes, fault codes table. LLM-rendered from a Jinja template.
2. **Datasheet.pdf** — 1 page nameplate-style.
3. **Wiring.pdf** — parametric pinout (SVG → PDF).
4. **Parts list.csv** — bill of materials.
5. **PM checklist.md** — preventive maintenance steps.
6. **AAS shell** — IDTA Nameplate (02006) + Technical Data (02003) + Time Series (02008) + Handover Docs (02004).

### F.4 Work-order history

Per component: 5–50 synthetic work orders sampled from AssetOpsBench template + parameterized with component-specific tag references and ISO 14224 failure modes. Span ~3 years of simulated history. Include resolved + open + in-progress states.

---

## G. Relationship Inference Benchmark — Test Cases

Each fixture run produces an `answer_key.json` that enumerates the ground-truth relationships per asset. MIRA's proposed relationships are diffed against this. Categories:

1. **`asset → component`** ("Conveyor C-103 contains motor M-103-1")
2. **`component → tag`** ("Motor M-103-1 is monitored by `Conveyor1/Motor/Speed_RPM`")
3. **`tag → unit`** ("`Conveyor1/Motor/Speed_RPM` is in RPM")
4. **`asset → manual`** ("Conveyor C-103 is documented by `manual_powerflex_525.pdf` p.14–18")
5. **`fault_code → component`** ("F0004 in PowerFlex 525 means motor overload")
6. **`fault_code → failure_mode`** (ISO 14224 mapping)
7. **`component → spare_part`** (BOM derivation)
8. **`asset → PM_schedule`** (per checklist)
9. **`asset → work_order_history`** (CMMS join)
10. **`uns_path → ISA-95 level`** (hierarchy mapping)
11. **`device_id → asset`** (Sparkplug device → physical asset)
12. **`alias `→` metric name`** (NBIRTH alias rebinding correctness)

Each relationship in `answer_key.json` carries: `subject`, `predicate`, `object`, `evidence_source` (which doc/tag/WO), `confidence` (per ISO 14224 banding), and `status` (`verified`).

---

## H. Human-Approval Workflow

MIRA's existing `kg_relationships.status` lifecycle (`proposed → verified | rejected | needs_review`) is the surface we benchmark. Per fixture run:

1. MIRA ingests `/MiraDrop/` and live SpB streams, calls `propose_relationship()` for each candidate edge.
2. Each proposal includes: `evidence_source[]`, `confidence_band`, `model_outputs`.
3. Test harness simulates an "expert reviewer" that:
   - Auto-approves proposals matching `answer_key.json` with confidence ≥ band-threshold.
   - Auto-rejects proposals that contradict `answer_key.json`.
   - Marks `needs_review` for ambiguous (correct subject, wrong predicate) cases.
4. Scorecard counts: precision (verified-correct / total proposed), recall (verified-correct / answer_key cardinality), F1, and a "wrong-confidence-band" rate.

This produces the **headline product metric**: *what % of the answer_key did MIRA propose at a confidence band that the reviewer accepted on the first pass?* Target: ≥70% by Tier-S, ≥60% by Tier-M, ≥50% by Tier-L.

---

## I. Evaluation Scorecard

| Layer | Metric | Pass threshold | Source of truth |
|---|---|---|---|
| **UNS path resolution** | F1 vs `expected_uns_paths.json` | ≥0.85 | hierarchy generator |
| **UNS gate compliance** | % of bot turns that confirm site/area/line/asset BEFORE troubleshooting | ≥0.95 | engine logs |
| **Nameplate extraction** | exact-match accuracy on Manufacturer/Model/Serial | ≥0.90 | AAS Nameplate shells |
| **Fault classification (per ISO 14224)** | weighted F1 vs labeled events | ≥0.70 | event generator |
| **Tag → component mapping** | precision @ confidence ≥ Medium | ≥0.80 | answer_key |
| **Relationship proposal** | precision / recall / F1 (per §H) | ≥0.70 P, ≥0.60 R | answer_key |
| **Citation correctness** | % of replies citing a doc / WO / tag the assertion actually appears in | ≥0.90 | citation_compliance.py + ground truth |
| **Groundedness 1–5** | mean engine.py score across golden questions | ≥4.0 | engine.py |
| **Hallucination rate** | % of replies that assert a fact not in evidence | ≤0.05 | LLM judge + spot-check |
| **Reply latency p50/p95** | s | p50 ≤6s, p95 ≤15s | bot adapters |

---

## J. Implementation Phases (1–8)

| Phase | Duration | Deliverable | Exit criterion |
|---|---|---|---|
| **1. Scaffold** | 1w | `docker-compose.benchmark.yml` w/ Mosquitto + PackML-MQTT-Simulator + asyncua skeleton | `docker compose up` brings 4 containers green |
| **2. Tier-S Conveyor** | 2w | "Conveyor Plant" hierarchy generator + answer_key + 3 publishers + 10 docs | End-to-end MIRA Slack reply with citation on golden Q |
| **3. CSV-replay** | 1w | TEP + Pump-Sensor + CWRU CSV → SpB streamer | TEP fault 6 detectable in MIRA's reply within 30s |
| **4. Doc-pack generator** | 2w | Jinja+LLM templates + AAS shells + WO history + watcher drops into `/MiraDrop/` | `mira-crawler` ingests + KG writes complete |
| **5. Tier-M Process** | 2w | "Process Plant" scaled fixture | Scorecard precision ≥0.70 on relationship proposal |
| **6. Noise injector** | 1w | Configurable mess rates (§F.2), `expected_uns_paths.json` updates accordingly | Resolver F1 ≥0.85 under default 15% typo rate |
| **7. Tier-L Steel Works** | 3w | Procedural 5K-asset hierarchy + scoring at scale | Nightly run completes <30 min, scorecard converges |
| **8. CI integration** | 1w | GH Actions workflow runs Tier-S on PRs, Tier-M nightly, Tier-L weekly; results posted to wiki | Scorecard delta surfaced in PR comments |

**Total:** ~13 weeks. Tier-S usable for golden-test work in 2–3 weeks.

---

## K. Concrete Engineering Tickets

Each ticket is sized to fit MIRA's existing module map. Format: `<scope>: <title> (estimate)`.

1. `infra: docker-compose.benchmark.yml scaffold + Mosquitto + HiveMQ-aware ext` (3d)
2. `tools/proveit: hierarchy generator — read factory.yaml → emit publishers + answer_key + UNS paths` (5d)
3. `tools/proveit: CSV-replay engine (TEP / Pump-Sensor / CWRU → SpB DDATA)` (4d)
4. `tools/proveit: doc-pack generator — Jinja PDFs + AAS Nameplate shells + WO history` (8d)
5. `tools/proveit: noise injector — typo / drift / zombie / duplicate / wrong-depth-topic` (3d)
6. `tools/proveit: event generator — join dataset fault timelines + PackML state transitions + ISO 14224 codes` (4d)
7. `mira-crawler: AAS Nameplate (IDTA 02006) parser → component_template insert` (3d)
8. `mira-crawler: enrich kg_writer to consume FailureSensorIQ seeds as `status=verified`` (2d)
9. `mira-mcp: tools to query AAS shell submodels (Nameplate, Technical Data, Time Series)` (3d)
10. `tests/benchmark: relationship scorecard harness — precision/recall/F1 vs answer_key` (5d)
11. `tests/benchmark: UNS-gate-compliance probe — assert confirm-before-troubleshoot on N golden Qs` (2d)
12. `tests/benchmark: groundedness + citation correctness scoring (extend deepeval_suite)` (3d)
13. `tools/proveit: load OPC Foundation UA-Nodeset/PackML.NodeSet2.xml + Pumps + MachineTool into asyncua` (3d)
14. `tools/proveit: benthos-umh config templates per OPC UA instance` (2d)
15. `tools/proveit: Sparkplug-aware broker test (`$sparkplug/certificates/*` cert surfacing)` (2d)
16. `wiki/benchmark: scorecard publisher — write nightly results to `wiki/benchmark/YYYY-MM-DD.md`` (2d)
17. `.github/workflows: tier-S on PRs, tier-M nightly, tier-L weekly` (3d)
18. `docs/specs: write `proveit-simulator-spec.md` formalizing factory.yaml schema + scoring methodology` (3d)
19. `tools/proveit: TEP Python reimpl integration (mv-per/tennessee-eastman-dataset)` (3d)
20. `tools/proveit: SWaT P&ID importer (after access grant) → UNS paths` (3d)
21. `tools/proveit: i3X demo endpoint snapshot tool — pull namespaces + objects nightly as a UNS sanity reference` (2d)
22. `tools/proveit: adversarial-doc generator — manuals with wrong fault codes, AAS shells with serial mismatches` (3d)

**Total raw effort:** ~70 dev-days = 14 dev-weeks (1 engineer) or 7 weeks (2 engineers).

---

## Cross-references

- Build plan: [`factorylm_proveit_simulator_build_plan.md`](./factorylm_proveit_simulator_build_plan.md)
- North-star architecture: `../THEORY_OF_OPERATIONS.md`
- Namespace builder spec: `../specs/maintenance-namespace-builder-spec.md`
- UNS-KG unification: `../specs/uns-kg-unification-spec.md`
- Phase 2 hub schema: `mira-hub/db/migrations/`
- KG writer: `mira-crawler/ingest/kg_writer.py`
- UNS path builders: `mira-crawler/ingest/uns.py` (rules in `.claude/rules/uns-compliance.md`)
- Engine groundedness: `mira-bots/shared/engine.py`
- Existing deepeval suite: `mira-bots/benchmarks/deepeval_suite.py`
