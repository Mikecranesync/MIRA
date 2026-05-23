# "Twilio of Industry 4.0" — Reality Check vs Fuuz, and What MIRA Hub Has to Become

> Evidence-based analysis of Fuuz's plug-and-play onboarding (from 11 transcripts + repos + skill docs) versus Mike's vision of MIRA Hub as **"the Twilio of Industry 4.0."** What Fuuz actually delivers, what they don't, where the gap is for MIRA to lean into, and what 30/60/90 days of execution looks like.
>
> Last refreshed: 2026-05-20. Companion to [fuuz-video-analysis.md](../videos/fuuz-video-analysis.md), [fuuz-repo-analysis.md](../repos/fuuz-repo-analysis.md), [mira-fuuz-skill-adaptation-plan.md](mira-fuuz-skill-adaptation-plan.md).

---

## TL;DR for Mike

1. **Fuuz is NOT a "Twilio of Industry 4.0."** They are closer to a *Heroku for industrial apps* — a platform you build apps on, with batteries-included infrastructure, but **measured in months-to-deploy, not minutes-to-first-event**. Their fastest claimed implementation was 8–10 weeks (Webinar `[55:00]`). The "Twilio gap" is real and **the wedge is open**.
2. **Fuuz's plug-and-play piece is the Gateway**, not the platform. Single Linux/Windows installer, 13 device driver types (Modbus, MQTT, OPC-UA, EtherNet/IP, Sparkplug B, SQL, HTTP, File, TCP, …), built-in store-and-forward, connects to Ignition via a Sepasoft-style module or direct OPC-UA. This is the **one piece** that genuinely behaves like a plug-and-play primitive. MIRA needs an equivalent.
3. **Fuuz's "fast" is really partner-network fast.** Their playbook: ship templated apps (MES / WMS / OEE) + cloud connector catalog + on-prem Gateway → empower a partner network (Razor Leaf, Strategic Information Group, PWC, etc.) to deploy them. The platform is fast *for partners*; not yet self-serve for end-customers.
4. **Twilio's actual analog is `pip install fuuz` → POST to an endpoint → see your event in 5 minutes.** Fuuz has the *capability* (gateway + API + connectors) but does not market or package it that way. MIRA can.
5. **MIRA's wedge:** be the first to deliver an actual `connect → see data → ask a question → get a grounded answer` flow in **under 30 minutes for the maintenance manager** (not the IT integrator). Fuuz, Tulip, HighByte all sell to engineers; nobody sells to the maintenance manager.

---

## ① What does Fuuz's onboarding actually look like? (evidence-based)

### What we have direct evidence for

**Customer journey (composite from 4 customer-facing transcripts + repos):**

1. **Discovery / qualification.** Customer reaches out (`support.fuuz.com`) or comes via partner. Sales conversation: "what's the problem?" — Craig explicitly says they refuse to start with "we need an MES" (AI-Native `[55:30]`): *"They'll come and they'll say, 'Hey, we need an MES.' And then we start to peel the layers of that onion back. We say, 'Why?'"*
2. **Tenant provisioning.** Customer gets a Fuuz tenant (its own database — see Pattern P-10). Three environments come standard: **Build / QA / Production** (AI-Native `[51:30]`). Customer also has **Administration**, **Application Development**, **Application**, **Custom**, **Integration** tenant *types* available (fuuz-platform/SKILL.md).
3. **Gateway install (if on-prem connectivity needed).** Customer downloads the Fuuz Gateway, runs it on Windows or Linux (AI-Native `[51:00]`). The Gateway has:
   - **13 device driver types:** File, HTTP, Modbus, MQTT, MQTT Sparkplug, OPC-UA, PCCC PLC, PLC (EtherNet/IP), Printer, Remote System Call, Server, SQL, TCP.
   - **19 specific drivers** including Ethernet/IP PLC, Modbus TCP, MQTT Client, OPC UA Client, Microsoft SQL, MySQL, Oracle DB, IBM DB2, SAP RFC, Native Printer, TCP Printer.
   - **10 subscription types** with built-in store-and-forward: File System Change, HTTP POST Endpoint, Modbus Values, MQTT Topics, Node Values, Tag Values, …
   - **6 gateway functions** for management: Apply Updates, Get Driver Devices, Get Gateway Status, List Log Files, Ping Hosts, Read Log File.
4. **Package import.** Customer (or partner) imports pre-built Fuuz packages — MES, WMS, OEE templates, or custom. UI: Application Designer → Import. Same way ProveIt!'s three packages get installed (proveit2026 README).
5. **Connector configuration.** UI: Configuration → Connectors → pick from 44 pre-built (Plex, NetSuite, SAP, Dynamics 365, Salesforce, Snowflake, AWS/GCP/Azure, OpenAI, …). Customer adds credentials. Then `integrateV2` nodes in flows reference the connector.
6. **Data ingest starts.** Gateway subscribes to PLC/SCADA/historian topics → publishes to internal Fuuz UNS → persisted to data models → screens light up.
7. **Customization.** Either DIY in the App Designer (low-code), or a partner builds the last mile. Craig: *"We've solved a lot of the harder challenges within those apps like MES and WMS so that they don't have to worry about that and we give them that ability to take it the last mile and really tailor it to their specific needs."* (Strategic Insights `[08:00]`)
8. **Promotion.** Build → QA → Production via the platform's deployment pipeline. Versioned, rollback-able. (AI-Native `[51:30]–[52:00]`)
9. **Ongoing.** Fuuz patches the platform itself — no customer reimplementation needed. (Matrix Ep10 `[38:00]`)

### Concrete time-to-value evidence

| Source | Claim | Direct quote |
|---|---|---|
| Webinar `[55:00]` | **"8 to 10 week implementation"** for a Plex-paired customer | *"so we got them up and running very quick"* (MPI deal) |
| Matrix Ep1 `[13:30]` | **"It's months and it's usually a couple of months maybe six months sometimes even longer"** | Direct |
| Episode 6 `[15:30]–[45:30]` | **2–3 weeks part-time** for the entire ProveIt! 2026 build (Craig + Claude solo, no other engineers) | *"This whole entire application came together very quickly over the course of a couple weeks."* |
| Webinar `[33:30]` | After learning the platform, work is **"in minutes not in days"** | *"yeah kind of that comment of the uh in minutes not in in days or whatnot anymore now that now the team really is familiar with the structure"* |
| AI-Native `[18:00]` | Build a GraphQL API on top of a Fuuz data model in **"less than five minutes"** | *"I could even show you right now how to just go in and build your own GraphQL API. It takes less than five minutes."* |

**Honest reading:** Fuuz's "minutes" is *inside the platform, after you know it.* Fuuz's "weeks" is the **whole customer onboarding**. There is no public evidence Fuuz delivers under-an-hour time-to-first-event for a brand-new customer connecting their first PLC.

### What requires professional services vs self-serve

**Self-serve (per the docs + transcripts):**
- Sign up / get a tenant
- Download + install the Gateway
- Configure connectors via the Configuration UI
- Import a pre-built package (App Designer → Import)
- Tweak screens / flows in the low-code App Designer
- Run in Build, promote to QA / Production

**Professional services / partner-led (explicit):**
- Initial application architecture for non-trivial workflows (Strategic Insights `[08:00]`: *"we go to the market with some templated applications that are pre-built that help our customers get up and running a lot faster"* → templates are the "self-serve" floor; partners do the rest)
- Cross-system integration design (Matrix Ep1 `[17:00]`: *"the partners are key to our growth strategy… razor leaf and strategic and PWC… deploy fuse in those various environments"*)
- Change management (Matrix Ep9 `[24:00]–[30:00]`: extensive discussion of how MES deployments live or die on change management — implicitly partner-led)
- Industry verticalization (Matrix Ep1 `[17:30]`: *"medical validation… aerospace, defense"*)

**The honest summary:** Fuuz's *infrastructure* (gateway, tenant, connectors, packages) is self-serve. Fuuz's *applications* are typically partner-led. This is **NOT** Twilio — Twilio's whole product is "POST → SMS" with no integrator in the loop.

---

## ② What "Twilio of Industry 4.0" means concretely

### What Twilio actually does

The Twilio 5-minute experience (canonical, ~2010 onward):

```python
# 1. pip install twilio
# 2. Sign up, get a free trial number + auth token
# 3. Run this:
from twilio.rest import Client
client = Client(account_sid, auth_token)
client.messages.create(to='+1234567890', from_='+1trial', body='Hello')
# 4. Phone rings 2 seconds later.
```

**Properties of that experience:**
- **Single-binary install** — `pip install twilio`. No infrastructure.
- **Self-serve signup** — free trial in under 60 seconds, no sales call.
- **One credential pair** — account_sid + auth_token. No OAuth dance.
- **One concept** — message. Not "data model + flow + screen + tenant."
- **Sub-5-minute first event.** Phone literally rings.
- **Pay-as-you-go pricing** — $0.0075/SMS. No "talk to sales."
- **Developer-first marketing.** Docs, code samples, Stack Overflow.
- **API quality is the product** — REST, well-documented, idempotent, retryable.

### Translated to Industry 4.0

A "Twilio of Industry 4.0" would let a maintenance engineer do this:

```python
# 1. pip install mira  (or curl install for the gateway)
# 2. Sign up at hub.factorylm.com — free trial tenant in 60 seconds
# 3. Plug in PLC IP + tag list (or upload a CSV):
import mira
m = mira.Client(tenant_token='...')
m.gateway.connect_plc(
    name='press_42',
    protocol='modbus_tcp',
    address='192.168.1.100',
    tags=['hr0', 'hr1', 'coil0'],
    uns_path='enterprise/charlie/press/press_42',
)
# 4. 30 seconds later, see live tag values in Hub UI.
# 5. Ask MIRA a question:
print(m.ask('what's the current state of press 42?'))
# → "press_42 is in production, HR0=1750 rpm, has been running 47 minutes,
#    last alarm 2 hours ago (motor amps warning, cleared after 8 min)."
```

**The five properties Twilio nails that Fuuz doesn't (yet):**
1. **No sales call.** Self-serve signup → working code in 5 minutes.
2. **Single primitive.** Twilio: "message." MIRA-version: "tag" or "grounded question."
3. **Pay-as-you-go pricing.** Per-tag-per-month, per-question, per-component-template.
4. **Developer-first docs.** Not just videos and partner case studies.
5. **First-event SLA is sub-5-minutes**, not sub-3-months.

### Where Fuuz is close (be fair)

- **Pre-built connectors:** 44 cloud + 19 device drivers cover most of what a customer needs. Twilio-equivalent ✅.
- **Pre-built templates:** MES / WMS / OEE / IIoT packages exist. Twilio-equivalent ✅.
- **Cloud SaaS, multi-tenant:** Tenant provisioning is fast. ✅.
- **Documentation depth:** 43k lines of skill content publicly. ✅ (developer-first).
- **API:** Application + System GraphQL APIs exist. ✅.

### Where Fuuz is far

- **No public "free tier signup" CTA visible.** Customer journey starts with a sales conversation (`support.fuuz.com` ticket per Episode 6 `[57:30]`).
- **No "first event in 5 minutes" demo path.** Their primary demo is the App Designer + months-long deployment.
- **No `pip install fuuz` SDK.** Connectors are configured in UI; flows are JSON.
- **No published pricing.** UNCONFIRMED whether public; the LNS analyst writeup and Tech-Clarity coverage don't surface a price.
- **Partner-network-dependent.** Fast for partners; opaque for end-customers.

---

## ③ What MIRA Hub has to become to deliver this

Three concrete shapes Hub needs that it doesn't have today:

### Hub-as-control-plane (provisioning + identity)

The thing every customer hits first. Today MIRA Hub exists (`mira-hub` at `app.factorylm.com`) per memory. **What's there vs what's needed:**

| Need | Status today | What to add |
|---|---|---|
| Self-serve signup → tenant in 60s | Partial (Stripe activation flow exists per memory) | Tenant DB row + KG-namespace + API key + Slack workspace auto-link |
| API key issuance (per tenant) | UNCONFIRMED | Public token issuance with scope + rotation |
| Tenant configuration UI | Partial | First-run wizard: name, ISA-95 plant root, default UoM, time zone |
| Multi-environment (dev/staging/prod tenants) | Tenants share the doctrine but not the product UI | Mirror Fuuz: each customer gets Build / QA / Prod tenant, promotable via Hub |
| Pricing / metering | Partial (Stripe + activation per memory) | Per-tag, per-question, per-asset meters published per tenant |

### Hub-as-data-plane (the gateway + connectors)

The piece that does the actual *plug-in*. MIRA's current state:
- `mira-relay` exists (cloud relay for Ignition factory→cloud tag streaming).
- `mira-connect` exists but is **deferred** (per root CLAUDE.md: post-MVP, "Config 4").
- No public Gateway binary, no signup-to-PLC flow.

**What to build (ordered):**
1. **MIRA Gateway v1** — single binary or Docker image. Modes: Ignition (already started in `mira-relay`), MQTT subscriber (generic), OPC-UA client, CSV upload (manual mode).
2. **Connector catalog** with credentials UI. Start narrow: Ignition + MaintainX + Atlas + CSV upload. Add Modbus TCP, generic MQTT, OPC-UA in the 30-day window.
3. **UNS auto-mapping** — when a tag stream lands, propose a UNS path automatically (using `uns_resolver`), let the user confirm/correct in Hub UI. This is the **MIRA-unique value-add** versus Fuuz: their gateway publishes; ours publishes *and* proposes structure.
4. **Store-and-forward** in the gateway (Fuuz has this built-in; MIRA needs it for connectivity drops).

### Hub-as-conversation (the grounded-answer surface)

The thing that turns "tags flowing" into "MIRA answered a question." Already MIRA's strongest layer:
- `mira-bots/shared/engine.py` — the supervisor
- `mira-mcp` — the MCP server, ready for Hub to consume
- UNS confirmation gate — uniquely MIRA's

**What to add for the Twilio experience:**
1. **API endpoint:** `POST /v1/ask` — body `{tenant_id, question}`, returns `{answer, citations[], confidence_band, ungrounded: bool}`. (Today this lives in Slack only; expose as REST + Python SDK.)
2. **First-question-from-empty-state** — when a tenant has 0 manuals, 0 work orders, 0 verified KG entries, the bot should still answer using whatever tags + UNS structure are present, and **explicitly tell the user what's missing**: "I can see press_42 is in production but I don't have a manual for it — upload one and I can give you grounded troubleshooting." (This is the killer demo.)

---

## ④ Minimum viable onboarding flow (the "Twilio for MIRA" demo)

The flow MIRA needs to ship to credibly claim the wedge:

```
Step 1 — Signup (60s)
  User: visits hub.factorylm.com → "Start free trial" → email + company
  Hub: creates tenant, NeonDB row, Slack workspace link, API key
  Email: "your tenant is mira-mfg-12345.hub.factorylm.com"

Step 2 — Pick a path (60s)
  User sees 4 options:
  ┌─────────────────────────────────────────────────────────────┐
  │ How do you want to connect?                                 │
  │                                                              │
  │ [ I have Ignition ]      → install MIRA Ignition module     │
  │ [ I have MQTT/UNS ]      → install MIRA Gateway as MQTT sub │
  │ [ I have a CMMS only ]   → install Atlas/MaintainX/Limble   │
  │                                                              │
  │ Or: [ Just upload data ] → CSV / Excel / manual entry       │
  └─────────────────────────────────────────────────────────────┘

Step 3 — Install + connect (5-15min)
  Path A (Ignition): copy/paste a single command — installs the module,
    auto-discovers tags, pushes to MIRA cloud.
  Path B (MQTT): download mira-gateway binary, run with --broker $HOST,
    wildcards auto-subscribed.
  Path C (CMMS): OAuth into MaintainX/Atlas → MIRA pulls work-order
    history, asset registry, manuals.
  Path D (CSV): drag-drop a CSV — column-mapper UI proposes UNS path.

Step 4 — UNS hydrate (auto, 30-60s)
  MIRA scans the data: vendor heuristics + tag-naming + asset codes.
  Proposes a UNS tree:
    enterprise/
    └── customer-abc/
        ├── site-1/
        │   └── press-42 (← Allen-Bradley PowerFlex 525, confidence: high)
        │       ├── motor (← proposed component, confidence: med)
        │       └── tags: hr0, hr1, coil0
        └── unknown/
            └── tag-stream-42 (← unmapped, confidence: low — needs human)
  User confirms or corrects in the Hub UI.

Step 5 — Ask MIRA a question (10s)
  User opens Slack (or Hub chat) — types:
    "what's the current state of press 42?"
  MIRA:
    1. UNS confirmation gate fires: "Is this customer-abc/site-1/press-42?"
    2. User: "yes"
    3. MIRA: "press-42 is in production, HR0=1750 rpm. I see no work-order
       history for this asset yet — upload your last 6 months of WOs from
       MaintainX/Atlas and I can give you reliability and MTBF context.
       I also see no manual — upload the PowerFlex 525 manual and I can
       cite specific fault codes."

Step 6 — Upload one document (60s)
  User drops the PowerFlex 525 PDF.
  MIRA ingests via mira-crawler/ingest, chunks, citations registered.

Step 7 — Re-ask with grounding (10s)
  User: "F0004 fault — what does it mean?"
  MIRA: "F0004 = Motor Overload (PowerFlex 525 User Manual, p. 47).
    For your press-42, this asset has run 47 min in the last hour with
    HR0 trending up by 12% — consistent with motor strain.
    Recommended steps:
      1. Check ambient temperature (manual p. 47)
      2. Verify cooling fan operation (manual p. 51)
      3. Review motor sizing for current duty cycle"

Total wall-clock: ~7-10 minutes from "open browser" to "grounded answer cited from a manual the user uploaded 60 seconds ago."
```

This is **literally Twilio's "send your first SMS" flow** translated to industrial maintenance. Every step has a Fuuz analog, except step 5–7 — **the grounded-answer step is MIRA's, not Fuuz's**.

---

## ⑤ What infrastructure MIRA needs that it doesn't have yet

| Layer | Status | Needed | Source/note |
|---|---|---|---|
| Hub signup → tenant provisioning | Partial (Stripe activation) | Public CTA, 60s flow, API key issuance | mira-web exists; memory says Stripe + activation flow active |
| Public API (`POST /v1/ask`) | Internal-only (Slack) | REST + SDK + docs at docs.factorylm.com | New |
| Python SDK (`pip install mira`) | None | New | One sprint to build a thin wrapper over the REST API |
| MIRA Gateway (downloadable binary) | `mira-relay` (Ignition only) | Extend to MQTT generic + OPC-UA + Modbus TCP | `mira-connect` is deferred — promote |
| Connector catalog UI | None visible | Hub page: list connectors, click to configure, status badges | Borrow Fuuz's UI shape from connectors-reference.md |
| UNS auto-mapping wizard | `uns_resolver` exists | Hub UI wraps it: tag/CSV in → tree-view proposal out → confirm | KG already has the schema |
| CSV upload + column-mapper | None visible | First-run experience for "no PLC, no SCADA, no UNS" customers | Smallest possible MVP for non-OT shops |
| Free-tier metering | Partial (Stripe) | Per-tag-month, per-question, per-asset | Need: emit metering events from gateway + bot |
| "first-question SLA" instrumentation | None | Time-from-signup-to-first-grounded-answer (per tenant) — track in NeonDB | The metric that will tell us if we deliver the wedge |
| Documentation site | `wiki/` (internal) | Public docs.factorylm.com with code samples + 5-min quickstart | Like Twilio's docs |

---

## ⑥ What's realistic in 30 / 60 / 90 days

### 30 days — Land the "signup → first question" path

**Goal:** A maintenance manager can sign up at hub.factorylm.com → upload one PDF (a manual or work-order CSV) → ask a question in Slack or the Hub chat → get a grounded, cited answer. **No PLC integration yet.**

**Why:** Targets the largest possible ICP (maintenance teams with no SCADA or UNS — every small/mid manufacturer). Uses MIRA's existing strengths (engine.py, KG, manual ingest, slack-technician-ux-writer). No new edge-gateway work needed.

**Deliverables:**
- [ ] Hub signup page CTA + 60s tenant provisioning (Stripe + NeonDB tenant row + API key)
- [ ] Hub chat UI for grounded Q&A (alternative to Slack — many teams won't onboard Slack-first)
- [ ] CSV upload for work orders + assets
- [ ] PDF upload for manuals (`mira-crawler/ingest` already does this — wire to Hub UI)
- [ ] First-question SLA instrumentation (NeonDB column on `tenants` → `first_answer_at`)
- [ ] Public quickstart at docs.factorylm.com with the 7-step flow above
- [ ] One Python SDK function: `mira.ask(question)` calling `POST /v1/ask`

### 60 days — Land the "Ignition tag stream → grounded answer" path

**Goal:** Customers who run Ignition can plug MIRA into their existing tag streams and get grounded answers that cite **live tag values** in addition to manuals.

**Why:** Ignition has the SCADA install base in MIRA's ICP. `mira-relay` already does the Ignition → cloud streaming.

**Deliverables:**
- [ ] Ignition module install path documented + tested
- [ ] UNS auto-mapping wizard: tag stream lands → proposed tree → user confirms
- [ ] Engine extension: grounded answers cite live tag values where relevant
- [ ] Hub: "live tag view" per component template (subscribed to `tenant.tags.*` per Pattern P-3 mini-UNS)
- [ ] One Ignition customer in pilot

### 90 days — Land the "MQTT/UNS-native + multi-CMMS" path

**Goal:** Customers who already publish to MQTT/UNS (HighByte, HiveMQ, custom Sparkplug B) can point MIRA at their broker; MIRA subscribes, hydrates UNS, grounds answers. Customers on MaintainX/Atlas/Limble can OAuth-connect; MIRA pulls WO history + asset registry.

**Why:** Covers the "we have an Industry-4.0-aware customer" segment + the "we already have a CMMS" segment.

**Deliverables:**
- [ ] MIRA Gateway binary (Docker + Linux), MQTT mode + Sparkplug B support
- [ ] OPC-UA mode (basic — read-only)
- [ ] MaintainX OAuth + WO pull (Nango integration per memory `project_nango.md`)
- [ ] Atlas connector (already present in `mira-cmms`)
- [ ] Limble + Fiix OAuth + pull (via Nango)
- [ ] Modbus TCP mode in gateway (cuts off the Twilio-easy long-tail of small shops)
- [ ] Connector catalog UI in Hub (status badges, last-sync time, error log)
- [ ] Public pricing posted

---

## ⑦ Competitive table for plug-and-play onboarding

| Capability | Fuuz | Tulip | HighByte | MaintainX | MIRA today | MIRA target (90d) |
|---|---|---|---|---|---|---|
| Self-serve signup, free trial | ❌ Sales-led | ✅ (frontline trial) | ❌ Sales-led | ✅ Mobile app | Partial | ✅ |
| Time to first event | weeks-months | days-weeks (app builds fast, integrations slow) | hours-days (modeling layer, no apps) | minutes (mobile WO entry) | UNCONFIRMED | **<10 min** |
| Single-binary gateway | ✅ Gateway (.exe / Linux) | ✅ Tulip Edge | ✅ Intelligence Hub | ❌ N/A | `mira-relay` (Ignition only) | ✅ MIRA Gateway |
| Device protocols out-of-box | 13 driver types, 19 drivers (Modbus / OPC-UA / EtherNet/IP / MQTT / Sparkplug / SQL / HTTP / TCP / Printer / File / PCCC) | OPC-UA, MQTT, HTTP, Node-RED-ish | OPC-UA, MQTT, Sparkplug B, REST, SQL (deep modeling layer) | N/A (CMMS only) | Ignition only | Modbus TCP, MQTT, OPC-UA, Sparkplug B (Ignition still primary) |
| Cloud connector catalog | 44 (Plex, SAP, NetSuite, Salesforce, Dynamics, Snowflake, GCP, AWS, OpenAI, …) | ~25 (estimated, app store) | ~20 (output adapters) | ~10 (Slack, MS Teams, ERP) | Atlas + MaintainX (planned via Nango) | + Limble, Fiix, Plex, SAP, NetSuite |
| Pre-built application templates | MES, WMS, OEE, Quality, CMMS, IIoT (proveit2026: 3 apps, 100 models, 73 screens, 94 flows) | Frontline ops apps (200+ in app store) | None (DataOps layer only) | CMMS is the app | None | Maintenance copilot app template per industry (food + bev, automotive, biopharma) |
| Public Python SDK | ❌ | Partial (REST API documented) | ❌ | ❌ | ❌ | ✅ `pip install mira` (90d) |
| First-question SLA | UNCONFIRMED | N/A (different surface) | N/A (different surface) | minutes (asks Cobalt about a WO) | UNCONFIRMED | **<10 min, tracked** |
| Public pricing | ❌ | Partial (per-seat published) | UNCONFIRMED | ✅ (per-seat) | Partial (Stripe) | ✅ Public per-tag + per-question |
| Grounded answers w/ citations | ❌ (skills generate apps, not answers) | Partial (Frontline AI; UNCONFIRMED grounding rigor) | ❌ (modeling layer, no NL) | Partial (CoPilot grounds in WO history; no UNS gate) | ✅ (uniquely MIRA) | ✅ (deepen) |
| UNS confirmation gate | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Multi-tenant SaaS | ✅ DB-per-tenant | ✅ | ✅ | ✅ | ✅ (single DB, row-level) | ✅ |

**The gap MIRA can credibly fill in 90 days:**
- Self-serve signup ✅
- Sub-10-min first-grounded-answer ✅
- CMMS-first connector path (target the customer with no SCADA) ✅
- Maintenance-manager UX (not engineer UX) ✅
- Slack-first OR Hub-first (customer chooses) ✅

**The gaps MIRA should NOT chase (out of scope):**
- 44-connector ERP catalog (Fuuz wins; we integrate via Nango as the lightweight competitor)
- 200+ frontline-ops apps (Tulip wins; we don't build apps)
- Sparkplug-B-native deep modeling (HighByte wins; we ground in their UNS instead)

---

## ⑧ What this means for the architecture roadmap

Three architectural decisions surface from this analysis that should land in [mira-architecture-decisions.md](mira-architecture-decisions.md):

### Decision: Promote `mira-connect` out of "deferred" status

The root CLAUDE.md classifies `mira-connect` as "deferred to Config 4 (post-MVP), not in MVP critical path." This analysis says **`mira-connect` IS the critical path for the Twilio wedge**. Specifically, the parts that are critical:
- MQTT subscriber (generic, no Sparkplug needed for v1)
- OPC-UA client (read-only v1)
- Modbus TCP (low-end shops)

Not critical for the wedge (can stay deferred): EtherNet/IP, PCCC, SQL, Printer drivers.

### Decision: Hub gets two new pages (signup + connector-catalog)

Hub today is the parent surface (per memory `project_hub_is_parent_surface.md`). Add:
- **Signup page** at `/start` — 60s flow per the spec
- **Connector catalog** at `/connect` — Fuuz-shape UI for picking + configuring sources

### Decision: Public API + Python SDK is mandatory, not optional

A "Twilio of Industry 4.0" without an SDK is not Twilio. The `POST /v1/ask` endpoint + `pip install mira` go in the 30-day window. Treat as P0.

---

## ⑨ Open questions to resolve before committing

- [ ] **Does the maintenance-manager ICP actually want a public Python SDK?** Twilio's customer is a developer. MIRA's customer is a maintenance manager — who maybe never opens a terminal. The SDK is for **integrators selling MIRA into their accounts** (the partner play). Test the assumption.
- [ ] **What's the no-SCADA / no-UNS minimum viable path?** Many small manufacturers have neither. CSV upload + manual entry covers them. Is that enough? Or do they need a "MIRA mobile app" for the technician to type into?
- [ ] **Per-tag vs per-question pricing?** Twilio is per-message. Fuuz is per-tenant. MIRA could be per-question (most aligned with value) or per-tag-stream (most aligned with cost). Pick one and publish it.
- [ ] **Slack-first OR Hub-first as default surface?** Today MIRA is Slack-first. The 30-day plan adds Hub chat. Some customers will prefer one or the other — but both is a maintenance burden.
- [ ] **Free-tier scope?** What's free forever (Twilio: free trial credit + paid). MIRA-version: free 10 questions/month? Free 1 component template? Free 50 KG entities?
- [ ] **Where does the gateway run for customers with no on-prem server?** Twilio doesn't have this problem. Industrial customers often do. Cloud-only mode (broker-to-broker MQTT in the cloud) is needed for the "we don't want another box" segment.

---

## Sources

- **Episode 6** (xKuq5FDomkg) — Craig's full ProveIt! 2026 build walkthrough
- **Webinar** (i0lj8quQsDM) — Craig + MPI customer story, ~57 min, "8-10 week implementation," "implementation vs installation" framing
- **AI-Native podcast** (F0oaVkVj2EQ) — Gai Manderza interview; explicit Gateway architecture quotes (`[50:30]–[52:00]`)
- **Matrix Ep1** (OaD5uQWDb7w) — Vision episode, partner-first strategy quotes
- **Matrix Ep9** (hCyaHB1AdAI) — MES deployment realities, change management, 66 min
- **Matrix Ep10** (Ac-9DOBdLTw) — SaaS / iPaaS thesis, multi-tenant arguments
- **Matrix Ep11** (8kbLLsEKj6c) — Build vs buy, "fuse already takes care of heavy lift"
- **Strategic Insights Ep33** (uxk3NkUEHsA) — Plant manager framing, "batteries included so there's no infrastructure"
- **Matrix Ep15** (wedPOmXexKg) — WMS specifics (relevant for Enterprise B onboarding)
- **Matrix Ep18** (Ow5es1zVFLU) — Scheduling specifics
- **Repo:** `fuuz-skills/fuuz-platform/SKILL.md` — Device Gateway: 13 driver types, 19 drivers, 10 subscription types, 6 gateway functions
- **Repo:** `fuuz-skills/fuuz-platform/references/connectors-reference.md` — 44 connector catalog with auth schemas
- **Repo:** `fuuz-skills/fuuz-platform/references/integration-landscape.md` — 500+ systems supported via 11 protocols
- **Repo:** `proveit2026/README.md` — 3-app demo (100 models, 73 screens, 94 flows in 2-3 weeks)

All transcripts saved under `videos/fuuz-transcripts/`. All cited quotes traceable to timestamps.

## Cross-reference

- Onboarding spec for MIRA → [`../../specs/mira-customer-onboarding-spec.md`](../../specs/mira-customer-onboarding-spec.md) (companion to this analysis)
- Architectural patterns from Fuuz → [`../architecture-patterns/fuuz-patterns.md`](../architecture-patterns/fuuz-patterns.md)
- UNS/MQTT patterns → [`../architecture-patterns/uns-mqtt-patterns.md`](../architecture-patterns/uns-mqtt-patterns.md)
- Top 10 lessons + action plan → [`mira-lessons-from-fuuz.md`](mira-lessons-from-fuuz.md)
- Proposed skill roster → [`mira-fuuz-skill-adaptation-plan.md`](mira-fuuz-skill-adaptation-plan.md)
- Fuuz company profile → [`../companies/fuuz.md`](../companies/fuuz.md)
