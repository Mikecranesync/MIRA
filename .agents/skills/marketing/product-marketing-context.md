# FactoryLM Product Marketing Context

> Auto-generated 2026-04-08. All marketing skills reference this file.

---

## 1. Product Overview

**One-line:** AI-powered maintenance assistant that answers fault code questions from your actual equipment manuals in 10 seconds.

**What it does:** FactoryLM (product name: Mira) is a chat-based AI diagnostic tool for industrial maintenance technicians. Technicians type a fault code or describe a symptom, and Mira retrieves the answer from the customer's own OEM equipment manuals using RAG (Retrieval-Augmented Generation). It also auto-creates work orders in the customer's CMMS. Available via web (app.factorylm.com), Telegram, and Slack.

**Product category:** AI maintenance copilot / industrial knowledge assistant

**Product type:** SaaS (web app) with planned on-premise hardware deployment

---

## 2. Target Audience

### Primary ICP: Maintenance Technician ("Floor Mike")
- **Title:** Maintenance Technician, Maintenance Mechanic, Millwright
- **Company size:** 10-100 person manufacturing plant
- **Equipment:** Allen-Bradley PLCs, GS10/GS20/PowerFlex VFDs, hydraulic power units
- **Daily reality:** Standing at a faulted machine at 2 AM, flipping through a 400-page PDF manual or on hold with OEM tech support for 2 hours
- **Trigger phrase:** "Has anyone seen this fault code before?"
- **How they search:** Google "[equipment model] [fault code]", Reddit r/PLC, YouTube
- **Buying power:** Low — recommends to manager, doesn't sign checks

### Secondary ICP: Maintenance Manager
- **Title:** Maintenance Manager, Maintenance Supervisor, Reliability Manager
- **Company size:** Same plants, manages 5-50 techs
- **Pain:** MTTR too high, no visibility into tech performance, CMMS adoption failed (50-70% of CMMS implementations fail)
- **Trigger phrase:** "We need to reduce our downtime but nobody uses the CMMS"
- **Buying power:** High — controls maintenance budget, signs software purchases

### Tertiary ICP: Plant Manager
- **Title:** Plant Manager, VP Operations
- **Pain:** Unplanned downtime costs $X/hr, no audit trail on maintenance decisions
- **Trigger phrase:** "How do I know my maintenance team is following procedure?"

### Future ICP: Ignition Integrator
- **Title:** Controls Engineer, Project Manager at an Ignition certified integrator
- **Pain:** Customers keep calling about the same alarms post-commissioning
- **Opportunity:** Resell Mira as part of Ignition projects

---

## 3. Pain Points & Triggers

**Primary pain (technician):**
- Wastes 20-40 minutes per fault looking up codes in PDFs
- OEM tech support has 2-hour hold times
- Manual is in the office, technician is on the floor
- New techs don't know where to find information
- Tribal knowledge leaves when experienced techs retire

**Primary pain (manager):**
- CMMS adoption failed — techs won't use it (too complex, too slow)
- No visibility into what faults are happening and how they're being resolved
- Reactive maintenance instead of planned — always firefighting
- Can't prove ROI on maintenance spend to plant manager

**Buying triggers:**
- "We just had another unplanned shutdown"
- "Our best tech is retiring next year"
- "The CMMS vendor demo'd great but nobody uses it"
- "We're failing our safety audit on documentation"

---

## 4. Value Propositions

**Core value prop:** Ask Mira your fault code — get the answer from your own manuals in 10 seconds, not 40 minutes.

**Supporting props:**
- CMMS setup in 2 minutes — no sales call, no provisioning
- Works in Telegram, Slack, or web — no new app to install
- RAG over YOUR equipment manuals — not generic internet knowledge
- Photo-to-diagnosis: snap a photo of the fault, get an answer
- Auto-creates work orders from diagnostic conversations
- 5 free queries/day — try it before you buy it

---

## 5. Competitive Positioning

**Market position:** The only chat-first AI diagnostic tool for SMB maintenance technicians.

**Four-way moat (no single competitor covers all):**
1. Chat-first delivery (Telegram/Slack — not another app)
2. RAG over customer's own manuals (not generic knowledge)
3. Ignition SCADA integration (zero AI modules on Ignition Exchange)
4. SMB pricing ($49/mo vs $100K+ enterprise tools)

**Key competitors:**
| Competitor | What They Do | MIRA Differentiator |
|-----------|-------------|---------------------|
| Tractian ($700M val) | Hardware sensors + predictive maintenance | MIRA is software-only, no hardware cost barrier |
| MaintainX ($2.5B val) | CMMS + CoPilot | MaintainX AI is admin-focused (checklists), not diagnostic |
| Augmentir | Connected worker AR coaching | Enterprise pricing, complex deployment |
| Siemens Industrial Copilot | GenAI for Siemens ecosystem | Captive to Siemens equipment only |

**Pricing gap:** $300-2,500/mo tier is wide open — above self-serve CMMS ($16-75/user/mo), below enterprise AI ($100K+).

---

## 6. Pricing

| Tier | Price | What's Included |
|------|-------|----------------|
| Free | $0 | 5 Mira AI queries/day, full CMMS features, web access |
| Pro | $49/mo | Unlimited queries, priority support |

No other tiers exist yet. No annual pricing. No per-user pricing.

---

## 7. Brand Voice

**Tone:** Peer, not professor. Direct, confident, specific to their daily reality.

**Style:** Short sentences. Concrete scenarios. Numbers over adjectives. Equipment model numbers, not abstractions.

**Examples of good copy:**
- "Diagnose a VFD fault in 30 seconds, not 30 minutes"
- "Your PowerFlex 525 threw an F004? Here's what to check first."
- "80% of hydraulic low-pressure calls are a clogged suction strainer, not a worn pump"

**Words to NEVER use:**
leverage, synergy, revolutionize, cutting-edge, unlock, empower, game-changer, seamless, "Certainly!", "Great question!", disrupting, next-gen, state-of-the-art

**Proof style:** Concrete scenarios and numbers. "10 seconds vs 40 minutes" not "improved efficiency." Reference real equipment models and fault codes.

---

## 8. Key Proof Points

- 50-70% of CMMS implementations fail (MIRA delivers value without CMMS adoption)
- 22% MTTR reduction from conversational AI (Forrester 2024)
- 25,000+ knowledge entries in the knowledge base
- 3,694 equipment photos confirmed and classified
- Connected worker market: $8.6B in 2025 → $20.2B by 2030 (18.5% CAGR)
- Zero AI copilots on Ignition Exchange — first-mover opportunity
- 5,000+ Ignition certified integrators, 69% of Fortune 100 use Ignition

---

## 9. Distribution Channels

**Current:**
- Web app: app.factorylm.com (PLG funnel with drip email sequence)
- Telegram bot (mira-bot-telegram)
- Slack bot (mira-bot-slack)

**GTM sprint channels (active April 2026):**
- LinkedIn hydraulics group (3,000 members, reactivating)
- Reddit: r/PLC, r/maintenance, r/SCADA, r/manufacturing
- YouTube: "AI vs. The Manual" long-form + fault code Shorts
- TikTok, Instagram Reels (re-upload Shorts)
- Facebook Groups (Maintenance & Reliability Professionals, Allen-Bradley PLC Users)
- X/Twitter (#Manufacturing, #IIoT)

**Future:**
- Ignition Exchange (.modl module)
- Integrator channel partnerships
- NIST MEP network (1,400 advisors embedded in SMB manufacturers)

---

## 10. Current State (April 2026)

- **Product:** Live at app.factorylm.com — web chat, CMMS, drip emails, PWA
- **Infrastructure:** Mac Mini M4 (Bravo), DigitalOcean VPS, NeonDB, Ollama
- **Knowledge base:** 25,000+ entries from industrial equipment manuals
- **Bot adapters:** Telegram + Slack working; Teams + WhatsApp code-complete
- **CMMS:** Atlas CMMS integrated; adapters for MaintainX, Limble, Fiix
- **Content automation:** Celery fleets auto-generating blog, social, video scripts via Claude API
- **Dashboard:** mira-ops at port 8500 (content approval workflow)

---

## 11. Growth Levers

- LinkedIn hydraulics group (3K members — dormant, being reactivated)
- YouTube competitive gap (nobody films AI diagnosing real equipment on camera)
- Fault code SEO (technicians Google fault codes — zero YouTube/blog competition)
- Integrator partnerships (5,000+ Ignition integrators)
- SBIR/STTR grants (54 contacts in HubSpot — professors, investors, program officers)
- Academic partnerships (STTR co-PI candidates at Georgia Tech, CMU, CWRU, UTK)

---

## 12. Constraints

- No Modbus/PLC/VFD live data yet (Config 4 — deferred)
- No Ignition module yet (milestone 3)
- No paying customers yet (GTM sprint goal: 10 free-tier users in 30 days)
- Bootstrapped — $0 marketing budget
- Solo founder — 1-2 hours/day on GTM, rest on product
- DigitalOcean payment failing (needs immediate fix)
- Claude API 529 overloaded errors (transient, retry handles it)
