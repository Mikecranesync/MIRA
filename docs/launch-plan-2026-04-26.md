# MIRA Launch Plan — Maximum Visibility, Money Soon

**Generated:** 2026-04-26
**Companions:** `docs/sales-audit-2026-04-26.md`, `docs/sales-implementation-plan-2026-04-26.md`, `docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md` (codex recon)
**Author:** Cowork
**Frame:** Apply campaign-planning skill (Objective → Audience → Message → Channel → Measure) to MIRA's situation. Goal: maximize visibility *and* close revenue inside 6 weeks.

---

## TL;DR

Product Hunt is overrated for industrial AI but worth doing as **one of 13 venues**. Real plant-maintenance customers are not on PH; they're on PLCTalk.net, Reddit r/PLC + r/Maintenance, YouTube tutorial channels, and trade newsletters. The best money-soon play stack — in priority order — is:

1. **Codex's landing-page fixes** (passwordless `/cmms`, trust band, real product surface) — ship before you point any traffic at it.
2. **MIRA Bench-off** — public benchmark of MIRA vs ChatGPT/Claude/Gemini/Perplexity on 50 real industrial fault codes, posted on r/PLC + Show HN + LinkedIn the same day. Cost: ~$50 in API calls. Generates the credibility Factory AI gets from logos.
3. **Sticker-in-the-wild Tour** — mail 100 free sticker packs to industrial podcast hosts, plant-tour YouTubers, OEM employees, trade journalists, accelerator alumni. Cost: ~$200. Each gets a personal note from Mike. Some will post. Each post = thousands of free industrial impressions.
4. **PLCTalk.net + 4 Reddit launches in same week** — they're free, they're exactly your ICP, and one good Reddit post per week = 50K-200K impressions inside the audience.
5. **Product Hunt** — schedule for a Tuesday-Thursday 6-8 weeks out so the recon fixes ship first. Not the silver bullet — the social-proof artifact you cite to plant managers afterwards.

Stop optimizing top-of-funnel until codex's landing-page critique is fixed; shipping traffic to a sparse hero with no trust signals burns visits. Ship the survey first (`docs/customer-usability-survey-2026-04-26.md`), then the homepage refresh, then the venues below in waves.

The 4 stuck $499 deals + 91 dormant contacts you have today are a faster path to first revenue than any external launch — the launch venues are for *second* revenue, the moat, and the press story. Don't conflate them.

---

## 1. Objective — what success looks like

**SMART objective:** *Generate 25 paying MIRA pilots ($97-499/mo) and 5,000 inbound qualified visitors from industrial maintenance audiences by 2026-06-21 (8 weeks).*

| Layer | Target by Jun 21 | Today |
|---|---|---|
| First paying customer (any source) | 1 | 0 |
| Total paying pilots | 5-10 | 0 |
| Marketing-qualified visits (industrial role identifiable) | 5,000 | unknown |
| Magic-inbox manuals submitted | 100+ | 0 |
| Fault-code PDF email captures | 200+ | 0 |
| Branded press / podcast mentions | 3+ | 0 |
| Stickers in the wild (photographed and posted) | 30+ | 0 |
| GitHub stars on fault-code library (if open-sourced) | 250+ | 0 |

These targets are intentionally ambitious; if you hit 50% of them you're already winning. The point is a portfolio of motions, not a single bet.

---

## 2. Audience — who you're trying to reach

> "Plant maintenance managers, reliability engineers, and lead techs at small-to-mid manufacturers (50-500 employees) who are tired of digging through 2,000-page OEM PDFs at 2am to reset a VFD fault. They discover tools through PLCTalk.net, Reddit r/PLC and r/Maintenance, YouTube tutorial channels, OEM forums, and trade publications like Reliable Plant. They care most about: a) does it actually work on *my* equipment, b) can I get value in the next 10 minutes without IT involvement, c) does it embarrass me with bad answers in front of my crew."

Three sub-segments to design for:

| Segment | Who | Where they live | Tone |
|---|---|---|---|
| **The Practitioner** | Maintenance tech, reliability engineer | Reddit, PLCTalk, YouTube tutorials, Telegram, TikTok | Direct, skeptical, no-fluff. Show, don't tell. Demo > deck. |
| **The Buyer** | Maintenance manager, plant manager, ops director | LinkedIn, trade publications, SMRP, conferences | Outcome-driven, ROI-focused, risk-averse |
| **The Influencer** | Industrial podcast hosts, plant-tour YouTubers, OEM application engineers, professors | Twitter/X, LinkedIn, podcasts, YouTube | They want a unique angle for their content |

Mike, you yourself match The Practitioner persona — write copy that you'd respond to, not copy a SaaS marketer would write.

---

## 3. Message — what to say

### Core message

**"MIRA is the AI troubleshooter that knows your equipment — drop a sticker on your worst machine, scan it next time it breaks, and get the answer from the OEM manual in 10 seconds."**

This is a slight tightening of your current homepage. It does three things at once: (a) names the category (AI troubleshooter), (b) names the differentiator (knows YOUR equipment), and (c) names the mechanic (sticker → scan → answer). Most maintenance copy fails at (c) — they sell the abstract, you sell the gesture.

### Supporting messages (campaign repeatables)

| # | Message | Audience | Proof point |
|---|---|---|---|
| 1 | "68,000 chunks of OEM documentation already indexed. Rockwell, Siemens, AutomationDirect, ABB, Yaskawa, Danfoss." | Buyer | Live KB; show the count on the homepage |
| 2 | "Works alongside MaintainX, Limble, UpKeep — no migration." | Buyer | Already on your homepage; lean harder |
| 3 | "Forward a manual to manual@factorylm.com, ask MIRA anything from it. Free." | Practitioner | Magic-inbox public path (Phase 2) |
| 4 | "Site license, not per-seat." | Buyer | Pricing page |
| 5 | "Cited answers — every response shows the manual page it came from." | Practitioner + Buyer | Citation gate already shipped (per hot.md) |
| 6 | "Safety-critical questions (LOTO, arc flash, confined space) escalate to a human, not generic chat." | Buyer | Already in `mira-bots/shared/guardrails.py` (21 phrase triggers) |

### Three taglines for A/B testing in ads

- "The AI troubleshooter that knows your equipment." *(current — keep, codex liked it)*
- "Stop digging through 2,000-page manuals at 2 AM."
- "Scan the sticker. Get the answer. Get back to work."

### What NOT to say

- Don't say "AI-powered" without immediately showing what it does. Plant managers have heard "AI" 800 times this year.
- Don't compare to ChatGPT in your headlines — it positions you as a derivative. Compare in benchmarks where you can show MIRA wins on your domain.
- Don't promise zero downtime. You can't deliver it and your buyers know it.

---

## 4. Channels — ranked launch venue stack

Each entry has effort, cost, ICP fit, and money-soon score (1-5 each, 20 max). "Money-soon" weighs whether this venue produces a lead Mike could close in <30 days.

### Tier 1 — Ship these first (highest ROI, lowest cost)

#### V1. **Codex's landing-page fixes**
*Effort 4 / Cost $0 / ICP 5 / Money-soon 5 = 14*

Not a venue, but a prerequisite. Per `docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md`:

- Replace `/cmms` form with passwordless magic-link entry (email field only, then send link)
- Land users in seeded sample workspace with a pre-loaded VFD manual + 3 example questions
- Add trust band under the homepage hero (logos placeholder — can use OEM brands you have data for: "Rockwell, Siemens, AutomationDirect, ABB, Yaskawa indexed" until you have customer logos)
- Replace the static chat mockup with a live diagnostic that animates one example
- "No credit card required" tagline near the CTA
- One concrete customer-outcome strip ("Plant tech at GMF Steel diagnosed E07 in 8 seconds — case study →") — placeholder until you have a real one

**File new GH issues:** #SO-070 (passwordless `/cmms`), #SO-071 (homepage trust band), #SO-072 (animated hero diagnostic), #SO-073 (seeded sample workspace).

Without these, every dollar of paid traffic is wasted and every PR mention bounces. Ship within 7 days.

#### V2. **PLCTalk.net + 4 Reddit launches (same week)**
*Effort 2 / Cost $0 / ICP 5 / Money-soon 4 = 11*

PLCTalk.net is the single highest-trust forum in your audience. Subreddits next:

| Forum | Subscribers | Fit | Approach |
|---|---|---|---|
| PLCTalk.net | ~120K | Bullseye | Post in "PLC Programming and HMI Software" or "Other Topics" — be a contributor first (answer 5 fault questions over 2 weeks), then post your tool with humility. Mods ban self-promo. |
| r/PLC | 130K | Bullseye | "Built a thing that lets techs scan a sticker and chat with the OEM manual — would love feedback." Lead with a Loom. |
| r/Maintenance | 60K | Strong | Same post, slight reframe ("...for the maintenance side"). |
| r/MaintenanceandReliability | 24K | Strong | Same. |
| r/Manufacturing | 250K | Medium | Broader — frame around the problem ("how do you teach a new tech a 30-year-old plant?"). |

Posting cadence: 2 forums Tuesday, 2 Thursday, 1 Saturday (different week to avoid spam look). Each post = 60-90 minute time investment for response engagement. Don't post and run.

#### V3. **Show HN + Hacker News**
*Effort 2 / Cost $0 / ICP 3 / Money-soon 3 = 8*

HN's audience isn't maintenance staff but it IS curious engineers, founders, and journalists who can amplify. Best post format:

> **Title:** Show HN: I scanned a QR sticker on a VFD and it answered me from the manual
> **First sentence:** Long story short, I built MIRA because I got tired of digging through 2,000-page manuals at 2am.
> **Demo:** Live link — `manual@factorylm.com`. Forward me a manual right now and I'll watch the inbox for 24 hours. Or scan the QR at factorylm.com/m/demo to try the chat.

Time it for Tuesday 9 AM ET — peak HN traffic. Stay in the comment thread for 12 hours straight. A front-page Show HN = 10K-50K visits, 10-100 signups, 2-3 journalist DMs.

#### V4. **The MIRA Bench-off** *(outside-the-box centerpiece)*
*Effort 3 / Cost $50 / ICP 4 / Money-soon 4 = 11*

Run a public, reproducible benchmark: MIRA vs ChatGPT-5 vs Claude Opus 4.6 vs Gemini 3 vs Perplexity Pro on **50 real industrial fault codes** (Rockwell, Siemens, AB, AutomationDirect, ABB). Score each on:
- Correctness (does it match the OEM manual answer?)
- Citation (can you find the page it came from?)
- Safety (does it escalate LOTO/arc flash properly?)
- Latency (under 5 sec?)

Publish results to `factorylm.com/benchmark`. Open-source the test set on GitHub. Tweet/Linkedin/HN a single chart. **MIRA will win on Citation and Safety even if it's mid on raw correctness — that's your unique angle.**

This single artifact:
- Generates a press story that writes itself
- Becomes the proof point in every cold email going forward
- Gives r/PLC something to argue about (engagement = reach)
- Costs ~$50 in API calls

Treat the results page as the lead-magnet PDF too — gate the full results behind email capture.

**Issue:** #SO-074 — MIRA Bench-off setup + publish.

#### V5. **Sticker-in-the-Wild Tour** *(outside-the-box centerpiece)*
*Effort 3 / Cost $200 / ICP 4 / Money-soon 3 = 10*

You're already mailing stickers to plant managers (Phase 1). Do the same for a hand-picked list of 100 industrial influencers:

| Group | Examples | Why |
|---|---|---|
| Industrial podcast hosts | The Maintenance Phoenix, Reliability Radio, Modern Manufacturing podcast, Manufacturing Hub, Smart Factory Insights | They have audiences |
| Plant-tour YouTubers | Tim Wilborne, RealPars, Practical Engineering, Smarter Every Day (long shot, mention MIRA + a free pack) | Reach + authority |
| OEM application engineers | LinkedIn search "Application Engineer Rockwell/Siemens/AB" — find 30 active posters | Insider distribution |
| Trade journalists | Reliable Plant, Plant Engineering, Manufacturing.net editors | Press pipeline |
| Accelerator alumni | Greentown, MassRobotics, Techstars STANLEY+ peers | Mutual signal-boost |

Each gets the same kit (10 stickers + setup card + handwritten Post-It) plus a one-line note: *"Stick one on something at your facility / shoot. Tag @factorylm if you do. — Mike."*

Even at 5% post rate, that's 5 industrial influencer posts. Cost ~$200 + 6 hours of address-finding.

**Issue:** #SO-075 — Influencer sticker list + outreach.

### Tier 2 — Wave 2, after V1-V5 (week 3-4)

#### V6. **YouTube collaborations (sponsored mentions)**
*Effort 3 / Cost $500-2000 / ICP 5 / Money-soon 3 = 11*

Tim Wilborne (PLC tutorials, ~70K subs), RealPars (~250K subs), AutomationDirect's own channel (~150K), EE Power. Sponsor a short mention or a dedicated tutorial ("I built a fault-code lookup with MIRA"). Cost ranges $500-3000 per video. One good sponsorship = 50K-500K direct ICP impressions. Reach out via email with a personal Loom of MIRA solving a fault on equipment they cover.

#### V7. **Trade publication guest posts**
*Effort 3 / Cost $0 / ICP 5 / Money-soon 2 = 10*

Pitch a guest post on:
- *Reliable Plant* — "How AI is actually being used on the maintenance floor in 2026"
- *Plant Engineering* — "The 2 AM problem: troubleshooting drives without a senior tech on shift"
- *Manufacturing.net* — "What plant maintenance can learn from RAG"
- *Industrial Machinery Digest* — "QR code sticker on a VFD: the lowest-friction maintenance UI"
- *Maintenance Technology* — "Why your CMMS is a database, and what a plant tech actually needs"

Aim for 1,200-1,800 words. Lead with the customer story, mention MIRA in para 8 with a soft link. Trade pubs are starved for thoughtful content from operators (you ARE one). They publish in 2-4 weeks.

#### V8. **LinkedIn personal-brand consistency**
*Effort 2/day / Cost $0 / ICP 5 / Money-soon 4 = 11*

Mike, you should be posting on LinkedIn 3x/week for the next 8 weeks. Format mix:
- 1× story post: "the time a tech at a steel plant asked MIRA an E07 and it nailed it"
- 1× framework post: "5 things every maintenance manager should know about industrial AI"
- 1× build-in-public post: "shipped this PR today — a passwordless magic-link trial. Here's why."

Engage *every day* on Plant Services / Modern Manufacturing / SMRP / Maintenance Phoenix posts. After 30 days the algorithm shows your stuff to your industry. Cost: 30 min/day, free.

#### V9. **Industrial Beehiiv newsletters**
*Effort 1 / Cost $200-500 each / ICP 5 / Money-soon 3 = 9*

Sponsorship slots:
- *Reliability Connect* (~$300/issue, 25K plant-leader subscribers)
- *Modern Manufacturing newsletter* (~$500/issue)
- *IndustryDive Plant Operations Today* (~$1500/issue, larger reach)
- *MRO Insider* (~$200/issue, niche)

One sponsored slot per newsletter = 1 week visibility. Aim for 2 in week 4-5.

#### V10. **Product Hunt — scheduled for Tue/Wed in week 7**
*Effort 4 / Cost $0 / ICP 2 / Money-soon 2 = 8*

Product Hunt's audience is mostly developers, designers, and PMs — not plant maintenance. So why launch?

1. **Press pickup** — TechCrunch, The Information, Ars sometimes scan top PH launches
2. **Social proof artifact** — "PH Product of the Day" badge in cold emails for the next 6 months
3. **Tech-adjacent decision-makers** — some plant ops managers DO sit at the intersection (smart-factory architects)
4. **Maker community** — startup founders share PH wins broadly
5. **Backlinks** — PH is a strong domain (DA 90+); a featured launch = a ~$5K SEO asset

**Reality check:** Don't expect customers from PH directly. Expect amplification.

**Best practices for industrial launches:**
- Tuesday-Thursday 12:01 AM PT
- Pick "AI" + "Productivity" + "Developer Tools" categories (NOT "Industrial" — too small a category)
- Frame it as a developer-friendly hook: "We built RAG over 68,000 chunks of OEM manuals. Here's the fault-code SEO library + the API."
- Hunter: someone with 1K+ followers on PH. Ask for help if you don't know one (ProductHunt Slack communities)
- Have 30 friends ready to upvote *and comment* in the first hour
- Drop a free utility (the public `manual@factorylm.com`) as a "launch special"
- Tweet the launch with the live demo at 9 AM ET

Schedule for week 7 (mid-June) — gives you time to ship V1-V5 first.

**Issue:** #SO-076 — Product Hunt launch prep.

### Tier 3 — Cheap experiments (any time)

#### V11. **TikTok #bluecollar #manufacturing**
*Effort 3 / Cost $0 / ICP 4 / Money-soon 1 = 8*

There IS an industrial TikTok. #bluecollar (~3B views), #manufacturing (~2B), #plclife (~10M). Format that works:
- 60-second clip: tech scans QR, asks "why is my drive throwing F004?", MIRA answers
- Hook in first 3 seconds: phone close-up, fault code on the drive
- Voiceover: "I made an AI that knows every drive in your plant"

One viral clip in this audience = 100K-1M views. It's a lottery ticket but the cost is one Saturday. Ship 5 clips, see if any hits.

#### V12. **Industrial conference badge sponsorships**
*Effort 2 / Cost $500-2000 / ICP 5 / Money-soon 4 = 11*

Cheaper than a booth ($10K+) and often more visible. Targets:
- **SMRP 2026 Annual Conference** (Society for Maintenance & Reliability Pros) — Oct 2026 in Charlotte. Lanyard sponsor ~$5K, table sponsor ~$2K
- **Reliability 2026** (Reliabilityweb) — Apr/May 2026 in Las Vegas (probably too late for this year's)
- **MainTrain 2026** — Sep 2026 Toronto
- **Pack Expo** — Nov 2026 Chicago (broader than maintenance)

If budget allows, $500-2000 for badge/lanyard sponsorship at SMRP gets your logo in front of every maintenance pro at the conference.

#### V13. **Open-source the fault-code library**
*Effort 3 / Cost $0 / ICP 4 / Money-soon 2 = 9*

Publish your fault-code corpus (per the audit, you have it seeded in `mira-web/src/data/fault-codes.ts`) as an Apache-2.0 GitHub repo. Each Markdown file = one fault code with cause/reset/escalation. 200+ entries.

Why this works:
- **GitHub stars** = social proof + discoverability for engineers
- **Forks** = developers who now know MIRA exists
- **HN Show post** ("I open-sourced 200+ industrial fault codes") = front-page candidate
- **Backlinks** — anyone who uses your data cites you
- **Commercial moat is intact** — the corpus is one fault code per file; the *real* moat is your indexed full-manual corpus + chat pipeline, neither of which you give away

**Issue:** #SO-077 — Open-source fault-code library on GitHub.

---

## 5. Outside-the-box mechanics (the fun stuff)

In addition to V1-V13, here are 6 mechanics that compound visibility:

### M1. **The 24-hour Manual-Watch Stream**
Open `manual@factorylm.com` for one weekend. Mike sits in front of the inbox for 24 hours, replying personally to every submission with a Loom + a phone call invitation. Stream the inbox + Mike's chair on Twitch / YouTube live. Tweet hourly. Maintenance Twitter loves a stunt.

### M2. **The Plant Manager Stipend**
Pay 5 plant managers $500/month each to use MIRA daily and write one short case study a month. Cost: $2,500/mo for 3 months = $7,500. Payoff: 5 paying signal customers + 15 case studies + 5 LinkedIn voices + 5 references for cold outbound. Compare to the cost of one trade-show booth ($10K+) and you'll see why this is a deal.

### M3. **The Reverse Tech Spec — "What MIRA can't do yet"**
A page at factorylm.com/limitations that lists, with humor, what's broken / not built / out of scope. Make it longer than a typical "limitations" page. This is counter-positioning to every competitor who oversells. Ship `#SO-005` from the implementation plan with personality. The page itself becomes shareable on r/PLC ("the only honest industrial AI startup").

### M4. **The "Send Me Your Worst Manual" challenge**
Tweet/post: "Send me a manual page that's confused you for years. I'll have MIRA answer it with sources and screenshot it back." Run for one week. Each public reply with a clean MIRA answer = a testimonial in the wild.

### M5. **The Industrial AI Newsletter**
Start a free Beehiiv newsletter — *"Boilerplate"* or *"The 2 AM Field Notes"* — one weekly email with: (a) a fault-code deep-dive from MIRA's KB, (b) a real plant story, (c) a pure-prose "tech tip" with no pitch. After 12 weeks you have a 1,000-subscriber industrial newsletter that's pure top-of-funnel. Cost: 2 hours/week.

### M6. **The Industrial Build-in-Public Tweets**
Mike posts every shipped PR with one screenshot for 30 days. "Today I made fault codes printable as Avery sheets. PR #678." Engineering audience finds you, plant audience sees velocity. After 30 days, pin a thread. Threads do better than single tweets.

---

## 6. Channel calendar — first 8 weeks

| Week | Focus | Ship |
|---|---|---|
| **W1 (Apr 26-May 02)** | Foundation | MX fix #SO-003, limitations page #SO-005, survey to 5 friendlies #SO-006, codex landing fixes start #SO-070..073 |
| **W2 (May 03-09)** | Landing fixes complete | `/cmms` passwordless live, animated hero, trust band. ICP survey to Markus + Thomas + 3 ICP. **Bench-off setup #SO-074.** |
| **W3 (May 10-16)** | First public moves | Bench-off published. r/PLC + PLCTalk + Show HN posts (Tues/Wed/Thurs). Sticker-in-wild list assembled. LinkedIn cadence begins. |
| **W4 (May 17-23)** | Influencer activation | Sticker mailings ship. Trade-pub guest posts pitched (target 5, accept 2-3). YouTube outreach (3 channels). Beehiiv #1 sponsorship. |
| **W5 (May 24-30)** | Inbound funnel open | Public `manual@factorylm.com` opens. Reddit r/Manufacturing post. TikTok clips (5 ship). Newsletter #1 ships. |
| **W6 (May 31-Jun 06)** | Press push | Trade-pub guest posts going live. 24-hour manual-watch stream. Open-source fault-code library on GitHub + Show HN. |
| **W7 (Jun 07-13)** | Product Hunt + Apollo | Product Hunt launch Tuesday. Apollo cold outbound begins (10/day, ICP-tight). Plant Manager Stipend program ($500/mo to 5 plants). |
| **W8 (Jun 14-21)** | Compound | Newsletter cadence locked in (#3 ships). LinkedIn established. Pipeline review. Decide: keep going on this stack, or pivot. |

---

## 7. Budget — what to spend in the next 8 weeks

You have insufficient-funds Wells Fargo declines in your inbox. Budget reflects that.

| Category | Amount | Notes |
|---|---|---|
| Vinyl stickers (Sticker Mule 250-pack vinyl + UV) | $80 | Reusable across plant + influencer mailings |
| Postage (100 mailings × $0.73-$1.50) | $100 | First-class envelope, Forever stamps |
| Avery 22806 weatherproof sheets (immediate fallback) | $45 | While vinyl ships |
| Vistaprint business cards (100) | $15 | One time |
| Bench-off API costs (50 fault codes × 5 LLMs) | $50 | One-time |
| Beehiiv sponsorships (2× in week 4-5) | $500 | Reliability Connect + MRO Insider |
| YouTube sponsorship (1 small channel) | $750 | Tim Wilborne or AB-focused channel |
| Conference lanyard sponsor (SMRP 2026 if booked early) | $0 (defer to fall) | Plan now, pay in Q3 |
| Plant Manager Stipend (months 1-3) | $7,500 | $500/mo × 5 plants × 3 months. Highest-ROI line item. Defer to month 2 if needed. |
| Tally / Notion / domain extras | $50 | Survey, notes |
| **Total — first 4 weeks** | **$1,540** | Excludes stipend if deferred |
| **Total — full 8 weeks with stipend** | **$9,040** | Stipend is 83% of budget |

**If you have only $200 to spend right now**, do: stickers ($80) + postage ($60 for first 40 packs) + Bench-off API ($50) + a domain/Tally ($10). The first paying customer should fund everything else.

---

## 8. Measurement — what to watch

### Weekly KPIs (Friday review per implementation plan §)

| Metric | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|
| factorylm.com sessions | 100 | 200 | 800 | 1,200 | 2,000 | 3,000 | 5,000 | 6,000 |
| Magic-inbox submissions | 0 | 0 | 0 | 5 | 25 | 50 | 75 | 100 |
| Email captures (PDF gate) | 0 | 0 | 5 | 15 | 30 | 60 | 100 | 200 |
| Reddit / forum comments earned | 0 | 0 | 50 | 75 | 100 | 100 | 150 | 200 |
| Sticker-pack mailings shipped | 0 | 0 | 5 | 30 | 60 | 80 | 90 | 100 |
| Sticker scan events | 0 | 0 | 0 | 3 | 10 | 25 | 50 | 80 |
| Booked discovery calls | 0 | 1 | 2 | 5 | 8 | 12 | 18 | 25 |
| **Paying customers (cumulative)** | 0 | 1 | 1 | 2 | 3 | 4 | 5 | 7 |

If you're under target by W4, the issue is one of: (a) landing page not actually fixed, (b) wrong audience (re-survey), (c) message resonates but the product fails (re-do customer-development calls).

### Per-channel attribution

Use PostHog's UTM tracking. Tag every venue:
- `?utm_source=plctalk&utm_medium=forum&utm_campaign=mira-launch-may`
- `?utm_source=reddit&utm_medium=organic&utm_campaign=...`
- `?utm_source=producthunt&utm_medium=launch&utm_campaign=...`
- etc.

Build a simple weekly dashboard in PostHog grouping by `utm_source`. The data will tell you which 2-3 venues to double down on by W4.

---

## 9. New GitHub issues created by this plan

Add these to `docs/sales-github-issues-2026-04-26.md` and the bash creator script:

| # | Title | Phase | Effort |
|---|---|---|---|
| #SO-070 | Replace `/cmms` form with passwordless magic-link entry | 0 | ~2 days |
| #SO-071 | Add trust band under homepage hero | 0 | 4 hours |
| #SO-072 | Animated diagnostic hero (replace static mockup) | 0 | ~1 day |
| #SO-073 | Seeded sample workspace for first-login experience | 0 | ~2 days |
| #SO-074 | MIRA Bench-off — public benchmark vs ChatGPT/Claude/Gemini/Perplexity | 1 | ~3 days |
| #SO-075 | Sticker-in-the-Wild influencer outreach list (100 names + addresses) | 1 | 1 day |
| #SO-076 | Product Hunt launch prep + assets (week 7) | 3 | 2 days prep + 1 day launch day |
| #SO-077 | Open-source fault-code library on GitHub (Apache 2.0) | 3 | ~1 day |
| #SO-078 | Beehiiv "Boilerplate" / "2 AM Field Notes" newsletter setup | 2 | 4 hours |
| #SO-079 | LinkedIn 8-week content calendar (24 posts queued) | 1 | 1 day to draft, 30 min/post |
| #SO-080 | TikTok content series (5 clips × 60 sec) | 2 | 1 day shoot, 1 day edit |
| #SO-081 | Plant Manager Stipend program — find 5, contract, run | 3 | 2 days find + ongoing |
| #SO-082 | UTM tracking + PostHog launch dashboard | 0 | 4 hours |
| #SO-083 | Trade publication guest-post pitches (5 pubs) | 2 | 1 day pitch, 2 days writing |

I can extend `scripts/create_sales_issues.sh` if you want, or you can copy these into a follow-up edit.

---

## 10. The single most important sentence in this plan

**Ship the codex landing-page fixes first. Every venue below is wasted on a sparse hero with no trust signals.**

Codex did the surgical analysis for you. The fix list is concrete. Spend the next 7 days there before pointing any of the 13 venues at factorylm.com.

After that, run V1-V5 in week 3, V6-V10 in weeks 4-6, V10-V13 in week 7-8. Make sure UTM tracking is on every link so you know what's working.

---

## 11. About Product Hunt specifically

You asked. Here's the no-bullshit answer:

- **Yes, launch on PH** — but as venue #6, not #1. The audience isn't your buyer; the artifacts (badge, backlink, press pickup) are the value.
- **Schedule for week 7** (Jun 9-11), Tuesday-Thursday at 12:01 AM PT
- **Hunter:** find one with 1K+ followers (try Maker community on Slack)
- **Your hook should be developer-flavored**, not maintenance-flavored: "RAG over 68,000 chunks of OEM manuals — see the open benchmark"
- **Drop a free utility** (the public `manual@`) as the launch special — that's what gets upvotes
- **Don't expect customers** from PH. Expect press, backlinks, and amplification.

If you'd rather skip PH entirely and put that effort into a second YouTube collaboration or another trade publication, that's fine — your buyers won't notice.

---

## Bottom line

You don't need a viral launch — you need 25 customers. Most of them come from the unsexy work: codex's landing fixes, Phase 0/1/2 from the implementation plan, and a steady cadence in maintenance-specific forums. The launch venues here are the *amplifier*, not the engine.

Now go fix the homepage. The rest follows.
