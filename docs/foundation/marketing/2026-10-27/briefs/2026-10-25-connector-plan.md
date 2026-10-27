# Connector plan: build and advertise (2026-10-25, internal only)
Builds on 2026-10-25-cmms-integration-feasibility.md. Repo snapshot: /workspace/mira-main-8ca0b52.
Positioning: MIRA stands alone. Connectors are an optional add-on. "Keep your CMMS." Never imply MIRA needs a CMMS to work.
Sizes are rough judgment, not measured. Live issue states were not rechecked today; use the feasibility brief's list.

## 1. Build order

### Phase 0: must fix before any connector is advertised or pointed at a customer
| Item | Reuse vs build | Size | Needs | How we prove it |
|---|---|---|---|---|
| #3237 cross-tenant Hub DB write in `_post_cmms_work_order` | Fix in place: scope every write by tenant_id from the auth context, never from the payload | S | Nothing external | A failing-then-passing test: tenant A's push can't touch tenant B's rows. Codex review. |
| #4434 public site claims "auto write" to CMMS | Edit mira-web copy | XS | Nothing | A grep of mira-web for "auto(matically)? (write\|sync\|push)" comes back empty. Staging screenshot. |
| #2184 / #2165: Channels page and docs show connectors that aren't real or call them "beta" | Hide them or relabel them to the honest status (see §2) | XS-S | Nothing | Staging screenshot. Every listed connector has a status label that matches §2. |

### Phase 1: works for every customer with no vendor dependency
| Item | Reuse vs build | Size | Needs | Proof |
|---|---|---|---|---|
| CSV asset import (their machine list → MIRA machines) | Reuse the pattern in `mira-web/src/lib/csv-import.ts` (the WO importer) and the column mapping from `assets/export.csv`. Build a Hub import route plus preview/confirm UI with dedupe on asset id or name (#3708: go through the KG bridge, not around it) | M (1-2 wk) | Nothing. Test with synthetic CSVs, including messy Maximo/SAP-style exports we generate ourselves | Import a 500-row synthetic file twice and get zero duplicates. Bad rows are reported, not dropped silently. Machines show up in the KG. |
| CSV + email job-note export | Reuse `work-orders/export.csv`. Fix #4731 ('closed' errors) and #4726 (WO not linked to project). Add an "email this job note" action with the answer, citation page, and asset id | S-M | An email sender that's already in use (mira-web mailer) | E2E on staging: close a WO, then export a CSV that includes the citation, and receive the email. |
| Generic outbound webhook ("send job notes anywhere") | Build a per-tenant webhook URL with a signed HMAC payload, retries, and delivery log. This is the universal escape hatch: customer IT can route it into any CMMS, Power Automate, or Zapier | M (1-2 wk) | Nothing. Test against a local receiver or webhook.site with synthetic data only | Signature verifies. Retry on 500 works. Log shows delivery status. Tenant isolation test as in #3237. |
| Connector health / last-sync status (#2033) | Small status field in the provider registry | S | Nothing | It shows up in the UI and drives the public status labels. |

### Phase 2: first real API connectors
| Item | Reuse vs build | Size | Needs | Proof |
|---|---|---|---|---|
| Finish MaintainX: push a job note as a WO or comment, and read assets | Reuse `nango-integrations/maintainx/` (create-work-order, get-asset, syncs) and `mira-hub/src/lib/cmms/` registry. Wire the push path (today only Atlas pushes). Pin the Nango image (#3057). | M (1-2 wk) | MaintainX trial/sandbox. The API reportedly needs the Business plan or above (recheck): ask for a dev/partner sandbox and don't assume it's free | Recorded demo on a trial tenant: MIRA answer → note in MaintainX with the citation. Asset pull dedupes. No prod writes. |
| Enterprise target: Maximo "comment on an existing WO" (worklog) plus read-only asset lookup | Build a new provider using the Maximo deep-link template already in the registry. REST `mxapiwo` / `mxapiasset`, API key | M-L (2-4 wk code; calendar depends on access) | A Maximo environment. Options: IBM trial / MAS developer (availability and cost unverified, check), an IBM partner program sandbox, or a design-partner customer's TEST system. Not free by default. | Worklog shows up on a test WO in the sandbox. Read-only asset match works. Written sign-off before any prod. |

### Later (only on customer demand)
- Limble (#828; API needs Premium+), UpKeep (#827; Enterprise only), Fiix (Enterprise only): each is S-M on the Nango pattern once a trial with API access exists.
- SAP PM (OData notification/order; Basis team needed) and HxGN/Oracle/eMaint: build only with a paying design partner who provides a test system. 4-8+ weeks each.
- Two-way sync (#324/#800): last or never. It conflicts with "not a CMMS" and creates system-of-record confusion. Revisit only if multiple paying customers ask.

Standing rules for every phase: test only on vendor trial/sandbox or customer TEST tenants. No prod writes without written sign-off. Least-privilege keys stored per tenant in Nango/vault. No customer data to free or training LLM endpoints.

## 2. Advertising plan

### Naming tension (flag for Mike)
The standing rule is no competitor names in organic copy. A connector page has to name systems to be useful. That's nominative integration naming ("works with X"), not comparison, but the rule still applies in spirit. Proposal:
1. Name a system only once its connector is **Working** (proven on a real tenant). Before that, use generic wording ("enterprise EAM", "cloud CMMS").
2. Use plain-text names only: "Works with X". No vendor logos, no "partner", "certified", or "integrated with" unless we're actually in their partner program.
3. Before naming each vendor, check its trademark/partner/API terms (some API terms restrict marketing use). Add the standard trademark footnote.
4. Never name vendors in posts, ads, or comparisons. Names appear on the connector page and docs only.
Mike should explicitly OK this exception before any vendor is named.

### Connectors page outline (status-labeled)
- Header: "MIRA works on its own. Connectors are optional."
- Sub: "Keep your CMMS. MIRA answers from your manuals, and if you want, sends a job note to the system you already use."
- **Working** (shipped and proven on staging): CSV machine import · CSV job-note export · Email job note · Webhook (after Phase 1 proof only)
- **In testing** (built, being verified on trial accounts, no dates promised): e.g. "Cloud CMMS: job note push" and later named once proven
- **On request** (we'll build it with you on your test system): "Enterprise EAM (job note as a comment on an existing work order)", "Other CMMS: tell us yours"
- Each card: what it does in one line, direction (one-way), what your IT needs to provide, and a status label with its last-verified date.
- Footer: "We never write to your live system during setup. We test on your test system first." Trademark note.

### Draft copy (passes the can-say test)
- "MIRA works on its own. No CMMS required."
- "Keep your CMMS. MIRA doesn't replace it."
- "Bring your machine list in from a spreadsheet in minutes." (only after the import ships and is timed)
- "Export every job note, with the manual page cited, as a spreadsheet or email."
- "Send job notes to any system with a webhook." (Phase 1 proven)
- "Want a job note on a work order in your system? We'll connect it with your IT team, on your test system first."
- "One-way by design: MIRA adds a note, and your CMMS stays your system of record."
- Status line: "Working" / "In testing" / "On request: built with you".

### Must NOT say until proven
- "Automatically writes/syncs to your CMMS" (#4434), "two-way sync", "real-time sync"
- "Integrates with [vendor]", "certified", "partner", or vendor logos
- Any timeline ("live in a day") or "plug-and-play" for enterprise
- "Connectors for 10+ systems" or any count beyond what's Working
- "MIRA needs / works better with your CMMS", or anything implying MIRA depends on one
- Prices (none in prelaunch copy)

### Build-in-public angle
One honest post per connector milestone: "Shipped: export job notes with the cited manual page." "Shipped: import your machine list from a spreadsheet." Each post covers what it does, what it doesn't do yet, and a 20-second clip on staging. No vendor names in posts. The connector page moves an item to Working only after the post's proof exists. Content Studio drafts; posts are held for Mike.

## 3. Foreman paste text (phase 0+1)
See the block in the summary. It's repeated here:

```
Foreman: connector build, Phase 0 + 1. Plan: /workspace/briefs/2026-10-25-connector-plan.md
Positioning: MIRA stands alone; connectors are optional add-ons. No copy implying MIRA needs a CMMS.
Phase 0 (do first, separate small PRs):
 1. #3237: scope _post_cmms_work_order writes by authenticated tenant; add a cross-tenant regression test.
 2. #4434: remove every "auto write/sync to CMMS" claim from mira-web; relabel or hide non-working connectors (#2184/#2165).
Phase 1:
 3. CSV asset import in Hub (preview → confirm, dedupe via KG bridge per #3708; reuse mira-web csv-import.ts pattern).
 4. Job-note export: fix #4731 and #4726, include citation+asset in work-orders/export.csv, add "email job note".
 5. Generic outbound webhook: per-tenant URL, HMAC-signed, retries, delivery log, tenant-isolated.
 6. Connector health/last-verified status (#2033).
Rules: synthetic data only; no prod writes; no vendor accounts; no customer data to free LLMs; no marketing copy changes beyond #4434 removals.
Process: one PR per item; proof on staging (test + screenshot) in each PR; cheap Gate-7 review first, then Codex review; only Mike merges. Report each PR link and proof when ready.
```
