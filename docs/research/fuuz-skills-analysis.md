# Fuuz Skills Analysis — Research Reference for MIRA

**Date:** 2026-05-19
**Analyst:** Claude Code (claude-sonnet-4-6) on CHARLIE node
**Source repos:** `/Users/charlienode/reference-repos/fuuz-skills` (read-only clone) and `/Users/charlienode/reference-repos/proveit2026` (read-only clone)
**Target:** Extract structural and pedagogical patterns for MIRA skill design. NOT a copy exercise.
**Status:** Research complete. Patterns identified. Adaptation map grounded in existing MIRA skills.

---

## 1. Executive Summary

### What Fuuz Is

Fuuz (fuuz.com) is a cloud-native **Industrial Operations Platform** — a no-code/low-code SaaS for manufacturers to build MES, WMS, and process automation applications without writing traditional software. The platform's core abstraction is a **Data Model → Data Flow → Screen** triad where every data model auto-generates a GraphQL API, data flows implement server-side logic via a visual node editor, and screens are JSON-encoded component trees rendered by a React/craft.js runtime. Fuuz targets OT (operations technology) teams who need factory-floor applications but lack software engineering resources.

### What the fuuz-skills Repo Is

The `fuuz-skills` repository is a suite of **seven Claude Code skills** that teach Claude how to generate valid Fuuz platform artifacts. Each skill is a structured Markdown document with a YAML frontmatter trigger block, numbered golden rules, reference-file inventories, and domain-specific checklists. The skills are packaged as `.skill` archives (ZIP files with `SKILL.md` as the root) deployed via the Claude Code admin console. They function as executable operating guides: when a developer asks Claude to "create a Fuuz data model for production tracking," the appropriate skill activates and constrains Claude's output to valid platform JSON.

The `proveit2026` repository contains three production-grade `.fuuz` application packages (gzipped tarballs) demonstrating the package format at real scale: Enterprise C MES (28 models, 26 screens, 39 flows), Enterprise B WMS (38 models, 33 screens, 33 flows), and a Data Broker app (34 models, 14 screens, 22 flows).

### One-Sentence Comparison to MIRA

Where Fuuz teaches Claude to **generate** platform artifacts for a proprietary no-code builder (schemas, UI JSON, flow graphs), MIRA's skill system teaches Claude to **ground** maintenance intelligence answers in plant context — a fundamentally different purpose: evidence accumulation over artifact generation.

---

## 2. License and Reuse Posture

### License Finding

**CRITICAL: Neither repository contains a LICENSE file.**

Checked via:
```
ls /Users/charlienode/reference-repos/fuuz-skills/LICENSE* 2>/dev/null  → (no output)
ls /Users/charlienode/reference-repos/proveit2026/LICENSE* 2>/dev/null  → (no output)
```

Under default US copyright law (17 U.S.C. § 106), the absence of an explicit license means **all rights reserved** by the author/organization. Fuuz Industrial Intelligence retains exclusive copyright over all content in both repositories.

### What This Means for MIRA

| Category | Status | Notes |
|---|---|---|
| Structural patterns (numbered rules format, section hierarchy, frontmatter trigger shape) | **Independently implementable** | Ideas and formats are not copyrightable — only specific expression is |
| Open industrial standards cited within (ISA-95, ISO 22400, OPC UA quality codes, ISA-88) | **Cite from primary sources** | Standards themselves are independently publishable; use their own documentation |
| Prose passages, golden-rules lists, named checklists verbatim | **NOT copyable** | Specific expression is protected |
| JSON schema shapes and JSONata snippets | **NOT copyable verbatim** | Likely constitutes copyrightable code/expression |
| Concept descriptions (what OEE is, EWMA formula) | **OK to describe independently** | Mathematical formulas and domain facts are not copyrightable |
| `.fuuz` package format details | **Describe structurally, not verbatim** | The format itself is a Fuuz platform specification — use for understanding, not replication |

### Conservative Posture

This document describes patterns and structural concepts only. It quotes frontmatter exactly where needed for technical analysis. No numbered golden-rules lists, prose checklists, or JSON templates are reproduced. MIRA skill content must be written independently from scratch using these patterns as inspiration.

---

## 3. Repository Inventory

### fuuz-skills Repository

**Root:** `/Users/charlienode/reference-repos/fuuz-skills/`

```
fuuz-skills/
├── README.md                          # Skills overview + installation instructions
├── SKILLS_VERSION_MANIFEST.md         # Central version tracking + deployment process
├── fuuz-packages/
│   ├── SKILL.md                       # 1803 lines — most comprehensive skill
│   └── references/
│       └── package-deployment-lifecycle.md
├── fuuz schema/                       # NOTE: space in directory name
│   ├── SKILL.md                       # 794 lines
│   └── references/
│       └── (reference files)
├── fuuz screens/                      # NOTE: space in directory name
│   ├── SKILL.md                       # 955 lines
│   └── references/
│       ├── screen-essentials.md
│       └── (other reference files)
├── fuuz flows/                        # NOTE: space in directory name
│   ├── SKILL.md                       # 675 lines
│   └── references/
│       └── (reference files)
├── fuuz-platform/
│   ├── SKILL.md                       # 627 lines
│   └── references/
│       ├── cross-skill-index.md
│       ├── platform-glossary.md
│       └── system-seeded-values.md
├── fuuz-industrial-ops/
│   ├── SKILL.md                       # 475 lines
│   └── references/
│       └── uns-patterns.md
└── fuuz-ml-telemetry/
    ├── SKILL.md                       # 399 lines
    └── references/
        └── validation-checklist.md
```

**File counts:**
- Total files: 81
- SKILL.md files: 7 (one per skill)
- Reference markdown files: ~20
- Total markdown lines across all files: ~50,093

**Three directories use spaces in their names** (`fuuz schema/`, `fuuz screens/`, `fuuz flows/`) — this caused `xargs wc -l` failures during analysis. Paths require quoting or `-exec` mode in shell commands.

### SKILL.md vs Reference Markdown

Each skill follows a two-tier content architecture:
1. **SKILL.md** — The primary operating guide. YAML frontmatter + numbered rules + section headers. This is what Claude loads when the skill activates.
2. **`references/` subdirectory** — Supplementary reference documents. Some have their own YAML frontmatter (suggesting they can also act as standalone skill triggers). Others are pure reference tables.

The version manifest explicitly states: **"Skills CANNOT reference files outside the skills directory. All content must be baked in."** Reference files are included in the `.skill` ZIP archive.

### proveit2026 Repository

**Root:** `/Users/charlienode/reference-repos/proveit2026/`

```
proveit2026/
├── README.md                          # App descriptions + integration architecture
├── Enterprise C MES App@0.0.1.fuuz   # Production MES package (~15MB)
├── Enterprise B WMS App@0.0.1.fuuz   # WMS package
└── ProveIT Data Broker App@0.0.1.fuuz # Data broker package
```

4 files total. The `.fuuz` files are the production artifacts — the README describes what they contain.

### Skills Version Manifest Summary

`/Users/charlienode/reference-repos/fuuz-skills/SKILLS_VERSION_MANIFEST.md` tracks all 7 skills with:
- Status labels: `draft` / `review` / `ready` / `deployed` / `deprecated` / `baked-in`
- Semantic version numbers (e.g., `v1.2.0`)
- Deployment targets (which Claude Code teams/instances each skill is deployed to)
- Complete version history from 2026-02-17 to 2026-02-22
- A `NewTrainingData/` workflow directory for skill updates

All 7 skills were at `deployed` or `baked-in` status as of the last manifest update.

---

## 4. Skill-by-Skill Breakdown

### 4.1 fuuz-packages

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz-packages/SKILL.md`
**Lines:** 1803 (longest skill)

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-packages
description: >
  Create, manage, deploy, and troubleshoot Fuuz packages (.fuuz files) for the Fuuz Industrial Operations Platform
  (fuuz.com). Trigger this skill whenever the user mentions Fuuz packages, .fuuz files, package deployment,
  Green/Blue deployments in Fuuz, package versioning, package linting, environment promotion (build to QA to
  production), tenant deployment, package rollback, industry accelerators, application packaging, or any work
  involving bundling and deploying Fuuz application components. Also trigger when the user discusses multi-tenant
  enterprise architecture, data migration between environments, or creating distributable Fuuz application bundles.
---
```

**H2 Section Headers (19 sections):**
1. What Is a Fuuz Package?
2. Package Creation
3. Package Validation (Automatic Linting)
4. Fuuz Enterprise Architecture
5. Green/Blue Deployment Strategy
6. Data Migration
7. Industry Accelerators
8. Package JSON Structure
9. Common Package Anti-Patterns
10. Deployment Checklist
11. (package-deployment-lifecycle.md has its own YAML with: Purpose, Package Creation, Validation, Enterprise Architecture, Green/Blue, Data Migration, Industry Accelerators, Package JSON Structure, Anti-Patterns, Checklist)

**Reference Files:**
- `references/package-deployment-lifecycle.md` — Deployment lifecycle procedures, validation checks, Green/Blue process, industry accelerator types

**Notable Patterns:**
- **71 numbered golden rules** — the highest density of any skill. Format: bold prefix (`**GP-001**:`), one-sentence constraint.
- Rules use severity codes and domain prefixes: `GP-` (general package), `DM-` (data model), `SC-` (screen), `DF-` (data flow), `IM-` (import).
- **"FATAL" vs "WARNING" severity tiers** — not all violations are equal. FATAL rules (wrong key count, missing required structures) are distinguished from style warnings.
- **Pre-Package Validation Checklist** — checkbox format, split across model/screen/flow domains.
- **Seven-key contract for package-data.json** (`dataModels`, `screens`, `dataFlows`, `dataMappings`, `documentDesigns`, `savedTransforms`, `data`) — exactly seven, no more, no less. This is the canonical FATAL violation pattern.
- **Import Error Reference section** — maps actual platform error strings to their root causes and fixes. Practical debugging guide embedded in the skill.

**Industrial-Domain Content:**
- Green/Blue deployment pattern adapted for manufacturing tenants (zero-downtime for 24/7 operations)
- Industry Accelerator types: MES, WMS, CMMS, Quality, Integration Broker, Track & Trace
- Platform version pinning (`platformVersion: "2026.2.1"`)

---

### 4.2 fuuz-schema

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz schema/SKILL.md`
**Lines:** 794

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-schema
description: >
  Design Fuuz data models, generate package JSON, define fields and relationships for the Fuuz Industrial
  Operations Platform (fuuz.com). Trigger this skill whenever the user mentions Fuuz data models, Fuuz schema
  design, GraphQL, Fuuz field types, package JSON generation, database schema, data modeling for Fuuz, Fuuz
  API generation, or wants to build any data-storage entity in a Fuuz application. Use for all tasks involving
  model design, field definitions, relationship mapping, or creating the data layer of a Fuuz app.
---
```

**H2 Section Headers (20 sections):**
1. What is a Fuuz Data Model?
2. Critical Rules — 24 numbered rules
3. Data Model JSON Structure
4. Model Classification
5. Field Definitions
6. Field Types Reference
7. Relationship Patterns
8. The Relationship TRIPLET
9. Index Definitions
10. Sequence Configuration
11. Custom Fields
12. System Fields (Never Define)
13. Data Retention
14. Model Naming Conventions
15. Lookup / Enum Models
16. Model Triggers
17. Module Assignment
18. Common Mistakes
19. Validation Checklist
20. Reference Files

**Reference Files:**
- Field types reference (comprehensive table of all supported field types)
- Relationship patterns guide

**Notable Patterns:**
- **Relationship TRIPLET constraint** — every relationship requires exactly three pieces: (1) FK scalar field, (2) forward named relation, (3) inverse list on the target model. Missing any one causes import failure. This is the single most common error pattern documented.
- **`usable` vs `active` distinction** — `usable` applies ONLY to lookup/enum models; `active` applies to master and transactional models. Mixing them causes silent data corruption.
- **System fields blacklist** — `createdAt`, `updatedAt`, `createdBy`, `updatedBy` are auto-generated. Defining them explicitly causes duplicate-field import errors.
- **Data retention tiers by model classification:**
  - Setup models: 120 days
  - Transactional models: 3650 days (10 years)
  - Master models: 5475 days (15 years)
- **Naming conventions enforced as rules:** PascalCase singular model names (`WorkOrder` not `work_orders`), camelCase field names, `At` suffix for DateTime fields (`startedAt`), `is`/`has` prefix for boolean fields.
- **Pure-digit model names are valid** when adjacent to a known vendor/family. This was documented as a historical bug correction in the UNS resolver (model=`"525"` for PowerFlex 525 is correct).

**Industrial-Domain Content:**
- Master model examples: `Asset`, `Workcenter`, `Product`
- Transactional model examples: `ProductionLog`, `Telemetry`, `Alarm`
- Setup model examples: `AlarmCategory`, `ShiftSchedule`, `DowntimeReason`

---

### 4.3 fuuz-screens

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz screens/SKILL.md`
**Lines:** 955

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-screens
description: >
  Create Fuuz application screens (UI), design user interfaces for the Fuuz Industrial Operations Platform
  (fuuz.com), build tables, forms, dashboards, HMIs, and mobile apps using Fuuz screen designer JSON.
  Trigger this skill whenever the user mentions Fuuz screens, Fuuz UI, Fuuz screen designer, Fuuz components,
  Fuuz screen JSON, building a Fuuz interface, designing a Fuuz dashboard, creating HMI screens, or any
  visual interface work within a Fuuz application. Also trigger for mobile app screen design, table screens,
  form screens, and screen component configurations.
---
```

**H2 Section Headers (17 sections):**
1. What is a Fuuz Screen?
2. Critical Design Principles
3. Critical Required Properties
4. Screen JSON Structure
5. Component Registry — 59 element types
6. State Management
7. Data Binding Patterns
8. Common Errors Quick Reference
9. Setup Table CRUD Checklist
10. HMI Design Guidelines (ISA-101 compliance)
11. Mobile App Design Guidelines
12. Dashboard Design Patterns
13. Form Design Patterns
14. Screen Type Decision Matrix
15. Output Checklist
16. Reference Files
17. Cross-Skill References

**Reference Files:**
- `references/screen-essentials.md` (has its own YAML frontmatter: `name: fuuz-screen-design`)

**Notable Patterns:**
- **59 named component types** — the most complete component registry of any skill. Each component has required properties listed.
- **Screen type decision matrix** — maps user intent ("user needs to see a list", "user needs to fill out a form", "user needs real-time data") to the correct screen architecture.
- **ISA-101 HMI compliance** noted for industrial display screens — high-contrast, minimal animation, touch-target sizing for gloved hands.
- **Mobile-first design guidelines** for screens deployed on tablets/phones in the field.
- **JSONata expression binding** is the primary data connection mechanism — `$state.context.someField` binds live flow data into screen components.
- Cross-skill reference path: `/mnt/skills/user/fuuz-flows/SKILL.md` — reveals the runtime deployment path structure on the Claude Code admin console.
- **Output Checklist** — final gate before declaring a screen complete. Enumerates required properties that commonly get omitted.

**Industrial-Domain Content:**
- HMI screen patterns for machine status monitoring
- Mobile app patterns for technician field data entry
- Production dashboard layouts for OEE and shift performance displays
- ISA-101 color convention references (gray for normal, yellow for warning, red for fault)

---

### 4.4 fuuz-flows

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz flows/SKILL.md`
**Lines:** 675

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-flows-v1
description: >
  Build Fuuz data flows (server-side logic, automation, integrations) for the Fuuz Industrial Operations
  Platform (fuuz.com). Trigger this skill whenever the user mentions Fuuz data flows, Fuuz flow designer,
  Fuuz automation, Fuuz scheduled flows, Fuuz web flows, Fuuz gateway flows, Fuuz integration flows,
  Fuuz document flows, building backend logic in Fuuz, GraphQL mutations in Fuuz, or any logic/automation
  layer in a Fuuz application. Also trigger for JSONata transformations, flow debugging, Fuuz node
  configuration, or connecting Fuuz to external systems.
---
```

Note: The `name` field is `fuuz-flows-v1` (with version suffix) while all other skills use bare names. This may indicate the flows skill went through a versioning migration that left the version in the name field rather than tracked separately.

**H2 Section Headers (14 sections):**
1. Flow Types — Backend, Web, Gateway
2. Flow Design Standards
3. Fuuz API Architecture
4. JSONata vs JavaScript Decision
5. Critical JSONata Context Behavior
6. Flow Execution Context and Timeouts
7. Naming Conventions and Documentation Requirements
8. Flow Development Workflow
9. Common Flow Patterns
10. GraphQL API Usage
11. Node Reference — 50+ node types
12. JSONata Custom Bindings
13. Best Practices
14. Resources

**Reference Files:**
- Flow-specific reference files (GraphQL patterns, JSONata examples)

**Notable Patterns:**
- **JavaScript runtime is restricted ES5** — no `let`/`const`, no arrow functions, no template literals, no `.toFixed()`. Flows run in a sandboxed ES5 environment. This is the single most common developer mistake, documented prominently.
- **JSONata is preferred over JavaScript** for most transformations — JSONata runs natively on the platform without the ES5 restriction and is more debuggable.
- **Three execution environments** with different timeout constraints:
  - Backend flows: 20 minutes
  - Web (Screen) flows: 10 minutes
  - Gateway flows: varies by device
- **Flow naming convention** enforces descriptive names that embed the trigger context and action: `[TriggerType]_[Model]_[Action]` pattern.
- **Relay-style GraphQL connections** — all list queries return `edges { node { ... } }` shape. Never flat arrays.
- **50+ node types** documented individually — Query, Mutate, Transform (JS/JSONata), Broadcast, Filter, Loop, HTTP Request, Schedule, Subscribe, Aggregate, etc.

**Industrial-Domain Content:**
- Gateway flows for PLC/device communication
- Integration flows for ERP sync (SAP, Plex patterns)
- Scheduled flows for OEE aggregation (15-minute windows)
- Document flows for generating PDF work orders and labels

---

### 4.5 fuuz-platform

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz-platform/SKILL.md`
**Lines:** 627

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-platform
description: >
  Provide platform-wide reference knowledge for Fuuz Industrial Operations Platform (fuuz.com). Trigger
  this skill for questions about the Fuuz platform architecture, system models (users, roles, settings),
  platform connectors and device drivers, unit types and measures, schedule groups, visualization library
  (FusionCharts), Custom JSONata library, system seeded values, platform settings configuration,
  enterprise/tenant/application hierarchy, or any cross-cutting platform concept. Also trigger when
  the user needs to understand the platform's built-in capabilities before building custom components,
  or when other Fuuz skills need platform context (connector configs, driver types, seeded values).
  Do NOT trigger for data model design (fuuz-schema), flow building (fuuz-flows), or screen creation
  (fuuz-screens) unless those skills are also active.
---
```

Note: This frontmatter includes an **explicit negative trigger** (`Do NOT trigger for...`) — a pattern none of the other skills use. This prevents platform-level context from overriding the specialized output-generating skills.

**H2 Section Headers (18 sections):**
1. What This Skill Covers
2. Platform Architecture Overview
3. System vs Custom Schema
4. Dual API Architecture — Application API + System API
5. System Seeded Values
6. Connectors — 44 Built-In
7. Device Gateway
8. Device Drivers — 19 Built-In
9. Visualization Library — FusionCharts
10. Platform Settings — 12 System Settings
11. Custom JSONata Library Reference
12. Unit Types and Measures
13. Schedule Groups and Events
14. Roles and Access Control
15. Data Mappings
16. AI Development Rules
17. Resources
18. Cross-Skill Index (with `references/cross-skill-index.md`)

**Reference Files:**
- `references/cross-skill-index.md` — Task→skill decision matrix, dependency graph, multi-skill workflows
- `references/platform-glossary.md` — Definitions of all 40+ core platform concepts
- `references/system-seeded-values.md` — Pre-populated lookup values for all system enum types

**Notable Patterns:**
- **Reference-only skill** — explicitly produces no artifacts. Its sole purpose is providing grounding context to other skills and answering platform architecture questions.
- **Explicit negative trigger** in frontmatter prevents over-activation.
- **44 built-in connectors** and **19 device drivers** documented — SAP, Salesforce, HTTP, FTP, Plex, Oracle, SQL Server, Ethernet/IP PLC, Modbus TCP, MQTT Client, OPC-UA, etc.
- **AI Development Rules section** — the skill includes rules for Claude's own behavior (what to do when uncertain, how to validate outputs, when to ask clarifying questions). This is the meta-layer of the skill system.
- **Custom JSONata library** — Fuuz extends the JSONata standard with platform-specific functions. These are documented here rather than in fuuz-flows because they're platform-wide.
- **Cross-skill dependency graph** (ASCII art in cross-skill-index.md) shows `fuuz-platform → fuuz-schema → fuuz-flows → fuuz-screens` as a directed dependency chain.

**Industrial-Domain Content:**
- Device drivers for PLCs, Modbus, OPC UA, MQTT Sparkplug B, SAP RFC
- Unit conversion framework (ISA-95 units of measure categories)
- Shift scheduling model (Schedule Groups → Schedules → Schedule Events → RRule)

---

### 4.6 fuuz-industrial-ops

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz-industrial-ops/SKILL.md`
**Lines:** 475

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-industrial-ops
description: >
  Apply industrial operations domain knowledge within Fuuz applications. Trigger this skill for OEE
  calculations, ISO 22400 time classification, ISA-95 equipment hierarchy design, UNS topic structure,
  alarm management patterns, workcenter state modeling, ERP integration patterns, or any manufacturing
  KPI implementation in Fuuz. Also trigger for shift scheduling, downtime tracking, production reporting,
  or when industrial standards compliance is required in a Fuuz application.
---
```

**H2 Section Headers (14 sections):**
1. When to Use This Skill
2. ISA-95 Asset Hierarchy
3. Unified Namespace (UNS)
4. Alarm Management
5. OEE and ISO 22400 Time Classification
6. OPC UA Quality Codes
7. Ideal Cycle Time Fallback Pattern
8. OEE Domain Formulas
9. Workcenter State Management
10. Equipment-Specific Downtime Notes
11. GraphQL Syntax Reference
12. ERP Integration Patterns
13. Resources
14. Version History

**Reference Files:**
- `references/uns-patterns.md` — UNS topic building with JSONata, conditional hierarchy levels

**Notable Patterns:**
- **UNS topic format:** `fuuz/{site}/{area}/{line}/{cell}/{equipment}/{datatype}` — the `fuuz/` vendor prefix is hardcoded into all UNS path builders. This is vendor-specific, not the MQTT standard pattern.
- **OEE benchmark documentation:** world-class = 85%, typical manufacturing = 60%. Gives Claude grounding for "is this OEE good?" questions.
- **ISO 22400 time classification** — Planned Production Time, Scheduled Downtime, Unplanned Downtime, Equipment Failures, Quality Losses. Not invented by Fuuz; independently citable from ISO 22400.
- **OPC UA quality code map:** 192 = Good, 64 = Uncertain, 16 = Bad. Platform-independent standard.
- **Ideal Cycle Time Fallback Pattern** — when cycle time is unknown, derive it from the best-performing 10% of production records. This is an industry-standard estimation technique.
- **Workcenter State Machine** — `Running` / `Idle` / `Scheduled Downtime` / `Unplanned Downtime` / `Changeover` / `Maintenance` state transitions.
- **ERP Integration Patterns** — push/pull reconciliation strategies for SAP and Plex connectors.

**Industrial-Domain Content:**
This skill is entirely industrial-domain content. ISA-95 hierarchy, OEE formulas, alarm management, shift scheduling, quality codes. The Fuuz-specific parts are the GraphQL syntax for querying these structures — the domain knowledge itself is standard.

---

### 4.7 fuuz-ml-telemetry

**File:** `/Users/charlienode/reference-repos/fuuz-skills/fuuz-ml-telemetry/SKILL.md`
**Lines:** 399

**YAML Frontmatter (exact quote):**
```yaml
---
name: fuuz-ml-telemetry
description: >
  Implement machine learning and telemetry analytics in Fuuz applications. Trigger this skill for anomaly
  detection, predictive analytics, statistical process control, telemetry data processing, sensor data
  analysis, EWMA baselines, Z-score calculations, Pearson correlation, or any ML/analytics pipeline
  in Fuuz. Also trigger for high-frequency data ingestion patterns, TTL index configuration, telemetry
  model design, or when building self-learning analytics that adapt to changing equipment behavior.
---
```

**H2 Section Headers (13 sections):**
1. When to Use This Skill
2. JavaScript Runtime Limitations (CRITICAL — ES5 only, labeled at section level)
3. ML Pipeline Architecture
4. EWMA Baseline Algorithm
5. Z-Score Anomaly Detection
6. Pearson Correlation Analysis
7. SPC — Statistical Process Control
8. Telemetry Model Design
9. TTL Index Configuration
10. High-Volume Data Patterns
11. Validation Checklist
12. Common Pitfalls and Debugging
13. Resources

**Reference Files:**
- `references/validation-checklist.md` — Three-domain checklist (Data Model / Flow / Screen) in checkbox format

**Notable Patterns:**
- **EWMA formula documented explicitly:** `newMean = alpha * newValue + (1 - alpha) * oldMean`. O(1) memory — only the running mean is stored, not the full history. Alpha typically 0.1–0.3 for industrial sensor smoothing.
- **Guard node pattern** — prevents writing to the DB when no historical data exists yet: `$count($.modelName.edges.node) = 0`. This is the standard Fuuz pattern for "first run" protection.
- **Parallel mutation path architecture** — one JS Transform node fans out via a Broadcast node to multiple parallel paths: Path A (guard → mutate statistics), Path B (mutate raw telemetry), Path C (mutate alerts). This is the canonical high-throughput pattern.
- **TTL index configuration** — for high-volume telemetry, the `ttl` field on the data model controls automatic record expiration. Documents optimal retention windows by data type.
- **JavaScript Runtime Limitations labeled at section title level** (CRITICAL) — not buried in content. Escalated to H2 heading with severity marker.
- **Three-domain validation checklist** — Data Model checks / Flow checks / Screen checks. Each domain has its own checkbox list. Structure is reusable for any multi-domain implementation skill.

**Industrial-Domain Content:**
- Sensor data anomaly detection for predictive maintenance
- Vibration/temperature/pressure telemetry patterns
- Statistical process control (SPC) for quality monitoring
- High-volume time-series data at industrial IoT scale (millions of records/day)

---

## 5. Cross-Cutting Patterns

### 5.1 Skill Loading Model

Fuuz skills are **`.skill` archives** — ZIP files where `SKILL.md` is the root document. They are deployed via the Claude Code admin console and appear at a runtime path: `/mnt/skills/user/<skill-name>/SKILL.md`. Skills activate based on YAML frontmatter trigger keywords matching user intent.

Key constraints from the version manifest:
- **Skills CANNOT reference files outside the skills directory.** All content must be self-contained in the ZIP archive.
- A skill's `name` field in the frontmatter is the activation identifier. One skill per activation event.
- Multiple skills can be co-active (the cross-skill-index explicitly models multi-skill workflows).
- Skill version bumps go through a `NewTrainingData/` workflow for re-deployment.

MIRA's skill system uses a different mechanism (`.claude/skills/<name>/SKILL.md` in the repo, loaded via Claude Code's built-in skill scanning) but the structural principles are identical: frontmatter trigger, self-contained content, named activation.

### 5.2 YAML Frontmatter Trigger Shape

All 7 Fuuz skills use the same frontmatter shape:

```yaml
---
name: <skill-name>          # Activation identifier
description: >              # Multi-line trigger description
  <keyword-rich prose that tells Claude when to activate this skill>
---
```

**Pattern observations:**
- The description is deliberately keyword-dense rather than cleanly written — it lists every plausible trigger phrase a developer might use, separated by commas.
- Most descriptions end with "Also trigger when..." to catch edge cases.
- The fuuz-platform skill uniquely adds "Do NOT trigger for..." to prevent over-activation against more specific skills.
- None use `version:` in the frontmatter — version is tracked separately in `SKILLS_VERSION_MANIFEST.md`.
- The `fuuz-flows` skill uses `name: fuuz-flows-v1` (version in name field) — an artifact of an older versioning approach apparently not cleaned up.

**For MIRA:** MIRA's existing skills (from system reminder) include: `ar-hud`, `bot-adapters`, `conversation-forensic`, `design-ship-routine`, `diagnostic-workflow`, `harness`, `inference-routing`, `kb-benchmark`, `knowledge-ingest`, `photo-ingest-watcher`, `saas-activation`, `smart-commit`, `stripe`, `telegram_bot_tuning`, `youtube-transcript`. The frontmatter trigger pattern is the same mechanism.

### 5.3 Reference-File Pattern

Every skill that goes beyond ~500 lines outsources depth to `references/` subdirectory files. The pattern:
- **SKILL.md** = operating rules + section headers + quick-reference tables
- **`references/<topic>.md`** = deep domain content (full formula tables, complete checklists, exhaustive connector lists)

Some reference files have their own YAML frontmatter (e.g., `screen-essentials.md`, `package-deployment-lifecycle.md`), suggesting they can activate standalone. Others are pure reference documents with no frontmatter.

This two-tier architecture keeps SKILL.md scannable (600–900 lines for most skills, not 2000+) while making deep reference available when needed.

### 5.4 Golden Rules Format

Every skill uses numbered, titled rules in a consistent format:

```
**XX-NNN**: One-sentence constraint, imperative mood, no hedging.
```

Where `XX` is a domain prefix (GP = general package, DM = data model, SC = screen, DF = data flow) and `NNN` is a zero-padded sequence number. Rules increase in number across skills (fuuz-packages has 71, fuuz-schema has 24, fuuz-screens has ~30).

**Key properties of effective rules:**
- Imperative mood ("Never define", "Always include", "Use only")
- Specific violation consequence documented when relevant ("causes import failure", "results in duplicate field error")
- Severity where applicable — FATAL vs WARNING vs STYLE
- One constraint per rule — never compound rules

### 5.5 Error Reference Pattern

`fuuz-packages/SKILL.md` includes an **Import Error Reference section** that maps actual platform error strings (what the user sees when an import fails) to their root causes. This is a high-value pattern: error-message-to-cause mapping is one of the most practical things a skill can teach Claude.

Format:
```
Error message: "<exact string from platform>"
Cause: <diagnosis>
Fix: <corrective action>
```

### 5.6 Output Checklist Pattern

Multiple skills include a final output checklist that Claude must run before declaring the artifact complete. The checklist is domain-specific:
- `fuuz-packages/SKILL.md` → Pre-Package Validation Checklist (model/screen/flow domains)
- `fuuz-screens/SKILL.md` → Output Checklist (required properties that commonly get omitted)
- `fuuz-ml-telemetry/references/validation-checklist.md` → Three-domain checklist (Data Model / Flow / Screen)

All use checkbox format: `- [ ] <check description>`. The checklist is the last section before "Reference Files" in each skill.

### 5.7 Cross-Skill Dependency Documentation

`fuuz-platform/references/cross-skill-index.md` explicitly documents:
1. **Task → skill decision matrix** — for any task, which skill is primary, which are supporting
2. **Artifact dependency graph** (ASCII art) — shows data flow direction: schema feeds flows feeds screens
3. **Multi-skill workflow recipes** — e.g., "Build a New Application from Scratch = fuuz-platform → fuuz-schema → fuuz-flows → fuuz-screens in sequence"
4. **File-level cross-references** — which exact files in each skill point to which files in other skills

MIRA has no equivalent cross-skill index. This is a structural gap.

### 5.8 Versioning Convention

Skills use semantic versioning: `v<major>.<minor>.<patch>`. The version manifest tracks:
- Current version per skill
- Deployment target (which Claude Code instance)
- Version history (all past versions with dates and change descriptions)
- Status per deployment target (some skills are deployed to one team but not another)

The rule: "A skill version bump requires re-packaging the `.skill` archive and re-deploying via the admin console." — manual process, no CI/CD for skills.

### 5.9 How These Skills Teach Claude About a Proprietary Platform

The core teaching mechanism is **constraint enumeration via negative examples**. Rather than describing what valid output looks like (which Claude could infer from examples), Fuuz skills focus on documenting:

1. **What looks right but is wrong** — `usable` vs `active`, system fields you shouldn't define, ES5-only JS, wrong GraphQL shape
2. **Silent failures** — issues that pass import but corrupt data (wrong retention tier, missing inverse relation)
3. **Platform-specific deviations from standards** — JSONata behavior inside Fuuz differs from standard JSONata in specific documented ways
4. **Error messages → causes** — when something fails, what does it say and why

This is fundamentally different from "here's an example and extend it." It teaches the *failure modes* first.

### 5.10 Naming Conventions as Enforced Rules

Every skill establishes naming conventions as numbered rules, not style guidelines:
- PascalCase singular for model names
- camelCase for fields
- Specific suffixes (`At` for DateTime, `is`/`has` for booleans)
- Flow naming pattern `[TriggerType]_[Model]_[Action]`
- `v<major>.<minor>.<patch>` for package versions

The framing matters: "Use PascalCase singular for model names because the import validator rejects plurals" is a rule with a consequence, not a preference.

---

## 6. proveit2026 Analysis

### Repository Overview

`/Users/charlienode/reference-repos/proveit2026/` contains three production `.fuuz` packages demonstrating the Fuuz package format at real enterprise scale. Per the README:

**Enterprise C — MES App:**
- 28 data models, 26 screens, 39 data flows
- Production tracking, work orders, OEE, shift management, equipment downtime
- CESMII i3X standard compliance noted

**Enterprise B — WMS App:**
- 38 models, 33 screens, 33 flows
- Warehouse management, inventory, picking, shipping, GS1/SSCC handling unit tracking
- Integration with Enterprise C for production-inventory sync

**Data Broker App:**
- 34 models, 14 screens, 22 flows
- MQTT/OPC UA/REST integration hub between Enterprise C, Enterprise B, and external ERP
- Tag normalization, data routing, transformation layer

**Integration architecture** (from README): Three-app topology where the Data Broker mediates all cross-app communication. Enterprise C and Enterprise B never communicate directly — all data flows through the broker. This is the Fuuz recommended multi-app architecture pattern.

### .fuuz Package Format

Confirmed by extraction of `ProveIT Data Broker App@0.0.1.fuuz`:

```bash
tar -xzf "ProveIT Data Broker App@0.0.1.fuuz" -C /tmp/fuuz-extract/
```

Produces exactly 3 files:

**manifest.json** — package metadata:
```json
{
  "name": "ProveIT Data Broker App",
  "version": "0.0.1",
  "applicationPublisherId": null,
  "enterpriseId": "proveit",
  "environmentId": "build",
  "dependencies": {},
  "specVersion": "2.0.0",
  "platformVersion": "2026.2.1"
}
```

**definition.json** — component selection manifest:
- Top-level keys: `packageDefinition`, `packageDefinitionVersion`, `packageDefinitionSelections`
- `packageDefinitionSelections` contains arrays of 5 types: `DataFlow`, `DataModel`, `Screen`, `Module`, `ModuleGroup`
- Each selection entry: `{ "type": "<ComponentType>", "id": "<uuid>", "name": "<display-name>" }`

**package-data.json** — all component definitions:
- Top-level keys (exactly 7): `dataModels`, `dataFlows`, `dataMappings`, `documentDesigns`, `screens`, `savedTransforms`, `data`
- Data Broker contents: 34 dataModels, 22 dataFlows, 0 dataMappings, 0 documentDesigns, 14 screens, 0 savedTransforms, 2 data entries

Model names visible in Data Broker: `Area`, `Asset`, `Enterprise`, `EnterpriseCValues`, `EntityAsset`, `IotTag`, `IotTagDataPoint`, `IotTagGroup`, `IotTagValue`, `LineAsset`, `PendingRecord`, `ProductionLineShift`, `Shift`, `ShiftResult`, `Site`, `Tag`, `TagGroup`, and more (34 total).

The Data Broker's model names confirm the ISA-95 hierarchy physically modeled in the schema: `Enterprise → Site → Area → Asset → IotTag → IotTagDataPoint`.

### What the Package Format Reveals

1. **No executable code in packages** — pure JSON throughout. All logic is expressed as declarative node configurations in the `dataFlows` array.
2. **Platform version pinned in manifest** — `"platformVersion": "2026.2.1"` ensures reproducible deployment.
3. **`data` array contains seed records** — the 2 data entries in the Data Broker are likely lookup table seeds (status codes, tag types, etc.).
4. **UUID-based identities** — all component references use GUIDs, not names, for FK relationships between package components.
5. **The "exactly 7 keys" rule is verified** — package-data.json has exactly `dataModels`, `dataFlows`, `dataMappings`, `documentDesigns`, `screens`, `savedTransforms`, `data`. The FATAL rule in fuuz-packages is accurate.

---

## 7. What Is Genuinely Transferable to MIRA

These are **structural and pedagogical patterns** that MIRA can implement independently with its own content. None of these involve copying Fuuz expression.

### 7.1 Two-Tier Skill Architecture (SKILL.md + references/)

**Pattern:** Main SKILL.md stays scannable (600–900 lines of rules and quick-reference), with deep domain content in a `references/` subdirectory. Reference files can optionally carry their own YAML frontmatter for standalone activation.

**MIRA application:** MIRA's `diagnostic-workflow`, `knowledge-ingest`, and `component-profile-builder` skills are likely candidates to grow beyond 600 lines. Split depth to `references/` before that threshold, keeping SKILL.md as the rules layer.

### 7.2 Numbered Golden Rules with Domain Prefixes

**Pattern:** `**XX-NNN**: Imperative constraint with documented consequence.`

**MIRA application:** MIRA skills currently use prose sections. Numbered rules with domain prefix codes (`UNS-`, `KG-`, `ENG-`, `ING-`) would make constraint enumeration clearer and easier to reference in PRs ("this violates KG-003").

### 7.3 Explicit Negative Trigger in Platform/Reference Skills

**Pattern:** The `fuuz-platform` skill's frontmatter ends with "Do NOT trigger for data model design (fuuz-schema), flow building (fuuz-flows), or screen creation (fuuz-screens) unless those skills are also active."

**MIRA application:** A future `mira-platform` or architecture reference skill should include explicit "Do NOT trigger for..." clauses to prevent it from overriding specialized output-generating skills.

### 7.4 Error-Message-to-Cause Reference Section

**Pattern:** Map exact platform error strings → root cause → fix. Embedded in the skill where users will encounter it.

**MIRA application:** The MIRA engine has documented error patterns (hallucination audit findings, UNS resolution failures, groundedness score drops). A `Common Errors Reference` section in `diagnostic-workflow/SKILL.md` mapping engine error patterns to their causes would be high-value for debugging sessions.

### 7.5 Output Checklist as Final Gate

**Pattern:** Checkbox checklist at the end of each skill's operating section. Claude runs through it before declaring output complete.

**MIRA application:** `knowledge-ingest/SKILL.md` and `component-profile-builder/SKILL.md` would benefit from output checklists. Example items: "Does every extracted fact have a source page reference?", "Is the confidence field populated?", "Has dedup.py been invoked?", "Does every asset row have a UNS path or equipment_entity_id FK?"

### 7.6 Severity Tiers for Rule Violations

**Pattern:** FATAL (blocks deployment) vs WARNING (review recommended) vs STYLE (best practice). Documented at the rule level.

**MIRA application:** The UNS compliance rules and KG proposal rules have an implicit severity hierarchy. Making it explicit — `[FATAL]` for auto-promoting proposed→verified without review, `[WARNING]` for low groundedness score, `[STYLE]` for naming conventions — would help Claude prioritize which issues to fix vs flag.

### 7.7 Cross-Skill Index Document

**Pattern:** A standalone `cross-skill-index.md` that documents the skill dependency graph, task→skill decision matrix, and multi-skill workflow recipes. No SKILL.md content is duplicated; it purely maps the territory.

**MIRA application:** MIRA has 15+ skills and no documented decision matrix. Creating `.claude/skills/cross-skill-index.md` (or `wiki/references/skill-index.md`) that maps "what to activate for UNS resolution tasks", "what to activate for KB ingestion", "what to activate for engine debugging" would reduce skill selection ambiguity.

### 7.8 Version Manifest for Skills

**Pattern:** `SKILLS_VERSION_MANIFEST.md` with semantic versioning, deployment targets, status labels (`draft`/`review`/`ready`/`deployed`/`deprecated`/`baked-in`), and version history.

**MIRA application:** MIRA's 15 skills have no version tracking. A version manifest at `.claude/skills/MANIFEST.md` would surface when skills are stale relative to the codebase they describe (e.g., `diagnostic-workflow` was written before the RESOLVED-state rebuild fix in PR #1266).

### 7.9 Failure Mode Teaching over Example Teaching

**Pattern:** Fuuz skills teach by documenting what looks right but is wrong, silent failures, platform deviations from standards, and error message meanings — not by providing examples and saying "extend this."

**MIRA application:** MIRA's `uns-compliance.md` already does this for UNS (fault codes must be extracted before model candidates, pure-digit models are valid, reserved labels are off-limits). Extend this approach to `knowledge-ingest`, `component-profile-builder`, and `diagnostic-workflow`.

### 7.10 Runtime Limitation Documentation at Section Level

**Pattern:** `fuuz-ml-telemetry/SKILL.md` elevates "JavaScript Runtime Limitations (CRITICAL)" to an H2 heading with a severity label — not buried in a subsection. This ensures Claude encounters it early in any scan.

**MIRA application:** MIRA's Python-standards.md already documents some runtime constraints, but the pattern could be used in SKILL.md files directly. For example, `inference-routing/SKILL.md` could lead with "**[CRITICAL]** Never reintroduce Anthropic as a provider" as an H2 before the operational content.

---

## 8. What Is NOT Transferable

These patterns are Fuuz-specific with no MIRA analog. Attempting to adapt them to MIRA would introduce category errors.

### 8.1 JSONata as Primary Expression Language

Fuuz's entire data binding and transformation layer is built on JSONata — a query language designed for JSON with functional composition semantics. JSONata is native to the Fuuz platform; MIRA has no equivalent binding language. MIRA's Python codebase uses standard Python/asyncio throughout. There is nothing to adapt.

### 8.2 Relay-Style GraphQL Connections

Fuuz auto-generates a full GraphQL API for every data model with Relay-style `edges { node { ... } }` query shapes. MIRA uses PostgreSQL/NeonDB with raw SQL or SQLAlchemy ORM. The GraphQL patterns documented across all Fuuz skills are platform-specific with no MIRA analog.

### 8.3 The Relationship TRIPLET Constraint

Fuuz's import validator requires that every model relationship be defined in three places simultaneously (FK scalar + forward relation + inverse list). This is a Fuuz platform constraint with no equivalent in MIRA's NeonDB schema design. MIRA's foreign key relationships follow standard PostgreSQL FK constraints.

### 8.4 `.fuuz` Package Deployment Model

Fuuz applications are distributed and deployed as `.fuuz` ZIP+TAR archives imported via the platform UI. MIRA deployments use Docker Compose with GitHub Actions CI/CD. There is no package archive format, no import validator, no platform-version pinning in MIRA's deployment model.

### 8.5 Data Model Classification Tiers (usable vs active)

The `usable`/`active` distinction is a Fuuz platform concept controlling how records are treated in list queries. MIRA's NeonDB tables use standard `is_active` boolean columns without platform-enforced semantic tiers.

### 8.6 ES5 JavaScript Restriction

Fuuz flows run in a sandboxed ES5 environment. MIRA has no such constraint — Python 3.12 is the execution environment throughout.

### 8.7 Craft.js Screen Component System

Fuuz screens are JSON-encoded craft.js component trees with 59 named element types. MIRA's user interfaces are either Slack/Telegram messages (plain text with Markdown) or React/Hono pages in `mira-web`. There is no screen component registry concept in MIRA.

### 8.8 ISA-101 HMI Screen Compliance

ISA-101 HMI design standards apply to graphical operator interfaces on factory floors — color conventions, touch target sizing, animation constraints for industrial displays. MIRA's technician interface is Slack on a phone. The visual compliance requirements don't transfer, though the underlying principle (design for gloved hands in a noisy plant) is partially applicable to MIRA's Slack UX.

### 8.9 Vendor-Prefixed UNS Topics

Fuuz's UNS uses `fuuz/{site}/{area}/...` — the vendor prefix `fuuz/` is hardcoded. MIRA's UNS uses ISA-95 ltree path notation without vendor prefixes. The UNS namespace structures are architecturally related (both follow ISA-95 hierarchy) but incompatible at the path level.

### 8.10 Platform-Level Connector/Driver Registry

Fuuz documents 44 built-in connectors and 19 device drivers as platform capabilities. MIRA doesn't have a built-in connector registry — integrations are implemented as custom Python services. The connector configuration patterns documented in `fuuz-platform/SKILL.md` have no MIRA equivalent.

---

## 9. Risks If MIRA Copies Blindly

### Risk 1: Importing Fuuz's Copyright Expression

**Severity: HIGH**
Neither repository has a license. Reproducing Fuuz's numbered golden-rules lists, JSON templates, or prose checklists verbatim constitutes copyright infringement. The risk is not theoretical — Fuuz Industrial Intelligence is an active commercial company and these materials are their intellectual property.

**Mitigation:** Structural patterns are ideas (not copyrightable). Specific expression is protected. Always write MIRA skill content from scratch using Fuuz patterns as structural inspiration, not textual templates.

### Risk 2: Importing Platform-Specific Constraints as Universal Rules

**Severity: MEDIUM**
Fuuz skills are full of rules that are correct for Fuuz but wrong for MIRA. Examples: "Never define createdAt/updatedAt" (Fuuz auto-generates these; MIRA uses them explicitly), "Use `usable` for enum models" (Fuuz-specific field), "GraphQL returns `edges { node { ... } }`" (Fuuz-specific query shape; MIRA uses plain SQL result sets). Importing these as MIRA rules would introduce actual bugs.

**Mitigation:** Every rule adopted from Fuuz pattern inspection must be verified against MIRA's actual architecture before adoption. The fact that a rule makes sense for a no-code platform does not make it applicable to a Python microservice system.

### Risk 3: Confusing Fuuz UNS with MIRA UNS

**Severity: MEDIUM**
Both systems use "UNS" and reference ISA-95 hierarchy, but the implementations are incompatible:
- Fuuz UNS: `fuuz/{site}/{area}/{line}/{cell}/{equipment}/{datatype}` — MQTT topic namespace, vendor-prefixed
- MIRA UNS: ISA-95 ltree paths in PostgreSQL, no vendor prefix, used for knowledge graph addressing

Copying Fuuz UNS path patterns into MIRA would introduce wrong path formats that would break `uns_resolver.py` and contaminate the NeonDB knowledge graph.

**Mitigation:** Treat Fuuz UNS and MIRA UNS as independently designed systems that both happen to reference ISA-95. The Fuuz UNS documents in `fuuz-industrial-ops/references/uns-patterns.md` are useful for understanding ISA-95 hierarchy concepts, but the JSONata path builders and `fuuz/` prefix must never appear in MIRA code.

### Risk 4: Skill Bloat Without Clear Activation Boundaries

**Severity: LOW-MEDIUM**
Fuuz's `fuuz-platform` skill has an explicit negative trigger precisely because, without it, the platform reference skill would over-activate and pollute every response with platform context. MIRA skills don't currently use negative triggers. As MIRA adds more skills, lack of explicit non-activation conditions could cause the wrong skill to dominate responses.

**Mitigation:** When adding new reference/platform skills to MIRA, add "Do NOT trigger for..." clauses to prevent over-activation against specialized output-generating skills.

### Risk 5: Version Manifest Becoming Stale

**Severity: LOW**
If MIRA adopts a version manifest pattern for skills but doesn't maintain it, the manifest becomes an actively misleading document — claiming skills are "ready" when they've drifted behind codebase changes. This is worse than no manifest.

**Mitigation:** If a skill version manifest is created, it must be updated as part of any PR that changes skill content or the code/architecture the skill describes. Make skill manifest updates part of the PR template checklist.

---

## 10. Adaptation Map

This section maps each Fuuz skill to its closest MIRA-native counterpart. The goal is to identify which existing MIRA skills could be strengthened by applying the structural patterns from Section 7, and where genuine gaps exist.

### Fuuz → MIRA Skill Mapping

| Fuuz Skill | Lines | Purpose | Closest MIRA Skill | Relationship | Action |
|---|---|---|---|---|---|
| `fuuz-industrial-ops` | 475 | ISA-95 hierarchy, OEE, UNS, alarm management | `uns-location-gate-designer` + `plc-tag-mapper` | Partial overlap: ISA-95 hierarchy and UNS concepts appear in both; MIRA handles the resolution side, Fuuz handles the modeling side | Extract ISA-95 hierarchy documentation pattern; verify against `mira-crawler/ingest/uns.py` before applying |
| `fuuz-schema` | 794 | Data model design, relationship TRIPLETS, field types | `knowledge-graph-proposer` + `component-profile-builder` | Conceptual parallel: both define entity schemas and relationship rules; Fuuz targets GraphQL/NoSQL, MIRA targets NeonDB/PostgreSQL | Apply numbered-rules format with KG prefix codes; adopt severity tiers (FATAL for auto-verify-without-review) |
| `fuuz-ml-telemetry` | 399 | EWMA, anomaly detection, SPC, telemetry pipelines | `bot-grounding-tests` + `harness` | Distant overlap: EWMA/Z-score algorithms are independently applicable for sensor baselines; Fuuz's implementation is JS/JSONata, MIRA's would be Python | EWMA and Z-score algorithms are independently citable from ML literature; reference primary sources (Holt 1957 for EWMA), not Fuuz documentation |
| `fuuz-screens` | 955 | Craft.js screen JSON, component registry, HMI design | `slack-technician-ux-writer` | Conceptual parallel: both define "what a valid output looks like" for a specific rendering target; Fuuz targets craft.js JSON, MIRA targets Slack Block Kit messages | Apply the decision matrix pattern (user intent → output structure) to Slack message design; apply ISA-101's "gloved-hands, noisy plant" usability principle to Slack message length/format rules |
| `fuuz-platform` | 627 | Platform architecture reference, connectors, API shapes | (no direct counterpart — nearest is MIRA's `CLAUDE.md` and `.claude/rules/`) | Structural parallel: reference-only skill providing grounding context; explicit negative trigger to prevent over-activation | Create `.claude/skills/mira-architecture-guardian/SKILL.md` as a platform reference skill; include explicit "Do NOT trigger for..." clause to prevent it displacing specialized skills |
| `fuuz-packages` | 1803 | `.fuuz` package generation, validation, deployment | `knowledge-ingest` + `manual-ingestion-extractor` | Loose parallel: both involve bundling structured data for import into a target system; Fuuz's target is the platform importer, MIRA's target is NeonDB + Open WebUI KB | Apply the "exactly N top-level keys" constraint pattern to KB ingestion schemas; apply error-message-to-cause reference pattern for common ingestion failures |
| `fuuz-flows` | 675 | Server-side flow logic, node configurations, ES5 JS | (no direct counterpart — MIRA's logic layer is `shared/engine.py` + Python services) | No direct mapping: Fuuz flows are a visual no-code abstraction over backend logic; MIRA implements equivalent logic directly in Python | This gap suggests a potential new MIRA skill: `pipeline-orchestration` covering `mira-pipeline/` + `shared/engine.py` FSM patterns, but this is out of scope for this analysis |

### Detailed Adaptation Notes

#### fuuz-industrial-ops → uns-location-gate-designer + plc-tag-mapper

The ISA-95 hierarchy documentation in `fuuz-industrial-ops/SKILL.md` is the most directly useful domain content in the Fuuz skills suite. However, MIRA's UNS implementation is already operational (shipped in PR #1330 per memory). What to take:

- **Section structure pattern**: ISA-95 hierarchy → UNS path format → alarm management → state machine → integration patterns. This sequencing makes sense for MIRA's equivalent skill.
- **State machine documentation**: Fuuz's workcenter states (Running/Idle/Scheduled Downtime/Unplanned Downtime/Changeover/Maintenance) are exactly the states MIRA's engine tracks via the DST (`docs/specs/dialogue-state-tracker-spec.md`). A state-transition table in the MIRA skill would be high-value.
- **NOT to take**: The specific UNS path format `fuuz/{site}/...` and all JSONata path builder patterns.

#### fuuz-schema → knowledge-graph-proposer + component-profile-builder

The TRIPLET constraint pattern — three coordinated definitions that must all be present for a relationship to be valid — has a direct MIRA analog in the KG relationship rules (`status + evidence + confidence` all required together). Framing MIRA's KG constraint as a triplet would make it more memorable:

```
**KG-TRIPLET**: Every kg_relationships row must have: (1) relationship_type from the controlled vocabulary, 
(2) evidence field with source citation, (3) confidence value. A relationship missing any of these 
three is incomplete and MUST NOT be promoted from 'proposed'.
```

The `usable`/`active` distinction maps conceptually to MIRA's `proposed`/`verified`/`rejected`/`needs_review` promotion states — both are platform-enforced status semantics that Claude must never circumvent.

#### fuuz-ml-telemetry → bot-grounding-tests + harness

The EWMA algorithm documented in fuuz-ml-telemetry (`newMean = alpha * newValue + (1 - alpha) * oldMean`) is independently applicable to MIRA's groundedness scoring. If MIRA wanted to build self-adapting baselines for engine performance (e.g., moving-average groundedness score per asset category), this is the algorithm to use. But the implementation would be pure Python — the Fuuz skill's ES5 JS constraints and Broadcast node patterns are irrelevant.

The **three-domain validation checklist** (Data Model / Flow / Screen in Fuuz) maps to MIRA's (Schema / Engine / Bot Adapter) domains. The checkbox format is directly applicable.

#### fuuz-screens → slack-technician-ux-writer

The ISA-101 principle that HMI screens must work for operators wearing gloves in a noisy environment is directly applicable to Slack messages sent to maintenance technicians. MIRA's `slack-technician-ux-writer/SKILL.md` should encode this as a first-class constraint:

- Short paragraphs (gloved thumb scrolling, not desktop reading)
- High-information-density lead line (site → asset → component → fault, in that order)
- Maximum 3 bullet points of evidence before asking for confirmation
- No corporate hedging language

The decision-matrix pattern from fuuz-screens (user intent → output structure) maps well: "technician reports a fault" → structured context confirmation message; "technician confirms context" → troubleshooting step list; "technician reports equipment back online" → close-out and WO update prompt.

#### fuuz-platform → mira-architecture-guardian (new skill recommended)

MIRA currently has no skill dedicated to preventing architectural violations across multiple other skills. MIRA's equivalent of `fuuz-platform` would be a read-only architecture reference skill that:

1. Documents the provider cascade (Groq → Cerebras → Gemini — never Anthropic)
2. Documents the UNS gate as a non-negotiable
3. Documents the environment boundaries (no prod psql, no direct VPS docker compose)
4. Carries an explicit negative trigger to prevent it from overriding specialized skills

This skill would surface the information currently scattered across `CLAUDE.md`, `.claude/rules/`, and `docs/ARCHITECTURE.md` in a Claude-activatable format.

#### fuuz-packages → knowledge-ingest + manual-ingestion-extractor

The fuuz-packages skill's most transferable pattern is the **error-message-to-cause reference**. MIRA's ingestion pipeline has documented failure modes (embedding gate killed BM25 in May 2026 per memory; OEM migration blockers; dedup failures). An `Ingestion Error Reference` section in `knowledge-ingest/SKILL.md` mapping actual error messages to root causes would reduce debugging time.

The **pre-ingestion validation checklist** from fuuz-packages maps directly: before calling `mira-crawler/ingest/` functions, Claude should verify that the source document has been chunked, deduplicated, confidence-tagged, and UNS-path-tagged.

#### fuuz-flows → (gap: no direct counterpart)

Fuuz flows are the visual no-code abstraction over backend logic. MIRA implements equivalent logic directly in Python in `shared/engine.py`, `mira-pipeline/`, and the various bot adapters. There is no MIRA "flow builder" skill because flows are Python code, not visual node graphs.

However, this analysis surfaces a genuine skill gap: MIRA has no skill that teaches Claude how the `shared/engine.py` FSM, the inference cascade, and the grounding pipeline work together as an orchestration layer. A `pipeline-orchestration` skill covering these three would improve Claude's accuracy when asked to modify engine behavior. This is a recommendation, not an immediate action item — it falls outside the current 90-day MVP plan scope.

---

## Appendix A: File Reference Index

All source files consulted during this analysis:

| File | Lines | Purpose |
|---|---|---|
| `/Users/charlienode/reference-repos/fuuz-skills/README.md` | ~150 | Skills overview, installation, repo structure |
| `/Users/charlienode/reference-repos/fuuz-skills/SKILLS_VERSION_MANIFEST.md` | ~200 | Version tracking, deployment targets, status legend |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-packages/SKILL.md` | 1803 | Packages skill — 71 golden rules, package format, deployment |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-packages/references/package-deployment-lifecycle.md` | 270 | Deployment procedures, Green/Blue, accelerators |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz schema/SKILL.md` | 794 | Schema design, field types, relationship TRIPLET |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz screens/SKILL.md` | 955 | Screen JSON, 59 component types, HMI design |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz screens/references/screen-essentials.md` | ~400 | Screen JSON structure, MainFormContainer pattern |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz flows/SKILL.md` | 675 | Flow types, ES5 constraint, 50+ node types, JSONata |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-platform/SKILL.md` | 627 | Platform reference, 44 connectors, 19 drivers |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-platform/references/cross-skill-index.md` | 166 | Task→skill matrix, dependency graph |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-platform/references/platform-glossary.md` | 166 | 40+ core concept definitions |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-industrial-ops/SKILL.md` | 475 | ISA-95, OEE, UNS, alarm management, OPC UA |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-industrial-ops/references/uns-patterns.md` | ~100 | UNS topic building, JSONata conditional hierarchy |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-ml-telemetry/SKILL.md` | 399 | EWMA, Z-score, SPC, TTL indices, parallel paths |
| `/Users/charlienode/reference-repos/fuuz-skills/fuuz-ml-telemetry/references/validation-checklist.md` | ~80 | Three-domain checklist (Model/Flow/Screen) |
| `/Users/charlienode/reference-repos/proveit2026/README.md` | ~200 | Three-app architecture, model/screen/flow counts |
| `/tmp/fuuz-extract/manifest.json` | 12 | Extracted from Data Broker .fuuz package |
| `/tmp/fuuz-extract/definition.json` | ~500 | Component selection manifest, 5 selection types |
| `/tmp/fuuz-extract/package-data.json` | ~50,000 | Full package contents (34 models, 22 flows, 14 screens) |

**GitHub org verified:** `https://github.com/Fuuz-Industrial-Intelligence` — 5 public repositories:
- `fuuz-skills` (this analysis)
- `proveit2026` (this analysis)
- `package_allUnitsOfMeasure` (units of measure package)
- `package_SIUnitsOfMeasure` (SI units package)
- `package_ImperialUnitsOfMeasure` (imperial units package)

The three units-of-measure repos were not analyzed (scope limited to fuuz-skills and proveit2026 per research brief).

---

## Appendix B: Key Industrial Standards Referenced

These standards are cited within Fuuz skills and are independently citable from primary sources. MIRA can reference them directly without citing Fuuz.

| Standard | What It Covers | Relevance to MIRA |
|---|---|---|
| **ISA-95** (ANSI/ISA-95) | Equipment hierarchy (Enterprise → Site → Area → Work Center → Work Unit) and MES data models | MIRA's UNS is ISA-95 compliant; the hierarchy levels are standard |
| **ISO 22400** | OEE calculation methodology, time category definitions (Planned Production Time, Downtime, Quality Losses) | Relevant if MIRA surfaces OEE metrics from customer data |
| **ISA-88** (ANSI/ISA-88) | Batch processing procedural hierarchy (Procedure → Unit Procedure → Operation → Phase) | Relevant for batch manufacturers in MIRA's target market |
| **OPC UA** (IEC 62541) | Industrial communication protocol, quality code enumeration (Good=192, Uncertain=64, Bad=16) | Relevant for MIRA's MQTT/OPC UA ingest path |
| **ISA-101** | HMI design standard — color conventions, touch target sizing, animation constraints for industrial displays | Applicable to MIRA's Slack UX through the "gloved hands, noisy plant" usability principle |
| **GS1/SSCC** | Handling unit tracking codes for supply chain and warehouse operations | Tangentially relevant for WMS/CMMS customers |
| **CESMII i3X** | Smart manufacturing integration standard | Referenced in proveit2026 Enterprise C; not directly applicable to MIRA today |

---

*Document written 2026-05-19. Source repos are read-only clones at `/Users/charlienode/reference-repos/`. No Fuuz repository files were modified. All MIRA recommendations target existing skills listed in `.claude/skills/` or documented architectural gaps.*
