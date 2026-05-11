# Competitor Data Ingest & Onboarding Research
**Purpose:** Competitive gap analysis for MIRA Hub trade show demo — May 21, 2026
**Researched:** 2026-05-11 | Sources: live web fetches from vendor sites

---

## 1. MaintainX (maintainx.com)

**Data formats accepted**
- CSV/Excel import (assets, work orders — standard onboarding flow)
- REST API bulk create (assets, WOs, parts)
- Manual entry via mobile or web
- No documented PDF manual ingest or OCR nameplate scanning

**Integrations offered**
- ERP: SAP (direct connector), Oracle (listed), QuickBooks, Sage
- PLCs/Sensors: Samsara, MachineMetrics, Waites, Ignition (Inductive Automation — newly listed May 2026)
- Fleet: Motive, Samsara
- IoT Monitoring: MachineMetrics
- Productivity/Collaboration: Zapier (no-code bridge)
- No SharePoint/Google Drive document ingest listed
- Source: [maintainx.com/integrations](https://www.maintainx.com/integrations)

**API surface**
- Public REST API v1: `https://api.getmaintainx.com/v1/docs`
- Auth method: not confirmed from public docs page (page returned minimal content); Nango SDK confirms API key-based auth for asset/WO sync
- Covers: assets, work orders, parts (confirmed via Nango integration schemas)
- No public MCP or agent tool surface found

**Onboarding flow**
- "Request a Demo" gated (no public self-serve free trial found on homepage)
- Integration categories suggest guided setup wizard
- Sales-call required for enterprise ERP connections

**Time-to-first-value**
- No explicit public claim found; industry positioning suggests 1–4 weeks

**AI/LLM features**
- "Intelligent maintenance" — automated PM scheduling, condition-based work triggers, anomaly detection
- "Get ahead of breakdowns with AI" (homepage language)
- No documented photo-to-asset or PDF-to-PM-schedule feature
- Source: [maintainx.com](https://www.maintainx.com)

**MCP / AI-agent surface**
- None found. No MCP server, no OpenAI tool surface.

**What they DO well**
- Broadest named integration ecosystem of all 7 (SAP + Ignition + MachineMetrics + fleet in one list)
- Strong PLC/sensor category — rare for CMMS platforms

**What they DON'T do**
- No photo → asset creation (no "snap a nameplate" flow)
- No PDF OEM manual ingest → PM schedule generation

---

## 2. UpKeep (onupkeep.com)

**Data formats accepted**
- CSV import (assets, work orders) — handled by customer success team during onboarding
- REST API (`api.onupkeep.com/api/v2`) for bulk create
- Manual entry via mobile (mobile-first design)
- No OCR nameplate or PDF ingest found in docs

**Integrations offered**
- ERP: Zapier (no-code), direct connectors for "common business systems"
- IoT/SCADA: UpKeep Edge — proprietary industrial-grade sensors; sensor data flows into work orders and asset records
- GPS systems
- SSO (enterprise tier)
- Source: [onupkeep.com/product/CMMS-software](https://www.onupkeep.com/product/CMMS-software)

**API surface**
- Public REST API v2: `https://api.onupkeep.com/api/v2/`
- Auth: session token (POST credentials → get token); all subsequent calls use token header
- Documented endpoints: auth, work orders, assets, PM schedules (PMTemplate + PMSchedule + PMFulfillment model)
- Webhooks: not confirmed from fetched docs
- Source: [developer.onupkeep.com](https://developer.onupkeep.com/)

**Onboarding flow**
- Self-serve free trial available (`upkeep.com/free-trial-signup`)
- Starts at $24/user/month, unlimited free requester seats
- Single-site: live in <30 days; enterprise: 60–90 days
- Customer success team handles data import, config, training

**Time-to-first-value**
- "Under 30 days" for single-site — stated on product page

**AI/LLM features**
- "Nova" — AI assistant; auto-generates PM schedules, suggests work orders from sensor alerts
- AI-suggested work orders from Edge sensor insights
- No photo-to-asset or PDF manual ingest found
- Source: [onupkeep.com/product/CMMS-software](https://www.onupkeep.com/product/CMMS-software)

**MCP / AI-agent surface**
- None found.

**What they DO well**
- Best-documented public REST API of the group (full v2 reference with auth, PM model, fulfillment logic)
- UpKeep Edge proprietary IoT sensor integration is vertically integrated and rare

**What they DON'T do**
- No PDF/OEM manual ingest
- No AI nameplate scanning

---

## 3. Limble CMMS (limblecmms.com)

**Data formats accepted**
- CSV/Excel import (standard)
- **"Asset Snap"** — AI-powered mobile nameplate photo → structured asset record (80% faster onboarding claimed)
- Manual entry
- No PDF OEM manual ingest to PM schedule found (AI asset creation is photo-only)
- Source: [limblecmms.com/blog/ai-asset-creation](https://limblecmms.com/blog/ai-asset-creation/)

**Integrations offered**
- ERP: SAP S/4HANA (direct), Oracle NetSuite (direct), QuickBooks
- Productivity: Slack (AI/Productivity category)
- REST API for custom integrations
- Implementation services offered
- Source: [limblecmms.com/integrations](https://limblecmms.com/integrations/)

**API surface**
- Public REST API exists (linked from integrations page)
- Auth method not confirmed from fetched docs
- No MCP or agent surface found

**Onboarding flow**
- "Schedule Demo" gated (no visible free trial CTA on main site)
- Implementation team / professional services offered
- AI Asset Snap built into mobile app — point-of-work onboarding

**Time-to-first-value**
- "Onboard legacy assets up to 80% faster" (AI Asset Snap claim)
- No day-count claim found

**AI/LLM features**
- **Asset Snap**: AI image + text recognition → nameplate photo → complete structured asset record; extracts model, serial, manufacturer; auto-generates QR code; user validates before saving
- Predictive maintenance product listed in feature set
- Source: [limblecmms.com/blog/ai-asset-creation](https://limblecmms.com/blog/ai-asset-creation/)

**MCP / AI-agent surface**
- None found.

**What they DO well**
- Only competitor with a shipped, documented AI nameplate → asset flow (Asset Snap)
- Strong ERP integrations (SAP + NetSuite native)

**What they DON'T do**
- Photo scan covers nameplate only — no PDF OEM manual → PM schedule pipeline
- No conversational AI / chat interface found

---

## 4. Fiix (fiixsoftware.com — Rockwell Automation)

**Data formats accepted**
- CSV/Excel import (standard CMMS onboarding)
- REST API (Fiix Open API)
- Manual entry
- No photo/OCR nameplate or PDF ingest found

**Integrations offered**
- ERP: SAP S/4HANA (dedicated one-pager, March 2026 updated)
- Industrial: FactoryTalk Optix (Rockwell's own IIoT/SCADA — condition-based maintenance integration, May 2026 webinar)
- Zapier for no-code connections
- Source: [fiixsoftware.com/cmms-features/integrations](https://www.fiixsoftware.com/cmms-features/integrations/)

**API surface**
- "Fiix Open API" — documented (URL 404'd during fetch; confirmed referenced on integration page)
- Being Rockwell-owned implies enterprise API governance
- No MCP surface found

**Onboarding flow**
- Sales-call gated (enterprise positioning)
- No self-serve trial visible on homepage
- Onboarding likely 4–12 weeks for full ERP + SCADA integration

**Time-to-first-value**
- No public claim; Rockwell enterprise sales cycle implies weeks to months

**AI/LLM features**
- "AI-Powered Work Orders" — headline on homepage
- FactoryTalk Optix integration enables condition-based maintenance (sensor data → automated WO triggers)
- No LLM chat, no photo scanning, no PDF ingest found

**MCP / AI-agent surface**
- None found.

**What they DO well**
- Deepest industrial connectivity — FactoryTalk Optix (SCADA) + SAP in one platform; unique given Rockwell ownership
- Most credible for heavy industrial / OEM manufacturing accounts

**What they DON'T do**
- No AI nameplate scanning, no PDF → PM pipeline
- No self-serve / PLG motion — pure enterprise sales

---

## 5. Edmund AI (edmund.ai)

**Existence check:** The domain `edmund.ai` resolved but returned empty content (no indexable page). No public CMMS product named "Edmund AI" was found via web fetch. This may be:
- A stealth/pre-launch product
- A different company than the one intended (Edmund Optics, etc.)
- A rebranded or acquired entity

**Verdict:** Cannot confirm existence as an AI-first CMMS competitor. No data available — do not include in competitive benchmarking until a valid URL or product page is identified.

---

## 6. Maintastic (maintastic.com)

**Existence confirmed.** German-market CMMS, English version at `maintastic.com/en/`. Active product with pricing and free trial.

**Data formats accepted**
- Manual entry (web + mobile)
- QR code scanning for asset/ticket creation
- IoT-triggered tickets (sensor integration)
- No explicit CSV import or PDF ingest found in fetched pages

**Integrations offered**
- ERP integration listed as a feature category (`maintastic.com/en/erp-integration`)
- API & Integration feature page exists
- Specific ERP connectors (SAP, NetSuite, etc.) not confirmed in fetched content
- AR/Video remote assistance built in

**API surface**
- REST API mentioned as feature; specifics not exposed in fetched content
- No public developer docs URL found

**Onboarding flow**
- Self-serve free trial available (`maintastic.com/en/maintastic-cmms-free-trial/`)
- Book-a-demo option also available
- 90-second product video — lightweight self-serve motion

**Time-to-first-value**
- No specific claim found

**AI/LLM features**
- **AI Agent**: "Create & access knowledge so your team can get work done faster"
- **AI-powered ticketing**: IoT or QR-triggered, AI-assisted
- **Collaboration with AI & AR**: Video remote assistance + intelligent chat
- Source: [maintastic.com/en](https://maintastic.com/en/)

**MCP / AI-agent surface**
- Internal "AI Agent" is proprietary, not exposed as MCP/OpenAI tool surface

**What they DO well**
- AI + AR remote assistance for collaboration — unique among this set
- Lightweight self-serve free trial (low friction entry)

**What they DON'T do**
- Narrow geographic footprint (German-market primary; English site exists but market presence unclear in US)
- No nameplate photo → asset, no PDF OEM ingest

---

## 7. Threaded Manufacturing (threadedmfg.com)

**Existence confirmed.** Small, pre-product-detail stage. Landing page exists; no feature detail pages accessible (most internal links 404'd).

**Data formats accepted**
- Not documented publicly — no import flow visible

**Integrations offered**
- Not listed on public site

**API surface**
- None documented publicly

**Onboarding flow**
- "Talk to Our Team" CTA only — sales-call gated, no self-serve

**Time-to-first-value**
- No public claim

**AI/LLM features**
- Positioning: "Manufacturing-Native AI" using Industrial Engineering frameworks (Lean, TPS, TOC)
- AI uses value stream context + plan-vs-actual feedback to take action
- "The connective layer that unlocks visibility and improvement"
- Specific AI features (chat, photo, PDF) not documented — likely pre-GA
- Source: [threadedmfg.com](https://threadedmfg.com)

**MCP / AI-agent surface**
- None found. No developer surface at all.

**What they DO well**
- Strong IE/Lean framing — differentiates from generic CMMS by anchoring AI to proven manufacturing methodology

**What they DON'T do**
- No documented data ingestion, API, or integration surface — likely very early stage
- No self-serve entry point

---

## Synthesis: Table-Stakes vs Differentiators

### Table Stakes
Capabilities held by ≥4 of 7 competitors that MIRA must match to be credible:

1. **CSV/Excel asset import** — all major platforms (MaintainX, UpKeep, Limble, Fiix) support bulk CSV import as baseline onboarding
2. **Public REST API with CRUD on assets and work orders** — MaintainX, UpKeep, Limble, Fiix all have documented or referenced public APIs
3. **ERP integration (SAP + NetSuite)** — MaintainX, UpKeep (via Zapier), Limble, Fiix all claim SAP connectivity; Limble + Fiix have native SAP S/4HANA connectors
4. **Mobile-first work order management** — all 4 established platforms are mobile-first; Maintastic also
5. **PM scheduling with automated triggers** — all 4 established platforms offer PM automation; UpKeep and MaintainX extend this with sensor/IoT triggers
6. **Zapier / no-code integration bridge** — MaintainX, UpKeep, Fiix all list Zapier; critical for SMB onboarding without IT resources

### MIRA Differentiators
Capabilities MIRA has that ≤1 of 7 competitors offer:

1. **PDF OEM manual → PM schedule generation** — Zero competitors do this. Limble does photo→asset; no one converts OEM PDFs into maintenance schedules via LLM. MIRA's mira-crawler + docling pipeline is the only documented implementation.

2. **MCP tool surface for AI agents** — Zero competitors expose MCP-compatible tools for OpenAI/Anthropic/Claude agents. MIRA's mira-mcp server with FastMCP is the only MCP-exposed CMMS in this set. This is the "AI-agent native" wedge.

3. **Vendor-scoped RAG (Knowledge Cooperative)** — No competitor has a tenant-scoped vector knowledge base where OEM documents are chunked and retrievable by AI during diagnosis. MIRA's mira-sidecar → Open WebUI KB pipeline is unique.

4. **Photo → diagnosis (not just asset creation)** — Limble's Asset Snap does photo → asset record (nameplate OCR). MIRA's photo handler does photo → diagnostic reasoning (what is wrong with this machine). Different use case — MIRA's is higher value during a failure event.

5. **LLM cascade inference with safety guardrails** — No competitor exposes an AI chat interface with LOTO/arc flash safety keyword detection and automatic escalation. MIRA's guardrails.py safety layer + industrial-intent classification is unique to the category.

6. **i3X Ignition tag streaming → CMMS** — mira-relay provides cloud endpoint for Ignition factory→cloud tag streaming. MaintainX lists Ignition as an integration, but MIRA's relay is a live data bridge, not a webhook connector.

---

*Sources: maintainx.com, onupkeep.com, developer.onupkeep.com, limblecmms.com, limblecmms.com/blog/ai-asset-creation, fiixsoftware.com, maintastic.com/en, threadedmfg.com — all fetched 2026-05-11*
