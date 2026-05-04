# MIRA Sales System Audit — 2026-04-26

**Auditor:** Claude (Cowork)
**Scope:** HubSpot (mike@cranesync.com), Gmail, mira-web funnel, Apollo connection state
**Goal:** Inbound machine for plant maintenance managers / reliability engineers at small-to-mid manufacturers — convert events: booked call, reply, signup, or pilot
**Pace:** Audit only — no changes made

---

## TL;DR

You already own more inbound infrastructure than you're using. The funnel is built; the plumbing between it and the CRM is not. Pipeline today: 91 dormant imported contacts, 87 unlinked target companies, 4 real $499 pilot deals stuck at 10% probability since Apr 24, zero inbound capture flowing into HubSpot.

The five routines below are designed to make plants reach out to *you* by exploiting three assets that are already in your repo and aren't being used: (1) the QR code sticker system at `/m/:asset_tag` with Avery 5163 print routes, (2) the fault-code SEO library at `/blog/fault-codes`, and (3) the magic email inbox `kb+slug@inbox.factorylm.com`. None of these require a salesperson. All of them work while you sleep.

Three things are quietly bleeding revenue right now: drip campaigns only fire post-payment, HubSpot signups never sync from Neon, and the two real plant prospects (GMF Steel, Tampa Bay Steel) have been sitting untouched for two days.

---

## 1. What your sales system actually consists of

### HubSpot (account 245594539, owner: Mike Harper / mike@cranesync.com)

- **Tier:** STANDARD (not Marketing Hub Pro). Marketing campaigns are gated; sequences and workflows that fire emails from HubSpot are not available without an upgrade. Deal/contact/company/task/note write access is fine.
- **Contacts:** 91 total. All `hs_analytics_source: OFFLINE`, all `lifecyclestage: lead`, all `hs_lead_status: NEW`. They were imported, never progressed. The list is three groups:
  1. ~15 industrial-AI/predictive-maintenance academics (Purdue, GA Tech, Penn State, U-Mich, UTK, VT, CMU, A&M)
  2. ~10 government/funding contacts (NSF SBIR, Navy ManTech, OSD ManTech, NIST MEP, NASA OSBP)
  3. Accelerators / VCs (Techstars, Greentown, Root Ventures, Construct Capital)
  4. **Two actual plant ICP contacts** — Thomas Hampton (Operations Manager, Tampa Bay Steel) and Markus Dillman (Lead Plant Engineer, GMF Steel Group). Created Apr 24. No follow-up activity logged.
- **Companies:** 87 total, predominantly Tampa/Florida small-mid manufacturers — steel, machining, sheet metal, plastics, food production, chemicals. Good ICP fit. Critical bug: `num_associated_contacts: 0` on every company. Contacts and companies are not associated, which means anything that needs the join (account-level views, weighted sequences, BANT enrichment) silently fails.
- **Deals:** 5 total. Four are real `MIRA Pilot — [Plant]` deals at $499 ARR each (Tampa Bay Steel, GMF Steel, Publix Distribution, Mosaic Bartow), all parked in stage `3375715028` at 10% probability — that's the entry stage. Plus 1 sample. **$1,996 of mostly-cold pipeline. Nothing closed.**
- **Owners / sequences / campaigns:** Mike alone. No HubSpot sequences exist (Standard tier limit). No marketing campaigns enabled.

### Gmail (mike@cranesync.com)

- **Label structure exists, content doesn't.** `Cold Email` and `Awaiting Reply` labels are empty for the past 60-90 days. `Marketing` and `LinkedIn` labels mostly hold inbound vendor newsletters, not Mike's outbound.
- **Real outbound traces:**
  - Pitch deck to Jacob Barhydt @ LAUNCH (VC) — Feb 27 → he replied "I'll take a look" → no follow-up logged.
  - FFSBDC / Karen Krymski — gov contracting consulting setup, capability statement sent Apr 8.
  - Inbound sales attempts received: Eddie @ TheJobHelpers (resume / hiring), Dan @ BuildTheStory (Gust Countdown approval), Ross @ balena, Sylvestre @ Parseur, Montreal @ Oracle, Ben @ AnyIP, Rowen @ Appenate. These are inbound *to* Mike from vendors — examples of what other companies do to him; useful as templates.
  - One outbound to Ben @ AnyIP (replied to a GitHub repo question) — handled cleanly, but no CRM logging.
- **`Jarvis/Auto-Handled` / `Jarvis/Needs-Draft` / `Jarvis/Escalated` labels** suggest you have an existing AI email assistant running (Gmail-side). Worth understanding what's auto-replied vs escalated — could be a sales lead disposition layer.
- **Operational signal:** Multiple Wells Fargo "card declined — insufficient funds" alerts in the last 72 hours. Revenue is not academic.

### mira-web funnel (this is the part you're underusing)

The Hono/Bun app at `/Users/charlienode/MIRA/mira-web` is doing more sales work than the CRM is. Inventory:

| Surface | Path | What it does | Inbound use |
|---|---|---|---|
| Homepage | `GET /` | `public/index.html` | Top-of-funnel |
| CMMS landing | `GET /cmms` | `public/cmms.html` | PLG self-serve entry |
| Pricing | `GET /pricing` | $97/mo | Conversion |
| Blog | `GET /blog`, `/blog/:slug`, `/feature/:slug` | NeonDB-backed blog posts + fault codes + feature pages | **SEO** — sitemap.xml is dynamic |
| **Fault Code Library** | `GET /blog/fault-codes` | Seeded `FAULT_CODES` data (in `src/data/fault-codes.ts`) | **High-intent SEO play, underbuilt** |
| **QR Scan** | `GET /m/:asset_tag` (+ `/choose`, `/report`) | Plant tech scans a sticker → asset-aware MIRA chat | **The inbound mechanic that kills cold email** |
| QR Print Admin | `GET /admin/qr-print` | Generates Avery 5163 sticker PDFs | Sales tool |
| QR Test | `GET /qr-test` | Branded sticker preview | Demo asset |
| Magic Email Inbox | `POST /api/v1/inbox/email` | Tenant emails PDFs to `kb+{slug}@inbox.factorylm.com`, Postmark webhook ingests | Onboarding loop |
| Register | `POST /api/register` | Email + company → pending tenant in NeonDB → triggers welcome email + drip | Capture |
| Stripe Checkout | `GET /api/checkout` | $97/mo | Activation |
| Drip scheduler | `src/lib/drip.ts` | Daily worker, 7-touch nurture (Days 1-10) | Existing automation |
| MIRA Connect | `POST /api/connect/generate-code`, `/activate` | Factory-side Ignition activation | Field deploy |
| PostHog | `/posthog-init.js` | `[data-cta]` clicks tracked automatically | Analytics |
| Atlas SSO | `GET /api/cmms/login` | Auto-provisions Atlas CMMS account on activation | Onboarding |

**Existing drip schedule (`DRIP_SCHEDULE` in `mailer.ts`):**

```
Day 1  beta-loom-1       "Watch: How Mira diagnoses a VFD fault in 10 seconds"
Day 2  beta-loom-2       "Watch: The CMMS that fills itself out"
Day 3  beta-loom-3       "Watch: Upload a manual, ask Mira anything from it"
Day 5  beta-loom-4       "Watch: Slack + Telegram — Mira where your team already is"
Day 6  beta-social-proof "We stopped guessing — how one team uses FactoryLM"
Day 7  beta-payment      "Your spot is ready — $97/mo to start"
Day 10 beta-reminder     "Still thinking about it?"
```

This drip is post-`/api/register` only. There is no pre-register nurture, no stale-lead resurrection, no churned-tenant winback, no field-trigger re-engagement (e.g. "you scanned a QR but never signed up").

### Apollo

The plugin folder ships skills (`apollo:prospect`, `apollo:enrich-lead`, `apollo:sequence-load`) but **no Apollo MCP server is connected to this Cowork.** The skills have nothing to call. This is a 5-minute fix and unlocks the cold outbound routine in §3.5.

---

## 2. Diagnosis — what's actually broken

| # | Problem | Cost | Fix difficulty |
|---|---|---|---|
| 1 | **HubSpot ↔ mira-web are detached.** Signups land in `plg_tenants` (Neon) and never create HubSpot contacts/companies/deals. The CRM is a static import. | You can't run any HubSpot-side workflow on real funnel signups. | Low — one-way sync from `/api/register` and `stripe.webhook` |
| 2 | **No company↔contact associations.** All 87 companies show 0 contacts. | Account-level views and weighted scoring are dead. | Low — backfill by domain match |
| 3 | **Drip only fires for paid funnel.** A pre-register cold contact gets nothing. | The 91 imported leads have no automated path forward. | Medium — extend `drip.ts` to support `lead` segments |
| 4 | **The two real plant prospects are aging.** Markus (GMF) and Thomas (Tampa Bay Steel) have $499 deals at 10% prob created Apr 24, no associated activity since. | Lost momentum on the only real ICP fit in your CRM. | Trivial — see §3.0 Same-Day plays |
| 5 | **Fault code library is seeded data, not living.** `src/data/fault-codes.ts` is the static seed; `getLiveFaultCodes()` reads from Neon for drafts. There's no growth mechanism — every fault you don't have a page for is a search you don't capture. | Each missing code is a leaked top-of-funnel intent click. | Low — content factory routine in §3.2 |
| 6 | **QR mechanic has zero distribution.** You can print stickers via `/admin/qr-print` but no routine puts them in plants' hands. | The strongest inbound mechanic in the codebase is dormant. | Medium — sticker-drop routine in §3.1 |
| 7 | **Magic Email Inbox is gated to paying tenants.** `kb+slug@` requires tenant provisioning. | Loses the most viral signup mechanic possible (forward a manual, get an answer). | Medium — open a public `manual@factorylm.com` variant |
| 8 | **Brand confusion.** Your sender identity is `mike@cranesync.com`. The product is `factorylm.com`. Receiving a cold email from a different domain than the landing page tanks reply rate. | Suppressed reply rate on every outbound touch. | Trivial — send from `mike@factorylm.com`. (Apr 24 you sent yourself a test that bounced 550 — the MX may not be set up.) |
| 9 | **Apollo MCP not connected.** | Cold outbound at scale isn't possible from Cowork. | 5 minutes — connector install |
| 10 | **No "scanned but didn't sign up" capture.** `/m/:asset_tag` is anonymous-friendly. There's no email-gate or async re-engagement when an unknown tech scans. | Anonymous high-intent traffic walks away. | Medium — soft email capture in `/m/:asset_tag/choose` |

---

## 3. Five automated contact routines designed to make people call *you*

Each routine below specifies the trigger, the touch sequence, the data flow, and the build effort. These are designs only — none are shipped per the audit-only scope.

### 3.0 Same-day unblock (do this first, no automation needed)

Before any of the routines below, send two personal emails today:

- **Markus Dillman** (Lead Plant Engineer, GMF Steel Group) — re-open the $499 pilot. One paragraph, name a specific machine class likely on his floor (rolling mill drive, induction furnace VFD, etc.), offer to mail a 10-pack of MIRA QR stickers free.
- **Thomas Hampton** (Manager, Operations, Tampa Bay Steel) — same play. Offer to add the first manual for free as a setup gift.

Both deals are aging. A two-day-old $499 deal with no activity converts to zero. Reply rate on a personalized sender from a real founder beats any sequence.

### 3.1 Routine: **Sticker Drop** (highest leverage)

The QR sticker system in your repo is the sharpest inbound weapon you have and it's cold. Plant maintenance managers don't read LinkedIn at the press; they have greasy hands and a phone in their hip pocket. A sticker on a problem machine that opens an asset-aware AI chat collapses the demo into an actual support session.

**Trigger:** A new HubSpot company with `industry IN (MACHINERY, FOOD_PRODUCTION, CHEMICALS)` AND `state IN (FL, GA, AL)` (your Tampa concentration is a feature, not a bug — start local, ship-cost is low).

**Sequence:**

| When | What | Channel | Build |
|---|---|---|---|
| T+0 | "We're sending you 10 free MIRA stickers — drop one on your worst machine. Reply with your shipping address and I'll have them out tomorrow." | Email from mike@factorylm.com (HubSpot Sales free tier is fine) | Personal note + Calendly fallback |
| T+address-confirm | Generate sticker batch (`POST /api/admin/qr-print-batch`), Mike mails Avery 5163 sheet | Physical | Existing route works, add fulfillment SOP |
| T+7 days after delivery | "How's the sticker doing? If a tech has already scanned it, I'll know — if not, here's a 2-minute video showing what they get when they do." | Email | Use mira-web `/m/:asset_tag` analytics from `qr-tracker.ts` |
| First scan event | Fire instant alert to Mike: "Your tech at GMF Steel just scanned the press-1 sticker. They asked: '[query]'." | Push (email + Slack DM) | New webhook on `m.ts` scan handler |
| T+14 with no scan | "Want me to walk through where to put it? Plants that scanned in week 1 are 4× more likely to set up." (use real data when you have it) | Email | Drip extension |
| T+21 with one or more scans | "You've used MIRA Y times this week — want to make it permanent? $97/mo." | Email | Convert to existing `beta-payment` flow |

**Data flow:** New HubSpot company → Mike approves shipping → `qr-print-batch` → tracking row in Neon → `qr-tracker.ts` events drive next-touch logic.

**Conversion event optimized for:** Reply, scan, signup. The sticker is the meeting.

**Build:** ~2 days. 80% of the code already exists.

### 3.2 Routine: **Fault Code Trojan Horse** (compounding SEO)

Every PLC, VFD, robot, and HMI fault code is a 2 AM Google search. A maintenance tech typing "VFD fault E05 reset" wants an answer in 15 seconds. If your page gives it to them, you own that intent forever.

**Trigger:** Anyone visits `/blog/:slug` for a fault-code page (PostHog page view event already fires).

**Sequence:**

| When | What | Channel | Build |
|---|---|---|---|
| In-page | Above the fold: "Get the printable troubleshooting card for fault E05 (PDF)" — email gate, single field | Web form | New form widget on fault-code template |
| T+0 (instant) | Branded PDF: 1-page laminated-friendly card with the fault, common causes, reset procedure, escalation tree | Email (Resend) | Use existing PDF generation infrastructure (`qr-pdf.ts`) |
| T+1 day | "What machine were you troubleshooting? Reply with manufacturer + model and I'll send you the relevant section of the manual MIRA has." | Email | Re-prompt; reply triggers MIRA-driven personalization |
| T+3 days | "Here's MIRA diagnosing that exact fault on a [their model] — 90 seconds" — Loom or autogenerated chat-replay | Email | Use `mira-pipeline` to generate a recorded answer |
| T+7 days | "Free 30-day pilot — print 10 stickers for your plant, no credit card." | Email | Convert path |
| T+30 days no convert | Move to monthly newsletter (digest of new fault codes added) | Email | Long-term nurture |

**Content factory side:** A Claude job runs nightly. Pulls the top 20 search queries that hit `/blog/*` and got no result (or a low-quality result), generates draft fault-code pages from the OEM manuals already in your KB, files them as PRs to `mira-web/src/data/fault-codes.ts` for human review, ships behind a feature flag. You publish 5/week, the library grows from ~the seed today to several hundred in 6 months.

**Build:** ~3 days for the form + drip; the content factory is a cron + Claude job, ~1 day.

### 3.3 Routine: **Manual-by-Email** (zero-friction signup)

The single most viral mechanic in your codebase is `kb+slug@inbox.factorylm.com`. It's gated behind a paid tenant. Open the gate.

**Public address:** `manual@factorylm.com`. No signup. Anyone forwards a PDF of a manual.

**Sequence:**

| When | What | Channel | Build |
|---|---|---|---|
| T+0 (instant) | Auto-reply: "Got your manual. Try MIRA on it now: [chat URL with one-time token, no account needed]" | Email | Postmark webhook → existing inbox handler with anonymous-tenant flag |
| T+1 hour | If they used the chat: "MIRA answered N questions for you on that manual. Want a permanent link + 10 QR stickers for the machine?" | Email | Track `mira-chat.ts` queries against the one-time token |
| T+1 day no chat use | "Here's the chat link again, plus a 60-second video showing what to ask" | Email | |
| T+3 days | "Want MIRA in your CMMS too? Free 30-day pilot." | Email | Convert to existing register flow with prefilled email/company |
| T+7 days | "Your one-time link expires tomorrow — want to keep it forever?" | Email | Hard expire signal |

**Why this is huge:** A maintenance manager forwards a PDF they've had for years and instantly gets value. Half forward it from a corporate email — that's an enriched lead. The other half forward from personal — you still get the email and the company is in the manual's metadata.

**Risks:** Spam abuse. Mitigations: rate-limit per sender domain, malware scan, reject password-protected PDFs, hard 50MB cap (already in `INGEST_MAX_BYTES`).

**Build:** ~3-4 days. Heaviest lift is the anonymous-tenant chat path.

### 3.4 Routine: **Stale Lead Resurrection** (revive the 91)

The 91 imported contacts are static. Resurrect them in three batches keyed to their type.

**Batch A — Industrial-AI academics** (~15 contacts):

This isn't sales; it's research credibility. The play is co-author / case study, not pilot. One touch:
- "We're publishing benchmarks on industrial-AI fault diagnosis vs OEM manuals across 6 equipment families. We'd value your review of the methodology — 30 minutes, your name on the write-up."

**Batch B — Government / SBIR / ManTech** (~10 contacts, including Tracy Frost OSD ManTech, Neil Graf Navy ManTech, Rajesh Mehta NSF SBIR, Cheryl Gendron NIST MEP):

Government doesn't buy pilots — they fund SBIR Phase I. One touch:
- "MIRA is a deployed system at [first plant customer]. We're targeting a Phase I in [their topic]. Could we get 15 minutes to walk through the technical fit?" Karen Krymski (FFSBDC) is already in your inbox helping with this — loop her in.

**Batch C — Accelerators / VCs** (Avidan Ross / Root, Rachel Holt / Construct, Laila / Techstars STANLEY+, Georgina / Greentown):

Not a sales motion. Quarterly investor update. Send one paragraph + one chart per quarter, nothing more.

**HubSpot workflow that fires automatically once anything is built:** lead status `NEW` AND lastmodified > 21 days AND industry/role tag matches one of A/B/C → enroll in the matching template.

**Build:** ~1 day for the batched outreach (you're the human in the loop on copy). The HubSpot side requires the sync from §3.0 to be live first, but if you're on Standard tier the workflow needs to fire from Mike's inbox via a separate sequencer (Apollo, Lavender, or a custom worker reading HubSpot via the same MCP we just used).

### 3.5 Routine: **Plant Manager Cold Outbound** (Apollo, once connected)

This is the one routine that requires real outbound. Don't do it until the four above are running — they generate inbound, this generates outbound, and inbound has 5-10× the conversion rate.

**ICP filter:** Apollo search → Job titles: "Maintenance Manager", "Reliability Engineer", "Plant Manager", "Operations Manager", "Maintenance Supervisor". Industries: Machinery, Food Production, Chemicals, Plastics, Metals. Location: FL + GA + AL + SC + NC. Company size: 50-500 employees. Has phone number = true.

**Daily volume:** 10 contacts/day. (Not 100. Personal trumps volume; 10 ICP-perfect is better than 100 noise.)

**Sequence:**

| When | What | Channel | Personalization |
|---|---|---|---|
| T+0 | LinkedIn connection request | LinkedIn | "Saw [their company] makes [thing]. Built MIRA so techs can diagnose machine faults from the floor without leaving the asset. Worth a 1-min look?" |
| Connection accept | LinkedIn DM with fault-code library link, no ask | LinkedIn | "No pitch — bookmarked our fault code library for you, scan the QR code to your VFD and try one." |
| T+3 days | Email touch: "60-second video of MIRA diagnosing [fault common to their equipment]" | Email (Apollo sequence) | LLM-drafted opener referencing their company's last LinkedIn post |
| T+7 days | "Want me to mail you 10 free stickers? Stick one on your worst machine, see if it's helpful, no card." | Email | This loops them into the Sticker Drop routine (§3.1) |
| T+14 days | "Last note from me — here's the public sandbox if you ever want to try it: factorylm.com/m/demo" | Email | Bridge to long-term nurture |

**Build:** Apollo MCP install (5 min) + sequence build (1-2 hours). Daily volume controlled by Apollo credits.

---

## 4. Recommended ship order (assuming you green-light the routines)

1. **This afternoon (no code):** Send the two manual emails to Markus and Thomas (§3.0). Fix the `mike@factorylm.com` MX so all sender identities match (the Apr 24 bounce is a tell).
2. **Week 1:** HubSpot ↔ mira-web sync (`/api/register` and stripe webhook → HubSpot contact + company + deal). Backfill company-contact associations by domain. This unblocks every routine below.
3. **Week 1-2:** Sticker Drop routine (§3.1) for the 87 companies you already imported. Start with 20 plants the first batch. Cost: stamp + Avery sheet ~$2/plant.
4. **Week 2-3:** Fault Code Trojan Horse (§3.2) — the highest-compounding play but also the slowest payoff. Start now, results in 60-90 days.
5. **Week 3:** Manual-by-Email (§3.3) — open the inbox publicly. Single highest viral coefficient on this list.
6. **Week 4:** Stale Lead Resurrection (§3.4). Don't do this before HubSpot sync is live or you'll spam from a stale list.
7. **Week 5+:** Apollo cold outbound (§3.5). Only after the inbound machine is generating signups, so cold prospects can be told "10 plants signed up last month" instead of "we're new."

---

## 5. Things you should NOT do

- **Don't upgrade HubSpot to Marketing Hub Pro yet.** Standard + Apollo + your own drip system covers 95% of what you need at <10% of the cost. Revisit at $50K MRR.
- **Don't build a chat widget on factorylm.com homepage.** Your demo is the product itself (`/m/:asset_tag`, the magic inbox, the fault code library). A chat widget on the marketing site competes with the actual product surface and gives a worse impression.
- **Don't run cold outbound from cranesync.com.** It will get filtered as identity drift. Send from factorylm.com or wait until the MX is fixed.
- **Don't run any of these against the academic batch (§3.4 Batch A) with sales copy.** Wrong audience, wrong motion.

---

## 6. What I did NOT do (out of audit-only scope)

- Did not write any contact, deal, or task to HubSpot.
- Did not send any email or draft.
- Did not create any HubSpot workflow, list, or property.
- Did not modify any code in mira-web.
- Did not connect Apollo MCP or any other source.

When you're ready to ship a routine, point me at the one and I'll move from audit to build.

---

**Cited / inspected:**
- HubSpot account 245594539 — contacts, deals, companies (read-only)
- Gmail mike@cranesync.com — searched threads for sales/outreach/cold/marketing labels
- `/Users/charlienode/MIRA/mira-web/src/server.ts`
- `/Users/charlienode/MIRA/mira-web/src/lib/drip.ts`
- `/Users/charlienode/MIRA/mira-web/src/lib/mailer.ts`
- `/Users/charlienode/MIRA/mira-web/src/routes/m.ts` (referenced)
- `/Users/charlienode/MIRA/mira-web/src/data/fault-codes.ts` (referenced)
- `/Users/charlienode/MIRA/CLAUDE.md`
