# MIRA Wedge & Positioning

> How MIRA positions vs the Industry 4.0 / industrial AI landscape, expressed in plain language and grounded in this library's research.
>
> **Last updated:** 2026-05-19

## The 30-second pitch

MIRA is a **Slack-first maintenance copilot** that grounds every answer in the customer's real factory context — UNS, knowledge graph, manuals, wiring diagrams, work-order history. It is not a SCADA replacement, not a CMMS replacement, and not a generic chatbot. It is the **maintenance intelligence layer** that understands asset context **before** giving advice.

## The category map (working hypothesis)

| Category | Examples | What they own | MIRA's relationship |
|---|---|---|---|
| **SCADA / HMI platforms** | Ignition (Inductive Automation), AVEVA, Tatsoft | The screen the operator looks at | **Complement** — MIRA reads UNS / tags they expose |
| **UNS / DataOps** | HighByte, Litmus, CESMII (standards) | The model that maps OT ↔ IT | **Ground against** — MIRA is a consumer of their model |
| **MES / Frontline ops** | Tulip, Fuuz, Critical Manufacturing | The app the line worker uses | **Adjacent** — MES is for production; MIRA is for maintenance |
| **MQTT brokers** | HiveMQ, EMQX, Mosquitto | Wire-level pub/sub + Sparkplug B | **Use** — never compete; MQTT is plumbing |
| **CMMS** | MaintainX, Atlas (our own), Limble, Fiix | The work-order system of record | **Integrate** — MIRA reads/writes work orders; CMMS owns the record |
| **Production analytics** | MachineMetrics, TwinThread | OEE / predictive analytics | **Cross-sell** — different buyer, can co-exist |
| **Conversational AI bolt-ons** | Generic GPT plugins, vendor chatbots | A chat box on top of a product | **Outflank** — generic chat without UNS gate is the anti-pattern |

## What we are NOT

- ❌ A **SCADA replacement** — we don't draw plant screens. Ignition / Tatsoft / AVEVA already do that, and they're entrenched.
- ❌ A **CMMS replacement** — we don't own the work-order record. MaintainX, Atlas, Limble, Fiix do. We integrate.
- ❌ A **generic chatbot** — without the UNS confirmation gate and grounded evidence, the product is a worse ChatGPT.
- ❌ A **PLC programming tool** — we read tags; we don't author logic. Studio 5000, TIA Portal, Connected Components Workbench own that.
- ❌ A **PI System / historian** — we cite history; we don't store decades of process data. AVEVA PI, Canary, Ignition Tag Historian own that.

## What we ARE (the wedge)

The wedge has four legs. All four must hold for the positioning to work.

### 1. Slack-first

The technician is already in Slack. They already get alerts there. They already ask each other questions there. MIRA shows up in that exact surface — not a separate app, not a separate dashboard, not a kiosk. (See [companies/maintainx.md](../companies/maintainx.md) for the contrast: their bet is the mobile app is the surface; ours is that chat already won.)

### 2. UNS confirmation gate (non-negotiable)

Before MIRA gives any troubleshooting advice it confirms **site → area → line → asset → component → suspected fault** with the technician. This is enforced in `mira-bots/shared/engine.py` and audited by the `mira-run-hallucination-audit` command. Every competing conversational product we've researched either:

- Skips this gate (generic chat / vendor bolt-ons), or
- Solves it by being attached to a single tag map (Ignition Vision/Perspective Tag pickers), so they don't generalize across a customer's full plant.

MIRA's gate is portable: it grounds in the UNS regardless of who owns the SCADA or the broker.

### 3. Grounded evidence

Every reply cites a knowledge-graph relationship, manual page, work-order ID, PLC tag, or technician confirmation. `mira-bots/shared/citation_compliance.py` and the 1-5 groundedness score in `mira-bots/shared/engine.py` are the proof harness. The **demo-ability** of this is the moat — anyone can claim "AI for maintenance"; almost nobody can show citations on every line in a live call.

### 4. Knowledge graph + component templates

`kg_entities` + `kg_relationships` + reusable component profiles (`PowerFlex 525`, `Allen-Bradley 1756-L73`, etc.) are how MIRA learns once and applies many times. The `proposed` / `verified` / `rejected` / `needs_review` lifecycle keeps the graph honest. (See `mira-component-intelligence-architecture` spec and the [HighByte file](../companies/highbyte.md) for the closest external analog.)

## How we beat each category

| If a buyer compares us to … | The line is … |
|---|---|
| **A SCADA copilot** | "We don't draw screens. We ground in the screens you already have. Bring your Ignition, AVEVA, FactoryTalk; MIRA reads the UNS." |
| **A CMMS chatbot** | "Your CMMS is where the work order lives. MIRA is where the technician finds the answer before, during, and after. We integrate; we don't compete." |
| **A generic LLM bolted on** | "Show me where it confirms the asset before answering. Show me the citations on each line. Show me the groundedness score." |
| **A vendor-specific copilot (e.g., FactoryTalk Optix, Siemens Industrial Copilot)** | "We're not tied to one PLC family. Your plant has Rockwell on one line and Siemens on another and Mitsubishi on a third. MIRA reads UNS, not OEM." |
| **A purely predictive analytics product** | "Predictive tells you something is going to fail. We tell you what to do about it, in the moment, in the technician's chat, with citations." |

## Pricing and motion (working hypothesis)

- **PLG funnel** at `factorylm.com/cmms` for self-serve evaluation (already shipped in `mira-web/`).
- **Land via Slack adapter + a sample plant**; expand into manuals + KG buildout.
- **Value capture** on grounded answers / month, plant size, integrations. (Specifics live in `NORTH_STAR.md` and `STRATEGY.md` — this file is positioning, not pricing.)

## Open questions

- [ ] Do we own the agent layer or partner with HighByte for the modeling layer? (See decision log entry "highbyte-partnership" once added.)
- [ ] Where does the boundary with Atlas (our CMMS) sit long-term? Atlas owning the work-order record, MIRA owning the assistant, integration as the moat — keep validating.
- [ ] Slack-first vs Teams-first for enterprise plants — Teams almost certainly comes next; what's the order of operations?

## Cross-references

- [INDEX.md](../INDEX.md) — every company file feeds this positioning argument
- [summaries/executive-summary.md](../summaries/executive-summary.md) — the cross-cutting story
- [mira-lessons/mira-architecture-decisions.md](mira-architecture-decisions.md) — decisions this positioning has driven
- `docs/THEORY_OF_OPERATIONS.md` — primary product doctrine (the official one)
- `NORTH_STAR.md` — commercial flywheel (still authoritative)
- `STRATEGY.md` — GTM motion (still authoritative)
