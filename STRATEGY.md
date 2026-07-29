# FactoryLM Go-To-Market Strategy

> **Canonical wedge: `NORTH_STAR.md` (2026-06-22). This GTM doc is reconciled to it.** The wedge is the
> **maintenance-context layer (FactoryLM) + the grounded agent (MIRA) that proves it** — *lead with
> context, not copilot.* **Product-led self-serve is the PRIMARY motion;** the $500 Assessment is a
> *land-assist*, not the only door. The ICP, offer economics, GTM stages, and competitive table below
> remain valid; the competitive map + the ProveIt! 2027 plan live in `NORTH_STAR.md`.

**Mission:** Help industrial plants turn their messy maintenance reality — manuals in filing cabinets, PLC tags that don't match asset names, fault history in someone's head — into trusted, AI-ready context. FactoryLM builds the context; MIRA is the agent that proves it by diagnosing with citations.

**Positioning (one line):** FactoryLM is the **maintenance-context layer** that makes your messy reality (assets, documents, PLC tags, technician knowledge) trustworthy enough for AI — on top of *any* UNS. MIRA is the grounded agent that proves it. *(Delivered product-led + self-serve; hands-on structuring is a land-assist, not the only path.)*

---

## What We Are / What We Are Not

| We are | We are not |
|---|---|
| The maintenance-context layer (FactoryLM) + the grounded agent that proves it (MIRA) | An "AI CMMS" vendor / a bolt-on copilot |
| Product-led + self-serve (the $500 Assessment is a *land-assist*, not the only door) | A bare seat-licensed SaaS that assumes your data is already structured |
| The layer that structures your maintenance context — on top of any UNS | Trying to replace Ignition, MaintainX, Fuuz, or your historian |
| The maintenance side of UNS that copilots assume away | A pure plumbing/UNS platform with no diagnostic brain |

**Walker rule:** infrastructure first, AI second. Never lead with "AI CMMS."

---

## ICP (Ideal Customer Profile)

**Primary:** Industrial maintenance leadership at SMB / mid-market manufacturers (50–500 employees, 2–20 technicians). Plant manager or maintenance manager owns the budget. One unplanned downtime event costs $10K+.

**Pain:**
- "Our manuals are in three filing cabinets, two SharePoints, and one tech's truck."
- "Our PLC tag names don't match the asset names in the CMMS."
- "When the senior tech retires next year, we lose 30 years of fault history."
- "We tried an AI tool. It hallucinated. Of course it did — we never gave it the context."

**Secondary:** OEM service organizations and independent maintenance contractors who want to layer this on top of their service contracts.

---

## The Three Offers

| Offer | Price | What we deliver | Who it's for |
|---|---|---|---|
| **Assessment** | **$500** (one-time) | We walk your floor (in person or remote), score your Maintenance AI Readiness, deliver a written gap report + namespace blueprint | Plants exploring; the wedge |
| **Pilot** | **$2K–5K/mo** (3-month minimum) | We structure one line / one cell: nameplates scanned, manuals indexed, PLC tags mapped, PMs extracted, fault history captured. MIRA goes live on that scope. | Plants that scored low on assessment and want proof on a bounded slice |
| **Operating Layer** | **$499/mo** (per plant, ongoing) | MIRA in production across the plant. Telegram + web + CMMS integration. Quarterly namespace audits. Continuous structuring as new assets come online. | Plants who finished a pilot or who already have decent structure |
| **Enterprise** | Custom | Multi-site rollout, dedicated transformation lead, on-prem option, SLA | 5+ plants, OEM partners |

**Why this stack works:** the $500 assessment is a low-friction yes for a plant manager with discretionary spend. It seeds the pipeline for the high-margin pilot and the recurring operating layer.

---

## The Wedge: Maintenance Intelligence Namespace

UNS (Unified Namespace) is the buzzword every consultant is selling to operations. **Nobody is structuring the maintenance side of UNS.** That is our niche:

- **Asset hierarchy** — machine → sub-component → motor → relay → switch
- **Document binding** — every manual, datasheet, drawing tied to the asset it serves
- **PLC tag ↔ asset reconciliation** — the tag `LINE3_VFD1_CURRENT` knows it lives on Asset POW-755-A12
- **Fault & PM history** — captured, structured, queryable
- **Tribal knowledge capture** — the senior tech's voice notes become structured RCA records

Once that namespace exists, AI (MIRA) becomes useful. Without it, every AI tool hallucinates.

---

## GTM Motion

**Stage 1 (now → expo): Direct + LinkedIn**
- LinkedIn re-engagement (Week 1 war story posts, CRA-265) — lead with infrastructure problems, not AI features
- Digital Transformation Scorecard (`/assess`) as the lead magnet — converts to $500 assessment booking
- Expo demo (3-minute script below) — hand prospects the phone to take the scorecard themselves
- Goal: 5 assessments booked in 30 days; 1–2 convert to pilot

**Stage 2 (expo → 90 days): Pilot proof + content**
- Run 2–3 paid pilots, document the before/after namespace
- Each pilot becomes a case study (with permission) — these are the LinkedIn artifacts that close the next 10
- Begin OEM service-organization outbound (they have plants, no transformation capability)

**Stage 3 (90+ days): Partner channel**
- VFD distributors, OEM service desks, MEP firms as referral partners
- The pilot deliverable is repeatable enough that partner techs can be trained on it

---

## Competition

| Who | What they do | Why they don't compete |
|---|---|---|
| MaintainX / UpKeep / Limble | Self-serve CMMS | They sell software to people who already have structured data. We're the firm that creates the data. We integrate, we don't replace. |
| UNS consultancies (Walker, 4IR, etc.) | Operations namespace | They focus on production data (OEE, throughput). Maintenance is an afterthought. |
| AI maintenance tools (Augury, etc.) | Vibration / sensor analytics | Narrow vertical, hardware-led, no document or knowledge layer. |
| Big SIs (Accenture, Deloitte) | Enterprise digital transformation | Won't touch a 200-person plant. Wrong price point, wrong scale. |

**Unique moat:** we are the only firm that (a) does the hands-on namespace structuring AND (b) ships the AI execution layer that runs on top of it. Pure consultancies leave you with a binder. Pure SaaS leaves you hallucinating. We do both.

---

## Key Metrics

1. **Assessments booked / month** — top of funnel
2. **Assessment → Pilot conversion rate** — value of the gap report
3. **Pilot → Operating Layer conversion rate** — proof that structuring works
4. **Active Operating Layer plants** — recurring revenue base
5. **MRR** — business health

---

## Decision Filter

Every feature, every post, every sales call — ask: **"Does this help us structure a customer's maintenance namespace, or prove that structuring works?"**

If yes → build/do it. If no → defer.

A second filter applies to all marketing copy: **"Would an industrial buyer who hates AI hype still find this credible?"** If not, rewrite it.

---

## Docs Reference

| Document | Path |
|---|---|
| Technical flywheel | `NORTH_STAR.md` |
| 90-day MVP plan | `docs/plans/2026-04-19-mira-90-day-mvp.md` |
| 3-minute demo script | `docs/demo/3-minute-demo-script.md` |
| Brand & positioning | `docs/brand-and-positioning-2026-04-26.md` |
