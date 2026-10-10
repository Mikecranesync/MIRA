# FactoryLM positioning and first campaign: CMO decisions
*Oct 10, 2026. These are decisions, not options. Built on `competitor-teardown.md` and `/workspace/factorylm-market-entry-analysis.md`. Every customer-facing claim below is limited to what MIRA has proven: cited answers from a plant's own uploaded OEM manuals, with the page shown (Oct 4 audit: Rockwell Micro810 manual cited p.57; Sept 5 Festo test: declined an uncovered question, then cited SPC200 p.7), in the mobile app and the Hub notebook at app.factorylm.com.*

> **Launch gate (non-negotiable):** no outbound email, no pilot sale and no "Manual Check" offer until the three P0 fixes pass the 30-question check: short fault codes (F0004, oC) hit the fault table, a New chat control exists, and answers not drawn from the plant's manuals are labeled "general, not from your manuals." Content and the website rewrite can start now. One wrong answer in a breakdown costs us the plant.

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

## 4. First campaign: "Show me the page"

**Goal (4 weeks):** 100 named target plants contacted, 10 real conversations, 3 paid $500 pilots started. These are the analysis's continue/kill numbers.

**Channel mix (near-$0, founder-led):**
| Channel | Why | Share of effort | Copied from |
|---|---|---|---|
| **Personal cold email from Mike** to maintenance managers (25/week, each personalized) | Fastest path to a pilot; buyer is reachable; CAN-SPAM compliant | 40% | Standard founder-led B2B; YAFEX/Quintess are demo-gated, we lead with proof |
| **Mike's LinkedIn** (3 posts/week + 10 thoughtful comments/week on maintenance posts) | Builds trust before the email lands; costs only time | 25% | Quintess CEO's founder posts |
| **Free "Manual Check"** (one manual + 3 questions → cited answers in 1 business day, run by hand in the Hub) | The CTA in every email and post; converts curiosity into proof | 15% | Rheba "Test Your Manuals", Quintess "Bring a real fault" |
| **Warm intros + in-person** (Mike's network, Central Florida plants, local distributor reps and integrators, one local ISA/SMRP chapter meeting) | Highest close rate for a no-name vendor | 15% | Siemens/Fiix lean on partners; ours is the free version |
| **SEO pages** (1 comparison page + 2 cited fault pages/week via the Fault Page Writer) | Compounds after the campaign | 5% | MaintainX/YAFEX comparison pages; UpKeep free tools |

**Not now:** paid ads, trade-show booths, webinars, G2 (no customers to review yet), Reddit/PLCTalk promotion (PLCTalk bans commercial posts; forum replies stay pure help, no links).

**Tools:** HubSpot free CRM (pipeline), Mike's mailbox (sends), Buffer free (optional scheduling). Bots draft and Mike sends. No auto-posting, no auto-sending.

### 4-week calendar (starts Mon Oct 12, 2026)
| Week | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| **1 (Oct 12–16): Fix and build** | P0 fixes in progress (product). Marketing: approve this doc; open the website PR (claims removed, new hero) | Build the list: 100 plants (50–500 employees, single site, mixed AB/Siemens/Mitsubishi; Florida/Southeast first). Load to HubSpot | **LinkedIn post 1** (asset `linkedin-post-1.md`). Screenshot the real Micro810 p.57 answer for the site and posts | Draft comparison page "MaintainX Assist alternative for small plants" (facts only from the teardown) | **P0 gate: run the 30-question check.** Pass → week 2 sends. Fail → content only; outbound slips a week |
| **2 (Oct 19–23): First touch** | Send 13 personalized emails (asset `cold-email-pilot.md`) | **LinkedIn post 2**: "The answer was on page __" (a real Manual Check result with permission, or our own test) | Send 12 emails. Ask 5 people in Mike's network for one intro each | **LinkedIn post 3**: why we publish our price | Friday scorecard; run any Manual Checks that came in (1-day turnaround) |
| **3 (Oct 26–30): Follow up + new list** | Follow-up #1 to week-2 non-replies (short, adds one cited example). 13 new emails | **LinkedIn post 4**: "What FactoryLM doesn't do yet" (honesty post) | 12 new emails. Visit 2 local plants in person (Central Florida) | **LinkedIn post 5**: a tech-level tip from a manual with the page cited | Demos on prospects' own manuals; close pilots ($500, card or invoice) |
| **4 (Nov 2–6): Close + start pilots** | Follow-up #2 (breakup email). 25 final new emails across the week | **LinkedIn post 6**: the pilot offer, plainly | Pilot kickoffs: load up to 25 machines' manuals per pilot by hand | Publish comparison page + 2 fault pages (PR, Mike approves) | **Campaign review** against the targets: ≥3 pilots → keep going; <2 pilots after 25 conversations → pivot test to integrators |

**Friday scorecard (5 numbers):** emails sent / replies / Manual Checks requested / demos held / pilots paid.

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
