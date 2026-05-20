# Architecture Patterns Extracted from Fuuz

> Concrete architectural patterns observed in the Fuuz platform and surfaced through the [Episode 6 video](../videos/fuuz-video-analysis.md) + [public repos](../repos/fuuz-repo-analysis.md). Patterns are organized by layer. Each pattern has: **what it is**, **why Fuuz uses it**, **MIRA applicability**, **citation**.
>
> Last refreshed 2026-05-20. Source confidence is HIGH unless noted UNCONFIRMED.

---

## P-1 — Event-driven monolithic core with one internal broker

**What:** Single internal message broker inside the Fuuz application; every domain object (production, scrap, receiving, GL post, CRM update) emits "data change" events; in-process subscribers handle reactive workflows.

**Why:** Decoupling across domains without distributed-systems tax. "Doing integrations with Fuuz is super easy and they just work — because of the architecture behind the scenes." (Craig, Ep 6 `[08:00]`.)

**MIRA applicability:** **Borrow** the *philosophy*, not the implementation. MIRA already has an event-driven recall path (`mira-bots/shared/engine.py`); the lesson is that "cross-domain events on one bus" beats microservices-per-domain for a maintenance copilot. Where MIRA's surfaces grow (Hub, mira-web, Linear sync, Atlas sync), they should subscribe to a common change stream rather than poll each other.

**Citation:** Episode 6 `[07:00]`, fuuz-flows skill (dataChanges node type, `mutexLock` for races).

---

## P-2 — UNS = nervous system, data model + GraphQL = queryable memory

**What:** Two distinct layers, both first-class:
- **UNS (MQTT broker):** pub/sub, real-time only, **not queryable** ("if you're not subscribing to the topic when the event fires, that message is completely lost forever" — Craig `[12:30]`).
- **Data model + GraphQL:** persisted, queryable, historiable. Every data change is also persisted to a model; GraphQL serves the history.

**Why:** Each layer plays to its strength. MQTT for live; data model for "what happened yesterday." Trying to make MQTT queryable yields an unhappy hybrid; pairing them is clean.

**MIRA applicability:** **Validates MIRA's existing split.**
- Live = UNS via `mira-relay` + Sparkplug B (planned) + MQTT.
- Memory = `kg_entities` / `kg_relationships` + `cmms_*` tables in NeonDB, served via `mira-mcp`.
- The "i3X-compliant GraphQL over UNS data" pattern is something MIRA could add over its KG (we already have Postgres → an i3X-style GraphQL wrapper would make us interoperable with CESMII-aligned partners). UNCONFIRMED that any MIRA customer asks for this yet.

**Citation:** Episode 6 `[05:00]`–`[13:30]`. Fuuz-platform skill: "Dual API Architecture."

---

## P-3 — Mini UNS at the screen level

**What:** Every Fuuz screen has a `screen.context` keyed object that holds live state (KPIs, filters, current work-center, schedule, OEE rollups). UI components subscribe to keys in that context; page-load flows write to it; updates flow to subscribed components.

**Why:** "I came up with this concept that I wanted to have a little mini UNS for my user interface." (Craig `[20:30]`.) Decouples render from data fetch; mirrors the same pub/sub semantics one layer up.

**MIRA applicability:** **Future Hub pattern.** Today MIRA's surface is Slack (append-only output). When MIRA Hub (mira-hub at app.factorylm.com) grows live dashboards (component status, proposal queues, citation graph), this is the right shape. Each component subscribes to KG-state changes via Hub's React/Hono frontend; backend "page-load flow" hydrates context with KG snapshot.

**Citation:** Episode 6 `[20:30]`, `[24:00]`–`[25:30]`, `[49:30]`–`[51:30]`. Fuuz-screens skill: `screen-runtime-context.md`.

---

## P-4 — Mutex on data-point ID for sensor-burst concurrency

**What:** When 200–250 sensor reads per second hit the same data-point, wrap the per-record analysis path with `mutexLock { dataPointId } → query baseline → ML compute → upsert baseline → mutexUnlock`. Forces serialization per data point without serializing across data points.

**Why:** EWMA / Z-score / baseline-upsert state cannot be raced safely. Mutex per logical key (not per global lock) keeps throughput high.

**MIRA applicability:** **Direct.** When MIRA grows a sensor-trend grounding feature ("this motor's vibration is trending up"), this is the pattern. Today MIRA doesn't yet stream sensor data into the bot — but the same shape applies to **KG proposal upserts** (which today are admin-serial; once they go to per-bot autonomous proposing, locking per `kg_entity_id` or `kg_relationship_key` is the right primitive).

**Citation:** Episode 6 `[38:30]`–`[39:00]`. Fuuz-flows skill: `mutexLock` / `mutexUnlock` node-catalog entries.

---

## P-5 — Hybrid ML pipeline: real-time O(1) + scheduled batch O(n)

**What:** Three flows, each optimized for its complexity class:

| Flow | Trigger | Per-record cost | Job |
|---|---|---|---|
| Real-time | `dataChanges` on Create | O(1) | EWMA update, Z-score anomaly, linear-regression trend, breach extrapolation |
| Scheduled batch (hourly) | `schedule` | O(n × m²) | Pearson correlation across asset pairs |
| Scheduled projection (hourly) | `schedule` | O(k) | Forecast projection with confidence bands, breach prediction, retrospective accuracy |

**Why:** "Real-time flows must be O(1) per incoming record. Any calculation requiring multiple records belongs in a scheduled batch flow." (fuuz-ml-telemetry skill.) Keeps real-time bus throughput high; pushes expensive math off the hot path.

**MIRA applicability:** **Direct future pattern.** If MIRA ships predictive features (failure prediction, MTBF drift detection), use the same split. MIRA-side equivalents:
- Real-time = Celery task on every new work-order or sensor event.
- Hourly batch = scheduled DAG / cron in `mira-ops`.
- Projection = scheduled materialized-view refresh on KG.

**Citation:** fuuz-ml-telemetry skill, "ML Pipeline Architecture" + algorithm reference. Episode 6 `[09:00]`–`[11:00]`.

---

## P-6 — Three flow execution contexts (backend / web / gateway)

**What:** Same flow JSON, three runtimes:
- **Backend** — scheduled / event-triggered, 20 min internal timeout. ETL, calculations, reactive updates.
- **Web** — invoked from screens (request/response), 10 min external timeout. Dashboard APIs, screen interactions; can manipulate UI via `formDialog`, `snackbar`, `searchTable` nodes.
- **Gateway** — runs on Fuuz Gateway on-premise. Edge device interactions, local printing, MQTT subscriptions.

**Why:** Different reliability + latency + connectivity envelopes. A printer driver can't run in the cloud; a heavy ETL can't run in a 10s web request.

**MIRA applicability:** **Pattern only.** MIRA's equivalent split is:
- Backend = `mira-bots/shared/workers/` (Celery on Alpha).
- "Web" equivalent = `mira-pipeline` + `mira-mcp` (request-response).
- Gateway equivalent = nothing today; if MIRA ever ships an on-prem appliance (`mira-connect` pattern), this is the right naming.

**Citation:** fuuz-flows skill: "Flow Types." Episode 6 `[16:00]` (the Fuuz Gateway with MQTT broker + client).

---

## P-7 — Two GraphQL APIs: Application vs System

**What:** Two separate Relay-style GraphQL endpoints:
- **Application API** — custom data models (Assets, Products, Workcenters, ProductionLogs, Telemetry). Developer-defined.
- **System API** — platform infrastructure (Tenants, Users, Roles, Permissions, Settings, Connectors). Platform-managed.

Both expose `(where: { … }, orderBy: { … }, first: N) { edges { node { … } } }` and accept `"api": "application"` or `"api": "system"` in flow nodes.

**Why:** Clear separation between *what the customer builds* and *what the platform owns*. Developers can't accidentally mutate platform infra; the platform can evolve System schema without breaking customer models.

**MIRA applicability:** **Worth considering for the Hub.** MIRA's `kg_entities`/`kg_relationships`/`component_templates` (customer-data) are conceptually separate from `tenants`/`users`/`subscriptions` (platform-data). Today they share a single Hub schema (mira-hub/db/migrations/). If we ever ship a customer-extensible "bring your own component types" feature, splitting APIs is the right pattern.

**Citation:** Fuuz-platform skill: "Dual API Architecture." Fuuz-schema skill: "System Schema vs Custom Schema."

---

## P-8 — Application graph: render every artifact as a map

**What:** Inside the Fuuz Application Designer, an "Application Graph" view renders every artifact in the app (data models, flows, screens) and their relationships as a visual graph.

**Why:** New developers can see what's in an app at a glance; cross-references are obvious; orphan artifacts surface.

**MIRA applicability:** **High-value future feature.** For each customer component template + its proposals + its citations + its work orders → a visual map. Same shape, scoped to one component instead of one app. Candidate for `mira-hub` Component Detail page.

**Citation:** Episode 6 `[46:00]`.

---

## P-9 — Developer Mode = first-class debug surface

**What:** Pop a screen into Developer Mode → a side console shows every query, transform, binding, action-pipeline step as the user clicks through. Breakpoints supported on flow nodes (`debug.breakpointEnabled = true`).

**Why:** "When I say you have to test it, this is exactly how we go about testing." (Craig `[19:30]`.) Makes the LLM-generated code legible — the operator can see what's happening, catch Rube-Goldberg solutions, fix mistakes.

**MIRA applicability:** **Direct for MIRA Hub.** When a technician (or admin) asks "why did MIRA give this answer," show the recall trace: which classifier fired, which KG nodes matched, which manuals were cited, what confidence. Today `mira-bots/shared/engine.py` logs this; MIRA Hub should *render* it. Same philosophy: legible AI > black-box AI.

**Citation:** Episode 6 `[19:30]`–`[20:30]`.

---

## P-10 — Multi-tenant by database, per-domain modules within tenant

**What:** Each Fuuz tenant = its own database (identical system schema, custom schema per app). Different facilities can run very different module sets ("they don't have to be identical cookie cutters" — Craig `[30:30]`).

**Why:** Strong isolation; per-tenant schema flexibility; no cross-tenant data leakage.

**MIRA applicability:** **Different choice, deliberate.** MIRA's KG is single-database, multi-tenant by `tenant_id` column. Reasons:
- KG cross-tenant queries are valuable (component template promotion to MIRA-wide template library).
- Single DB simplifies ops (NeonDB single instance, one PG schema).
- Per-tenant isolation enforced at query level + RLS-style boundaries (UNCONFIRMED whether RLS is actually wired up in current Hub schema — open audit item).

Lesson: **document this trade-off explicitly.** If a customer asks "is my data isolated from other customers?", the answer is "row-level by `tenant_id`," not "physical database." That's a slower close but easier to operate.

**Citation:** Episode 6 `[30:30]`. Fuuz-platform skill: "Application Hierarchy" / "Tenant Types."

---

## P-11 — Use exported artifacts as LLM training data

**What:** `.fuuz` packages (tar archives of `manifest.json` + `definition.json` + `package-data.json`) are self-describing enough that a downstream LLM can summarize them. Craig: "Use those Fuuz packages in your own LLM. You can ask it to generate documentation, end-user work instructions, process flows for how the application works, troubleshooting." `[57:00]`.

**Why:** The platform's own export format = the cheapest path to LLM-readable documentation. No separate "describe this app" pipeline needed.

**MIRA applicability:** **Component templates should follow this.** When a component template is exported (manual reference + KG entities + relationships + work-order summary + proposed steps), the export format should be self-describing enough that a downstream LLM can re-summarize it in a new context. That's the right test for "is our component template format any good." Today component templates are JSON; we should verify they pass this round-trip test.

**Citation:** Episode 6 `[57:00]`.

---

## P-12 — Read + write to external UNSes

**What:** Fuuz subscribes to external UNS topics (e.g., ProveIt! public UNS published by Aveva, Software Toolbox, Dynix) **and** publishes Fuuz-internal data back to that external UNS. Demonstrates openness, lets Fuuz play nicely with vendors in the same plant.

**Why:** No customer runs only one vendor's UNS. Two-way play is necessary.

**MIRA applicability:** **Direct.** `mira-relay` should both (a) subscribe to whatever UNS topology the customer runs (Ignition / HighByte / HiveMQ / Fuuz) and (b) publish MIRA's grounded events ("proposal `X` was verified by tech `Y`") back to the same UNS. This is the "shared event bus" pattern — MIRA contributes to the customer's existing nervous system instead of building a parallel one.

**Citation:** Episode 6 `[03:00]`, `[05:00]`. Fuuz-gateway architecture (MQTT broker + client).

---

## Cross-reference

- For UI / workflow specifics → [`screens-workflows-patterns.md`](screens-workflows-patterns.md)
- For data model details → [`data-modeling-patterns.md`](data-modeling-patterns.md)
- For UNS / MQTT specifics → [`uns-mqtt-patterns.md`](uns-mqtt-patterns.md)
- For Claude-Code / agent specifics → [`industrial-ai-agent-patterns.md`](industrial-ai-agent-patterns.md)
- For direct MIRA mapping → [`../mira-lessons/mira-lessons-from-fuuz.md`](../mira-lessons/mira-lessons-from-fuuz.md)
