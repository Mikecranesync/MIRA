# Data-Modeling Patterns

> Schema / data-model patterns extracted from Fuuz's `fuuz-schema` + `fuuz-packages` skills and the ProveIt! 2026 application catalog (100 data models, mostly ISA-95 + ISO 22400 aligned). MIRA applicability called out for each.

---

## D-1 — Model-type taxonomy: master / setup / transactional

**What:** Every data model in Fuuz declares a `dataModelTypeId` of:

- **`master`** — long-lived entities that drive operations (Asset, Product, BusinessPartner, Workcenter). Retention default: **5475 days (15 years)**.
- **`setup`** — lookup/enum values (AlarmState, Mode, ProductCategory, OrderStatus). Retention default: **120 days** (since they rarely change). Records carry a `usable` boolean.
- **`transactional`** — high-volume operational records (WorkOrder, ProductionLog, TelemetryRaw, Receipt, Count). Retention default: **3650 days (10 years)**. Records carry an `active` boolean and typically have an auto-numbered sequence-backed ID field.
- **`null`** — only for reference models that don't fit the others.

**Why:** Drives default retention, indexing strategy, audit behavior, and UX (setup models render as dropdowns; master models render as searchable tables).

**MIRA applicability:**
- MIRA's KG today doesn't have this taxonomy. Most tables blur master + transactional. Action: when MIRA Hub's schema migrates next, **annotate each table** as master / setup / transactional with explicit retention and indexing implications.
- Specifically:
  - `kg_entities` → master.
  - `kg_relationships` → transactional (high volume; promotion-state-tracked).
  - `proposals_*` lookups (status enums) → setup.
  - `audit_logs` → transactional.

**Source:** `fuuz-schema/SKILL.md` (model types). `fuuz-packages/SKILL.md` rule 24 ("`usable` for setup, `active` for master/transactional — never mixed").

---

## D-2 — Strict FK + inverse-relation discipline

**What:** Every foreign key has TWO sides:
- Child model: `parentModelId: ID!` (FK) + `parentModel: ParentType` (the relation).
- Parent model: `modelAs: [ChildType!]!` (the inverse list relation).

If you add an FK without its inverse, the schema is incomplete.

**Why:** Predictable GraphQL traversal in both directions. Eliminates "I have a parent — what are its children?" custom queries. Lets Relay-style pagination work bidirectionally.

**MIRA applicability:** Today MIRA's KG has parent → child traversal but not always the inverse. For example, an asset → its proposed relationships works; the reverse (a proposed relationship → its asset) is via FK only, not always exposed in the MCP read tools. Action: audit `mira-mcp/server.py` read tools for bidirectional coverage.

**Source:** `fuuz-packages/SKILL.md` rule 14.

---

## D-3 — UoM as FK, never as String

**What:** Every quantity field that has a unit has a paired `unitId: ID!` + `unit: Unit` relation. The Unit model is a shared lookup. Plain string units (`"kg"`, `"rpm"`, `"degF"`) are banned.

**Why:** Unit conversion + display formatting + canonical SI vs imperial handling all rely on this. Strings break the moment a customer wants both "barrels" and "liters" for the same product.

**MIRA applicability:** MIRA today reads vendor unit labels as strings from manuals. If MIRA grows into telemetry-grounded answers, **adopt the FK pattern** for component data points. Component templates should reference a `Unit` table, not embed strings.

**Source:** `fuuz-packages/SKILL.md` rule 13.

---

## D-4 — FK naming: prefix, not suffix

**What:** Foreign keys are named `{camelCaseModelName}Id`. When two FKs reference the same model, **differentiate with a prefix**: `sourceBatchId` / `targetBatchId`, **never** `batchIdSource` / `batchIdTarget`.

**Why:** Sorts alphabetically by domain word. Reads naturally in code. AI generation more consistent.

**MIRA applicability:** Direct. MIRA's KG follows this loosely; the `kg_relationships` table has `source_entity_id` / `target_entity_id` (correct). When new tables get added (proposal_evidence, workorder_links), enforce the same naming.

**Source:** `fuuz-packages/SKILL.md` rule 29.

---

## D-5 — Sequence-backed auto-numbered IDs

**What:** Operational fields (WorkOrderNumber, BatchNumber, ReceiptNumber) use a `String` or `Int` field with a `sequence` reference. Sequences are platform objects that generate IDs atomically. Field type **must** be `String` or `Int` matching the sequence type.

**Why:** Sequential, human-readable, no-collision IDs. Better than UUIDs for operator-visible records.

**MIRA applicability:** Atlas CMMS already does this for work-order numbers. Pattern is correct; the lesson is the *strictness* — never let an `ID!` UUID and a sequence-backed `String` get confused.

**Source:** `fuuz-packages/SKILL.md` rule 17.

---

## D-6 — Enum models include `color`, `default`, `usable`, `description`

**What:** Setup/enum models (status, type, category, severity) usually need:

- **`color`** — for status badges, chips, visual indicators.
- **`default`** — boolean pre-selected value for form selects.
- **`usable`** — controls whether the enum value appears in dropdowns (soft-deprecate without removing).
- **`description`** — *never empty* — explains what the value means in context.

ID values for enum records are short, uppercase, recognizable: `MAINT` (not `MAINTENANCE`), `SEMI_AUTO` (not `SEMI_AUTOMATIC`).

**Why:** UI and humans both need rich enum semantics. Empty descriptions create downstream confusion (what does `IN_REVIEW` mean vs `PENDING`?).

**MIRA applicability:**
- MIRA's `proposal_status` enum (`proposed`, `verified`, `rejected`, `needs_review`) deserves the same treatment. Action: add `color` + `description` columns; populate `description` with the *exact* governance meaning.
- For KG-relationship `confidence_band` (low/medium/high), the same applies.

**Source:** `fuuz-packages/SKILL.md` rules 19, 20, 22, 24.

---

## D-7 — `customFields` discipline: only `_externalId` by default

**What:** Models can have `_customFields` for site-specific extensions. The rule: **don't pre-define custom fields in packages.** Only include `_customFields._externalId` (a standard external integration hook). Developers add other custom fields through the UI after import.

**Why:** Custom fields are tenant-specific. Pre-defining them in a shippable package creates conflicts on customer sites that need different ones.

**MIRA applicability:**
- For MIRA component templates that get exported and re-imported across customer sites, follow the same rule: a minimal core schema + a documented `external_refs` JSONB field for site-specific extensions.
- Don't bake customer-specific fields into the global template.

**Source:** `fuuz-packages/SKILL.md` rule 26.

---

## D-8 — Deletion behavior: explicit per relationship

**What:** Every FK relationship declares `deletionReferenceBehavior`:
- **`prevent`** (default) — block parent delete when children exist.
- **`cascade`** — auto-delete children when parent is deleted (for master → transactional chains like `WorkOrder → Process / BOM / Schedule`).

The skill rule: **always ask the developer** which behavior applies, don't default silently.

**Why:** Cascade vs prevent has different blast radius. Wrong choice loses data or blocks legitimate cleanup.

**MIRA applicability:**
- MIRA's KG today doesn't always have explicit deletion behavior. Action: audit FKs. For each:
  - Component template → proposals: probably `cascade` (delete template = delete its proposals).
  - Component template → verified KG relationships: probably `prevent` (verified data shouldn't disappear).
  - Manual chunk → citations: probably `cascade`.
- Document choices in the relevant migration's `up`.

**Source:** `fuuz-packages/SKILL.md` rule 23.

---

## D-9 — Audit fields are platform-managed, never in user models

**What:** `createdAt`, `updatedAt`, `createdBy`, `updatedBy` are auto-managed by Fuuz. Never define them in user models. Do define **domain-specific** timestamp fields (`completedAt`, `acknowledgedAt`, `approvedBy`, `approvedDate`) — those are part of business state.

**Why:** Conflating system audit with business state creates ambiguity. Was `updatedBy` the system clock or the approval? Separate them.

**MIRA applicability:**
- MIRA's KG models do mix system audit (created/updated) with domain state (proposed_by, verified_by). Pattern still works as long as the *names* make the distinction.
- Action: when adding new KG fields, audit for collision. `last_modified_by_user_id` is a domain field. `updated_at` is system.

**Source:** `fuuz-packages/SKILL.md` rule 28.

---

## D-10 — Indices are automatic for IDs / FKs / dates / relations

**What:** Fuuz auto-indexes:
- All `id` fields.
- All FK fields.
- All date fields.
- All relation fields.

Custom indices: **only** define when the developer specifically requests one. Default = `indices: []`.

**Why:** Auto-indexing covers 90% of needs. Manual indices on top create maintenance burden + over-indexing performance hit.

**MIRA applicability:** Postgres doesn't auto-index FKs — MIRA has to explicitly `CREATE INDEX ON kg_relationships(source_entity_id)`. Lesson: **be deliberate** about which non-obvious indices we add; document the query they serve.

**Source:** `fuuz-packages/SKILL.md` rule 33.

---

## D-11 — Three-tier telemetry raw type (numeric / bool / string)

**What:** Enterprise C demo has `TelemetryRaw`, `TelemetryRawBool`, **and** `TelemetryRawString` as separate tables. Aggregations into `TelemetryHourly` / `TelemetryDaily` are derived.

**Why:** Different types need different storage + index strategies. Numeric supports stats (avg, min, max, p05-p95, stdDev, cv); bool is just "what % was on"; string is enumerated values.

**MIRA applicability:** Skip for now — MIRA doesn't store telemetry. But if MIRA grows a "ingest live tag data for grounding" feature, mirror this split. Don't shove booleans and strings into a numeric table.

**Source:** proveit2026 README; fuuz-ml-telemetry data-models reference.

---

## D-12 — Statistical aggregations include percentiles, not just min/max/avg

**What:** `TelemetryHourly` columns include: `avg`, `min`, `max`, `p05`, `p25`, `p50`, `p75`, `p95`, `stdDev`, `cv` (coefficient of variation). Daily rollups are similar.

**Why:** `avg` + `min/max` miss skew. Percentiles + stdDev + CV capture distribution shape — essential for ML and anomaly detection.

**MIRA applicability:** Same lesson — if MIRA aggregates anything (proposal counts per asset, citation reuse, technician feedback distribution), include percentiles + stdDev, not just averages.

**Source:** proveit2026 README (Enterprise C telemetry).

---

## D-13 — Cross-package FK conventions (separate vs same package)

**What:** Inverse relations are added **within the same package** (ModelA in package X references ModelB in package X → add inverse on ModelB). For models in **external packages** (e.g., Unit or Product from MES), inverse relations are NOT added — that would require modifying the external package.

**Why:** Encapsulation. A package shouldn't modify another package's models. Cross-package references are one-way; bidirectional traversal requires querying both packages.

**MIRA applicability:** When component templates ship as portable packages, follow this. Templates reference shared platform models (like `Unit`) one-way; don't add back-references that would require modifying the platform schema.

**Source:** `fuuz-packages/SKILL.md` rule 14 (last sentence).

---

## D-14 — Reserved labels for path/type structure

**What:** Fuuz's UNS has reserved labels (`site`, `area`, `equipment`, `fault_codes`, `manufacturer`, `model`, etc.) that are structural type markers. Manufacturer/model/instance slugs must NOT collide with these.

**Why:** Path parsing is straightforward if structural labels are reserved. `enterprise.site.area.line.cell.equipment.<actual-asset-id>` only works if `site` / `area` / `equipment` never appear as actual asset codes.

**MIRA applicability:** MIRA's `uns-compliance.md` rule already encodes this (rule 6 — `uns.RESERVED_LABELS`). Lesson: keep the reserved-labels list current as the namespace shape evolves; auto-test against it in CI.

**Source:** `fuuz-skills/fuuz-industrial-ops/references/uns-patterns.md`. MIRA `.claude/rules/uns-compliance.md`.

---

## Cross-reference

- For backend architecture → [`fuuz-patterns.md`](fuuz-patterns.md)
- For UNS / MQTT → [`uns-mqtt-patterns.md`](uns-mqtt-patterns.md)
- For UI / workflow → [`screens-workflows-patterns.md`](screens-workflows-patterns.md)
- For agent / skill patterns → [`industrial-ai-agent-patterns.md`](industrial-ai-agent-patterns.md)
- For MIRA action plan → [`../mira-lessons/mira-fuuz-skill-adaptation-plan.md`](../mira-lessons/mira-fuuz-skill-adaptation-plan.md)
