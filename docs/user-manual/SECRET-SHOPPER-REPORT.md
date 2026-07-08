# Secret Shopper Report — FactoryLM & MIRA
**Reviewer:** Hermes (acting as new maintenance manager)
**Date:** 2026-06-20
**Method:** Followed the user manual step-by-step as a first-time user with no inside knowledge
**QA account:** hermes-qa-maint@example.com (Doppler: factorylm/dev)

---

## Verdict Summary

| Area | Status | Notes |
|---|---|---|
| Homepage (factorylm.com) | ✅ Good | Clear, professional, messaging lands |
| Signup flow | ⚠️ Misleading | Manual says magic-link only; product has passwords |
| Login | ✅ Works | Magic link + Google + password — all functional |
| Asset creation | ✅ Works well | Form is clean, OEM dropdown is good |
| Diagnostic chat (core feature) | 🔴 Broken | Returns "no data" for Yaskawa GS20 F030 despite 9.3K chunks |
| Knowledge base | ✅ Data is there | 83K chunks, 304 manufacturers — retrieval is the problem |
| Work order creation | ✅ Works | Flow is clear and logical |
| Navigation sidebar | 🔴 Wrong in manual | Actual nav doesn't match Chapter 3 table at all |
| Team invite | 🔴 Not functional | Button says "Invite (soon)" — disabled |
| Pricing | 🔴 Completely wrong | Manual says $97/mo; product shows $499/mo or $2-5K pilot |
| Channels/Connectors | ⚠️ Partially wrong | More options than manual says; some statuses wrong |
| Namespace | ⚠️ Broken UX | Primary buttons disabled with no explanation |
| Quickstart demo | ⚠️ Bug + undocumented | Cites wrong manufacturer; not in manual at all |
| Settings | ✅ Works | Audit log, Security, Integrations all present |
| factorylm.com/pricing/ | 🔴 404 | Page doesn't exist |

---

## How Far I Got Following the Manual

### ✅ Step 1: factorylm.com homepage
**Verdict: Good.**

Clean, professional, dark industrial theme. Messaging is sharp: "Turn your maintenance reality into AI-ready infrastructure. Then MIRA makes it actionable." The before/after comparison (Generic AI vs. MIRA) is compelling and accurately represents the value proposition. The animated demos work.

**Minor issue:** The manual says the CTA is "Start my beta" — it's actually "Try MIRA Free →". Not a blocker, but should be updated.

---

### ✅ Step 2: Clicking the CTA — landed on signup
**Verdict: Works but manual is wrong about it.**

Clicked "Try MIRA Free →", landed on `app.factorylm.com/signup/`. The page has:
- Continue with Google
- Name field (optional)
- Email field (required)
- **Password field (required)**

The manual (Chapter 2.3) explicitly says: *"MIRA uses magic-link login. There are no passwords."* This is **false**. The signup requires a password. The entire rationale written in the manual about why there are no passwords is wrong.

**Filed:** GitHub issue #2176

---

### ✅ Step 3: Login with password
**Verdict: Works.**

Used the QA account. Login page defaults to magic link but has a "Sign in with password" toggle that works. Login succeeded, landed on Command Board (not "Feed" as the manual says).

**Issue:** Manual says first screen after login is the "Feed" and describes an onboarding wizard launching automatically. Neither happened. I landed on a "Command Board" with 4 quick-action tiles.

---

### ✅ Step 4: Adding an asset (Chapter 4.2)
**Verdict: Works well. Minor friction on OEM dropdown.**

The "Add an asset" quick-action tile on Command Board worked. The Create Asset form is clean:
- Asset Name
- Asset Tag
- Manufacturer / OEM (dropdown — good OEM list)
- Model
- Serial Number
- Location
- Criticality (Low/Medium/High/Critical)
- Install Date

**Issue:** The OEM dropdown wouldn't respond to click in the browser automation, had to use JavaScript to set the value. Real users on touch devices should be fine — this is a test environment limitation. The "Create Asset" button stayed disabled until OEM was selected — the required field indicator on "MANUFACTURER / OEM *" is correct.

**Asset created successfully:** "Line 3 VFD - Yaskawa GS20" with auto-generated tag YASK-7PS0RW2J.

---

### 🔴 Step 5: First diagnostic conversation (Chapter 5 — THE CORE FEATURE)
**Verdict: Broken. This is the most critical finding.**

From the asset page, clicked "Chat with MIRA about this asset." A chat interface appeared with:
- Quick-start buttons: "Common faults?", "PM checklist", "Fault code F005", "Parts to stock" — good UX
- Text input "Ask about this asset…"
- The chat correctly showed "Asset-scoped" label

Typed: *"This GS20 is showing fault code F030. It trips about 3 seconds after startup. Motor hums briefly before trip. No recent changes to the line."*

**MIRA's response:**
> "I don't have specific information on fault code F030 for the Yaskawa GS20 in my database, and I couldn't find a matching manual section. For accurate troubleshooting, I recommend consulting the Yaskawa GS20 service manual or contacting Yaskawa support directly. Before proceeding, please ensure you follow site safety procedures for electrical equipment, including lockout/tagout."

Confidence shown: **low**

**Why this is a P0 failure:**
- The Knowledge Base shows **9,300 Yaskawa chunks from 4 manuals**
- F030 on the Yaskawa GS20 is "Output Phase Loss" — one of the most commonly encountered fault codes on this drive
- The homepage demo uses this *exact scenario* — it is the product's primary promise
- The manual's Chapter 5.2 example conversation shows exactly this working correctly
- A real maintenance manager would immediately lose faith in the product

**What I think is happening:** The asset-scoped chat is not correctly passing manufacturer/model context to the retrieval pipeline. The KB has the data; the retrieval is failing to find it.

**Confirmed:** The public `/quickstart/` page asked the same question and returned an answer — but cited **Rockwell Automation PowerMonitor 5000** pages for a Yaskawa query. So retrieval runs but ignores manufacturer context entirely.

**Filed:** GitHub issues #2178 (asset chat) and #2183 (quickstart wrong citation)

---

### ✅ Step 6: Manual work order creation (Chapter 6)
**Verdict: Works cleanly.**

CMMS → New Work Order → 2-step wizard:
1. Select asset (searched, found Yaskawa GS20 immediately)
2. Describe fault + select priority (Low/Medium/High/Critical — good labels with descriptions)

Review step exists. The "Review" button was initially disabled until description was entered. Clean flow. The priority labels are excellent ("High: Significant impact, act within 48h") — better than what the manual describes.

**Gap:** The manual says MIRA auto-creates a WO draft after a diagnostic conversation and you "tap Confirm." This flow doesn't appear to exist in the current UI — WOs are created manually or from a separate "New Work Order" button, not from the chat outcome. This may be a missing feature or a different UX flow than documented.

---

### ✅ Step 7: Knowledge base (Chapter 7)
**Verdict: The data is impressive. The UI is different from what the manual describes.**

Knowledge → Manuals shows:
- 83,613 chunks
- 304 manufacturers
- Last ingest 5 days ago
- Charts: cumulative KB growth, top manufacturers by chunk count

The manufacturer list is A-Z, browsable, with chunk counts. Allen-Bradley (2.7K chunks), Yaskawa (9.3K chunks) — the data is real and substantial.

**Issue:** The manual describes going to "Knowledge → Upload PDF" to upload a manual. In the live product, the Knowledge section opens on the "Map" tab (knowledge graph), not the manuals list. Users have to find the "Manuals" tab first. The Upload button is on the Manuals tab but the entry point is the Map tab — which shows "NO CONNECTIONS YET — 2 nodes, but nothing is linked" for a new user. Confusing.

**Issue:** The Knowledge → Map tab shows a graph view with "0 edges, 0 verified, 0 proposed" for a new account. The UX is asking users to understand knowledge graphs before they've gotten any value. The empty state message ("MIRA can see your equipment, but there are no relationships to reason over yet") is technically accurate but unintuitive for a maintenance manager.

---

### 🔴 Step 8: Navigation (Chapter 3.1)
**Verdict: Manual nav table is substantially wrong.**

**Actual live sidebar:**
- Command Board ← manual calls this "Feed"
- Namespace ✓
- Command Center ✓
- Channels ✓
- Knowledge ✓
- *(MORE divider)*
- Assets ✓
- CMMS ← manual calls this "Work Orders"
- **Scan** ← not in manual at all
- **plc-import** ← not in manual, looks like internal dev tool
- **Contextualization** ← not in manual, looks like internal dev tool
- **Import Review** ← not in manual, looks like internal dev tool
- Settings ✓

**Missing from sidebar vs. manual:** Feed, Conversations, Library, Documents, Parts, Schedule, Reports, Alerts, Team, Usage

The three items "plc-import", "Contextualization", "Import Review" are particularly problematic — they appear to be internal/admin tools that are visible to this QA account but should probably not be shown to regular users. A maintenance manager clicking "plc-import" will have no idea what they're looking at.

**Filed:** GitHub issue #2181

---

### 🔴 Step 9: Team management — Chapter 10
**Verdict: Not functional.**

Settings → Users shows:
> Button: "**Invite (soon)**" — greyed out, disabled

A new user following Chapter 2.7 ("Inviting your team") or Chapter 10 ("Team Management") will hit a dead end immediately. This is a core collaborative workflow described as working in the manual.

**Filed:** GitHub issue #2180

---

### 🔴 Step 10: Pricing / Upgrade flow
**Verdict: Manual is completely wrong on pricing.**

The upgrade page shows:
- Assessment: $500 one-time
- Pilot: $2–5K/month, 3-month minimum
- Operating Layer: **$499/month** per plant

The manual describes **$97/month** with a 7-day trial and Stripe self-serve checkout. This appears to be a completely outdated pricing model from an earlier PLG experiment (mira-web CLAUDE.md). The current commercial model is a sales-led motion, not self-serve.

Additionally: `factorylm.com/pricing/` returns **404 Not Found**.

This is the single biggest structural problem with the manual — the entire signup/activation flow (Chapters 2.1–2.2) needs to be rewritten.

**Filed:** GitHub issue #2179

---

### ⚠️ Step 11: Namespace (Chapter 4.5)
**Verdict: Broken UX — no path forward for new user.**

Namespace page loads but both primary buttons ("New Folder" and "Upload") are **disabled** with no explanation. No tooltip. No empty state guidance. The manual describes Namespace as a working drag-and-drop hierarchy builder.

**Filed:** GitHub issue #2182

---

### ✅ Step 12: Channels/Connectors (Chapter 12)
**Verdict: More complete than manual documents, but some inaccuracies.**

Channels page is well-designed. Atlas CMMS shows "Connected" out of the box — as the manual promises. MaintainX has a working Connect button (contradicting the manual's "email support" instruction). Limble and UpKeep show "Coming Soon" (manual calls them "Beta"). Fiix is absent from the page entirely.

**Undocumented integrations discovered:** Google Workspace, Microsoft 365, Dropbox, Confluence — all have Connect buttons in a "Document & Knowledge Sources" section not mentioned in the manual at all. This is a significant feature gap in the documentation.

**Filed:** GitHub issue #2184

---

## What's Good (Genuine Positives)

**1. The homepage is excellent.** The before/after AI comparison, the animated demos, the clear three-tier commercial model — all of this is professional and compelling. A maintenance manager visiting factorylm.com for the first time will "get it."

**2. Asset creation works well.** The OEM dropdown with the right manufacturers, the criticality levels with descriptions, the auto-generated asset tags — this is well thought out.

**3. The knowledge base data is real and substantial.** 83,613 chunks, 304 manufacturers, 9,300 Yaskawa chunks — the KB investment is genuine. The retrieval bug (#2178) is a technical problem, not a data problem.

**4. The work order creation flow is clean.** The two-step wizard (asset selection → description + priority) is intuitive. Priority labels have descriptions ("High: Significant impact, act within 48h") which is exactly right for plant-floor users.

**5. The feedback mechanism on MIRA responses is thoughtful.** Confidence level displayed, Correct/Wrong/Missing context/Needs review buttons — this is the right infrastructure for improving a RAG system.

**6. The Channels page is more complete than documented.** Google Workspace, Dropbox, Confluence integrations for knowledge ingestion are genuinely useful and not widely available in CMMS tools.

**7. The Scan page (undocumented) is a great feature.** A dedicated nameplate scanning interface at /scan/ with "Scan plate" and "Upload photo" buttons is exactly what technicians need in the field. It just needs to be in the manual.

**8. Settings is complete and well-structured.** Organization, Users, Roles & Permissions, Security, Integrations, Usage, Audit Log — all present and logically organized.

---

## Issues Filed During This Test

| # | Severity | Title |
|---|---|---|
| #2176 | P1 | Manual wrong — login has passwords, not magic-link only |
| #2178 | P0 | Core diagnostic broken — no data on Yaskawa GS20 F030 despite 9,300 chunks |
| #2179 | P1 | Pricing in manual ($97/mo) doesn't match live product ($499/mo) |
| #2180 | P1 | Team invite button disabled — manual describes it as working |
| #2181 | P1 | Manual nav table wrong — actual sidebar differs significantly |
| #2182 | P2 | Namespace page has disabled buttons, no explanation |
| #2183 | P2 | Quickstart cites Rockwell docs for Yaskawa fault |
| #2184 | P2 | Channels page has more connectors than manual; statuses wrong |
| #2186 | P3 | Quickstart demo (/quickstart/) not mentioned in manual |

**Previously filed issues confirmed as still open:** #2158, #2159, #2160, #2161, #2164, #2165, #2166, #2167, #2168, #2169, #2170, #2171, #2173, #2174

---

## Recommended Fix Priority

### Before the manual can be published:
1. **#2178 (P0)** — Fix the core diagnostic retrieval. If the chat says "no data" on a 9,300-chunk manufacturer, the manual cannot claim it works.
2. **#2179 (P1)** — Rewrite all pricing sections. The manual's entire signup/activation flow is based on a $97/mo self-serve model that doesn't exist.
3. **#2176 (P1)** — Fix the login/auth description. The manual says "no passwords" — there are passwords.
4. **#2181 (P1)** — Update the nav table in Chapter 3 to match the live product.
5. **#2180 (P1)** — Either ship team invite or add a workaround to the manual.

### Before the manual can describe these features as working:
6. **#2182 (P2)** — Namespace UX needs an explanation or the feature needs to work.
7. **#2183 (P2)** — Fix quickstart retrieval before featuring it.
8. **#2184 (P2)** — Update Channels documentation to match live product.
9. **#2186 (P3)** — Add quickstart to the manual once #2183 is fixed.

---

## Overall Assessment

The product has solid bones. The knowledge base is real and substantial. The asset management, work order, and settings flows work. The homepage messaging is compelling and accurate to the vision.

**The manual cannot be published as-is.** The three structural problems — wrong pricing model, broken core diagnostic, and wrong nav documentation — mean a user following the manual would fail at steps 2 (pricing), 5 (the core feature), and 8 (navigation). That's three failures in the first 30 minutes for a new maintenance manager.

The fastest path to a publishable manual:
1. Fix issue #2178 (diagnostic retrieval) — this is a product bug, not a docs bug
2. Rewrite Chapters 2.1–2.2 for the current sales-led model
3. Update Chapter 3.1 nav table from the live product
4. Update all auth/login descriptions to reflect passwords exist
5. Mark team invite, namespace, and QR system as "coming soon" until they're live

Once those five things are done, the manual describes a product that a real maintenance manager can actually use.
