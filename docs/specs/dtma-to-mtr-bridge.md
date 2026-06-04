# DTMA → Minimum Technical Requirements Bridge

**Status:** Spec (planning) — no production code in this doc
**Authored:** 2026-06-02
**Owner:** Mike Harper
**Closes:** Walker #11 gap ("DTMA → Strategy → Architecture → **Minimum Technical Requirements** → Current State") from `docs/research/2026-06-01-dt-alignment-analysis.md` §4.7 and §1 Walker-#11.

> **One-liner.** Turn the `/assess` DTMA score from a lead-magnet radar chart into a productized on-ramp: a score → a Walker stage → a per-customer Minimum Technical Requirements (MTR) list → a pilot blueprint that names the *first* machine MIRA connects.

---

## 0. Why this document exists

The DT-alignment analysis (`docs/research/2026-06-01-dt-alignment-analysis.md`) found that MIRA's single weakest Walker-framework link is the bridge from **assessment** to **architecture**:

> "The `/assess` score should emit the customer's *minimum technical requirements + which Walker stage you're at + what the Pilot will connect first*. That turns the scorecard from a lead magnet into the on-ramp Walker's #11 describes." — §6, recommendation 5.

Today:
- The DTMA exists as a 6-dimension, 1–5 maturity scorecard (`docs/specs/dt-scorecard-spec.md`, `mira-web/public/assess.html`). It produces a radar chart, a maturity tier, and "Top 3 next steps." It has **no backend, no persistence, no MTR output** (per its own §"Non-goals (v1)").
- The $500 assessment is sold over LinkedIn/mailto. The output is a human-written gap report. There is no deterministic artifact tying the score to "here's what the Pilot connects first."

This spec defines that deterministic artifact: the **DTMA→MTR bridge**. It is the missing link between `dt-scorecard-spec.md` (input) and `docs/mira-ignition-secure-architecture.md` (the architecture the MTR list points the customer toward).

This is a planning spec. It does **not** change the `/assess` page, the Stripe code, or any pricing. It defines the mapping and the output schema so a later build phase can implement it.

---

## 1. The Walker stage ladder

Walker's journey (per the alignment analysis §0 and §6) always starts with **current state** and climbs: *Industry-3 baseline → connect → collect → current state → historize → find patterns → predict*. We collapse that into five customer-legible **stages**. A plant sits at exactly one stage; the bridge always recommends the **next** one (Walker's rule: you cannot skip current state).

| Stage | Walker shorthand | What "being here" means on the plant floor | MIRA capability that serves it |
|---|---|---|---|
| **S0 — Industry 3 baseline** | "automated processes, not decisions" | PLCs run machines. Maintenance is paper / whiteboard / tribal. No digital current state. No one can answer "which assets are running right now?" from a screen. | `/assess` DTMA; KB grounding (83k OEM chunks) — answers *general* equipment questions before any connection. |
| **S1 — Current State** | "which assets are running right now?" | One line/cell is digitally observable: live tags reach a screen (Ignition/SCADA), and MIRA can read an allowlisted snapshot. The load-bearing Walker step. | Ignition tag collector (Phase 4) → `mira-relay` ingest → `current_tag_state`; Command Center live tree. |
| **S2 — Historize** | "store the diffs, not just the latest value" | Meaningful tag changes are retained as an event stream, not just a latest-value snapshot. Fault windows, edges, and threshold crossings are queryable after the fact. | `tag_events` append-only stream (Phase 5); decision traces (Phase 8). |
| **S3 — Pattern** | "find patterns across unrelated data" | The stream is analyzed: flaky inputs, recurring faults, plan-vs-actual PM mismatch surface as **proposed** insights for human review. The 3D KG grows from confirmed patterns. | `FlakyInputDetector` (Phase 9); `kg_flag_pm_mismatches`; proposal → verify loop (Phase 3). |
| **S4 — Predict** | "predict the future / sell your data" | Trends and models forecast failures; data becomes a sellable product (Knowledge Cooperative). | **Not built** — explicit gap (analysis §4.2). MIRA's wedge is grounded diagnosis, not prediction; S4 is roadmap, not promise. |

**Honesty rule (carried from the analysis).** MIRA can deliver S1–S3 for a single cell on the bench today and is building the customer-shippable versions (master plan Phases 4/5/9). S4 (predict / sell-your-data) is **absent** from both code and plan — the bridge must never recommend a Pilot that promises prediction. If a Leading-tier plant scores into "ready for S4," the honest output is "you are past what MIRA delivers today; we structure and ground, we do not predict — here is where we add value anyway (S3 depth + Knowledge Cooperative on-ramp)."

---

## 2. DTMA score → Walker stage

The DTMA (`dt-scorecard-spec.md`) produces an **overall** maturity score (mean of 6 dimension means, 1.0–5.0) and a tier. The bridge maps the overall score to a **current stage**, then sets `recommended_next_stage` one rung up.

| DTMA overall | DTMA tier (existing) | Current Walker stage | Recommended next stage | Rationale |
|---|---|---|---|---|
| < 2.0 | Foundational | **S0 — Industry 3 baseline** | **S1 — Current State** | Paper-first. There is nothing live to read. First job: make one cell observable. |
| 2.0 – 3.0 | Developing | **S0/S1 boundary** | **S1 — Current State** | Some digital docs/CMMS, but no live current state. The Pilot's job is the first connected cell. |
| 3.0 – 4.0 | Practicing | **S1 — Current State** | **S2/S3 — Historize → Pattern** | Likely already has SCADA/Ignition and a latest-value view. Next: retain the diff stream and run pattern detection on it. |
| > 4.0 | Leading | **S2 — Historize** | **S3 — Pattern (+ S4 framing)** | Historizing already. MIRA's lever is the maintenance-side pattern/KG layer, not a new historian. |

**Dimension override (the score isn't only the mean).** Two dimensions gate current state regardless of the overall average, because Walker's stage 1 is a hard prerequisite:

- **Dimension 6 — Technology Readiness** (WiFi on floor, mobile fluency, budget). If this is ≤ 2.0, the plant cannot sustain S1 even if its paperwork is good. The bridge caps `current_stage` at **S0** and adds a Technology-Readiness MTR (network/firewall first).
- **Dimension 1 — Data & Documentation** (manuals digital, history reachable). If this is ≤ 2.0, grounding is starved — MIRA can read live tags but cannot *cite* anything. The bridge keeps the stage but front-loads the document-ingestion MTRs (manuals, wiring diagrams) into the first-90-day plan.

The mean alone can hide a plant that has a great CMMS but no shop-floor network. The two overrides keep the recommendation honest about Walker's load-bearing step.

---

## 3. Minimum Technical Requirements (MTR) per stage transition

The MTR list is **the technical preconditions to reach the recommended next stage** — expressed as customer-checkable items, each tied to the MIRA component that consumes it. It is derived from the security architecture (`docs/mira-ignition-secure-architecture.md` §7 MVP scope) and the master plan's current-state path (Phases 4/5).

### 3.1 To reach S1 — Current State (the most common recommendation)

| MTR | Why | Maps to |
|---|---|---|
| **Ignition Gateway reachable on the plant LAN** (any edition incl. Maker/Edge for a single cell) — OR an existing MQTT/Sparkplug B broker | MIRA reads PLC data *through Ignition*, never a direct socket. No Ignition + no broker = no customer-shippable current state. | `docs/mira-ignition-secure-architecture.md` §1; `ignition/` |
| **Outbound HTTPS (443) to `*.factorylm.com` permitted** | The only firewall change MIRA needs. No inbound, no VPN. | secure-arch §4.1 |
| **One critical machine/cell chosen** as the pilot scope | Walker starts with current state on *one* cell, not the fleet. | §5 below |
| **A tag allowlist for that cell** (`approved_tags.json` — start ~20–40 tags: run/stop, faults, speed, current, key sensors) | Read-by-default, allowlist-only. A tag not on the list is invisible to MIRA. | secure-arch §4.2; master plan Phase 4 (D1) |
| **A UNS/asset path for that cell** (site → area → line → machine) so live tags reconcile to an ISA-95 path | Green-dot "running" must mean *this asset at this path*, not "an HMI page responded." | `.claude/rules/uns-compliance.md`; analysis §5 gap-2 |
| **PLC/HMI access method documented** (Ignition driver already polling? OPC-UA? which protocol?) | Determines whether the existing gateway already sees the tags or needs a device connection added. | secure-arch §3.1 |

### 3.2 To reach S2 — Historize

Everything in 3.1, **plus**:

| MTR | Why | Maps to |
|---|---|---|
| **Per-tag change thresholds defined** (which float deltas / threshold crossings are "meaningful") | The diff stream records changes that matter, not a firehose. | master plan Phase 5; `approved_tags.threshold` |
| **Tag data types classified** (bool / int / float / fault-code) | Drives edge vs. value-changed vs. fault-window event semantics. | master plan D4 event model |
| **Retention expectation agreed** (90-day raw `tag_events` + daily rollup is the default) | Storage cost + audit scope. | master plan D8 open-question 8 |

### 3.3 To reach S3 — Pattern

Everything in 3.2, **plus**:

| MTR | Why | Maps to |
|---|---|---|
| **≥ 7 days of live stream** for baseline calibration | Flaky-input detection suppresses alerts until a per-tag baseline exists; commissioning churn would otherwise false-positive. | master plan Phase 9; D6 (`baseline_period_days`) |
| **Manuals + fault-code tables ingested** for the cell's components | A pattern alert is only useful if MIRA can cite the manual page that explains it. | analysis §3 Store; upload→retrieval fix (ADR-0020) |
| **A human reviewer for `/proposals`** (a tech or planner who confirms/rejects) | Every `proposed → verified` KG transition is a human action. No reviewer = no graph growth. | `.claude/CLAUDE.md` KG rules; master plan Phase 3 |

### 3.4 S4 — Predict (documented, not offered)

The bridge lists S4 MTRs for completeness but flags them `status: "not_available_today"`: a historian with sufficient trend depth, a labeled failure history, and an opt-in Knowledge Cooperative contract. MIRA does not ship a predictive layer (analysis §4.2). Recommending a Pilot that delivers S4 would be selling vapor.

---

## 4. The data MIRA needs first (assessment intake)

The $500 assessment's floor walk collects exactly the inputs the MTR list checks. This is the **intake checklist** the assessor fills in during the one-day visit. Each item has a `present | partial | absent` state and feeds the bridge.

| # | Intake item | Used by | If absent → |
|---|---|---|---|
| 1 | **Asset list** (machines/cells, ideally with make/model) | stage mapping, pilot scope | Build it from the floor walk; this *is* part of the deliverable. |
| 2 | **Critical machine/cell** (the one whose downtime hurts most) | `recommended_pilot_scope.first_connected_cell` | Ask "what stopped you last month?" — pick the highest-pain answer (see §5). |
| 3 | **Ignition availability** (installed? edition? version? reachable?) | S1 MTR gate | Recommend Ignition Maker/Edge for the pilot cell, or MQTT path if a broker exists. |
| 4 | **PLC/HMI access method** (protocol, who has the program, is a gateway already polling) | S1 MTR; tag list source | Note as a pilot risk; the tag-import wizard / `mira-machine-logic-graph` can derive tags from ST source. |
| 5 | **Manuals** (digital? where? which OEMs) | S3 MTR; grounding | Cross-check against the 83k pre-indexed OEM chunks — Rockwell/ABB/Siemens/Schneider/Yaskawa may already be covered. |
| 6 | **Wiring diagrams** (for the pilot cell's components) | KG wiring relationships; schematic vision | Flag for capture during pilot; `kg_extract_schematic` can ingest photos. |
| 7 | **Tag list / export** (CSV from Ignition or PLC) | `approved_tags` seed; tag-import wizard | Derive from the gateway or from PLC program; this is the allowlist seed. |
| 8 | **CMMS / export history** (work orders, PM schedules, fault logs) | historize, plan-vs-actual, recurring-fault baseline | Connect via `mira-mcp/cmms` (Atlas/MaintainX/Limble/Fiix) or ingest an export. |

**Mapping to DTMA dimensions** (so the assessor doesn't ask twice): items 5–6 ↔ Dimension 1 (Data & Documentation); item 8 ↔ Dimensions 2/3 (Work Order / PM); items 1,4,7 ↔ Dimension 4 (Asset Intelligence); item 3 ↔ Dimension 6 (Technology Readiness). The DTMA *scores* the maturity; the intake *captures the artifacts*. Same floor walk, two outputs.

---

## 5. How the $500 assessment produces the pilot blueprint

The assessment is a **one-day floor walk** (per `NORTH_STAR.md` / `STRATEGY.md` offer stack). Its deliverable today is a written gap report + namespace blueprint. The bridge productizes the back half of that report:

```
$500 ASSESSMENT (one day on site)
  1. Run the DTMA           → overall score + 6 dimension scores + tier
  2. Walk the floor          → fill the §4 intake checklist (8 items, present/partial/absent)
  3. Bridge computes:
       current_stage          ← §2 score→stage map (+ dimension overrides)
       recommended_next_stage ← one rung up
       minimum_technical_requirements ← §3 list for that transition, each tagged
                                         present|partial|absent from the intake
       recommended_pilot_scope ← §5.1 first-cell selection
       first_90_day_plan       ← §5.2 sequenced from the absent/partial MTRs
  4. Output                   → the JSON blueprint (§6) + a human-readable one-pager
```

The JSON blueprint is the durable artifact. The human one-pager (the thing the customer's manager reads) is rendered from it. The blueprint is what makes the Pilot scoping deterministic instead of a fresh argument every time.

### 5.1 Choosing the first connected machine/cell

Walker is explicit: start with **one** cell's current state, not the fleet. The bridge picks the first connected cell by ranking candidate machines on four factors gathered during the floor walk:

1. **Pain** — downtime cost / frequency ("what stopped you last month?"). Highest pain wins, all else equal.
2. **Observability readiness** — is it already on Ignition / a PLC a gateway can reach? A cell that needs no new hardware ships the pilot faster.
3. **Document coverage** — are its components in the 83k pre-indexed OEM KB (or does the customer have the manuals)? Citable grounding on day one beats a black box.
4. **Bench analogy** — does it resemble something MIRA already proves (e.g. a VFD-driven conveyor ≈ the garage GS10/Micro820 bench)? Component-template inheritance gives an 80%-structured head start.

The pick is the cell that maximizes **(pain × readiness)** while having non-zero document coverage. The blueprint records the runner-up too, so the Pilot has a fallback if the first cell hits an access wall.

### 5.2 The first-90-day plan

Sequenced straight from the **absent/partial** MTRs, in Walker dependency order (you cannot historize what you cannot read):

- **Days 1–30 — Connect (reach S1).** Stand up / confirm Ignition on the pilot cell. Seed `approved_tags.json`. Reconcile the cell to its ISA-95 UNS path. Ingest the cell's manuals + wiring diagrams (close any §4 items 5–7 gaps). First grounded answer in Slack/Perspective.
- **Days 31–60 — Current state + historize (S1→S2).** Live tag snapshot in the Command Center with real freshness. Turn on the `tag_events` diff stream. Define per-tag thresholds. Begin baseline calibration.
- **Days 61–90 — Pattern (S2→S3).** Flaky-input detection live on the cell. First `flaky_signal_alert` / recurring-fault proposal lands in `/proposals`. A human confirms ≥1 relationship → KG grows from the customer's own stream. Quarterly-audit cadence established.

The plan only ever schedules stages the product can actually deliver (S1–S3). S4 work is never on a 90-day plan.

---

## 6. Output schema

The bridge emits one JSON object per assessment. This is the contract a later `/api/assess/blueprint` (or the assessor's tool) produces; it is **not** implemented by this doc.

```jsonc
{
  "schema_version": "1.0",
  "assessment_id": "uuid",
  "tenant_id": "uuid",
  "generated_at": "2026-06-02T00:00:00Z",

  "dtma": {
    "overall_score": 2.3,                       // mean of dimension means, 1.0–5.0
    "tier": "developing",                       // foundational|developing|practicing|leading
    "dimensions": {
      "data_documentation": 1.8,
      "work_order_management": 2.6,
      "preventive_maintenance": 2.4,
      "asset_intelligence": 2.0,
      "knowledge_sharing": 2.2,
      "technology_readiness": 2.8
    },
    "overrides_applied": ["data_documentation<=2.0 → front-load doc ingestion"]
  },

  "current_stage": {
    "id": "S0",                                 // S0|S1|S2|S3|S4
    "label": "Industry 3 baseline",
    "evidence": "Overall 2.3 (Developing); no live current state; manuals mostly paper."
  },

  "recommended_next_stage": {
    "id": "S1",
    "label": "Current State",
    "walker_rationale": "Walker's journey starts with 'which assets are running right now?'. This plant cannot answer that from a screen today."
  },

  "minimum_technical_requirements": [
    {
      "id": "mtr_ignition_reachable",
      "title": "Ignition Gateway reachable on plant LAN (or MQTT/Sparkplug broker)",
      "stage_unlocked": "S1",
      "status": "absent",                       // present|partial|absent|not_available_today
      "maps_to": "docs/mira-ignition-secure-architecture.md §1",
      "intake_source": "ignition_availability",
      "notes": "No Ignition today; recommend Maker/Edge on the pilot cell."
    },
    {
      "id": "mtr_outbound_443",
      "title": "Outbound HTTPS 443 to *.factorylm.com permitted",
      "stage_unlocked": "S1",
      "status": "partial",
      "maps_to": "docs/mira-ignition-secure-architecture.md §4.1",
      "intake_source": "plc_hmi_access_method",
      "notes": "IT must confirm; no inbound ports required."
    },
    {
      "id": "mtr_tag_allowlist",
      "title": "Approved-tags allowlist for pilot cell (~20–40 tags)",
      "stage_unlocked": "S1",
      "status": "absent",
      "maps_to": "approved_tags.json (master plan Phase 4 / D1)",
      "intake_source": "tag_list",
      "notes": "Seed from Ignition export or PLC program."
    },
    {
      "id": "mtr_uns_path",
      "title": "ISA-95 UNS path for the pilot cell",
      "stage_unlocked": "S1",
      "status": "absent",
      "maps_to": ".claude/rules/uns-compliance.md",
      "intake_source": "asset_list",
      "notes": "e.g. enterprise.<site>.<area>.<line>.<machine>"
    },
    {
      "id": "mtr_manuals_ingested",
      "title": "Pilot-cell manuals + fault-code tables ingested",
      "stage_unlocked": "S3",
      "status": "partial",
      "maps_to": "ADR-0020 upload→retrieval; knowledge_entries",
      "intake_source": "manuals",
      "notes": "Cross-checked against 83k pre-indexed OEM chunks."
    }
    // ... remaining MTRs per §3 for the recommended transition
  ],

  "first_90_day_plan": {
    "days_1_30": {
      "stage_target": "S1",
      "milestones": [
        "Ignition on pilot cell confirmed/installed",
        "approved_tags.json seeded (~30 tags)",
        "Pilot cell reconciled to UNS path enterprise.<site>.<area>.<line>.<machine>",
        "Manuals + wiring diagrams ingested",
        "First grounded answer in Slack/Perspective"
      ]
    },
    "days_31_60": {
      "stage_target": "S2",
      "milestones": [
        "Live tag freshness in Command Center",
        "tag_events diff stream on",
        "Per-tag thresholds defined",
        "Baseline calibration started (7-day)"
      ]
    },
    "days_61_90": {
      "stage_target": "S3",
      "milestones": [
        "Flaky-input detection live",
        "First proposal in /proposals from the customer's own stream",
        "≥1 human-verified KG relationship",
        "Quarterly-audit cadence set"
      ]
    }
  },

  "recommended_pilot_scope": {
    "first_connected_cell": {
      "name": "Line 5 infeed conveyor",
      "uns_path": "enterprise.<site>.line_5.infeed.conveyor",
      "why": "Highest downtime last quarter; VFD-driven (matches GS10/Micro820 bench template); Rockwell components already in KB.",
      "pain_rank": 1,
      "observability_ready": "partial",
      "document_coverage": "high",
      "bench_analogy": "garage GS10 conveyor (≈80% component-template reuse)"
    },
    "fallback_cell": {
      "name": "Packaging palletizer",
      "uns_path": "enterprise.<site>.packaging.palletizer",
      "why": "Second-highest pain; on Ignition already; manuals on hand."
    },
    "out_of_scope": [
      "Fleet-wide current state (Walker: connect one cell first)",
      "Predictive / forecasting (S4 — not a MIRA capability today)",
      "Any PLC write path (hard non-goal, ADR-0021)"
    ],
    "commercial_mapping": {
      "this_assessment": "$500 one-time (floor walk + this blueprint)",
      "recommended_pilot": "$2–5K/mo, 3-mo min (connect + structure the first cell)",
      "operating_layer": "$499/mo per plant (MIRA in production once S1–S3 hold)"
    }
  }
}
```

### Field reference

| Field | Source | Notes |
|---|---|---|
| `dtma.overall_score`, `dtma.dimensions`, `dtma.tier` | `dt-scorecard-spec.md` scoring | Mean of 6 dimension means; tier per existing thresholds. |
| `current_stage` | §2 score→stage map + §2 dimension overrides | One of S0–S4. |
| `recommended_next_stage` | one rung above `current_stage` | Never S4 unless honestly flagged `not_available_today` downstream. |
| `minimum_technical_requirements[]` | §3 list for the recommended transition | Each item `status` filled from the §4 intake. |
| `first_90_day_plan` | §5.2, sequenced from absent/partial MTRs | Only schedules S1–S3 work. |
| `recommended_pilot_scope.first_connected_cell` | §5.1 ranking | The single cell the Pilot connects first. |
| `recommended_pilot_scope.commercial_mapping` | `NORTH_STAR.md` / `STRATEGY.md` offer stack | Ties the blueprint to the services-led motion (see `docs/strategy/services-vs-saas-pricing-fork.md`). |

---

## 7. What this spec deliberately does not do

- **Does not change `/assess`.** `mira-web/public/assess.html` stays a no-backend lead magnet until a build phase wires `/api/assess/blueprint`. This spec defines the output that endpoint would produce.
- **Does not promise prediction.** S4 is documented for honesty and is always `not_available_today`.
- **Does not auto-verify anything.** KG growth in the 90-day plan is human-gated.
- **Does not pick the pricing motion.** It assumes the services-led journey (assess → pilot → operating) is primary; that decision is owned by `docs/strategy/services-vs-saas-pricing-fork.md`.

## 8. Cross-references

- `docs/research/2026-06-01-dt-alignment-analysis.md` — Walker #11 gap this closes; §6 recommendation 5.
- `docs/specs/dt-scorecard-spec.md` — the DTMA input (6 dimensions, tiers, scoring).
- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — Phases 4/5/9 deliver S1/S2/S3; §1 baseline.
- `docs/mira-ignition-secure-architecture.md` — the architecture the MTR list points at (§7 MVP scope, §4 security).
- `docs/strategy/services-vs-saas-pricing-fork.md` — the commercial motion the blueprint assumes.
- `NORTH_STAR.md` / `STRATEGY.md` — offer stack ($500 / $2–5K / $499) and ICP.
- `.claude/rules/uns-compliance.md` — ISA-95 path discipline for `uns_path` fields.
- `mira-web/public/assess.html` — current `/assess` surface (no backend in v1).
