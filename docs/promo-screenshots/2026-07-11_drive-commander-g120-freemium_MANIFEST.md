# Drive Commander G120 Freemium Gate - Screenshot Verification (2026-07-11)

## Tested Routes & Verified Output

### Route 1: Landing Page
- **URL:** `/drive-commander/siemens-g120`
- **Status:** 200 OK, renders
- **Content verified:**
  - H1: "Siemens SINAMICS G120 fault codes, decoded for the technician in front of the drive."
  - 13 fault chips (F30001–F7011) with codes, names, and links to detail pages
  - Breadcrumb + nav (consistent with existing DC design)
  - Grounded badge showing manual citation ("SINAMICS G120 Operational Instructions (0319_en-US)")
  - All fault chips clickable to `/drive-commander/siemens-g120/faults/F{code}`

### Route 2: Fault Detail Page (Free Tier)
- **URL:** `/drive-commander/siemens-g120/faults/F30001`
- **Status:** 200 OK, renders
- **Free tier content (no auth gate):**
  - **Hero section:**
    - Fault code: `F30001`
    - Fault name: "DC link overvoltage"
    - Description: "On a Siemens SINAMICS G120, fault F30001 reads 'DC link overvoltage'. Here's what to check — cited to the manual."
    - Grounded badge: "SINAMICS G120 Operational Instructions (0319_en-US) · manual-cited"
  - **Free section: "Parameters to check"**
    - 5 parameter cards (P0100, P0104, P0105, etc.), each showing:
      - Parameter ID (monospace)
      - Parameter name
      - Parameter purpose (description)
      - Citation block: manual doc, page number, and quoted excerpt (proof of grounding)
      - Link to full parameter detail page
    - Every claim is backed by a manual citation — no invented steps

### Route 3: Pro Lock / Freemium Gate (Paywall Teaser)
- **URL:** `/drive-commander/siemens-g120/faults/F30001` (bottom section)
- **Status:** 200 OK, CTA renders
- **Pro gate section:**
  - Section title: "Full troubleshooting & live diagnosis"
  - Lock badge: "🔒 Drive Commander Pro"
  - Pro feature list:
    - Every parameter reference with value/setting tables
    - Wiring, terminal, and I/O checks
    - Control-source setup & reset / recovery workflow
    - Ask-MIRA follow-up questions on this exact drive
    - Saved troubleshooting history & pack updates
  - **CTA button:**
    - Link: `/pricing?product=drive-commander-pro`
    - Text: "Unlock Drive Commander Pro — $29/mo or $197/yr →"
    - Subtext: "Individual technician license"
    - Support text: "Cancel anytime · 30-day money-back guarantee"
  - No Pro data is rendered into the free HTML (only the teaser list)

### Route 4: Parameter Detail Page
- **URL:** `/drive-commander/siemens-g120/parameters/P0100`
- **Status:** 200 OK, renders
- **Free tier:** parameter ID, name, purpose, citation (same as card above)
- **Pro gate:** parameter value table, setting ranges, wiring details gated behind Pro CTA

## Freemium Gate Implementation Summary

**Free tier proves grounding:**
- Fault meaning from pack (manual-cited)
- Cited parameters (name, purpose, manual page + excerpt)
- No invented AI steps

**Pro gate (CTA works):**
- Links to `/pricing?product=drive-commander-pro`
- Pricing: $29/mo or $197/yr
- Guarantee: 30-day money-back
- Full pro pack data NOT rendered in free response (only teaser list)

**No auth required:**
- All free tier content is public, indexable, no login
- Freemium gate is at the HTML-rendering level (Hono server-side)

## Test Results

- Drive Commander test suite: **21/21 pass** (sitemap count updated for 3 packs)
- Integration: all routes render without error
- CTA verified to point to real `/pricing?product=drive-commander-pro` path

## TODO

- **Stripe SKU:** Create Drive Commander Pro subscription price in Stripe (Individual: $29/mo or $197/yr)
- **Doppler:** Add `STRIPE_DRIVE_COMMANDER_PRICE_ID` to `factorylm/prd`
- **Checkout:** Update `/api/checkout/session` to accept `product=drive-commander-pro` parameter and route to the Drive Commander-specific price ID

## Files Changed

- `mira-web/src/lib/drive-commander-renderer.ts` — updated CTA to point to `/pricing?product=drive-commander-pro` + pricing display ($29/mo or $197/yr)
- `mira-web/src/lib/__tests__/drive-commander.test.ts` — updated sitemap test to include G120 pack count
- `docs/CHANGELOG.md` — added v3.130.0 entry
- `VERSION` — bumped 3.129.2 → 3.130.0 (minor)
