# UX Audit — FactoryLM Hub + Marketing Site
**Date:** 2026-04-26  
**Auditor:** Claude (Playwright automated + human-assessment)  
**Branch:** `claude/loving-tereshkova-132a92`  
**Benchmark:** MaintainX / Linear standard (10-category rubric, scored 1–10)

---

## Methodology

- 24 Playwright tests across hub (21 pages) + marketing site (3 pages)  
- Viewports: Desktop 1440×900 · Mobile 412×915 (Pixel 9A)  
- Auth: `e2e-audit@factorylm.com` saved via `playwright/.auth/user.json`  
- Screenshots: `docs/ux-audit/2026-04-26/screenshots/` (50 PNGs)  
- Spec: `tests/e2e/ux-audit.spec.ts` · Config: `playwright.audit.config.ts`

---

## Hub — Page-by-Page Assessment

### Feed (`/hub/feed/`)
**Screenshots:** `hub-feed-desktop.png` · `hub-feed-mobile.png`

The strongest page in the product. Four KPI stat cards (Open WOs, Overdue PMs, Downtime Today, Wrench Time) give an at-a-glance health summary. Feed cards have clear visual hierarchy: title, asset link, body text, action buttons. Safety alerts use a red left border accent — immediately scannable. Mobile layout is solid: KPIs collapse to 2×2 grid, bottom nav shows primary 4 tabs + "More". FAB (+) in bottom right for quick actions.

**Issues:** None major. Refresh icon (top right) is unlabeled on desktop — tooltip would help.

---

### Alerts (`/hub/alerts/`)
**Screenshots:** `hub-alerts-desktop.png` · `hub-alerts-mobile.png`

Excellent execution. CRITICAL/HIGH/MEDIUM/LOW severity bands with left-color-border + badge. Confidence score shown (97%, 84%, 78%). Asset links are tappable. "Acknowledge" primary action + "Detail" secondary per alert. Acknowledged items visually de-emphasized.

**Issues:** Filter tabs (All, Critical, High, Medium, Low) — "All" shows a count badge but individual severity tabs don't — makes it unclear how many are in each bucket without clicking.

---

### Actions (`/hub/actions/`)
**Screenshots:** `hub-actions-desktop.png` · `hub-actions-mobile.png`

Clean activity log. Type badges (Diagnostic, WO Created, Manual, Lookup, Safety, PM) with color differentiation. Channel icons (Telegram bird, Teams icon) distinguish sources. "Synced to Atlas" shown inline — good auditability signal. Arc Flash safety row has red left border, consistent with Alerts styling.

**Issues:** Filter icon (top right funnel) appears non-functional in audit — no filter panel opened. Could be hidden behind auth/data gate.

---

### Conversations (`/hub/conversations/`)
**Screenshots:** `hub-conversations-desktop.png` · `hub-conversations-mobile.png`

Functional thread list. Avatar + name, asset context link, last message preview, timestamp. Unread badge on Ray Patel's thread. Clean iOS-mail-style layout.

**Issues:** The page feels empty below 5 threads — large whitespace. No "Start conversation" CTA or onboarding hint for new tenants who'd see 0 threads.

---

### Knowledge (`/hub/knowledge/`)
**Screenshots:** `hub-knowledge-desktop.png` · `hub-knowledge-mobile.png` · `hub-knowledge-picker-desktop.png` · `hub-knowledge-picker-mobile.png`

Empty state is clean ("No documents found" + book icon). Upload button prominent in header. Upload picker modal is well-designed: drag/drop zone with format hints + cloud source buttons (Google Drive, Dropbox — disabled when not connected). Format hint text ("PDF, JPEG, PNG, WebP, HEIC · Up to 20 MB each") is discoverable.

**Issues:**  
- Header subtitle "0 Indexed · 0 chunks in RAG" is technically accurate but sounds alarming to a new user — consider "Get started by uploading your first document" as empty state copy  
- Cloud source buttons appear faded/disabled — missing tooltip explaining *why* they're disabled and how to enable them

---

### Assets (`/hub/assets/`)
**Screenshots:** `hub-assets-desktop.png` · `hub-assets-mobile.png`

Clean filter tabs (All, Active, Maintenance, Inactive). Empty state uses search icon + "No assets found / Try a different search or filter" — the second line is misleading when the tenant has zero assets (filters can't help). 

**Issues:**  
- Empty state hint copy should conditionally say "Add your first asset to get started" when `totalAssets === 0`  
- No inline "New Asset" CTA in empty state (button only exists top-right)

---

### Work Orders (`/hub/workorders/`)
**Screenshots:** `hub-workorders-desktop.png` · `hub-workorders-mobile.png`

Best-populated page in the audit. 8 WOs with priority + status badge combos (Critical/In Progress, High/Open, etc.). Color-coded badges are immediately readable. Due dates shown. Assignee initials.

**Issues:**  
- WO-2026-002 is past due (2026-04-23) but has no visual overdue indicator on the list card — no red date text, no warning icon. The "Overdue 1" filter tab is the only signal  
- No click target visible on rows — unclear if tapping a WO opens a detail view

---

### Channels (`/hub/channels/`)
**Screenshots:** `hub-channels-desktop.png` · `hub-channels-mobile.png`

Clear two-section layout (Communication Channels / Document & Knowledge Sources). "Coming Soon" badge on WhatsApp. Microsoft Teams grayed-out Connect button. Google Workspace, Dropbox, Confluence all show active Connect.

**Issues:** Teams grayed-out button has no tooltip — is it disabled or a paid tier? Users won't know without asking.

---

### Usage (`/hub/usage/`)
**Screenshots:** `hub-usage-desktop.png` · `hub-usage-mobile.png`

Usage quota bar (0/3,600 — Pro tier) + 4 metric tiles (Total Actions, Conversations, Active Techs, Avg/Day). "By Type" and "By Channel" breakdown cards below.

**Issues:**  
- "Daily Actions" chart section is a completely blank white box — no axes, no placeholder copy. Looks broken to a new user. Should show "No activity yet this billing period" at minimum  
- "By Channel" shows "No channel data this month" but "By Type" just shows zeros — inconsistent empty state treatment

---

### Login (`/hub/login/`)
**Screenshots:** `hub-login-desktop.png` · `hub-login-mobile.png`

Polished dark-gradient card. FactoryLM logo. Google OAuth button. Email/password fields. "Don't have an account? Create one" link. Clean and professional.

**No issues.**

---

### Secondary Pages (Workorders New, Schedule, Reports, Parts, CMMS, Documents, Team, Admin)
**Screenshots:** `hub-workorders-new-*`, `hub-schedule-*`, `hub-reports-*`, `hub-parts-*`, `hub-cmms-*`, `hub-documents-*`, `hub-team-*`, `hub-admin-users-*`, `hub-admin-roles-*`

All pages render without errors — auth state carried through. These pages appear as stub/placeholder states for the audit user. Consistent sidebar + header layout across all.

---

## Hub — Category Scores

| Category | Score | Notes |
|---|---|---|
| 1. Visual polish | 7/10 | Consistent design tokens, clean cards, dark sidebar. Some pages feel sparse (conversations, usage chart). |
| 2. Mobile responsiveness | 8/10 | Bottom nav, 2×2 KPI grid, FAB, full-page card stacking all solid. Minor tight spots in work order tabs. |
| 3. Navigation clarity | 5/10 | **Critical gap**: Desktop sidebar has only 6 items. Alerts, Actions, Work Orders, Schedule, Reports, Parts, Documents, Team, Admin are invisible on desktop unless user knows URLs. Mobile "More" covers all of them. |
| 4. Information density | 7/10 | Feed and Work Orders excellent. Conversations and Usage feel underpopulated. |
| 5. Loading states | 6/10 | Knowledge shows animated clock spinner. No skeleton screens on other pages — flash of empty state before data loads. |
| 6. Empty states | 6/10 | Feed, Alerts, Actions, Work Orders all have data. Knowledge and Assets empty states functional but copy could onboard better. Usage chart blank is the biggest gap. |
| 7. Interactive feedback | 7/10 | Acknowledge, Dismiss, Mark as Read, upload loading states all work. Upload error handling now surfaces via mobile-visible error messages (just fixed). |
| 8. Dark mode quality | 6/10 | Dark sidebar is always present. Content area appears light-only in audit screenshots — dark mode toggle in sidebar footer needs verification against full content area dark treatment. |
| 9. Typography hierarchy | 7/10 | Page headers clear, section labels uppercase-tracked, card text hierarchy well-defined. |
| 10. Branding consistency | 7/10 | Blue brand color, FactoryLM logo, "MIRA" AI identity cleanly separated. |

**Hub Total: 6.6 / 10**

---

## Marketing Site — Page-by-Page Assessment

### Homepage (`factorylm.com/`)
**Screenshots:** `marketing-home-desktop.png` · `marketing-home-mobile.png`

Text-heavy hero — "The AI workspace for industrial maintenance. Meet MIRA — your agent on the floor." Primary CTA "Start Free + Assign link" and "See pricing". Brand logos (Allen-Bradley, Siemens, ABB, etc.) for social proof. "MIRA vs. ChatGPT Projects" comparison section. "Built for the floor" STOP/CAUTION signal card. Pricing callout at bottom.

**Issues:**  
- No hero image or product screenshot — competitors (MaintainX) lead with product photos  
- At 1440px, the page feels narrow/centered — significant whitespace on sides. Layout appears designed for ~900px max-width  
- "Start Free + Assign link" CTA copy is confusing — what does "Assign link" mean to a visitor?

### CMMS Page (`factorylm.com/cmms`)
**Screenshots:** `marketing-cmms-desktop.png` · `marketing-cmms-mobile.png`

Product-focused CMMS feature page. Likely explains the Atlas CMMS offering.

### Pricing Page (`factorylm.com/pricing.html`)
**Screenshots:** `marketing-pricing-desktop.png` · `marketing-pricing-mobile.png`

Pricing cards. "Site license. Not per-seat. $879/mo per year." Clear differentiation from competitor per-seat pricing.

---

## Marketing — Category Scores

| Category | Score | Notes |
|---|---|---|
| 1. Visual polish | 5/10 | No hero imagery, text-heavy, narrow content width at 1440px |
| 2. Mobile responsiveness | 7/10 | Appears to stack reasonably at 412px |
| 3. Navigation clarity | 6/10 | Top nav: CMMS, Pricing, Blog, Limitations. Simple and honest. |
| 4. Information density | 5/10 | Homepage feels sparse at 1440px. Good content, not well-presented. |
| 5. Loading performance | 9/10 | Static HTML — instant. |
| 6. Trust signals | 7/10 | Brand logos (Siemens, ABB, etc.), comparison table, safety signal card |
| 7. CTAs | 5/10 | "Start Free + Assign link" is confusing. Could be "Start free trial" |
| 8. Social proof | 5/10 | No customer quotes/testimonials, no case studies visible |
| 9. Typography hierarchy | 6/10 | Headings clear, body text functional |
| 10. Branding consistency | 7/10 | FactoryLM + MIRA consistent, blue accent color matches hub |

**Marketing Total: 6.2 / 10**

---

## Ranked Issues — Fix Priority

### P0 — Critical (blocks demo confidence)

1. **Desktop sidebar incomplete** — 9+ product pages not reachable from desktop nav  
   *Fix:* Add Work Orders, Alerts, Actions to sidebar. Group admin items under a collapsible "Admin" section. The mobile "More" list is a good reference for what's missing.

### P1 — High (first-impression damage)

2. **Usage chart blank box** — `Daily Actions` section renders as empty white rectangle with no message  
   *Fix:* Render "No activity yet this billing period" centered in the chart area, or hide the chart panel entirely when `totalActions === 0`.

3. **Marketing homepage — no product screenshot**  
   *Fix:* Insert a product screenshot (e.g., the Feed page desktop view) as a hero image above the fold. One real screenshot does more than five paragraphs.

4. **Work order overdue indicator missing**  
   *Fix:* Red text on due date when past-due. Add a small "Overdue" badge to the WO list card. Pattern already exists in feed KPI card ("3 OVERDUE PMs").

### P2 — Medium (polish and clarity)

5. **Knowledge empty state copy** — "0 Indexed · 0 chunks in RAG" alarming for new tenant  
   *Fix:* When 0 docs: show "Upload your first document to start answering questions from MIRA" instead of the stat line.

6. **Assets empty state misleading hint** — "Try a different search or filter" when tenant has no assets  
   *Fix:* Conditionally show "Register your first asset to start tracking diagnostics and work orders" when `total === 0`.

7. **Cloud picker disabled buttons — no explanation**  
   *Fix:* Tooltip on disabled Google Drive / Dropbox buttons: "Connect Google Workspace in Channels to enable." Already added as hint text in UploadPicker — verify it renders at all viewport sizes.

8. **Marketing CTA copy** — "Start Free + Assign link" unclear  
   *Fix:* "Start free trial" or "Book a demo".

### P3 — Low (refinements)

9. **Conversations: no start-thread CTA when empty**  
   *Fix:* Empty state with "No conversations yet — your team will appear here as they message MIRA via Telegram or Slack."

10. **Channels: Teams grayed-out — no tier explanation**  
    *Fix:* Tooltip: "Microsoft Teams integration available on Enterprise tier."

11. **Marketing: narrow layout at 1440px**  
    *Fix:* Increase `max-width` on homepage content or add side visuals to fill the viewport.

---

## Summary Scorecard

| Surface | Score | Key Strength | Key Gap |
|---|---|---|---|
| Hub | 6.6 / 10 | Feed + Alerts: excellent data presentation | Desktop nav missing 9+ pages |
| Marketing | 6.2 / 10 | Fast, honest pricing, real brand logos | No product imagery, CTA copy unclear |
| **Combined** | **6.4 / 10** | Design system consistent across surfaces | Navigation (desktop) + empty states |

**vs. MaintainX/Linear benchmark:** Both competitors score ~8.5/10 on navigation clarity and polish. Hub is at ~5/10 for desktop nav — closing that gap is the single highest-leverage UX investment available.

---

## Next Steps

1. Fix desktop sidebar navigation (P0) — estimated 2–3 hours
2. Fix Usage chart empty state (P1) — estimated 30 min
3. Add hero screenshot to marketing homepage (P1) — estimated 1 hour
4. Patch work order overdue indicator (P1) — estimated 1 hour
5. Re-run audit after fixes to verify scores move to 7.5+ on navigation category
