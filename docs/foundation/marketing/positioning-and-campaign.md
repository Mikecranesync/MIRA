# FactoryLM positioning and first campaign: CMO decisions
*Oct 10, 2026. These are decisions, not options. Built on `competitor-teardown.md` and `/workspace/factorylm-market-entry-analysis.md`. Every customer-facing claim below is limited to what MIRA has proven: cited answers from a plant's own uploaded OEM manuals, with the page shown (Oct 4 audit: Rockwell Micro810 manual cited p.57; Sept 5 Festo test: declined an uncovered question, then cited SPC200 p.7), in the mobile app and the Hub notebook at app.factorylm.com.*

> **Launch gate (non-negotiable):** no outbound email, no pilot sale and no "Manual Check" offer until the three P0 fixes pass the 30-question check: short fault codes (F0004, oC) hit the fault table, a New chat control exists, and answers not drawn from the plant's manuals are labeled "general, not from your manuals." Content and the website rewrite can start now. One wrong answer in a breakdown costs us the plant.

> **STATUS UPDATE (Oct 10, 2026, later):** Mike said "do not activate email campaign yet." **Cold email is ON HOLD until Mike lifts it.** The first campaign now leads with the guerrilla plan in `guerrilla-playbook.md` (Free Manual Check, "Show me the page" clips, QR manual stickers, no-link forum help, repair-shop/integrator partners, the local circuit incl. SMRP Florida Nov 6, and Stump MIRA after the P0 gate). Section 4 below has been rewritten to match.

---

## 1. Positioning

**Positioning statement**
> For maintenance managers at single-site plants of 50–500 people, whose 2–15 person crews keep mixed-brand equipment running, **FactoryLM is the plant's manual desk**: we load the OEM manuals for your line, your crew asks in plain English, and every answer shows the manual and page it came from, so a tech can check it before touching the machine. Unlike CMMS add-ons that need you to switch systems and buy the top tier, and unlike ChatGPT, which answers whether or not your manual says so, FactoryLM works beside whatever you use today, at one flat price per site.

**The one enemy: the guess.** That means the tech at 2 a.m. who can't find the binder, so he Googles the code or asks ChatGPT and gets a confident answer nobody can trace to a page. We name it plainly: "the PDF hunt and the phone guess." This is the right enemy because:
- It's what our buyer actually does today. ChatGPT is free, and it already reads uploaded PDFs, so we never claim it can't. Our line is that **it answers either way, and it doesn't show which part came from your manual.**
- It keeps us from fighting MaintainX, Fiix and Tractian head-on. We sit beside their CMMS ("keep your CMMS").
- The look-alike startups (YAFEX, Quintess, Rheba, Satori, Machine Pilot) all fight the same enemy. We beat them on **US small-plant focus, a founder on your floor, published flat price, and proof on your own manual before you pay.**

**Category name we use:** "cited manual assistant" in copy; "manual desk" as the product idea. We drop "Maintenance Intelligence Namespace" from all buyer-facing copy. It's jargon, and most of what it promises isn't proven.

---

## 2. factorylm.com homepage (beachhead version)

**Headline (final):**
> **Ask your plant's manuals. Get the answer and the page it's on.**

**Subhead (final):**
> FactoryLM loads the OEM manuals for one production line, any brand, and your maintenance crew asks questions in plain English. Every answer from your manuals shows the manual and page, so your techs can check it before they touch the machine. Start with a 30-day pilot for $500.

**Primary CTA:** "Start a $500 pilot" → short form. **Secondary CTA:** "Send us one manual and 3 questions" (free Manual Check; launches after the P0 gate).

**3 proof bullets (all proven today):**
1. **The page, every time it's from your manual.** In our Oct 4 test on a Rockwell Micro810 manual, MIRA answered and pointed to page 57. *(Show the real screenshot, not a mockup.)*
2. **It says when your manual doesn't cover it.** In a Festo test, MIRA declined a question the manual didn't answer, then answered a covered one citing SPC200 page 7.
3. **Mixed brands, one place.** Manuals from different makers (we've tested Rockwell and Festo) live in one library your crew asks from the web at app.factorylm.com or the FactoryLM app. *(Say "app" only once crew phones can actually install it. Today the app is sideloaded; until then say "from the web".)*

**Section to add: "What we don't do yet."** Keep the Limitations page, and link it from the homepage. Honesty is our edge over YAFEX-style stat walls.

### Current factorylm.com claims to remove or soften (fetched Oct 10, 2026)
| # | Current claim (where) | Action | Why |
|---|---|---|---|
| 1 | "Cited troubleshooting answers from your manuals, assets, and fault history." (home H2) | **Soften** → "Cited answers from your manuals." | Fault-history answers not proven |
| 2 | "Your PLC tags don't match your asset names", "PLC tags reconciled to assets", "LINE3_VFD1_CURRENT now knows it lives on Asset POW-755-A12. AI can finally cross the IT/OT gap.", "Map fault history, CMMS & PLC tags" (home, pricing) | **Remove** | PLC-tag mapping not proven; own Limitations page says no PLC tag streaming |
| 3 | PowerFlex 755 F005 example with asset ID, "4 trips… all overnight", "your 2024-12-14 PM noted bulging on cap 3" (home, /cmms) | **Remove**; replace with the real Micro810 p.57 answer | Made-up example showing unproven features |
| 4 | "68,000+ chunks of OEM documentation indexed" + brand row (Allen-Bradley, Siemens, ABB, Schneider, Yaskawa, Mitsubishi, Rockwell, Honeywell) (home) | **Remove** the number unless re-counted; replace the logo row with plain text "Works with manuals from any maker" | Count unverified; logo row reads as endorsement |
| 5 | "Draft PMs & work orders — synced to your CMMS", "CMMS write-back (MaintainX, Limble, UpKeep, Atlas)", "The Operating Layer writes work orders into it automatically" (home, pricing, /buy, /cmms) | **Remove** | Not proven; it also contradicts the Security page ("There are no automated write-backs") |
| 6 | "A technician asks… in Slack, Telegram, or the web" / "Telegram + web" (home, pricing) | **Soften** to channels live today (web + app) | Slack/Telegram not in proven inventory |
| 7 | "Senior tech's voice notes become structured RCA records. The 30-year fault history doesn't retire with them." (home) | **Remove** | Own Limitations page: RCA is "private alpha" |
| 8 | "⚠ STOP — MIRA detected 480 V on a 240 V branch via the photo you sent" (home mockup) | **Remove** | Photo-based voltage detection not proven |
| 9 | "Every answer cites its source", "Cited every time", "No hallucinations because the namespace exists", "Uncited speculative answers are blocked at the guardrail layer" (home, pricing, /cmms, /security) | **Soften** → "Answers from your manuals show the page." | Known gap: a notebook with no sources answers from general knowledge, unlabeled. Restore the stronger line only after P0 #3 ships |
| 10 | "LOTO, arc flash, and confined-space prompts… route to your safety contact" + "18 other high-consequence keywords" (security, limitations) | **Verify live or soften** to "MIRA won't give step-by-step answers for lockout, arc flash or confined space; it tells the tech to follow site procedure and get a supervisor" | Routing to a safety contact isn't in the proven inventory |
| 11 | Pricing: "$500 Assessment", "Pilot $2–5K/mo · 3-mo min", "Operating Layer $499/mo per plant", "Enterprise… on-prem option, SSO/SAML, SLA" (home, pricing, /buy) | **Replace** with $500 30-day pilot → $399/mo per site (up to 15 users, $500 credited). Remove Enterprise/SSO/on-prem | New offer; SSO, on-prem and SLA not proven |
| 12 | "Most plants start with the $500 on-site assessment" (home, pricing, /buy) | **Remove** | Implies existing customers; no paying customer on record |
| 13 | Pilot timeline: "first cited fault-code answers live", "PM candidates extracted from OEM manuals", "CMMS write-back tested", "Quarterly namespace audits", "Continuous structuring" (pricing) | **Remove** | Fault-code lookup is a known P0 bug; the rest is unproven |
| 14 | "Atlas (our own CMMS) is included if you have nothing" (limitations, pricing) | **Remove unless Atlas is live for customers** | Not in the proven inventory |
| 15 | "Knowledge Cooperative… Community tier… Free-tier tenants" (limitations) | **Remove** | References tiers that don't exist on the pricing page |
| 16 | "We use Groq, Cerebras, and Gemini" (security) | **Verify** against the providers actually in production now | Provider list may be out of date after the Groq/Cerebras billing outage |
| 17 | Meta description "We turn messy maintenance reality… into a structured Maintenance Intelligence Namespace" | **Rewrite** to match the new headline | Jargon + unproven scope |
| 18 | "Maintenance managers, Plant managers, Reliability engineers, Controls engineers & integrators" fit list | **Keep**, add "single-site plants, 2–15 person crews" | Fine; sharpen to the beachhead |

*Website edits go through the repo (Foreman's lane) as a PR for Mike to approve. Nothing ships without him.*

---

## 3. Three messaging pillars

| Pillar | What we say | Proof we can show | Competitor weakness it exploits |
|---|---|---|---|
| **1. Show me the page.** | "Every answer from your manuals shows the manual and page. Your tech checks it in ten seconds." | Micro810 p.57; Festo SPC200 p.7 | **ChatGPT/Gemini** answer whether or not your manual covers it, and don't separate manual from general knowledge. **YAFEX/Tractian/Dozuki** lead with stat walls ("35% less downtime", "401% ROI") and no visible proof of a single answer. |
| **2. Keep your CMMS. Skip the enterprise tier.** | "Works beside MaintainX, Fiix, Limble, UpKeep, or a spreadsheet. One flat price per site." | Published price: $500 pilot, $399/mo per site, up to 15 users | **MaintainX** Assist is Enterprise-only (custom pricing). **Fiix MAX** needs the $75/user Professional tier plus separate licenses, and can't read diagrams. **UpKeep** Nova runs on credits. A 10-tech crew on MaintainX Premium is ~$650/mo *before* the manual AI they can't get. |
| **3. Proof on your own manual before you pay.** | "Send one manual and three real questions. We send back cited answers. Then decide." A US founder who comes to your floor (Central Florida in person; remote anywhere). | The free Manual Check (after the P0 gate) | **YAFEX, Quintess, Satori, Siemens, Augmentir, Aquant** are demo-gated with no published price. **Rheba** and **Satori** are EU-focused; **Machine Pilot** is Australia-only and priced per machine ($890/mo for one machine). |

**Words we use:** manual, page, crew, line, breakdown, check it, any brand.
**Words we don't use:** namespace, agentic, transform, hallucination-free, guaranteed, % downtime reduction (until a pilot gives us a real number).

---

## 4. First campaign: "Show me the page" (guerrilla-led; cold email ON HOLD)

**Active plan:** `guerrilla-playbook.md` (6 weeks, Oct 12 – Nov 20). It runs entirely without cold email:
| Channel | Role | Mike's weekly time |
|---|---|---|
| **Free Manual Check** (one manual + 3 questions → cited answers in 1 business day, checked by Mike) | The CTA everywhere; the proof engine | up to ~1.5 h (5 requests) |
| **"Show me the page" clips + posts on Mike's LinkedIn** | Audience building with real recordings | ~1.5 h |
| **QR "manual on the machine" sticker kit** (free, links to OEM-hosted manuals) | Physical, useful lead magnet that works today | ~0.5 h |
| **No-link forum help** on PLCTalk, r/PLC, r/IndustrialMaintenance (real name, disclosed) | Trust with techs; Answer Radar supplies questions | ~1 h |
| **Repair-shop + integrator referral partners** (Central Florida) | Warm intros into target plants | ~1.5 h |
| **Local circuit** (SMRP Florida, Nov 6, Jacksonville; chapter meetings; plant front-office stops) | Face-to-face with the exact buyer | event weeks |
| **Stump MIRA challenge** (after the P0 gate, target week of Nov 9) | Public, honest proof stunt | ~2 h that week |
| SEO pages (comparison page + cited fault pages) | Background compounding | bots draft; Mike approves PRs |

**Cold email: ON HOLD.** The asset `assets/cold-email-pilot.md` stays drafted, unsent. Nothing is sent until Mike explicitly lifts the hold. When he does, email is used first as a *follow-up* to people met through the channels above, not as a cold blast. Marketing Lead brings a lift/no-lift recommendation at the week-6 review (Nov 20), and Mike decides.

**Goal by week 6:** ≥15 Manual Check requests (≥5 from beachhead plants) and ≥3 pilot conversations started, with zero cold email.

**Not now:** paid ads, booths, webinars, G2, any forum promotion, cold email.

---

*(Decision 5, the three ready-to-use assets, is in `assets/`.)*

## 6. Battlecard: us vs. the top 5
*Top 5 = the alternatives our beachhead buyer will actually name. Quintess and Satori are close in product but aim at fleets and EU sites; see the teardown.*

| | **FactoryLM** | **ChatGPT / Gemini** | **MaintainX Assist** | **Fiix MAX (Rockwell)** | **YAFEX** | **Rheba** |
|---|---|---|---|---|---|---|
| What it is | Cited manual assistant for one line, beside any CMMS | General AI in every tech's pocket | AI inside the MaintainX CMMS | AI chatbot inside the Fiix CMMS | Manual + work-order copilot for plants | Cited manual Q&A, EU |
| Shows the manual page | Yes (proven: Micro810 p.57, Festo p.7) | Not guaranteed | Links to manual pages (their help center) | Not confirmed; text only, no diagrams | Claims "sourced from your documentation"; page not confirmed | Yes, opens the page |
| Says when the manual doesn't cover it | Yes in testing; labeling general answers ships with P0 #3 | No | Not found | Not found | Not found | Yes (their claim) |
| Need to switch CMMS | No | No | Yes | Yes | No (sits beside) | No |
| Price (published) | $500 30-day pilot → $399/mo per site, up to 15 users | $0–$20/user/mo (Pro from $100) | Enterprise only, custom (Premium alone is $65/user/mo) | $75/user/mo Professional **+** MAX licenses (unpublished) | Not published | Not published |
| Setup | We load your line's manuals for you | Each tech uploads their own | You attach manuals per asset | You upload per asset (PDF/DOCX/TXT) | "Live in one hour" (self-upload) | Self-upload |
| US small-plant focus | Yes; founder can come on site (Central Florida) | n/a | Mid-market to enterprise | SMB to enterprise | US plants (borrowed logo wall) | No (EU residency) |
| **Their best line against us** | | "It's free and I already use it." | "We're your whole CMMS, with AI." | "It's Rockwell." | "35% less downtime, 4-minute answers." | "Shows the page and the diagram." |
| **Our answer** | | "Use it for general questions. When the line is down, you need the page from *your* manual, and you need to know when the manual doesn't say." | "Keep MaintainX. Their manual AI needs Enterprise. We're $399 flat beside it." | "MAX needs Professional plus licenses and can't read diagrams. We take any brand's manual without a CMMS change." | "Ask them for one cited answer on your manual before you buy. We'll do ours free." | "Same idea, but they're EU-hosted and EU-focused. We're US, on your floor, priced up front." |
| **Landmine to plant** | | "Ask ChatGPT a fault code from your drive. Then ask it what page that's on." | "Ask what tier includes manual answers, and the price for 10 users." | "Ask if MAX can read the wiring diagram." | "Ask which customers on the logo wall use YAFEX itself." | (rarely in US deals) |

**Where we lose today, honestly:** voice at the machine (Quintess), work-order history in answers (Quintess, YAFEX, MaintainX), SOC 2 (MaintainX, Fiix, Quintess, Tractian have it; we're "not yet audited" per our own Security page), native app in stores. Don't fight on these. Steer back to page-level proof, no CMMS switch, and price.
