# MIRA — Theory of Operations

**Status:** ACTIVE — primary operational doctrine
**Authored:** 2026-05-15
**Owner:** Mike Harper

This is **the primary doc for "what MIRA is, how it works, and why."** Read it first. Everything else in the repo is either implementation of, or evidence for, what is written here.

---

## Mission

**MIRA turns everyday maintenance activity into an AI-ready factory namespace.**

Photos, work orders, manuals, drawings, technician notes, and PLC/Ignition tags flow in. A maintenance-first Unified Namespace, a relationship graph, a component library, and a grounded technician copilot come out. The namespace is the product. MIRA is the agent that builds and uses it.

## The Wedge

UNS (Unified Namespace) is a buzzword every consultant is selling to operations. **Nobody is structuring the maintenance side of UNS.** That is the lane.

- UNS Studio and the enterprise-architect crowd build the namespace *for the architect*.
- MIRA builds the namespace *for the maintenance team standing at the machine* — through normal work, one photo and one work order at a time.

The technician does not have to become a data architect. They take a picture of a failed prox switch on their normal Tuesday shift, and a component profile, a manual reference, a PLC tag candidate, and a fault association become *proposed* in the namespace. A confirmed answer to the technician's next question grounds in those proposals.

## The Core Loop

```
              ┌──────────────────────────────────────┐
              │  CAPTURE   (photo / note / WO / tag) │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  EXTRACT   (OCR / vision / parse)    │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  MATCH     (UNS path / KG entity)    │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  PROPOSE   (KG edge + evidence)      │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  CONFIRM   (human-in-the-loop)       │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  STORE     (verified KG + namespace) │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  REMIND    (missing-data tasks)      │
              └────────────────┬─────────────────────┘
                               ▼
              ┌──────────────────────────────────────┐
              │  USE       (grounded troubleshooting)│
              └────────────────┬─────────────────────┘
                               ▼
                         ( repeat )
```

The loop is asynchronous. A technician's photo today may become a confirmed component profile next week, and feed a grounded answer next month. The plant model accretes over time — it is never "finished," and that's the point.

## Layer Map

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONT DOORS                                                    │
│  • Slack (primary, slack-bolt, Socket Mode)                     │
│  • Web Hub (app.factorylm.com, Next.js)                         │
│  • Telegram, monday.com, /m/[assetTag] mobile QR (secondary)    │
├─────────────────────────────────────────────────────────────────┤
│  ENGINE  (mira-bots/shared/)                                    │
│  • Dialogue State Tracker (FSM)                                 │
│  • UNS Location-Confirmation Gate  ← NON-NEGOTIABLE             │
│  • Intent / specificity / quality / citation gates              │
│  • InferenceRouter cascade (Groq → Cerebras → Gemini)           │
├─────────────────────────────────────────────────────────────────┤
│  LIVE CONTEXT  (read-only, no writes)                           │
│  • Ignition tag streams (mira-relay)                            │
│  • MQTT / Sparkplug B (planned)                                 │
│  • UNS path grammar (mira-crawler/ingest/uns.py, ltree)         │
├─────────────────────────────────────────────────────────────────┤
│  MEMORY                                                         │
│  • Knowledge graph: kg_entities + kg_relationships (NeonDB)     │
│  • Component templates (reusable, per-model)                    │
│  • Installed component instances (per-customer)                 │
│  • Approval state: proposed / verified / rejected / deprecated  │
├─────────────────────────────────────────────────────────────────┤
│  EVIDENCE                                                       │
│  • Manuals, drawings, datasheets (knowledge_entries + pgvector) │
│  • Work-order history (CMMS / Atlas / MaintainX)                │
│  • Technician photos + nameplate OCR                            │
│  • Fault codes (fault_codes table)                              │
│  • Technician confirmations + admin approvals                   │
└─────────────────────────────────────────────────────────────────┘
```

Dependencies flow downward. Front doors call the engine; engine calls memory + evidence + (optionally) live context. Front doors never bypass the engine.

## The Seven Invariants

These are non-negotiable. A PR that breaks one of them is a bug, not a feature.

1. **MIRA is not a generic chatbot.** It answers grounded maintenance questions. Refuse drift.
2. **Slack is the front door.** Other adapters (Web Hub, Telegram, monday.com) follow Slack's contract — same engine, same gate, same grounding. The Web Hub is a parallel adapter for visual workflows, not a replacement.
3. **UNS / MQTT is the live context layer.** Plant context comes from the namespace + relay + Ignition streams. New live sources integrate here; they do not bypass.
4. **Knowledge graph is memory.** Every edge has a status (`proposed` / `verified` / `rejected` / `deprecated`). LLM-generated edges enter as `proposed`. Promotion to `verified` is a human action.
5. **Customer docs and work orders are evidence.** Manuals, drawings, work-order history, and technician confirmations are what makes answers groundable. Never ungrounded.
6. **All troubleshooting is grounded.** No answer without at least one cited source. The citation_compliance hook exists for this reason.
7. **Confirmation over guessing.** The UNS Location-Confirmation Gate must resolve the technician's work context (site / area / line / machine / asset / component / fault) before any troubleshooting answer. A confirmation question is cheaper than a wrong answer in a plant.

## The Levels-Unlock Model (AI Readiness)

A plant does not become "AI-ready" overnight. It progresses through levels as the namespace fills in. MIRA's automated readiness score (per asset, per line, per plant) measures *how much MIRA can actually do* with the current state of the customer's namespace.

| Level | Name | Namespace state | What MIRA can do |
|---|---|---|---|
| **L0** | Unknown | Tenant exists; almost no structured data | Accept uploads. Show a "next step" task list. |
| **L1** | Basic hierarchy | Company → site → area → line nodes confirmed | Organize notes and documents at a basic location level. |
| **L2** | Asset map | Lines, machines, assets confirmed under their parents | Attach photos, notes, work orders to specific assets. |
| **L3** | Component intelligence | Components have mfr / model / manual / datasheet | Turn a photo of a field device into a usable component profile. |
| **L4** | Tag mapping | PLC / Ignition tags mapped to components | Answer live-tag questions (read-only). |
| **L5** | Fault intelligence | Faults mapped to assets + components + drawings + WO history | Grounded troubleshooting with evidence trail. |
| **L6** | Business intelligence | Downtime, parts, vendor patterns aggregated | Operations / reliability / finance-level insight. |

Differentiation from `factorylm.com/assess`: that scorecard is a *manual 20-question 1–5 maturity self-rating* across six dimensions of digital transformation. The Levels-Unlock model is an *automated measurement of MIRA's namespace state*. Both are useful — the scorecard sells the assessment service; the levels-unlock model proves the namespace is filling in.

## The Sales Flywheel

The product is the transformation. The flywheel is what makes each transformation cheaper and faster than the last.

```
        Plant onboards (Assessment $500 → Pilot $2-5K/mo)
                    ▼
        We structure one line (or self-serve via wizard)
                    ▼
        Namespace exposes gaps  ◄────────────────┐
                    ▼                            │
        Health score + missing-data tasks        │
                    ▼                            │
        Consulting fills gaps (per-line cleanup) │
                    ▼                            │
        Patterns reused across plants ───────────┘
                    ▼
        Operating Layer ($499/mo) — MIRA in production
                    ▼
        Knowledge Cooperative — anonymized patterns flow
                    ▼
        Next plant onboards faster
```

The health score is **not a vanity metric**. It is the sales tool. A plant looking at "Line 5 AI Readiness: Level 3 — 41% component profiles complete, 7 manuals missing, 12 unmapped tags" has a clear and bounded reason to engage consulting, buy a higher tier, or assign technician time during normal work.

Inherited from `NORTH_STAR.md` (still authoritative for the commercial flywheel) and `STRATEGY.md` (still authoritative for ICP, three offers, GTM motion).

## Competitive Lane

**UNS Studio (4.0 Solutions) is for the architects. MIRA is for the maintenance team standing at the machine.**

| Vendor | What they do | Why they don't compete |
|---|---|---|
| **4.0 Solutions UNS Studio** | UNS architecture, ISA-95 simulation, MCP, enterprise dashboarding | Aimed at engineers, architects, digital transformation leads — not technicians. They build *the architecture*; MIRA builds *the maintenance reality inside it*. |
| **HighByte / HiveMQ / Sepasoft** | Industrial data infrastructure (broker / modeller / Ignition module) | Adjacent, not competing. MIRA can sit on top of any of these. |
| **MaintainX / UpKeep / Limble / Fiix** | Self-serve CMMS | They sell software to plants that already have structured data. MIRA creates the data. Integration partners, not replacements. |
| **Augury / sensor-led predictive** | Vibration / sensor analytics | Narrow vertical, hardware-led; no document, namespace, or knowledge-graph layer. |
| **Big SIs (Accenture, Deloitte)** | Enterprise digital transformation | Won't touch a 200-person plant. Wrong price point, wrong scale. |

**Unique moat:** MIRA is the only system that (a) does the hands-on namespace structuring AND (b) ships the AI execution layer that runs on top of it. Pure consultancies leave you with a binder. Pure SaaS leaves you hallucinating. MIRA does both — and the more plants on the Operating Layer, the lower the structuring cost per new plant (the Knowledge Cooperative).

## Decision Filter

Inherited from `NORTH_STAR.md`. Before building any feature, ask: **"Does this make the flywheel spin faster?"**

Refined for the namespace-builder direction:
- Reusable OEM manual parsing → **YES** — directly drops structuring cost across all plants.
- Better UNS confirmation gate → **YES** — every grounded answer depends on it.
- Health-score dashboard exposing gaps → **YES** — drives both technician capture and consulting upsell.
- A namespace tree editor in the hub → **YES** — closes the "MIRA proposes, human confirms" loop.
- Self-serve onboarding wizard → **YES (changed from `defer`)** — the wedge has shifted; STRATEGY.md's "defer wizard" was correct when our only motion was hands-on pilots. With the Maintenance Namespace Builder framing, a wizard becomes the on-ramp that *seeds* the pilot conversation.
- Live PLC writes / control commands → **NEVER** — safety boundary.
- A LangChain abstraction over the LLM call → **NEVER** — PRD §4.
- A pretty dashboard chart that doesn't expose namespace gaps → **NO** — vanity.

## The Knowledge Cooperative

The long-term moat from `NORTH_STAR.md`, preserved here verbatim: Operating-Layer plants who opt in share anonymized PM patterns and fault-resolution traces. A plant that pilots a Yaskawa GA500 — every subsequent plant with a GA500 starts ~80% structured for free. The more plants on the Operating Layer, the lower the structuring cost per new plant. The flywheel compounds.

The cooperative is *not* unmoderated public data. It is admin-curated, evidence-bound, and opt-in.

## Non-Goals (Hard Boundaries)

MIRA will not:

- Write to PLCs. Period. No commands, no resets, no parameter changes.
- Replace the customer's CMMS, SCADA, historian, or ERP. MIRA integrates; MIRA does not replace.
- Auto-verify proposed KG edges. Every promotion to `verified` is a human action.
- Provide live troubleshooting before the UNS Location-Confirmation Gate succeeds.
- Become a generic chatbot, marketing chatbot, or homepage assistant.
- Reintroduce Anthropic as an inference provider (removed PR #610; cascade is Groq → Cerebras → Gemini).
- Add a LangChain / n8n / framework abstraction over the LLM call (PRD §4).
- Bypass safety-critical confirmation flows because they are "annoying."

## What Is True Today vs. The Roadmap

Status badges follow NORTH_STAR.md convention: ✅ built · ⚠️ partial · 🔲 not built.

| Capability | Status | Notes |
|---|---|---|
| Knowledge graph schema (kg_entities, kg_relationships, ltree uns_path) | ✅ | Migrations 004 / 005 / 006 / 007. Production. |
| Document ingestion (PDF → chunk → embed → dedup → KG entity) | ✅ | `mira-crawler/ingest/`. ~25K knowledge_entries. |
| Nameplate OCR (mfr / model / serial / V / FLA / HP) | ⚠️ | `nameplate_worker.py` works; **only invoked from bot chat, not from an ingest API**. |
| Component template ↔ installed instance distinction | ⚠️ | Implicit in kg_entities; not yet a separate schema layer. |
| Slack adapter (Socket Mode) | ✅ | `mira-bots/slack/`. Same engine as Telegram. |
| Web Hub (Next.js, /feed, /assets, /documents, /knowledge, /workorders, /schedule, /plc, /m/[assetTag]) | ✅ | `mira-hub/`. `parent_asset_id` exists; tree UI does not. |
| QR asset scan (`/scan`, `/sample`, `/activated`, monday.com app) | ✅ | `mira-scan` spec. Create-asset path stubbed via `scan-not-found.html`. |
| Dialogue State Tracker FSM (IDLE → Q1 → … → RESOLVED) | ✅ | Stage 1. `mira-bots/shared/engine.py` + `conversation_state` SQLite. |
| UNS resolver (vendor / model / fault-code extraction) | ✅ | `mira-bots/shared/uns_resolver.py` (~900 lines) + `uns_paths.py` on origin/main. `UNSContext` dataclass, `resolve_uns_path()` called from `engine.py` in 14+ places (PRs #1220, #1314, #1280, #1295). Spec at `docs/specs/uns-message-resolver-spec.md`. |
| UNS Location-Confirmation Gate (vendor/model/fault scope) | ✅ | PR #1280 merged: "UNS Confirmation Gate — no diagnosis without confirmed equipment" (`engine.py` line 1316). Behavior validated for vendor + model + fault path. |
| UNS Location-Confirmation Gate (site/area/line/asset hierarchy scope) | ⚠️ | The existing gate confirms **what equipment**; the namespace-builder spec extends it to confirm **where in the plant** (site → area → line → machine → asset → component). Phase 1 is the additive extension, not a from-scratch build. |
| AI proposal queue (`ai_suggestions`, `approvals`) | 🔲 | KG edges currently auto-insert. Human-in-the-loop is rhetorical, not real. Phase 1. |
| Namespace tree editor UI | 🔲 | `/assets` is flat. Phase 2. |
| AI readiness / health score (automated L0–L6) | 🔲 | Groundedness is in-memory boolean. Phase 2. |
| Onboarding wizard with saved progress (`wizard_progress`) | 🔲 | Signup → `/feed` is one step. Phase 3. |
| Tag-import CSV wizard | 🔲 | Relay accepts live JSON; no CSV → KG path. Phase 3. |
| Ignition tag CSV export helper | 🔲 | Phase 5. |
| Ignition Java/Kotlin SDK module | 🔲 | Phase 6. |
| Manual scoring scorecard (`factorylm.com/assess`) | ✅ | 20 questions / 6 dimensions. Sells the $500 assessment. |
| Citation compliance (observational) | ⚠️ | `citation_compliance.py` logs; does not enforce. TOO doc calls for enforcement where appropriate. |
| InferenceRouter cascade (Groq → Cerebras → Gemini) | ✅ | No Anthropic. PII sanitization on. |
| CMMS tools (Atlas / MaintainX) | ✅ | `cmms_list_work_orders`, `cmms_create_work_order`, etc. |
| MQTT / Sparkplug B export | 🔲 | Post-MVP. |

## Document Hierarchy

This doc is at the top. Specs live under it. ADRs and plans live under them.

```
docs/THEORY_OF_OPERATIONS.md            ◄── (you are here) primary doctrine
├── docs/specs/maintenance-namespace-builder-spec.md
│   └── the technical contract for the namespace-builder product surface
├── docs/specs/mira-component-intelligence-architecture.md
│   └── the implementation-level architecture (component templates, KG mechanics)
│       — its self-declared "supersedes" line is now historical;
│         this TOO doc re-layers the hierarchy
├── docs/specs/uns-kg-unification-spec.md
│   └── the unified address / identity model for the KG
├── docs/specs/dialogue-state-tracker-spec.md
│   └── the FSM that the UNS gate plugs into
├── docs/specs/quality-gate-spec.md
├── docs/specs/knowledge-graph-spec.md  (+ multi-hop spec)
├── docs/specs/rag-pipeline-spec.md
├── docs/specs/mira-scan-spec.md
└── docs/plans/2026-05-15-maintenance-namespace-builder.md
    └── phased execution roadmap
```

Commercial layer (still authoritative as written, but interpreted through this doc):
- `NORTH_STAR.md` (repo root) — the commercial flywheel + Three Offers.
- `STRATEGY.md` (repo root) — ICP, GTM motion, competitive table.
- `docs/specs/dt-scorecard-spec.md` — the manual self-rating scorecard (distinct from the automated L0–L6 model).

CLAUDE.md files (root + `.claude/CLAUDE.md`) point at this doc as the primary North Star.

## Cross-References

- **Architecture invariants enforced by skill:** `.claude/skills/mira-architecture-guardian/SKILL.md`
- **Scope classifier:** `.claude/skills/mira-saas-scope-guard/SKILL.md`
- **UNS gate UX:** `.claude/skills/uns-location-gate-designer/SKILL.md`, `.claude/skills/slack-technician-ux-writer/SKILL.md`
- **Layer rules:** `docs/ARCHITECTURE.md`
- **Container map + env vars:** root `CLAUDE.md`

## Change Log

- **2026-05-15** — Initial draft. Establishes namespace-builder framing as the primary product doctrine; relegates `mira-component-intelligence-architecture.md`'s self-declared "North Star" status to "implementation-level architecture." Differentiates automated L0–L6 readiness from manual `/assess` scorecard. Preserves commercial flywheel from NORTH_STAR.md / STRATEGY.md unchanged.
- **2026-05-15 (correction)** — Reflected actual origin/main state after fetch: UNS resolver (`uns_resolver.py`, `uns_paths.py`) and Stage-1 confirmation gate are **already merged** (PRs #1220, #1280, #1295, #1314). Existing scope is vendor / model / fault-code. The namespace-builder spec extends this to full site → area → line → asset → component hierarchy. Local main checkouts may be behind — run `git fetch origin main` before any Phase 1 work.
