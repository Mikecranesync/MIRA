# MIRA — Ideal Customer Profiles (ICP)

> **Status:** First draft — items marked `[CONFIRM WITH ME]` need Mike's input.
> **Last updated:** 2026-04-13

---

## ICP 1: Mid-Market Manufacturing Plant (Direct Sale)

### Firmographics
- **Industry:** Discrete or process manufacturing (automotive parts, food & bev, plastics, packaging, metals)
- **Revenue:** $10M–$250M `[CONFIRM WITH ME — is this the right range or are you targeting larger?]`
- **Headcount:** 50–500 employees at the facility level
- **Maintenance team size:** 3–20 technicians
- **Equipment mix:** Multi-vendor (Rockwell/Allen-Bradley, Siemens, ABB, SEW, Yaskawa)
- **Geography:** North America initially `[CONFIRM WITH ME — US only? Canada? Are you open to international?]`

### Pain Signals (How to Spot Them)
- Posting job ads for maintenance techs (they can't find enough people)
- Retiring senior technician mentioned in LinkedIn posts or trade publications
- Recent equipment investments (new VFDs, PLCs, motor upgrades) — they need to train people on new gear
- Complaints about downtime in earnings calls or industry forums
- Using spreadsheets or paper for maintenance tracking (no CMMS or unhappy with current CMMS)

### Decision Makers
| Role | Title Variations | What They Care About | Objection to Expect |
|------|-----------------|---------------------|-------------------|
| **Economic Buyer** | Maintenance Manager, Maintenance Director, VP of Operations | Downtime cost, headcount gaps, training burden | "We can't put our data in the cloud" → Config 1 on-prem |
| **Technical Champion** | Reliability Engineer, Controls Engineer, Lead Tech | Tool quality, accuracy, integration with existing systems | "Will it know our specific equipment?" → show KB ingest |
| **Executive Sponsor** | Plant Manager, VP Manufacturing, COO | ROI, operational risk, competitive advantage | "What's the payback period?" → downtime math |

### Buying Triggers
- Senior maintenance tech retiring or leaving in next 6 months
- Unplanned downtime event that cost significant money
- New equipment installation (need to onboard techs fast)
- CMMS replacement or upgrade cycle
- Corporate mandate to reduce maintenance costs or improve OEE

### Deal Profile
- **ACV range:** `[CONFIRM WITH ME — what are you thinking for pricing? $500/mo SaaS? $5K-$20K/yr?]`
- **Sales cycle:** 2–6 months `[CONFIRM WITH ME]`
- **Typical entry point:** Cloud Free tier → pilot with one shift/one line → expand
- **Expansion path:** Cloud Free → Config 1 box → add vision (Config 3) → add CMMS → multi-site

---

## ICP 2: Water/Wastewater Utility (Direct Sale)

### Firmographics
- **Industry:** Municipal or investor-owned water treatment, wastewater treatment
- **Size:** Serving 10K–500K population
- **Maintenance team size:** 2–10 technicians (often very lean)
- **Equipment mix:** Pumps, blowers, VFDs, SCADA systems, chemical feed systems
- **Geography:** North America

### Why This Vertical
- Extremely lean maintenance teams — one tech might cover multiple facilities
- Equipment is standardized (fewer manufacturers to support in KB)
- Regulatory pressure on uptime (EPA compliance, consent decrees)
- Aging workforce is acute — hard to recruit to utilities
- Often technically progressive but budget-constrained (perfect for Cloud Free entry)

### Pain Signals
- EPA notices or consent decree mentions
- Job postings for water/wastewater operators with maintenance duties
- Budget discussions in public utility commission filings
- SCADA upgrade projects (they're modernizing)

### Decision Makers
| Role | What They Care About |
|------|---------------------|
| **Utility Director / Superintendent** | Compliance, staffing, budget justification to board |
| **Lead Operator / Maintenance Lead** | Practical tool that helps the night shift handle problems |
| **City/County Manager** | Cost savings, risk reduction |

### Deal Profile
- **ACV range:** `[CONFIRM WITH ME — likely lower than manufacturing, but stickier]`
- **Sales cycle:** 3–9 months (government procurement can be slow)
- **Entry:** Cloud Free or pilot program

---

## ICP 3: Equipment OEM / Distributor (Channel Partner)

### Firmographics
- **Type:** Manufacturer or authorized distributor of industrial equipment (VFDs, PLCs, motors, pumps)
- **Key targets:** Rockwell/Allen-Bradley distributors, Siemens solution partners, ABB channel partners
- **Revenue:** $50M+ (large enough to have a service arm)

### Why They Partner
- **Value-add differentiation.** "Buy your PowerFlex from us, and your techs get AI-powered troubleshooting for it." This is a differentiator against other distributors selling the same catalog.
- **Service revenue.** They can bundle MIRA as a subscription on top of equipment sales.
- **Customer retention.** Ongoing MIRA subscription creates a relationship beyond the one-time equipment sale.
- **Reduce support burden.** Their own support hotline gets fewer "how do I fix fault code X" calls.

### Decision Makers
| Role | What They Care About |
|------|---------------------|
| **VP of Sales / Commercial Director** | New revenue streams, deal differentiation |
| **Service / Aftermarket Director** | Support deflection, customer satisfaction |
| **Technical Director** | Product quality, API integration, knowledge accuracy |

### Deal Structure
- **Model:** Revenue share or white-label licensing `[CONFIRM WITH ME — what model are you leaning toward?]`
- **Integration:** MIRA's KB pre-loaded with that OEM's equipment manuals
- **Co-marketing:** Joint case studies, trade show presence
- **Pilot:** 3–5 of their customers run MIRA for 90 days

---

## ICP 4: Industrial Automation Integrator (Channel Partner)

### Firmographics
- **Type:** System integrators who design, build, and maintain automation systems for plants
- **Size:** 20–500 employees, regional or national
- **Examples:** CSIA member firms, Rockwell Solution Partners, Siemens Approved Partners

### Why They Partner
- **Service revenue multiplier.** They already sell ongoing support contracts — MIRA enhances the value of those contracts.
- **Talent leverage.** Their own technicians use MIRA to handle more clients with the same headcount.
- **Competitive moat.** "We include AI-assisted diagnostics with every support contract" — hard for competitors to match.

### Deal Structure
- **Model:** Reseller agreement or embedded OEM license
- **Integration:** They load their clients' equipment manuals into MIRA's KB during commissioning
- **Expansion:** Each new client site they commission = new MIRA deployment

---

## Disqualifiers (Who Is NOT an ICP)

- **Single-machine shops** — Not enough equipment complexity or downtime cost to justify
- **Plants with 100% outsourced maintenance** — No internal team to use MIRA (but their maintenance contractor might be ICP 4)
- **Companies that won't allow any cloud or any AI** — Config 1 helps, but some are categorically opposed
- **Hobbyist / home workshop** — Not the target market, even for free tier

---

## Outreach Messaging by Persona

### To Maintenance Manager:
> "What happens on your floor when a tech hits a fault code they haven't seen before? MIRA gives every tech on every shift instant access to diagnostic guidance — pulled from your actual equipment manuals, delivered right in Slack. No app to install, no training to schedule."

### To Plant Manager:
> "If one hour of unplanned downtime costs you $[X], MIRA pays for itself the first time it turns a 4-hour troubleshoot into a 30-minute fix. Your techs already use Slack — MIRA meets them there."

### To OEM/Distributor VP Sales:
> "Your competitors sell the same catalog. What if your customers got AI-powered troubleshooting for every piece of equipment they buy from you? MIRA pre-loaded with your product manuals — your logo, your value-add."

### To Integrator Service Director:
> "You're already the trusted advisor for your clients' automation systems. MIRA lets you offer AI-assisted diagnostics as part of your support contracts — more value, same headcount."
