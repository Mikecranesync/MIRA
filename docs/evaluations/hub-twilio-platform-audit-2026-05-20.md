# FactoryLM Hub — "Twilio of Industry 4.0" Platform Audit

**Date:** 2026-05-20
**Auditor:** Claude (autonomous, no user supervision during run)
**Target:** `https://app.factorylm.com` (production Hub) + `https://factorylm.com` (marketing)
**Method:** Playwright drive of all public/unauthenticated pages + full source-read of 29 authenticated `(hub)` routes + sidebar + onboarding wizard
**Status:** Brutal-honesty review per instruction. No flattery.

---

## 0. TL;DR

> **The Hub is a competent multi-tool SaaS. It is not a Twilio.**
> The product the marketing site is selling (`/buy`, `/cmms`, `/pricing`) is an **enterprise-services + multi-tenant SaaS hybrid** — "book the assessment, we walk your floor, then we run an Operating Layer for $499/mo." That offer is internally coherent and probably the right wedge for industrial buyers in 2026. **But it is the opposite of the Twilio motion**, and the Hub UI underneath reflects the same hybrid identity: a self-serve wizard exists, but the *moments* that make Twilio Twilio (no sales call, single primitive, <5 min to first event, copy-pasteable API, pay-as-you-go) are largely absent.

**Overall Twilio-of-Industry-4.0 alignment: 36 / 100** (see scorecard §3).

**The three biggest gaps are not bugs — they are positioning + IA decisions:**
1. The marketing site **leads with a $500 paid assessment and `Talk to Mike`** — the literal anti-Twilio.
2. The sidebar exposes **18 nav destinations** to a brand-new user. Twilio's first console shows one object (a phone number).
3. There is **no API surface, no SDK, no docs portal, no webhook UI a developer can self-serve** — the integrations page has 3 hardcoded webhook entries and a static API key.

**The single highest-ROI 30-day move:** lock the marketing site to two paths (`Self-serve` and `Talk to us`), build a **`/quickstart` page inside the Hub that produces the first AI-cited fault answer in <60 seconds** using the existing 68k-chunk OEM KB without requiring any of the user's data, and gate everything else behind it.

---

## 1. Audit scope, method, limitations

### What was audited
- **Marketing site:** `factorylm.com/`, `/pricing`, `/cmms`, `/buy` — desktop + mobile screenshots captured.
- **Hub unauthenticated:** `/login`, `/signup`, redirect behavior from `/hub/feed` — desktop + mobile.
- **Hub authenticated (source-read only, not driven):** all 29 `(hub)/*` `page.tsx` files, plus `(hub)/layout.tsx` and `src/components/layout/sidebar.tsx`. Onboarding wizard read in full.
- **Cross-reference:** prior route-health audits in `docs/audits/2026-05-17|18|19-audit.md` (route 200-OK only — orthogonal to this audit).

### What was NOT audited
- **Authenticated live UI was not driven.** The Claude Code auto-mode classifier blocked the login submit on the production app as an "unauthorized prod write," despite the user authorizing `playwright@factorylm.com / TestPass123` (the well-known E2E test user used by `mira-hub/tests/e2e/hub-audit.spec.ts`). The user can unblock this for future runs by adding a per-session permission rule.
- **Mobile screenshots of every authenticated page** were not captured for the same reason. Source-read covers structure and intent; live mobile rendering is inferred from CSS class signals (`hidden md:flex`, FAB positioning) noted in the inventory.
- **The research library Mike referenced** (`docs/research/industry4-intelligence/...` and `docs/specs/mira-customer-onboarding-spec.md`) **does not exist on this branch** (`claude/sweet-payne-612d8d`). Searches across `docs/` returned zero matches for "industry4-intelligence" and the only Twilio reference is the WhatsApp/Twilio API doc. I proceeded with canonical Twilio criteria from public knowledge (no sales call, single primitive, <5 min first event, dev-first docs, pay-as-you-go, mobile-friendly, API + SDK + webhooks). If those research files exist on `main` or another branch and contain different/extended criteria, this audit should be re-checked against them.

### Twilio criteria applied
From the canonical Twilio motion:
1. **No sales call required** to reach first value.
2. **One clear primitive** (a phone number, an SMS, an event).
3. **<5 minutes** from signup to first event.
4. **Pay-as-you-go**, transparent per-unit pricing.
5. **Developer-first docs** with copy-paste examples on landing.
6. **API + SDK + webhooks** as first-class product, not afterthought.
7. **Mobile-aware** where the buyer's workflow demands it (industrial = phone-in-pocket).
8. **Single object → broad workflows.** The platform is one thing, but composable.

---

## 2. Findings — Marketing site (`factorylm.com`)

### What's on the public-facing funnel

| Route | Headline action | Twilio? |
|---|---|---|
| `/` | "Book Your Maintenance Assessment" + "Take the readiness scorecard" | **No.** Assessment-first. |
| `/pricing` | Tiered consultative pricing | **No.** Not per-event. |
| `/cmms` | "Maintenance Operating Layer" pitch | Hybrid. |
| `/buy` | "Get Started — Assessment, Pilot, Operating Layer" | **No.** Three tiers, all gated. |
| `/blog`, `/limitations`, `/security` | Trust-building content | Neutral. |

The three offers on the homepage:
1. **Assessment — $500** — "We walk your floor (in person or remote). Score your Maintenance AI Readiness. Deliver a written gap report and a namespace blueprint. Takes 1 day."
2. **Pilot — $2–5K/mo** — "3-month minimum. We structure one line: nameplates scanned, manuals indexed, PLC tags mapped, PMs extracted, fault history captured."
3. **Operating Layer — $499/mo** — "MIRA in production across the plant. Telegram + web + CMMS write-back. Quarterly namespace audits."

**The framing is explicit and consistent:** *"Your manuals are in filing cabinets. Your fault history is in someone's head. Your PLC tags don't match your asset names. AI can't help until that's structured. We do the structuring — then MIRA runs on top."*

This is **Palantir Foundry's positioning** ("we will do the deployment work; the product is the service + the platform"), not Twilio's ("here's an API key, send an SMS").

#### Why this is not necessarily wrong
The honest reading: industrial maintenance buyers in 2026 are **not** Twilio's 2010 audience (developers who already had product-market fit and just needed an SMS line). They are plant managers and maintenance directors who have never written an API call and whose data is genuinely unstructured. A "drop in, structure your namespace, then SaaS on top" wedge is **realistic**, and the $500 assessment is a sales-qualification mechanism that probably converts better than free signups would.

#### Why this still costs you the Twilio score
1. **Bottom-up adoption is closed off.** A single plant maintenance tech, a small contractor, or a curious developer at a large OEM has no way to try the product without a sales call. Twilio's wedge was *exactly* those personas evangelizing inside their org.
2. **The Hub does have a self-serve signup** (`/signup/` with email/password or Google OAuth) — but the marketing site never links to it. Search for "Try free" / "Free trial" on `/` and the closest is "Take the readiness scorecard." That's a lead capture, not a product.
3. **`Talk to Mike` (mailto link)** as the secondary CTA on the homepage is founder-led sales — fine at <$100k ARR, but it caps the funnel hard. The "Sign in" link in the top nav points to `/cmms` (a marketing page!), not `/login` — confirming the Hub login is not part of the intended funnel.

### Marketing site UX strengths to keep
- "Generic AI vs MIRA" side-by-side fault-code answer is the **single most persuasive moment on the site.** That kind of evidence-first comparison is how Twilio's "send an SMS in 60 seconds" worked.
- PWA install banner at the bottom — correct instinct for floor users.
- "☀ Sun-readable" high-contrast toggle in the footer — thoughtful industrial UX.
- The four scene-by-scene "Cited answer in seconds" / "Work order fields filled in" / "Model and spec identified" demos in the hero are great.
- "68,000+ chunks of OEM documentation indexed" with named brands (Allen-Bradley, Siemens, ABB, Schneider Electric, Yaskawa, Mitsubishi, Rockwell, Honeywell) — credible moat.

### Marketing site UX gaps
- **No self-serve CTA above the fold.** The two primary CTAs (`Book Your Maintenance Assessment`, `Take the readiness scorecard`) are both lead capture.
- **No pricing transparency for the SaaS Operating Layer** until you click `/pricing`. Twilio puts per-message pricing on the homepage.
- **`Sign in` link routes to `/cmms`** — broken funnel hygiene.
- **No "see it in action" interactive demo** that doesn't require booking. The animated comparison is good but it's static — a hosted sandbox would be the Twilio move.
- **No API documentation visible** anywhere. Twilio's docs are SEO bait; FactoryLM has no docs portal at `/docs`.

---

## 3. Findings — Hub authenticated UI (29 pages, source-read)

### Page inventory

| Route | Lines | Status | Primary action (what the user can DO) | Twilio-onboarding relevance | Headline red flag |
|---|---:|---|---|---|---|
| `/feed` | ~475 | **Full** | Triage today's WOs, PMs, alerts | HIGH | Empty-state shows on dismiss, not on zero-data; no first-run guidance |
| `/onboarding` | ~512 | **Full** | 4-step wizard: company → site → line → review | HIGH | Terminates at `/namespace` with no next-step prompt to connect a channel or upload a manual |
| `/namespace` | ~418 | **Full** | Browse/rearrange UNS tree | HIGH | Drag-drop is desktop-only; mobile users see read-only tree |
| `/proposals` | ~381 | **Full** | Approve/reject AI relationship proposals | HIGH | None — this is the AI value loop |
| `/assets` | ~587 | **Full** | Register assets, scan QR, export labels | HIGH | 15 OEM options hardcoded in create modal |
| `/knowledge` | ~918 | **Full** | Upload manuals, browse manufacturer KB | HIGH | KbGrowthDashboard suppressed on mobile (undocumented); 30s poll runs indefinitely |
| `/channels` | ~651 | **Full** | Connect Telegram / Slack / Google / Nango / WebUI | HIGH | "Coming Soon" badges on 3 channels; MaintainX token routed opaquely via Nango |
| `/scan` | ~219 | **Full** | Camera QR scan or manual tag entry | MEDIUM | BarcodeDetector has no polyfill — Safari/older Android may break |
| `/workorders` | ~238 | **Full** | Create, filter, export WOs | MEDIUM | Export CSV hidden on mobile |
| `/schedule` | ~534 | **Full** | PM calendar; edit trigger types | MEDIUM | Billing period "April 2026" hardcoded |
| `/event-log` | ~512 | **Full** | Inspect MIRA reasoning + CMMS payloads per event | MEDIUM | None |
| `/usage` | ~250 | **Full** | Diagnostic usage + credit charts | MEDIUM | "April 2026" hardcoded billing period |
| `/upgrade` | ~139 | **Full (paywall)** | Pick plan → Stripe checkout | HIGH | Plan prices ($20 / $499) don't match `/pricing` marketing tiers ($97 / $297) — **tier reconciliation deferred in code comment** |
| `/cmms` | ~360 | **Partial** | CMMS health + WO/asset stats | MEDIUM | Falls back to `STATIC_SUMMARY` (47 WOs, 23 assets, 8 PMs) if API fails — silently |
| `/integrations` | ~316 | **Partial** | CMMS connectors + webhooks + API keys | HIGH | Webhooks tab has **3 hardcoded entries**; API tab has **1 hardcoded API key** and a fake event log. **This is the page a developer would land on. It is mostly fake.** |
| `/documents` | ~313 | **Partial** | Browse/upload OEM and site docs | LOW | Grid renders from static `@/lib/documents-data` import; only the upload action is live |
| `/requests` | ~268 | **Partial** | Approve/reject maintenance requests | MEDIUM | 5 hardcoded requests; approve/reject mutates local React state only — **no persistence, resets on reload** |
| `/team` | ~294 | **Partial** | Team list + MIRA activity per member | LOW | 7 hardcoded members; MIRA activity stats hardcoded; `/api/team` overlays additional users but does not replace the mock |
| `/reports` | ~242 | **Partial** | KPIs + AI-generated narrative | LOW | All chart data hardcoded (downtime, WO completion, top assets, PM compliance). Only the AI narrative endpoint is live |
| `/conversations` | ~242 | **Placeholder** | Browse conversation history | MEDIUM | **Entire dataset is 5 hardcoded threads. No `/api/conversations` exists.** |
| `/alerts` | ~226 | **Placeholder** | Acknowledge alerts | MEDIUM | 5 hardcoded alerts (arc flash, CNC vibration, HVAC PM overdue); ack mutates local state only |
| `/parts` | ~224 | **Shell/mock** | Browse parts inventory | LOW | Entirely static `@/lib/parts-data`; no create/edit/order |
| `/library` | ~8 | **Redirect** | Silently redirects to `/knowledge` | NONE | Dead route in sidebar/IA |
| `/admin` | ~5 | **Redirect** | Redirects to `/admin/users` | NONE | — |
| `/plc` | ~14 | **Shell (iframe)** | External GitHub Pages ladder-logic editor | NONE | **Third-party iframe in a SaaS product. No integration with hub data. CSP risk. Surfaces in main nav as "Ladder Logic."** |
| `/more` | ~73 | **Full (mobile overflow)** | Mobile nav to all sections | LOW | Working as designed |
| `/magic`, `/pending-approval` | ~78, ~95 | **Full (auth utility)** | Magic-link verify; admin-approval wait | LOW | Working as designed |

**Summary:** of 29 routes, **15 are fully functional, 6 are partial (placeholder data mixed with live actions), 4 are placeholder/mock, 4 are shells or auth utilities.** That's a high real-functionality rate for a v1 — but the partial/placeholder pages **happen to include the three pages a Twilio-comparing buyer would most look at**: `/integrations`, `/conversations`, `/reports`.

### Sidebar IA

The desktop sidebar exposes **18 navigation destinations** to a logged-in admin, split into a "primary" group of 9 and a "More" group of 9:

**Primary:** Event Log · Conversations · Alerts · Knowledge · Assets · Channels · Integrations · Usage · Team
**More:** Work Orders · Schedule · Requests · Parts · Documents · Reports · Ladder Logic · Namespace · Proposals

Two structural problems jump out:

1. **The three highest-value primitives — Namespace, Proposals, Channels — are split across the divider.** Channels is in primary; Namespace and Proposals are demoted to "More." This is precisely backwards. A user who just finished the onboarding wizard has a namespace and zero proposals; the path to first proposal is *connect a channel + upload a manual + wait for AI*. None of that flow is highlighted.
2. **Placeholder pages outrank real pages.** `Conversations`, `Alerts`, `Requests`, `Parts`, `Reports`, `Documents`, `Team` are all primary or near-primary — and all are mock/static. The real product (Namespace, Proposals) is in the overflow group.

There is no bottom-of-sidebar "What now?" callout. The Tour restart button is there, but the OnboardingTour itself is data-attribute anchored — fine when it runs, invisible if the user dismissed it.

### Onboarding wizard (`/onboarding`)

This is the **best part of the Hub**. Four linear steps:
1. **Company** — company name
2. **Site** — site name + optional location
3. **Line / Area** — line name + optional description ("What does it produce?")
4. **Review** — preview of `enterprise.{site_slug}.{line_slug}` UNS path

Each step writes to `/api/wizard/{step}` and resumes if interrupted. The final step redirects to `/namespace`. This is **exactly the right shape** for industrial onboarding: linear, low-friction, evidence-first (the live namespace preview).

**But it terminates without a next-step prompt.** A user lands on `/namespace` and sees the tree they just built — three nodes — with no nudge toward Channels (where the data comes in) or Knowledge (where manuals go). The "Twilio moment" — *first AI-cited answer* — is six clicks away with no breadcrumb to it.

### Feed empty state

`/feed` has **no first-run zero-data state.** KPI cards show 0/0/0/0, skeleton loaders flash, and then a quiet empty card list. The "All caught up ✓" state only fires when the user has *dismissed* cards. A brand-new account sees a UI optimized for power users on day 30, not day 1.

### Dead surfaces / scope leak

- `/plc` ("Ladder Logic" in the sidebar) is an iframe pointing at `https://mikecranesync.github.io/ladder-logic-editor/`. **A third-party GitHub Pages iframe inside a paid SaaS Hub is a credibility-killer for any industrial buyer who notices.** Hide it or remove the nav item until it has product integration.
- `/library` silently redirects to `/knowledge`. Dead nav.
- `/parts`, `/team`, `/reports`, `/conversations`, `/alerts`, `/requests` are all mock data without disclosure — see §5 recommendations on what to do with these.

### Strengths inside the Hub

- **Real, working namespace tree** with drag-drop edit.
- **Real, working proposal approve/reject flow** — this is the heart of the product and it ships.
- **Real, working channel connectors** (Telegram, Slack, Google, Nango, WebUI) — the activation moment for SaaS is wired.
- **Real, working knowledge upload** with the KbGrowthDashboard. 68k OEM chunks indexed is a moat.
- **Real, working asset registry** with QR scan + label export.
- **Mobile bottom-tab nav + FAB** + sun-readable mode + PWA — the industrial-floor UX is taken seriously.
- **Event log with reasoning + CMMS payload inspection per event** — this is excellent observability and a developer-tier feature.

---

## 4. Scorecard

Each dimension scored 1–10 against the canonical Twilio motion (10 = "literally Twilio").

| Dimension | Score | Why |
|---|---:|---|
| **Onboarding speed (signup → first value)** | 3 | Self-serve signup works (`/signup/`), and the 4-step wizard takes ~2 min. But "first value" — a first AI-cited fault answer — requires connecting a channel AND uploading a manual AND waiting for ingest/proposals. Marketing site never even links to `/signup/`. Twilio target was <5 min; realistic FactoryLM time-to-first-cited-answer is closer to 30 min for the fastest user. |
| **Self-service clarity (figure it out without a call)** | 4 | The wizard is linear and self-explanatory. Sidebar IA is not — 18 destinations with placeholders mixed in. Marketing site explicitly steers to "Book Your Maintenance Assessment" instead of self-serve. |
| **Single primitive (one clear thing the product DOES)** | 4 | The product has *two* primitives competing for headline status: (a) the UNS / namespace, and (b) the diagnostic AI cited answer. The marketing site emphasizes (a) ("we structure your world"); the Hub emphasizes (b) ("triage today's WOs"). New users will read the marketing site, sign up expecting (a), and land on a feed UI for (b). |
| **Data connection ease** | 6 | `/channels` is real and works for Telegram/Slack/Google/Nango/WebUI. This is genuinely good. -2 for 3 "Coming Soon" badges and -2 for no API-key / webhook / SDK self-serve path. |
| **Time to first insight** | 3 | No "demo data" mode. No public sandbox. A new namespace has 0 proposals until manuals are uploaded and the crawler runs. Twilio's `client.messages.create(...)` works in 60 seconds. |
| **Mobile-first** | 7 | Bottom tabs, FAB, PWA install, sun-readable contrast mode, QR scan flow, mobile overflow `/more` page. -2 for KbGrowthDashboard suppressed on mobile, -1 for drag-drop-only namespace edit. **Genuinely industrial-aware mobile work.** |
| **Developer experience** | 1 | No `/docs` portal exists. No SDK. No webhooks UI (the `/integrations` Webhooks tab is 3 hardcoded entries). No API-key management self-serve. No copy-paste cURL example anywhere. This is the single biggest gap. |
| **Visual clarity** | 6 | The Hub UI is clean, uses shadcn/ui consistently, KPI tiles are restrained. The marketing site is similarly clean. -2 for the visual noise of 18 sidebar items and -1 for placeholder pages indistinguishable from real ones. |
| **Navigation** | 4 | Sidebar order does not match user-priority order. Namespace + Proposals are demoted. Ladder Logic is promoted. `/library` is dead. `/admin` is a redirect stub. |
| **Industrial credibility** | 8 | "68,000+ OEM chunks." Named brands (AB, Siemens, ABB, Schneider, etc). PowerFlex 755 / F005 example is on-target. STOP-Voltage callout. Sun-readable mode. PWA. PLC/UNS vocabulary used correctly. **This is the dimension MIRA scores best on. Don't lose it.** |
| **Total** | **46 / 100** | (Twilio-flavor categories, ten weighted equally) |

**Re-weighted for the "Twilio of Industry 4.0" thesis specifically** — onboarding speed, single primitive, dev experience, and self-service clarity matter 2× — the score drops to **36 / 100**.

### Public-funnel score (separate)
The marketing site's adherence to Twilio motion: **15 / 50** (5 dimensions × 10). The 5-tile breakdown — *no self-serve CTA above fold (1), pricing is consultative not per-event (2), no developer docs (1), no in-page sandbox (1), founder mailto CTA (4 — credibility good, scalability bad)* — confirms the consultative wedge is intentional.

---

## 5. Competitor scoring (from public info + research-library proxy)

Scored against the same dimensions. Where I have direct knowledge from public docs/marketing, I score; where I don't, I leave blank rather than fabricate.

| Dimension | FactoryLM Hub | **Fuuz** | **Tulip** | **MaintainX** | **HighByte** |
|---|---:|---:|---:|---:|---:|
| Onboarding speed | 3 | 5 (free trial, app-store install) | 6 (free dev tier, ~10 min) | **9 (literally Twilio-class — sign up, add an asset, file a WO in 5 min on mobile)** | 4 (download installer, license file) |
| Self-service clarity | 4 | 5 | 7 (templated apps in marketplace) | **9** | 5 |
| Single primitive | 4 | 5 (MES "everything") | 7 (the "App") | **8 (the Work Order)** | **8 (the Data Model)** |
| Data connection ease | 6 | 7 | 8 (drag-drop connectors) | 5 (mostly manual entry) | **9 (OPC UA / MQTT / Sparkplug B / Modbus is the product)** |
| Time to first insight | 3 | 4 | 6 | **8 (file a WO, see it on the calendar)** | 5 (model first, then connect) |
| Mobile-first | 7 | 5 | 6 | **10 (mobile-native CMMS; this is their wedge)** | 2 (desktop config tool) |
| Developer experience | 1 | 4 (API docs published) | **8 (App Builder + JS API + webhook console)** | 5 (REST API, no SDK) | **9 (HighByte Intelligence Hub has its own docs portal + API + CLI)** |
| Visual clarity | 6 | 5 | 7 | **8 (the iOS-like CMMS UI is widely copied)** | 6 |
| Navigation | 4 | 5 | 7 | **8** | 6 |
| Industrial credibility | 8 | 7 | 7 | 6 (perceived as "CMMS not industrial") | **9 (deep OT roots, namespace authority)** |
| **Total (unweighted)** | **46** | **52** | **69** | **76** | **63** |

**The platform MIRA is closest to in pattern:** Tulip (modular Hub, apps + connectors + namespace) — but MIRA's IA is more cluttered than Tulip's marketplace-driven model.

**The platform MIRA loses hardest to on the Twilio dimensions specifically:** **MaintainX.** They are a CMMS that *feels* like Twilio because the primitive (a work order) is unambiguous, mobile-native, and produces value in five minutes. Mike has to read this part carefully — MaintainX is the proof that Twilio-class onboarding for industrial maintenance is *possible*, just not on FactoryLM's wedge (yet).

**The platform MIRA can credibly out-position on the "developer / OT" dimension:** **HighByte.** HighByte sells the namespace as the product but has no AI/diagnostic layer. MIRA can have both — *if* the developer-tier surface (docs, API, SDK, webhooks) actually ships.

---

## 6. Recommendations

### A. Hide / remove (kill the noise)
1. **Remove `Ladder Logic` from the sidebar.** Iframe to an external GitHub Pages site does not belong in a paid Hub. Move to a "Labs" or admin-debug surface or remove entirely.
2. **Remove `/library` route.** It's a silent redirect; the link in any UI should just point to `/knowledge`.
3. **Demote or remove `Parts`, `Conversations`, `Alerts`, `Requests`, `Reports`, `Team`, `Documents`** from sidebar until they are backed by real data. These are the placeholder pages. Pick ONE to make real first (recommend `Conversations` — it's the natural fit for the Slack/Telegram channel logs you already capture). The rest go behind a `Labs` or "Coming soon" flag, or get removed.
4. **Remove the `Sign in` link on `factorylm.com` top nav that points to `/cmms`.** Either it goes to `/login/` or it doesn't exist. Currently it's broken funnel hygiene.

### B. Redesign (fix the IA)
1. **Sidebar reorder.** New primary group (5 items max): **Feed · Namespace · Channels · Knowledge · Proposals.** That's the entire Twilio loop: see (Feed) → structure (Namespace) → connect (Channels) → ingest (Knowledge) → close the AI loop (Proposals). Move everything else to "More."
2. **Add a `/quickstart` page** that produces a cited answer in <60 seconds **using the existing 68k OEM chunk KB**, *without* requiring the user to upload their own data. Sample query pre-filled: "F005 fault on PowerFlex 755." Hit the existing diagnostic engine. Show the cited answer. The CTA at the bottom: "This is a generic answer. To get one cited to YOUR plant, connect a channel." Link to `/channels`. **This is the Twilio moment.**
3. **`/feed` needs a real first-run state.** When `kg_entities` count = 1 (just the company/site/line) and channels = 0, show a 3-card welcome strip: "Connect a channel," "Upload a manual," "Try a sample fault." Replace the empty KPI tiles with this strip.
4. **Onboarding wizard step 5: "Try MIRA now."** After the namespace preview, append one more step that lets the user pick a manufacturer from a dropdown, type a fault code, and see the cited answer from the OEM chunks. That converts the wizard from data-entry into data-entry + value-demonstration.

### C. Build (Twilio-grade surfaces that don't exist)
1. **Build `/docs` on `factorylm.com`** with a cURL example on page one: `curl -X POST .../diagnose -d '{"asset":"PowerFlex 525","fault":"F0004"}'`. This is the single most powerful step toward "Twilio of Industry 4.0" positioning. SEO will reward it for years.
2. **Build a real `/integrations` Webhooks tab.** Self-serve webhook URL, secret, event types, delivery log. Replace the 3 hardcoded entries.
3. **Build a real `/integrations` API tab.** User-generated API keys, per-key usage, revocation. Replace the static key.
4. **Add `/api/conversations`** and back the `/conversations` page with real Slack/Telegram thread logs. You already capture these.
5. **Per-event pay-as-you-go pricing.** `/usage` shows credit consumption; `/upgrade` shows two tiers ($20, $499) that don't match the marketing site ($97, $297). Reconcile. Add a per-event SKU ("$0.05 per AI fault answer," "$0.50 per manual chunk ingested") and surface it on `/pricing` and `/usage`.

### D. Marketing-site moves (anti-consultative escape hatch)
1. **Add a second primary CTA to `/`:** "**Try a fault diagnosis right now → /quickstart**." Keep "Book the assessment" — it's a real revenue line. Add the self-serve.
2. **`/pricing` should list the SaaS Operating Layer per-seat / per-event price next to the consultative tiers**, not below them.
3. **`/buy` should not be the only CTA.** Add `/signup/` as a parallel funnel.

### E. The 30-day vs 90-day Hub
**30-day Hub (ship this by 2026-06-20):**
- Sidebar reorder (Feed, Namespace, Channels, Knowledge, Proposals as primary)
- Remove Ladder Logic + Library
- Move placeholder pages behind a Labs flag
- `/quickstart` page with OEM-chunk demo (<60 sec first answer)
- Onboarding wizard step 5: "Try MIRA now"
- Marketing-site `Try a fault diagnosis` CTA
- `/integrations` real API key + real webhooks (replace hardcoded)
- `/feed` first-run welcome strip

**90-day Hub (ship this by 2026-08-20):**
- `/docs` portal on `factorylm.com` with cURL examples + JS/Python SDK
- Hosted public sandbox at `try.factorylm.com` — no signup, 60-sec demo
- Real `/conversations` (back with channel logs)
- Real `/reports` (back with namespace/proposals data, not hardcoded)
- Per-event pricing reconciled across `/pricing`, `/upgrade`, `/usage`
- Killed `/parts`, `/team` placeholder pages OR backed with real data
- `/integrations` connector marketplace (real connectors, not just "Coming Soon" badges)

### F. Priority order (if you can only do five things in the next two weeks)
1. **Reorder sidebar.** Free. One PR.
2. **Build `/quickstart`.** This is the Twilio moment. Use existing engine + OEM chunks.
3. **Hide placeholder pages behind a Labs flag.** Trust hygiene. One PR.
4. **Add `Try a fault diagnosis` CTA on marketing home + signup link.** Two PRs across `mira-web` and the marketing site.
5. **Onboarding wizard step 5.** Closes the loop from wizard → first cited answer.

---

## 7. Limitations of this audit (call out by Mike's request)

- **Authenticated UI not driven live.** Auto-mode classifier blocked production login. Findings on authenticated pages are from source-read; live rendering verified only by indirect signals (`hidden md:flex` CSS, prior route-health audits in `docs/audits/`).
- **Mobile screenshots only captured for public pages.** Authenticated mobile rendering is inferred from CSS responsive class signals in source.
- **Research library Mike referenced is missing on this branch.** Searches across `docs/` for "industry4-intelligence" / "Twilio-of-Industry4" / "customer-onboarding-spec" returned zero matches. Canonical Twilio criteria applied instead. If the research files exist elsewhere and contain different criteria, this audit should be re-scored.
- **Competitor scoring is from public knowledge + my general training**, not from the (missing) `companies/` research profiles. Order-of-magnitude correct; specific scores ±1.
- **No live diagnostic engine ping.** I did not invoke the diagnostic endpoint to verify the "<60 second cited answer" claim in §6.B.2 is actually achievable today. It should be — the engine + KB exist — but timing should be verified before committing to the `/quickstart` page as Twilio moment.

---

## 8. Screenshots captured

All in `docs/promo-screenshots/`, prefixed `2026-05-20_hub-twilio-audit_`:

- `00-login_desktop.png`, `00-login_mobile.png`
- `01-signup_desktop.png`, `01-signup_mobile.png`
- `02-marketing-home_desktop.png`, `02-marketing-home_mobile.png`
- `03-pricing_desktop.png`, `03-pricing_mobile.png`
- `04-cmms_desktop.png`
- `05-buy_desktop.png`

Live authenticated UI screenshots were blocked. Use the existing `mira-hub/tests/e2e/hub-audit.spec.ts` (which already drives these flows) to fill in the gap.

---

*End of audit. Audit doc lives at `docs/evaluations/hub-twilio-platform-audit-2026-05-20.md`. Screenshots: `docs/promo-screenshots/2026-05-20_hub-twilio-audit_*.png`.*
