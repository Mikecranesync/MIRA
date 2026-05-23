# MIRA Customer Onboarding Spec — "Twilio for Maintenance Intelligence"

**Status:** DRAFT v0.1
**Owner:** TBD (Mike to assign)
**Last updated:** 2026-05-20
**Authored by:** claude-code, after Fuuz deep-dive
**Companion analysis:** [docs/research/industry4-intelligence/mira-lessons/mira-twilio-of-industry4-analysis.md](../research/industry4-intelligence/mira-lessons/mira-twilio-of-industry4-analysis.md)

> **Intent:** Specify the customer-facing onboarding experience MIRA Hub must deliver. North Star: a maintenance manager goes from "I heard about MIRA" to "MIRA gave me a grounded, cited answer about my equipment" **in under 30 minutes**, with **no sales call** required for the trial path.
>
> This spec is **inspired by Fuuz** (whose Gateway + connector + multi-tenant architecture we admire) but **native to MIRA**'s wedge (grounded maintenance copilot, not platform builder). Where this spec cites Fuuz, the citation is from public sources (transcripts + GitHub).

---

## Hard constraints (non-negotiable)

1. **No sales call required for the trial path.** Self-serve signup → working answer.
2. **Time-to-first-grounded-answer ≤ 30 minutes** for the CSV/manual-upload path. Aspire to ≤10 minutes for the seasoned-user CMMS-OAuth path.
3. **UNS confirmation gate remains in force** for every grounded answer. No exceptions.
4. **Grounded-by-default contract preserved.** First-answer messages may be honest about gaps ("I don't have manuals yet — upload one") but never invent.
5. **Public pricing, public API, public SDK.** Twilio's bar.
6. **Customer's environment is theirs.** Their UNS root, their PLC IPs, their work-order data — MIRA reads with consent, writes only to UNS topics they opt into.

---

## Personas + paths

### Persona A — "Plant Engineer with Ignition" (largest ICP overlap with Fuuz)

- Has: Ignition Gateway running, Sparkplug-B-ish UNS or flat tag library, basic CMMS (MaintainX or Atlas).
- Wants: Grounded answers about specific assets without leaving Slack.
- Path: Ignition module → MIRA streams tags → UNS auto-mapped → CMMS OAuth-linked → ask in Slack.
- TTV: **≤ 15 min**.

### Persona B — "Maintenance Manager, no SCADA" (largest ICP overlap with MaintainX)

- Has: A CMMS (MaintainX / Limble / Fiix / Atlas), a folder of PDF manuals.
- Wants: Tech in the field types a question, MIRA cites the manual + work-order history.
- Path: CMMS OAuth → MIRA pulls WO history + asset registry → upload 3-5 manuals → ask in Slack.
- TTV: **≤ 20 min** (depends on manual ingest time).

### Persona C — "Greenfield manufacturer, nothing connected" (smallest setup, hardest to land)

- Has: A spreadsheet of assets, technicians with phones, no CMMS.
- Wants: A starting point — "what does MIRA need to be useful?"
- Path: CSV upload of assets → CSV upload of last 90d work orders → upload 1 manual → ask in Slack or Hub chat.
- TTV: **≤ 30 min**.

### Persona D — "Integrator evaluating MIRA for a client" (the partner play, Fuuz's bread and butter)

- Has: A dev box, a Python REPL, no real factory.
- Wants: `pip install mira` → working API call → demo to their client.
- Path: API key from Hub → `mira.ingest_csv()` + `mira.ask()` against fake data.
- TTV: **≤ 5 min**. (This is the Twilio path. Critical for distribution.)

---

## The journey (step-by-step, both paths in one diagram)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 0 — DISCOVERY                                                     │
│  User: lands on factorylm.com or hub.factorylm.com                      │
│  CTA: "Start free trial — no credit card, 30-min setup"                 │
│  No sales-call wall.                                                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — SIGNUP (60s)                                                  │
│  Email + company name + (optional) Slack workspace OAuth                │
│  Hub creates:                                                           │
│    - tenant row in NeonDB                                               │
│    - tenant-scoped API key (cust_xxxxxx)                                │
│    - KG namespace (kg_entities.tenant_id = ...)                         │
│    - mira-bot-slack workspace install (if Slack OAuth)                  │
│    - empty UNS root `enterprise.{company-slug}` (per uns_resolver)      │
│  Returns: hub.factorylm.com/t/{tenant-id} dashboard                     │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — PICK A PATH (60s)                                             │
│  Hub asks: "How do you want to give MIRA context about your plant?"     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ I have Ignition       → install MIRA Ignition module            │    │
│  │ I have a CMMS         → OAuth into MaintainX / Atlas / Limble   │    │
│  │ I have MQTT / Sparkplug → install MIRA Gateway as subscriber    │    │
│  │ I have PLCs (Modbus / OPC-UA) → install MIRA Gateway            │    │
│  │ Just upload data      → CSV / Excel / PDF manuals               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Multiple paths are OK — user can do CSV + CMMS today, add Ignition     │
│  next week.                                                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — CONNECT (varies)                                              │
│                                                                         │
│  CSV upload (5 min):                                                    │
│    Drag-drop assets.csv → column-mapper UI →                            │
│    auto-detect [manufacturer, model, asset_tag, location] →             │
│    user confirms → rows land in kg_entities (status=proposed,           │
│    evidence=csv-upload).                                                │
│                                                                         │
│  Manual ingest (5-15 min per PDF):                                      │
│    Drag-drop PDF → mira-crawler/ingest pipeline →                       │
│    chunks + citations + UNS-tagging →                                   │
│    progress bar in Hub UI.                                              │
│                                                                         │
│  CMMS OAuth (2 min):                                                    │
│    User clicks "Connect MaintainX" → OAuth dance (via Nango) →          │
│    Hub kicks off background sync → assets + last 90d WO history →       │
│    landed in cmms_* + kg_entities.                                      │
│                                                                         │
│  Ignition module (10 min):                                              │
│    Copy command → run on Ignition gateway → installs MIRA module →      │
│    UI in Ignition prompts for tenant API key →                          │
│    tags start streaming via mira-relay.                                 │
│                                                                         │
│  MIRA Gateway (15-30 min):                                              │
│    Download binary or `docker run factorylm/mira-gateway` →             │
│    config wizard: tenant API key + protocol + endpoint →                │
│    auto-subscribes, ships to mira-relay endpoint.                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4 — UNS HYDRATE (background, 30-120s)                             │
│  MIRA runs uns_resolver on the incoming data:                           │
│    - vendor / model / fault-code heuristics                             │
│    - PLC tag-naming patterns                                            │
│    - CMMS asset-registry mappings                                       │
│    - manual-extracted equipment references                              │
│  Proposes a UNS tree, status=proposed.                                  │
│  Hub UI renders the tree:                                               │
│                                                                         │
│      enterprise.acme.                                                   │
│      ├── site-1.                                                        │
│      │   ├── press_42  ◇ Allen-Bradley PowerFlex 525  (high)            │
│      │   │   ├── motor  ◇ proposed component  (med)                     │
│      │   │   └── tags: hr0, hr1, coil0                                  │
│      │   └── line_a.                                                    │
│      │       └── conveyor_3  ◇ unmapped CSV row  (low)  [needs human]   │
│      └── unknown.                                                       │
│          └── tag-stream-42  ◇ unmapped MQTT topic  (low)  [needs human] │
│                                                                         │
│  User confirms / corrects. Confirmed nodes → promotion_state=verified.  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 5 — ASK MIRA A QUESTION (10s)                                     │
│  In Slack (preferred) or Hub chat (fallback):                           │
│    "what's wrong with press 42?"                                        │
│                                                                         │
│  MIRA's gate:                                                           │
│    1. UNS confirmation: "Is this `acme.site-1.press_42`? (Allen-Bradley │
│        PowerFlex 525)"                                                  │
│    2. User: "yes"                                                       │
│                                                                         │
│  MIRA reads:                                                            │
│    - kg_entities → asset metadata                                       │
│    - kg_relationships → manufacturer, model, related components        │
│    - cmms_workorders → last 90d for this asset (if CMMS connected)      │
│    - tags table → live values (if Gateway/Ignition connected)           │
│    - manual_chunks → cited content (if manuals uploaded)                │
│    - Citation compliance + groundedness scoring                         │
│                                                                         │
│  MIRA answers:                                                          │
│    "press_42 (Allen-Bradley PowerFlex 525, location: acme.site-1) —     │
│     status: production, HR0=1750 rpm, has been running 47 min.          │
│     Recent history: 2 work orders in the last 30 days, last one a       │
│     motor-amps warning that cleared after 8 min.                        │
│                                                                         │
│     I don't yet see a manual for this asset — if you upload the         │
│     PowerFlex 525 User Manual I can cite specific fault codes and       │
│     troubleshooting steps.                                              │
│                                                                         │
│     If you want, I can also pull more work-order history from           │
│     MaintainX (currently I have the last 30 days)."                     │
│                                                                         │
│  Hub records: tenant.first_answer_at = now()                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Connectors MIRA needs (priority-ordered)

### Tier 1 (must ship in 30-90d)

| Connector | Type | Effort | Why now |
|---|---|---|---|
| **CSV upload (assets + work orders)** | Hub UI | S | Greenfield ICP path; no infra needed |
| **PDF manual upload** | Hub UI (wraps mira-crawler/ingest) | S | Already mostly built |
| **MaintainX OAuth** | Nango pre-built (per `project_nango.md` memory) | M | CMMS-first persona; #1 threat is MaintainX itself |
| **Atlas CMMS** | Internal (`mira-cmms`) | S | Atlas is our own CMMS — first-class |
| **Slack workspace install** | OAuth | S | Already shipped |
| **Ignition module** | Java module → mira-relay | M | Largest SCADA install base; mira-relay is already most of this |

### Tier 2 (60-120d)

| Connector | Type | Effort | Why |
|---|---|---|---|
| **MIRA Gateway — MQTT subscriber** | Single binary | M | UNS-native customers; Sparkplug B optional v1 |
| **MIRA Gateway — OPC-UA client (read-only)** | Gateway driver | M | Wide PLC coverage |
| **MIRA Gateway — Modbus TCP** | Gateway driver | S | Low-end shops; very common |
| **Limble CMMS** | Nango | S | Largest non-MaintainX competitor in SMB CMMS |
| **Fiix CMMS** | Nango | S | Enterprise CMMS option |

### Tier 3 (when demanded)

| Connector | Why deferred |
|---|---|
| **EtherNet/IP** (Allen-Bradley native) | OPC-UA covers most use cases |
| **PCCC PLC** (legacy AB) | Niche; only for legacy customers |
| **Sparkplug B publisher** (MIRA writes to customer UNS) | Pattern P-12 / U-5 — important but not critical-path |
| **NetSuite / Plex / SAP / Salesforce** | Out of scope — let Fuuz win these |
| **OEE-engine-style live dashboards** | Out of scope — let MES vendors win these |

> **Reference for what NOT to chase:** [Fuuz's 44-connector catalog](../research/industry4-intelligence/repos/fuuz-repo-analysis.md#fuuz-platform--the-most-portable-skill) covers SAP, Plex, Oracle, Dynamics, NetSuite, Salesforce, Snowflake, AWS Lambda, ADP, UPS, FedEx, etc. **MIRA does not need any of these**. Our customer is the maintenance team; the ERP/CRM connectors are for a different product.

---

## How data flows: customer site → MIRA namespace

```
                          ┌───────────────────────┐
                          │  Customer's plant      │
                          │                        │
   PLCs ─── Modbus ─┐     │  ┌────────────────┐    │     ┌────────────────────┐
                    │     │  │                │    │     │   MIRA Cloud       │
   SCADA ─── OPC-UA ─┼──► │  │ MIRA Gateway   │ ───┼──►  │                    │
                    │     │  │ (binary/docker)│    │ HTTPS│ mira-relay        │
   Sparkplug B ────┘     │  │ ─ store-and-fwd│    │     │ (tag ingest)      │
                          │  │ ─ buffers off  │    │     │                    │
   Ignition Gateway ─────►│  │   line         │    │     │ ┌────────────────┐ │
                          │  └────────────────┘    │     │ │ mira-crawler   │ │
                          │                        │     │ │ /ingest        │ │
                          │  Or: skip the gateway  │     │ │ ─ chunks       │ │
                          │  if customer pushes    │     │ │ ─ citations    │ │
                          │  to a cloud broker     │     │ │ ─ KG proposals │ │
                          │  directly              │     │ └────────┬───────┘ │
                          │                        │     │          │         │
                          │                        │     │ ┌────────▼───────┐ │
   CMMS (MaintainX/       │                        │     │ │ NeonDB:        │ │
   Atlas/Limble) ─OAuth──►│                        │ ───►│ │ ─ kg_entities  │ │
                          │                        │     │ │ ─ kg_relations │ │
   PDF manuals ──drag-drop─┴───────────────────────┴───►│ │ ─ cmms_*       │ │
   CSV uploads                                          │ │ ─ tags         │ │
                                                        │ │ ─ tenants      │ │
                                                        │ └────────┬───────┘ │
                                                        │          │         │
                                                        │ ┌────────▼───────┐ │
                                                        │ │ mira-mcp       │ │
                                                        │ │ + engine       │ │
                                                        │ │ + UNS gate     │ │
                                                        │ └────────┬───────┘ │
                                                        │          │         │
                                                        │ ┌────────▼───────┐ │
                                                        │ │ POST /v1/ask   │ │ ◄── Python SDK
                                                        │ │ Slack bot      │ │ ◄── Slack
                                                        │ │ Hub chat       │ │ ◄── browser
                                                        │ └────────────────┘ │
                                                        └────────────────────┘
```

**Properties:**
- **Customer keeps their data on their site by default.** Gateway store-and-forward means MIRA only sees data the customer explicitly streams.
- **MIRA's NeonDB is multi-tenant, single-DB, row-isolated by `tenant_id`.** (Different from Fuuz's DB-per-tenant — see [data-modeling-patterns.md](../research/industry4-intelligence/architecture-patterns/data-modeling-patterns.md) Pattern P-10. Document the trade-off.)
- **UNS hydrates incrementally.** Customer doesn't have to "design their UNS" upfront — every uploaded asset / PLC tag / WO contributes; user confirms in Hub UI.
- **Manual mode (no gateway) is first-class.** CSV + PDF gets a customer to a grounded answer without infrastructure.

---

## Auto vs manual UNS population

| Source | Auto-proposes UNS path? | How |
|---|---|---|
| Manual PDF (manufacturer + model in text) | ✅ Auto | `uns_resolver.resolve_uns_path()` per spec |
| PLC tag stream (vendor in tag name) | ✅ Auto | Tag-naming heuristics |
| CMMS asset registry (asset code + location) | ✅ Auto | Asset-code → manufacturer/model lookup if `external_refs` rich |
| CSV upload of assets | Partial | Column-mapper UI proposes mapping; user confirms |
| MQTT topic name | ✅ Auto if ISA-95 shaped | `enterprise/{site}/{area}/...` → direct mapping |
| Raw tag with no metadata | ❌ Manual | Lands under `enterprise.{tenant}.unknown.*` — Hub UI flags |
| Ignition tag provider | ✅ Auto | Ignition's own ISA-95 hierarchy maps 1:1 |

**Rule (per `uns-compliance.md` UC-2):** every UNS proposal hits the `kg_entities` table as `promotion_state=proposed`. A human promotes to `verified`. No autonomous verification, ever (Pattern A-3 anti-hallucination).

---

## How MIRA delivers value *before* full UNS setup

Critical for the 30-min demo. Customer hasn't mapped their UNS yet. What value can MIRA give?

1. **Manual citations work standalone.** If user uploads the PowerFlex 525 manual and asks about an F0004 fault, MIRA can cite the manual page **without any UNS context**. (UNS gate fires; user says "I don't have a specific asset, just the manual" → MIRA answers in "general-knowledge with citation" mode.)
2. **CMMS-only mode.** If only CMMS is connected, MIRA can answer "show me this week's open work orders" and "what's the MTBF on press 42 based on last 90 days?" using `cmms_*` tables alone.
3. **Single-tag answer.** If only one PLC tag is streaming, MIRA can answer "what's the current value of HR0?" — trivial, but immediate. User feels the platform is real.
4. **Honest gap-acknowledgment.** When MIRA can't answer something due to missing context, it tells the user what to add: *"Upload the PowerFlex 525 manual and I can give you grounded F0004 troubleshooting."* This is **better UX than a long setup wizard** — the bot teaches the customer what to do next.

> **MIRA's unique pattern:** the bot ACKNOWLEDGES its own gaps and tells the user what to upload. Fuuz doesn't do this — Fuuz expects the engineer to know what data to load. MIRA grades the data and asks for what's missing. This is the "self-onboarding via conversation" pattern, and **no competitor surfaces it**.

---

## Self-service vs. integrator-led (where each persona lands)

| Operation | Maintenance Manager (Persona B) | Plant Engineer (A) | Integrator (D) | Greenfield (C) |
|---|---|---|---|---|
| Signup | Self | Self | Self | Self |
| CSV upload | Self | Self | Self (via SDK) | Self |
| PDF manual upload | Self | Self | Self | Self |
| CMMS OAuth | Self | Self | Self | N/A |
| Slack install | Self | Self | Self | Self |
| Ignition module install | **Engineer** | Self | **Integrator** | N/A |
| MIRA Gateway install | **Engineer / IT** | Self | **Integrator** | N/A |
| OPC-UA endpoint discovery | **Engineer / IT** | Self | **Integrator** | N/A |
| Sparkplug B configuration | **Engineer / IT** | Engineer | **Integrator** | N/A |
| UNS tree confirmation | Self (with hand-holding) | Self | Self | Self |
| Asking grounded questions | Self | Self | Self (via SDK) | Self |
| Bulk verification of KG proposals | **Engineer** | Engineer | **Integrator** | N/A |

**Rule of thumb:** anything in the *cloud* (CSV, PDF, CMMS OAuth, signup, asking questions) = self-serve by the maintenance manager. Anything on the *plant floor* (gateway, OPC-UA, Sparkplug, network config) = engineer / IT.

This is **different from Fuuz**, where the App Designer is the primary self-serve surface (low-code, but still engineer-flavored). MIRA's self-serve surface is **the chat itself + Hub upload pages**.

---

## MVP scope vs full vision

### MVP — 30-day milestone

The MVP is **Personas B + C** (CMMS / greenfield):

- Hub signup → tenant in 60s
- Hub upload pages: CSV (assets, WOs), PDF (manuals)
- MaintainX OAuth + Atlas + Slack
- UNS auto-hydrate (read-only proposed tree)
- POST /v1/ask + Python SDK
- Grounded-answer flow with citations (existing engine, exposed via REST + Hub chat UI)
- Public docs at docs.factorylm.com with a 5-step quickstart
- Per-tenant `first_answer_at` instrumentation in NeonDB

**No PLC connectivity in MVP.** That's Persona A and gets the next sprint.

### 60-day extension — Persona A

- Ignition module (extend `mira-relay`)
- UNS hydration from Ignition tag provider
- Live-tag citation in grounded answers
- Hub: "tags table" page per component template

### 90-day extension — Persona D + Tier-2

- `pip install mira` published to PyPI
- MIRA Gateway binary (Docker + Linux), MQTT + OPC-UA + Modbus TCP
- Limble + Fiix connectors
- Public pricing posted (per-question or per-tag)
- Connector catalog UI in Hub

### Full vision — Q3/Q4 2026

- Sparkplug B publish path (MIRA writes proposal-lifecycle events back to customer's UNS)
- "Show me the trace" admin view (Pattern P-9)
- Component application graph view (Pattern P-8)
- Per-industry templates (food & beverage, automotive, biopharma)
- Voice-to-question (Slack mobile / Hub mobile) — competes head-on with MaintainX CoPilot
- Mobile-first technician UI for the no-Slack customer

---

## Non-goals

Listed explicitly so we don't drift (per `mira-saas-scope-guard`):

- **NOT** an MES, WMS, APS, Quality module catalog. Fuuz / Tulip / Critical Manufacturing win these.
- **NOT** an ERP-connector empire. SAP / NetSuite / Plex connectors are Fuuz's lane.
- **NOT** an app builder / low-code platform. Fuuz / Tulip / Ignition Perspective win.
- **NOT** a SCADA replacement. Ignition wins.
- **NOT** a generic chatbot. Every reply is grounded or it doesn't ship.
- **NOT** an autonomous KG promoter. Verified ≠ proposed without a human. Ever.

---

## Success metrics

The metrics the Hub should track per-tenant (write columns on `tenants` or a `tenant_metrics` table):

| Metric | Target | Owner |
|---|---|---|
| Time from signup to first uploaded artifact | < 5 min | Hub UX |
| Time from signup to first grounded answer | **< 30 min** | Hub UX + engine |
| % of trial signups that hit "first grounded answer" | > 50% | Whole funnel |
| Day-7 retention (any second question asked) | > 30% | Engine quality |
| Day-30 retention (CMMS still synced) | > 60% | Hub + connector reliability |
| Hub→engine latency P95 | < 5s | Engine |
| Avg manuals uploaded per active tenant | > 3 | Onboarding nudges |
| Avg verified KG entities per active tenant | > 20 | Hub admin UX |
| First-answer ungrounded rate | < 10% | Engine + first-answer prompt |

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Customer's UNS doesn't match ISA-95 | High | Med | Tag-naming heuristics + manual UI mapping; gracefully degrade |
| Customer has no SCADA, no CMMS, no manuals | Med | Med | CSV-only path explicitly supported; "single-tag" demo |
| First-answer is ungrounded (no citations possible) | Med | High | Bot explicitly says "I don't have enough context — upload X" instead of refusing |
| Gateway install fails (firewall, etc.) | Med | Med | Cloud-only mode (broker-to-broker MQTT) as fallback |
| CMMS OAuth breaks | Med | High | Nango per memory `project_nango.md` — credential vault handles retries |
| Customer floods MIRA with junk questions on first day | Low | Low | Per-tenant rate limit + per-question metering |
| Customer's data is sensitive (PII / IP) | High | High | Existing PII sanitization (`InferenceRouter.sanitize_context`) per `security-boundaries.md`; document data handling in trial signup |
| Bot answers competitor questions in trial mode | Low | Low | System prompt: "MIRA is a maintenance copilot. Decline questions outside that scope." (matches `mira-saas-scope-guard`) |

---

## Open design questions

- [ ] **Default surface — Slack or Hub chat?** Both? Force-choose at signup?
- [ ] **Pricing unit — per question, per tag-month, per asset, per tenant?** Twilio chose per-message. MIRA's value scales with asset-count, not question-count — but per-question feels more honest. UNCONFIRMED.
- [ ] **Free-tier scope** — 10 questions/month? 1 component template? 50 KG entities?
- [ ] **Trial duration** — 7 days, 14 days, 30 days?
- [ ] **Multi-environment per tenant (Fuuz: Build / QA / Prod)** — needed in MVP, or v2?
- [ ] **API key scopes** — read / write / admin? Or simpler single-token?
- [ ] **Webhook outbound** — when MIRA verifies a KG proposal, can the customer subscribe? (Mirror of Pattern U-5.)
- [ ] **Customer-owned LLM key** — "bring your own Anthropic/OpenAI key" option for enterprise-IT-paranoid customers?

---

## Implementation references

- **Existing MIRA pieces to wire** (reduces 30-day build effort by ~50%):
  - `mira-bots/shared/engine.py` — engine
  - `mira-bots/shared/uns_resolver.py` — UNS resolution
  - `mira-mcp/server.py` — MCP read tools
  - `mira-crawler/ingest/` — manual ingestion + KG-writer
  - `mira-cmms/` — Atlas integration
  - `mira-relay/` — Ignition tag streaming
  - `mira-bots/slack/bot.py` — Slack adapter
  - `mira-hub/` — Hub backend (per `project_hub_is_parent_surface.md`)
  - `mira-web/` — Hub frontend (Hono/Bun, Stripe)
  - Nango (per `project_nango.md`) — credential vault for CMMS OAuth
- **External services already in use:**
  - NeonDB (multi-tenant data)
  - Doppler (secrets)
  - Stripe (billing)
- **Missing pieces to build:**
  - MIRA Gateway binary (extend `mira-relay`)
  - `mira` Python SDK
  - Hub `/start` signup page
  - Hub `/connect` connector catalog
  - Hub `/uns` UNS tree confirmation UI
  - Hub chat UI (alternative to Slack)
  - Public docs at docs.factorylm.com
  - `POST /v1/ask` REST endpoint
  - Per-tenant first_answer_at instrumentation

---

## Sources

- **Companion analysis:** [mira-twilio-of-industry4-analysis.md](../research/industry4-intelligence/mira-lessons/mira-twilio-of-industry4-analysis.md)
- **Architectural patterns:** [docs/research/industry4-intelligence/architecture-patterns/](../research/industry4-intelligence/architecture-patterns/)
- **Fuuz repo + video analysis:** [docs/research/industry4-intelligence/repos/](../research/industry4-intelligence/repos/) + [videos/](../research/industry4-intelligence/videos/)
- **MIRA existing specs to align with:** `docs/specs/maintenance-namespace-builder-spec.md`, `docs/specs/uns-kg-unification-spec.md`, `docs/specs/uns-message-resolver-spec.md`, `docs/specs/dialogue-state-tracker-spec.md`
- **Memory:** `project_hub_is_parent_surface.md`, `project_nango.md`, `feedback_llm_cascade_default.md`
- **Product doctrine:** `docs/THEORY_OF_OPERATIONS.md`, root `CLAUDE.md`, `.claude/CLAUDE.md`

## Change log

- **v0.1 (2026-05-20):** Initial draft from claude-code after Fuuz deep-dive. Awaiting Mike's review + assignment of owner.
