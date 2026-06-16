# ABOUT MIRA — FactoryLM

## What MIRA Is

MIRA (Maintenance Intelligence & Response Assistant) is an AI-powered maintenance co-pilot built by FactoryLM. It lets industrial technicians diagnose equipment faults, retrieve manuals, and get step-by-step repair guidance — delivered through the messaging apps they already use (Slack, Telegram, Microsoft Teams, WhatsApp).

Think of it as "having a senior maintenance engineer in your pocket" — available 24/7 on every shift, for every technician, on every piece of equipment.

## The Problem We Solve

Industrial maintenance is broken in predictable ways:

- **Knowledge walks out the door.** When a senior tech retires, 30 years of tribal knowledge goes with them. The new hire stares at a faulting VFD with no idea what F0021 means.
- **Manuals are buried.** Equipment manuals exist — in binders, on shared drives, in email attachments from 2019. Finding the right page for the right model at 2am is the real problem.
- **Downtime is expensive.** Every minute a production line is down costs money. The difference between a 15-minute fix and a 4-hour troubleshoot is whether the tech has the right information at the right time.
- **Skilled labor shortage is permanent.** There aren't enough experienced maintenance techs, and there won't be. The median age in the trade is climbing. AI augmentation isn't optional — it's the only way to maintain capability as headcount shrinks.

## How MIRA Works

1. **Technician sends a message** — via Slack, Telegram, Teams, or WhatsApp. "My Allen-Bradley PowerFlex 525 is showing fault F0021 — what do I check?"
2. **MIRA runs a structured diagnostic** — a guided sequence (like a senior tech would ask): What's the equipment? What's the symptom? What have you tried? It uses an FSM (finite state machine) to walk through this, not a freeform chatbot.
3. **MIRA retrieves relevant knowledge** — from a vector database of 25,000+ indexed manual chunks (Rockwell, Siemens, ABB, and growing). 4-stage retrieval with reranking ensures the right manual page is surfaced.
4. **MIRA delivers a diagnosis + fix steps** — actionable, step-by-step repair guidance with safety warnings baked in. 21 safety keywords trigger immediate hazard alerts before any troubleshooting continues.
5. **Vision capability** — Technicians can send photos of equipment, nameplates, HMI screens, and electrical prints. MIRA identifies equipment, reads fault codes from screens, and provides context-aware guidance.

## Product Tiers

| Tier | What It Is | Target |
|------|-----------|--------|
| **Cloud Free** | Hosted SaaS — LLM + RAG, no hardware | SMB plants, quick adoption |
| **Config 1-2** | Hardware box — co-pilot + manuals, runs on-premise | Mid-market plants with IT restrictions |
| **Config 3** | Above + vision (photos, video, electrical prints) | Plants with complex equipment |
| **Config 4-6** | Above + live Modbus TCP machine data | Enterprise predictive maintenance |
| **Config 7** | Multi-site, full CMMS integration | Enterprise accounts |

**Current focus: Cloud Free + Config 1-2 MVP.**

## What's Built and Working (as of April 2026)

- 15 Docker containers running across the stack
- Claude API inference live with multi-provider cascade (Groq → Cerebras → Claude)
- 25,000+ knowledge entries indexed in NeonDB with PGVector (Rockwell, Siemens, ABB manuals)
- Telegram bot live and responding (@FactoryLMDiagnose_bot)
- Slack bot live (Socket Mode)
- Structured diagnostic FSM: IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED
- Photo/PDF ingest pipeline (3,694 confirmed equipment photos processed)
- AR HUD desktop app for hands-free diagnostic overlay
- Atlas CMMS — work order management, PM scheduling, asset registry
- PLG web funnel (mira-web) with Mira AI chat widget
- 120+ industrial fault test cases, 5-regime testing framework

## What Makes MIRA Different

- **Not a chatbot — a diagnostic engine.** The FSM enforces a structured troubleshooting flow. It doesn't just answer questions; it walks you through diagnosis the way a mentor would.
- **Safety-first by design.** 21 hardcoded safety keywords (arc flash, lockout, gas leak, etc.) trigger immediate "STOP — secure the area" responses before any troubleshooting. This is non-negotiable and non-configurable.
- **Equipment-agnostic.** Works across manufacturers. The knowledge base covers Rockwell/Allen-Bradley, Siemens, ABB, and expanding.
- **Deploys where techs already are.** No new app to install. Slack, Telegram, Teams, WhatsApp — meet techs in the tools they already have open.
- **Offline-capable architecture.** The hardware box configs can run on-premise with no internet dependency. Critical for plants with air-gapped networks.
- **Built-in CMMS.** Atlas CMMS handles work orders, PM scheduling, and asset registry — not a bolt-on integration but a native component.

## Company: FactoryLM

- Founded by Mike Harper
- Based in: [CONFIRM WITH MIKE — location]
- Stage: Pre-revenue, building toward first paying customers
- Tech stack: Python 3.12, Docker, Claude API, NeonDB, Ollama (local inference), Node-RED orchestration
- All code built with Claude Code — no legacy codebase, no tech debt from pre-AI era

## Target Market

**Primary:** Industrial facilities with maintenance teams (manufacturing plants, water treatment, power generation, food processing, oil & gas)

**Buyer personas:**
- Maintenance Manager / Director — owns the budget, feels the pain of knowledge loss and downtime
- Plant Manager — cares about uptime metrics and cost per hour of downtime
- Reliability Engineer — understands the tech, champions the tool internally

**Channel partners:**
- Equipment OEMs (Rockwell, Siemens, ABB distributors) — bundle MIRA with equipment sales
- Industrial automation integrators — add MIRA to their service offerings
- CMMS vendors — integrate MIRA's diagnostic engine into existing CMMS platforms

## Key Selling Points for Sales Conversations

1. **"How much does one hour of unplanned downtime cost you?"** — This is the opener. For most manufacturing lines, the answer is $5K–$50K+/hour. MIRA pays for itself the first time it turns a 4-hour troubleshoot into a 30-minute fix.

2. **"What happens when your best maintenance tech retires?"** — Knowledge capture and transfer. MIRA becomes the institutional memory that doesn't walk out the door.

3. **"Your techs are already on Slack/Teams."** — Zero adoption friction. No new app, no training on a new interface. They message MIRA the same way they message each other.

4. **"Try it free, upgrade when you're ready."** — PLG funnel. Cloud Free tier lets them experience the value before committing to hardware.

5. **"We handle the manuals."** — The ingest pipeline processes their equipment manuals (PDFs, photos, electrical prints) into the knowledge base. They don't need to organize anything — just point us at the files.

## Competitive Landscape

- **Augmentir** — AR-based connected worker platform. Enterprise-heavy, expensive, requires their hardware.
- **Tulip** — No-code manufacturing app platform. More about process automation than diagnostics.
- **Fiix/UpKeep/eMaint** — Pure CMMS. No AI diagnostics. MIRA competes on the intelligence layer.
- **Generic AI chatbots (ChatGPT, etc.)** — No structured diagnostic flow, no safety guardrails, no equipment-specific knowledge base, no messaging app integration.

**MIRA's wedge:** We're the only solution that combines structured AI diagnostics + equipment knowledge base + safety guardrails + native messaging app delivery + optional on-premise deployment. Everyone else does one or two of these.
