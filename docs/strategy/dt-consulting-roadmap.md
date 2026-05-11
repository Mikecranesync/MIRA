# Digital Transformation Consulting Roadmap

**Owner:** Mike Harper
**Last updated:** 2026-05-11
**Status:** Active strategy — drives the 90-day commercial plan and beyond
**Sibling docs:** `STRATEGY.md` (ICP + pricing), `NORTH_STAR.md` (flywheel), `docs/specs/dt-scorecard-spec.md` (lead-magnet spec)

---

## One-page thesis

Small-to-medium discrete manufacturers (50–500 employees, 1–5 plants) are being told by *every* big consultancy that they need "digital transformation." They get $80K Deloitte decks, $250K Accenture pilots, and PowerPoints from people who've never replaced a contactor.

FactoryLM is the alternative: **a 30-year-on-the-floor maintenance veteran plus an AI maintenance agent**, packaged as a productized consulting funnel that starts free and ends at a 3-year strategic partnership.

Our wedge is not better PowerPoint. It's:

1. A **real product** (MIRA + Atlas Hub) the customer can touch on day one — not a slide deck of capabilities.
2. **CESMII alignment** — the federally-funded Smart Manufacturing Innovation Institute framework. We map every recommendation to the 6 CESMII dimensions, so customers can defend the spend to a board.
3. **Outcome guarantees** — we measure MTTR, PM compliance, manual-lookup time at the start of every engagement, and report on those numbers monthly.
4. **The founder's voice** — Mike's 15 years of fixing things gives every conversation a credibility no $400/hr partner can buy.

The funnel turns a LinkedIn post → a free scorecard → a free call → a paid assessment → a pilot → a full deployment → a strategic partnership. Each stage is its own product, with its own price point, and each one qualifies the lead for the next.

---

## The funnel

```
Stage 1: AWARENESS         (Free)         →  ~500 / mo target
Stage 2: ENGAGEMENT        ($0 call)      →  ~25 / mo target
Stage 3: PAID ASSESSMENT   ($500-$1,500)  →  ~5 / mo target
Stage 4: PILOT             ($2K-$5K/mo)   →  ~1-2 / mo target
Stage 5: FULL DEPLOYMENT   ($499-$649/facility/mo recurring)
Stage 6: STRATEGIC ROADMAP ($8K-$15K one-time, recurring annually)
```

Each stage is described below: what it is, who it's for, what the customer gets, what FactoryLM gets, what's already built, what still needs building.

---

## Stage 1 — Awareness (Free)

**Goal:** Get the right plant managers, maintenance directors, and ops VPs to know FactoryLM exists and to opt in to our list.

**Channels (priority order):**

1. **Digital Transformation Readiness Scorecard** at `factorylm.com/assess` — the lead magnet. 20 questions, 10 minutes, mobile-first, CESMII-derived. Gated: results only revealed after the user provides business email + phone + company. **Already built** (this PR).
2. **LinkedIn content** — Mike's personal feed, 3 posts/week. Sequence:
   - **War stories** (Mon): "The time the night-shift tech rebuilt a $40K gearbox from a PDF on a flip phone." Pain + dignity.
   - **What I wish I had** (Wed): "If I'd had MIRA in 2019, the Frito-Lay outage doesn't happen." Show the gap.
   - **Show the build** (Fri): A 30-second screen share of a real MIRA feature. Proof, not promises.
3. **YouTube demo videos** — Auto-generated from the comic-pipeline (`tools/seedance-video-gen.py`). 60-90 sec each, one per feature. Hosted on `youtube.com/@factorylm`, embedded on `/blog`.
4. **Florida Automation Expo** — Booth at FLAEx (Orlando, fall). The "real maintenance guy + AI" booth in a sea of $200K integrators.
5. **CESMII / i3X alignment messaging** — Every piece of content carries "Aligned with CESMII Smart Manufacturing framework" footer. Credibility for the engineer who has to justify the buy.

**Conversion event:** Scorecard completion (lead captured to HubSpot).

**Already built:**
- `/assess` scorecard + lead capture (HubSpot Forms API integration)
- `/blog` + `/blog/fault-codes` (SEO foundation)
- `/llms.txt` (GEO foundation)
- PostHog funnel tracking
- HyperFrames comic + video pipeline

**Still to build:**
- LinkedIn Sales Navigator outreach automation (Q3)
- Three "evergreen" pillar articles for SEO ranking on "CMMS for small manufacturers", "maintenance digital transformation", "how to start a PM program"
- Booth materials for FLAEx
- Founder-led case studies (need first 3 pilot customers to publish)

---

## Stage 2 — Engagement ($0, free 30-min call)

**Goal:** Turn a scorecard lead into a qualified prospect. Talk to a human; learn whether they have budget, pain, and authority.

**What it is:** A 30-minute "Digital Readiness Review" video call. Mike on the line. Customer brings their scorecard PDF. We:

1. Walk through their scorecard — which dimensions are weak, why, and what does that look like on their floor?
2. Ask three diagnostic questions: *What broke last week? Who fixed it? How long did it take to figure out what was wrong?*
3. Identify **2-3 quick wins** they could implement on their own in 30 days — *whether they buy from us or not*. This is the trust currency.
4. If the fit is there, soft-pitch the paid assessment.

**Conversion event:** Calendly booking from the scorecard CTA (Calendly URL placeholder: `https://calendly.com/factorylm/readiness-review`).

**Already built:**
- Scorecard CTA → Calendly link (wired in `assess.html` results page)
- Founder credibility (15 years on the floor, published war stories)

**Still to build:**
- Calendly account + integrated availability
- A 1-page "Readiness Review prep guide" emailed automatically after booking
- Standardized 30-min call deck: 5 min scorecard review, 15 min diagnostic Q's, 10 min next-steps
- HubSpot deal pipeline stage: `engagement_call_booked` → `engagement_call_held` → `qualified` / `disqualified`
- Auto-email after the call with the 2-3 quick wins in writing

**Target conversion (Stage 1 → Stage 2):** ~5% of scorecard completers book the call.

---

## Stage 3 — Paid Assessment ($500–$1,500)

**Goal:** First revenue. Productized consulting, not custom services. Same deliverable every time, refined over reps.

**What it is:** A half-day on-site Digital Transformation Assessment.

- **Price:** $500 for Central Florida (Mike drives), $1,500 elsewhere (flight + lodging built in).
- **Duration:** 4 hours on-site + 1 week to deliver the report.
- **Activities:**
  - Walk the maintenance floor with the maintenance manager
  - Sit with 2-3 technicians for 30 min each ("show me how you fixed the last thing that broke")
  - Audit their CMMS (or lack thereof), their manual storage, their PM compliance numbers
  - Live-demo MIRA: scan a nameplate on their floor, pull up the manual, show the QR → asset flow
- **Deliverable:** A **10-page report** with:
  - Their CESMII 6-dimension scorecard (validated, more rigorous than the online version)
  - A prioritized list of 5-7 specific actions they should take
  - Cost estimates and ROI math for each
  - Vendor recommendations (we recommend ourselves only where we're the best fit; we honestly recommend competitors otherwise — that's a trust moat)
  - A 90-day quick-win plan they can execute alone, and a 12-month roadmap if they want a partner

**Why the price is so low:** Because the report's job is not to make money. It's to qualify the customer for Stage 4 (the pilot). The report ends with: *"If you want a partner for the next 90 days, here's the pilot proposal." Most who buy the assessment will buy the pilot.* Conversion target: 50%.

**Already built:**
- MIRA + Atlas Hub product (the live demo asset)
- Scorecard framework (the report skeleton)
- Founder expertise (the assessment IS Mike's brain on a clipboard)

**Still to build:**
- A reusable 10-page report **template** (`docs/templates/dt-assessment-report.md`) → next deliverable
- A flat-fee proposal template
- A 1-page "what to expect on assessment day" doc to send pre-visit
- Standardized intake form (their CMMS, asset count, PM compliance numbers, top 3 pain points) — collected at booking

**Revenue at this stage (Year 1, conservative):** 3 assessments/month × $500 average = **$1,500/mo**. Real money: it's the gateway to Stage 4.

---

## Stage 4 — Pilot ($2,000–$5,000/month)

**Goal:** Land one production line per customer. Prove the value on real machines. Generate the case study that fuels Stages 1-3 forever.

**What it is:** A 90-day FactoryLM Hub pilot on one production line or one functional area (the kitting cell, the press shop, the packaging line — pick the area with the most pain).

**Scope (every pilot, same SKU):**

- Deploy MIRA + Atlas Hub for **one production area** (10–20 assets max)
- Digitize the **top 10 assets**:
  - Pull every OEM manual into the KB (we have the crawler)
  - Build a PM schedule for each in Atlas CMMS
  - Capture last 12 months of fault history from their CMMS / spreadsheet / paper
- Print and apply **QR code stickers** (Avery 5163, already supported by `mira-web/admin/qr-print`)
- Train **2-3 maintenance technicians** on MIRA (1-hr session, then 1 week of in-app support)
- **90-day measurement** of three KPIs:
  - **MTTR** (mean time to repair) — target -20%
  - **PM compliance** — target +15 pts
  - **Manual lookup time** — target -75% (from minutes to seconds)
- **Bi-weekly review call** with Mike — 30 min, screen share, what's working, what's not, what to tune
- **Day-90 readout deck**: KPI deltas, technician quotes, ROI calc, proposal for full deployment

**Pricing tiers:**

| Tier | Price/mo | Asset count | Techs trained | Visits |
|---|---|---|---|---|
| Pilot-Lite | $2,000 | up to 10 | 2 | 1 (kickoff) |
| Pilot-Standard | $3,500 | up to 20 | 3 | 2 (kickoff + Day-45) |
| Pilot-Plus | $5,000 | up to 30 | 5 | 3 (kickoff, Day-30, Day-60) |

**Why the price floor is $2K:** Below that, we lose money on Mike's hours. Above $5K, we're competing with serious integrators and they win on enterprise procurement chops.

**Conversion event:** Day-90 readout → signed annual contract for Stage 5 deployment.

**Already built:**
- MIRA chat (cited answers from OEM manuals)
- Atlas CMMS (work orders, PM scheduling)
- QR code system (mira-web admin + print PDF generation)
- Knowledge ingest pipeline (mira-crawler)
- Telegram + Slack bots (techs use them daily)
- 68K+ OEM doc chunks already indexed

**Still to build:**
- Standardized **pilot intake checklist** (asset list, manual sources, PM frequencies, KPI baselines)
- KPI dashboard — Grafana board showing MTTR/PM/lookup deltas vs. baseline, per-tenant
- Automated Day-30, Day-60, Day-90 email digests with KPI trend
- Pilot SOW template (1 page, plain English)
- A "happy path" pilot runbook so the second pilot doesn't burn another founder-week

**Revenue at this stage (Year 1, conservative):** 1 pilot signing per month at $3,500 avg × 90 days = **$10,500 per pilot**. By month 12: 6 active pilots = **$21K/mo recurring** in pilot revenue alone.

---

## Stage 5 — Full Deployment ($499–$649 / facility / month)

**Goal:** Recurring revenue. The pilot graduates to a full-plant rollout, billed monthly, retention-driven.

**What it is:** Existing FactoryLM pricing tier (per `STRATEGY.md`). Roll out MIRA + Atlas Hub across the entire facility.

**Scope:**

- Full asset registry digitized (100–500+ assets typical)
- Full CMMS migration (from MaintainX/UpKeep/Limble/paper — we have importers, Nango integration coming via PR #808)
- Knowledge Cooperative membership — read-only access to anonymized cross-tenant insights ("3 of the 12 plants running this drive saw F005 within 60 days of cap-3 bulging")
- Ongoing AI-powered maintenance intelligence (no per-seat fee, unlimited techs)
- Integration with their existing systems (Ignition via mira-relay, ERP via webhooks, historians via direct connectors as Config 4 lands)

**Pricing (today, per `mira-web/pricing`):**

- **MIRA Troubleshooter** — $497/facility/month (chat + QR + KB)
- **MIRA Integrated** — $649/facility/month (everything + CMMS sync + Ignition relay)
- Both include unlimited techs (no per-seat fees — a deliberate moat vs. Limble/UpKeep which charge per user)

**Conversion event:** Pilot Day-90 readout → annual contract signed.

**Already built:**
- Both pricing tiers are live on `factorylm.com/pricing`
- Stripe subscription + billing portal
- Atlas API for CMMS operations
- Knowledge Cooperative infra (cross-tenant KG, anonymization)
- mira-relay for Ignition factory→cloud streaming

**Still to build:**
- A renewal-rhythm checklist (quarterly business review with each customer — KPI review, feature roadmap input)
- Reference program (named customer logos on the site, with a Loom from the customer's maintenance manager)
- Pricing reviews quarterly — graduate enterprise customers to volume pricing

**Revenue at this stage (Year 1, conservative):** 50% of pilots convert × 6 pilots-converted = 3 full deployments × $573 avg = **$1.7K/mo** in Year 1. Year 2 target: 24 deployments at $700 avg = **$16.8K/mo**.

---

## Stage 6 — Strategic Partnership ($8K–$15K per roadmap, recurring annually)

**Goal:** High-margin advisory revenue. Become THE digital transformation partner for a multi-plant manufacturer.

**What it is:** A **Smart Manufacturing Roadmap** engagement.

- **Price:** $8K (single plant), $12K (2-3 plants), $15K (4+ plants / corporate)
- **Duration:** 4 weeks of work, delivered as a 20-30 page strategic document
- **Activities:**
  - Stakeholder interviews — CEO/COO, plant manager(s), maintenance directors, IT, ops VP
  - Cross-plant scorecard rollup (every plant takes the assessment)
  - 3-year digital transformation plan with phased budget
  - Stakeholder alignment workshop (half-day, on-site or remote) — walk leadership through the plan, get signoff
  - Quarterly check-in calls for 12 months post-delivery
- **Deliverable:** A board-ready strategic plan that:
  - Maps current state to the **CESMII 6-dimension maturity model**
  - Identifies cross-plant patterns and shared infrastructure opportunities
  - Sequences investments (which year, which plant, which dimension, what ROI)
  - Aligns to applicable government incentives — **CESMII grants, USDA REAP for energy-related upgrades, MEP center funding, state advanced manufacturing tax credits** (the customer doesn't realize money is on the table; we do)

**Why this is the moat:** Once we deliver this, we *are* their digital transformation team. Every quarterly check-in is an opportunity to scope a new pilot. Every new plant they acquire becomes a Stage 4 → Stage 5 expansion. Expected lifetime value of a Stage 6 customer: **$200K+ over 3 years.**

**When CESMII certification pays off (future):** If FactoryLM becomes a **CESMII Member** and Mike becomes a **CESMII Certified Practitioner**, this stage's price floor doubles and the prospect's grant-funding access becomes a paid co-application service. That's a 2027 play.

**Already built:**
- The 6-dimension framework (built into the scorecard)
- Founder credibility (15 yr maintenance + AI builder is rare)

**Still to build:**
- **Everything.** No customer has paid for a Stage 6 engagement yet. This is the 2027 product.
- A Stage 6 SOW template
- A reference roadmap deliverable (sanitized, used as a sales tool for prospects)
- Relationships with grant-writing partners (we don't write grants; we hand off to a partner who does, for a referral fee)
- CESMII membership application

**Revenue at this stage (Year 2-3):** 2 strategic engagements / year × $12K avg = **$24K/yr** + the recurring Stage 5 revenue those engagements unlock.

---

## Revenue projection (conservative)

| Month | Stage 1 (Free) | Stage 2 (Free call) | Stage 3 ($500 avg) | Stage 4 (Pilot) | Stage 5 (Recurring) | Stage 6 (Roadmap) | **Total MRR** |
|---|---|---|---|---|---|---|---|
| M1 (May 2026) | 50 scorecards | 5 calls | 1 assessment ($500) | 0 | 0 | 0 | **$500** |
| M3 (Jul 2026) | 150 | 10 | 3 ($1,500) | 1 pilot ($3,500) | 0 | 0 | **$5,000** |
| M6 (Oct 2026) | 300 | 18 | 5 ($2,500) | 3 pilots ($10,500) | 1 deployment ($573) | 0 | **$13,500** |
| M9 (Jan 2027) | 450 | 25 | 5 ($2,500) | 5 pilots ($17,500) | 2 deployments ($1,200) | 0 | **$21,000** |
| M12 (Apr 2027) | 500 | 30 | 6 ($3,000) | 6 pilots ($21,000) | 3 deployments ($1,700) | 1 roadmap ($8K one-time) | **$33,700** |

**Year 1 ARR target: ~$300K.** Pilots dominate Y1 revenue. Recurring takes over in Y2.

---

## How each MIRA feature maps to a stage

| MIRA capability | Stage(s) it powers | Why it matters at that stage |
|---|---|---|
| QR-coded asset stickers | 3, 4, 5 | The "wow moment" in the on-site assessment. The deployment ritual at pilot start. |
| OEM manual ingest + cited answers | 3, 4, 5 | The 5-minute live demo on the customer's own equipment. |
| Atlas CMMS (work orders + PM) | 4, 5 | The system of record after the pilot. The thing they stop using their old CMMS for. |
| Knowledge Cooperative | 5, 6 | The "you're not alone — 12 other plants saw this" moment. Defensible network effect. |
| mira-relay (Ignition cloud streaming) | 5, 6 | The tier-2 upsell. Makes us the integration layer, not just the front-end. |
| Telegram / Slack bots | 4, 5 | Adoption hack — techs already use these; no new app for them to learn. |
| HyperFrames promo videos | 1 | Top-of-funnel attention without a marketing agency. |
| Scorecard at /assess | 1, 2, 3, 6 | The reusable lead magnet AND the assessment skeleton AND the strategic roadmap input. |

---

## Competitive positioning

**vs. Deloitte / Accenture / McKinsey Smart Manufacturing practices:**
- They cost $200K-$2M per engagement. We cost $500-$15K.
- They send senior associates with MBAs. We send Mike, 15 years on the floor.
- They produce slide decks. We produce running software.
- They disappear after the deck. We have a $499/mo SLA.

**vs. local automation integrators (Maverick, Polytron, Optima):**
- They sell PLCs and SCADA. We sell maintenance intelligence — they're our complement, not our competitor.
- They charge $200-$400/hr T&M. We charge fixed-fee productized engagements.
- They can't deliver software-as-a-service. We can.
- **Channel play:** We should be these integrators' AI partner. They sell the PLC; we sell the MIRA layer that makes the PLC's data useful to the maintenance team. Pursue 2-3 channel partnerships by EOY 2026.

**vs. CMMS vendors (MaintainX, UpKeep, Limble, Fiix):**
- They charge per seat ($30-$80/user/mo). We charge per facility, unlimited users.
- They're a tool. We're a transformation.
- They have features. We have outcomes (MTTR, PM compliance, lookup time).
- **We integrate with them, not against them.** A customer on MaintainX can still buy a Stage 3 assessment + Stage 4 pilot from us.

---

## The unique value prop, in one sentence

> *"You don't need a 30-year-old consultancy. You need a 30-year maintenance vet who built an AI agent on his own and will fix your floor in 90 days with measurable KPIs and CESMII-aligned reporting."*

That sentence is the test for every piece of marketing, every sales call, every product decision. If a thing we're considering doesn't reinforce that line — cut it.

---

## What needs to ship next (priority order, May–July 2026)

1. **This week:** Lead-gated scorecard live on factorylm.com/assess + homepage banner. **DONE** (this PR).
2. **This week:** Calendly account set up, link wired in scorecard results CTA.
3. **Next 2 weeks:** 10-page assessment report template (`docs/templates/dt-assessment-report.md`).
4. **Next 2 weeks:** First 3 LinkedIn pillar posts published; first scorecard leads in HubSpot.
5. **Next month:** First paid on-site assessment booked and delivered (target: by mid-June).
6. **Next 60 days:** First pilot signed (target: by July).
7. **Q3 2026:** Pilot KPI dashboard, automated digest emails, pilot SOW template.
8. **Q4 2026:** First pilot graduates to Stage 5 full deployment. First named customer case study.
9. **Q1 2027:** CESMII membership application. First Stage 6 strategic engagement.

---

## Decision log

- **2026-05-11:** Lead-magnet scorecard gates results behind business-email capture. Decision: HubSpot Forms API integration (we already have HubSpot connected). Free-email domains rejected client AND server side.
- **2026-05-11:** Stage 3 priced at $500 floor (not $2,500 like Deloitte alternative). Reasoning: the assessment's job is not to make money — it's to qualify Stage 4. Low friction wins.
- **2026-05-11:** Stage 4 pilot floor $2K/mo. Below that, Mike's hours lose money. Above $5K, integrators win on procurement.
- **2026-05-11:** Stage 6 deferred to 2027. No customer has paid for it yet; building the template before validation would be premature.

---

## See also

- `STRATEGY.md` — ICP, pricing, GTM motion (the *commercial* primer)
- `NORTH_STAR.md` — the technical flywheel (what feature improvements compound)
- `docs/specs/dt-scorecard-spec.md` — the scorecard's behavioral spec
- `mira-web/public/assess.html` — the scorecard implementation
- `mira-web/src/server.ts` (POST /api/assess/lead) — HubSpot lead-capture endpoint
