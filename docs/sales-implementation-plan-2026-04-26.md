# MIRA Implementation Plan — Path to First Paying Customer

**Companion to:** `docs/sales-audit-2026-04-26.md`
**Owner:** Mike (FactoryLM)
**Plan window:** 2026-04-26 → 2026-06-07 (six weeks to first paying customer that didn't come from your warm network)

---

## Question 0: Should you wait until the product is "ready"?

**Short answer: no — but don't ship like it's GA either. Run customer-development pilots.**

Three things are true at the same time, and you should hold all three:

**1. You will not feel ready.** Founders who wait until they feel ready don't ship. The 80% feeling persists for at least another year. The 80% feeling is not signal — it's the founder's job. The signal you should listen to is whether real users get value once, not whether you've personally signed off on every edge case.

**2. Your product *does* have a working core.** Open WebUI + mira-pipeline + Telegram bot + Atlas CMMS + Stripe + magic email inbox + QR scan flow + drip emails — all live. Real signups can pay $97/mo and get auto-provisioned into a CMMS with a chat agent, a manual ingest pipeline, and a shared inbox. The infrastructure is not a prototype. You forget this because you're inside it.

**3. There is a difference between *general availability* and *early-access pilots*.** General availability means: a stranger pays, succeeds, churns or expands without you ever knowing they existed. Early-access pilots mean: you mail them a sticker pack, they're ten people in a Slack channel with you, the deal is "we're learning together, you pay $97/mo or zero, and I personally fix anything that breaks." The audit's five routines are designed for the *pilot* mode, not GA. Don't conflate them.

**The right move:** start contacting customers this week, with the *frame* set explicitly: "MIRA is in early access. We're working with 5-10 plants this quarter. Free 30-day pilot, $97/mo after, mail me your worst machine and I'll prove it." That frame lowers customer expectations to where the product actually is, while still extracting the two things you need from them: usage data, and either money or a no.

The risk you avoid by waiting is "embarrassing demo." The risk you take on by waiting is "no one wants this and I built for nine more months." The second risk is much larger.

---

## Readiness gate — when *can* you stop adding and start contacting?

A 7-point gate. If 6/7 are green, run the routines. If 5/7, run with the two real prospects and one friendly only. If 4/7 or below, fix the red ones first — but they should take days, not months.

| # | Gate | Pass if... | Status today |
|---|---|---|---|
| 1 | **Stranger can sign up and pay without you intervening** | A test signup from an unknown email gets through `/api/register` → Stripe → Atlas provisioning → activation email → first chat in <10 minutes with no manual touch | Test it tomorrow with a throwaway address |
| 2 | **First chat returns *something* not garbage** | An anonymous user uploads a real OEM manual via magic inbox and asks 3 questions; at least 2 get useful answers (not "I don't know") | Likely green — `mira-pipeline` is real |
| 3 | **No data crosses tenants** | The cross-tenant test in `mira-web/src/routes/__tests__/cross-tenant.test.ts` passes; tenant A cannot read tenant B's KB or work orders | Verify with `bun test cross-tenant` |
| 4 | **PII sanitization runs on every cascade call** | `InferenceRouter.complete()` sanitizes by default; both Open WebUI fallback and bot adapters strip IPs/MACs/serials before sending to LLMs | Per security-boundaries.md, this is in. Verify with the eval suite. |
| 5 | **One support channel works** | Customer can email mike@factorylm.com and get a reply same-day. Right now mike@factorylm.com bounces — fix the MX before any outbound. | RED. Fix today. |
| 6 | **You can describe what MIRA does NOT do, in writing** | A `/feature/limitations` or `/trust` page says "we don't do X, Y, Z yet" so customers self-select | `/trust` exists; check whether it sets expectations honestly |
| 7 | **You can stop a customer from getting hurt** | Safety keywords (arc flash, LOTO, confined space) escalate immediately rather than getting a generic chat response | Per `mira-bots/shared/guardrails.py`, 21 phrase triggers are wired. Green. |

Your real blockers are likely #1 (test it), #5 (MX), and #6 (write the limits page honestly). All can ship in 2 days.

---

## Phased plan — six weeks, ship dates anchored to today

> **Convention:** "Owner: M" = Mike. "Owner: C" = Claude (in a future Cowork session). Dates in `YYYY-MM-DD` per project standard.

### Phase 0 — Foundation (Apr 26 → May 03, 1 week)

The unblockers. Nothing in Phase 1+ is allowed to start until these are green.

| Task | Why | Owner | Ship by | Issue ref |
|---|---|---|---|---|
| Personal email to Markus Dillman (GMF Steel) — revive the $499 pilot, offer free sticker pack | Aging deal at 10% prob, Apr 24 created, no activity. Highest-leverage 5 minutes of the week. | M | Apr 27 | #SO-001 |
| Personal email to Thomas Hampton (Tampa Bay Steel) — same play | Same. | M | Apr 27 | #SO-002 |
| Fix the `mike@factorylm.com` MX so outbound from your domain delivers | Apr 24 test bounced 550 5.1.1. Sender identity drift kills reply rate. | M | Apr 28 | #SO-003 |
| Run a cold-stranger signup test end-to-end (throwaway gmail → register → Stripe test mode → activation → first chat) | Validates Readiness Gate #1. | M | Apr 28 | #SO-004 |
| Write `/limitations` page — explicit list of what MIRA doesn't do yet | Validates Readiness Gate #6. Sets expectations. | M+C | Apr 30 | #SO-005 |
| Send the Customer Usability Survey to 5 friendlies (see `docs/customer-usability-survey-2026-04-26.md`) | Get baseline usability data before any new traffic. | M | May 01 | #SO-006 |
| Connect Apollo MCP to Cowork | 5-min config. Unblocks Phase 4. | M | May 03 | #SO-007 |
| HubSpot ↔ mira-web one-way sync: `/api/register` and Stripe webhook → HubSpot contact + company (by domain) + deal in stage `entry` | Unblocks every workflow downstream. | C | May 03 | #SO-010, #SO-011 |
| Backfill HubSpot company-contact associations by domain match across the 87/91 records | Without this, account views are dead. | C | May 03 | #SO-012 |

**Phase 0 exit criteria:** Markus + Thomas have replied (yes/no/silence — any signal is fine). MX fixed. Sync live. 5 surveys returned. Apollo connected. `/limitations` page deployed.

### Phase 1 — Sticker Drop (May 04 → May 17, 2 weeks)

The first inbound routine. Targets the 87 imported FL/southeast manufacturers. Goal: 10 plants get a sticker pack, 3 scan, 1 books a call.

| Task | Why | Owner | Ship by | Issue ref |
|---|---|---|---|---|
| Source vinyl stickers — see Sticker SOP below for 4 options | Plant-floor durable | M | May 05 | #SO-020 |
| Build the "unclaimed asset" flow on `/m/:asset_tag` — let an unknown tech scan and either start anonymous chat or claim to an email | Today the route assumes a known tenant. Cold outbound needs a public path. | C | May 08 | #SO-021 |
| Pre-generate 20 sticker packs (10 unique asset_tags each) using `POST /api/admin/qr-print-batch` against a pool of pre-created "pilot" tenant placeholders | Per-pack uniqueness for tracking | C | May 09 | #SO-022 |
| Build mailing kit: 10 stickers + 1 setup card + Mike business card + handwritten Post-It (template) | Physical fulfillment | M | May 10 | #SO-023 |
| Identify first 20 plants from the 87 by name, get a manager's name + shipping address (call front desk if needed) | Personal touch on cold = the difference. | M | May 12 | #SO-024 |
| Send introductory email to the 20: "Free 10 stickers, no card, mail me back your address" | Capture | M | May 12 | #SO-025 |
| Mail packs as addresses come in (rolling, not batched — speed matters) | Fulfillment | M | May 13-17 | #SO-026 |
| Wire scan-event → email alert to Mike + HubSpot deal stage advance | Real-time signal when a plant tech scans | C | May 17 | #SO-027 |

**Phase 1 exit criteria:** ≥10 packs mailed, ≥3 scans logged, ≥1 booked call, $0 to $499 in pipeline-advance.

### Phase 2 — Manual-by-Email public inbox (May 18 → May 31, 2 weeks)

Open `manual@factorylm.com` to anyone. Highest viral coefficient on the list.

| Task | Why | Owner | Ship by | Issue ref |
|---|---|---|---|---|
| Build anonymous-tenant chat flow with one-time token (no account needed) | Removes signup friction | C | May 22 | #SO-030 |
| Public inbox handler at `manual@factorylm.com` with rate limit (per sender domain), malware scan, 50MB cap, password-protected PDF reject | Spam abuse mitigation | C | May 24 | #SO-031 |
| Auto-reply email with the chat link + 60s Loom showing a tech using it | Activation | M+C | May 25 | #SO-032 |
| 5-touch follow-up drip for `manual@` users (T+0, T+1h, T+1d, T+3d, T+7d) | Convert | C | May 27 | #SO-033 |
| Post on r/PLC, r/Maintenance, r/Manufacturing, r/MaintenanceandReliability with a single "free utility, forward me your worst manual" announcement | Organic discovery | M | May 28 | #SO-034 |
| LinkedIn announcement post + 3 industrial trade Facebook groups | Same | M | May 28 | #SO-035 |

**Phase 2 exit criteria:** ≥20 manuals submitted, ≥10 chat sessions started, ≥2 conversions to signup or booked-call.

### Phase 3 — Fault Code Trojan Horse (Jun 01 → Jun 21, 3 weeks; benefit compounds for years)

This is the slowest payoff but highest moat. SEO content + email gate + content factory.

| Task | Why | Owner | Ship by | Issue ref |
|---|---|---|---|---|
| Add email-gated "printable PDF" CTA above the fold on every `/blog/:slug` fault-code page | Capture intent | C | Jun 03 | #SO-040 |
| Build the printable PDF generator (reuse `qr-pdf.ts` patterns) for fault-code cards | Asset for capture | C | Jun 05 | #SO-041 |
| 7-touch nurture sequence for fault-code email captures | Convert | C | Jun 08 | #SO-042 |
| Nightly Claude content factory: pull underperforming fault-code searches from PostHog, draft new pages from KB, file as PRs | Auto-grow library | C | Jun 14 | #SO-043 |
| Backlinks: submit fault-code library to Reddit r/PLC, IndustryWeek, AutomationDirect community, 5 OEM forums | Distribution | M | Jun 21 | #SO-044 |

**Phase 3 exit criteria:** ≥50 fault-code pages live, ≥100 organic page views/week, ≥10 PDF captures, content factory running autonomously.

### Phase 4 — Cold outbound via Apollo (Jun 22 → ongoing)

Only after Phases 1-3 are running and you have 1-3 paying customers to reference in cold copy. Don't run cold from a zero-customer position.

| Task | Why | Owner | Ship by | Issue ref |
|---|---|---|---|---|
| Build Apollo ICP filter: maintenance/reliability/operations roles, machinery/food/chemical, 50-500 employees, FL+GA+AL+SC+NC | Targeting | M+C | Jun 23 | #SO-050 |
| Apollo sequence: LinkedIn connect + DM + 5-touch email | Sequence | M | Jun 24 | #SO-051 |
| Loop into Sticker Drop on touch 4 | Bridge to inbound | M+C | Jun 26 | #SO-052 |
| 10 leads/day cap. Watch reply rate weekly; iterate copy on Friday review. | Quality > volume | M | ongoing | — |

---

## Sticker fulfillment — how to make + mail them

### Step 1: Decide on sticker durability

Plant floors are oily, hot, dusty, and vibrating. Paper labels die. Four sourcing options ranked:

| Option | Cost / 100 | Durability | Time to first batch | Recommended? |
|---|---|---|---|---|
| **Avery 22806 weatherproof film** + home laser printer | ~$45 (100 labels + Avery sheet stock) | OK for 6-12 months indoors, fades on direct sun | Same day | Use for the first 5 mailings while you wait on real vinyl |
| **Sticker Mule "Die-Cut Vinyl" 2"x2"** + UV laminate | ~$70 for 100 (qty discount kicks in at 250) | 2+ years outdoor, oil/heat resistant | 5-7 business days | **Yes, the default** |
| **Stickerapp.com "Industrial Vinyl"** | ~$80 for 100 | Same | 5-7 business days | Equivalent alternative |
| **Local print shop with 3M IJ180 vinyl + UV overlam** | ~$2-3 each | 5+ year outdoor rated | 1-3 business days locally | If you have a Tampa shop |

Recommendation: order 100 Avery 22806 sheets for immediate use AND submit a 250-pack Sticker Mule order on the same day. You ship the first 5 mailings on Avery, switch to vinyl when they arrive.

### Step 2: Generate the sticker sheet from mira-web admin

Each sticker carries a unique asset-tag URL like `factorylm.com/m/F1A2B3C`. Workflow:

1. In NeonDB, create 20 placeholder pilot tenants (script: `scripts/seed-pilot-tenants.ts` — see issue #SO-022).
2. Hit `POST /api/admin/qr-print-batch` with `{tenant_id, asset_count: 10}` for each pilot tenant.
3. Server returns an Avery 5163 PDF (10 labels per sheet, 4"x2" each — use the smaller 5160 layout if you want 30 per sheet at 1"x2.625").
4. Print onto Avery 22806 sheet, OR send the PDF to Sticker Mule as a die-cut order with a 0.125" bleed.

The QR per sticker resolves to `factorylm.com/m/{asset_tag}` which today routes through `mira-web/src/routes/m.ts`.

**Open requirement:** Today `m.ts` assumes the asset_tag is bound to a real tenant. For cold mailings to plants who haven't signed up yet, the route needs to handle unclaimed assets — first scan prompts for email + plant name, then claims the placeholder tenant to a real account. That's issue #SO-021.

### Step 3: Assemble the mailing kit

Per pack:
- 10 vinyl stickers (the sheet)
- 1 setup card (5"x7", double-sided): front shows a plant photo with the QR placement; back gives 4-step setup ("Pick your worst machine. Stick a sticker on it. Tell your tech to scan it next time it breaks. Reply to this email when they do.")
- 1 Mike business card (mike@factorylm.com — get it printed on Vistaprint, ~$15 for 100 cards)
- 1 handwritten Post-It on the front of the setup card with the manager's first name ("[Name] — pick the one that breaks the most. — Mike")

**Cost per pack:** ~$0.70 sticker sheet (vinyl bulk) + $0.30 setup card (home print on cardstock) + $0.15 business card + $0.05 Post-It = **$1.20 materials**. Plus postage.

### Step 4: Mail it

USPS first-class for a flat envelope under 1 oz costs $0.73 (one Forever stamp). Most 10-sticker packs land at 0.6-0.9 oz, so a single Forever stamp is enough if the envelope is non-rigid. If you go bubble-mailer, USPS Ground Advantage is $5.50 in the smallest box.

**Recommended:** White #10 windowless envelope + Forever stamp. Hand-addressed if possible (3× the open rate of typed labels). Return address `mike@factorylm.com / FactoryLM / [your address]`.

**All-in cost per pack delivered: $1.93.** First batch of 20 packs = $38.60. Even on tight cash, that's affordable enough to ship now.

### Step 5: Track scans

Once `m.ts` fires a scan event, route it through:
1. PostHog `cta_click` style event (already in your codebase)
2. Email alert to mike@factorylm.com ("Tech at [Plant Name] just scanned [Asset Tag], asked: '[query]'")
3. HubSpot deal stage advance from `lead` to `engaged`

Issue #SO-027 covers this.

---

## Sales pipeline tracker — path to first customer

Use HubSpot deal stages but with explicit gates so nothing sits ambiguously.

### Stage definitions

| Stage | Probability | Definition | Exit signal |
|---|---|---|---|
| **0 — Imported** | 1% | In CRM, never touched | Outbound touch sent |
| **1 — Touched** | 5% | First outbound sent (email, sticker, LinkedIn, manual-inbox auto-reply) | Reply OR scan event |
| **2 — Engaged** | 15% | They replied to outbound, scanned a sticker, used `manual@`, or downloaded a fault-code PDF | Asked a question or booked a call |
| **3 — Qualified** | 30% | You've confirmed: real plant, real maintenance role, real budget authority or path to one, real machine where MIRA could help in the next 90 days | Demo or pilot offer extended |
| **4 — Pilot Active** | 50% | They're using MIRA — at least 5 chat queries OR ≥1 manual ingested OR ≥1 sticker scanned by their tech | Used in week 2 (retention check) |
| **5 — Closed Won** | 100% | Paid Stripe charge succeeded | First MRR |
| **5b — Closed Lost** | 0% | Either explicit no or 30 days of pilot silence | Move to long-term nurture |

### Leading indicators (check Friday afternoons)

| KPI | Target by end of Phase 1 | Target by end of Phase 3 |
|---|---|---|
| New outbound touches sent (week) | 20 | 50 |
| Sticker packs in transit (week) | 5 | 10 |
| Magic-inbox uploads (week) | n/a | 10 |
| Fault-code PDF captures (week) | n/a | 20 |
| Replies received (week) | 3 | 10 |
| Scans logged (week) | 2 | 8 |
| Qualified pilots (cumulative) | 1 | 5 |
| Paid customers (cumulative) | 0 | 1-2 |

### Friday review ritual (30 min, weekly)

1. Open HubSpot deals view sorted by `hs_lastmodifieddate ASC` — anything not touched in 14 days, you do something to it (advance, kill, or re-engage).
2. Open the leading indicators table — pull from PostHog, HubSpot, and Stripe dashboards. Write actuals next to the targets.
3. Pick one number that moved less than expected. Spend 15 min understanding why.
4. Update `docs/sales-progress.md` (create on first review) — one line per week, three numbers: touches, replies, paid.

### Path to first customer — the realistic story

Best-case: Markus or Thomas converts in Phase 0 from the personal email + free sticker pack → paid $499 by May 17. Mike, this is your highest-probability dollar.

Base-case: One of the 20 Phase-1 plants scans, replies, qualifies → paid in Phase 2 around May 31.

Worst-case: Phase 1+2 yields a few engaged but no paid → first customer comes from `manual@` + Reddit organic traffic in early June.

If you don't have one paid customer by Jun 21 (end of Phase 3), stop ALL routines and run 5 customer-development calls with people who looked at MIRA and didn't sign up. That's a different problem (positioning or product) and adding more outbound won't fix it.

---

## How to use this plan

1. Print this page or pin it. The phased table is the map.
2. Check off `#SO-XXX` issues as PRs merge against `Mikecranesync/MIRA` (issue list lives at `docs/sales-github-issues-2026-04-26.md`).
3. Survey returns inform whether to ship Phase 1 on time, delay it, or pivot. See decision rules in `docs/customer-usability-survey-2026-04-26.md`.
4. Update `wiki/hot.md` at session end so future Cowork sessions can resume here.

---

## Things that MUST NOT slip through

- **The MX fix.** Apr 24 bounced. Until `mike@factorylm.com` delivers, all your outbound goes from a domain different from your product, and your reply rate is suppressed.
- **The cross-tenant test.** Run it before any public traffic touches `manual@`. If it fails once, you can't open the inbox.
- **The `/limitations` page.** A customer who gets surprised by what MIRA doesn't do churns angry. A customer who knew the limits up front churns calmly or stays.
- **The Friday review ritual.** Founder discipline beats every tool. A 30-min ritual with three numbers will catch problems that a dashboard misses.
