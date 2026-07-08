# Secret Shopper Re-Audit — FactoryLM & MIRA
**Reviewer:** Hermes (acting as new maintenance manager)
**Date:** 2026-06-21
**Previous audit:** 2026-06-20 (SECRET-SHOPPER-REPORT.md)
**QA account:** hermes-qa-maint@example.com

---

## What Changed Since the Last Audit

All 6 critical issues filed in the previous audit were closed within hours of being filed. Here's the status of every item, plus new findings.

---

## Issue-by-Issue Status

| # | Severity | Title | Status | Verdict |
|---|---|---|---|---|
| #2178 | P0 | Core diagnostic broken — no Yaskawa data | **CLOSED** | ⚠️ Partially fixed — see #2198 |
| #2183 | P2 | Quickstart cites Rockwell docs for Yaskawa | **CLOSED** | ✅ Fixed — now says "no manual for that" honestly |
| #2181 | P1 | Nav sidebar table wrong in manual | **CLOSED** | ✅ Fixed — 3 dev-only items removed from sidebar |
| #2180 | P1 | Team invite button disabled | **CLOSED** | ⚠️ Partial — "Invite (soon)" replaced with "Request access" link |
| #2179 | P1 | Pricing $97/mo wrong in manual | **CLOSED** | ✅ Acknowledged — manual needs rewrite |
| #2176 | P1 | Login described as magic-link only, passwords exist | **CLOSED** | ✅ Acknowledged — manual needs rewrite |

---

## Detailed Findings — This Audit

### ✅ FIXED: Nav sidebar cleaned up (#2181)

**Previous:** Sidebar showed `plc-import`, `Contextualization`, `Import Review` — internal dev tools exposed to users.

**Now:** Clean 9-item sidebar: Command Board, Namespace, Command Center, Channels, Knowledge, Assets, CMMS, Scan, Settings. No internal tools visible.

**Verdict: Fixed.** The manual's Chapter 3.1 nav table still needs updating (it lists different names like "Feed" instead of "Command Board" and "Work Orders" instead of "CMMS"), but the product side is clean.

---

### ✅ FIXED: Quickstart no longer cites wrong manufacturer (#2183)

**Previous:** Asked about Yaskawa GS20 F030, got answer citing Rockwell Automation PowerMonitor 5000 pages.

**Now:** Responds with: *"I don't have manuals for that in the public knowledge base — sign up to upload your own and I can help."* Clean, honest, no false citations.

**Verdict: Fixed.** Still needs to be added to the manual (issue #2186 still open).

---

### ⚠️ PARTIAL FIX: Core diagnostic improved but still wrong model (#2178 → new #2198)

**Previous:** Returned "I don't have specific information on fault code F030 for the Yaskawa GS20 in my database" — confidence: low, no citations.

**Now:** Returns: *"I'm not aware of any information in the provided documentation [1]–[6] that specifically mentions fault code F030 for the Yaskawa GS20. The documentation appears to be for the Yaskawa V1000 and J1000 models, not the GS20."* — confidence: **medium**, 6 citations all from V1000/J1000.

**Assessment:** This is more accurate and more honest than before — the system found Yaskawa content and correctly identified it doesn't match the GS20. But the user experience is still "MIRA can't help with your most common VFD" which is the exact problem the product is supposed to solve. Root cause: no GS20 manual in the KB.

**What needs to happen:** Ingest the Yaskawa GS20/GA500 Technical Manual (free on yaskawa.com). Until that's done, the homepage's prominent featuring of Yaskawa is misleading — the KB doesn't have GS20 content.

**Filed:** Issue #2198

---

### ⚠️ PARTIAL FIX: Team invite — "Invite (soon)" replaced with "Request access" (#2180)

**Previous:** Disabled button saying "Invite (soon)."

**Now:** A clickable "Request access" link on the Settings → Users page. Clicking it stays on the same URL — it appears to navigate somewhere but the page doesn't change visibly. Likely opens a mailto or external form.

**Assessment:** Better than a dead button, but still not a functional invite system. The manual describes team invite as a core Week 1 activity. The workaround ("Request access") isn't good enough for a chapter heading in a user manual. The manual should say: *"To add team members during beta, use the 'Request access' link on Settings → Users, or contact support@factorylm.com."*

---

### 🔴 NEW BUG: CMMS quick links crash to browser error (#2197 — NEW)

**Not in previous audit.** This session discovered that the CMMS page ("FactoryLM Works Setup") shows quick links — Work Orders, PM Schedule, Reports — that all point to `http://cmms-backend:8080/...`, an internal Docker hostname.

Clicking any of them throws a browser error: **"This site can't be reached."**

This is a P1. Every single CMMS quick link is broken for every user. The manual's Chapter 6 (Work Orders), Chapter 9 (PM Schedules), and Chapter 13.3 (Reports) all describe these as working features.

**Filed:** Issue #2197

---

### 🔴 STILL OPEN: Namespace buttons disabled, no explanation (#2182)

**Unchanged.** Namespace page shows "New Folder" and "Upload" both disabled, no tooltip, no empty state guidance. A new user following Chapter 4.5 (The Namespace) hits a dead end.

---

### 🔴 STILL OPEN: Pricing/4 pages — factorylm.com/pricing/ still 404 (#2179 closed as acknowledged)

Issue #2179 is closed as acknowledged (the manual needs updating), but the underlying product problem — no public pricing page — persists. Any user who tries to look up pricing independently hits a 404. The homepage shows pricing in the body, but a dedicated `/pricing/` page is standard and its absence will cause confusion.

---

### 🟡 STILL OPEN: Copy bug — "No proposed proposals yet" (#2150)

**Unchanged.** Knowledge → Suggestions still shows the redundant heading "No proposed proposals yet." Minor but unprofessional.

---

### ✅ NO CHANGE NEEDED: Homepage

Still clean and accurate. No changes observed.

---

### ✅ NO CHANGE NEEDED: Login/signup (issue #2176 closed as acknowledged)

Login page still has all 3 methods (magic link, Google, password). Signup still has a password field. The manual needs updating but the product is fine as-is.

---

## Updated Scorecard

| Area | Previous Audit | This Audit | Change |
|---|---|---|---|
| Homepage | ✅ Good | ✅ Good | — |
| Login/signup | ⚠️ Misleading docs | ⚠️ Same (docs TBD) | — |
| Asset creation | ✅ Works | ✅ Works | — |
| **Core diagnostic (asset chat)** | 🔴 Broken | ⚠️ Partially working | ↑ Improved |
| **Quickstart demo** | 🔴 Wrong citations | ✅ Honest "no data" | ↑ Fixed |
| **Sidebar nav** | 🔴 Dev tools visible | ✅ Clean | ↑ Fixed |
| **Team invite** | 🔴 Dead button | ⚠️ "Request access" workaround | ↑ Improved |
| Pricing | 🔴 Wrong in manual | 🔴 Still wrong in manual | — |
| **CMMS quick links** | ✅ Not tested | 🔴 All broken (Docker hostname) | ↓ New bug |
| Namespace | ⚠️ Dead buttons | ⚠️ Still dead buttons | — |
| Knowledge base | ✅ Data is there | ✅ Data is there | — |
| Settings | ✅ Works | ✅ Works | — |
| factorylm.com/pricing/ | 🔴 404 | 🔴 404 | — |

---

## New Issues Filed This Audit

| # | Severity | Title |
|---|---|---|
| #2197 | P1 | CMMS quick links point to internal Docker hostname — crash for all users |
| #2198 | P2 | Core diagnostic still wrong model — GS20 manual not in KB, V1000/J1000 retrieved instead |

---

## Things Still Needed Before Manual Can Be Published

### Product fixes (blocking):
1. **#2197** — CMMS quick links broken (Docker hostname leak). Chapter 6, 9, 13 describe CMMS features as working.
2. **#2198** — GS20 manual not in KB. Homepage shows Yaskawa prominently. Ingest the GS20 manual.
3. **#2182** — Namespace buttons disabled. Chapter 4.5 describes a working namespace builder.

### Manual rewrites (blocking for accuracy):
4. Chapter 2.2–2.3 — Pricing ($97/mo wrong) + auth (magic-link only description wrong)
5. Chapter 3.1 — Nav table (still uses old names like "Feed" and "Work Orders")
6. Chapter 2.7 + 10 — Team invite described as self-serve; currently requires "Request access" workaround
7. Chapter 12.2–12.4 — MaintainX/Limble/Fiix connector statuses wrong; Fiix not present; undocumented Google/Dropbox/Confluence connectors

### Nice-to-have before publish:
8. factorylm.com/pricing/ page (currently 404)
9. #2186 — Add /quickstart/ to manual
10. #2150 — Fix "No proposed proposals yet" copy

---

## Overall Trajectory

**Positive:** The team responded to the previous audit fast — 6 issues closed in hours, a visible product change (sidebar cleanup) deployed. That's the right velocity.

**Remaining blockers:** The CMMS links are a new P1 that didn't exist (or wasn't caught) in the previous audit. The core diagnostic is now honest about its limitations but those limitations are significant — Yaskawa GS20, the exact model used in every example in the manual and homepage, has no dedicated manual in the KB.

**The manual is still not publishable** until the CMMS crash is fixed (#2197) and the GS20 manual is ingested (#2198). Everything else in the manual accurately describes what the product does — it just needs the chapter on work orders to point to something that works, and the chapter on Yaskawa diagnostics to have a grounded answer behind it.
