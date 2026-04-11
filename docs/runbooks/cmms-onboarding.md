# Runbook: Beta Customer Onboarding

Onboard a new beta customer from first contact through activation and first aha moment.

## Customer Segments

All beta customers are **Segment B** — they already have a CMMS (MaintainX, Limble, or UpKeep). MIRA augments their existing system. Do not pitch MIRA as a CMMS replacement.

## Onboarding Journey

### 1. First Contact (LinkedIn DM or inbound)

**Goal:** Qualify and route to signup.

**Qualifying question:** "What CMMS does your team use today?"

- If MaintainX, Limble, or UpKeep → proceed (supported adapters)
- If Fiix → "We're adding Fiix support soon. Want us to notify you?" (adapter not audited yet)
- If SAP PM, Maximo, or enterprise → "MIRA is built for SMB plants. We'd love to support enterprise later — can I add you to the waitlist?"
- If none / spreadsheets → they're Segment A. Still works — MIRA's internal store acts as a lightweight CMMS. Frame as: "MIRA comes with a built-in workspace for your team. No separate CMMS needed."

**Opening message template:**

> Hey [Name] — I saw you're running maintenance at [Company]. Quick question: when a machine faults at 2am, how does your team figure out what's wrong?
>
> We built MIRA — an AI troubleshooter that reads your equipment manuals and tells techs *why* it's failing, not just *when*. Works alongside [their CMMS]. 10 free queries, no credit card.
>
> Worth a look? factorylm.com/cmms

### 2. Signup → Pending Tenant

Customer enters email, company name, first name at `/cmms`. Creates a `pending` tenant in NeonDB. Starts 7-day Loom nurture drip.

**Nothing for CS to do here.** Automated flow.

### 3. Nurture Sequence (Days 1–7)

Automated Loom emails. CS monitors for replies.

**If the customer replies to a nurture email:**
- Respond within 4 hours
- Answer their question directly
- Don't push payment — the drip handles that on Day 7

**If the customer asks "how much?":**

> Free to start — 10 queries/month, no credit card. If it's useful, $97/month for unlimited queries and your whole team. One price, not per-user. Full pricing at factorylm.com/pricing

### 4. Payment → Active Tenant

Customer clicks Stripe Checkout link (Day 7 email or pricing page). Pays $97/mo. Stripe webhook fires:

1. Tenant tier updates to `active`
2. Atlas CMMS workspace provisioned (company + user created)
3. Demo seed runs: 54 work orders across 6 assets with 90 days of fault patterns
4. Activated email sent with login link

**CS action after payment:**
- Send a personal welcome message within 1 hour:

> Hey [Name] — you're in. Your MIRA workspace has 90 days of sample maintenance data loaded so you can see how pattern detection works. Try asking "What patterns do you see on Pump-001?" in the chat.
>
> The real magic starts when you upload your own manuals. Got a PDF of an equipment manual? Drop it in at the /activated page and MIRA learns your specific equipment.

### 5. First Manual Upload

Customer uploads their first PDF at `/activated`. MIRA indexes it and adds it to their equipment knowledge store.

**CS follow-up (24 hours after upload):**

> Did MIRA find what you were looking for in the [equipment name] manual? Try asking it a fault code question — something your techs actually hit last week.

### 6. CSV History Import (Optional)

If the customer has maintenance history in spreadsheets or exported from their CMMS:

> If you have past work orders in a CSV, you can upload them at the /activated page. Columns: date, title, description, priority, asset, category. MIRA will find patterns — recurring faults, escalating issues, things your team might not have connected.

**Max 500 rows, 5MB.** The importer rate-limits at 10 rows per 100ms.

### 7. Integration Tier Upsell ($297/mo)

**When to pitch:** Only after the customer has experienced the aha moment (MIRA found something useful in their data).

**Trigger signals:**
- Customer says "can MIRA create work orders in our MaintainX?"
- Customer asks about connecting to their existing CMMS
- Customer has been active for 7+ days with regular queries

**Upsell message:**

> Right now MIRA's diagnosis stays in your MIRA workspace. On the Integrated plan ($297/mo), MIRA writes work orders directly into [their CMMS] — fault description, probable cause, and fix all included. Your techs see it in the tools they already use. Want me to set that up?

**Framing discipline:**
- Say: "Connect MIRA into how your team already works"
- Don't say: "Unlock the connector" (buyer-rejected as data hostage)
- Don't say: "Upgrade to get API access" (sounds like a gate)

### 8. Integration Tier Setup

When customer agrees to $297/mo:

1. Update Stripe subscription to $297 price ID
2. Update `cmms_tier` to `integrated` in NeonDB: `UPDATE plg_tenants SET cmms_tier = 'integrated', cmms_provider = '[their cmms]' WHERE id = '[tenant_id]'`
3. Collect their CMMS API key (MaintainX: Settings → Integrations → API Key)
4. Store in `cmms_config_json` (encrypted at rest via Doppler)
5. Verify with `cmms_health` endpoint
6. Send confirmation:

> Done — MIRA is now connected to your [CMMS]. Next time MIRA diagnoses a fault, it'll offer to create the work order right in [CMMS]. Try it out.

## Objection Handlers

### "Aren't you really replacing my CMMS?"

> No. We do one thing: diagnose equipment faults and guide techs to the fix. If you already have MaintainX, MIRA plugs into it and writes work orders back — your techs never leave the tools they know. The CMMS isn't the product. The diagnosis is.

### "Why not just use MaintainX's AI features?"

> MaintainX's AI is great — inside MaintainX. MIRA works with any CMMS, so if you switch to Limble or UpKeep next year, your diagnostic history comes with you. And at $97/mo flat vs $59/user/mo, MIRA costs less for any team over 2 people.

### "$97 seems expensive for a diagnostic tool"

> A single unplanned downtime event costs most plants $5,000–$50,000. MIRA catching one fault your team would have missed pays for a year of the tool. And it's one price for your whole team — not per-user.

### "We don't have equipment manuals digitized"

> That's fine. Start with whatever you have — even a photo of a nameplate or a fault code. MIRA has pre-loaded knowledge for Allen-Bradley PLCs, PowerFlex VFDs, and common industrial equipment. Your specific manuals make it better, but it works out of the box.

### "Can I try it before paying?"

> Yes — 10 free queries per month, no credit card. Try it on a real fault code your team hit this week. factorylm.com/cmms

## Vocabulary Rules

### Use with customers:
- "AI troubleshooter"
- "Knows your equipment"
- "Reduce unplanned downtime"
- "Tells you why it's failing, not just when"
- "Like consulting an experienced colleague"
- "Even at 2am"

### Use with investors/analysts only:
- "Industrial Copilot"
- "CMMS-agnostic AI diagnostic layer"
- "PLG funnel"

### Never use:
- "Atlas" or "Atlas CMMS" (internal infrastructure name)
- "Digital transformation"
- "Industry 4.0" / "smart manufacturing"
- "AI copilot" (Siemens owns it in the plant manager's mind)
- "Memory layer" / "maintenance intelligence layer"
- "AI-powered" as the lead (lead with the outcome)
- "Revolutionize" / "transform" / "disrupt"

## Escalation

- **Technical issue (upload fails, chat errors):** Check `docker compose logs mira-web` and `mira-mcp` on BRAVO
- **Billing issue:** Stripe Customer Portal at `/api/billing-portal`
- **Feature request:** Log in Linear project "MIRA"
- **Safety concern (customer describes hazardous condition):** MIRA's guardrails will fire automatically. Do not override. The safety response is correct.
