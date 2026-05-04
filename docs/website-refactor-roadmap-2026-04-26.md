# FactoryLM × MIRA — 90-Day Website + Product Refactor Roadmap

**Generated:** 2026-04-26
**Window:** 2026-04-26 → 2026-07-26 (13 weeks)
**Owner:** Mike (FactoryLM)
**Single source of truth for:** marketing site (`factorylm.com`), Hub product (`app.factorylm.com/hub/*`), brand, SEO+GEO, sales motion, content factory.

**Companion docs (do not duplicate — reference in PRs):**
- Sales: `docs/sales-audit-2026-04-26.md`, `docs/sales-implementation-plan-2026-04-26.md`, `docs/sales-github-issues-2026-04-26.md`
- Brand: `docs/brand-and-positioning-2026-04-26.md`
- Launch: `docs/launch-plan-2026-04-26.md`
- Monetization: `docs/projects-monetization-playbook-2026-04-26.md`
- SEO + GEO: `docs/seo-geo-strategy-2026-04-26.md`
- Research: `docs/research-synthesis-2026-04-26.md`
- Survey (designed, not yet fielded): `docs/customer-usability-survey-2026-04-26.md`
- Codex recon: `docs/recon/marketing-landing-pages-2026-04-26/recon-notes.md`, `docs/recon/factory-ai-hub-2026-04-25/recon-notes.md`
- Prototype (North Star reference): `docs/proposals/MIRA-Projects-Prototype.html`

---

## 0. Framing — read this first

### 0.1 The prototype is not a launch asset

`MIRA-Projects-Prototype.html` is a **style + capabilities reference** — an internal North Star. Use it to (a) judge whether the shipped product matches the design intent, (b) drive UX/UI decisions across both surfaces, and (c) communicate the v1 vision to investors and pilots in one-on-one settings. **Do not host it publicly at `factorylm.com/projects`.** That changed mid-conversation. Strike issues `#SO-090`, `#SO-091`, `#SO-102` from the marketing playbook — they assumed public hosting.

What replaces them: the prototype's design, copy, and capability claims drive the homepage refresh, the pricing page, the sales deck, and the Hub product backlog. The prototype is *referenced* in the work, not *shipped* as the work.

### 0.2 Two surfaces, one brand

```
factorylm.com (marketing site, Hono/Bun)
└── Audience: buyers + practitioners doing first-touch evaluation
└── Job: "Convince me to start a free trial / pilot / call"
└── Codebase: mira-web

app.factorylm.com/hub/* (signed-in product, Next.js 16 hub)
└── Audience: trial users + paying customers
└── Job: "Help me get value in <10 min and keep me coming back"
└── Codebase: mira-web/hub OR a separate next.js app (per recent PRs)
```

Both surfaces collapse into one brand: **FactoryLM is the workspace. MIRA is the agent.** Every page in either surface obeys the brand kit.

### 0.3 The hierarchy of work

When in doubt, work in this order. Earlier items unblock later ones; reversing the order wastes effort.

1. **Stabilize what's there.** Codex caught real bugs in the Hub. Fix them before any launch venue lands traffic.
2. **Fix conversion surfaces.** Apply codex's marketing recon punch list and the brand kit.
3. **Ship trust + transparency artifacts.** `/limitations`, `/trust`, schema markup, `llms.txt`. These are SEO+GEO foundations.
4. **Open the inbound machine.** Programmatic fault-code SEO, magic email inbox, comparison pages.
5. **Compound.** Pillars, content factory autopilot, Reddit / PLCTalk presence, bench-off, Product Hunt.

Sales work (sticker drop, Apollo, investor email, Markus/Thomas) runs in parallel with all of the above and is owned by Mike directly.

---

## 1. Gap analysis — prototype vs reality

### 1.1 Marketing site (`factorylm.com`)

| Prototype intent (P3) | Current state (`mira-web`) | Gap | Issue |
|---|---|---|---|
| Light-theme workspace surface (FactoryLM Projects) | Dark hero with amber accent; sparse; no trust band | Big — visual + copy + structure | `#SO-100` (homepage), `#SO-073` (sample workspace) |
| Animated, real-data product surface in hero | Static chat mockup | Med — replace mockup with live diagnostic | `#SO-072` |
| Trust band (logos / OEM coverage) | None | Big — drop in OEM coverage band immediately | `#SO-071` |
| Three-product display (Asset / Crew / Investigation cards) | None | Med — add tri-card row below hero with one screenshot each | `#SO-100` (extends) |
| Comparison vs ChatGPT Projects / Claude / NotebookLM / Perplexity Spaces | None | Big — net-new page (high SEO + GEO) | `#SO-103` |
| Document-state transparency story (Indexed / Partial / Failed / Superseded) | Not surfaced in marketing | Big — central brand-promise story | `#SO-100` (extends to feature strip) |
| Sun-readable + voice-in-80dB claims | Not visible | Med — feature page with photos | `#SO-091` (feature page only — no public host of full prototype) |
| Three-tier pricing ($0 / $97 / $497) | Single tier ($97) implied | Big — pricing reshape | `#SO-097`, `#SO-104` |
| `/limitations` page | Doesn't exist | Big — codex flagged + brand promise | `#SO-005` |
| Magic-link `/cmms` trial | Multi-field beta form | Big — codex P0 conversion fix | `#SO-070`, `#SO-101` |
| Founder voice + factorylm.com sender domain | Sending from cranesync.com; mike@factorylm.com bounces | Critical — every outbound suppressed | `#SO-003` (MX fix) |

### 1.2 Hub product (`app.factorylm.com/hub/*`)

Per codex Hub recon (P2 in research synthesis):

| Prototype intent | Current Hub state | Severity | Issue |
|---|---|---|---|
| Asset Page (Direction A) — hero card with health, trends, shelves | Hub `/hub/feed` is the landing; `/hub/assets` exists but bounces to login from a signed-in page | **P0** routing bug | `#SO-200` |
| Crew Workspace (Direction B) — pinned assets, crew avatars, shift handoff | Not built | Phase 4 | `#SO-095` |
| Investigation (Direction C) — auto-built RCA timeline + signed PDF | Not built | Phase 4 | `#SO-094`, `#SO-096` |
| Document state pills (Indexed / Partial / Failed / Superseded) | Not surfaced in `/hub/knowledge` | High | `#SO-093` |
| Sun-readable mode | Not in Hub | Med — port from prototype CSS `body.sun` | `#SO-092` |
| Citation chips on every chat answer | Citation gate is in `mira-pipeline` (shipped), but Hub UI may not render the chips per prototype style | Med — UX audit | `#SO-201` |
| Voice input in chat composer | Telegram/Slack handle voice; Hub web composer status unknown | Med — UX audit | `#SO-202` |
| `/hub/usage` working | Fails with browser load error per codex | **P0** | `#SO-203` |
| New Work Order wizard step labels | Step 1 says "Save" despite being a 3-step wizard | High UX bug | `#SO-204` |
| Per-tenant isolation visible in UI | Per-tenant exists in code; UI surface clarity unknown | Med — verify | `#SO-205` |

### 1.3 Eval / pipeline

| Prototype intent | Current state | Severity | Issue |
|---|---|---|---|
| MIRA reliably answers from KB with citations | Most recent eval run: **0/57 passing** (pipeline-wide outage post-Anthropic-removal PR #610) | **P0 outage** | `#SO-210` (already #653 per hot.md) |
| Test fixtures cover safety, citation, fault paths | 57 fixtures exist; need to be passing | P0 — gating | Same |

### 1.4 Sales / CRM / brand

| Prototype intent (brand kit) | Current state | Severity | Issue |
|---|---|---|---|
| HubSpot ↔ mira-web sync | None — signups land in Neon only | Critical | `#SO-010`, `#SO-011`, `#SO-012` |
| Deals named "FactoryLM Pilot" | Named "MIRA Pilot" | Low (branding) | `#SO-106` |
| Sender from mike@factorylm.com | Sending from mike@cranesync.com | High | `#SO-003` |
| Two real ICP prospects revived | Markus + Thomas aging since Apr 24 | Critical revenue | `#SO-001`, `#SO-002` |

---

## 2. The reframed product structure

Every page, deal, email, post, sticker, and slide collapses to this one architecture:

```
FactoryLM (parent platform — the workspace)
├── FactoryLM Projects ........ (Asset · Crew · Investigation per prototype)
├── MIRA ...................... (the AI agent — Telegram, Slack, Voice, QR, Hub chat)
├── Atlas CMMS ................ (work-order backbone, mostly invisible to buyers)
└── FactoryLM Connect ......... (post-MVP factory→cloud streaming)
```

Brand promise: **FactoryLM never silently truncates your manual. MIRA never invents a torque spec. Both will tell you when they're not sure.**

Three-tier pricing locked for the next 90 days (don't move it):

| Tier | Audience | Includes | Price |
|---|---|---|---|
| **MIRA Free** | Practitioners | Voice + Telegram + Slack agent. 1 plant. 50 chats/mo. | $0 |
| **FactoryLM Projects** | Plant-level buyers | Workspace, MIRA, cited answers, sensor + photo + WO links | $97/mo/plant |
| **FactoryLM Investigations** | Reliability engineers, RCA-heavy plants | Adds auto-built investigation timelines, signed PDF export, OEM warranty file format, Atlas CMMS push | $497/mo/plant |
| Site license | Multi-plant orgs | Custom | Talk to us |

---

## 3. Marketing site refactor (`factorylm.com`)

### Phase 0 (W1, Apr 26 → May 03) — Foundation + critical fixes

| Issue | Title | Owner | Effort |
|---|---|---|---|
| `#SO-001` | Personal email: revive Markus Dillman | M | 15 min |
| `#SO-002` | Personal email: revive Thomas Hampton | M | 15 min |
| `#SO-003` | Fix `mike@factorylm.com` MX (P0 — every outbound depends on this) | M | 1 hr |
| `#SO-004` | Stranger signup smoke test end-to-end | M | 1 hr |
| `#SO-005` | `/limitations` page (per brand kit + codex recon) | M+C | 2 hr |
| `#SO-070` | `/cmms` magic-link entry (replace beta form) | C | 2 days |
| `#SO-071` | Trust band under hero (OEM coverage) | C | 4 hr |
| `#SO-072` | Animated diagnostic hero (replace static mockup) | C | 1 day |
| `#SO-073` | Seeded sample workspace for first-login | C | 2 days |
| `#SO-100` | Homepage hero rewrite (L1 message + 3-card row) | C | 1 day |
| `#SO-104` | Three-tier pricing page ($0 / $97 / $497) | C | 4 hr |
| `#SO-105` | Email-template sender split (MIRA vs FactoryLM) | C | 4 hr |
| `#SO-106` | Rename "MIRA Pilot" → "FactoryLM Pilot" deals | M | 30 min |
| `#SO-007` | Connect Apollo MCP | M | 5 min |
| `#SO-010` | Sync `/api/register` → HubSpot contact + company | C | 1 day |
| `#SO-011` | Stripe webhook → HubSpot deal advance | C | 1 day |
| `#SO-012` | Backfill HubSpot company-contact associations | C | 4 hr |
| `#SO-006` | Send usability survey to 5 friendlies | M | 2 hr |
| `#SO-110` | Schema.org TroubleshootingGuide + FAQ + HowTo on fault-code pages | C | 1 day |
| `#SO-111` | Organization + WebSite + Person schema on homepage | C | 2 hr |
| `#SO-112` | Product + Offer schema on `/pricing` | C | 2 hr |
| `#SO-113` | `robots.txt` AI-crawler allowlist | C | 30 min |
| `#SO-114` | `/llms.txt` + `/llms-full.txt` | C | 4 hr |
| `#SO-115` | Bing Webmaster + Brave Search Console | M | 30 min |
| `#SO-116` | Verify Google Search Console + sitemap | M | 30 min |
| `#SO-117` | Canonical tags + per-page title/meta | C | 1 day |
| `#SO-118` | Internal-link fault-code pages | C | 4 hr |
| `#SO-130` | Brand schema `sameAs` (LinkedIn / GitHub / X) | C | 1 hr |
| `#SO-128` | Weekly LLM-citation probe (`wiki/geo-probe.md`) | M | 30 min/week |

**Phase 0 exit:** Hub stabilized (Phase 0 also runs §4.1), homepage + `/cmms` shipped per recon, foundational SEO/GEO live, sender domain healthy, Markus + Thomas re-engaged, survey out.

### Phase 1 (W2-W3, May 04 → May 17) — Sales-active surfaces + Sticker Drop

| Issue | Title | Owner | Effort |
|---|---|---|---|
| `#SO-103` | `/vs-chatgpt-projects` page (lifts prototype X-tab content) | C | 3 hr |
| `#SO-091` | Sun-readable mode (production app + feature page) | C | 4 hr |
| `#SO-092` | Voice-in-80dB feature page | C | 4 hr |
| `#SO-093` | Document-state pills surfaced in production (Indexed / Partial / Failed / Superseded) | C | 2 days |
| `#SO-074` | MIRA Bench-off setup + publish | C | 3 days |
| `#SO-127` | Bench-off `@type: Dataset` schema | C | 1 hr |
| `#SO-082` | UTM tracking + PostHog launch dashboard | C | 4 hr |
| `#SO-119` | Programmatic fault-code factory v1 (50 schema-marked pages) | C | 3 days |
| `#SO-020` | Source vinyl QR stickers (Sticker Mule 250-pack) | M | 30 min order |
| `#SO-021` | `/m/:asset_tag` unclaimed-asset flow | C | 2 days |
| `#SO-022` | Pre-generate 20 sticker packs | C | 4 hr |
| `#SO-023` | Mailing kit assets (setup card, Vistaprint cards, Post-It template) | M | 4 hr |
| `#SO-024` | Identify first 20 plants + manager names + addresses | M | 1 day |
| `#SO-025` | Send introductory email to the 20 | M | 2 hr |
| `#SO-026` | Mail packs as addresses come in (rolling) | M | 30 min/pack |
| `#SO-027` | QR scan event → email alert + HubSpot deal advance | C | 1 day |
| `#SO-079` | LinkedIn 8-week content calendar (24 posts queued) | M | 1 day |
| `#SO-129` | Reddit/PLCTalk/Stack Overflow program (5 answers/week start) | M | 1 hr/day |

**Phase 1 exit:** First 20 sticker packs in mail, bench-off live, comparison page driving organic traffic, programmatic fault-code factory shipping 5/wk.

### Phase 2 (W4-W5, May 18 → May 31) — Public inbound + comparison content

| Issue | Title | Owner | Effort |
|---|---|---|---|
| `#SO-030` | Anonymous-tenant chat with one-time token | C | 2 days |
| `#SO-031` | Public inbox handler at `manual@factorylm.com` | C | 2 days |
| `#SO-032` | Auto-reply email + 60s Loom | M+C | 4 hr |
| `#SO-033` | 5-touch follow-up drip for `manual@` users | C | 1 day |
| `#SO-035` | HubSpot `Manual Inbox Engaged` list | M | 1 hr |
| `#SO-123` | `/vs-{maintainx,upkeep,limble,fiix,factory-ai}` × 5 pages | C | 5 days (1 each) |
| `#SO-040` | Fault-code PDF email-gate capture | C | 2 days |
| `#SO-041` | Printable PDF generator | C | 2 days |
| `#SO-042` | 7-touch fault-code drip | C | 1 day |
| `#SO-034` | Reddit + LinkedIn + FB launch posts (manual@ public utility) | M | 2 hr/post |
| `#SO-077` | Open-source fault-code library on GitHub | C | 1 day |
| `#SO-125` | Confirm and link from `factorylm.com/blog/fault-codes` | C | 1 hr |

**Phase 2 exit:** Public `manual@` taking submissions, 5 `/vs-*` pages indexed and ranking, fault-code library open-source on GitHub, Reddit / PLCTalk / FB posts shipped.

### Phase 3 (W6-W8, Jun 01 → Jun 21) — Pillar content + Hub product gap close

| Issue | Title | Owner | Effort |
|---|---|---|---|
| `#SO-120` | Pillar: `/ai-for-plant-maintenance` (3,000+ words) | M+C | 3 days |
| `#SO-121` | Pillar: `/cmms-with-ai` (comparison + buyer's guide) | M+C | 3 days |
| `#SO-122` | Pillar: `/industrial-rag-explained` (technical, GEO-feeder) | C | 3 days |
| `#SO-126` | Public API: `api.factorylm.com/v1/fault-codes/{code}.json` | C | 2 days |
| `#SO-043` | Nightly Claude content factory (auto-PRs against fault-codes) | C | 4 days |
| `#SO-044` | Backlinks: submit fault-code library to industrial communities | M | 4 hr |
| `#SO-076` | Product Hunt launch prep + assets | M+C | 2 days prep |

**Phase 3 exit:** Three pillars indexed, content factory autopilot running, API live, Hub workspace at parity with prototype Direction A.

### Phase 4 (W9-W13, Jun 22 → Jul 26) — Compound + cold outbound

| Issue | Title | Owner | Effort |
|---|---|---|---|
| `#SO-095` | Crew Workspace MVP (Direction B) | C | 4-6 weeks |
| `#SO-096` | Investigation MVP (Direction C) | C | 4-6 weeks |
| `#SO-094` | Signed RCA PDF export (premium tier feature) | C | 2 weeks v1 |
| `#SO-050` | Apollo ICP filter + saved search | M | 2 hr |
| `#SO-051` | Apollo 5-touch sequence | M | 4 hr |
| `#SO-052` | Apollo touch-4 → Sticker Drop bridge | C | 1 day |
| `#SO-076` | Product Hunt launch (Tuesday in W11) | M | 1 day launch + 12 hr support |
| `#SO-080` | TikTok content series (5 clips) | M | 2 days |
| `#SO-081` | Plant Manager Stipend program (5 plants × $500/mo) | M | 2 days find + ongoing |
| `#SO-083` | Trade publication guest posts (5 pubs) | M | 1 day pitch + 2 days writing |
| `#SO-124` | `/glossary/{term}` programmatic — 100 entries | C | 1 week |
| `#SO-078` | Beehiiv newsletter setup ("Boilerplate") | M | 4 hr |
| `#SO-060` | Sales pipeline tracker auto-populate | C | 1 day |

**Phase 4 exit:** Direction B + C in production (or soft-shipped to first 5 paying pilots), Product Hunt complete, cold outbound at 10 leads/day, Plant Manager Stipend program running.

---

## 4. Hub product refactor (`app.factorylm.com/hub/*`)

The Hub is where evaluation becomes retention. Codex's recon (P2) showed it's NOT shipping the prototype's promise yet. Phase 0 stabilizes; Phases 1-4 grow toward Direction A → B → C.

### 4.1 Phase 0 (this week, P0 critical)

| Issue | Title | Effort |
|---|---|---|
| `#SO-200` | Fix `/hub/assets` redirect bug — bounces to login from a signed-in page | 4 hr |
| `#SO-203` | Fix `/hub/usage` browser load error | 4 hr |
| `#SO-204` | Rename WO wizard step 1 button "Save" → "Continue" or "Next" | 30 min |
| `#SO-210` | Restore eval pipeline (most recent run 0/57 — root cause: post-PR-#610 cascade or Doppler env) | 1-3 days |
| `#SO-211` | Add a stranger smoke-test that walks the entire trial→Hub flow and gates deploys (extends `#SO-004`) | 1 day |

### 4.2 Phase 1 (W2-3, Direction A polish)

Drive the Hub Asset Page to parity with prototype Direction A. The shelves (manuals, photos, work orders, sensors, conversations) are the v1 of FactoryLM Projects.

| Issue | Title | Effort |
|---|---|---|
| `#SO-220` | Asset hero card — health pill, criticality, last/next PM, open WO count | 2 days |
| `#SO-221` | Documents shelf with state pills (extends `#SO-093`) | 2 days |
| `#SO-222` | Photos shelf with AI-overlay placeholder | 1 day |
| `#SO-223` | Sensors shelf — minimal sparklines from existing tag streams | 2 days |
| `#SO-224` | Conversations shelf — surface chat history per asset | 1 day |
| `#SO-225` | Right-rail chat composer with citation chips | 2 days |
| `#SO-226` | "Ask MIRA" CTA on every shelf row | 4 hr |
| `#SO-201` | Citation chip UX audit — render exactly per prototype | 4 hr |
| `#SO-202` | Voice input in Hub composer (PWA mic API) | 2 days |
| `#SO-205` | Per-tenant isolation visible in UI (badge / scope label) | 4 hr |

### 4.3 Phase 3-4 (Crew + Investigations)

| Issue | Title | Effort |
|---|---|---|
| `#SO-095` | Crew Workspace v1 — pinned assets, crew avatars | 4-6 weeks |
| `#SO-227` | Auto shift handoff (90-sec audio + summary) | 1-2 weeks |
| `#SO-096` | Investigation v1 — RCA timeline auto-build | 4-6 weeks |
| `#SO-094` | Signed RCA PDF export with `@type: TroubleshootingGuide` | 2 weeks v1 |
| `#SO-228` | OEM email ingest from Outlook (extends magic-inbox) | 2 weeks |
| `#SO-229` | Atlas CMMS push from RCA closeout | 1 week |

---

## 5. SEO + GEO integration

Full strategy in `docs/seo-geo-strategy-2026-04-26.md`. Inline mapping into the roadmap:

- **Phase 0:** Quick wins — schema, robots.txt, llms.txt, Search Consoles, canonicals (`#SO-110` through `#SO-118`, `#SO-130`)
- **Phase 1:** Programmatic fault-code factory v1 + bench-off (`#SO-119`, `#SO-074`, `#SO-127`)
- **Phase 2:** `/vs-*` pages + open-source fault-code library + public API (`#SO-123`, `#SO-077`, `#SO-126`)
- **Phase 3:** Three pillar pages (`#SO-120`, `#SO-121`, `#SO-122`)
- **Phase 4:** Glossary + content factory autopilot (`#SO-124`, `#SO-043`)

GEO target: by 2026-08-01, FactoryLM/MIRA cited by name in ≥3 of the 5 LLM products (ChatGPT, Claude, Perplexity, Copilot, Gemini) on industrial-maintenance questions. Tracked weekly in `wiki/geo-probe.md` per `#SO-128`.

---

## 6. Decision register — what we are explicitly NOT doing

Focus is created by what you say no to. The following are deliberate non-investments for the 90-day window. Revisit at end-of-window.

| Decision | Rationale | Revisit |
|---|---|---|
| Don't host the prototype publicly | User correction — it's an internal North Star, not marketing | Q3 2026 if it becomes a sales asset for enterprise |
| Don't upgrade HubSpot to Marketing Hub Pro | Standard + Apollo + custom drip covers 95% of need at <10% of cost | At $50K MRR |
| Don't run paid ads (search or social) | Earned channels + sticker drop + content compound 10× cheaper at this stage | Q4 2026 if CAC math turns favorable |
| Don't pursue trade-show booths ($10K+) | Lanyard sponsorships at $500-2K cover visibility at a fraction of cost | After first 10 paying pilots |
| Don't chase enterprise customers | $497/mo × 50 plants = $25K MRR is the right next milestone; enterprise is 12-month sales cycle distraction | After $25K MRR |
| Don't build SOC 2, SAML, SSO | Pre-revenue and 90-day window — these are enterprise gates, post-MVP | Q1 2027 |
| Don't build Maximo / SAP PM / Fiix native integrations | Compatibility positioning ("works alongside") is enough; deep integrations are 1-2 quarter projects per integration | After paid customer demands one |
| Don't build mobile native apps | PWA + Telegram + Slack covers 95% of practitioner usage; native is post-MVP polish | Q1 2027 |
| Don't sell to academic contacts as customers | They're research relationships (citations, papers, GEO authority); selling them dilutes both relationships | Permanent — this is positioning, not timing |
| Don't add new product surfaces beyond Hub | One prod surface, one mobile-PWA surface (`/m/:asset_tag`), one chat surface (Telegram/Slack). Resist platform sprawl. | Permanent |
| Don't change pricing more than once in 90 days | Pricing churn destroys conversion | Re-price only with 3+ paid customers' data |
| Don't host the customer survey on a vendor we don't already pay for | Tally free OR direct email — $0 budget line | After 50+ responses, evaluate |

---

## 7. The unified backlog — every issue, deduplicated, ordered

The full list of issues across all docs, deduplicated, in execution order. Use this as the single canonical list when extending `scripts/create_sales_issues.sh`.

### Phase 0 — Foundation + Stabilize (W1)

`#SO-001`, `#SO-002`, `#SO-003`, `#SO-004`, `#SO-005`, `#SO-006`, `#SO-007`, `#SO-010`, `#SO-011`, `#SO-012`, `#SO-070`, `#SO-071`, `#SO-072`, `#SO-073`, `#SO-100`, `#SO-104`, `#SO-105`, `#SO-106`, `#SO-110`, `#SO-111`, `#SO-112`, `#SO-113`, `#SO-114`, `#SO-115`, `#SO-116`, `#SO-117`, `#SO-118`, `#SO-128`, `#SO-130`, `#SO-200`, `#SO-203`, `#SO-204`, `#SO-210`, `#SO-211`

### Phase 1 — Sales-active + Sticker Drop (W2-W3)

`#SO-020`, `#SO-021`, `#SO-022`, `#SO-023`, `#SO-024`, `#SO-025`, `#SO-026`, `#SO-027`, `#SO-074`, `#SO-079`, `#SO-082`, `#SO-091`, `#SO-092`, `#SO-093`, `#SO-103`, `#SO-119`, `#SO-127`, `#SO-129`, `#SO-201`, `#SO-202`, `#SO-205`, `#SO-220`, `#SO-221`, `#SO-222`, `#SO-223`, `#SO-224`, `#SO-225`, `#SO-226`

### Phase 2 — Public inbound + comparison (W4-W5)

`#SO-030`, `#SO-031`, `#SO-032`, `#SO-033`, `#SO-034`, `#SO-035`, `#SO-040`, `#SO-041`, `#SO-042`, `#SO-077`, `#SO-123`, `#SO-125`

### Phase 3 — Pillars + product gap close (W6-W8)

`#SO-043`, `#SO-044`, `#SO-076` (prep), `#SO-120`, `#SO-121`, `#SO-122`, `#SO-126`

### Phase 4 — Compound + cold outbound (W9-W13)

`#SO-050`, `#SO-051`, `#SO-052`, `#SO-060`, `#SO-076` (launch), `#SO-078`, `#SO-080`, `#SO-081`, `#SO-083`, `#SO-094`, `#SO-095`, `#SO-096`, `#SO-124`, `#SO-227`, `#SO-228`, `#SO-229`

Run `scripts/create_sales_issues.sh` after extending it with the new `#SO-070` through `#SO-229` entries — that's the single GitHub action that operationalizes this roadmap.

---

## 8. The 90-day calendar (one-line per week)

| Week | Anchor goal | One-line proof |
|---|---|---|
| W1 (Apr 26-May 02) | **Stabilize + foundation** | Hub bugs fixed; homepage + `/cmms` per recon; survey sent; SEO/GEO foundation live |
| W2 (May 03-09) | **Sales surfaces + Direction A polish** | `/vs-chatgpt-projects` shipped; bench-off draft; first 10 sticker packs queued; Hub Asset Page hits Direction A parity v0.5 |
| W3 (May 10-16) | **First public moves** | Bench-off published; Show HN; r/PLC + PLCTalk posts; first sticker scans tracked |
| W4 (May 17-23) | **Inbound funnel open** | Public `manual@factorylm.com` live; first 5 `/vs-*` pages indexed; Reddit cadence at 5 answers/week |
| W5 (May 24-30) | **Press push** | Trade-pub guest posts going live; fault-code library open-sourced; Beehiiv launched |
| W6 (May 31-Jun 06) | **Pillars** | `/ai-for-plant-maintenance` live; `/cmms-with-ai` live |
| W7 (Jun 07-13) | **Pillars + content factory** | `/industrial-rag-explained` live; nightly content factory autopilot running |
| W8 (Jun 14-20) | **Public API + Direction A complete** | `api.factorylm.com/v1/fault-codes` live; Hub Asset Page == prototype Direction A |
| W9 (Jun 21-27) | **Apollo cold outbound starts** | 10 leads/day; first cold-Apollo touchpoint connects to Sticker Drop |
| W10 (Jun 28-Jul 04) | **Product Hunt** | PH launch Tue/Wed; press follow-ups; usability synthesis from survey returns |
| W11 (Jul 05-11) | **Crew Workspace v1 alpha** | Direction B soft-shipped to first 5 paying plants |
| W12 (Jul 12-18) | **Investigations v1 alpha** | Direction C soft-shipped; first signed RCA PDF generated; first $497/mo customer |
| W13 (Jul 19-25) | **Compound + retro** | Roadmap retro; KPI snapshot; v1.0 GA cut; refresh roadmap for next 90 days |

---

## 9. KPI snapshot (revisit weekly)

| KPI | Today | W4 target | W8 target | W13 target |
|---|---|---|---|---|
| Paying customers (cumulative) | 0 | 1-2 | 4-6 | 10-15 |
| MRR | $0 | $99-198 | $400-2,000 | $1,500-7,500 |
| Indexed pages on factorylm.com | <100 | 250 | 500 | 750+ |
| Organic visits/week | unknown | 200 | 1,000 | 3,000 |
| Magic-inbox `manual@` submissions/week | 0 | 5 | 25 | 50 |
| Fault-code PDF email captures (cum.) | 0 | 25 | 100 | 250 |
| Sticker packs shipped (cum.) | 0 | 30 | 60 | 100 |
| QR scan events (cum.) | 0 | 10 | 50 | 150 |
| Hub trial activations (cum.) | unknown | 25 | 100 | 250 |
| GEO probe — LLM citations of FactoryLM/MIRA | 0 of 5 | 1 of 5 | 2 of 5 | 3+ of 5 |
| Eval pass rate (`tests/eval/runs/*`) | 0/57 | 50/57 | 54/57 | 56/57 stable |
| Hub P0 outage incidents | open | 0 | 0 | 0 |

---

## 10. Definition of done — what shipping the roadmap looks like

By 2026-07-26, the following are true:

1. The Hub is stable. Stranger smoke test passes daily. Eval ≥54/57 for 14 consecutive days.
2. The marketing site is positioned as **FactoryLM × MIRA**, with the L1 message in the hero and `/limitations` linked in every footer.
3. `/cmms` is a magic-link entry that lands users in a seeded sample workspace within 60 seconds.
4. Pricing is three tiers ($0 / $97 / $497), and at least 5 paying customers exist across the $97 + $497 tiers.
5. SEO + GEO foundation is shipped (schema, llms.txt, AI-crawler allowlist, Bing/Brave indexes, fault-code factory at 250+ pages).
6. The bench-off is published and citable; the fault-code library is open-source on GitHub; the public fault-code API is live.
7. Hub `/hub/assets` matches prototype Direction A — shelves, citation chips, sun-readable mode.
8. Direction B (Crew) and Direction C (Investigations) are alpha-shipped to ≥5 paying customers.
9. Apollo cold outbound is running at 10 leads/day, looped into Sticker Drop on touch 4.
10. The roadmap is refreshed for the next 90 days, informed by survey returns, customer interviews, and pipeline data.

---

## 11. How to use this doc (literally)

- **Every Monday**, open this file. Look at the week's anchor goal in §8. Pick 2-3 issues from the unified backlog (§7) that move that goal. Mark them in_progress.
- **Every Friday afternoon**, run the 30-minute pipeline review per `docs/sales-implementation-plan-2026-04-26.md` §. Pull KPIs into §9. Append one line to `wiki/hot.md` with the three numbers (touches, replies, paid).
- **Every PR description** should reference its `#SO-XXX` issue. The bash creator script (`scripts/create_sales_issues.sh`) generates the GitHub issues from the unified backlog.
- **When a new request comes in mid-quarter**, ask: does this fit the current phase? If not, add to a `docs/q3-roadmap-input.md` and resist scope creep.
- **At end of W13**, do a 1-day retro. What hit, what didn't, what to drop, what to double down on. Then write the next 90-day roadmap.

---

## 12. Final word

You have an unusual asset stack:

- A working product with a 68K-chunk OEM moat
- A polished prototype that's both a North Star and an investor closer
- A specific brand promise (honesty under uncertainty) that competitors literally cannot copy without admitting their own failure modes
- An ICP concentration in Tampa/Florida small-mid manufacturers within driving distance
- Two real plant prospects with $499 deals waiting for a re-pitch
- 8 different marketing skills your codex sibling already prepared (`.agents/skills/marketing/*`)
- A research synthesis pointing at five well-supported themes
- An SEO + GEO landscape where your competitors haven't woken up yet

The 90 days is a sequencing problem, not an invention problem. Don't add net-new ideas. Ship this list.
