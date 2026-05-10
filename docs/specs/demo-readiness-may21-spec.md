# Demo Readiness Specification — Florida Automation Expo, May 21, 2026

**Status:** DRAFT — under review
**Demo target:** Florida Automation Expo
**Demo date:** Thursday, May 21, 2026 (T-15 days from 2026-05-06)
**Prep deadline:** Sunday, May 18, 2026 (T-12 days; 3-day cushion)
**Owner:** Mike Harper
**Demo device:** iPad / Android tablet (walking the floor)
**Demo length:** 3 minutes per booth conversation

---

## What "Demo Ready" Means

Mike walks the expo floor with a tablet. A prospect says "show me." Mike taps four surfaces in this order, and **none of them embarrass us**:

1. **app.factorylm.com** — the Hub: dashboard, assets, work orders
2. **cmms.factorylm.com** — Atlas CMMS, accessed via "Open CMMS" button from Hub
3. **app.factorylm.com/scan/** — MIRA Scan: camera → nameplate → answers (the wow)
4. **@FactoryLMDiagnose_bot on Telegram** — conversational fallback

"Demo ready" means: every page Mike taps loads with **real data** in **<3 seconds**, with **no console errors, no 500s, no hardcoded stubs, no "coming soon" placeholders.** If a feature can't be made real by May 18, it gets pulled from the demo path entirely — don't show what isn't ready.

---

## Surface 1 — app.factorylm.com (Hub)

The Hub is the home base. Every demo starts here. Bottom of funnel — login, then everything below the fold loads instantly with real numbers.

### MUST WORK (blocks demo)

| # | Item | Acceptance criteria |
|---|------|---------------------|
| H1 | **Login** | Magic-link OR Google OAuth completes in ≤2 taps. Success lands on Feed. No errors. CRA-22 / CRA-21 already merged — re-verify on iPad Safari + Android Chrome. |
| H2 | **Feed / dashboard** | Shows real KPIs from NeonDB: WO count, asset count, recent activity. No hardcoded numbers. No "—" placeholders. |
| H3 | **Assets page** | Lists real equipment from NeonDB with name, asset tag, last scan, location. Pagination works. Loads ≤2s. |
| H4 | **Work Orders page** | Shows real WOs from NeonDB. Status filter works. Click a row → detail view with real fields. |
| H5 | **Create Work Order form** | All fields persist. Enum fix (priority/status) deployed and verified — submit → row appears in WO list ≤2s. No 500s on any field combination. |
| H6 | **CMMS page (in Hub)** | Shows Atlas connection status (green/red), real WO counts pulled from Atlas, "Open CMMS" button → cmms.factorylm.com authenticated. |
| H7 | **Knowledge page** | Loads without 500. Shows real OEM manuals indexed in KB. Search returns hits. |
| H8 | **PM Schedule page** | Shows real PMs from NeonDB / Atlas — auto-extracted PMs visible (the flywheel). Calendar view OR list view, not both half-built. |
| H9 | **Mobile responsive** | Renders correctly on iPad (1024×768) and Android tablet (1280×800) viewports. No horizontal scroll. Buttons reachable with thumb. |
| H10 | **Navigation** | All sidebar items, bottom tabs, drawer items navigate without 404. No dead links. |
| H11 | **Console clean** | No red errors in dev console on any of the above pages on Safari iPad + Chrome Android. |
| H12 | **Load time** | Each page <3s on cellular tether. <1.5s on Wi-Fi. Measured on the actual demo tablet. |

### NICE TO HAVE

- Empty-state illustrations on Assets / WOs when filtered to zero
- Smooth route transitions (no full-page flash)
- Pull-to-refresh on mobile
- Dark-mode toggle persistence
- "Last sync" timestamp on dashboard

### OUT OF SCOPE (do not touch before May 21)

- New page types (no adding "Reports", "Analytics", "Users")
- Admin / settings deep dives
- Tenant management UI
- Billing / subscription management
- Multi-tenant switcher
- Any RBAC rework

---

## Surface 2 — cmms.factorylm.com (Atlas CMMS)

The CMMS is what proves we're a real maintenance product, not just a chatbot. Atlas opens from the Hub via the "Open CMMS" button.

### MUST WORK (blocks demo)

| # | Item | Acceptance criteria |
|---|------|---------------------|
| C1 | **Login works** | mira-api credentials log in cleanly. SSO from Hub if wired; otherwise direct credentials. |
| C2 | **Work orders list** | Visible, sortable, editable. Status changes persist. |
| C3 | **Assets list** | Visible. Each asset has equipment metadata. |
| C4 | **PM schedules** | Visible. Auto-created PMs from manual extraction show up. |
| C5 | **Hub ↔ CMMS navigation** | "Open CMMS" button from Hub asset/WO scan pages lands on the right Atlas page. Browser back returns cleanly. CRA-20 already shipped — re-verify on tablet. |

### NICE TO HAVE

- Single-sign-on between Hub and CMMS (no second login)
- Pre-filtered Atlas view based on the Hub asset that triggered the link

### OUT OF SCOPE

- Atlas admin features
- Asset hierarchy editing
- Custom PM rules editor
- Any Atlas plugin / module beyond core WO + Asset + PM

---

## Surface 3 — app.factorylm.com/scan/ (MIRA Scan) — THE WOW

This is the demo's punchline. Mike points the tablet at any nameplate. We extract specs and start chatting in seconds. If this fails on the floor, the demo is dead.

### MUST WORK (blocks demo)

| # | Item | Acceptance criteria |
|---|------|---------------------|
| S1 | **Camera opens** | Tapping "Scan" → live camera viewport on iPad Safari + Android Chrome. Permission prompt clear. |
| S2 | **Nameplate → specs <5s** | Tap shutter → vision pipeline → manufacturer / model / serial / specs returned in ≤5 seconds median, ≤8s p95. Tested on 5 real nameplates beforehand. |
| S3 | **KB hit → cited chat** | Recognized equipment → "Chat with MIRA" button opens chat seeded with asset context. First answer cites the OEM manual section it came from. |
| S4 | **KB miss → real OEM link** | Unknown equipment → "Searching for manual…" → returns a real, working OEM URL within 30s. Not a Google search redirect — an actual PDF link. |
| S5 | **iPad Safari** | Full path works on iPad Safari (latest stable). |
| S6 | **Android Chrome** | Full path works on Android Chrome (latest stable). |
| S7 | **Camera flip** | Front/back camera toggle works (some nameplates need close-up, some need angle). |
| S8 | **Network resilience** | Works on cellular tether at expo (assume crowded 5G). Add timeout + retry for slow networks; surface a clear error not a spinner-of-death. |

### NICE TO HAVE

- "Try a sample nameplate" button (pre-loaded image) for when lighting is bad
- "Photo from gallery" upload as fallback to live camera
- Confidence score shown next to extracted spec
- "Add to my assets" one-tap from scan result

### OUT OF SCOPE

- New OCR backends
- Multi-photo stitching
- Video scan mode
- Voice narration
- Offline mode

---

## Surface 4 — Telegram Bot (@FactoryLMDiagnose_bot)

Telegram is the conversational fallback and the multi-modal demo. Mike sends a photo or asks a question; MIRA responds with cited answers and can create work orders.

### MUST WORK (blocks demo)

| # | Item | Acceptance criteria |
|---|------|---------------------|
| T1 | **Single poller running** | Only one Telegram process polling the token. No 409 conflicts. CHARLIE has no stale poller. (Issue #880 must be resolved.) |
| T2 | **Fault code → cited answer** | "What does fault F004 mean?" → answer in <10s with citation to OEM manual. |
| T3 | **Photo → equipment ID** | Send a photo of a nameplate → equipment identified, specs returned, follow-up offered. |
| T4 | **"Create a WO" → persisted** | "Create a work order for this" → WO appears in NeonDB and shows up in Hub WO list within 5s. |
| T5 | **/new resets cleanly** | /new clears state. Next message starts a fresh diagnostic. No carryover from previous session. (Per memory: must reset RESOLVED state via `_clear_diagnostic_carryover`.) |
| T6 | **Response time <10s** | Median response time <10s for text queries on the demo network. |
| T7 | **No PII leaks** | Sanitizer is on (default). No raw IPs/MACs/serials in any response. |

### NICE TO HAVE

- Voice message → transcribed → answered
- /pm command shows extracted PMs for an asset
- Inline keyboard for "Create WO / Snooze / Escalate"

### OUT OF SCOPE

- Multi-language support
- Group chat mode
- File downloads beyond image
- Slack/Teams parity (not part of this demo)

---

## Cross-Cutting Demo Requirements

Things that are not a single page but break the demo if any one fails.

| # | Item | Acceptance criteria |
|---|------|---------------------|
| X1 | **Demo data seeded** | The tenant Mike demos with has ≥10 assets, ≥10 WOs, ≥5 PMs, ≥3 indexed manuals. No empty states. |
| X2 | **Network plan** | Tested on hotel/expo Wi-Fi AND on Mike's phone hotspot. Hotspot is the fallback. |
| X3 | **Demo tablet provisioned** | One iPad + one Android tablet, both signed in, both have the bot saved, both have Hub bookmarked. Battery >80% on demo morning. |
| X4 | **No CMMS-net or core-net flakiness** | All four containers (mira-pipeline, mira-mcp, mira-bridge, atlas-api) pass healthcheck for 24 hours straight before demo day. |
| X5 | **Telegram bot uptime** | Bot is up and answering for the 24 hours preceding the demo. Monitored. |
| X6 | **Rollback plan** | Any new deploy after May 18 requires a 5-minute rollback path. No risky merges to `main` between May 18 and May 21. |
| X7 | **Demo-day kill switch** | If any surface starts failing during the demo, Mike has a one-tap "fall back to Telegram" path. Telegram is the floor — if the floor breaks, demo is over. |

---

## Verification Protocol (run on May 18)

48 hours before showtime, Mike runs the **3-minute walkthrough below** end-to-end on **both tablets**. Every step must pass. Any failure is P0, blocks demo, and either gets fixed or the surface is pulled.

After the May-18 dry run:
- Lock `main`. No merges between May 18 and May 22 except P0 demo-blocker fixes.
- Snapshot the deployed images. If a hotfix breaks something, roll back the snapshot.
- Print a paper one-pager of the demo script (in case the tablet dies).

---

## Demo Script — The 3-Minute Walkthrough

Read this top to bottom and time it. If it runs over 3:30, cut a step.

> **Mike, holding tablet, to a prospect at a booth:**
>
> "Quick — let me show you what we built. Three minutes."

### Step 1 (0:00–0:20) — Open the Hub

Mike opens **app.factorylm.com** on the tablet. Already logged in.

> "This is your maintenance home. Real numbers — we've got 18 assets across this plant, 7 open work orders, 4 PMs due this week. None of this is hardcoded; it's coming from the database right now."

✅ Tap the dashboard. Numbers visible. No spinner stuck.

### Step 2 (0:20–0:40) — Assets

Mike taps **Assets**.

> "Here's every piece of equipment. Pumps, motors, VFDs. Each one was scanned in once with a phone — that's it. From there, MIRA pulls the manual, extracts PM schedules, and starts watching."

✅ Asset list scrolls. Mike taps one (e.g., a Yaskawa GA500 VFD).

### Step 3 (0:40–1:20) — MIRA Scan (THE WOW)

Mike says:

> "Watch this. New piece of equipment shows up — say a motor on the floor. No one's seen it before. Tech does this."

Mike taps **Scan** → camera opens → he points at a real nameplate (the booth-prepped sample motor or a printed nameplate card).

✅ Specs extracted in <5s: manufacturer, model, serial, ratings.

> "Five seconds. Now I tap chat."

### Step 4 (1:20–1:50) — Chat with MIRA

Mike taps **Chat with MIRA**.

He types:

> "What does fault F004 mean on this drive?"

✅ MIRA replies in <10s with the actual fault definition + a citation pointing to the OEM manual page it pulled from.

> "Cited. Every answer points to the source. No hallucinations — if it doesn't know, it says so and goes find the manual."

### Step 5 (1:50–2:15) — Create a Work Order

Mike taps **Create Work Order** from the chat.

Pre-filled: asset = the VFD, fault = F004, priority = High.

Mike taps **Save**.

✅ WO appears in the WO list. He swipes to it.

> "It's now in our work-order list. And —" *taps Open CMMS* "— in your CMMS, because we sync."

### Step 6 (2:15–2:35) — CMMS

Mike taps **Open CMMS** → cmms.factorylm.com opens → that same WO is there in Atlas.

> "We don't replace your CMMS. We feed it. Atlas, MaintainX, Fiix, whatever — same flow."

### Step 7 (2:35–2:55) — Telegram

Mike opens **Telegram → @FactoryLMDiagnose_bot** on the same tablet.

Sends a photo of a different nameplate.

✅ Within 10s, MIRA replies: "That's a Siemens 6SL3210 G120. Want the manual? Want PM schedules?"

> "Same brain. Different surface. Tech in the field has WhatsApp, Telegram, Slack — whatever they already use."

### Step 8 (2:55–3:00) — Close

Mike puts the tablet down.

> "That's MIRA. Self-building maintenance knowledge base — every photo, every fault, every fix makes the next call faster. Would you use something like this?"

**[Hand over the QR code card. Done.]**

---

## Tracking

This spec drives:
- GitHub issues labeled `demo-readiness`, `P0` — one per MUST WORK item that isn't already verified working.
- Linear issues mirrored under **Cranesync / MVP Build** with labels `agent-action` or `user-action`.
- Daily standup against this checklist from May 7 onward.

**Spec status:** awaiting Mike's review. Do not start implementation until reviewed and merged.
