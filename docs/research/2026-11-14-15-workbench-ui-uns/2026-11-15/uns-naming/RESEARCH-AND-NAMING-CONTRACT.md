# MIRA / FactoryLM: UNS terminology and naming contract

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../README.md) and [private-evidence policy](../../PRIVATE-EVIDENCE.md).


Research date: 15 November 2026. Status: recommendation for the existing architecture and UI work. No runtime, PLC, schema, namespace, deployment or Mission Control changes were made while conducting this research. This copy is now published as research; adoption is a separate decision. Examples marked proposed are not existing database fields or controller symbols.

**Recommendation:** Preserve the source system's identifiers exactly, map them explicitly to equipment and signals, and present useful names without changing identity. A PLC symbol, equipment designation, human label, database ID and UNS address are separate concepts.

**What Walker Reynolds actually describes**

In a firsthand interview, Reynolds describes a shared information structure with events, organized around the business and extended with functional namespaces where appropriate. PLCs and applications retain their own namespaces; the shared namespace supplies context and publishing structure. He recommends MQTT while distinguishing the architectural idea from a particular transport. His criteria include edge-driven information, report by exception, lightweight integration and open architecture. See the transcript at 19:27–22:02 and 23:56–26:00. This supports an explicit mapping layer; it does not establish a universal PLC variable prefix convention. [Walker Reynolds interview](https://element8.co.za/Resources/the-role-of-the-unified-namespace-with-walker-reynolds/)

This is alignment with documented principles, not an endorsement by Reynolds. This review did not inspect every course or video.

**How established platforms separate these concerns**

| Platform | Documented distinction | Implication for MIRA |
|---|---|---|
| Litmus Edge DeviceHub | A tag collects a device value. Internal raw topics use device/tag IDs; alias topics use device/tag names. Special characters in aliases become underscores. | Preserve native addresses and IDs, record generated aliases, and detect collisions when mapping names. An internal broker topic is not automatically the enterprise UNS path. |
| Litmus digital twins | Models define attributes; instances map dynamic attributes to topics and carry static context. | Separate catalog/model definitions, installed equipment and signal bindings. |
| Ignition | An Ignition tag can have a different name from its underlying OPC source. Tags can be organized in folders. | Expose both the browsable signal name and its source binding. |
| HighByte Intelligence Hub | Namespace nodes reference inputs or modeled instances; hierarchy can determine an MQTT output topic. | Model information independently of a controller's register layout and the output transport. |
| OPC UA | NodeId identifies a node; BrowseName supports browsing; DisplayName serves people. BrowseName alone need not be unique across the server. | Keep identity, qualified browsing name and display text separate. |

Sources: [Litmus tags](https://docs.litmus.io/litmusedge-v3/product-features/devicehub/tags), [Litmus digital twins](https://docs.litmus.io/litmusedge-v3/product-features/digital-twins), [Ignition tags](https://www.docs.inductiveautomation.com/docs/8.1/platform/tags), [HighByte namespaces](https://support.highbyte.com/kb/getting-started/configuration/getting-started-namespaces-and-smart-query), [OPC UA node attributes](https://reference.opcfoundation.org/specs/OPC-10000-3/5.2).

Alias collision detection is our integration requirement, not a claim that a particular vendor has an observed collision defect. Pin the installed product versions and connector configuration before implementation.

**Vocabulary for the UI and contracts**

| Term | Meaning in MIRA | Important boundary |
|---|---|---|
| Equipment ID | Internal identity of an equipment record | Opaque; never derived from an editable label |
| Equipment designation / equipment tag | Plant or drawing identifier, such as Q1 or VFD1 | Qualified by its placement; Q1 can recur on other machines |
| Physical label | Text actually attached to the equipment | Record evidence and spelling; do not silently replace it |
| Display name | Human-readable name shown in navigation | Editable presentation, not a routing key |
| Search alias | An additional name used to find the same record | Must resolve in context; ambiguity requires selection |
| Model / catalog number | Identity of a product design | Not the identity of an installed individual |
| PLC tag / symbol | Exact symbolic variable in a controller, with its scope | Preserve spelling, case and scope; a description is not a symbol |
| Source address | Driver-specific register, bit, OPC UA node or other binding | May differ from the PLC symbol; retain addressing convention and source identity |
| Signal | A named value with meaning, type, source, time and quality | Distinguish command, feedback, measurement, setpoint and derived state |
| UNS path | Contextual address in the shared information hierarchy | Not interchangeable with equipment ID or display name |
| MQTT topic | Transport address used to publish/subscribe | A protocol binding of information, not necessarily the entire semantic hierarchy |
| Sparkplug metric / alias | A payload metric and its protocol-defined numeric alias | The numeric alias is not a technician's equipment nickname |

Use qualified labels such as **Equipment tag**, **PLC tag**, **Physical label** and **Signal**. Avoid a generic editable field called **Tag** when multiple meanings are possible. Do not use **tag** for arbitrary colored UI chips in this equipment flow.

**Apply it to the actual bench records**

| Concept | Recorded value | Evidence boundary |
|---|---|---|
| Machine equipment number | CV-101 | Existing identity contract |
| Machine display name | Discharge Conveyor | Existing identity contract |
| Component drawing designation | Q1 | Checked-in electrical model |
| Physical label | MLC | Historical photo/technician evidence recorded in that model |
| Product type and model | Control relay; Schneider CA3KN22BD | Checked-in model; role and product classification remain separate |
| PLC output symbol | `_IO_EM_DO_02` | Checked-in CCW variable record |
| I/O terminal designation | `O-02` | Same record |
| Output description | `ContactorQ1 (safety power)` | Description column, not proof of a PLC symbol named `ContactorQ1` or a safety rating |

Sources: [electrical equipment record](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/plc/conv_simple_electrical/model/devices.yaml#L93), [CCW variable record](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/plc/CCW_VARIABLES_v4.0.txt#L80). These are repository evidence, not a new readback of the installed controller or a new electrical inspection. Historical role notes contain revisions; preserve their provenance rather than promote an old description to current proof.

Proposed equipment header: **Q1 · MLC**, followed by **Control relay · CA3KN22BD** and its machine breadcrumb. Put source bindings in equipment details. A reported PLC output bit is not confirmation of contact position, voltage at the load, or a safety function. If contact feedback has no source, show **Not observed**, not **Closed**. Correct the navigation fixture that represented MLC as PLC1/Micro820 before using it as acceptance evidence.

**PLC conventions from the start**

There is no single vendor-neutral syntax that describes all existing PLC symbols. Rockwell Logix permits names up to 40 characters, with letters, digits and underscores and additional placement rules; its names are case-insensitive. Rockwell's design guidance encourages meaningful names connected to drawings and machine design. These are Logix rules, not a substitute for checking the bench's Micro800/CCW rules. [Logix tags manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/pm/1756-pm004_-en-p.pdf), [Logix design guidance](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm094_-en-p.pdf)

Siemens distinguishes symbolic names from absolute addresses, with scope and block structure also affecting the reference. [TIA Portal operand documentation](https://docs.tia.siemens.cloud/r/en-us/v20/programming-basics/using-and-addressing-operands/basic-information-about-operands)

For newly authored project symbols, propose a plant-approved profile: descriptive names, a conservative letter/digit/underscore alphabet, a leading letter, no case-only distinctions, and explicit roles. Example role suffixes could be `Cmd`, `Fb`, `Pv`, `Sp` and `Alm`. These suffixes are a proposed house convention, not a Walker or ISA mandate. Prefer the plant's established convention when importing an existing project. Vendor-generated names such as `_IO_EM_DO_02` remain unchanged.

Do not put the entire factory hierarchy into each PLC variable. Store source connection, controller identity, scope and exact symbol together. One controller can serve many components, and one component can have many signals. A single `plc_tag` string on a component cannot describe that whole mapping.

**Hierarchy and transport rules**

Use an ISA-95-aligned hierarchy with declared extensions: Enterprise → Site → Area → Work center (for example a line) → Work unit, then equipment/assembly/component structure as the chosen plant model requires. Do not claim that every fixed slash-separated tree is prescribed by ISA-95. Represent installation, control, power and functional relationships separately; a PLC controlling a motor does not make the motor physically installed inside the PLC. [ISA-95 equipment model in the OPC companion specification](https://reference.opcfoundation.org/specs/OPC-10030/7.4.1)

For new MQTT bindings, choose one documented case convention and reject ambiguous or lossy transformations. MQTT topics are case-sensitive; spaces are technically allowed. A policy excluding spaces, empty levels or certain punctuation is our convention, not an MQTT prohibition. Preserve native names separately. [MQTT 5.0, topic names and filters](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)

Sparkplug 3.0 uses `spBv1.0/<group_id>/<message_type>/<edge_node_id>[/<device_id>]`. Metrics are in the payload; aliases are defined through the birth lifecycle. Therefore converting a dotted MIRA path to slashes and prepending `spBv1.0` is insufficient. A connector must map namespace context, metrics, types and protocol state. Plain MQTT/JSON and Sparkplug are separate bindings. Birth/death connectivity also does not establish that a motor is running. [Eclipse Sparkplug 3.0 specification](https://sparkplug.eclipse.org/specification/version/3.0/documents/sparkplug-specification-3.0.0.pdf)

**Fit this into MIRA's existing architecture**

1. Preserve CV-101's current operational path, `enterprise.home_garage.conveyor_lab.conveyor_1`. ADR-0035 makes it compatibility-sensitive and limits that exception to this rig. Its amendment identifies the equipment UUID as the internal key and `cv_101` as a derived slug, not a replacement stored identity. [ADR-0035](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/adr/0035-cv101-canonical-uns-path.md#L191)
2. Add this vocabulary and explicit source-to-signal mapping requirements to the existing identity/hierarchy contract. Reuse its placement and revision protections; do not create another identity system or proposal workflow. [Schema ownership decision](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/adr/0013-uns-namespace-builder-schema-canonicalization.md#L24)
3. Reconcile older architecture prose: the standards crosswalk both equates paths with OPC UA identities and later distinguishes them; it also understates Sparkplug integration as a small string transform. Replace those claims with the distinctions above. [Existing crosswalk](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/docs/specs/uns-kg-standards-compliance.md#L258)
4. Keep the current asset-tag filesystem validator scoped to its purpose. Do not reuse it as a universal PLC, equipment-designation or MQTT validator. Preserve raw names and validate each target representation separately. [Current validator](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/mira-hub/src/lib/asset-tag.ts#L11)
5. Require a qualified equipment context or an ambiguity result for repeated designations. The current resolver has name/alias matching followed by a first-result selection; repeated factory component names need an explicit resolution contract. [Resolver](https://github.com/Mikecranesync/MIRA/blob/c6581cc1c95ad7670f007b655a481797db547f2c/mira-bots/shared/demo_namespace.py)

Proposed signal metadata includes type, engineering unit where applicable, source timestamp, received timestamp, quality/freshness, source identity and mapping revision. Keep approved static facts separate from observations and derived conclusions. Keep command values distinguishable from feedback; a displayed command value does not authorize a write. A replacement device may reuse a position designation but must not inherit the removed physical instance's identity or verified observations.

**Next work and proof**

The coordinator can incorporate this as an addendum to the current contract; the ontology owner defines terms and relationships, backend owners implement qualified bindings and validation, the UI owner exposes the right labels, and the verification owner tests mappings. Continue the navigation work; establish this contract before binding it to live signals. No parallel namespace framework is needed.

Use the drive and Q1/MLC as the first examples, plus synthetic repeat equipment on a second line. Acceptance must demonstrate:

- Two Q1/MLC instances remain separate; an unqualified search cannot silently select one.
- Native symbols round-trip unchanged, including underscores, scope and vendor case rules.
- Target aliases that would collide after normalization are rejected or explicitly disambiguated.
- Editing a display name leaves source bindings and identity intact.
- Moving and moving back, or replacing a component, cannot revive stale approved associations.
- An unread register remains unknown; a run command is not running feedback; a coil output is not contact feedback.
- An export and consumer read preserve equipment identity, signal meaning, units, quality and time. Exercise actual Litmus/Ignition configurations before claiming interoperability.
- If Sparkplug is selected, rebirth/reconnection restores metric definitions and aliases correctly.

This is a naming and mapping refinement of the existing UI/hierarchy plan. The research does not establish that any new binding, migration or live consumer test has already shipped.
