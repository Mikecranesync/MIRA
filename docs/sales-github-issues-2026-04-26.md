# MIRA Sales — GitHub Issues + PR Plan

**Generated:** 2026-04-26
**Companion to:** `docs/sales-audit-2026-04-26.md`, `docs/sales-implementation-plan-2026-04-26.md`
**Repo:** `Mikecranesync/MIRA`
**Project board:** https://github.com/Mikecranesync/MIRA → project 4

This file does two things:
1. Lists each issue with title, body, labels, milestone — paste-ready for `gh issue create`.
2. Provides a single shell script (`scripts/create_sales_issues.sh`) Mike can run on a node with `gh auth` to create them all at once.

**Recommended labels** (create them once if missing): `sales`, `inbound-machine`, `phase-0`, `phase-1`, `phase-2`, `phase-3`, `phase-4`, `growth-infra`, `marketing-content`, `customer-dev`.

**Recommended milestones** (one per phase): `Phase 0 — Foundation (May 03)`, `Phase 1 — Sticker Drop (May 17)`, `Phase 2 — Manual-by-Email (May 31)`, `Phase 3 — Fault Code Trojan Horse (Jun 21)`, `Phase 4 — Cold Outbound (ongoing)`.

---

## Phase 0 — Foundation

### #SO-001 — Personal email: revive Markus Dillman (GMF Steel) $499 pilot

**Type:** customer-dev (no PR)
**Effort:** 15 min
**Owner:** M

Deal `MIRA Pilot — GMF Steel Group` (HubSpot id 322536442607) created Apr 24, parked at 10% probability, no associated activity. Send a personal email today: 1 paragraph, name a likely machine class on a steel plant floor (rolling mill drive, induction furnace VFD, scale break shear), offer a free 10-pack of MIRA stickers as a thank-you for trying it. CC: nothing. From: mike@factorylm.com (after MX fix in #SO-003).

**Acceptance:** Email sent, HubSpot note logged on the contact, deal stage advanced to "engaged" *if* he replies.

---

### #SO-002 — Personal email: revive Thomas Hampton (Tampa Bay Steel) $499 pilot

**Type:** customer-dev (no PR)
**Effort:** 15 min
**Owner:** M

Same as #SO-001 for deal `MIRA Pilot — Tampa Bay Steel` (HubSpot id 322496118519). Mention you'll add the first manual ingest free as a setup gift.

**Acceptance:** Same as #SO-001.

---

### #SO-003 — Fix `mike@factorylm.com` MX so outbound delivers

**Type:** infra
**Effort:** 1 hour
**Owner:** M

Apr 24 test from mike@cranesync.com to mike@factorylm.com bounced with `550 5.1.1 The email account that you tried to reach does not exist`. Outbound from any factorylm.com address probably fails today. Fix MX records (Google Workspace or Resend inbound) so mike@factorylm.com is a real mailbox.

**Acceptance:** Test email mike@cranesync.com → mike@factorylm.com delivers. Reply round-trip works. Update DNS docs in `docs/runbooks/` if you have a runbook folder.

---

### #SO-004 — Stranger signup smoke test

**Type:** test
**Effort:** 1 hour
**Owner:** M

Validate Readiness Gate #1 from `docs/sales-implementation-plan-2026-04-26.md`. Use a throwaway gmail not on any allowlist. Sign up via factorylm.com → register → Stripe test mode → Atlas provisioning → activation email → first chat. Time the whole flow. If anything fails or takes >10 min, file a P0.

**Acceptance:** Stranger flow completes end-to-end in <10 min with zero manual intervention. Screenshot of `/api/me` showing tier=active. Document any friction in `docs/known-issues.md`.

---

### #SO-005 — Add `/limitations` page (what MIRA doesn't do yet)

**Type:** marketing-content
**Effort:** 2 hours
**Owner:** M (copy) + C (route)

Add a route at `/limitations` that lists honestly what MIRA doesn't do. Examples: "no PLC tag streaming yet (post-MVP, Config 4)", "no native CMMS integrations beyond our Atlas — no Maximo / SAP PM / Fiix yet", "safety-critical Qs (LOTO, arc flash, confined space) escalate to a human, MIRA does not advise on them". Link from homepage footer + `/trust`.

**Acceptance:** Page deployed at factorylm.com/limitations. Reviewed by Mike. Linked in footer.

**Files to touch:** `mira-web/src/server.ts`, `mira-web/public/limitations.html` (new).

---

### #SO-006 — Send Customer Usability Survey to 5 friendlies

**Type:** customer-dev (no PR)
**Effort:** 2 hours (send + collect)
**Owner:** M

Per `docs/customer-usability-survey-2026-04-26.md` Segment A. Pick 5 from your network. Send by May 01. Read replies as they come in.

**Acceptance:** ≥3 surveys returned by May 03. Synthesis written in `docs/usability-survey-results-2026-05.md`. Decision rules from the survey doc applied.

---

### #SO-007 — Connect Apollo MCP to Cowork

**Type:** infra
**Effort:** 5 min
**Owner:** M

Apollo skills are present in Cowork but no Apollo MCP server is registered. Connect via Cowork connector picker.

**Acceptance:** `apollo:prospect` skill returns real results when invoked.

---

### #SO-010 — One-way sync: `/api/register` → HubSpot contact + company

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

Today `/api/register` writes to NeonDB `plg_tenants` only. Extend to also create/update a HubSpot contact (by email) and company (by domain), associate them, set lifecyclestage=lead, hs_lead_status=NEW, source=plg-signup.

**Acceptance:**
- Branch: `feat/hubspot-sync-register`
- New module `mira-web/src/lib/hubspot.ts` with typed clients for contact + company create/update + association
- `POST /api/register` calls hubspot client async (fire-and-forget; signup must not block on HubSpot)
- Failure mode: log + audit event, retry on a separate worker
- Integration test against HubSpot test sandbox

**Files to touch:** `mira-web/src/server.ts`, `mira-web/src/lib/hubspot.ts` (new), `mira-web/package.json`.

---

### #SO-011 — Stripe webhook → HubSpot deal advance

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

When `checkout.session.completed` fires, advance the contact's primary deal to a "paid" stage in HubSpot OR create the deal if missing. When `customer.subscription.deleted` fires, move deal to `closed-lost`.

**Acceptance:**
- Branch: `feat/hubspot-sync-stripe`
- Reuses `lib/hubspot.ts` from #SO-010
- Maps `tenant_id → hubspot_contact_id` via a new column in `plg_tenants` (migration)
- Test fixtures for both events

**Depends on:** #SO-010

---

### #SO-012 — Backfill HubSpot company-contact associations by domain

**Type:** chore (one-shot script)
**Effort:** 4 hours
**Owner:** C

All 87 companies show `num_associated_contacts: 0`. Match contact email domains to company domains and create associations. Idempotent.

**Acceptance:**
- Script `tools/hubspot-backfill-associations.ts`
- Dry-run mode default; `--apply` to write
- Logs every association created
- Re-runnable safely

---

## Phase 1 — Sticker Drop

### #SO-020 — Source vinyl QR stickers (250-pack)

**Type:** ops (no PR)
**Effort:** 30 min order, 5-7 days delivery
**Owner:** M

Order options per `docs/sales-implementation-plan-2026-04-26.md` Sticker SOP. Recommendation: 100 Avery 22806 sheets for immediate use AND a 250-pack Sticker Mule die-cut vinyl (UV laminated, 2"x2"). Total ~$115 outlay.

**Acceptance:** Order placed. Tracking number logged. Avery sheets in hand within 48h.

---

### #SO-021 — `/m/:asset_tag` — handle unclaimed assets (anonymous scan)

**Type:** feat (PR)
**Effort:** ~2 days
**Owner:** C

Today the route assumes a known tenant. For cold sticker mailings, support unclaimed asset_tags: first scan prompts for email + plant name → claims a placeholder tenant to a real account → continues to chat.

**Acceptance:**
- Branch: `feat/qr-unclaimed-assets`
- New `unclaimed_asset_pool` table (migration)
- `/m/:asset_tag` detects unclaimed → renders claim form
- `POST /api/m/claim` validates email, creates pending tenant, sends activation email, redirects to `/m/:asset_tag/choose`
- Anti-abuse: rate-limit by IP + sender domain, captcha optional
- Tests for claimed, unclaimed, and abuse paths

**Files to touch:** `mira-web/src/routes/m.ts`, `mira-web/src/lib/connect.ts`, new migration in `mira-web/migrations/`.

---

### #SO-022 — Pre-generate 20 sticker packs against placeholder tenant pool

**Type:** chore (script)
**Effort:** 4 hours
**Owner:** C

Script that creates 20 placeholder pilot tenants in NeonDB, generates 10 unique asset_tags per tenant, calls `POST /api/admin/qr-print-batch`, saves PDFs to `tools/sticker-fulfillment/batches/`.

**Acceptance:**
- Script `tools/sticker-fulfillment/seed-and-print-batch.ts`
- Outputs: 20 PDFs ready to send to Sticker Mule OR home-print onto Avery 22806
- Each tenant tagged with `meta.batch_id` for tracking

**Depends on:** #SO-021 (unclaimed asset flow)

---

### #SO-023 — Mailing kit assets (setup card, business card, Post-It template)

**Type:** marketing-content
**Effort:** 4 hours
**Owner:** M (copy + design) + C (template)

5"x7" double-sided setup card. Front: plant photo with QR placement. Back: 4-step setup ("Pick your worst machine. Stick a sticker on it. Tell your tech to scan it next time it breaks. Reply to this email when they do."). Vistaprint business card design ($15 for 100). Post-It handwriting template with manager's first name.

**Acceptance:**
- Print-ready PDF in `marketing/sticker-pack/setup-card.pdf`
- Vistaprint order placed
- 50 Post-Its with handwritten template ready

---

### #SO-024 — Identify first 20 plants + manager names + addresses

**Type:** customer-dev (no PR)
**Effort:** 1 day
**Owner:** M

From the 87 HubSpot companies: pick the 20 best-fit. Call each plant's front desk to get the maintenance manager's name + shipping address. Update HubSpot.

**Acceptance:** 20 contacts in HubSpot with `mailing_address` and `manager_name` set. List exported to `marketing/sticker-pack/batch-001-targets.csv`.

---

### #SO-025 — Send introductory email to the 20

**Type:** customer-dev (no PR)
**Effort:** 2 hours
**Owner:** M

"Free 10-pack of stickers, no card. Reply with your shipping address." From mike@factorylm.com.

**Acceptance:** 20 emails sent. Opens + replies tracked in HubSpot.

**Depends on:** #SO-003, #SO-024

---

### #SO-026 — Mail packs as addresses come in (rolling fulfillment)

**Type:** ops (no PR)
**Effort:** 30 min per pack
**Owner:** M

Each address-confirm reply triggers Mike to assemble + mail a pack within 24 hours. Log shipment in HubSpot deal note + Phase 1 dashboard.

**Acceptance:** 100% of address-confirms ship within 24 hours. Deal stage advanced to "engaged" on ship.

---

### #SO-027 — Wire QR scan event → email alert + HubSpot deal advance

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

When a sticker is scanned for the first time, fire (a) email to mike@factorylm.com with plant name + asset_tag + first query, (b) HubSpot deal stage advance from "touched" → "engaged".

**Acceptance:**
- Branch: `feat/qr-scan-alerts`
- Reuses `qr-tracker.ts` event hooks
- New worker `mira-web/src/workers/scan-alerts.ts`
- Test fixture for first-scan vs subsequent-scan
- Audit event logged

**Depends on:** #SO-010 (HubSpot client)

---

## Phase 2 — Manual-by-Email

### #SO-030 — Anonymous-tenant chat with one-time token

**Type:** feat (PR)
**Effort:** ~2 days
**Owner:** C

Public `manual@factorylm.com` ingests need a chat path that doesn't require signup. Issue a one-time JWT bound to the manual's KB collection, expires in 7 days, max N queries.

**Acceptance:**
- Branch: `feat/anonymous-chat`
- New JWT type with `tenant=anonymous` and `kb_collection_id`
- `/api/mira/chat` accepts anonymous JWT (separate middleware from `requireActive`)
- Quota: 20 queries / 7 days / token
- Conversion path: any time the user can claim the token → real tenant (rolls KB into their account)

---

### #SO-031 — Public inbox handler at `manual@factorylm.com`

**Type:** feat (PR)
**Effort:** ~2 days
**Owner:** C

Postmark inbound webhook → ingest PDF → return chat link. Rate-limit per sender domain (10/day), malware scan via ClamAV or Postmark's built-in, 50MB cap, password-protected PDF reject.

**Acceptance:**
- Branch: `feat/public-manual-inbox`
- New route `POST /api/v1/inbox/manual-public` (HMAC-signed)
- Reuses anonymous-chat token from #SO-030
- Rate-limit table in NeonDB
- Tests for: happy path, oversized, password-protected, malware, rate-limit hit

**Depends on:** #SO-030

---

### #SO-032 — Auto-reply email with chat link + 60s Loom

**Type:** marketing-content
**Effort:** 4 hours
**Owner:** M (Loom) + C (template)

Loom: Mike forwarding a manual to manual@factorylm.com, getting the link back, asking a question. Email template with the link + Loom embed.

**Acceptance:** Loom recorded + edited (≤90s). Email template `emails/public-manual-receipt.html` with `{{CHAT_URL}}` and `{{LOOM_URL}}` placeholders.

---

### #SO-033 — 5-touch follow-up drip for `manual@` users

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

Extends `lib/drip.ts` to support a new audience type. Sequence: T+0 receipt, T+1h "did you try the chat?", T+1d "what manual were you looking at?", T+3d "want MIRA in your CMMS?", T+7d "your link expires tomorrow".

**Acceptance:**
- Branch: `feat/manual-inbox-drip`
- New `DRIP_SCHEDULE` audience tag `public_manual`
- Schedule entries for the 5 touches
- Conditions: stop drip if they convert OR if token expires

---

### #SO-034 — Reddit + LinkedIn + FB group launch posts

**Type:** marketing-content
**Effort:** 2 hours per post + monitoring
**Owner:** M

One post each on r/PLC, r/Maintenance, r/Manufacturing, r/MaintenanceandReliability, plus LinkedIn and 3 industrial trade FB groups. Frame as "free utility, no signup, forward me your worst manual." Show, don't tell.

**Acceptance:** 7 posts shipped. Replies + DMs tracked in a HubSpot list. NSFW: don't be salesy. Each post is 100 words max with a screenshot of MIRA actually answering a real manual question.

---

### #SO-035 — Drop-in HubSpot list for `manual@` engagement

**Type:** chore
**Effort:** 1 hour
**Owner:** M

Create a HubSpot dynamic list `Manual Inbox Engaged` filtering contacts with property `last_manual_inbox_event` set in last 30 days. Use this list for #SO-034 follow-ups.

---

## Phase 3 — Fault Code Trojan Horse

### #SO-040 — Email-gated PDF capture on every fault-code page

**Type:** feat (PR)
**Effort:** ~2 days
**Owner:** C

Above-the-fold form on `/blog/:slug` (when slug is a fault code): "Get the printable troubleshooting card for [code] (PDF)". Single field (email). Submit triggers PDF generation + email send + HubSpot contact create.

**Acceptance:**
- Branch: `feat/fault-code-pdf-capture`
- Form added to `lib/blog-renderer.ts` for fault-code slugs
- `POST /api/fault-code/request-pdf` endpoint
- HubSpot contact created with source=fault-code-pdf
- Test for the capture flow

**Depends on:** #SO-010 (HubSpot client)

---

### #SO-041 — Printable PDF generator for fault-code cards

**Type:** feat (PR)
**Effort:** ~2 days
**Owner:** C

Reuse `qr-pdf.ts` patterns. 1-page double-sided PDF: front shows fault code, common causes, reset procedure; back shows escalation tree + factorylm.com QR. Branded.

**Acceptance:**
- Branch: `feat/fault-code-pdf-gen`
- Module `lib/fault-code-pdf.ts` with `renderFaultCodeCard(code: FaultCode): Promise<Buffer>`
- Visual review on 5 fault codes
- Tests

---

### #SO-042 — 7-touch nurture for fault-code captures

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

Extends `lib/drip.ts` with audience `fault_code_capture`. 7 touches over 30 days ending in a free pilot offer.

**Acceptance:**
- Branch: `feat/fault-code-drip`
- 7 email templates in `emails/fault-code-*.html`
- Audience filter in `processDripEmails`

---

### #SO-043 — Nightly Claude content factory for fault codes

**Type:** feat (PR)
**Effort:** ~3-4 days
**Owner:** C

Cron job pulls top 20 underperforming searches from PostHog (high impressions, low CTR or no result), drafts new fault-code pages from the existing OEM KB, files PRs against `mira-web/src/data/fault-codes.ts`. Mike reviews + merges.

**Acceptance:**
- Branch: `feat/fault-code-content-factory`
- Cron in `tools/fault-code-factory/run.ts`
- Uses Anthropic Claude API to draft (already in your allowed cloud list per CLAUDE.md §3)
- PRs are auto-labeled `content`, `auto-generated`, require human approval
- Daily run logs to `wiki/content-factory.md`

---

### #SO-044 — Backlinks: submit fault-code library to industrial communities

**Type:** marketing-content
**Effort:** 4 hours
**Owner:** M

Submit factorylm.com/blog/fault-codes to: r/PLC sidebar, IndustryWeek tools list, AutomationDirect community, 5 OEM forums (Allen-Bradley, Siemens TIA Portal, Rockwell community, Yaskawa user group, AutomationDirect forum).

**Acceptance:** 8 submissions made. Track which generate referrer traffic in PostHog.

---

## Phase 4 — Cold Outbound (Apollo)

### #SO-050 — Apollo ICP filter + saved search

**Type:** ops (no PR)
**Effort:** 2 hours
**Owner:** M (config) + C (script if needed)

Roles: Maintenance Manager / Reliability Engineer / Plant Manager / Operations Manager / Maintenance Supervisor. Industries: Machinery, Food Production, Chemicals, Plastics, Metals. Locations: FL + GA + AL + SC + NC. Company size: 50-500. Has phone: true.

**Acceptance:** Saved Apollo search returns ≥500 results. Refresh weekly.

**Depends on:** #SO-007

---

### #SO-051 — Apollo sequence: 5-touch (LinkedIn + email)

**Type:** ops (no PR)
**Effort:** 4 hours
**Owner:** M

Build the sequence in Apollo:
- T+0: LinkedIn connect with personalized note
- On accept: LinkedIn DM with fault-code library link
- T+3d: Email with 60s Loom of MIRA on a fault common to their equipment
- T+7d: Email "want me to mail you 10 free stickers?" (loops to Sticker Drop)
- T+14d: Email "last note from me — public sandbox at factorylm.com/m/demo"

**Acceptance:** Sequence saved in Apollo. Reply rate target: ≥5%. Cap at 10 leads/day.

---

### #SO-052 — Bridge from Apollo touch 4 → Sticker Drop fulfillment

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

When an Apollo lead replies to touch 4 with a shipping address, auto-create a HubSpot deal in the Phase 1 sticker fulfillment pipeline.

**Acceptance:**
- Branch: `feat/apollo-sticker-bridge`
- Webhook from Apollo (or manual import script) → HubSpot deal create
- Deal source: `apollo-sticker-bridge`

**Depends on:** #SO-010, #SO-027

---

## Cross-cutting

### #SO-060 — Sales pipeline tracker auto-populate

**Type:** feat (PR)
**Effort:** ~1 day
**Owner:** C

Weekly cron generates `docs/sales-progress.md` from HubSpot + PostHog + Stripe data. One row per week with the leading indicators from `docs/sales-implementation-plan-2026-04-26.md`.

**Acceptance:**
- Branch: `feat/sales-progress-cron`
- Cron in `tools/sales-progress/run.ts`
- Idempotent (re-run replaces last week's row)
- Posts a Slack DM to Mike on Friday morning with the table

---

### #SO-061 — `/limitations` link in every transactional email footer

**Type:** chore
**Effort:** 1 hour
**Owner:** C

Add factorylm.com/limitations link to footer of all `emails/*.html` templates. Sets honest expectations.

**Depends on:** #SO-005

---

### #SO-062 — Update `wiki/hot.md` weekly with sales status

**Type:** docs
**Effort:** 5 min/week
**Owner:** M

End each Friday review by appending a "Sales — week of YYYY-MM-DD" entry to `wiki/hot.md` with the three numbers: touches, replies, paid.

---

## Bash script — create them all

Save as `scripts/create_sales_issues.sh`. Run from a node with `gh auth status` working (Bravo or Charlie).

```bash
#!/usr/bin/env bash
# Create the sales issues from docs/sales-github-issues-2026-04-26.md
# Run this once. Idempotent only by virtue of you noticing duplicates.
#
# Prereqs:
#   gh auth login
#   gh label create sales --color "00C853" || true
#   gh label create inbound-machine --color "1E88E5" || true
#   for p in 0 1 2 3 4; do gh label create phase-$p --color "FF6F00" || true; done
#   gh label create growth-infra --color "8E24AA" || true
#   gh label create marketing-content --color "00897B" || true
#   gh label create customer-dev --color "D81B60" || true
#
# Milestones (create once):
#   gh api repos/Mikecranesync/MIRA/milestones -f title="Phase 0 — Foundation" -f due_on="2026-05-03T23:59:59Z"
#   gh api repos/Mikecranesync/MIRA/milestones -f title="Phase 1 — Sticker Drop" -f due_on="2026-05-17T23:59:59Z"
#   gh api repos/Mikecranesync/MIRA/milestones -f title="Phase 2 — Manual-by-Email" -f due_on="2026-05-31T23:59:59Z"
#   gh api repos/Mikecranesync/MIRA/milestones -f title="Phase 3 — Fault Code Trojan Horse" -f due_on="2026-06-21T23:59:59Z"

set -euo pipefail

REPO="Mikecranesync/MIRA"
DOC="docs/sales-github-issues-2026-04-26.md"

create_issue() {
  local code="$1"; local title="$2"; local labels="$3"; local milestone="$4"
  local body="$(awk -v code="### #$code" '
    $0 ~ code {found=1; next}
    found && /^### #SO-/ {exit}
    found {print}
  ' "$DOC")"
  body+=$'\n\n---\n\nIssue ref: #'"$code"$'  | Source: docs/sales-github-issues-2026-04-26.md'
  echo ">>> Creating $code: $title"
  gh issue create \
    --repo "$REPO" \
    --title "[$code] $title" \
    --body "$body" \
    --label "$labels" \
    --milestone "$milestone" || echo "    (skipped, may already exist)"
}

# Phase 0
create_issue SO-001 "Personal email: revive Markus Dillman (GMF Steel) \$499 pilot" "sales,phase-0,customer-dev" "Phase 0 — Foundation"
create_issue SO-002 "Personal email: revive Thomas Hampton (Tampa Bay Steel) \$499 pilot" "sales,phase-0,customer-dev" "Phase 0 — Foundation"
create_issue SO-003 "Fix mike@factorylm.com MX so outbound delivers" "sales,phase-0,growth-infra" "Phase 0 — Foundation"
create_issue SO-004 "Stranger signup smoke test" "sales,phase-0,customer-dev" "Phase 0 — Foundation"
create_issue SO-005 "Add /limitations page (what MIRA doesn't do yet)" "sales,phase-0,marketing-content" "Phase 0 — Foundation"
create_issue SO-006 "Send Customer Usability Survey to 5 friendlies" "sales,phase-0,customer-dev" "Phase 0 — Foundation"
create_issue SO-007 "Connect Apollo MCP to Cowork" "sales,phase-0,growth-infra" "Phase 0 — Foundation"
create_issue SO-010 "Sync /api/register → HubSpot contact + company" "sales,phase-0,inbound-machine,growth-infra" "Phase 0 — Foundation"
create_issue SO-011 "Stripe webhook → HubSpot deal advance" "sales,phase-0,inbound-machine,growth-infra" "Phase 0 — Foundation"
create_issue SO-012 "Backfill HubSpot company-contact associations" "sales,phase-0,growth-infra" "Phase 0 — Foundation"

# Phase 1
create_issue SO-020 "Source vinyl QR stickers (250-pack)" "sales,phase-1" "Phase 1 — Sticker Drop"
create_issue SO-021 "/m/:asset_tag handle unclaimed assets (anonymous scan)" "sales,phase-1,inbound-machine" "Phase 1 — Sticker Drop"
create_issue SO-022 "Pre-generate 20 sticker packs against placeholder tenant pool" "sales,phase-1,inbound-machine" "Phase 1 — Sticker Drop"
create_issue SO-023 "Mailing kit assets (setup card, business card, Post-It)" "sales,phase-1,marketing-content" "Phase 1 — Sticker Drop"
create_issue SO-024 "Identify first 20 plants + manager names + addresses" "sales,phase-1,customer-dev" "Phase 1 — Sticker Drop"
create_issue SO-025 "Send introductory email to the 20" "sales,phase-1,customer-dev" "Phase 1 — Sticker Drop"
create_issue SO-026 "Mail packs as addresses come in (rolling)" "sales,phase-1" "Phase 1 — Sticker Drop"
create_issue SO-027 "Wire QR scan event → email alert + HubSpot deal advance" "sales,phase-1,inbound-machine" "Phase 1 — Sticker Drop"

# Phase 2
create_issue SO-030 "Anonymous-tenant chat with one-time token" "sales,phase-2,inbound-machine" "Phase 2 — Manual-by-Email"
create_issue SO-031 "Public inbox handler at manual@factorylm.com" "sales,phase-2,inbound-machine" "Phase 2 — Manual-by-Email"
create_issue SO-032 "Auto-reply email with chat link + 60s Loom" "sales,phase-2,marketing-content" "Phase 2 — Manual-by-Email"
create_issue SO-033 "5-touch follow-up drip for manual@ users" "sales,phase-2,inbound-machine" "Phase 2 — Manual-by-Email"
create_issue SO-034 "Reddit + LinkedIn + FB group launch posts" "sales,phase-2,marketing-content" "Phase 2 — Manual-by-Email"
create_issue SO-035 "HubSpot list for manual@ engagement" "sales,phase-2" "Phase 2 — Manual-by-Email"

# Phase 3
create_issue SO-040 "Email-gated PDF capture on fault-code pages" "sales,phase-3,inbound-machine" "Phase 3 — Fault Code Trojan Horse"
create_issue SO-041 "Printable PDF generator for fault-code cards" "sales,phase-3,inbound-machine" "Phase 3 — Fault Code Trojan Horse"
create_issue SO-042 "7-touch nurture for fault-code captures" "sales,phase-3,inbound-machine" "Phase 3 — Fault Code Trojan Horse"
create_issue SO-043 "Nightly Claude content factory for fault codes" "sales,phase-3,inbound-machine" "Phase 3 — Fault Code Trojan Horse"
create_issue SO-044 "Backlinks: submit fault-code library to industrial communities" "sales,phase-3,marketing-content" "Phase 3 — Fault Code Trojan Horse"

# Phase 4
create_issue SO-050 "Apollo ICP filter + saved search" "sales,phase-4" ""
create_issue SO-051 "Apollo sequence: 5-touch" "sales,phase-4" ""
create_issue SO-052 "Apollo touch 4 → Sticker Drop bridge" "sales,phase-4,inbound-machine" ""

# Cross-cutting
create_issue SO-060 "Sales pipeline tracker auto-populate" "sales,growth-infra" ""
create_issue SO-061 "/limitations link in transactional email footers" "sales,marketing-content" ""
create_issue SO-062 "Update wiki/hot.md weekly with sales status" "sales" ""

echo ""
echo "Done. Verify at: https://github.com/Mikecranesync/MIRA/issues?q=is%3Aopen+label%3Asales"
```

Save the script, `chmod +x scripts/create_sales_issues.sh`, then run. Re-run is mostly idempotent — `gh issue create` will create duplicates if not careful, so check the issue list first.

---

## Quick reference — what to do this week

**Today (Apr 26):**
- #SO-001 send Markus
- #SO-002 send Thomas
- #SO-003 fix MX

**Tomorrow (Apr 27-28):**
- #SO-004 smoke test
- #SO-005 limitations page
- #SO-007 connect Apollo

**By May 03:**
- #SO-006 surveys sent + replies in
- #SO-010, #SO-011, #SO-012 HubSpot sync live

**Then green-light Phase 1.**
