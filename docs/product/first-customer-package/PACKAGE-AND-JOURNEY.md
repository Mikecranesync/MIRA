# Package and customer journey

Target design, not proof of live implementation. Shaded nodes mark Mission 001's focus; dashed connections mark separately qualified extensions. See [customer outcomes](CUSTOMER-VALUE-ACCEPTANCE.md) and the [interactive view](visuals/package-journey.html).

## Full package

```mermaid
flowchart TB
    UI["Customer workspace: phone + web<br/>Pilot access, Projects, private threads"]
    DOCS["Engineering evidence<br/>OEM manuals, drawings, tables, photos"]
    OBS["Technician observations<br/>Confirm asset, meaning and time"]
    TEL["Later: read-only telemetry<br/>PLC, sensors, historian"]
    KB[("Governed knowledge base<br/>Citable evidence + relationships")]
    UNS["FactoryLM UNS<br/>Canonical asset address + typed events"]
    STATE["Machine state + history<br/>Source, time, verification, uncertainty"]
    MIRA["MIRA reasoning<br/>Confirmed identity + approved evidence + machine facts"]
    ANSWER["Useful cited answer<br/>Supporting passage + complete prerequisites"]
    PACKET["Work preparation<br/>Guided checks, editable packet, PDF"]
    OUTCOME["Verified outcome<br/>Before/after evidence + unresolved facts"]
    LATER["Later: permissioned external actions<br/>CMMS / OT / robotics, separately qualified"]
    UI --> DOCS --> KB --> MIRA
    UI --> OBS --> UNS --> STATE --> MIRA
    TEL -.-> UNS
    UNS --> MIRA
    MIRA --> ANSWER
    MIRA --> PACKET
    PACKET --> OUTCOME
    OUTCOME --> UNS
    OUTCOME --> REVIEW["Review proposed learning<br/>Preserve scope and provenance"] --> KB
    PACKET -.-> LATER
    classDef focus fill:#E6F1FA,color:#18212B,stroke:#6F879C
    class OBS,UNS,STATE,MIRA,ANSWER focus
```

Trust across all paths: tenant/role boundaries, private conversations, approved sharing, source applicability, safety gates, consent, durable cost bounds, audit, real CI/device evidence and rollback. A reported repair never establishes safety clearance automatically.

## Customer journey

```mermaid
flowchart TD
    A["1. Access + consent<br/>Approved free 30-day pilot"] --> B["2. Confirm machine/component<br/>Correct model, variant, revision"]
    B --> C["3. Establish evidence<br/>Customer manual ready and applicable"]
    C --> D["4. Describe the problem once<br/>Confirm factual interpretation; inspect state"]
    D --> E["5. Inspect the next step + citation<br/>Check the justified diagnostic action"]
    E --> F["6. Prepare work<br/>Sourced procedure/packet, edit, save/export"]
    F --> G["7. Record + verify result<br/>Include unresolved or unsuccessful outcomes"]
    G --> H["8. Hand over + return<br/>Next technician gets approved asset facts"]
    H --> I["9. Measure value<br/>Completion, corrections, time and voluntary reuse"]
    H --> B
```

Observation capture should reuse the question the technician already asked and add only necessary confirmation. A source-qualified manual question can yield a useful answer while machine-state details remain explicitly Unknown. Do not require redundant forms or CMMS setup before first value. Asset-specific advice still follows the confirmed-context rules.

## Knowledge lifecycle

```mermaid
flowchart TD
    RAW["Original artifacts<br/>Retain origin and version"] --> EXTRACT["Extract meaning<br/>Pages, tables, units, warnings, complete conditions"]
    RAW --> SCOPE["Confirm applicability<br/>Asset, component, model and revision"]
    EXTRACT --> EVIDENCE["Approved citable evidence<br/>Page/source, approval, uncertainty"]
    SCOPE --> EVIDENCE
    SCOPE --> KG["Knowledge relationships<br/>Model ↔ component ↔ manual ↔ fault/procedure"]
    EVIDENCE --> RETRIEVE["Scoped retrieval<br/>Tenant + approval + applicability"]
    KG --> RETRIEVE
    RETRIEVE --> CONTEXT["MIRA context<br/>Approved knowledge + UNS asset + machine state"]
    CONTEXT --> CLAIM["Supported answer or packet<br/>Citations, limits, complete prerequisites"]
    CLAIM --> FEEDBACK["Corrections + verified outcomes<br/>Proposed learning, reviewed and versioned"]
    FEEDBACK --> EVIDENCE
```

The knowledge base holds engineering evidence and relationships. The UNS supplies canonical asset addressing and event scope. Machine state contains time-bound, provenance-bearing facts. Together they help the current job and preserve what the next technician needs.
