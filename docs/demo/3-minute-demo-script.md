# 3-Minute Demo Script — Florida Automation Expo, May 21, 2026

**Owner:** Mike Harper
**Companion spec:** `docs/specs/demo-readiness-may21-spec.md`
**Messaging frame:** Walker-aligned — *infrastructure first, AI second*. The pitch is **digital transformation foundation**, not "another AI chatbot."
**Demo length:** 3:00 hard cap. If a step blows past its budget, cut the next step before improvising — the closing CTA must land.
**Surfaces:** iPad (primary) + Android tablet (backup) + Mike's phone for `/assess` flow + printed QR card.

---

## The Frame Mike Opens With (0:00–0:15)

Mike, holding the tablet, to a prospect:

> "Quick — I'll show you what we built. Three minutes. The pitch isn't AI. The pitch is **digital infrastructure for maintenance** — the foundation that makes AI actually work in a plant. Watch."

**Why this opener:** every booth at this expo is shouting "AI." Walker's framework says infrastructure outlasts AI hype. We're the *substrate* — assets, manuals, PMs, work orders, structured and queryable — and *then* the AI layer is honest because the foundation exists.

---

## Step 1 — "Here's the maintenance reality" (0:15–0:35)

Mike pulls up a screenshot or split-screen on the tablet: **a messy Google Drive folder**. PDFs named `Scan_8742.pdf`, `IMG_3318.jpg`, `Pump manual REAL one v3 FINAL.pdf`, `WO_April.xlsx`, photos of nameplates, screenshots of fault codes.

> "This is what maintenance data looks like at most plants. Manuals in Google Drive, work orders in a spreadsheet, fault history in someone's head, asset list in a clipboard. When the VFD fails at 2 AM, the tech is googling part numbers on his phone. **You don't have a CMMS problem. You have a foundation problem.**"

✅ Beat: prospect nods. Every maintenance manager has seen this folder.

**Demo asset:** real screenshot of a representative messy folder lives at `docs/promo-screenshots/2026-05-demo_messy-folder_desktop.png` (TO CREATE before May 18 if not already present). Use a real Stardust Racers folder if available.

---

## Step 2 — "MIRA ingests and structures it" (0:35–1:20)

Mike taps **Scan** on `app.factorylm.com/scan/`. Live camera. Points at a real nameplate on the booth-prep sample motor (or printed nameplate card).

> "Watch. One photo."

✅ Within 5 seconds: manufacturer, model, serial, voltage, FLA, frame size — extracted and on screen.

Mike taps **"Add to assets"** (or "Save").

> "Now we go pull the manual."

Cut to **Knowledge page**. Show: "Yaskawa GA500 manual — indexed, 84 pages, 142 chunks, 7 PM schedules extracted."

> "Manual found, parsed, chunked, embedded. The PM schedule — every quarterly inspection, every belt-tension check — is now in the calendar. We didn't type any of that. The manual told us."

Cut to **Hub dashboard / Assets list**. Show the new asset slotted into the hierarchy (Plant → Bay 7 → Lift House → Motor).

> "This is the **digital infrastructure**: assets, components, manuals, PMs, fault history — structured, hierarchical, queryable. UNS-compatible. Same shape every i3X-aware tool will use in two years."

**Beats hit:**
- Photo → structured asset (the wow)
- PDF → structured PMs (the flywheel)
- Asset → hierarchy → namespace (the infrastructure)

**Fallback if camera misfires:** tap "Upload from gallery" with a pre-loaded nameplate image — same result, no excuses.

---

## Step 3 — "Now your team has the foundation" (1:20–1:50)

Mike taps **Work Orders**, then **Open CMMS**.

> "Once the foundation exists, the rest of the maintenance stack works. Work orders — here in MIRA, also here in Atlas, same data. We don't replace your CMMS. We feed it. Atlas, MaintainX, Fiix, Maximo — whichever you already pay for, we sync to it."

✅ WO list visible. Tap one → detail view → real fields. Tap **Open CMMS** → cmms.factorylm.com loads, same WO present.

> "Your team — techs, planners, managers — they all see the same picture. PMs auto-scheduled from manuals, faults logged from chat, work orders flowing both ways."

---

## Step 4 — "And the AI layer works because the foundation exists" (1:50–2:20)

Mike opens **Telegram → @FactoryLMDiagnose_bot** on the same tablet (or chat panel in Hub — pick one, don't show both).

He types or speaks:

> "What does fault F004 mean on the lift pump VFD?"

✅ Within 10 seconds: answer cites the Yaskawa GA500 manual section, page number, and the asset record we just created.

> "Cited. Grounded. Not a hallucination — because we read your manual, indexed your assets, and tied them together. **This is what AI looks like when it sits on top of real infrastructure.** No foundation, no honest AI. We built the foundation first."

**The Walker beat:** explicitly call out that everyone else's AI demo is a Q&A chatbot bolted onto nothing. Ours is grounded because the ingest layer exists.

---

## Step 5 — "Take the free assessment" (2:20–2:40)

Mike pulls out his **phone**. Opens `factorylm.com/assess` (the DT Scorecard).

> "If you want to know where your plant is on this curve — paper logs to predictive AI, five maturity levels — take the free assessment. Twelve questions, three minutes on your phone. You get a score, a roadmap, and a benchmark against your industry. No credit card, no sales call."

Hand the phone to the prospect. Let them tap through one or two questions to feel the UX.

> "Whatever score you get, the roadmap tells you the next move. For most plants the next move is the same: structure your data. That's what we do."

---

## Step 6 — "Start today" (2:40–3:00)

Mike puts the tablet down, hands over the **QR card**.

> "Scan this. It opens `/buy`. $97 a month gets you one plant on MIRA — assets, manuals, PMs, chat, CMMS sync, the works. You're live in ten minutes from a messy folder. Cancel anytime. **You're not buying AI. You're buying digital infrastructure that happens to have AI on top of it.** That's the difference."

> "Three minutes. That's MIRA."

✅ Hand over QR card → close. Move to next booth conversation.

---

## Walker Messaging — The Five Rules

These rules apply to every word Mike says at the booth. If a sentence violates one, cut it.

1. **Lead with the foundation, not the AI.** Infrastructure first. AI is the payoff, not the headline.
2. **Name the messy reality first.** Prospects don't believe "AI saves time" — they believe "yes, my Google Drive is a disaster." Anchor on their problem.
3. **Every AI claim must be grounded in a structured artifact.** "Cited from page 42 of the Yaskawa manual we ingested" — not "MIRA knows."
4. **CMMS is downstream, not competitive.** We feed Atlas/MaintainX/Fiix. The prospect's existing CMMS investment is protected.
5. **The CTA is a number, not a meeting.** `factorylm.com/assess` or `factorylm.com/buy`. Both are self-serve. No "let's talk."

---

## Timing & Cut List

If the demo is running long at any check-in, cut in this order:

1. **First cut (over by 0:15):** drop the Step-3 CMMS deep-dive, just say "syncs to Atlas/MaintainX/Fiix."
2. **Second cut (over by 0:30):** drop the Step-4 Telegram surface, use the Hub chat panel instead.
3. **Third cut (over by 0:45):** skip Step-5 phone hand-off, point to the QR card with "/assess is on the card too."

If the demo is running short (under 2:30 at Step-6), add: "want to see the same flow from your own messy folder? Drop me a Drive link, I'll have it ingested before you finish your coffee." This is the lead-capture upgrade.

---

## Beats That Must Land (Non-negotiable)

If any of these doesn't hit, the demo failed and Mike should debrief that evening:

- [ ] Step 1: prospect visibly recognized the messy folder as *their* folder
- [ ] Step 2: photo-to-spec returned in <5 seconds and PM count was visible
- [ ] Step 3: "Open CMMS" showed the same WO in Atlas
- [ ] Step 4: cited answer landed with a page number from a real manual
- [ ] Step 5 or 6: prospect either scanned the QR or asked for the assessment URL

If only 3 of 5 land, the booth is still a win (pipeline). If <3, the deck or the data is wrong — adjust before next conversation.

---

## Pre-Demo Checklist (run May 18, 2026)

| # | Item | Owner | Done |
|---|------|-------|------|
| 1 | All MUST WORK items in `demo-readiness-may21-spec.md` pass on both tablets | Mike | ☐ |
| 2 | Demo tenant seeded with Stardust Racers asset hierarchy + Yaskawa GA500 manual + 3 PMs + 5 WOs | Mike | ☐ |
| 3 | `/assess` flow tested on Mike's phone end-to-end | Mike | ☐ |
| 4 | `/buy` page loads, Stripe checkout opens (don't complete) | Mike | ☐ |
| 5 | QR card printed (2 copies — primary + backup) | Mike | ☐ |
| 6 | Messy-folder screenshot at `docs/promo-screenshots/2026-05-demo_messy-folder_*.png` | Mike | ☐ |
| 7 | Sample nameplate card laminated (in case booth lighting is bad) | Mike | ☐ |
| 8 | Tablet batteries ≥80% on demo morning | Mike | ☐ |
| 9 | Hotspot tested — full demo runs on cellular | Mike | ☐ |
| 10 | Telegram bot up for the prior 24h, no 409 conflicts | Mike | ☐ |
| 11 | One paper copy of this script in the booth folder | Mike | ☐ |
| 12 | One paper copy of the kill-switch fallback (Telegram-only flow) | Mike | ☐ |

---

## Kill-Switch Fallback

If MIRA Scan or the Hub goes down mid-demo, **switch to Telegram only**:

1. Mike opens @FactoryLMDiagnose_bot.
2. Sends a pre-loaded nameplate photo.
3. Bot returns equipment ID + offer to fetch manual.
4. Mike types a fault-code question, gets cited answer.
5. Same closing — Walker frame, QR card, `/assess`.

The Telegram path is the floor. If Telegram dies, the demo is over — apologize, hand over a card, move on. Do not improvise.
