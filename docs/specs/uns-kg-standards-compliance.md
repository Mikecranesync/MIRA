---
title: "UNS + Knowledge Graph — Standards Compliance Analysis"
date: 2026-05-07
status: "Companion to uns-kg-unification-spec.md — DRAFT"
author: "Claude (CHARLIE node) on behalf of Mike Harper"
---

# UNS + Knowledge Graph — Standards Compliance Analysis

## Executive Summary

MIRA's `enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}` UNS path and its typed knowledge graph align **well** with the dominant industrial standards for equipment hierarchy (ISA-95), reliability data (ISO 14224), asset management philosophy (ISO 55000), and real-time bus semantics (Sparkplug B / OPC UA). The core design choices — hierarchical paths derived from ISA-95's physical model, typed entities that mirror ISO 14224's equipment taxonomy, and a relationship graph that is source-citable and confidence-scored — are structurally sound and defensible to a controls engineer or reliability professional. Three concrete gaps exist: (1) the UNS 7-segment path omits the ISA-95 "Work Cell" level between Line and Equipment, making it a 6-level hierarchy in practice rather than the standard's optional 7-8 levels; (2) the `fault_code` entity lacks the four NAMUR NE 107 severity signals as first-class properties; and (3) the vector-store bridge layer has no formal alignment with W3C SOSA/SSN, which matters only if MIRA adds a live sensor event stream. None of these gaps block an MVP sale to an industrial maintenance buyer; they become relevant when selling to SCADA/process-control buyers or when Layer 4 (event stream) ships.

> **2026-05-24 update — 4th gap closed (ADR-0018).** A previously-unflagged gap was identified during the namespace-builder grilling session: the `relationship_proposals.relationship_type` enum had no `DRIVES` / `IS_DRIVEN_BY` types, despite IEC 81346-1:2022 and OPC UA Robotics (OPC 40010-1) both defining this as a load-bearing semantic edge between sibling motor and VFD components. The closest existing type, `POWERED_BY`, is too generic. Hub migration `028_drives_relationship_type.sql` adds the inverse pair. See ADR-0018 and `docs/specs/maintenance-namespace-builder-spec.md` § "Component hierarchy" for the worked examples (single VFD-motor pair, two-motor VFD, common DC bus, MCC bucket). With this addition, MIRA's typed-edge vocabulary now covers OPC UA Robotics' core control references; the underlying sibling-tree-plus-typed-edge shape matches IEC 81346 reference designation, OPC UA FX `IsHostedBy` semantics, and Rockwell + Siemens vendor-tool project trees.

---

## 1. ISA-95 (ANSI/ISA-95 / IEC 62264)

### What it is

ISA-95 (international version: IEC 62264) is the enterprise-to-control integration standard. It defines a five-level functional hierarchy (Levels 0–4, from field sensors to ERP), a physical equipment hierarchy (Enterprise → Site → Area → Production Line/Process Cell → Work Cell/Unit → Equipment Module → Control Module), and data exchange models between manufacturing execution systems (MES, Level 3) and business systems (ERP, Level 4).

Reference: [ISA-95 standard page](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard) | [OPC UA ISA-95 Enum](https://reference.opcfoundation.org/ISA-95/v100/docs/7.4.1) | [IEC 62264 at ANSI](https://webstore.ansi.org/preview-pages/ISA/preview_ANSI+ISA+95.00.01-2010+(IEC+62264-1+Mod).pdf)

### What it validates in MIRA's approach

The ISA-95 `ISA95EquipmentElementLevelEnum` defines (in descending order): ENTERPRISE → SITE → AREA → PROCESSLINE / PROCESSCELL → WORKCELL / UNIT → EQUIPMENTMODULE → CONTROLMODULE. MIRA's UNS path `enterprise.{site}.{area}.{line}.{equipment}.{component}.{datapoint}` maps directly to the first 6 levels of this enum. Specifically:

- The segment order (Enterprise, Site, Area, Line, Equipment, Component) is a strict subset of the ISA-95 physical model.
- Using `.` as a separator and lower-snake-case labels is compatible with the ISA-95 hierarchical naming convention; ISA-95 itself does not mandate a specific delimiter.
- The "unassigned" subtree concept (`enterprise.unassigned.{manufacturer}.{model}`) has a precedent in ISA-95's "Functional Location" concept — equipment that is catalogued but not yet physically placed.
- The `PARENT_OF` relationship type in `kg_relationships` is the graph edge equivalent of ISA-95's parent-child equipment relationship.

The Unified Namespace (UNS) pattern — an MQTT or database topic tree organized as `Enterprise/Site/Area/Line/Equipment/Tag` — is explicitly recommended by the ISA-95 community as the canonical way to structure industrial data paths. Sources from EMQ, HiveMQ, and Prosys all confirm this alignment. See: [EMQ UNS + ISA-95 best practices](https://www.emqx.com/en/blog/incorporating-the-unified-namespace-with-isa-95-best-practices), [HiveMQ UNS guide](https://www.hivemq.com/blog/how-does-unified-namespace-uns-work-iiot-industry-40/).

### Gaps / where we deviate

| Gap | Severity for MVP (maintenance buyer) | Severity for SCADA buyer |
|-----|--------------------------------------|--------------------------|
| MIRA path has 7 segments (`enterprise.site.area.line.equipment.component.datapoint`). ISA-95 physical model has 8 addressable levels (adds `WorkCell` between `Line` and `Equipment`, and separates `EquipmentModule` from `ControlModule`). | Low — maintenance buyers don't care about Work Cell granularity | Medium — a process-control buyer integrating with a DCS may need the full 8-level path |
| MIRA uses `line` where ISA-95 uses `ProductionLine` (discrete) **or** `ProcessCell` (batch) **or** `ProductionUnit` (continuous). The spec collapses all three manufacturing types into a single `line` segment. | Low — correct for most discrete/batch maintenance scenarios | High — a continuous-process (oil/gas, chemical) buyer needs `ProcessCell` or `ProductionUnit` distinction |
| MIRA `component` maps to ISA-95 `EquipmentModule`, not `ControlModule`. There is no Control Module concept in MIRA's KG entity types. | Low — not needed until PLC tag ingestion | Medium — when OPC UA or Modbus tag data flows in, Control Module identity matters |

**The missing Work Cell level:** ISA-95 defines Work Cell (`WORKCELL`) between Production Line and the Unit/Equipment level. MIRA's 7-segment path goes `line.equipment` with no intermediate. For discrete manufacturing sites with multiple work cells per line, this means MIRA cannot distinguish "Line 3, Cell A" from "Line 3, Cell B" without hacking the `line` or `equipment` segments.

### Concrete mapping

| MIRA UNS segment | ISA-95 level | ISA-95 enum value |
|---|---|---|
| `enterprise` | Enterprise | ENTERPRISE (0) |
| `{site}` | Site | SITE (1) |
| `{area}` | Area | AREA (2) |
| `{line}` | Production Line / Process Cell / Production Unit | PRODUCTIONLINE (5) / PROCESSCELL (3) / PRODUCTIONUNIT (7) |
| *(missing)* | Work Cell / Unit | WORKCELL (6) / UNIT (4) |
| `{equipment}` | Equipment Module | EQUIPMENTMODULE (12) |
| `{component}` | Control Module | CONTROLMODULE (13) |
| `{datapoint}` | (tag/metric — below Control Module) | Not in ISA-95 physical model; maps to Sparkplug metric name |

### Action items

1. **Document the `line` ambiguity** in the spec: state explicitly that `line` maps to ISA-95 `ProductionLine` for discrete manufacturing, `ProcessCell` for batch, and `ProductionUnit` for continuous. MIRA does not differentiate at path structure; buyers must handle this via `kg_entities.properties`.
2. **Add `work_cell` as an optional 8th path segment** (or a `properties.work_cell` field on equipment entities) to satisfy work-cell-granular queries without breaking the 7-segment default.
3. **Reference ISA-95 Part 1 (ANSI/ISA-95.00.01-2010)** explicitly in the spec as the authority for the hierarchy model.

---

## 2. ISO 14224:2016

### What it is

ISO 14224:2016 ("Petroleum, petrochemical and natural gas industries — Collection and exchange of reliability and maintenance data for equipment") defines a 9-level equipment taxonomy, failure mode codes, maintenance event records, and data interchange formats for reliability databases. It is the reference standard for reliability and maintenance data in heavy industry worldwide, though it originates in the oil and gas sector.

Reference: [ISO 14224:2016 at ISO](https://www.iso.org/standard/64076.html) | [ANSI Blog summary](https://blog.ansi.org/ansi/iso-14224-2016-collection-maintenance-data/)

### What it validates in MIRA's approach

ISO 14224's hierarchy has 9 levels, split into two bands:

**Levels 1–5 (organizational context):** Industry → Business Category → Installation → Plant → Section/System

**Levels 6–9 (equipment inventory):** Equipment Unit → Subunit → Maintainable Item → Component/Part

MIRA's KG entity types map cleanly to the levels 6–9 band:

- Our `equipment` entity ≈ ISO 14224 **Equipment Unit** (Level 6): "a distinct physical item that performs a function, independently inventoried and maintained."
- Our `component` entity ≈ ISO 14224 **Subunit** (Level 7) / **Maintainable Item** (Level 8): a replaceable sub-part of the equipment unit (bearing, seal, fan). ISO 14224 distinguishes Subunit (a functional grouping within a unit, like a "compressor end") from Maintainable Item (the discrete part that is actually replaced or repaired). MIRA collapses both into `component`.
- Our `fault_code` entity ≈ ISO 14224 **Failure Mode** data element: a specific failure mode code attached to an Equipment Unit or Subunit.
- Our `pm_task` entity ≈ ISO 14224 **Preventive Maintenance Action** in the maintenance event record.
- Our `part` entity ≈ ISO 14224 **Component/Part** (Level 9): the replaceable spare.

ISO 14224 requires that each failure mode record include: failure mode, failure cause, failure effect/consequence, and detection method. MIRA's `fault_code` entity in `kg_entities.properties` can hold all four as JSONB fields.

The standard also defines that maintenance data records must link back to the Equipment Unit (Level 6), which is exactly what MIRA's `equipment_entity_id` FK on `knowledge_entries` achieves — every chunk of maintenance data (a manual, a troubleshooting procedure, a fault code description) is linked to a KG entity at the Equipment Unit level.

Sources: [Taxonomy explained by Fabrico](https://www.fabrico.io/blog/asset-hierarchy-naming-convention-guide/) | [MaintainX asset hierarchy](https://www.getmaintainx.com/blog/asset-hierarchy)

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| MIRA's `component` entity collapses ISO 14224's Level 7 (Subunit) and Level 8 (Maintainable Item) into a single type. | Low for MVP; medium for reliability-database buyers who need failure mode data at the subunit level |
| MIRA has no explicit Level 1–5 organizational hierarchy above the UNS path `enterprise.{site}`. The KG does not model "Business Category" or "Installation" as entities. | Low — these are organizational metadata, not equipment inventory |
| ISO 14224 defines failure modes as normalized codes with defined attributes (mode, cause, effect, detection method). MIRA's `fault_code` entity properties JSONB is flexible but unstandardized. | Medium — a reliability engineer will want structured failure mode attributes, not free-text JSONB |
| ISO 14224 distinguishes `equipment_class` (the make/model archetype) from `equipment_instance` (the specific serial number on the floor). MIRA currently stores both as `equipment` type entities, with instances and models conflated. | Medium — important for multi-tenant and multi-site deployments where the same model appears in many plants |

### Concrete mapping

| MIRA entity type | ISO 14224 level/concept |
|---|---|
| `equipment` | Level 6: Equipment Unit |
| `component` | Level 7: Subunit + Level 8: Maintainable Item (collapsed) |
| `fault_code` | Failure Mode record (linked to Equipment Unit) |
| `pm_task` | Preventive Maintenance Action record |
| `part` | Level 9: Component/Part |
| `manual` | (no ISO 14224 equivalent — documentation record) |
| `procedure` | Maintenance Action record |
| `specification` | Equipment Attribute / Engineering Parameter |
| `kg_entities.properties` JSONB | ISO 14224 equipment attributes (design data) |

### Action items

1. **Split `component` into `subunit` and `maintainable_item`** in a future `kg_entities.entity_type` enum extension (not MVP-blocking, but plan for it in the v4.0 type set).
2. **Add structured failure mode properties** to `fault_code` entities: `properties.failure_mode`, `properties.failure_cause`, `properties.failure_effect`, `properties.detection_method` — matching ISO 14224 Annex D failure mode taxonomy.
3. **Add `equipment_class` vs `equipment_instance` distinction** to the KG: the current `UNIQUE(tenant_id, entity_type, name)` constraint prevents this. Solution: add a `classification_type` field (`model | instance`) and a `parent_class_entity_id` FK on equipment entities.
4. **Reference ISO 14224:2016** in the spec as the authority for failure mode data element structure.

---

## 3. MIMOSA CCOM / OSA-CBM / OSA-EAI

### What it is

MIMOSA (Machinery Information Management Open Systems Alliance) produces open standards for physical asset management data exchange. The Common Conceptual Object Model (CCOM, current stable version 4.0.0) provides an XML schema for exchanging asset lifecycle data across systems — design, as-built inventory, condition-based monitoring measurements, work management, and reliability records. OSA-CBM (Open System Architecture for Condition-Based Maintenance) extends CCOM for real-time diagnostic/prognostic data pipelines.

Reference: [MIMOSA CCOM page](https://www.mimosa.org/mimosa-ccom/) | [CCOM 4.0.0 release](https://www.mimosa.org/specifications/ccom-4-0-0/) | [OSA-CBM](https://www.mimosa.org/mimosa-osa-cbm/)

### What it validates in MIRA's approach

CCOM 4.0.0 defines these primary entity types: `Asset`, `Segment` (hierarchical location unit, of which `Site` is a subclass), `Model` (equipment specification template), `Organization` (formerly Enterprise), `Measurement` (abstract base with subtypes for scalar, FFT, time-waveform, CPB data), `Event` (timestamped occurrence), `WorkOrder` (task with parent/child support), `Document` (URL or BLOB content), and `Attribute/AttributeSet` (EAV extension mechanism).

MIRA's KG maps to CCOM as follows:

- Our `equipment` entity ≈ CCOM `Asset` (a serialized physical item with lifecycle status)
- Our `kg_entities.properties` JSONB ≈ CCOM `Attribute/AttributeSet` (the EAV property mechanism)
- Our `manual` entity ≈ CCOM `Document` (URL or BLOB content linked to an asset)
- Our `pm_task` entity ≈ CCOM `WorkOrder` (task with interval)
- Our `fault_code` entity ≈ CCOM `Event` of type alarm/failure
- Our `knowledge_entries` row ≈ CCOM `Measurement` or `Document` linked to the asset
- Our `kg_relationships` source_chunk_id audit trail ≈ CCOM `InfoSource` registration (the requirement that every data element cite its source)

The CCOM philosophy of "all asset data is traceable to an InfoSource" directly validates MIRA's architectural decision to require `source_chunk_id` on every `kg_relationships` row — no edge exists without citing the chunk of content that justified it.

CCOM also mandates mandatory UUIDs on all entities (replacing the optional GUIDs of v3.x). MIRA uses `UUID PRIMARY KEY DEFAULT gen_random_uuid()` on both `kg_entities` and `kg_relationships` — this is CCOM-compatible.

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| MIRA has no `BreakdownStructure` equivalent — a named organizational structure (RCM breakdown, WBS, PBS) that groups assets by a specific view. CCOM uses this to support multiple simultaneous hierarchies over the same assets. | Low — MIRA's UNS tree is a single hierarchy; multiple views require querying by `entity_type` or tag |
| CCOM `Measurement` includes rich subtypes (FFT, time-waveform, oil analysis) for condition-based monitoring data. MIRA's Layer 4 (event stream) does not yet exist. | Not applicable for MVP |
| CCOM uses XML/XSD for data exchange. MIRA uses JSON/JSONB. No CCOM XML serialization is implemented. | Low for internal use; medium if a customer's CMMS expects CCOM XML import/export |
| CCOM supports `EffectiveDate` temporal records (history of asset state changes). MIRA has `created_at` but no effective-date version tracking on entities. | Medium — important for audit trails when equipment moves between sites |

### Concrete mapping

| MIRA concept | CCOM 4.0 entity |
|---|---|
| `kg_entities` (equipment) | `Asset` |
| `kg_entities` (manual) | `Document` |
| `kg_entities` (pm_task, work order) | `WorkOrder` |
| `kg_entities` (fault_code) | `Event` (alarm subtype) |
| `kg_relationships.source_chunk_id` | `InfoSource` audit link |
| `kg_entities.properties` JSONB | `Attribute/AttributeSet` |
| UNS path / `uns_path` | `Segment` hierarchy + `BreakdownStructure` |
| `knowledge_entries` row | `Measurement` (document-type) |
| `tenant_id` | `Organization` |

### Action items

1. **Document CCOM alignment** in the spec for customers who ask about CMMS integration — MIRA's entity model is CCOM-derivable without structural changes.
2. **Plan a CCOM XML export** for customers whose CMMS (Maximo, SAP PM, Infor EAM) ingests CCOM — this is a future integration feature, not an MVP blocker.
3. **Add `effective_from` / `effective_to` columns** to `kg_entities` for temporal asset state tracking (deferred, post-MVP).

---

## 4. W3C OWL / RDF + SOSA/SSN

### What it is

W3C OWL (Web Ontology Language) and RDF (Resource Description Framework) are the formal semantic web standards for representing knowledge graphs. SOSA (Sensor, Observation, Sample, and Actuator) and SSN (Semantic Sensor Network) are W3C ontologies specifically for modeling sensors, observations, and the things they measure. SOSA is the lightweight core; SSN is the full specification (W3C TR, 2017, updated 2023).

Reference: [SOSA/SSN W3C TR](https://www.w3.org/TR/vocab-ssn/) | [SSN 2023 edition](https://www.w3.org/TR/vocab-ssn-2023/)

### What it validates in MIRA's approach

SOSA defines these core classes:

- **`sosa:FeatureOfInterest`** — the thing whose property is being observed. Maps to MIRA's `equipment` or `component` entity.
- **`sosa:ObservableProperty`** — an observable quality of a feature of interest (temperature, vibration, current). Maps to MIRA's `specification` entity or a future Layer 4 datapoint.
- **`sosa:Sensor`** — a device that carries out an observation. No MIRA equivalent today; maps to a future `sensor` entity in Layer 4.
- **`sosa:Observation`** — the act of taking a measurement, with a result value and a timestamp. Maps to a future `uns_observations` table in Layer 4.
- **`sosa:Actuator`** — a device that changes the state of the world. Maps to equipment with a control coil (VFD enable, valve open) in Layer 4.
- **`sosa:Platform`** — an entity that hosts sensors. Maps to MIRA's `equipment` entity (a VFD hosts current and temperature sensors).

MIRA's entity-relationship model (typed nodes + typed edges + source citations) is structurally equivalent to an RDF knowledge graph — `kg_entities` rows are RDF subjects/objects, `kg_relationships` rows are RDF triples. The JSONB `properties` bag is equivalent to OWL datatype properties. This means MIRA's KG could be exported to Turtle/JSON-LD without any schema changes, which matters if a customer's enterprise knowledge base is OWL-based.

The key SOSA validation: MIRA's `equipment` → `HAS_FAULT` → `fault_code` relationship is analogous to `sosa:FeatureOfInterest` → `sosa:hasProperty` → `sosa:ObservableProperty` → `sosa:Observation.hasSimpleResult`. This structural homology is exactly right for Layer 4.

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| MIRA has no `Sensor` entity type. A future `sensor` entity should be added when Layer 4 ships, with `equipment HAS_SENSOR sensor` and `sensor MEASURES specification` relationships. | Not applicable for MVP |
| MIRA has no `Observation` record structure for real-time readings. The `uns_observations` table mentioned in §3.4 of the unification spec is the placeholder. | Not applicable for MVP |
| MIRA does not use OWL-DL reasoning or SPARQL. The KG is not exposed as a SPARQL endpoint. | Low — no industrial maintenance buyer needs SPARQL today |
| SOSA distinguishes `sosa:Sample` from `sosa:FeatureOfInterest` (a sample is a proxy for the real thing, e.g., an oil sample represents the gearbox). MIRA has no sampling concept. | Low — not relevant until lab analysis integration |

### Concrete mapping

| SOSA/SSN class | MIRA concept | Layer |
|---|---|---|
| `sosa:FeatureOfInterest` | `kg_entities` (equipment / component) | Layer 2 (KG) |
| `sosa:ObservableProperty` | `kg_entities` (specification) | Layer 2 (KG) |
| `sosa:Sensor` | Future `sensor` entity type | Layer 4 (not built) |
| `sosa:Observation` | Future `uns_observations` table | Layer 4 (not built) |
| `sosa:Actuator` | Future actuator entity type | Layer 4 (not built) |
| `sosa:Platform` | `kg_entities` (equipment) | Layer 2 (KG) |
| RDF triple (subject, predicate, object) | `kg_relationships` row (source_entity, relation_type, target_entity) | Layer 2 (KG) |
| OWL datatype property | `kg_entities.properties` JSONB field | Layer 2 (KG) |
| OWL object property | `kg_relationships.relation_type` | Layer 2 (KG) |

### Action items

1. **Reserve `sensor` and `actuator` in `entity_type` enum** now (even as unused values) so that Layer 4 additions do not require a migration.
2. **Add `MEASURES` and `LOCATED_ON` to the `relation_type` set** for future sensor→specification and sensor→platform relationships.
3. **Document the RDF isomorphism** — note in the spec that `kg_entities` + `kg_relationships` is an embedded RDF graph and can be exported to JSON-LD via a simple query.

---

## 5. OPC UA (IEC 62541)

### What it is

OPC UA (Unified Architecture), standardized as IEC 62541, is the dominant industrial interoperability protocol. It defines a secure, transport-agnostic communication architecture AND a rich information modeling layer (the "AddressSpace" — a directed graph of typed nodes). OPC UA Companion Specifications extend the base model for specific domains; the ISA-95 Companion Specification (published by OPC Foundation) maps ISA-95 entities to OPC UA object types.

Reference: [OPC UA IEC 62541 overview](https://scadaprotocols.com/opc-ua-protocol-explained/) | [OPC Foundation ISA-95 page](https://opcfoundation.org/markets-collaboration/isa-95/) | [OPC UA ISA-95 Common Object Model](https://reference.opcfoundation.org/ISA-95/v100/docs/)

### What it validates in MIRA's approach

The OPC UA AddressSpace is a directed graph of typed `Node` objects connected by typed `References`. This is structurally identical to MIRA's `kg_entities` (nodes) + `kg_relationships` (references). The OPC UA ISA-95 Companion Specification defines:

- **Equipment Classes** → OPC UA `ObjectTypes` (the template/archetype of an equipment model).
- **Equipment Instances** → OPC UA `Object` nodes conforming to a class (a specific serial-numbered unit on the floor).
- **Equipment Properties** → OPC UA `Variables` with `VariableTypes`.
- **Nested Equipment** → hierarchical `Object` references (a control module inside an equipment module).

MIRA's UNS path `enterprise.stardust_racers.pump_station.sump.vfd_07.motor_current` can be read as an OPC UA NodeId path — OPC UA uses `/` separators and a `ns=<namespace-index>;s=<string>` format, but the hierarchical path concept is identical. Tools that browse OPC UA trees (like UaExpert) would render MIRA's UNS as a tree identical to the AddressSpace tree.

The OPC UA ISA-95 `ISA95EquipmentElementLevelEnum` (fetched directly from the OPC Foundation reference server) defines 15 levels. MIRA uses 7 of them. The OPC UA model explicitly supports the "OTHER" level for custom extensions, which is where MIRA's `unassigned` subtree would live.

The OPC Foundation also supports OPC UA **PubSub over MQTT**, which bridges OPC UA and Sparkplug B — an OPC UA server can publish its AddressSpace as MQTT topics using the same hierarchy as the UNS. This means a future MIRA deployment that connects to an OPC UA-enabled PLC (Siemens S7, Allen-Bradley Logix, Beckhoff TwinCAT) could directly populate `kg_entities` from the OPC UA AddressSpace without any mapping layer, because the path structure is the same.

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| MIRA does not distinguish `Equipment Class` (the type/model archetype) from `Equipment Instance` (the serial-numbered physical unit). OPC UA requires this distinction. | Medium — important when the same PowerFlex 525 model appears in 5 sites; the ISA-95 Q7 (§9 of the unification spec) is directly related to this gap |
| OPC UA uses `NodeId` (namespace + string or integer identifier), not a human-readable path. MIRA's `uns_path` ltree is closer to OPC UA's `BrowsePath` (the human-readable traversal path), which is distinct from `NodeId`. | Low — MIRA can maintain both a `uns_path` (browseable path) and a UUID `id` (stable identifier) without conflict |
| OPC UA node types have `Description`, `DisplayName`, and `BrowseName` as first-class attributes. MIRA's `kg_entities` has only `name`. `DisplayName` (user-facing) vs `BrowseName` (API key) vs `name` (storage key) is a real distinction. | Low for MVP; medium when building the UNS browser UI |
| OPC UA companion specs (Devices, Machinery, PackML) define standardized property sets for equipment categories. MIRA's `properties` JSONB is unstructured and not aligned to any companion spec's property set. | Low — not needed until a SCADA buyer requires OPC UA companion spec compliance |

### Concrete mapping

| MIRA concept | OPC UA concept |
|---|---|
| `kg_entities` row | OPC UA `Object` node |
| `kg_entities.entity_type` | OPC UA `ObjectType` (class) |
| `kg_entities.properties` JSONB | OPC UA `Variable` nodes on the Object |
| `kg_relationships` row | OPC UA `Reference` (typed edge) |
| `kg_relationships.relation_type` | OPC UA `ReferenceType` |
| `uns_path` (ltree) | OPC UA `BrowsePath` |
| `kg_entities.id` (UUID) | OPC UA `NodeId` |
| UNS `enterprise.site.area` prefix | OPC UA `Namespace` + folder nodes |
| Equipment entity (model archetype) | OPC UA `ObjectType` |
| Equipment entity (floor instance) | OPC UA `Object` of that `ObjectType` |

### Action items

1. **Add `equipment_class` entity type** (as noted in ISO 14224 action items) — this directly resolves the OPC UA class/instance gap and the unification spec's §9 Q7 multi-tenancy question.
2. **Store `display_name` as a property** in `kg_entities.properties.display_name` to support future UNS browser UI requirements.
3. **Note in the spec** that `uns_path` functions as the OPC UA `BrowsePath` and should be kept stable (no re-pathing without migration) because external OPC UA clients may hold references by path.

---

## 6. Sparkplug B (Eclipse Tahu / Eclipse Foundation)

### What it is

Sparkplug B is an open MQTT topic namespace and payload specification for industrial IoT, maintained by the Eclipse Foundation (Eclipse Tahu project, specification version 3.0.0). It defines the exact MQTT topic structure: `spBv1.0/{group_id}/{message_type}/{edge_node_id}/{device_id}` and a Protocol Buffer payload format with typed metrics, birth/death certificates, and aliased metric names for bandwidth efficiency.

Reference: [Sparkplug 3.0.0 specification (PDF)](https://sparkplug.eclipse.org/specification/version/3.0/documents/sparkplug-specification-3.0.0.pdf) | [Eclipse Sparkplug GitHub](https://github.com/eclipse-sparkplug/sparkplug)

### What it validates in MIRA's approach

Sparkplug B's topic namespace uses 4–5 segments: `spBv1.0 / group_id / message_type / edge_node_id / [device_id]`. MIRA's UNS path uses 7 segments. The mapping is not a 1:1 substitution — it is a layered translation:

| Sparkplug B segment | MIRA UNS mapping |
|---|---|
| `spBv1.0` | Protocol prefix (not in MIRA path — metadata) |
| `{group_id}` | `enterprise.{site}.{area}` (3 MIRA segments) |
| `{message_type}` | Implicit in payload type (NBIRTH/DBIRTH/NDATA/DDATA) |
| `{edge_node_id}` | `{line}.{equipment}` (2 MIRA segments) |
| `{device_id}` | `{component}` (1 MIRA segment) |
| (metric name in payload) | `{datapoint}` (1 MIRA segment) |

This mapping is valid and is consistent with the community practice of combining ISA-95 with Sparkplug B. The `{datapoint}` segment in MIRA's path is equivalent to the Sparkplug metric name inside the payload — in the MQTT world, metric names live in the payload (not the topic), but in a database UNS the metric name is a topic-level path segment. This is a deliberate design choice in MIRA (persisted UNS vs. live MQTT UNS) and is not a conflict.

Sparkplug B message types (NBIRTH, DBIRTH, NDATA, DDATA, NDEATH, DDEATH) have direct relevance to MIRA Layer 4 (event stream):
- NBIRTH/DBIRTH → populate or update `kg_entities` with equipment identity
- NDATA/DDATA → write to `uns_observations` table
- NDEATH/DDEATH → mark equipment as offline in `kg_entities.properties`

The `{group_id}` in Sparkplug B is most naturally the ISA-95 site or area name — which is exactly `enterprise.{site}.{area}` in MIRA's path.

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| Sparkplug B uses `/` as separator; MIRA uses `.`. A future MQTT broker integration requires a translation layer (replace `.` with `/`, prepend `spBv1.0`, extract metric name from final segment). This is a 10-line transform, not a structural incompatibility. | Low |
| Sparkplug B `group_id` and `edge_node_id` have maximum length constraints (256 chars UTF-8). MIRA ltree labels are constrained to `[a-z0-9_]+` — this is *more* restrictive than Sparkplug B and is fully compatible. | Not a gap — MIRA is stricter, which is good |
| Sparkplug B metric names can contain `/` for hierarchical metric naming (e.g., `Inputs/MotorRunning`). MIRA's `{datapoint}` segment is a single label with no sub-hierarchy. | Low — can be resolved with `_` encoding when translating |
| MIRA has no concept of NBIRTH/DBIRTH birth certificate payload, which is how Sparkplug defines the initial schema for a device's metrics. This matters for Layer 4. | Not applicable for MVP |

### Concrete mapping

| Sparkplug B concept | MIRA concept |
|---|---|
| `group_id` | `enterprise.{site}.{area}` (3 UNS segments joined) |
| `edge_node_id` | `{line}.{equipment}` (2 UNS segments joined) |
| `device_id` | `{component}` |
| metric name (in payload) | `{datapoint}` (7th UNS segment) |
| NBIRTH/DBIRTH | Ingest-time `kg_entities` upsert |
| NDATA/DDATA | Layer 4 `uns_observations` write |
| NDEATH/DDEATH | `kg_entities.properties.online = false` |

### Action items

1. **Add a `to_sparkplug_topic()` utility function** to the spec (or the MCP tools layer) that translates a MIRA UNS path to a Sparkplug B topic: `enterprise.site.area.line.eq.comp.dp` → `spBv1.0/enterprise-site-area/NDATA/line-eq/comp` (metric=`dp`). This makes Layer 4 integration a one-liner.
2. **Document the `.` → `/` translation rule** explicitly in the spec so future engineers don't treat it as a breaking change.
3. **Reserve `NBIRTH` and `DBIRTH` as future `relation_type` values** — or more precisely, document that the Celery ingest path is the offline equivalent of a Sparkplug NBIRTH message.

---

## 7. NAMUR NE 107

### What it is

NAMUR NE 107 ("Self-monitoring and diagnostics of field devices") is a recommendation from the NAMUR user association (German process industry) that defines four standardized device health status signals. It is widely implemented in smart field devices (transmitters, valve positioners, analyzers) and supported by industrial protocols (HART, PROFIBUS, FF, IO-Link). It reduces complex device diagnostics to four operator-actionable signals.

Reference: [NAMUR NE107 revision notice](https://www.namur.net/en/publications/news-archive/ne107-self-monitoring-and-diagnostics-of-field-devices-has-been-revised.html) | [Endress+Hauser NE107 explainer](https://www.endress.com/en/support-overview/learning-center/namur-ne-107)

### What it validates in MIRA's approach

NE 107 defines exactly four status signals:

| Signal | NE 107 symbol | Severity | Meaning |
|---|---|---|---|
| **Failure** (F) | Red diamond | Critical | Invalid measurement; device malfunction; immediate attention required |
| **Function Check** (C) | Orange circle | Low | Temporarily invalid signal (loop test, calibration, forced output) |
| **Out of Specification** (S) | Yellow triangle | Medium | Device operating outside its rated range; signal may be degraded |
| **Maintenance Required** (M) | Blue wrench | Low | Predictive indicator; device functions but approaching end-of-life or service interval |

MIRA's `fault_code` entity is the right place to attach NE 107 status. Each device diagnostic message in a PLC or field device maps to one of these four signals. If MIRA ingests PLC diagnostic logs or HART device status messages, the `fault_code.properties` JSONB should include a `ne107_status` field with one of `{F, C, S, M}`.

This is directly actionable for MIRA's `pm_task` logic: a `fault_code` with `ne107_status = "M"` (Maintenance Required) should automatically create or flag a `pm_task` entity. The unification spec already supports this chain (`fault_code CAUSED_BY pm_task` or a new `TRIGGERS_PM` relation type).

The NE 107 signal also informs the priority with which the diagnostic state machine (DST) in `mira-bots/shared/engine.py` should escalate: Failure → immediate STOP escalation (already handled by `SAFETY_KEYWORDS` in `guardrails.py`); Maintenance Required → schedule PM; Out of Specification → escalate to engineer; Function Check → ignore (expected transient).

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| MIRA's `fault_code` entity has no `ne107_status` field. All four signals are unmapped. | Low for MVP (fault codes from manuals, not live devices); medium when PLC diagnostic ingestion begins |
| MIRA has no concept of "device diagnostic is configurable" — NE 107 explicitly allows each device manufacturer to configure which internal diagnostic maps to which of the 4 signals. MIRA treats all fault codes as equally structured. | Low — not needed until device-level diagnostic integration |
| NE 107 defines specific visual representations (colors, symbols) for operator displays. MIRA's Hub UI does not implement these. | Low — UI design concern |

### Concrete mapping

| NE 107 signal | MIRA entity / property |
|---|---|
| Failure (F) | `fault_code` with `properties.ne107_status = "F"` + `properties.severity = "critical"` |
| Function Check (C) | `fault_code` with `properties.ne107_status = "C"` + `properties.severity = "informational"` |
| Out of Specification (S) | `fault_code` with `properties.ne107_status = "S"` + `properties.severity = "warning"` |
| Maintenance Required (M) | `fault_code` with `properties.ne107_status = "M"` → triggers `HAS_PM` edge to a `pm_task` |

### Action items

1. **Add `ne107_status` to `fault_code` entity schema** in the spec: `properties.ne107_status: "F" | "C" | "S" | "M" | null`. Default null for fault codes from manuals (no NE 107 metadata available from text). Populated when PLC diagnostic logs are ingested.
2. **Add `TRIGGERS_PM` relation type** to `kg_relationships.relation_type` enum — connects a `fault_code` with `ne107_status = "M"` to an auto-created `pm_task`.
3. **Update the DST escalation logic** in the spec's Phase 5 description to note that NE 107 severity governs the escalation path.

---

## 8. ISO 55000 (Asset Management)

### What it is

ISO 55000 (2014, updated 2024) is the international asset management standard, providing vocabulary, overview, and principles. ISO 55001 is the requirements standard; ISO 55002 is the implementation guide. Together they define what an asset management system must do at the organizational level — not how to build the software, but what capabilities the software must enable.

Reference: [ISO 55000:2024](https://www.iso.org/standard/83053.html) | [ISO 55000:2014](https://www.iso.org/standard/55088.html) | [ISO 55000 overview at Asset Leadership Network](https://www.assetleadership.net/iso55000-base/iso-55000-asset-management-overview/)

### What it validates in MIRA's approach

ISO 55000 defines an "asset" as "an item, thing, or entity that has potential or actual value to an organization." It explicitly covers physical assets (equipment, infrastructure), intangible assets (knowledge, procedures), and information assets (maintenance records). MIRA's KG models all three:

- Physical assets → `equipment` and `component` entities
- Knowledge/procedures → `manual`, `procedure`, `fault_code`, `pm_task` entities
- Information assets → `knowledge_entries` rows linked via `equipment_entity_id`

ISO 55000 requires that organizations maintain an **asset inventory** (a register of all assets with their attributes, location, and condition). MIRA's `kg_entities` table with `uns_path` is exactly an asset inventory — every piece of equipment in the KG has a unique identity (`id` UUID), an address (`uns_path`), attributes (`properties` JSONB), and linkage to its knowledge base.

ISO 55000 also requires **lifecycle management** — assets must be tracked through acquisition, operation, maintenance, and disposal. MIRA's event stream (Layer 4, deferred) and work order integration (`mira-cmms`) form the operational and maintenance lifecycle layer. The KG provides the identity spine on which lifecycle events are hung.

ISO 55000's requirement for **capable information/decision-support systems** is the organizational justification for building MIRA's UNS+KG at all. A controls engineer or facility manager presenting to their management can cite ISO 55000 as the reason they need a unified equipment registry — and MIRA's architecture is the technical implementation of that requirement.

The 2024 edition adds stronger focus on **outcomes** of asset management activities, which aligns with MIRA's plan-vs-actual signal in the diagnostic engine (§5 of the unification spec) — MIRA's KG measures actual fault frequency vs. planned PM interval, which is exactly what ISO 55000 means by "performance monitoring and measurement."

### Gaps / where we deviate

| Gap | Severity |
|-----|----------|
| ISO 55000 requires a **Strategic Asset Management Plan (SAMP)** that aligns asset decisions with organizational objectives. MIRA has no SAMP-aware feature — it does not connect PM scheduling to budget constraints or organizational risk tolerance. | Low — this is management process, not software; MIRA provides the data; the customer writes the SAMP |
| ISO 55000 includes financial assets and intangible assets in scope. MIRA focuses on physical and knowledge assets only. | Not a gap — MIRA is a maintenance platform, not an EAM/ERP |
| ISO 55000 requires periodic audits of the asset register for completeness and accuracy. MIRA has no audit workflow — no "confirm this entity still exists" feature. | Medium — the Hub's UNS browser with an "Unassigned" queue is a partial solution; a formal audit workflow is not in the MVP |

### Concrete mapping

| ISO 55000 concept | MIRA implementation |
|---|---|
| Asset inventory / register | `kg_entities` table with `uns_path` |
| Asset identity | `kg_entities.id` (UUID) + `uns_path` (browseable address) |
| Asset attributes | `kg_entities.properties` JSONB |
| Knowledge / procedure assets | `manual`, `procedure`, `fault_code`, `pm_task` entities |
| Lifecycle management | `mira-cmms` work orders + Layer 4 event stream (deferred) |
| Information / decision support system | MIRA platform as a whole |
| Performance monitoring | Plan-vs-actual signal in diagnostic engine |
| Asset condition tracking | `fault_code` events + `pm_task` completion records |

### Action items

1. **Reference ISO 55000 in sales materials** — the MIRA pitch to a facility manager can be framed as "ISO 55000 requires a capable information system for your asset management; MIRA is that system."
2. **Add a `condition_state` property** to equipment entities (`properties.condition_state: "unknown" | "good" | "degraded" | "failed"`) to enable ISO 55000 asset condition tracking without a separate table.
3. **Plan a "Stale Entity Audit" feature** for post-MVP — a Hub view that shows equipment entities not updated in >N days, prompting operators to confirm or remove them.

---

## Standards Compliance Matrix

The following table scores alignment across the four layers defined in the unification spec:

| Standard | Layer 1: UNS Path | Layer 2: Knowledge Graph | Layer 3: Vector Store | Layer 4: Event Stream |
|---|---|---|---|---|
| **ISA-95** | ✅ Aligned (7/8 levels, `line` collapses 3 types) | ✅ Aligned (PARENT_OF, HAS_COMPONENT mirror ISA-95 relationships) | ✅ Aligned (equipment_entity_id provides ISA-95-level filtering) | ✅ Aligned (forward-compat path design) |
| **ISO 14224** | ⚠️ Partial (path stops at Level 6 Equipment Unit; no Level 7/8 subunit/maintainable-item distinction) | ⚠️ Partial (`component` collapses Level 7+8; no structured failure mode attributes) | ✅ Aligned (FK to equipment entity is ISO 14224 Level 6 linkage) | N/A |
| **MIMOSA CCOM** | ⚠️ Partial (no BreakdownStructure; no effective-date versioning) | ✅ Aligned (Asset, Document, WorkOrder, Event, InfoSource all mapped) | ✅ Aligned (knowledge_entries ≈ CCOM Measurement) | ⚠️ Partial (no OSA-CBM signal subtypes) |
| **W3C OWL/SOSA** | ✅ Aligned (path is OWL instance IRI-compatible) | ✅ Aligned (kg_entities+relationships is RDF-isomorphic; FeatureOfInterest/Property mapped) | ✅ Aligned (vector chunks linkable to OWL individuals via entity FK) | ❌ Gap (no Sensor, Observation, Actuator entities yet) |
| **OPC UA** | ⚠️ Partial (uns_path ≈ BrowsePath; no NodeId mapping; no Class vs Instance distinction) | ⚠️ Partial (entity model maps but lacks Equipment Class/Instance split) | ✅ Aligned (N/A to OPC UA directly) | ⚠️ Partial (OPC UA PubSub path compatible but not implemented) |
| **Sparkplug B** | ✅ Aligned (7-segment path maps cleanly via `.`→`/` transform) | ✅ Aligned (NBIRTH/DBIRTH events map to kg_entities upsert) | N/A | ⚠️ Partial (Layer 4 design matches; no broker yet) |
| **NAMUR NE 107** | N/A | ❌ Gap (`fault_code` entity lacks ne107_status field; 4 signals unmapped) | N/A | ⚠️ Partial (would need live device data) |
| **ISO 55000** | ✅ Aligned (uns_path + UUID = ISO 55000 asset identity + registry) | ✅ Aligned (KG provides the information system ISO 55000 requires) | ✅ Aligned (knowledge assets in vector store are ISO 55000 in scope) | ✅ Aligned (event stream = lifecycle tracking) |

**Legend:** ✅ Aligned = no blocking gaps | ⚠️ Partial = gaps exist but non-blocking for MVP | ❌ Gap = missing, action required

---

## Recommendations

The following are concrete, prioritized changes to `docs/specs/uns-kg-unification-spec.md` and the implementation plan. Items marked **[MVP]** should be addressed before or during the 5-phase implementation. Items marked **[Post-MVP]** are deferred.

### Immediate spec clarifications (cost: zero, editorial only)

1. **[MVP] Clarify `line` segment ambiguity.** Add a note in §3.1 that `line` maps to ISA-95 `ProductionLine` (discrete), `ProcessCell` (batch), or `ProductionUnit` (continuous) depending on manufacturing type. MIRA does not distinguish at path level; buyers configure via `kg_entities.properties.manufacturing_type`.

2. **[MVP] Add ISA-95 reference.** Cite ANSI/ISA-95.00.01-2010 (IEC 62264-1) in §11 References as the authority for the equipment hierarchy model.

3. **[MVP] Add ISO 14224:2016 reference.** Cite ISO 14224:2016 in §11 References as the authority for failure mode data element structure.

4. **[MVP] Document the `uns_path` ↔ Sparkplug B ↔ OPC UA BrowsePath equivalence** in §3.1 to help future engineers understand the three representations of the same hierarchy.

### Schema additions (cost: migration + code)

5. **[MVP] Add `ne107_status` to `fault_code` entity properties schema.** Field: `properties.ne107_status: "F" | "C" | "S" | "M" | null`. Null by default; populated by PLC diagnostic ingestion. This is a JSONB field addition — no migration required.

6. **[MVP] Add `condition_state` to equipment entity properties.** Field: `properties.condition_state: "unknown" | "good" | "degraded" | "failed"`. Default `"unknown"`. Updated by diagnostic engine based on fault_code and pm_task signals.

7. **[MVP] Add `TRIGGERS_PM` to `relation_type` enum.** Connects a `fault_code` (especially `ne107_status = "M"`) to an auto-created `pm_task`. Documents the NE 107 → PM workflow in the graph.

8. **[Post-MVP] Split `component` entity_type into `subunit` and `maintainable_item`.** Required for ISO 14224 Level 7/8 compliance. Non-breaking if done via migration with backfill (all existing `component` rows become `maintainable_item`).

9. **[Post-MVP] Add `equipment_class` entity_type.** Resolves the ISA-95/OPC UA class-vs-instance distinction and the unification spec §9 Q7 multi-tenancy question. Requires adding `parent_class_entity_id UUID REFERENCES kg_entities(id)` column.

10. **[Post-MVP] Reserve `sensor` and `actuator` in entity_type.** Add to the spec's entity type list as "reserved for Layer 4, not yet implemented."

### UNS path structure (cost: low, editorial + possible future migration)

11. **[Post-MVP] Consider an optional `work_cell` segment** between `line` and `equipment` for customers with work-cell-granular requirements. Can be implemented as an optional segment (making the path 6–8 segments variable) or as a `properties.work_cell` field on equipment entities. The current 7-segment fixed design is simpler; document the tradeoff.

### Sales and positioning

12. **[MVP] Cite ISO 55000:2024** in customer-facing materials as the organizational mandate that MIRA's asset registry fulfills.

13. **[MVP] Add a "Standards Compliance" section to MIRA's product one-pager** citing ISA-95, ISO 14224, and NAMUR NE 107 alignment — these are recognized by any controls engineer and signal product seriousness.

---

*This document is a companion to `docs/specs/uns-kg-unification-spec.md`. It is maintained by the CHARLIE node and should be updated whenever the unification spec changes or a new standard becomes relevant.*

*Primary sources consulted: ISA.org, ISO.org, OPC Foundation Reference Server (reference.opcfoundation.org), W3C TR (w3.org), Eclipse Sparkplug Foundation (sparkplug.eclipse.org), MIMOSA.org, NAMUR.net, Endress+Hauser, EMQ, HiveMQ, Prosys OPC, Fabrico, MaintainX.*
