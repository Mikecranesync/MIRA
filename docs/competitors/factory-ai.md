# Factory AI (f7i.ai)

**Last updated:** 2026-04-24
**Source:** Factory AI public T&Cs (provided by Mike, 2026-04-24). Also: https://f7i.ai, https://www.f7i.ai/pricing
**Entity:** Factory AI Pty Ltd (ACN 667 391 442) — Australia
**Governing law:** New South Wales, Australia

---

## Products

| Product | Description (their wording) |
|---|---|
| **Prevent** | "AI-native CMMS" — asset registry, components, spare parts, failure modes, maintenance protocols, automated scheduling, **AI-generated work orders**, intelligent reporting. |
| **Predict** | Referenced in support links (`f7i.ai/products/predict`) but not defined in T&Cs. Presumed predictive-maintenance / anomaly detection companion product. |

**Billing:** Stripe. USD. Subscription (auto-terminates on non-payment, auto-resumes on new payment). No refunds except "major failure." Trial period → auto-terminate unless user subscribes.

**Contacts (public):**
- Support: `support@f7i.ai`
- Complaints: `jp@f7i.ai`
- Pre-sales / support escalation: `tim@f7i.ai`
- 48-hr business-day SLA on support, **explicitly not guaranteed**

---

## What the T&Cs reveal about their product & risk posture

### 1. They train on customer data by default (opt-out)
> Clause 15: "we may use Customer Data to train and improve our Software" — includes maintenance data, equipment performance metrics, failure patterns, work order histories, operational data. **Opt-out via email** (`support@f7i.ai`).

**Signal:** Data-flywheel play. Every customer's failure modes and work orders feed a shared model. This is their moat thesis.

**Our angle:** MIRA's hard constraint is Doppler-managed secrets + no framework that abstracts the Claude API. We can credibly offer *tenant-isolated, no-training-by-default* as a paid differentiator — especially to industrial customers with IP-sensitive failure data (OEMs, defense-adjacent manufacturers).

### 2. Heavy AI-output disclaimer — carved out as its own clause
> Clause 14: AI-generated recommendations are "for informational purposes only," user must "conduct independent analysis," Factory AI is "not liable for... equipment failures, downtime, or safety incidents" arising from AI output.

**Signal:** They're shipping AI work orders directly to maintenance crews and disclaiming the consequences. This is the exact failure mode MIRA's safety-keyword guardrails + evidence-only completion are built against.

**Our angle:** We don't just disclaim — we *gate*. `SAFETY_KEYWORDS` (arc flash, LOTO, confined space) trigger STOP escalation in `mira-bots/shared/guardrails.py`. Factory AI's T&Cs suggest no equivalent hard stop. **Talking point: "We won't let the AI tell your tech to open a 480V panel. Read their T&Cs."**

### 3. Liability cap = 12 months of fees paid
> Clause 16.1: Total liability capped at "total Fees paid... in the 12 months immediately prior to the event(s)."

Standard SaaS cap, but notable: consequential damages (lost revenue, downtime, data corruption, personal injury, death) all excluded. Combined with the AI carve-out, their aggregate liability exposure per customer is trivially bounded.

### 4. IP assignment is asymmetric
> Clause 12.2: All "Developed IP" — enhancements, improvements, modifications arising in connection with the Software — **automatically vests in Factory AI**.
> Clause 12.4: Customer retains ownership of Customer Data but grants Factory AI a "worldwide, perpetual, irrevocable, non-exclusive and royalty-free license."

**Signal:** Standard SaaS but aggressively worded. Any customer-suggested feature / integration / workflow improvement becomes theirs.

### 5. Marketing-rights default-on (opt-out)
> Clause 12.6: Factory AI may publish customer logos and name customers as references without prior per-use consent. Revocable in writing.

### 6. Third-party integrations via Stripe + unlisted list
> Clause 11.2 references "a full list of third-party integrations available through the Software **here**" — link not in the T&Cs text. Worth pulling from the live site to map their integration surface.

### 7. Data retention post-termination
> Clause 8: Customer Data "may" be deleted "after a reasonable period" = **90 days** post-termination. Export requests honored via `support@f7i.ai`, ~14-day turnaround.

### 8. No SLA, no uptime commitment
> Clause 13.1 (ALL CAPS): Constant uptime "cannot be guaranteed," no liability for interruption/delay. No credits, no targets.

**Our angle:** Industrial customers doing daily PM rounds need an uptime number. Factory AI has refused to commit to one in writing. If MIRA ships even a soft 99.5% target with credits, that's a procurement-conversation win.

---

## Product positioning (from their marketing)

Taglines scraped from the T&Cs' own description of Prevent:
- "AI-native CMMS"
- "AI-generated work orders"
- Manages: asset registry, components, spare parts, failure modes, maintenance protocols
- Differentiators claimed: automated scheduling, intelligent reporting, reduced manual effort

**Where they overlap with MIRA:**
- Asset + work order management → Atlas CMMS (`mira-cmms/`)
- AI-generated work orders → GSDEngine via mira-pipeline
- Failure mode library → MIRA's KB ingest + Qdrant on CHARLIE

**Where MIRA is ahead (on paper):**
- **Safety guardrails as code**, not as disclaimer (clause 14 above)
- **Tenant isolation / no-training opt-in by default** — Doppler secrets, NeonDB per-tenant
- **Bring-your-own-LLM cascade** (Gemini → Groq → Cerebras → Claude) vs. Factory AI's undisclosed single-provider

**Where MIRA is behind (honest read):**
- Factory AI has a polished PLG funnel live at f7i.ai/pricing; our `mira-web` PLG is mid-build.
- They have a named Predict product; MIRA's predictive side is the crawler + ingest pipeline, not a packaged SKU.
- Their support response SLA is at least written down.

---

## Open questions (to track next)

- [x] What is Predict actually? — BLE vibration sensors + FFT peak detection + Factory Chat RAG. Vertically integrated.
- [ ] Pricing tiers at `f7i.ai/pricing` — snapshot to Wayback.
- [ ] Funding / team / HQ — NSW Australia per ACN, but where are engineers?
- [ ] Third-party integration list (referenced but not linked in T&Cs).
- [ ] Do they publish a security / SOC2 / ISO posture anywhere? — Nothing in docs. Assume no.
- [ ] Archive `docs.f7i.ai/sitemap.xml` to Wayback before they fix the `your-docusaurus-site.example.com` leak.
- [ ] Pull their mobile app from App Store / Play Store for screenshot-level comparison.

---

## Product Surface (from docs.f7i.ai, crawled 2026-04-24)

Their full public documentation was crawled via sitemap. The sitemap was *misconfigured* (left as `your-docusaurus-site.example.com`), which means it is indexable but leaks their entire data model via URL paths alone. **Recommend: archive `docs.f7i.ai/sitemap.xml` to Wayback immediately** — they may patch this once they notice.

### Platform architecture

```
Predict (predictive maintenance, sensor-driven)
  Bluetooth vibration sensor → IP65 gateway (5V/2A, 2m elevation, <20m range)
    → cloud (subdomain: acme.f7i.ai)
      → Insights module (anomaly detection, "initial report to reduce analysis time")
      → Factory Chat (retrieval over manually-indexed manuals)
      → Dashboard (downtime avoided, ROI, failure causes)

Prevent (AI-native CMMS)
  Asset registry (site → area → asset → component, unlimited sub-components)
    → Work orders (7 states, 4 types, mobile app with offline sync)
    → Purchasing (POs w/ approval-by-dollar-threshold)
    → Inventory (ABC/XYZ, reorder logic, multi-vendor)
    → Component templates (Motor/Pump/Control/Mechanical/Electronics catalog)
```

### Their data model (derived from 20 public REST endpoints)

Their REST API fully reveals their domain model. Base: `https://api.<tenant>.f7i.ai/prod`, Bearer token auth, rate-limited (429).

| Endpoint | Reveals |
|---|---|
| `/assets` | site → area → asset → component; QR code per asset; specs K/V (voltage, pressure, temp) |
| `/components`, `/asset-models` | Component library; asset-type templating |
| `/work-orders` | Full CMMS schema: tasks, parts, notes, media, presigned S3 uploads |
| `/pms` + `/pms/{id}/createworkorder` | PM procedures with steps, tools, parts, safety requirements → auto work-order spawn |
| `/maintenance-strategies` | 7 strategy types (preventive, predictive, condition-based, reactive, RCM, RBM, TPM) with MTBF/availability/cost-per-month metrics |
| `/failure-codes` | Proprietary taxonomy: 10 categories × 4 severities, with symptoms/causes/recommendations arrays. **No ISO 14224 reference.** |
| `/fft-data` | Frequency-domain vibration data with peak detection: 1X order (imbalance), 2X (misalignment), BPFO/BPFI (bearings), gear mesh |
| `/sensor-reports`, `/asset-charts` | Sensor telemetry + per-asset chart comparisons |
| `/asset-resources-chat` | **Their "AI chat" is just a GET-only retrieval endpoint** over tagged manual chunks. 8 resource types: manual, troubleshooting, maintenance, specification, safety, training, faq, best_practice. **No streaming. No model name disclosed. Read-only — content is ingested by Factory AI staff, not customers.** |
| `/external-events` | Inbound-only event ingestion from SCADA / ERP / CMMS / MES / weather / API sources |
| `/notifications` | GET-only. No outbound channel (email/SMS/Slack/webhook) documented. |
| `/parts`, `/inventory`, `/part-orders` | Full procurement |
| `/customer-settings`, `/gateways`, `/documents`, `/feedback` | Admin + ops surface |

### What their docs reveal about their AI

Factory Chat is less capable than the marketing suggests:
- "Quickly find information about your asset. The AI powered chat is enriched with operating manuals and contextual information from your site."
- **Hard limit:** "this will only work if we have the manual for your machine"
- **Ingestion path:** Customers email `tim@f7i.ai` to request manual indexing. Not self-serve.
- **UI:** A single "Ask Factory AI ..." button on asset/status pages; no global chat
- **Generated prompts** are shown but not listed in docs
- **No streaming, no model disclosed, no BYO-LLM, no per-tenant model control**
- **No mention of multi-turn conversation state**

The `asset-resources-chat` API tells the real story: it's a GET-only resource list keyed by assetName. The LLM sits downstream of a classic RAG retrieval. Their "Predict" insights module similarly "analyses the data along with other contextual information to generate an initial report" — boilerplate anomaly-to-text.

### What they explicitly do not have (or do not document)

1. **No outbound webhooks** — cannot push alerts to Slack, Teams, PagerDuty, Jira, ServiceNow. Integrations are inbound-only.
2. **No SDKs** — Python, JS, etc. absent.
3. **No API versioning scheme** shown.
4. **No SSO** (SAML/OIDC) documented. Users get temp credentials by email, 7-day expiry, forced password change.
5. **No SOC 2 / ISO 27001 / HIPAA posture** published.
6. **No on-prem / self-hosted option.** Pure cloud SaaS.
7. **No data residency controls** — training opt-out only (clause 15, email support).
8. **No BYO-model / BYO-LLM** — they run whatever they run.
9. **No streaming chat.**
10. **No self-serve manual ingest.** Admin-only, via email.
11. **No PLC/Modbus drivers** documented — "SCADA" is only a tag on `/external-events`.
12. **No audit log API.**
13. **No public pricing tiers in the docs** (pricing page not yet snapshotted).
14. **No ISO 14224 failure taxonomy** — proprietary only. This matters for regulated industries (oil & gas, pharma).
15. **No offline mode for the AI side** — only the work-order mobile app is offline-capable.

### Hardware posture

- Own-brand Bluetooth vibration sensors + IP65 gateways. Brand/model not disclosed in docs.
- Gateway power: 5V 2A. Range: <20m sensor→gateway. Placement: 2m elevation, avoid metal cabinets.
- This is a **vertically-integrated** play: sensors + gateway + cloud + analysis, all one vendor.

---

## Feature-Gap Matrix: MIRA vs. Factory AI

Legend: ✅ ahead · 🟰 parity · 🟡 behind · 🟥 absent

| Capability | Factory AI | MIRA (current) | Status | Gap-closer |
|---|---|---|---|---|
| **AI chat over manuals** | RAG over manually-ingested manuals, GET-only, no streaming | GSDEngine + multi-LLM cascade (Gemini→Groq→Cerebras→Claude), streaming via mira-pipeline | ✅ MIRA ahead on quality and breadth | Ship chat as an API endpoint |
| **Self-serve manual ingest** | Email tim@f7i.ai; admin-only | `mira-crawler` + OEM discovery pipeline (automated) | ✅ MIRA ahead | Productize the pipeline as "drop-in manual ingest" |
| **BYO-LLM** | None | Cascade of 4 providers, config-driven | ✅ MIRA ahead | Market as enterprise feature |
| **Safety guardrails** | T&Cs disclaimer only (clause 14) | `SAFETY_KEYWORDS` (21 phrases) → STOP escalation, in code | ✅ MIRA ahead | Publish guardrails as OSS |
| **Vibration sensor HW** | Own-brand BLE → IP65 gateway | None — software-only | 🟥 MIRA absent | BYO-sensor strategy; partner instead of build |
| **FFT / peak detection** | 1X/2X/BPFO/BPFI/gear-mesh classification with RPM-aware orders | None | 🟥 MIRA absent | `scipy.fft` in mira-ingest; ship in 30d |
| **Anomaly detection** | "Insights module" — reports |  None explicit | 🟡 MIRA behind | Claude-based narrative anomaly reports |
| **Asset registry** | site/area/asset/component, unlimited depth, QR codes, 10MB photo limit | Atlas CMMS has assets; depth/QR story not productized | 🟡 MIRA behind | Add hierarchy + QR in Atlas |
| **Component templates** | Catalog: Motor/Pump/Control/Mechanical/Electronics, 5-phase authoring | None | 🟥 MIRA absent | Open-source a YAML template library |
| **Work orders** | 7 states, 4 types, attachments, mobile offline, PM auto-spawn | Atlas CMMS has WOs; mobile offline unclear | 🟡 MIRA behind on mobile | PWA for Atlas; offline sync via SQLite WAL |
| **PM procedures w/ safety-first** | Steps+tools+parts+safetyRequirements+schedulingRules | Partial | 🟡 MIRA behind | Extend Atlas schema |
| **Maintenance strategies** | 7 types (RCM, RBM, TPM, etc.) with MTBF/availability metrics | None as first-class concept | 🟥 MIRA absent | Add strategy type to Atlas asset |
| **Failure-code taxonomy** | Proprietary, 10 cat × 4 sev | None | 🟥 MIRA absent | Ship ISO 14224-aligned taxonomy (standards edge) |
| **Inventory / reorder** | ABC/XYZ, multi-vendor, reorder logic | None | 🟥 MIRA absent | Phase-2 Atlas module |
| **Purchasing (POs)** | Dollar-threshold approval, vendor scoring | None | 🟥 MIRA absent | Phase-2 Atlas module |
| **REST API + docs** | 20 endpoints, Docusaurus, Bearer auth | mira-mcp exists but no polished docs | 🟡 MIRA behind | Mintlify/Docusaurus site in 2 weeks |
| **Subdomain multi-tenancy** | `acme.f7i.ai/prod` | Single-tenant now; mira-web has JWT per-tenant | 🟡 MIRA behind | Wildcard-subdomain routing on mira-web |
| **Outbound webhooks** | **None** | None yet | 🟰 both absent | **Ship first — straight win** |
| **Slack/Teams/PagerDuty** | None via API | None | 🟰 both absent | Ship w/ webhooks |
| **SSO (SAML/OIDC)** | Not documented | Not built | 🟰 both absent | Ship this for enterprise deals |
| **SOC 2 / ISO 27001** | None published | None | 🟰 both absent | Start Type 1 now |
| **On-prem / self-host** | Cloud-only | Docker Compose already works | ✅ MIRA ahead (latent) | Productize as a paid SKU |
| **No-training-by-default** | Opt-out (clause 15) | Default posture | ✅ MIRA ahead | Market it loudly |
| **PLC / Modbus** | "SCADA" string tag only | `mira-connect` (deferred) + `services/plc-modbus` (162 tests on factorylm) | ✅ MIRA ahead (latent) | Ship as "Config 4" post-MVP |
| **Ignition integration** | None documented | `mira-relay` (SaaS tag-streaming endpoint) | ✅ MIRA ahead | Lead with this to Ignition shops |
| **Open source** | None | Apache/MIT-only policy | ✅ MIRA ahead | Build community |

### How far ahead are they?

**On surface product polish: 9–12 months.** Their docs, API, dashboard, and mobile app are more finished than MIRA's customer-facing surface today.

**On underlying AI capability: MIRA is arguably ahead.** Their Factory Chat is classic RAG-over-manuals, admin-ingested, no streaming, no BYO-model. MIRA's GSDEngine + 4-provider cascade is more sophisticated, but currently buried in the stack.

**On defensible moat:** Their sensor hardware + data flywheel is real but attackable with a BYO-sensor / software-only story. They have no network effect yet — per-tenant deployments, no cross-customer learning advertised beyond training opt-out.

**On enterprise readiness:** They are barely ahead (subdomain tenancy + polished UI), but neither of you has SSO/SOC2/audit logs. The enterprise RFP race is wide open.
