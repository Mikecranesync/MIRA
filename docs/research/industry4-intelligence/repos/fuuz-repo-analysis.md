# Fuuz Public Repos — Deep Analysis

> Comprehensive analysis of the two public repos under the [Fuuz-Industrial-Intelligence GitHub org](https://github.com/Fuuz-Industrial-Intelligence): **`fuuz-skills`** (Claude Code skill library, ~43k lines of reference docs) and **`proveit2026`** (3 prebuilt Fuuz application packages from the ProveIt! 2026 demo). Read locally 2026-05-19; companion to [`videos/fuuz-video-analysis.md`](../videos/fuuz-video-analysis.md).
>
> **Confidence:** HIGH for direct quotes and counts (files were read locally). UNCONFIRMED applied where I infer intent.

## License / reuse status

- **fuuz-skills:** No `LICENSE` file in the repo root as of 2026-05-19. README states the skills are "for FUUZ developers, partners, and customers." → Treat as **proprietary**. We **summarize concepts and patterns**; we do **not copy or fork** SKILL.md or reference content into MIRA.
- **proveit2026:** No `LICENSE` file either. `.fuuz` packages are tar archives owned by Fuuz/the demo authors. → Same posture: **summarize the application shape, do not import the packages**.
- ✅ Safe: cite, describe, extract abstract patterns, link.
- ❌ Not safe: copy SKILL.md content verbatim, ship the `.fuuz` files inside MIRA, port the package JSON into our codebase.

---

## ① `fuuz-skills` — the Claude Code skill library

### Repo shape

```
fuuz-skills/
├── README.md                          # 7-skill catalog, install + versioning
├── SKILLS_VERSION_MANIFEST.md         # Central version tracker (semver, status, deploy log)
├── fuuz-packages/  + .skill           # Skill source dir + packaged archive
├── fuuz schema/    + .skill
├── fuuz screens/   + .skill
├── fuuz flows/     + .skill
├── fuuz-platform/  + .skill
├── fuuz-industrial-ops/  + .skill
└── fuuz-ml-telemetry/  + .skill
```

Each skill directory: `SKILL.md` (with YAML frontmatter: `name`, `description`) + `references/*.md` (typically 5–13 reference files). The `.skill` is the packaged version (zip with the directory contents) ready to import in Claude Code's admin console.

**Total content size:** ~43,107 lines across `SKILL.md` + references (excluding the packaged `.skill` archives).

### The 7 skills at a glance

| Skill | Version | Lines | Refs | What it teaches Claude to do | Platform-bound? |
|---|---|---|---|---|---|
| `fuuz-packages` | 2.1.1 | ~720 | 1 | Generate valid `.fuuz` package files (manifest.json + definition.json + package-data.json) with 71 "golden rules" derived from real import failures. | **Heavy** — Fuuz package format is proprietary. |
| `fuuz-schema` | 2.0.0 | ~700 | 8 | Design data models: types (master/setup/transactional), 20+ field types, relationships (1:1, 1:N, N:M), inverse relations, modules + sequences. Includes 24 critical rules + relationship triplets. | **Heavy** — Fuuz schema/JSON shape. |
| `fuuz-screens` | 1.3.0 | ~1.5k | 13 | Generate craft.js + JSONata screen JSON. Element-types ref (~500 lines), dashboard patterns, OEE dashboard domain. ISA-101 compliance. | **Heavy** — craft.js component tree + Fuuz runtime. |
| `fuuz-flows` | 1.3.0 | ~3k+ | 12 | Build backend/web/gateway flows: 50+ node types catalog, common-pitfalls, JSONata/JavaScript transforms, GraphQL patterns. | **Heavy** — Fuuz Flow runtime. |
| `fuuz-platform` | 1.5.0 | ~4k+ | 14 | Cross-cutting platform knowledge: 294 JSONata bindings, 44 connectors, 19 device drivers, 100+ seeded values, Relay GraphQL essentials. | **Heavy** — Fuuz tenancy/connector concepts. |
| `fuuz-industrial-ops` | 1.2.0 | ~1.3k | 5 | Industrial patterns: ISA-95 hierarchy, UNS publishing topic structure, alarm-state lifecycle + deadband, OEE/ISO 22400 time classification, ERP-integration patterns. | **Light** — patterns translate to any platform. |
| `fuuz-ml-telemetry` | 1.0.0 | ~860 | 5 | ML algorithms in ES5-restricted JS: EWMA baseline, Z-score anomaly, linear-regression trend, breach prediction, Pearson correlation, forecast projection. | **Mostly light** — algorithms are platform-neutral; only the JS runtime is Fuuz-specific. |

Two of these — `fuuz-industrial-ops` and `fuuz-ml-telemetry` — are **mostly reusable concepts** that any industrial AI vendor could borrow. The other five are **platform-locked**.

### The "golden rule" pattern (and why it works)

`fuuz-packages/SKILL.md` opens with `## Golden Rules` and immediately lists **33 numbered rules** in the first block alone (full skill: 71 rules per the README). A sampling that captures the *kinds* of rules and what they signal:

- *Format hardness:* "Every model is `Reference` / `Object`" / "Boolean values must always be lowercase" / "package-data.json has exactly 7 top-level keys."
- *Anti-hallucination guards:* "NEVER hallucinate screens, dataFlows, dataMappings… Always leave these as empty arrays" / "Modules and module groups must come from the developer — NEVER invent module IDs."
- *Schema-design hygiene:* "Every FK relationship must have an inverse list relation on the parent model" / "FK field naming: always prefix, never suffix" / "FK requiredness depends on model type."
- *Domain conventions:* "Sequence-backed fields must be `String` or `Int`" / "Enum models must have verbose descriptions" / "UoM fields must reference the `Unit` model" (never plain string).
- *Workflow hygiene:* "Package versioning starts at 1.0.0" / "Ask the developer about deletionReferenceBehavior preferences" / "Indices are mostly automatic — only define specialized ones."

**Structural pattern (worth stealing):**
1. Rules are **numbered**, declarative, and surgical — each one fits in a single sentence + 1–2 examples.
2. Many rules **direct the assistant to ask the developer** rather than guess (rules 16, 18, 22, 23, 30, etc.). This is the same Karpathy "stop and ask when confused" principle MIRA's CLAUDE.md endorses, encoded mechanically.
3. **Negative rules dominate.** The rule list reads like a "common-failure catalog" — every rule prevents a specific past incident. Same shape as MIRA's `.claude/rules/uns-compliance.md` ("don't reinvent path builders," "extraction must precede model resolution").

### `fuuz-flows/references/node-catalog.md` — the flow runtime, decoded

The flow engine has ~50 node types organized by category:

- **Triggers:** `schedule`, `dataChanges` (CDC on data models — Create/Update/Delete), `request` (web flow entry), `webhook`, `topic` (MQTT subscription).
- **Query / mutate:** `query`, `mutate` — GraphQL against Application or System API; supports inline aggregation.
- **Control flow:** `when`, `unless`, `broadcast` (fan-out), `mergeContext`, `executeFlow` (call another flow), `response`.
- **Transforms:** `setContext`, `transform` (JSONata), `javascript`.
- **Concurrency:** `mutexLock` / `mutexUnlock` — keyed by ID, the pattern Craig used to handle 200–250 reads/sec on the same sensor.
- **External / integration:** `http`, `connector` (44 catalog'd), `publishToTopic` (MQTT publish), `printer`, `email`, `notification`.
- **UI bindings:** `formDialog`, `snackbar`, `searchTable` — web flows can interact with the rendered screen directly.

**Execution model:**
- **External context** (10 min timeout): web flows, request/response from external APIs.
- **Internal context** (20 min effective, 30 min per node): schedule, dataChanges, webhooks, topic subscriptions.
- Three flow types: backend, web, **gateway** (runs on Fuuz Gateway on-premise — for printers, local devices, edge subscriptions).

**Flow complexity guidelines (the skill prescribes):**

| Complexity | Max nodes | Strategy |
|---|---|---|
| Simple CRUD | 5–8 | Single flow |
| Moderate ETL | 8–15 | Single flow with sections |
| Complex multi-model | 15–25 | Split into master + child flows |
| Cross-system integration | 25+ | Multi-flow coordination |

**The "ML flow" architecture** described in `fuuz-ml-telemetry/references/algorithms.md`:

| Flow | Trigger | Complexity | Algorithm |
|---|---|---|---|
| Flow 1 | `dataChanges` on `TelemetryRaw` Create | O(1) per record | EWMA baseline update + Z-score anomaly + linear regression trend + extrapolation breach prediction |
| Flow 2 | `schedule` (hourly) | O(n × m²) cross-record | Pearson correlation between asset pairs |
| Flow 3 | `schedule` (hourly) | O(k) per data point | Forecast projection + breach prediction + forecast-accuracy retrospection |

This is the **textbook real-time-vs-batch separation** for industrial ML. MIRA's recall/diagnostic side doesn't currently need this, but if MIRA ever adds a "sensor-trend grounded reply" feature (e.g., "this motor's vibration has been trending up for 3 days"), this is the reference shape.

### `fuuz-industrial-ops` — the most portable skill

Reference files (5):
- `alarm-management.md` — Alarm states (`ACTIVE` / `ACTIVE_ACK` / `CLEARED`), deadband logic, limit-type priority (HighLimit/LowLimit > Warning > Deviation), HighWarning vs HighLimit semantics.
- `oee-time-classification.md` — ISO 22400 mode flags (`countAsProductionTime`, `countAsDowntime`, `countAsPlannedDowntime`), JS time-classification function, runTime / plannedDowntime / unplannedDowntime buckets.
- `uns-patterns.md` — Topic structure `fuuz/{site}/{area}/{line}/{cell}/{equipment}/{datatype}`, JSONata `$join()` topic builder, conditional levels (`$cell.code ? $cell.code : "nocell"`), full UNS-message standard-fields table (elementId / displayName / typeId / parentId / hasChildren / namespaceURI / value / timestamp / quality).
- `workcenter-patterns.md` — Workcenter linked to either cell **or** line; fallback resolution.
- `erp-integration.md` — Plex / NetSuite / SAP / Epicor / Dynamics 365 connector usage.

> **MIRA takeaway:** this is the closest thing to a "rosetta stone" for translating industrial concepts to LLM-readable rules. MIRA's own `.claude/rules/uns-compliance.md` should grow toward this shape — declarative, JSONata-or-equivalent code samples, explicit data-shape constraints, no vague "be careful with UNS paths" language.

### `fuuz-screens` — the dashboard/HMI surface

Reference files (13) — the most prescriptive on UI:

- `element-types.md` — All 59 element types with required props (Container, Form, Table, DisplayText, ActionButton, Chart, Icon, Tabs, Dialog, ResizablePanel, …).
- `component-patterns.md` (~1.6k lines) — Production-blessed patterns: MainFormContainer, action pipelines, dashboard layouts.
- `dashboard-patterns.md` — KPI cards, OEE rollup tile, alarms summary card.
- `oee-dashboard-domain.md` — OEE-specific dashboard formulas + state classifications + GraphQL query patterns.
- `screen-runtime-context.md` — The `screen.context` "mini UNS" mechanism (page-load flows → context → component subscriptions).
- `frontend-jsonata-bindings.md` — Custom JSONata extensions usable in component data-paths.
- `stimulsoft-reports.md` — Document-design layer (.mrt files).
- `visualization-library.md` (~2.2k lines) — FusionCharts catalog.

**ISA-101 compliance** explicitly called out — the industrial HMI standard. That's a quality signal Fuuz takes seriously and a positioning lever MIRA could borrow (when MIRA does ship a mira-hub dashboard).

### What is *not* in `fuuz-skills`

- **No MCP-tool catalog yet** — Craig said "MCP tools forthcoming" `[33:30]`. The skills are LLM-as-code-author, not LLM-as-platform-orchestrator.
- **No customer-facing copy / brand voice skill** — these are technical skills. (MIRA has `brand-voice-enforcement` for the marketing side.)
- **No "answer questions about the running app" skill** — the skills generate apps; they don't read or summarize a running tenant. This is a gap MIRA's surface (Slack copilot) intentionally fills.
- **No grounding / RAG / citation skill** — Fuuz's skills assume the Claude operator brings the domain knowledge ("learn your domain"). MIRA's wedge is that *the bot brings the grounding*.

### Workflow Craig described (composed from the video) that the skills support

1. Operator writes a prompt: *"build me an alarms dashboard with last 30 days metrics, three tables (unacknowledged / acknowledged / cleared 24h), top 10 cleared at right."*
2. Claude consults `fuuz-platform` → understands tenants, Application vs System API, deployment model.
3. Claude consults `fuuz-schema` → confirms the Alarm data model exists; doesn't try to create one.
4. Claude consults `fuuz-flows` → builds a page-load flow that calculates KPIs, populates `screen.context`.
5. Claude consults `fuuz-screens` → emits the JSON tree (KPI cards subscribed to context, three table queries with filters, layout-templates pattern).
6. Claude consults `fuuz-industrial-ops` → applies alarm-state semantics correctly.
7. Operator downloads JSON → imports via App Designer → developer-mode-debugs → ~80–85% complete → fine-tunes in UI → done.

The skill catalog covers **every layer** of that pipeline. There is no "grab-bag" skill; each one is a distinct phase.

---

## ② `proveit2026` — the demo applications

### Repo shape

```
proveit2026/
├── README.md                                       # Full app catalog (excellent reference)
├── ProveIT Big Stage Presentation - Enhanced.pptx
├── ProveIT Data Broker App@0.0.1.fuuz             # ~tar archive
├── ProveIT Enterprise B WMS@0.0.1.fuuz            # ~tar archive
└── ProveIT Enterprise C - Full App@0.0.1.fuuz     # ~tar archive
```

### The three applications

| App | Models | Screens | Flows | Domain |
|---|---|---|---|---|
| **Enterprise C — Full App** | 28 | 26 | 39 | IIoT telemetry, MES, OEE, alarms, predictive ML — 4 sites, 504 assets, 1,000+ data points, biologics + automotive + chemical + F&B |
| **Enterprise B — WMS** | 38 | 33 | 33 | Finished-goods warehouse management: receiving, inventory, cycle counting, AGV putaway, order fulfillment, beverage distribution |
| **Data Broker** | 34 | 14 | 22 | Multi-system integration hub: MQTT in, OPC UA in, REST in, normalizes into ISA-95 hierarchy, brokers to SCADA / WMS / robot / UNS |
| **Totals** | **100** | **73** | **94** | Built **in 2–3 weeks part-time** by Craig + Claude |

### Enterprise C model catalog (the most MIRA-relevant)

- **Physical hierarchy:** Site / Area / Line / Cell / Asset / DataPoint — vanilla ISA-95.
- **Telemetry:** DataPoint, TelemetryRaw, TelemetryRawBool, TelemetryRawString, TelemetryHourly, TelemetryDaily. Three raw types (numeric / bool / string) — a pragmatic schema choice.
- **OEE & Production:** Workcenter, WorkcenterHistory, Mode, State, OeeHourly, OeeDaily, ProductionLog.
- **Downtime:** EventCategory (12), Event (75 specific reasons).
- **Master data:** Product (with cycle-time standards), WorkOrder.
- **Alarms:** Alarm, AlarmState (8 lifecycle states).
- **ML:** TelemetryBaseline (EWMA state), TelemetryForecast (with confidence bands), PatternInsight (anomaly records), CorrelationPair (cross-asset Pearson).

### Enterprise B model catalog (overlaps MaintainX/Atlas territory)

- **Inventory:** Inventory, InventoryStatus, InventoryTrace, Lot, HandlingUnit (GS1/SSCC), Product, ProductCategory, Adjustment, TransactionType, Process.
- **Cycle counting:** Count, CountLine, CountLineInventory, CountParameters, CountStatus — full blind-count flow.
- **Order fulfillment:** Order, OrderLine, OrderLineRelease, OrderStatus, OrderType, OrderLineReleaseStatus, OrderLineReleaseType.
- **Business partners:** BusinessPartner, BusinessPartnerAddress.
- **Receiving:** Receipt, ReceiptLine, ReceiptLineOrderLineRelease, ReceiptException, ReceiptExceptionReason, ReceiptStatus.
- **Site:** StorageUnit, StorageZone, StorageUnitStatus, Area.
- **Logistics:** PutawayRequest, AutomatedGuidedVehicle, ProductPreferredStorageUnit, LabelDesign — directed putaway with AGVs (Robbie + K9), ZPL/IPL label gen.

### Data Broker model catalog (the integration hub)

The interesting bit: this isn't a passive proxy — it has its **own normalized ISA-95 hierarchy** (Enterprise / Site / Area / Line / Workcenter / EntityAsset). Two-protocol-in (MQTT + OPC UA), four-protocol-out (UNS / SCADA / WMS / robot controller). Robot management as a first-class concern: RobotState, RobotStateHistory, RobotHistory + Mode + State for the Fanuc CRX-10.

> **Why this matters:** the Data Broker is what every "we need a UNS but our plants run 5 different systems" customer needs. It's a separable product. MIRA's posture: **don't compete with it** — declare it out of scope (`mira-saas-scope-guard`) and integrate with whatever broker the customer uses (Fuuz, HighByte, Litmus, custom Sparkplug-B).

### Demo data scale (what "look-real" looks like)

From the proveit2026 README:
- **Enterprise C:** 4 sites, 10 areas, 19 lines, 40 cells, **504 assets, 1,000+ data points**, 43 workcenters, 21 products, 534 work orders, 47 UoMs.
- **Enterprise B:** 1,000 inventory records, 120 lots, 64 storage units, 30 handling units, 16 beverage products, 2 AGVs, 52 product-to-location priority mappings.

This is the **scale at which MIRA needs its own demo-plant data**. Today MIRA has `mira-create-demo-plant` skill — the proveit2026 numbers are a useful "good demo-data target" benchmark.

---

## ③ How the two repos work together

The pair is the **complete on-ramp**:

| For | Use |
|---|---|
| "Show me what's possible" | `proveit2026/` → import a `.fuuz` package → click through working app |
| "Help me build my own" | `fuuz-skills/` → import the relevant `.skill` files → prompt Claude |
| "Combine: explore the demo to learn the platform" | Both — read the proveit2026 README to see the model catalog, then ask Claude (with the skills loaded) to build a similar thing for your domain |

This is a **textbook GTM pattern** for AI-native platforms: ship the demo + ship the skill library → the prospect prototypes their own version in their first week. MIRA's MVP equivalent would be `mira-create-demo-plant` + a published `mira-component-template-builder` skill + a "MIRA in 5 minutes" video.

---

## ④ Top patterns extracted (cross-referenced in other docs)

### Architecture patterns (→ [architecture-patterns/fuuz-patterns.md](../architecture-patterns/fuuz-patterns.md))
1. **Event-driven monolith** with one internal broker, all domains on it (production, finance, CRM, materials).
2. **UNS = nervous system; data model + GraphQL = queryable memory.**
3. **Mini UNS at the screen level** (`screen.context` + page-load flows + component subscriptions).
4. **Mutex on data-point ID** for sensor-burst concurrency.
5. **Hybrid ML pipeline** (real-time O(1) per record + scheduled batch O(n) cross-record + scheduled projection).
6. **Separate Application API and System API** at the GraphQL layer (custom data vs platform infra).
7. **Three flow execution contexts** (backend / web / gateway).

### Screens / workflows patterns (→ [architecture-patterns/screens-workflows-patterns.md](../architecture-patterns/screens-workflows-patterns.md))
1. **MainFormContainer** as the standard layout primitive.
2. **Filters left / table center / menu-column right** — consistency rule baked into the screens skill.
3. **Action pipeline** with 10 action types (query → transform → mutate → snackbar → etc.).
4. **Page-load flows** (`pageLoadDataFlowIds` / `screenDataFlowIds`) — server-side aggregation runs before render.
5. **Developer Mode** as a first-class debugging surface — shows every query, transform, and binding live.
6. **HMI control panels** as a screen subtype — operator-facing, isolated from admin/CRUD screens.

### Data-modeling patterns (→ [architecture-patterns/data-modeling-patterns.md](../architecture-patterns/data-modeling-patterns.md))
1. **Model type taxonomy:** `master` / `setup` / `transactional` — drives retention defaults (master 5475d, transactional 3650d, setup 120d), drives indexing, drives behavior.
2. **Enum models use `usable`; master/transactional use `active`** — never mixed.
3. **Inverse-relation enforcement** — every FK has an inverse list relation on the parent.
4. **UoM as FK + relation pair** — never `String`; always `unit: Unit` + `unitId: ID!`.
5. **`customFields._externalId`** as the standard integration hook for external IDs.
6. **Sequence-backed fields** for auto-numbered IDs (BatchNumber, WorkOrderNumber).
7. **`deletionReferenceBehavior`** explicit per relationship — `prevent` default, `cascade` for parent-child transactional chains.

### UNS / MQTT patterns (→ [architecture-patterns/uns-mqtt-patterns.md](../architecture-patterns/uns-mqtt-patterns.md))
1. **Topic structure:** `<broker_root>/{site}/{area}/{line}/{cell}/{equipment}/{datatype}`.
2. **Optional levels handled by sentinel:** `$cell.code ? $cell.code : "nocell"`.
3. **Standard UNS message envelope:** `elementId`, `displayName`, `typeId`, `parentId`, `hasChildren`, `namespaceURI`, `value{before,after}`, `timestamp`, `quality`.
4. **UNS is read + write** — vendors should both subscribe and publish to demonstrate openness.
5. **UNS does NOT replace history** — pair UNS publish with a queryable persistence layer (data model + GraphQL in Fuuz; `kg_entities`/`kg_relationships` in MIRA).
6. **Workcenter dual-parent fallback** — link to cell OR line; consumers resolve via `$wc.line ? $wc.line : $cell.line`.
7. **Alarm UNS messages** carry both before/after value plus the data point's limits + deadband.

### Industrial-AI agent patterns (→ [architecture-patterns/industrial-ai-agent-patterns.md](../architecture-patterns/industrial-ai-agent-patterns.md))
1. **Skills as captured corrections** — every "no, do it this way" becomes a numbered rule.
2. **Skills direct the assistant to ask** when context is missing — encoded mechanically, not soft-handled.
3. **Anti-hallucination rules are explicit** — "NEVER hallucinate screens / dataFlows / dataMappings."
4. **"Frame the structure, delegate the heavy lifting"** — operator builds the node skeleton, LLM fills it.
5. **Copy-paste workflow** keeps a human in the loop; MCP autonomy is gated on RBAC + governance.
6. **Use the platform's exported artifacts as LLM training data** — the `.fuuz` package is self-describing enough to summarize.
7. **Skills are versioned with semver** — same rigor as platform code.

---

## ⑤ Risks and limitations

- **Vendor lock-in tax.** Five of the seven skills are deeply Fuuz-specific. A team that builds on these has bought into the Fuuz platform's semantics — packages, screens, flows. Hard to migrate.
- **No grounding mechanism.** The skills assume Claude either (a) has the right knowledge or (b) is corrected by the human operator. There's no "ground in customer manuals / work orders" hook — that's a class of capability MIRA owns.
- **No multi-tenant safety guards.** The skills don't have a "don't write to prod tenant" enforcement; that's left to the human. MIRA's `prod-guard.sh` + environment doctrine is more defensive.
- **ML algorithms are ES5-only.** Severe runtime restriction that forces all algorithms through a narrow keyhole (Math + JSON + Object.keys + var). Reusable as concepts; not reusable as code.
- **Skills last updated Feb 2026.** The repo had a burst of work in Feb (versions 2.x); none updated in March-May. Either the skills are mature enough not to need updates (good sign) or development moved internal (less good for outside learners).

---

## ⑥ Open questions for follow-up

- [ ] Are there *private* Fuuz skills not in the public repo? (Probably yes — the MCP-tool catalog Craig mentioned at `[33:30]`.)
- [ ] What is the import/install UX for skills inside Fuuz's own Claude Code environment? (README says "organization settings → skills → add" — is that Claude Code, or a Fuuz-specific console?)
- [ ] Does Fuuz internally version-pin Claude model? (No mention in the skills — possibly intentional, possibly worth asking on a discovery call.)
- [ ] How are skills *retired* — what does the `deprecated` / `baked-in` status mean in `SKILLS_VERSION_MANIFEST.md`?
- [ ] Are the `.fuuz` packages actually importable in a free-tier Fuuz tenant? (Worth a real test if MIRA wants to do hands-on comparison.)

---

## ⑦ MIRA-specific learning (compressed)

- **The pattern of distilling rules from corrections** is the most replicable lesson. MIRA's `.claude/rules/` already does this; we should:
  - **Number the rules** within each file (e.g., uns-compliance gets `UC-1`, `UC-2`).
  - **Lead with anti-hallucination rules**.
  - **Encode "ask the developer when X" rules explicitly.**
- **Industrial-ops + ML-telemetry skills are the most portable.** When MIRA writes its own equivalents, structure should mirror Fuuz's: a SKILL.md with rules + a `references/` folder of deep dives.
- **A "MIRA component-template builder" skill should follow the fuuz-packages shape:** 30–70 golden rules, ask-when-confused defaults, anti-hallucination rules first, validation checklist at the end.
- **The ProveIt! 2026 README is a sales artifact in disguise** — it leads with model counts and problem-to-solution tables. MIRA's `docs/research/industry4-intelligence/companies/fuuz.md` and our own `STRATEGY.md` could borrow the format.

See [`../mira-lessons/mira-fuuz-skill-adaptation-plan.md`](../mira-lessons/mira-fuuz-skill-adaptation-plan.md) for the full proposed skill roster.

---

## Sources

- Local clone: `/Users/charlienode/reference-repos/fuuz-skills/` (origin: `github.com:Fuuz-Industrial-Intelligence/fuuz-skills`)
- Local clone: `/Users/charlienode/reference-repos/proveit2026/` (origin: `github.com:Fuuz-Industrial-Intelligence/proveit2026`)
- Files read: all 7 `SKILL.md` headers, README.md, SKILLS_VERSION_MANIFEST.md, plus deep reads of `fuuz-packages/SKILL.md`, `fuuz-flows/references/{flow-patterns.md,node-catalog.md}`, `fuuz-industrial-ops/references/{uns-patterns.md,alarm-management.md,oee-time-classification.md}`, `fuuz-ml-telemetry/references/algorithms.md`.
- Companion analysis: [`videos/fuuz-video-analysis.md`](../videos/fuuz-video-analysis.md).
