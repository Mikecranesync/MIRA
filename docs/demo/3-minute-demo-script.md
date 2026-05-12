# 3-Minute Demo Script — Expo / Booth / Hand-Off

**Audience:** Maintenance manager or plant manager walking past the booth.
**Goal of the demo:** Get them to take the scorecard on their phone (`/assess`) and either book a $500 Assessment now or leave a real email.
**What we are NOT selling:** an AI CMMS, a chatbot, or a seat license. We are selling **maintenance digital transformation**. MIRA is the execution layer that runs on top.

**Total run time:** 2:45 — leaves 15s of slack.

**Walker rule:** infrastructure first, AI second. Never lead with "AI." Lead with the mess that makes AI impossible today.

---

## Beat 1 — The Mess (0:00 → 0:30, 30s)

> "This is what maintenance looks like at most plants."

Show on screen (left → right swipe):
- A messy Google Drive folder with mixed-case PDFs and `Copy of Copy of MANUAL_FINAL_v3.pdf`
- A filing cabinet photo
- A whiteboard with work orders in marker
- A photo of a tech's notebook

> "Three filing cabinets. A SharePoint. One tech's truck. The fault history is in a guy named Dale's head, and Dale retires in eighteen months. The problem isn't that you need software. You probably already have a CMMS. The problem is that nobody has ever **structured this data**. So AI tools you've tried all hallucinated. Of course they did. There was nothing to ground them on."

**Beat goal:** they nod. They've felt this.

---

## Beat 2 — The Structuring (0:30 → 1:15, 45s)

> "We map your maintenance world into a structured namespace."

On screen — live, on the demo iPad:
1. **Scan a nameplate.** Tap, point at a PowerFlex 755 nameplate sticker on the demo prop. Show MIRA recognize `Manufacturer: Allen-Bradley`, `Model: 22D-D1P4N104`, `Asset: POW-755-A12`.
2. **Show the component hierarchy fill in.** Drive → Bus capacitor bank → Capacitor 3. Each one a node.
3. **Link the manual.** It auto-binds to the asset. "Manual §6.2 — DC bus undervoltage" appears as a citation chip.
4. **Show one PLC tag mapping.** `LINE3_VFD1_CURRENT` now knows it lives on `POW-755-A12`.

> "This is the **Maintenance Intelligence Namespace**. It's a subset of UNS — the part nobody else is doing. Assets, sub-components, documents, PLC tags, fault history — all linked. **This is the digital transformation.** AI is just the icing."

**Beat goal:** they understand we did real work, not magic.

---

## Beat 3 — Now AI Helps (1:15 → 1:45, 30s)

> "Now AI can actually help."

Type into MIRA on the iPad:
> "Why did POW-755-A12 trip F005 last night?"

MIRA answers (already in the demo data):
> "F005 on this drive means DC bus undervoltage. Last 7 days show 4 trips at the same RPM band, all overnight. Manual §6.2 says to check the bus capacitor bank — your 2024-12-14 PM noted bulging on cap 3."

Citations visible: `Manual §6.2`, `PM 2024-12-14`, `Trips: last 7 d`.

> "Three citations. Zero hallucination. This only works because the foundation exists. Strip the namespace away — same prompt to ChatGPT — and you get generic web text. Useless on the floor."

**Beat goal:** they feel the difference between grounded and ungrounded AI.

---

## Beat 4 — The Three Ways We Work (1:45 → 2:15, 30s)

> "Three ways we work with you."

Show the `/buy` page on screen:

1. **Assessment — $500.** "I come to your floor for a day. I walk it. I score your readiness. You leave with a written gap report and a namespace blueprint. No software. No demo. No upsell."
2. **Pilot — $2–5K/mo, three-month minimum.** "We pick one line — say, your bottling line. We do the full structuring on that scope. MIRA goes live on it. By month three, you have proof."
3. **Operating Layer — $499/mo per plant.** "MIRA in production across the plant. Telegram + web + your CMMS. Continuous structuring as new assets come online. This is what compounds."

> "Most plants start with the Assessment. It's $500. It's the easiest yes you'll make this quarter."

**Beat goal:** they understand price, sequence, and that it's not a SaaS gotcha.

---

## Beat 5 — Hand Off the Phone (2:15 → 2:30, 15s)

> "Want to see where you stand right now?"

Hand them your phone, already on `factorylm.com/assess` ("Maintenance AI Readiness Scorecard").

> "Twenty questions. Takes five minutes. Nothing stored. You see your radar chart and your top three gaps. **Take it standing here — I'll wait.**"

**If they take it:** you have ~5 min of attention. Use it to ask: *"What did you score lowest on? Tell me about that."* Real conversation begins.
**If they decline:** "Cool — scan this QR, take it later." Hand them the card with the QR.

---

## Beat 6 — The QR / Walkaway (2:30 → 2:45, 15s)

Point at the booth QR code (links to `factorylm.com/buy`).

> "If you want to skip ahead and book the Assessment, that's the QR. $500. I'll be on your floor next week."

Hand them:
- One business card with QR to `/assess`
- One sheet (printed) with the three offers + your direct number

**End state:** scorecard taken OR card in pocket OR Assessment booked. Any of the three is a win. **Never let them leave without one of those three.**

---

## Anti-patterns (don't do these)

- ❌ Lead with "MIRA is an AI chatbot for maintenance." Wrong frame. They've seen ten of those this morning.
- ❌ Say "AI CMMS" anywhere. We don't compete with MaintainX — we structure the data MaintainX needs.
- ❌ Demo the chat first. The chat is Beat 3, not Beat 1. The structuring is the product.
- ❌ Pitch the Operating Layer first. $499/mo SaaS sounds like every other vendor. The Assessment is the wedge.
- ❌ Argue with someone who says "we already have a CMMS." Agree. Ask: "and does it know which manual lives on which asset? Does your AI know that?"

---

## Demo data prerequisites

The demo must show **Stardust Racers** (or whatever bounded asset family we lock in for expo) with:
- 1 nameplate scan path that resolves to a real asset
- ≥1 component hierarchy populated
- ≥1 manual indexed and citable
- ≥1 PLC tag mapped to the asset
- ≥3 historical "trips" in the demo fault history so the "last 7 days" line is real

If any of these aren't loaded before the expo, Beat 2 and Beat 3 collapse into vaporware. **Demo data is P0.**

---

## Props on the booth

- iPad with MIRA chat + nameplate scanner ready
- One real nameplate sticker (PowerFlex 755 or equivalent — borrow from the shop)
- Printed three-offer sheet (Assessment / Pilot / Operating Layer)
- QR card → `/assess`
- Phone running `/assess`, screen unlocked, ready to hand over

---

## Success metric for the expo

- **Primary:** Assessments booked (target: 5 in the expo window)
- **Secondary:** Scorecards taken on our phone or QR (target: 25)
- **Tertiary:** Real emails captured (target: 50)

Anything below the primary is a learning, not a failure. Anything at the primary is validation of the new positioning.
