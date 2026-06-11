# Walker Reynolds' UNS Methodology vs. MIRA's Architecture — Alignment Analysis

**Authored:** 2026-06-10
**Author:** Claude (CHARLIE node) on behalf of Mike Harper
**Status:** Research — analysis only, no code change
**Sources analyzed:** `docs/THEORY_OF_OPERATIONS.md`, `NORTH_STAR.md`, `STRATEGY.md`, `docs/specs/maintenance-namespace-builder-spec.md`, `docs/specs/uns-kg-unification-spec.md`, `.claude/rules/uns-{compliance,confirmation-gate}.md`, `.claude/rules/direct-connection-uns-certified.md`, `docs/plans/2026-06-01-mira-master-architecture-plan.md`, `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py` (per master plan), `simlab/uns.py` + `simlab/models.py` + `simlab/publishers.py`
**Walker reference:** `github.com/walker-reynolds/uns_workshop` (sessions 1–4, incl. `session1/step3.py`, `session2/tags.json`)

---

## TL;DR

MIRA borrows Walker Reynolds' **doctrine** ("infrastructure first, AI second" — STRATEGY.md line 18 literally calls it the "Walker rule") and his **ISA-95 + KG** structural model almost verbatim, but deliberately **inverts** his single most load-bearing principle: *what the UNS is for.*

Walker's UNS is the **real-time current-state digital twin** of the operation; history goes to a historian. MIRA's "UNS" is an **accreting maintenance knowledge graph** that stores history (fault events, work orders, PM schedules) *as first-class children of equipment nodes* and punts real-time telemetry to a future, unbuilt layer. What MIRA calls "the UNS" is, in Walker's vocabulary, **a knowledge graph plus a historian** — and Walker's actual real-time UNS maps onto MIRA's *unbuilt* `datapoint` branch.

This is not a mistake. It is the wedge: Walker's UNS serves **operations/production** (OEE, throughput); MIRA serves **maintenance knowledge** — the layer Walker's own ecosystem treats as "an afterthought" (STRATEGY.md competitive table). Most of MIRA's deviations collapse to that one deliberate layer-choice.

**Strict scorecard: 5 / 10 fully ALIGNED** (#1, #6, #7, #8, #10), **4 PARTIAL** (#2, #4, #5, #9), **1 MISALIGNED-by-design** (#3).

---

## Scorecard at a glance

| # | Walker principle | Grade | One-line basis |
|---|---|---|---|
| 1 | ISA-95 hierarchy is the backbone | **ALIGNED** | `uns.py` builds `enterprise.{co}.site.area.line.work_cell.equipment.component` ltree |
| 2 | Three namespace types (Descriptive / Functional / Informative) | **PARTIAL** | All three *contents* exist; no first-class taxonomy. SimLab uses a maintenance-axis category set instead |
| 3 | UNS = real-time current state, NOT a historical store | **MISALIGNED** (intentional) | MIRA stores `fault_history`/`work_orders`/`pm_schedules` *in* the UNS; real-time telemetry is unbuilt |
| 4 | MQTT + Sparkplug B is the transport (no point-to-point) | **PARTIAL** | Live path today is point-to-point HTTP (`mira-relay /api/v1/tags/ingest`); broker unbuilt; only path grammar is Sparkplug-ready |
| 5 | Connect→Collect→Store→Analyze→Visualize→Pattern→Report→Solve | **PARTIAL** | MIRA's loop is CAPTURE→EXTRACT→MATCH→PROPOSE→CONFIRM→STORE→USE — overlapping but maintenance-shaped |
| 6 | Current state first (12 weeks before AI) | **ALIGNED** | "Walker rule: infrastructure first, AI second" + the L0–L6 readiness gate |
| 7 | KG adds 3D relationships UNS's 2D hierarchy can't | **ALIGNED** | `kg_relationships` DRIVES/POWERED_BY/WIRED_TO; physical-tree vs control-edge split is explicit |
| 8 | AI agents use UNS as originating context, then MCP deeper | **ALIGNED** | UNS gate resolves context first → MCP tools (`kg_maintenance_context`, …) query deeper |
| 9 | CEO-to-plant-floor visibility from one namespace | **PARTIAL** | ltree ancestor/descendant mechanically supports roll-up; no CEO-KPI surface ships; role matrix is for approvals |
| 10 | 2026: Agentic AI + UNS, humans supervise agents | **ALIGNED** | Copilot grounds in UNS; `proposed→verified` human gate; "train before deploy" |

---

## Detailed gradings

### 1. ISA-95 hierarchy is the backbone — **ALIGNED**

MIRA's canonical address space is an ISA-95 `ltree` built only by the functions in `mira-crawler/ingest/uns.py`. The per-company site hierarchy is exactly Walker's spine plus a `{company}` root and a `work_cell` segment:

> `mira-crawler/ingest/uns.py:32` — `enterprise.{company}.site.{site}.area.{area}.line.{line}.work_cell.{cell}.equipment.{eq_id}`
> `mira-crawler/ingest/uns.py:274–313` — `site_path` / `area_path` / `line_path` / `work_cell_path` / `assigned_equipment_path` builders.

Walker's Enterprise→Site→Area→Line→Cell→Unit appears verbatim in his `session2/tags.json` (`Enterprise → Dallas → Press → Press 103 → Edge`). MIRA's only divergences are additive and defensible: a `{company}` node above `site` (multi-tenant SaaS), `work_cell` made an explicit skippable segment (`uns.py:286–313`, equipment can attach at area/line/cell depth), and literal type-marker labels alternated with instance labels (`uns.py:73–110` `RESERVED_LABELS`). The `uns-kg-unification-spec.md` §3.1 broadened the tree to the "broadest possible ISA-95-shaped tree" per Mike's directive. **Strong alignment.**

Minor note: Walker's `tags.json` collapses Line/Cell ("Press 103" is both); MIRA keeps them distinct but skippable. No conflict.

### 2. Three namespace types: Descriptive / Functional / Informative — **PARTIAL**

Walker's three-namespace taxonomy is concrete in his code. `session1/step3.py` emits three separate payloads to three topic suffixes:

- **Descriptive** (`generate_descriptive_namespace`): `username, system, release, hostname, ip_address, location` — static asset/identity metadata.
- **Functional** (`generate_functional_namespace`): `process, status, last_mouse_movement` — real-time operational data.
- **Informative** (`generate_informative_namespace`): `total_connected_students, active_students, last_update` — derived/aggregated consumer data.

**MIRA has all three *contents*, but no first-class Descriptive/Functional/Informative taxonomy.**

- *Descriptive* data exists as **component profiles** (`ComponentProfile` schema: manufacturer, model, serial, voltage, HP — `maintenance-namespace-builder-spec.md:571–589`) and `kg_entities.properties`, not as a "descriptive namespace" branch.
- *Functional* data is the **unbuilt** Layer-4 `datapoint` branch (`uns.py:40` comment "future Layer 4 telemetry"; `uns-kg-unification-spec.md` §3.4 "Not built").
- *Informative* (OEE/derived) has **no surface at all** in the core product — the closest is the L0–L6 health score, which is a *namespace-completeness* metric, not an operational KPI.

SimLab (`simlab/models.py:28–40`) introduces a **different** category axis — `status, process, motor, faults, alarms, quality, production, maintenance, docs, training` — which becomes the UNS path segment `asset.category.tag` (`simlab/uns.py:69–71`). These map *onto* Walker's three types but are organized on a maintenance axis (see the SimLab section below). **The capability is present; the organizing taxonomy Walker prescribes is not.** PARTIAL.

### 3. UNS = real-time current state, NOT a historical store — **MISALIGNED (intentional)**

This is the spine of the whole comparison and the sharpest divergence.

**Walker:** the UNS is the digital twin of the operation *right now* — "what's happening this second." History goes to a historian; the UNS holds current state only.

**MIRA does the inverse.** The UNS tree stores history as **first-class children of equipment**:

> `mira-crawler/ingest/uns.py:38–41` —
> `.maintenance.{pm_schedule|fault_history|work_orders|parts_inventory}`
> `.documentation.{manuals|schematics|procedures}`

and the explicit design decision is that real-time values are *excluded*:

> `uns-kg-unification-spec.md` §3.4 — "Tag values will live in a future `uns_observations` table or external TSDB. They do **not** belong in `kg_entities`." And §3.1: `kg_entities` is the node store; the `datapoint` branch is "Layer 4 (future)."

The Theory of Operations is candid that the namespace is a *memory that accretes*, not a live mirror:

> `THEORY_OF_OPERATIONS.md:64` — "The plant model accretes over time — it is never 'finished,' and that's the point."
> `THEORY_OF_OPERATIONS.md:103–113` — Invariant set treats the KG as **Memory** and UNS/MQTT as a *separate* "live context layer," explicitly read-only and partly unbuilt.

**Net:** what MIRA calls "the UNS" is, in Walker's vocabulary, **a knowledge graph + a historian fused into one ltree.** Walker's *actual* real-time UNS corresponds to MIRA's **unbuilt** `datapoint`/Layer-4 branch. So this is not "MIRA does the UNS wrong" — it is **terminological appropriation of the word "UNS" for a different artifact.** Naming that is what makes this analysis correct rather than a checkbox. (See "Where MIRA intentionally differs" for why this is justified.)

### 4. MQTT + Sparkplug B is the transport (no point-to-point) — **PARTIAL**

Walker's hard rule: every node publishes to the broker, every consumer subscribes — **no point-to-point integrations.**

**MIRA's *live* transport today is exactly the point-to-point integration Walker forbids.** `mira-relay` exposes an HTTP endpoint `POST /api/v1/tags/ingest`; SimLab's `RelayIngestPublisher` (`simlab/publishers.py:181–213`) and the real Ignition relay both POST batches to it directly. That is request/response point-to-point, not pub/sub.

What *is* Sparkplug-ready is only the **path grammar**: `uns-kg-unification-spec.md` §3.4 requires the path structure be broker-compatible ("`.` separator is compatible with Sparkplug B `group/edge_node/device/metric` after a re-segmentation"), and SimLab ships a lazy `MqttPublisher` (`simlab/publishers.py:122–170`) plus an MQTT-topic projection (`simlab/uns.py:82–97 to_mqtt_topic`). But the broker is **not stood up** — every governing doc lists it as future:

> `THEORY_OF_OPERATIONS.md:234` — "MQTT / Sparkplug B export | 🔲 | Post-MVP."
> `uns-kg-unification-spec.md` §3.4 — "Not built. Not in this spec's implementation phases."
> master plan constraint #5 — "Ignition-first for PLC data" via HTTP, not a broker.

So: **designed-for, path-compatible, but the live data path is point-to-point HTTP and the broker is unbuilt.** Design intent must not round this up — PARTIAL.

### 5. Connect → Collect → Store → Analyze → Visualize → Find Patterns → Report → Solve — **PARTIAL**

MIRA has a journey, and it is a "you can't skip steps" journey, but it is shaped for maintenance-knowledge accretion, not operations data:

> `THEORY_OF_OPERATIONS.md:28–61` — CAPTURE → EXTRACT → MATCH → PROPOSE → CONFIRM → STORE → REMIND → USE.

Mapping: Connect/Collect ≈ CAPTURE/EXTRACT (photos, manuals, tags ingest); Store ≈ STORE (verified KG); Analyze ≈ the diagnostic engine; Report/Solve ≈ USE (grounded troubleshooting). MIRA **adds** PROPOSE→CONFIRM (human-in-the-loop) which has no Walker analog, and **lacks** an explicit Visualize→Find-Patterns→Report operations-analytics arc (no OEE dashboards, no SPC). The "can't skip steps" spirit is preserved structurally by the **L0–L6 readiness model** (`THEORY_OF_OPERATIONS.md:119–127`) — a plant literally cannot reach L5 fault intelligence before L2 asset mapping. **Overlapping but maintenance-shaped.** PARTIAL.

### 6. Current state is the first 12 weeks (know your assets before AI) — **ALIGNED**

This is the most directly inherited principle. STRATEGY.md names it:

> `STRATEGY.md:18` — "**Walker rule:** infrastructure first, AI second. Never lead with 'AI CMMS.'"
> `NORTH_STAR.md:25` — "Infrastructure first. AI second. Every customer engagement starts with 'what does your maintenance world actually look like?' — not with a chatbot demo."

The operationalization is the **L0–L6 AI-Readiness model** (`THEORY_OF_OPERATIONS.md:115–129`): L0 "Unknown," L1 "Basic hierarchy," L2 "Asset map" — you must know what assets exist and where before MIRA can do component intelligence (L3) or fault intelligence (L5). The health score "is **not a vanity metric** — it is the sales tool" (`THEORY_OF_OPERATIONS.md:155`).

Nuance: Walker's "current state" = the live operational state of every asset; MIRA's "current state" = the **structural inventory** (which assets, which docs, which tags exist). Same doctrine, applied to a structural rather than a real-time census. ALIGNED.

### 7. Knowledge graphs add the 3D relationships UNS's 2D hierarchy can't express — **ALIGNED**

MIRA implements this exactly, and the architecture is explicit about *why* the two layers are separate:

> `maintenance-namespace-builder-spec.md:226–243` — "Two facts every customer's plant has: (1) Physical containment … (2) Control relationships … Mixing them in one tree produces the trap … the *data* must keep them as siblings."

Containment lives in the UNS path / `parent_asset_id` (the 2D tree); cross-cutting relationships live in `kg_relationships` as typed edges — `DRIVES`, `IS_DRIVEN_BY`, `POWERED_BY`, `WIRED_TO`, `TRIGGERS` (`maintenance-namespace-builder-spec.md:233`, worked examples lines 248–337), plus knowledge edges `HAS_MANUAL`, `HAS_FAULT`, `RESOLVED_BY`, `HAS_PM` (`uns-kg-unification-spec.md` §3.2 lines 338–349). This is precisely Walker's "UNS = parents/children/siblings; KG = cross-cutting relationships (component→machine, fault→procedure)." **Strong alignment — arguably MIRA's deepest fidelity to Walker.**

### 8. AI agents use UNS as originating context, then query deeper via MCP — **ALIGNED**

MIRA's entire engine flow is "resolve UNS context first, then go deeper":

> `.claude/CLAUDE.md` UNS gate flow — extract candidate context → `uns_resolver.resolve_uns_path()` → confirm → only then troubleshoot.
> master plan §1.2 — MCP tools `kg_maintenance_context`, `kg_root_cause_chain`, `kg_traverse_chain`, `mira_browse_namespace` query deeper once context is set.

The `uns_resolver.py` + the `AWAITING_UNS_CONFIRMATION` gate (`engine.py:1428–1439`, `_should_fire_uns_gate()`) are literally a "navigate the semantic structure first" mechanism, and the MCP tool layer is the "then query deeper systems" mechanism. This is Walker's agentic pattern implemented faithfully. ALIGNED.

### 9. CEO-to-plant-floor visibility from one namespace — **PARTIAL**

The *mechanism* exists; the *product surface* does not.

- **Mechanism present:** the ltree UNS supports ancestor/descendant queries at any depth (`uns-kg-unification-spec.md` §3.1 GiST index, `GET /api/uns/browse`), and `health_scores` are stored **per uns_path node and aggregated up the tree** (`maintenance-namespace-builder-spec.md:431`, "per node and aggregated up the tree" L662). A site-level or enterprise-level roll-up is mechanically a subtree query away.
- **Surface absent:** there is no CEO-KPI dashboard, no enterprise-OEE roll-up, no role-scoped visibility-by-level. The role matrix (`maintenance-namespace-builder-spec.md:645–652`) governs **approval authority** (technician → admin), not KPI visibility tiers. L6 "Business Intelligence" (`THEORY_OF_OPERATIONS.md:127`) is aspirational ("🔲 not built" everywhere).

Walker's CEO-sees-KPIs / tech-sees-tags vision is *maintenance-scoped and unbuilt* in MIRA. The capability is latent in the ltree; the executive-visibility product is out of scope by design. PARTIAL.

### 10. 2026 emphasis: Agentic AI + UNS, humans supervise agents — **ALIGNED**

MIRA *is* an agentic-AI-on-UNS system with a human-supervision gate baked in:

- The copilot grounds every answer in the UNS/KG (Invariant 6, `THEORY_OF_OPERATIONS.md:112`).
- `proposed → verified` is a **human action** — "Promotion to `verified` is a human action" (`THEORY_OF_OPERATIONS.md:110`); auto-verify is a bug (Non-Goals L199).
- "Train before deploy" (`.claude/rules/train-before-deploy.md`): a human validates and approves an asset agent before it answers on the HMI.

This is Walker's "agents supervise operations; more analysts supervising AI agents, not fewer." The one nuance: MIRA's agents are **read-only advisory** (diagnose, never control — `NORTH_STAR.md:53`, TOO Non-Goals "Write to PLCs. Period."), whereas Walker's 2026 framing leans toward agents that *supervise operations*. MIRA supervises *maintenance knowledge*, not the line. ALIGNED with that scoping nuance.

---

## Top 5 gaps (where MIRA deviates from Walker's playbook)

### Gap 1 — The UNS holds history, not current state (principle #3)
**Deviation:** MIRA stores `fault_history`/`work_orders`/`pm_schedules` as UNS children and leaves real-time telemetry unbuilt (`uns.py:38–41`; `uns-kg-unification-spec.md` §3.4). Walker's UNS is current-state-only.
**Close it (if desired):** Build the Layer-4 `datapoint` branch — a `uns_observations` TSDB (or external historian) feeding *live current value per tag* under `enterprise.…equipment.{eq}.datapoint.{tag}`. Then the word "UNS" in MIRA means what Walker means, and the KG-as-history becomes a clearly-separate memory layer. This is the single change that would most align MIRA's vocabulary with the ecosystem. **(See justification — this may be a deliberate non-goal, not a gap to close.)**

### Gap 2 — No broker; the live transport is point-to-point HTTP (principle #4)
**Deviation:** `mira-relay POST /api/v1/tags/ingest` is request/response, not pub/sub — the exact pattern Walker's "no point-to-point" rule forbids (`simlab/publishers.py:181–213`).
**Close it:** Stand up an MQTT/Sparkplug B broker (HiveMQ/EMQX) and make `mira-relay` a *subscriber* rather than an HTTP sink; promote `simlab/publishers.MqttPublisher` from lazy/optional to a real path. The path grammar and topic projection (`simlab/uns.py:82–97`) are already broker-ready, so this is plumbing, not a rearchitecture.

### Gap 3 — No Descriptive/Functional/Informative taxonomy (principle #2)
**Deviation:** MIRA holds all three contents but on a maintenance category axis (SimLab `TagCategory`) and component-profile schema, not Walker's three-namespace split (`simlab/models.py:28–40`).
**Close it:** Add a `namespace_type: Literal["descriptive","functional","informative"]` field to `TagDef` (and to `tag_entities` rows), derived from the existing `TagCategory` (motor/process/status/production → functional; quality → informative; the asset's mfr/model/serial → descriptive). Cosmetic-additive, not a rearchitecture — see SimLab section.

### Gap 4 — No operations-analytics / executive-visibility surface (principles #5, #9)
**Deviation:** No Visualize→Find-Patterns→Report arc and no CEO-to-floor KPI roll-up surface, despite ltree subtree roll-ups being mechanically available (`health_scores` aggregate up-tree; no KPI dashboard ships).
**Close it (scoped):** If/when L6 is pursued, expose a per-uns_path roll-up dashboard reading `health_scores` + (future) `uns_observations`. Keep it maintenance-KPI (MTBF, downtime-by-line, PM-compliance), **not** production OEE — that stays out of the wedge.

### Gap 5 — Journey lacks the analytics tail; adds a human-approval head (principle #5)
**Deviation:** MIRA's loop front-loads CAPTURE→PROPOSE→CONFIRM (no Walker analog) and stops at grounded troubleshooting; Walker's loop tails into Find-Patterns→Report→Solve across the whole operation.
**Close it:** Largely a non-gap — MIRA's PROPOSE→CONFIRM is a *deliberate* superiority for a maintenance KG (evidence-bound, no auto-verify). The only genuinely missing tail step is cross-asset pattern reporting (the Knowledge Cooperative, `THEORY_OF_OPERATIONS.md:187–191`), which is roadmapped, not absent.

---

## Where MIRA *intentionally* differs from Walker — and whether it's justified

Four of the five gaps above are **one decision wearing four hats**: *Walker's UNS serves operations/production; MIRA's serves maintenance knowledge.* The competitive docs say so explicitly:

> `STRATEGY.md:87` — "UNS consultancies (Walker, 4IR, etc.) … focus on production data (OEE, throughput). Maintenance is an afterthought."
> `THEORY_OF_OPERATIONS.md:161` — "UNS Studio … is for the architects. MIRA is for the maintenance team standing at the machine."
> `THEORY_OF_OPERATIONS.md:19` — "Nobody is structuring the maintenance side of UNS. That is the lane."

Given that lane, the deviations are **justified**:

| Deviation | Justified? | Why |
|---|---|---|
| **#3 — UNS stores history, not current state** | **Yes, but rename-worthy.** | A maintenance copilot's value is *the accreting record* (this fault recurred 3× in 90 days — `uns-kg-unification-spec.md` §5). A current-state-only twin would be useless for diagnosis. **Caveat:** calling the history-graph "the UNS" risks confusion when selling *alongside* Walker-style operations UNS vendors (HighByte/HiveMQ, whom MIRA wants to "sit on top of" — `THEORY_OF_OPERATIONS.md:166`). Consider, in customer-facing material, naming MIRA's artifact the **"maintenance knowledge graph"** and reserving "UNS" for the path-addressing scheme it shares with the operations UNS. Internally the code already separates them (KG = Memory, UNS/MQTT = live context) — the doctrine is right; the *word* is overloaded. |
| **#4 — point-to-point HTTP, no broker** | **Yes, for now.** | MVP pragmatism (master plan constraint #8: "Working demo over perfect architecture"). The path grammar is broker-ready, so the deferral is reversible. Becomes a *real* gap only if MIRA tries to be the plant's primary data backbone — which it explicitly does not ("MIRA can sit on top of any of these"). |
| **#2 — no D/F/I taxonomy** | **Yes.** | The three-namespace split is an operations-data ergonomic. MIRA's maintenance axis (faults/alarms/maintenance/docs/training) is *more* useful for its job and is a strict superset on the maintenance side. The D/F/I labels are mappable on demand (Gap 3). |
| **#9 — no CEO-KPI surface** | **Yes.** | Selling to a 50–500-employee plant maintenance manager (`STRATEGY.md:24`), not a multi-site CEO. The enterprise-visibility vision is the wrong ICP for the wedge. ltree keeps the door open for later. |
| **Read-only agents (#10 nuance)** | **Yes — non-negotiable.** | TOO Non-Goals + `fieldbus-readonly.md` + "no control writes in beta." This is a *safety* divergence from Walker's "agents supervise operations," and it is correct: MIRA observes, never actuates. |

**One place the divergence is a risk, not just a choice:** the word "UNS." MIRA is simultaneously (a) using Walker's doctrine as a sales credential ("Walker rule") and (b) meaning something materially different by "UNS." With a Walker-literate buyer, leading with "we build your UNS" then showing a fault-history graph invites "that's not a UNS, that's a CMMS-adjacent KG." The honest framing — *"we structure the **maintenance side** of your namespace and the knowledge graph on top"* — is already in STRATEGY.md and should stay the headline.

---

## SimLab juice-bottling tags vs. Walker's three-namespace JSON model

**Question:** are MIRA's SimLab tag categories (`status, process, motor, faults, alarms, quality, production, maintenance, docs, training`) compatible with Walker's Descriptive/Functional/Informative model?

**Answer: compatible by mechanism, divergent by vocabulary.** They map cleanly onto Walker's three types, but SimLab organizes on a *maintenance* axis and carries categories Walker's operational model has no slot for.

### Mechanism comparison

| | Walker (`session2/tags.json`, `session1/step3.py`) | MIRA SimLab (`simlab/uns.py`, `simlab/models.py`) |
|---|---|---|
| Tag addressing | Ignition folder tree: `Enterprise/Dallas/Press/Press 103/Edge/<tag>` and a `ShopFloor` sub-folder | ltree: `enterprise.florida_natural_demo.plant1.juice_bottling.line01.<asset>.<category>.<tag>` (`simlab/uns.py:69–71`) |
| Grouping device | **Folders** (`Edge`, `ShopFloor`) group tags by namespace role | **Category segment** (`status`/`process`/…) groups tags by role |
| Payload envelope | `{json}` per namespace topic | `{"value":…, "ts":…, "source":"simulator"}` (`simlab/publishers.py:114–119`) — Sparkplug-ish |
| MQTT topic | `uns/{country}/{state}/{city}/{initials}/…` | `to_mqtt_topic()` projects ltree → `FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01/<Asset>/<category>/<tag>` (`simlab/uns.py:82–97`) |

**Key finding:** Walker's `Edge`/`ShopFloor` *folders* are mechanically the same construct as SimLab's `<category>` *path segment* — both are an intermediate grouping node between the asset and the leaf tag. So a `namespace_type` grouping is **already structurally present** in SimLab; it just uses maintenance vocabulary instead of D/F/I vocabulary. Adding Walker's taxonomy is an additive field, not a re-layout.

### Category → namespace-type mapping

| MIRA SimLab `TagCategory` | Walker namespace type | Walker example fields |
|---|---|---|
| `process` (fill level, bowl pressure, temp) | **Functional** | infeed, outfeed, state, speed |
| `motor` (RPM, current, torque) | **Functional** | — |
| `status` (PackML state, running/stopped) | **Functional** | state, status |
| `production` (counts, batch) | **Functional** (→ feeds Informative) | counts |
| `quality` (reject rate, fill accuracy) | **Informative** | quality, performance (OEE inputs) |
| `faults` (fault-code table entries) | *(no Walker equivalent — maintenance extra)* | — |
| `alarms` (NAMUR-ish alarm states) | *(maintenance extra; partial Functional)* | — |
| `maintenance` (PM due, runtime hours) | *(maintenance extra)* | — |
| `docs` (manual/section references) | *(≈ Descriptive — reference attachment)* | — |
| `training` (validation Q&A) | *(no Walker equivalent — MIRA-specific)* | — |
| *(asset mfr/model/serial — on the asset, not a tag)* | **Descriptive** | name, AssetID, manufacturer, model, serial |

### Verdict

- **Functional** is fully covered (`process`, `motor`, `status`, `production`).
- **Informative** is partially covered (`quality`; SimLab has no OEE/availability aggregate tag — that aggregation is the unbuilt informative layer).
- **Descriptive** is **not** a tag category at all — it lives on the asset/component profile (manufacturer/model/serial), matching Walker's intent but not his *placement* (he publishes descriptive as a tag namespace; MIRA keeps it as entity metadata).
- SimLab adds **five maintenance-axis categories with no Walker analog** (`faults`, `alarms`, `maintenance`, `docs`, `training`) — these are the wedge made concrete and are exactly why SimLab is "not a toy conveyor."

**Compatibility:** ✅ mappable in both directions; ⚠️ not isomorphic. The clean closure (Gap 3) is to annotate each `TagCategory` with a `namespace_type` so SimLab can publish Walker-conformant Descriptive/Functional/Informative topic groupings *and* keep its maintenance categories — cosmetic-additive, validated by the fact that the grouping node already exists.

---

## Bottom line

MIRA is **Walker-doctrine-aligned where it matters for selling** (infrastructure-first, ISA-95 backbone, KG-for-3D-relationships, agentic-AI-on-namespace with human supervision — #1/#6/#7/#8/#10) and **deliberately divergent where Walker's operations focus would dilute the maintenance wedge** (#2/#3/#4/#5/#9). The one divergence worth a second look is **lexical, not architectural**: MIRA calls a maintenance-knowledge-graph-plus-historian "the UNS." The code keeps the layers honest; the customer-facing language should too — and it largely already does (STRATEGY.md leads with "the maintenance side of UNS," not "the UNS").

**Strict score: 5/10 fully aligned, 4 partial, 1 intentionally inverted.** Weighting partials at 0.5 → ~7/10. Neither number is the point: 9 of 10 deviations trace to a single, defensible decision about *which layer of the plant MIRA serves.*

---

## Appendix — evidence index

| Claim | File:line |
|---|---|
| ISA-95 site hierarchy builder | `mira-crawler/ingest/uns.py:32`, `:274–313` |
| Reserved type-marker labels | `mira-crawler/ingest/uns.py:73–110` |
| History stored under UNS equipment node | `mira-crawler/ingest/uns.py:38–41` |
| Telemetry excluded from kg_entities | `docs/specs/uns-kg-unification-spec.md` §3.4 |
| "Walker rule: infrastructure first" | `STRATEGY.md:18` |
| UNS consultancies focus on production, maintenance afterthought | `STRATEGY.md:87` |
| Namespace accretes, never finished | `docs/THEORY_OF_OPERATIONS.md:64` |
| L0–L6 readiness model | `docs/THEORY_OF_OPERATIONS.md:115–129` |
| Physical-tree vs control-edge split | `docs/specs/maintenance-namespace-builder-spec.md:226–243` |
| KG relationship types | `docs/specs/uns-kg-unification-spec.md` §3.2 (lines 338–349) |
| MQTT/Sparkplug post-MVP | `docs/THEORY_OF_OPERATIONS.md:234`; `uns-kg-unification-spec.md` §3.4 |
| Relay HTTP ingest (point-to-point) | `simlab/publishers.py:181–213` |
| SimLab TagCategory enum | `simlab/models.py:28–40` |
| SimLab tag-path = asset.category.tag | `simlab/uns.py:69–71` |
| SimLab MQTT projection | `simlab/uns.py:82–97` |
| proposed→verified is human action | `docs/THEORY_OF_OPERATIONS.md:110`, `:199` |
| Walker descriptive/functional/informative payloads | `uns_workshop/session1/step3.py` |
| Walker ISA-95 tag tree | `uns_workshop/session2/tags.json` |
